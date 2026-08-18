"""模型上下文窗口映射表。

提供从 provider + model_name 到 (max_input_tokens, max_output_tokens) 的映射。
"""
from typing import Optional, Tuple


# provider -> model_name -> (max_input_tokens, max_output_tokens)
_CONTEXT_LIMITS: dict[str, dict[str, Tuple[Optional[int], Optional[int]]]] = {
    "openai": {
        # GPT-4o / GPT-4o-mini (2024+)
        "gpt-4o": (128000, 4096),
        "gpt-4o-mini": (128000, 4096),
        # GPT-4 Turbo / GPT-4
        "gpt-4-turbo": (128000, 4096),
        "gpt-4-turbo-preview": (128000, 4096),
        "gpt-4-1106-preview": (128000, 4096),
        "gpt-4-0125-preview": (128000, 4096),
        "gpt-4": (8192, 4096),
        "gpt-4-32k": (32768, 4096),
        # GPT-3.5
        "gpt-3.5-turbo": (16385, 4096),
        "gpt-3.5-turbo-16k": (16385, 4096),
        "gpt-3.5-turbo-1106": (16385, 4096),
        "gpt-3.5-turbo-0125": (16385, 4096),
        # o1 / o3 mini (2024-2025) — 使用较高的默认值
        "o1": (128000, 32768),
        "o1-mini": (128000, 65536),
        "o3-mini": (200000, 100000),
        # GPT-5 系列 (2025+)
        "gpt-5": (256000, 4096),
        "gpt-5.4": (272000, 4096),
        "gpt-5.4-mini": (400000, 128000),
        "gpt-5.4-nano": (400000, 128000),
        "gpt-5.5": (1000000, 4096),
    },
    "anthropic": {
        "claude-3-opus": (200000, 4096),
        "claude-3-sonnet": (200000, 4096),
        "claude-3-haiku": (200000, 4096),
        "claude-3-5-sonnet": (200000, 4096),
        "claude-3-5-haiku": (200000, 4096),
        "claude-4-sonnet": (200000, 4096),
        "claude-4-opus": (200000, 4096),
        "claude-4-6-sonnet": (1000000, 4096),
        "claude-4-6-opus": (1000000, 4096),
        "claude-4-8-sonnet": (1000000, 4096),
        "claude-4-8-opus": (1000000, 4096),
        "claude-opus-4-6": (1000000, 4096),
        "claude-sonnet-4-6": (1000000, 4096),
        "claude-opus-4-8": (1000000, 4096),
        "claude-sonnet-4-8": (1000000, 4096),
    },
    "google": {
        "gemini-1.5-pro": (1000000, 8192),
        "gemini-1.5-flash": (1000000, 8192),
        "gemini-2.0-pro": (1000000, 8192),
        "gemini-2.5-pro": (1000000, 8192),
        "gemini-3.0-pro": (1000000, 8192),
        "gemini-3.1-pro": (1000000, 8192),
        "gemini-3-flash": (1000000, 8192),
    },
    "deepseek": {
        "deepseek-chat": (65536, 4096),
        "deepseek-reasoner": (65536, 4096),
        "deepseek-coder": (65536, 4096),
        "deepseek-v3": (128000, 4096),
        "deepseek-v3-2": (128000, 4096),
        "deepseek-r1": (128000, 4096),
    },
    "qwen": {
        "qwen-turbo": (8192, 4096),
        "qwen-plus": (131072, 4096),
        "qwen-max": (32768, 4096),
        "qwen-72b-chat": (32768, 4096),
        "qwen-3": (128000, 4096),
        "qwen-3.5": (256000, 4096),
    },
    "moonshot": {
        "moonshot-v1-8k": (8192, 4096),
        "moonshot-v1-32k": (32768, 4096),
        "moonshot-v1-128k": (128000, 4096),
        "kimi-k2.5": (256000, 4096),
    },
    "mistral": {
        "mistral-tiny": (32768, 4096),
        "mistral-small": (32768, 4096),
        "mistral-medium": (32768, 4096),
        "mistral-large": (128000, 4096),
        "mistral-large-3": (256000, 4096),
    },
    "meta": {
        "llama-3-8b": (8192, 4096),
        "llama-3-70b": (8192, 4096),
        "llama-3.1-8b": (128000, 4096),
        "llama-3.1-70b": (128000, 4096),
        "llama-4-scout": (10000000, 4096),
        "llama-4-maverick": (1000000, 4096),
    },
    "ollama": {
        # ollama 模型名称通常与 open source 模型相同，使用通用默认值
    },
}

# 当 provider 映射中找不到具体模型时，按 provider 使用的默认兜底
_PROVIDER_DEFAULTS: dict[str, Tuple[Optional[int], Optional[int]]] = {
    "openai": (128000, 4096),
    "anthropic": (200000, 4096),
    "google": (1000000, 8192),
    "deepseek": (65536, 4096),
    "qwen": (131072, 4096),
    "moonshot": (128000, 4096),
    "mistral": (128000, 4096),
    "meta": (128000, 4096),
    "ollama": (8192, 4096),
}

# 全局默认兜底（当 provider 也未知时）
_GLOBAL_DEFAULT: Tuple[Optional[int], Optional[int]] = (128000, 4096)


def _normalize_provider(provider: str) -> str:
    """统一 provider 大小写和常见别名。"""
    p = (provider or "").lower().strip()
    aliases = {
        "claude": "anthropic",
        "gemini": "google",
        "gpt": "openai",
        "chatgpt": "openai",
        "kimi": "moonshot",
        "llama": "meta",
    }
    return aliases.get(p, p)


def _normalize_model_name(model_name: str) -> str:
    """去掉常见前缀 / 日期后缀，便于匹配。"""
    m = (model_name or "").lower().strip()
    # 常见前缀
    for prefix in ("models/", "openai/", "anthropic/", "google/"):
        if m.startswith(prefix):
            m = m[len(prefix):]
    # 去掉日期后缀如 -2024-05-13
    import re
    m = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", m)
    m = re.sub(r"-\d{4}-\d{2}$", "", m)
    return m


def get_model_context_limit(provider: str, model_name: str) -> Tuple[Optional[int], Optional[int]]:
    """返回 (max_input_tokens, max_output_tokens)。

    匹配规则：
    1. 精确匹配 (provider, model_name)
    2. 按 provider 默认
    3. 全局默认
    """
    p = _normalize_provider(provider)
    m = _normalize_model_name(model_name)

    provider_limits = _CONTEXT_LIMITS.get(p)
    if provider_limits:
        if m in provider_limits:
            return provider_limits[m]
        # 尝试前缀匹配（如 gpt-4o-2024-05-13 仍能匹配 gpt-4o）
        for key, value in provider_limits.items():
            if m.startswith(key):
                return value

    return _PROVIDER_DEFAULTS.get(p, _GLOBAL_DEFAULT)
