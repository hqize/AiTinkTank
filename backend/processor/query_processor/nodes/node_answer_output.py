# processor/query_processor/nodes/node_answer_output.py

import json
import re
from typing import Any, Dict, List, Tuple

from langchain_core.messages import HumanMessage, SystemMessage

from processor.query_processor.base import NodeBase
from processor.query_processor.prompt.answer_output import (
    ALLOW_GENERAL_KNOWLEDGE_ANSWER,
    ANSWER_SYSTEM_PROMPT,
    ANSWER_TEMPLATE,
    GENERAL_ANSWER_LABEL,
    GENERAL_SYSTEM_PROMPT,
    GENERAL_TEMPLATE,
    IMAGE_MARKER,
    MAX_DOC_CHARS,
    MAX_DOCS,
    MAX_HISTORY_MESSAGES,
    NO_CONTEXT_ANSWER,
)
from processor.query_processor.state import QueryGraphState
from tool.logger import logger
from utils.llm_utils import get_llm_client
from utils.mongo_history_utils import save_chat_message
from utils.sse_utils import SSEEvent, push_to_session
from utils.task_utils import set_task_result

# 参考资料里 Markdown 形式的图片：![描述](url)
_MD_IMAGE_PATTERN = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
# 参考资料里的裸图片链接
_RAW_IMAGE_PATTERN = re.compile(
    r"https?://[^\s)\]<>\"']+\.(?:png|jpe?g|gif|webp|bmp|svg)", re.IGNORECASE
)


class NodeAnswerOutput(NodeBase):
    """
        节点功能: 答案生成

        职责：
        1. 上游已给出答案（反问用户 / 未找到产品）时，直接把该答案透出，不再调用大模型
        2. 否则用 reranked_docs 组装参考资料调用大模型生成答案
        3. 流式模式下逐段推送 delta 事件，最后统一推送 final 事件
        4. 把答案写入任务结果（非流式接口读取）与Mongo历史
    """

    # 覆盖基类的 name 属性，标识节点名称
    name: str = "node_answer_output"

    def process(self, state: QueryGraphState) -> QueryGraphState:
        """
            节点逻辑
            :param state: 工作流状态对象
            :return: 更新后的状态对象
        """

        # 1. 上游（node_item_name_confirm）已经给出答案：多选一反问 / 未找到产品
        #    这类答案不需要检索资料，也不需要再调用大模型
        preset_answer = str(state.get("answer") or "").strip()
        if preset_answer:
            logger.info("上游已生成答案（反问或兜底话术），跳过答案生成")
            state["answer"] = preset_answer
            # 历史已由 node_item_name_confirm 写入，这里不再重复写
            self._publish(state, preset_answer, [], save_history=False)
            return state

        # 2. 组装参考资料，并抽取资料中的图片链接
        reranked_docs: List[Dict[str, Any]] = [
            doc for doc in (state.get("reranked_docs") or []) if isinstance(doc, dict)
        ]
        context_text, image_urls = self._build_context(reranked_docs)

        # 3. 知识库与联网检索都没有返回可用资料
        #    默认允许用大模型通用知识兜底作答（答案带显式标注），
        #    这样"你好""帮我写一首诗""小米15怎么设置"这类库外问题也能有回应，
        #    而不是一律回一句"未找到相关产品"。
        if not context_text:
            if ALLOW_GENERAL_KNOWLEDGE_ANSWER:
                logger.info("未检索到参考资料，改用通用知识兜底作答（答案会带来源标注）")
                general_answer = self._generate_general_answer(state)
                if general_answer:
                    answer = f"{GENERAL_ANSWER_LABEL}\n\n{general_answer}"
                    state["answer"] = answer
                    self._publish(state, answer, [], save_history=True)
                    return state
                logger.warning("通用知识兜底也未返回内容")

            logger.info("未检索到任何参考资料，返回兜底话术")
            state["answer"] = NO_CONTEXT_ANSWER
            self._publish(state, NO_CONTEXT_ANSWER, [], save_history=True)
            return state

        # 4. 调用大模型生成答案（流式模式会边生成边推送）
        answer = self._generate_answer(state, context_text, reranked_docs)

        # 5. 生成失败时给出可读的兜底，避免前端出现空白答案
        if not answer:
            logger.warning("大模型未返回任何内容，使用兜底话术")
            answer = "抱歉，本次未能生成回答，请稍后重试或换个问法。"

        # 6. 透出最终答案 + 写入历史
        state["answer"] = answer
        self._publish(state, answer, image_urls, save_history=True)
        return state

    # ------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------

    def _build_context(self, docs: List[Dict[str, Any]]) -> Tuple[str, List[str]]:
        """
            把重排后的文档组装成给大模型看的参考资料文本，并抽取其中的图片链接。

            :param docs: reranked_docs，元素形如
                         {"content": ..., "title": ..., "url": ..., "source": "local"/"web", "score": ...}
            :return: (参考资料文本, 图片URL列表)
        """
        blocks: List[str] = []
        image_urls: List[str] = []

        for idx, doc in enumerate(docs[:MAX_DOCS], start=1):
            content = str(doc.get("content") or "").strip()
            if not content:
                continue

            title = str(doc.get("title") or "").strip() or f"资料{idx}"
            source = "网络" if doc.get("source") == "web" else "知识库"
            url = str(doc.get("url") or "").strip()
            source_desc = f"{source}，{url}" if url else source

            blocks.append(f"[{idx}] 标题：{title}（来源：{source_desc}）\n{content[:MAX_DOC_CHARS]}")

            for image_url in self._extract_image_urls(content):
                if image_url not in image_urls:
                    image_urls.append(image_url)

        return "\n\n".join(blocks), image_urls

    @staticmethod
    def _extract_image_urls(text: str) -> List[str]:
        """从文本中抽取图片链接（Markdown 图片语法 + 裸图片链接）"""
        found = _MD_IMAGE_PATTERN.findall(text or "")
        found += _RAW_IMAGE_PATTERN.findall(text or "")

        result: List[str] = []
        for url in found:
            if url and url not in result:
                result.append(url)
        return result

    def _generate_answer(
        self,
        state: QueryGraphState,
        context_text: str,
        docs: List[Dict[str, Any]],
    ) -> str:
        """
            基于检索到的参考资料生成答案。
        """
        user_prompt = ANSWER_TEMPLATE.format(
            context_text=context_text,
            history_text=self._format_history(state.get("history") or []),
            query=state.get("rewritten_query") or state.get("original_query") or "",
        )
        messages = [
            SystemMessage(content=ANSWER_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]
        return self._invoke_llm(state, messages)

    def _generate_general_answer(self, state: QueryGraphState) -> str:
        """
            知识库与联网检索都没有可用资料时，用大模型自身知识作答（不带参考资料）。
        """
        user_prompt = GENERAL_TEMPLATE.format(
            history_text=self._format_history(state.get("history") or []),
            query=state.get("rewritten_query") or state.get("original_query") or "",
        )
        messages = [
            SystemMessage(content=GENERAL_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]
        return self._invoke_llm(state, messages)

    def _invoke_llm(self, state: QueryGraphState, messages: List) -> str:
        """
            统一的模型调用：流式模式（is_stream=True 且有 session_id）用 stream() 逐段推送 delta；
            其余情况（含流式调用失败）退化为一次性 invoke。

            :return: 生成的答案文本，失败时返回空字符串
        """
        try:
            llm = get_llm_client()
        except Exception as e:
            logger.error(f"大模型客户端初始化失败：{e}")
            return ""

        session_id = state.get("session_id")
        is_stream = bool(state.get("is_stream"))

        # 流式：边生成边把增量推给前端
        if is_stream and session_id:
            try:
                parts: List[str] = []
                for chunk in llm.stream(messages):
                    delta = self._message_text(chunk)
                    if not delta:
                        continue
                    parts.append(delta)
                    push_to_session(session_id, SSEEvent.DELTA, {"delta": delta})

                answer = "".join(parts).strip()
                if answer:
                    return answer
                logger.warning("流式生成内容为空，退化为非流式调用")
            except Exception as e:
                logger.error(f"流式生成失败，退化为非流式调用：{e}")

        # 非流式（或流式失败回退）
        try:
            response = llm.invoke(messages)
            return self._message_text(response).strip()
        except Exception as e:
            logger.error(f"答案生成失败：{e}")
            return ""

    @staticmethod
    def _format_history(history: List[Dict[str, Any]]) -> str:
        """把历史会话拼成「角色: 内容」文本，只取最近若干条"""
        lines: List[str] = []
        for msg in (history or [])[-MAX_HISTORY_MESSAGES:]:
            if not isinstance(msg, dict):
                continue
            role = "用户" if msg.get("role") == "user" else "助手"
            text = str(msg.get("text") or "").strip()
            if text:
                lines.append(f"{role}: {text}")
        return "\n".join(lines) if lines else "（无）"

    @staticmethod
    def _message_text(message: Any) -> str:
        """兼容 content 为字符串 / 多段列表两种返回结构，统一取出文本"""
        content = getattr(message, "content", message)

        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and item.get("type") == "text":
                    parts.append(str(item.get("text") or ""))
            return "".join(parts)
        return str(content or "")

    def _publish(
        self,
        state: QueryGraphState,
        answer: str,
        image_urls: List[str],
        save_history: bool,
    ) -> None:
        """
            把答案透出给上层：

            1. 写入内存任务结果，供非流式 /query 接口与 /status 读取
            2. 图片以【图片】标记追加到答案末尾（顺手兼容只解析文本的前端）
            3. 流式模式下推送 final 事件，前端据此结束 SSE 连接
            4. 需要时把助手答案写入Mongo历史
        """
        session_id = state.get("session_id")
        is_stream = bool(state.get("is_stream"))
        image_urls = image_urls or []

        final_answer = answer
        if image_urls and IMAGE_MARKER not in final_answer:
            image_block = IMAGE_MARKER + "\n" + "\n".join(image_urls)
            final_answer = f"{final_answer}\n\n{image_block}"
        state["answer"] = final_answer

        if session_id:
            # 1+2. 任务结果（非流式接口读取）
            set_task_result(session_id, "answer", final_answer)
            set_task_result(session_id, "image_urls", json.dumps(image_urls, ensure_ascii=False))

            # 3. 流式：推送最终完整答案
            if is_stream:
                push_to_session(
                    session_id,
                    SSEEvent.FINAL,
                    {"answer": final_answer, "image_urls": image_urls},
                )

            # 4. 写入历史（反问/兜底分支上游已经写过，避免重复）
            if save_history and final_answer:
                try:
                    save_chat_message(
                        session_id=session_id,
                        role="assistant",
                        text=final_answer,
                        item_names=state.get("item_names") or [],
                        image_urls=image_urls,
                    )
                except Exception as e:
                    logger.warning(f"助手答案写入历史失败：{e}")
