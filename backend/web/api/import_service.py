"""
    导入流程的API接口定义
"""
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

from starlette.responses import FileResponse, RedirectResponse

from config.minio_config import minio_config
from config.path_config import get_data_root_dir
from processor.import_processor.main_graph import KBImportWorkflow
from processor.import_processor.state import get_default_state
from tool.logger import logger
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware


from utils.minio_utils import get_minio_client
from utils.task_utils import add_running_task, add_done_task, update_task_status, get_task_status, get_done_task_list, \
    get_running_task_list, set_task_result, get_task_result, is_known_task, clear_running_tasks, cleanup_old_tasks

# 允许导入的文件类型（前端 accept 只是选择器提示，拖拽可以绕过，这里必须再校验一次）
ALLOWED_SUFFIXES = {".pdf", ".md"}

# 1. 创建应用
# 标题和描述会在Swagger文档中展示
app = FastAPI(
    title="RAG智库客服-导入API",
    description="此文档是RAG智库客服导入流程的API接口说明"
)

# 2. 跨域
# 注意：allow_origins=["*"] 与 allow_credentials=True 是浏览器不接受的组合
# （带凭据的请求不允许返回通配符），本服务前后端同源，因此关闭凭据即可。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许的源
    allow_credentials=False,  # 不允许携带cookie
    allow_methods=["*"],  # 允许的请求方法
    allow_headers=["*"],  # 允许的请求头
)

# 3. 静态页面路由：返回文件导入前端页面
# 访问地址：http://localhost:8000/import.html
# 页面目录：web/page，页面内的 import.css / import.js 也从这个目录取（见文件末尾的挂载）
PAGE_DIR = Path(__file__).resolve().parents[1] / "page"


@app.get("/import.html")  # 对外访问地址
async def get_import_page():
    # HTML文件绝对路径
    html_path = PAGE_DIR / "import.html"
    # 如果不存在，抛出404异常
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"没有查询到页面，地址为：{html_path}")
    return FileResponse(html_path)


@app.get("/", include_in_schema=False)
async def index():
    # 根路径直接跳转到导入页面，避免访问根路径时看到 Not Found
    return RedirectResponse(url="/import.html")


# 4. 后台任务：LangGraph全流程执行
# 独立于主请求线程，由BackgroundTasks触发，避免阻塞接口响应
def run_graph_task(task_id: str, file_dir: str, import_file_path: str):
    """
        LangGraph全流程执行后台任务
        核心流程：初始化状态 → 流式执行图节点 → 实时更新任务状态 → 异常捕获
        任务状态更新：pending → processing → completed/failed
        节点进度更新：每完成一个节点，将节点名加入done_list，供前端轮询查看

        :param task_id: 全局唯一任务ID，关联单个文件的全流程处理
        :param file_dir: 该任务的本地文件存储目录（含临时文件/解析结果）
        :param import_file_path: 上传文件的本地绝对路径
    """
    try:
        # 1. 更新任务全局状态为：处理中
        update_task_status(task_id, "processing")

        # 2. 初始化LangGraph状态
        # 用默认状态打底，保证每个节点都能安全读到 state 中的字段（避免 KeyError），
        # 再覆盖本次任务的实际入参
        init_state = get_default_state()
        init_state.update({
            "task_id": task_id,
            "file_dir": file_dir,
            "import_file_path": import_file_path,
        })

        # 3. 流式执行LangGraph全流程（stream模式：实时获取每个节点的执行结果）
        workflow = KBImportWorkflow()
        for event in workflow.run(init_state, stream=True):
            for node_name, node_result in event.items():
                # 将完成的节点名加入【已完成列表】，前端轮询/status/{task_id}可实时获取
                add_done_task(task_id, node_name)

        # 4. 全流程执行完成：清空运行中列表（正常情况下节点自己已摘除），更新状态为：已完成
        clear_running_tasks(task_id)
        update_task_status(task_id, "completed")

    except Exception as e:
        # 5. 捕获全流程异常：清理残留的「正在运行」节点，记录失败原因（供前端展示），
        #    再把任务状态置为「失败」，最后打印含堆栈的错误日志
        clear_running_tasks(task_id)
        set_task_result(task_id, "error", str(e))
        update_task_status(task_id, "failed")
        logger.info(f"[{task_id}] LangGraph全流程执行失败，异常信息：{str(e)}", exc_info=True)


# 5. 核心接口：文件上传接口
# 支持多文件上传，核心流程：接收文件 → 本地保存 → MinIO上传 → 启动后台任务
# 访问地址：http://localhost:8000/upload （POST请求，form-data格式传参）
@app.post("/upload", summary="文件上传接口", description="支持多文件批量上传，自动触发知识库导入全流程")
async def upload_files(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...)):
    """
        文件上传核心接口
        1. 接收前端上传的多文件（PDF/MD为主）
        2. 按「日期/任务ID」分层保存到本地输出目录，避免文件冲突
        3. 将文件上传至MinIO对象存储，做持久化存储
        4. 为每个文件生成唯一TaskID，启动独立的LangGraph后台处理任务
        5. 实时更新任务状态，供前端轮询监控进度

        :param background_tasks: FastAPI后台任务对象，用于异步执行LangGraph流程
        :param files: 前端上传的文件列表（form-data格式）
        :return: 包含上传结果和所有任务ID的JSON响应
    """
    # 0. 顺手清理已结束且超过保留时长的任务，避免内存字典无限增长
    expired_task_ids = cleanup_old_tasks()
    if expired_task_ids:
        logger.info(f"已清理过期任务：{expired_task_ids}")

    # 1. 构建本地存储根目录：backend/out/YYYYMMDD
    #    由 DATA_BASED_ROOT_DIR 控制，相对路径以 backend/ 目录为基准（见 config/path_config.py），
    #    因此不受服务启动时 CWD 的影响
    date_str = datetime.now().strftime("%Y%m%d")
    data_dir = get_data_root_dir() / date_str
    # 初始化任务ID列表，用于返回给前端（一个文件对应一个TaskID）
    task_ids = []

    # 2. 遍历处理每个上传的文件（多文件批量处理，各自独立生成TaskID）
    for file in files:
        # 生成全局唯一TaskID（UUID4），作为单个文件的全流程标识
        task_id = str(uuid.uuid4())
        task_ids.append(task_id)

        # 2.1 文件名净化：只取文件名部分，避免 "../../x.pdf" 这类路径穿越写到目录外
        safe_filename = Path(file.filename or "").name.strip()
        if not safe_filename or safe_filename in (".", ".."):
            logger.warning(f"[{task_id}] 上传文件缺少有效文件名，已跳过：{file.filename!r}")
            set_task_result(task_id, "error", "上传文件缺少有效文件名")
            update_task_status(task_id, "failed")
            continue

        # 2.2 文件类型校验：不支持的格式直接给出明确失败原因，不再让它在图里深处才报错
        suffix = Path(safe_filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            logger.warning(f"[{task_id}] 不支持的文件类型：{safe_filename}")
            set_task_result(task_id, "error", f"不支持的文件类型 {suffix or '(无后缀)'}，仅支持 PDF / MD")
            update_task_status(task_id, "failed")
            continue

        logger.info(f"[{task_id}] 开始处理上传文件，文件名：{safe_filename}，文件类型：{file.content_type}")

        # 2.3 先落一个 pending 状态：前台拿到 task_id 后立刻轮询也不会读到空状态
        update_task_status(task_id, "pending")

        # 3. 标记「文件上传」阶段为「运行中」，前端轮询可查
        add_running_task(task_id, "upload_file")

        # 4. 构建该任务的本地独立目录：backend/out/YYYYMMDD/TaskID，避免多文件重名冲突
        file_dir = str(data_dir / task_id)
        os.makedirs(file_dir, exist_ok=True)  # 目录不存在则创建，存在则不做处理
        # 构建上传文件的本地保存绝对路径
        import_file_path = os.path.join(file_dir, safe_filename)

        # 5. 将上传的文件保存到本地临时目录（后续MinIO上传/文件解析均基于此文件）
        with open(import_file_path, "wb") as file_buffer:
            shutil.copyfileobj(file.file, file_buffer)
        logger.info(f"[{task_id}] 文件已保存至本地，路径：{import_file_path}")

        # 6. 将本地文件上传至MinIO对象存储，做持久化保存
        # 构建MinIO中的文件对象名：pdf_files/YYYYMMDD/TaskID/文件名
        # 带上TaskID，避免同名文件同一天互相覆盖
        minio_object_name = f"pdf_files/{date_str}/{task_id}/{safe_filename}"
        try:
            # 获取MinIO客户端实例
            minio_client = get_minio_client()

            # 从环境变量获取MinIO的桶名配置
            minio_bucket_name = minio_config.bucket_name

            # 本地文件上传至MinIO（同名文件会自动覆盖，保证文件最新）
            minio_client.fput_object(
                bucket_name=minio_bucket_name,
                object_name=minio_object_name,
                file_path=import_file_path,
                content_type=file.content_type or "application/octet-stream"  # 传递文件原始MIME类型
            )
            logger.info(f"[{task_id}] 文件已成功上传至MinIO，桶名：{minio_bucket_name}，对象名：{minio_object_name}")
        except Exception as e:
            # MinIO上传失败，记录警告日志（不中断后续流程，本地文件仍可继续处理）
            logger.warning(f"[{task_id}] 文件上传MinIO失败，将继续执行本地处理流程，异常信息：{str(e)}", exc_info=True)

        # 7. 标记「文件上传」阶段为「已完成」，前端轮询可查
        add_done_task(task_id, "upload_file")

        # 8. 将LangGraph全流程处理加入FastAPI后台任务（异步执行，不阻塞当前接口响应）
        background_tasks.add_task(run_graph_task, task_id, file_dir, import_file_path)
        logger.info(f"[{task_id}] 已将LangGraph全流程加入后台任务，任务已启动")

    # 9. 所有文件处理完毕，返回上传成功信息和所有TaskID（前端基于TaskID轮询进度）
    logger.info(f"多文件上传处理完毕，共处理{len(files)}个文件，生成TaskID列表：{task_ids}")
    return {
        "code": 200,
        "message": f" 文件上传成功, total: {len(files)}",
        "task_ids": task_ids
    }


# 6. 核心接口：任务状态查询接口
# 前端轮询此接口获取单个任务的处理进度和状态
# 访问地址：http://localhost:8000/status/{task_id} （GET请求）
@app.get("/status/{task_id}", summary="任务状态查询", description="根据TaskID查询单个文件的处理进度和全局状态")
async def get_task_progress(task_id: str):
    """
        任务状态查询接口
        前端轮询此接口（如每秒1次），获取任务的实时处理进度
        返回数据均来自内存中的任务管理字典（task_utils.py），高性能无IO

        :param task_id: 全局唯一任务ID（由/upload接口返回）
        :return: 包含任务全局状态、已完成节点、运行中节点、失败原因的JSON响应
    """
    # 未知 task_id（例如服务重启后前端仍在轮询旧任务）直接返回空状态，
    # 不创建任务记录，避免被无效轮询撑大内存字典
    if not is_known_task(task_id):
        return {
            "code": 200,
            "task_id": task_id,
            "status": "",
            "done_list": [],
            "running_list": [],
            "error": ""
        }

    # 构造任务状态返回体
    task_status_info: Dict[str, Any] = {
        "code": 200,
        "task_id": task_id,
        "status": get_task_status(task_id),  # 任务全局状态：pending/processing/completed/failed
        "done_list": get_done_task_list(task_id),  # 已完成的节点/阶段列表
        "running_list": get_running_task_list(task_id),  # 正在运行的节点/阶段列表
        "error": get_task_result(task_id, "error")  # 失败原因（成功时为空字符串）
    }
    # 记录状态查询日志，方便追踪前端轮询情况
    logger.info(
        f"[{task_id}] 任务状态查询，当前状态：{task_status_info['status']}，已完成节点：{task_status_info['done_list']}")
    return task_status_info


# 7. 静态资源挂载：页面里的 import.css / import.js 是浏览器单独发起的请求，
# 只注册 /import.html 的话它们会全部 404，必须把整个 page 目录挂载出去。
# 注意：必须放在所有 API 路由之后，Starlette 按注册顺序匹配，否则会遮盖 /upload 等接口。
app.mount("/", StaticFiles(directory=PAGE_DIR, html=True), name="page")


if __name__ == "__main__":
    uvicorn.run(app=app,host="127.0.0.1",port=8000)
