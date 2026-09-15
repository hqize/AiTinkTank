import threading
import time
from typing import Dict, List

from .sse_utils import push_to_session

# ---------------------------
# 内存态任务追踪（单进程）
# ---------------------------
# 注意：以下字典保存在进程内存中，因此服务必须以单进程（workers=1）方式运行，
# 否则 /status 轮询可能落到没有该任务数据的其它 worker 上。
# key: task_id
# value: 节点名列表（原始英文/节点ID）
_tasks_running_list: Dict[str, List[str]] = {}
_tasks_done_list: Dict[str, List[str]] = {}

# key: task_id
# value: status 字符串（如 pending/processing/completed/failed）
_tasks_status: Dict[str, str] = {}

# key: task_id
# value: 任务结果（例如 query 的 answer）
_tasks_result: Dict[str, Dict[str, str]] = {}

# key: task_id
# value: 任务创建时间（time.time()），用于过期任务清理
_tasks_created_at: Dict[str, float] = {}

# 后台任务（BackgroundTasks 线程池）与事件循环会并发访问上述字典，统一加锁保护
_task_lock = threading.RLock()


TASK_STATUS_PENDING = "pending"
TASK_STATUS_PROCESSING = "processing"
TASK_STATUS_COMPLETED = "completed"
TASK_STATUS_FAILED = "failed"

# 节点名 -> 中文名映射（用于前端展示）
# 说明：这里的 key 应与 LangGraph 的 add_node("xxx", ...) 中的节点名一致。
_NODE_NAME_TO_CN: Dict[str, str] = {
    "upload_file": "开始上传文件",
    "node_entry": "检查文件",
    "node_pdf_to_md": "PDF转Markdown",
    "node_md_img": "Markdown图片处理",
    "node_item_name_recognition": "主体名称识别",
    "node_document_split": "文档切分",
    "node_bge_embedding": "向量生成",
    "node_import_milvus": "导入向量库",
    "__end__": "处理完成",
    "END": "处理完成",
    # --- Query 流程节点（kb/query_process/main_graph.py）---
    "node_item_name_confirm": "确认问题产品",
    "node_answer_output": "生成答案",
    "node_rerank": "重排序",
    "node_rrf": "倒排融合",
    "node_web_search": "网络搜索",
    "node_web_search_mcp": "网络搜索",
    "node_search_embedding": "切片搜索",
    "node_search_embedding_hyde": "切片搜索(假设性文档)",
    "node_multi_search": "多路搜索",
    "node_join": "多路搜索合并",
}


def _ensure_task(task_id: str) -> None:
    """确保 task_id 对应的数据结构已初始化。"""
    with _task_lock:
        if task_id not in _tasks_running_list:
            _tasks_running_list[task_id] = []
        if task_id not in _tasks_done_list:
            _tasks_done_list[task_id] = []
        if task_id not in _tasks_result:
            _tasks_result[task_id] = {}
        if task_id not in _tasks_created_at:
            _tasks_created_at[task_id] = time.time()


def _to_cn(node_name: str) -> str:
    """将节点名转换为中文展示名；若无映射则返回原名。"""
    return _NODE_NAME_TO_CN.get(node_name, node_name)


def add_running_task(task_id: str, node_name: str, is_stream:bool = False) -> None:
    """
        添加“正在运行”的节点任务。

        参数：
        - task_id: 任务ID
        - node_name: 节点名称(节点ID)
    """
    _ensure_task(task_id)
    with _task_lock:
        running = _tasks_running_list[task_id]
        # 避免重复追加
        if node_name not in running:
            running.append(node_name)

    if is_stream:
        task_push_queue(task_id)


def add_done_task(task_id: str, node_name: str, is_stream:bool = False) -> None:
    """
        添加“已完成”的节点任务。

        注意：添加已完成任务时，会把同名的“正在运行”任务删除。

        参数：
        - task_id: 任务ID
        - node_name: 节点名称(节点ID)
    """
    _ensure_task(task_id)

    with _task_lock:
        # 1) 从 running 中移除同名节点（可能出现重复，移除所有）
        running = _tasks_running_list[task_id]
        _tasks_running_list[task_id] = [n for n in running if n != node_name]

        # 2) 追加到 done（保持完成顺序），避免重复
        done = _tasks_done_list[task_id]
        if node_name not in done:
            done.append(node_name)

    if is_stream:
        task_push_queue(task_id)


def clear_running_tasks(task_id: str) -> None:
    """
        清空指定任务的「正在运行」节点列表。

        使用场景：任务异常终止时，正在执行的节点会残留在 running 列表里，
        前端会一直显示「正在进行XXX...」，因此置为 failed 时必须清理。
    """
    _ensure_task(task_id)
    with _task_lock:
        _tasks_running_list[task_id] = []



def set_task_result(task_id: str, key: str, value: str) -> None:
    """
        存储任务结果字段（如 answer / error）。
    """
    _ensure_task(task_id)
    with _task_lock:
        _tasks_result[task_id][key] = value


def get_task_result(task_id: str, key: str, default: str = "") -> str:
    """
        获取任务结果字段（如 answer / error）。
    """
    _ensure_task(task_id)
    with _task_lock:
        return _tasks_result.get(task_id, {}).get(key, default)


def is_known_task(task_id: str) -> bool:
    """
        判断 task_id 是否为服务端记录过的任务。

        用于 /status 接口：未记录过的 task_id（例如服务重启后前端还在轮询旧任务）
        直接返回空状态，避免为无效轮询创建任务记录、撑大内存字典。

        :param task_id: 任务ID
        :return: 是否为已知任务
    """
    with _task_lock:
        return task_id in _tasks_created_at


def get_task_status(task_id: str ) -> str:
    """
        获取当前任务状态。

        参数：
        - task_id: 任务ID

        返回：
        - str: 状态名称；如果未设置过则返回空字符串
    """
    with _task_lock:
        return _tasks_status.get(task_id, "")



def get_done_task_list(task_id: str) -> List[str]:
    """
    获取已完成节点列表（中文展示）。


    """
    _ensure_task(task_id)
    with _task_lock:
        done = _tasks_done_list.get(task_id, [])
        return [ _to_cn(n)  for n in done]


def get_running_task_list(task_id: str) -> List[str]:
    """
    获取正在运行节点列表（中文展示）。

    """
    _ensure_task(task_id)
    with _task_lock:
        running = _tasks_running_list.get(task_id, [])
        return [ _to_cn(n)  for n in running]



def update_task_status(task_id: str, status_name: str, push_queue:bool = False) -> None:
    """
    更新任务状态。

    参数：
    - task_id: 任务ID
    - status_name: 状态名称（字符串）
    """
    with _task_lock:
        _tasks_status[task_id] = status_name
    if push_queue:
        task_push_queue(task_id)

def task_push_queue(task_id: str):
    push_to_session(task_id, "progress", {
        "status": get_task_status(task_id),
        "done_list": get_done_task_list(task_id),
        "running_list": get_running_task_list(task_id),
    })
#
def clear_task(task_id: str):
    with _task_lock:
        _tasks_running_list.pop(task_id, None)
        _tasks_done_list.pop(task_id, None)
        _tasks_status.pop(task_id, None)
        _tasks_result.pop(task_id, None)
        _tasks_created_at.pop(task_id, None)


def cleanup_old_tasks(max_age_seconds: int = 24 * 60 * 60) -> List[str]:
    """
        清理已结束且超过保留时长的任务，避免内存字典随任务数无限增长。

        pending / processing 中的任务一律保留，只有 completed / failed 才会被清理。

        :param max_age_seconds: 任务结束后保留的秒数，默认 24 小时
        :return: 被清理的 task_id 列表
    """
    expired_task_ids: List[str] = []
    now = time.time()

    with _task_lock:
        for task_id, created_at in list(_tasks_created_at.items()):
            if _tasks_status.get(task_id) not in (TASK_STATUS_COMPLETED, TASK_STATUS_FAILED):
                continue
            if now - created_at < max_age_seconds:
                continue
            clear_task(task_id)
            expired_task_ids.append(task_id)

    return expired_task_ids
