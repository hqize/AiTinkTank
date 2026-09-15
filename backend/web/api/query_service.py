"""
    查询流程的接口定义
"""
import json
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, RedirectResponse, StreamingResponse

from config.web_search_config import web_search_config
from processor.query_processor.main_graph import KBQueryWorkflow
from tool.logger import logger
from utils.mongo_history_utils import clear_history, get_recent_messages
from utils.sse_utils import create_sse_queue, SSEEvent, push_to_session, sse_generator
from utils.task_utils import (
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PROCESSING,
    cleanup_old_tasks,
    clear_running_tasks,
    get_done_task_list,
    get_running_task_list,
    get_task_result,
    get_task_status,
    set_task_result,
    update_task_status,
)

def _warm_up_models():
    """
        后台预热本地模型（BGE-M3 向量模型 + BGE Reranker 重排模型）。

        不预热的话，服务启动后的第一个问题会卡在模型加载上（实测冷启动一次要 60s+），
        很容易被当成"系统很笨/没反应"。这里放后台线程执行，失败也不影响服务启动。
    """
    try:
        from utils.embedding_utils import get_bge_m3_ef

        get_bge_m3_ef()
        logger.info("BGE-M3 向量模型预热完成")
    except Exception as e:
        logger.warning(f"BGE-M3 预热失败（不影响服务启动）：{e}")

    try:
        from utils.reranker_utils import _get_bge_reranker

        _get_bge_reranker()
        logger.info("BGE Reranker 重排模型预热完成")
    except Exception as e:
        logger.warning(f"Reranker 预热失败（不影响服务启动）：{e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动即后台预热模型，避免第一个问题慢到像是挂了
    threading.Thread(target=_warm_up_models, daemon=True, name="model-warmup").start()
    yield


# 1. 创建应用
app = FastAPI(
    title="掌柜智库-查询API",
    description="此文档是掌柜智库查询流程的API接口说明",
    lifespan=lifespan,
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

# 3. 静态页面路由
# 页面目录：web/page，页面内的 chat.css / chat.js 也从这个目录取（见文件末尾的挂载）
PAGE_DIR = Path(__file__).resolve().parents[1] / "page"


@app.get("/chat.html")  # 对外访问地址
async def chat():
    html_path = PAGE_DIR / "chat.html"
    # 如果不存在，抛出404异常
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"没有查询到页面，地址为：{html_path}")
    return FileResponse(html_path)


@app.get("/", include_in_schema=False)
async def index():
    # 根路径直接跳转到对话页面，避免访问根路径时看到 Not Found
    return RedirectResponse(url="/chat.html")


# 定义接口接收的数据结构
class QueryRequest(BaseModel):
    """查询请求数据结构"""
    query: str = Field(..., description="查询内容")  # ...必须填写
    session_id: str = Field(None, description="会话ID")
    is_stream: bool = Field(False, description="是否流式返回")
    # 联网搜索实现：mcp（外部MCP服务）/ llm（大模型自带联网）/ off（关闭）
    # 不传则使用环境变量 WEB_SEARCH_PROVIDER 的配置；传了就按本次请求走，方便 A/B 对比
    web_search_provider: str = Field(None, description="联网搜索实现：mcp / llm / off")


def _load_image_urls(task_key: str) -> List[str]:
    """从任务结果里取出图片URL列表（以JSON字符串形式存储）"""
    raw = get_task_result(task_key, "image_urls", "")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [str(item) for item in data] if isinstance(data, list) else []


@app.post("/query")
async def query(background_tasks: BackgroundTasks, request: QueryRequest):
    """
        1 解析参数
        2 更新任务状态
        3 调用处理流程图
        4 返回结果

        说明：查询流程以 session_id 作为任务标识（同一会话的状态/结果按键覆盖）
        :param background_tasks:
        :param request:
        :return:
    """
    user_query = (request.query or "").strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="query 不能为空")

    session_id = request.session_id if request.session_id else str(uuid.uuid4())
    is_stream = bool(request.is_stream)
    web_search_provider = (request.web_search_provider or "").strip().lower()

    # 顺手清理已结束且超过保留时长的任务，避免内存字典无限增长
    expired_task_ids = cleanup_old_tasks()
    if expired_task_ids:
        logger.info(f"已清理过期任务：{expired_task_ids}")

    if is_stream:
        # 创建一个字典 存储对一个session_id : queue 结果队列
        # 必须在更新状态之前创建，这样第一次进度推送才能落到队列里
        create_sse_queue(session_id)

    # 重置本次会话的结果，避免上一轮的答案/错误影响本轮
    set_task_result(session_id, "answer", "")
    set_task_result(session_id, "error", "")
    set_task_result(session_id, "image_urls", "[]")

    # 更新任务状态（流式时顺带推送一次进度事件）
    update_task_status(session_id, TASK_STATUS_PROCESSING, is_stream)
    logger.info(
        f"[{session_id}] 开始处理流程，是否流式：{is_stream}，"
        f"联网搜索实现：{web_search_provider or web_search_config.provider}，问题：{user_query}"
    )

    if is_stream:
        # 流式：后台跑图，结果通过 /stream/{session_id} 持续推送
        background_tasks.add_task(run_query_graph, session_id, user_query, True, web_search_provider)
        return {
            "message": "结果正在处理中...",
            "session_id": session_id,
            "web_search_provider": web_search_provider or web_search_config.provider
        }

    # 非流式：图里有同步的模型推理与网络请求，必须放线程池执行，
    # 否则会阻塞事件循环（连带 /health、/stream 等接口全部卡住）
    await run_in_threadpool(run_query_graph, session_id, user_query, False, web_search_provider)

    return {
        "message": "处理完成！",
        "session_id": session_id,
        "answer": get_task_result(session_id, "answer", ""),
        "image_urls": _load_image_urls(session_id),
        "error": get_task_result(session_id, "error", ""),
        "status": get_task_status(session_id),
        "done_list": get_done_task_list(session_id),
        "running_list": get_running_task_list(session_id),
        # 本次实际使用的联网搜索实现，便于对比两种方案的效果
        "web_search_provider": web_search_provider or web_search_config.provider,
    }


# 定义查询接口
def run_query_graph(
    session_id: str,
    user_query: str,
    is_stream: bool = True,
    web_search_provider: str = "",
):
    """
        执行查询流程图。

        :param session_id: 会话ID，同时作为任务标识
        :param user_query: 用户问题
        :param is_stream: 是否流式（流式时进度与答案会推送到SSE队列）
    """
    logger.info(f"[{session_id}] 开始流程图处理，is_stream={is_stream}")

    init_state = {
        "original_query": user_query,
        "session_id": session_id,
        "is_stream": is_stream,
        "web_search_provider": web_search_provider,
    }

    try:
        workflow = KBQueryWorkflow()
        merged_state: Dict[str, Any] = {}

        if is_stream:
            # 流式执行：节点进度由 NodeBase 直接推送到SSE队列，
            # 这里把每个节点的返回合并起来，作为最终状态兜底
            for chunk in workflow.run(init_state, stream=True):
                if not isinstance(chunk, dict):
                    continue
                for _node_name, node_update in chunk.items():
                    if isinstance(node_update, dict):
                        merged_state.update(node_update)
        else:
            merged_state = workflow.run(init_state, stream=False) or {}

        # 节点内部异常统一在这里兜底：把答案/错误写进任务结果
        answer = get_task_result(session_id, "answer", "") or str(merged_state.get("answer") or "")
        if answer and not get_task_result(session_id, "answer", ""):
            set_task_result(session_id, "answer", answer)

        clear_running_tasks(session_id)
        update_task_status(session_id, TASK_STATUS_COMPLETED, is_stream)
        logger.info(f"[{session_id}] 查询流程处理完成")

    except Exception as e:
        logger.error(f"[{session_id}] 查询流程执行异常：{e}", exc_info=True)
        clear_running_tasks(session_id)
        set_task_result(session_id, "error", str(e))
        update_task_status(session_id, TASK_STATUS_FAILED, is_stream)
        if is_stream:
            push_to_session(session_id, SSEEvent.ERROR, {"error": str(e)})

    finally:
        # 流式必须显式关闭队列，否则前端 EventSource 会一直挂着（还会触发自动重连）
        if is_stream:
            push_to_session(session_id, SSEEvent.CLOSE, {})


@app.get("/stream/{session_id}")
async def stream(session_id: str, request: Request):
    """
        sse 实时返回结果
    """
    logger.info(f"[{session_id}] 建立SSE连接")
    return StreamingResponse(
        sse_generator(session_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.delete("/history/{session_id}")
async def clear_chat_history(session_id: str):
    """
        清空指定会话的历史记录
    """
    count = clear_history(session_id)
    return {"message": "历史会话已清空", "deleted_count": count}


@app.get("/history/{session_id}")
async def history(session_id: str, limit: int = 50):
    """
        查询当前会话历史记录
    """
    try:
        records = get_recent_messages(session_id, limit=limit)
        items = []
        for r in records:
            items.append({
                "_id": str(r.get("_id")) if r.get("_id") is not None else "",
                "session_id": r.get("session_id", ""),
                "role": r.get("role", ""),
                "text": r.get("text", ""),
                "rewritten_query": r.get("rewritten_query", ""),
                "item_names": r.get("item_names", []),
                # 图片URL必须回传，否则前端刷新后历史消息里的图片会全部丢失
                "image_urls": r.get("image_urls") or [],
                "ts": r.get("ts")
            })
        return {"session_id": session_id, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"history error: {e}")


# 证明服务器启动即可
@app.get("/health")
async def health():
    """
        检查服务是否正常
    """
    return {"ok": True}

# 静态资源挂载：页面里的 chat.css / chat.js 是浏览器单独发起的请求，
# 只注册 /chat.html 的话它们会全部 404，必须把整个 page 目录挂载出去。
# 注意：必须放在所有 API 路由之后，Starlette 按注册顺序匹配，否则会遮盖 /query 等接口。
app.mount("/", StaticFiles(directory=PAGE_DIR, html=True), name="page")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
