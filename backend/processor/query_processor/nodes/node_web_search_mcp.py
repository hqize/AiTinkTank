# processor/query_processor/nodes/node_web_search_mcp.py
import asyncio

from agents.mcp import MCPServerStreamableHttp

from config.mcp_config import mcp_config
from processor.query_processor.base import NodeBase
from processor.query_processor.state import QueryGraphState
from tool.logger import logger
from utils.json_format_utils import serialize_json


class NodeWebSearchMcp(NodeBase):
    """
        节点功能，调用外部搜索引擎补充信息
    """

    # 覆盖基类的 name 属性，标识节点名称
    name: str = "node_web_search_mcp"

    def process(self, state: QueryGraphState) -> QueryGraphState:

        query = state.get("rewritten_query", "")
        docs = []
        # 如果没有查询内容，直接返回
        if query:
            result = asyncio.run(self._mcp_call(query))
            text = self._extract_text(result)
            if text:
                # 统一输出结构化结果，供后续 rerank/引用使用
                # 每条：{title, url, snippet}
                docs = self._parse_search_text(text)
                if docs:
                    logger.info(
                        f"MCP 搜索结果: {len(docs)} 条 -> "
                        f"{[doc['url'] for doc in docs]}"
                    )
                else:
                    logger.warning(f"MCP 搜索返回文本未能解析出结果，原文前200字符: {text[:200]}")
            else:
                logger.warning("MCP 搜索未返回任何文本内容")

        if docs:
            return {"web_search_docs": docs}
        return {}

    @staticmethod
    def _extract_text(result) -> str:
        """
            从 MCP call_tool 的返回结果中取出全部文本块内容。

            :param result: MCPServerStreamableHttp.call_tool 的返回值
            :return: 拼接后的文本，无文本内容时返回空字符串
        """
        content = getattr(result, "content", None)
        if not content:
            return ""
        # 只取文本块，其余类型（图片、资源等）直接跳过，避免取到没有 .text 的对象
        return "\n".join(
            block.text for block in content
            if getattr(block, "type", None) == "text" and getattr(block, "text", None)
        )

    @staticmethod
    def _parse_search_text(text: str) -> list[dict]:
        """
            解析 webSearch 返回的纯文本结果为结构化列表。

            原始格式（每条结果以 details: 开头，结果之间以空行分隔）：
                details:
                Title:<标题>
                Content:<摘要正文>
                URL:<链接>

            注：这里不是 JSON，是 MCP 服务自定义的文本格式，不能用 json.loads 解析。

            :param text: MCP 返回的原始文本
            :return: [{title, url, snippet}, ...]，丢弃没有正文的条目
        """
        docs: list[dict] = []
        current: dict | None = None

        for raw_line in text.splitlines():
            line = raw_line.strip()

            if line == "details:":
                # 新的一条结果开始，先把上一条收尾
                if current:
                    docs.append(current)
                current = {"title": "", "url": "", "snippet": ""}
                continue

            # details: 之前的杂项内容直接忽略
            if current is None or not line:
                continue

            if line.startswith("Title:"):
                current["title"] = line[len("Title:"):].strip()
            elif line.startswith("URL:"):
                current["url"] = line[len("URL:"):].strip()
            elif line.startswith("Content:"):
                current["snippet"] = line[len("Content:"):].strip()
            else:
                # Content 正文可能跨行，续接到摘要上
                current["snippet"] = f"{current['snippet']} {line}".strip()

        if current:
            docs.append(current)

        # 没有正文的条目对后续 rerank 没有价值，直接丢弃
        return [doc for doc in docs if doc["snippet"]]

    async def _mcp_call(self, query):
        search_mcp = MCPServerStreamableHttp(
            name="search_mcp",
            params={
                "url": mcp_config.mcp_base_url,
                "headers": {"Authorization": f"Bearer {mcp_config.api_key}"},
                "timeout": 10,
            },
            cache_tools_list=True,
            max_retry_attempts=3,
        )
        try:
            await search_mcp.connect()

            # 先列出所有可用工具，确认正确名称
            tools = await search_mcp.list_tools()
            for tool in tools:
                logger.info(f"可用工具: {tool.name}")  # 打印出来，看看服务器到底暴露了什么

            # 用真实工具名调用
            result = await search_mcp.call_tool(
                tool_name="webSearch",  # 大概率是这个，看打印结果调整
                arguments={"query": query, "count": 5},
            )
            return result
        finally:
            await search_mcp.cleanup()

if __name__ == "__main__":

    init_state = {
        "rewritten_query": "关于brother HAK180烫金机，如何调节转印温度？"
    }

    # 执行节点的业务调用
    node_web_search_mcp = NodeWebSearchMcp()
    result = node_web_search_mcp(init_state)
    logger.info(serialize_json(result, indent=4))
