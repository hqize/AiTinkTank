# config/web_search_config.py

"""
    联网搜索配置

    支持两种实现（两套代码都保留，可随时切换对比）：
      mcp —— 走外部 MCP 服务（百度千帆 webSearch），实现见 nodes/node_web_search_mcp.py
      llm —— 用大模型自带的联网工具（OpenAI Responses API 的 web_search），
             实现见 nodes/node_web_search_llm.py
      off —— 关闭联网搜索
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

# 提供商取值：mcp / llm / off
PROVIDER_MCP = "mcp"
PROVIDER_LLM = "llm"
PROVIDER_OFF = "off"


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except (TypeError, ValueError):
        return default


@dataclass
class WebSearchConfig:
    provider: str  # 默认实现：mcp / llm / off
    llm_model: str  # llm 实现使用的模型
    llm_tool_type: str  # llm 实现的工具类型：web_search（GA）/ web_search_preview（预览）
    llm_max_results: int  # llm 实现最多保留多少条引用来源


web_search_config = WebSearchConfig(
    provider=(os.getenv("WEB_SEARCH_PROVIDER") or PROVIDER_MCP).strip().lower(),
    llm_model=os.getenv("WEB_SEARCH_LLM_MODEL") or os.getenv("LLM_DEFAULT_MODEL"),
    llm_tool_type=os.getenv("WEB_SEARCH_LLM_TOOL_TYPE") or "web_search",
    llm_max_results=_get_int("WEB_SEARCH_MAX_RESULTS", 5),
)
