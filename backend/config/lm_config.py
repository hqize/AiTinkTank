# config/lm_config.py

from dataclasses import dataclass
from typing import Optional
import os
from dotenv import load_dotenv

load_dotenv()

def _get_optional_bool(name: str) -> Optional[bool]:
    """读取可选布尔型环境变量：未设置时返回 None（表示"不下发该参数"）"""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")

@dataclass
class LLMConfig:
    base_url: str
    api_key : str
    vl_model: str
    llm_model: str
    llm_temperature: float
    # 是否下发 enable_thinking（DashScope/Qwen3 私有参数）。
    # None=不下发（兼容标准 OpenAI 端点），True/False=显式下发
    llm_enable_thinking: Optional[bool] = None

lm_config = LLMConfig(
    base_url=os.getenv("OPENAI_BASE_URL"),
    api_key=os.getenv("OPENAI_API_KEY"),
    vl_model=os.getenv("VL_MODEL"),
    llm_model=os.getenv("LLM_DEFAULT_MODEL"),
    llm_temperature=float(os.getenv("LLM_DEFAULT_TEMPERATURE")),
    llm_enable_thinking=_get_optional_bool("LLM_ENABLE_THINKING")
)
