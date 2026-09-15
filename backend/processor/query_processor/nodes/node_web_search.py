# processor/query_processor/nodes/node_web_search.py

"""
    联网搜索统一入口节点

    按「运行时请求参数 > 环境变量配置」的顺序选择具体实现：
      - mcp：node_web_search_mcp.NodeWebSearchMcp（外部 MCP 服务，百度千帆 webSearch）
      - llm：node_web_search_llm.NodeWebSearchLlm（大模型自带的联网工具）
      - off：直接跳过联网搜索

    两种实现都保留、输出格式一致，因此可以在不改动下游节点的前提下随时切换对比：
      * 环境变量：WEB_SEARCH_PROVIDER=llm（重启生效）
      * 单次请求：POST /query 里带 "web_search_provider": "llm"（无需重启，适合 A/B 对比）
"""

from processor.query_processor.base import NodeBase
from processor.query_processor.nodes.node_web_search_llm import NodeWebSearchLlm
from processor.query_processor.nodes.node_web_search_mcp import NodeWebSearchMcp
from processor.query_processor.state import QueryGraphState
from config.web_search_config import PROVIDER_LLM, PROVIDER_MCP, PROVIDER_OFF, web_search_config
from tool.logger import logger

# 视为「关闭联网搜索」的取值
_OFF_VALUES = {PROVIDER_OFF, "none", "disable", "disabled", "close", "closed", ""}


class NodeWebSearch(NodeBase):
    """
        节点功能：联网搜索（可切换实现）
    """

    name: str = "node_web_search"

    def __init__(self):
        self._mcp_node = NodeWebSearchMcp()
        self._llm_node = NodeWebSearchLlm()

    def process(self, state: QueryGraphState) -> QueryGraphState:
        provider = self._resolve_provider(state)
        if provider in _OFF_VALUES:
            logger.info("联网搜索已关闭（provider=off），跳过该分支")
            return {}

        query = state.get("rewritten_query") or state.get("original_query") or ""
        if not query:
            return {}

        # 联网搜索属于「可选增益」分支：任何异常都不能中断整条查询链路
        try:
            if provider == PROVIDER_LLM:
                docs = self._llm_node.search(query)
            elif provider == PROVIDER_MCP:
                # 注意调用 process() 而不是实例本身，避免重复记录节点进度
                docs = (self._mcp_node.process(state) or {}).get("web_search_docs") or []
            else:
                logger.warning(f"未知的联网搜索实现 '{provider}'，本次回退到 {PROVIDER_MCP}")
                docs = (self._mcp_node.process(state) or {}).get("web_search_docs") or []
        except Exception as e:
            logger.warning(f"联网搜索({provider})失败，本次跳过联网结果：{e}")
            return {}

        if not docs:
            logger.warning(f"联网搜索({provider})未返回结果")
            return {}

        logger.info(f"联网搜索({provider})命中 {len(docs)} 条 -> {[d.get('url') for d in docs]}")
        return {"web_search_docs": docs}

    @staticmethod
    def _resolve_provider(state: QueryGraphState) -> str:
        """单次请求指定的实现优先，其次取环境变量配置"""
        requested = state.get("web_search_provider")
        if requested is not None and str(requested).strip() != "":
            return str(requested).strip().lower()
        return (web_search_config.provider or PROVIDER_MCP).strip().lower()
