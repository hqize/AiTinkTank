# utils/reranker_utils.py

from config.reranker_config import reranker_config
from tool.logger import logger

# 本地重排序模型单例对象，避免每次调用都重新加载模型
_bge_reranker = None

def _get_bge_reranker():
    """
        获取本地 BGE Reranker 单例对象（首次调用时才真正加载模型）
        :return: 初始化完成的 FlagReranker 实例
    """
    global _bge_reranker
    if _bge_reranker is not None:
        return _bge_reranker

    # 延迟导入：torch / transformers 加载较慢，只在真正用到本地模型时才引入
    from FlagEmbedding import FlagReranker

    logger.info(f"加载本地重排序模型: {reranker_config.bge_reranker_path}")
    _bge_reranker = FlagReranker(
        model_name_or_path=reranker_config.bge_reranker_path,
        use_fp16=reranker_config.bge_reranker_fp16,
        devices=reranker_config.bge_reranker_device,
        batch_size=reranker_config.bge_reranker_batch_size,
        normalize=reranker_config.bge_reranker_normalize,
    )
    return _bge_reranker

def rerank_documents(query: str, documents: list[str]) -> list[float]:
    """
    对文档做相关性打分
    :param query: 查询文本
    :param documents: 待打分的文档内容列表
    :return: 与 documents 等长、下标一一对应的相关性分数列表
    """
    if not documents:
        return []

    model = _get_bge_reranker()

    # 单条 query 对多条 document 组成 (query, passage) 对
    pairs = [(query, doc or "") for doc in documents]
    scores = model.compute_score(pairs)

    # 只传一对时 FlagReranker 返回的是单个 float，这里统一成列表
    if isinstance(scores, (int, float)):
        scores = [scores]
    return [float(score) for score in scores]
