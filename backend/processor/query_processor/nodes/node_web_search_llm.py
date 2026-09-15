# processor/query_processor/nodes/node_web_search_llm.py

"""
    联网搜索实现二：使用大模型自带的联网工具

    与 node_web_search_mcp.py（走外部 MCP 服务）并列，两者输出格式完全一致
    （都是 [{title, url, snippet}]），因此下游的重排 / 答案生成节点无需改动，
    方便直接对比两种联网方案的召回质量与耗时。

    实现要点：
      调用 OpenAI Responses API，并挂载内置的 web_search 工具；
      模型会自己发起搜索，并把引用来源放在 output_text 的 url_citation 注解里。
      这里把每条引用还原成一条文档（标题 + URL + 引用上下文句子），供 RAG 管线使用。
"""

from typing import Any, Dict, List

from openai import OpenAI

from config.lm_config import lm_config
from config.web_search_config import web_search_config
from processor.query_processor.base import NodeBase
from processor.query_processor.state import QueryGraphState
from tool.logger import logger

# 单条摘要最大长度
MAX_SNIPPET_CHARS = 300


class NodeWebSearchLlm(NodeBase):
    """
        节点功能：调用大模型自带的联网搜索能力补充信息
    """

    name: str = "node_web_search_llm"

    def __init__(self):
        self._client: OpenAI | None = None

    def process(self, state: QueryGraphState) -> QueryGraphState:
        query = state.get("rewritten_query") or state.get("original_query") or ""
        docs = self.search(query) if query else []
        return {"web_search_docs": docs} if docs else {}

    # ------------------------------------------------------------------
    # 核心：调用内置联网
    # ------------------------------------------------------------------

    def search(self, query: str) -> List[Dict[str, Any]]:
        """
            用大模型自带的联网工具检索并解析出文档列表。

            :param query: 查询语句
            :return: [{title, url, snippet}, ...]，失败返回空列表
        """
        try:
            client = self._get_client()
            response = client.responses.create(
                model=web_search_config.llm_model,
                tools=[{"type": web_search_config.llm_tool_type}],
                input=query,
            )
        except Exception as e:
            logger.warning(f"大模型内置联网搜索调用失败：{e}")
            return []

        return self._parse_docs(response)

    def _get_client(self) -> OpenAI:
        """惰性创建 OpenAI 客户端（同一个客户端可复用连接）"""
        if self._client is None:
            self._client = OpenAI(
                api_key=lm_config.api_key,
                base_url=lm_config.base_url,
                timeout=60,
            )
        return self._client

    def _parse_docs(self, response: Any) -> List[Dict[str, Any]]:
        """
            把 Responses API 的返回解析成 [{title, url, snippet}]。

            解析规则：
              1. 优先用 output_text 里的 url_citation 注解（每条引用 = 一个来源），
                 摘要取"引用位置所在的那句话"；
              2. 没有任何引用时，退化为把模型整理后的整段回答当作一条文档，
                 保证下游仍然有内容可用。
        """
        docs: List[Dict[str, Any]] = []
        seen_urls: set[str] = set()
        fallback_texts: List[str] = []

        for item in getattr(response, "output", None) or []:
            for content in getattr(item, "content", None) or []:
                text = getattr(content, "text", None)
                if text:
                    fallback_texts.append(text)

                for annotation in getattr(content, "annotations", None) or []:
                    if getattr(annotation, "type", None) != "url_citation":
                        continue

                    url = str(getattr(annotation, "url", "") or "")
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)

                    docs.append({
                        "title": str(getattr(annotation, "title", "") or url),
                        "url": url,
                        "snippet": self._snippet_at(
                            text or "",
                            getattr(annotation, "start_index", None),
                            getattr(annotation, "end_index", None),
                        ),
                    })
                    if len(docs) >= web_search_config.llm_max_results:
                        return docs

        if docs:
            return docs

        # 没有任何引用：把模型整理后的回答整体作为一条文档
        answer_text = (getattr(response, "output_text", "") or "").strip()
        if not answer_text:
            answer_text = "\n".join(fallback_texts).strip()

        if answer_text:
            logger.info("内置联网未返回引用来源，退化为一整段结果参与后续处理")
            return [{
                "title": "大模型联网搜索结果",
                "url": "",
                "snippet": answer_text[:MAX_SNIPPET_CHARS * 4],
            }]

        return []

    @staticmethod
    def _snippet_at(text: str, start: Any, end: Any) -> str:
        """
            取引用标注位置所在的那句话作为摘要。

            :param text: 模型输出的完整文本
            :param start: 引用起始下标
            :param end: 引用结束下标
            :return: 摘要文本
        """
        if not text or start is None or end is None:
            return text[:MAX_SNIPPET_CHARS].strip()

        try:
            start = int(start)
            end = int(end)
        except (TypeError, ValueError):
            return text[:MAX_SNIPPET_CHARS].strip()

        # 向前找到最近的分句符号，向后找到最近的分句符号，取中间那句
        left_bound = 0
        for sep in ("\n", "。", "；", "！", "？"):
            idx = text.rfind(sep, 0, start)
            if idx != -1:
                left_bound = max(left_bound, idx + 1)

        right_bound = len(text)
        for sep in ("\n", "。", "；", "！", "？"):
            idx = text.find(sep, end)
            if idx != -1:
                right_bound = min(right_bound, idx)

        snippet = text[left_bound:right_bound].strip()
        return (snippet or text[:MAX_SNIPPET_CHARS]).strip()[:MAX_SNIPPET_CHARS]
