# utils/llm_utils.py

from langchain_openai import ChatOpenAI

from config.lm_config import lm_config

_llm_client_cache = {}


def get_llm_client(model: str | None = None, json_mode: bool = False) -> ChatOpenAI:
    """
    获取 LangChain ChatOpenAI 客户端实例
    - model: 允许不同节点使用不同模型
    - json_mode: True 时要求输出 JSON
    """
    m = model or lm_config.llm_model
    key = (m, json_mode)
    if key in _llm_client_cache:
        return _llm_client_cache[key]

    # enable_thinking 是 DashScope/Qwen3 的私有参数：标准 OpenAI 兼容端点
    # （如 api.openai-proxy.org）收到该参数会直接返回
    # 400 Unrecognized request argument，因此仅在显式配置 LLM_ENABLE_THINKING 时才下发。
    llm_kwargs: dict = {}
    if lm_config.llm_enable_thinking is not None:
        llm_kwargs["extra_body"] = {"enable_thinking": lm_config.llm_enable_thinking}

    model_kwargs: dict = {}
    if json_mode:
        model_kwargs["response_format"] = {"type": "json_object"}
    if model_kwargs:
        llm_kwargs["model_kwargs"] = model_kwargs

    client = ChatOpenAI(
        model=m,
        temperature=lm_config.llm_temperature,
        api_key=lm_config.api_key,
        base_url=lm_config.base_url,
        **llm_kwargs,
    )
    _llm_client_cache[key] = client
    return client
