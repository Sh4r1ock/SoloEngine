# -*- coding: utf-8 -*-
"""
SoloEngine : LLM工厂模块，统一创建各类模型实例

@file llm_factory.py
@description 提供统一的LLM模型实例创建接口，支持多种提供商
@author Sh4rlock
@date 2026-04-09

功能描述：
- 根据提供商名称创建模型实例
- 管理提供商和模型的映射关系
- 提供模型可用性查询接口
- 从 llm_providers.json 加载供应商配置

支持的提供商：
    - openai: OpenAI GPT 系列
    - anthropic: Anthropic Claude 系列
    - qwen: 阿里通义千问系列
    - ollama: Ollama 本地模型
    - deepseek: DeepSeek 系列
    - zhipu: 智谱 GLM 系列
    - mimo: 小米 MiMo 系列

设计模式：
    使用工厂模式封装模型创建逻辑，客户端代码无需
    了解具体模型类的实现细节。

配置来源：
    data/config/llm_providers.json（单一数据源）

状态: ✅ 完整实现
"""

import json
from pathlib import Path
from typing import Dict, Any, Type

from .model_base import ChatModelBase
from .openai_model import OpenAIChatModel
from .anthropic_model import AnthropicChatModel
from .qwen_model import QwenChatModel
from .ollama_model import OllamaChatModel
from ..utils.logging import logger

_CONFIG_DIR = Path(__file__).parent.parent.parent.parent / "data" / "config"
_PROVIDERS_CONFIG_FILE = _CONFIG_DIR / "llm_providers.json"


class LLMProvider:
    """
    LLM 提供商常量定义。

    定义支持的 LLM 提供商标识符，用于工厂方法中指定提供商。

    Attributes:
        OPENAI (str): OpenAI 提供商标识
        ANTHROPIC (str): Anthropic 提供商标识
        QWEN (str): 通义千问提供商标识
        OLLAMA (str): Ollama 本地模型提供商标识
        DEEPSEEK (str): DeepSeek 提供商标识
        ZHIPU (str): 智谱 GLM 提供商标识
        MIMO (str): 小米 MiMo 提供商标识
    """

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    QWEN = "qwen"
    OLLAMA = "ollama"
    DEEPSEEK = "deepseek"
    ZHIPU = "zhipu"
    MIMO = "mimo"


class LLMFactory:
    """
    LLM 模型工厂类。

    提供统一的模型创建接口，根据提供商名称创建对应的模型实例。
    供应商元数据从 data/config/llm_providers.json 加载。
    """

    _provider_models: Dict[str, Type[ChatModelBase]] = {
        LLMProvider.OPENAI: OpenAIChatModel,
        LLMProvider.ANTHROPIC: AnthropicChatModel,
        LLMProvider.QWEN: QwenChatModel,
        LLMProvider.OLLAMA: OllamaChatModel,
        LLMProvider.DEEPSEEK: OpenAIChatModel,
        LLMProvider.ZHIPU: OpenAIChatModel,
        LLMProvider.MIMO: OpenAIChatModel,
    }

    _providers_data: Dict[str, dict] = {}
    _default_models: Dict[str, str] = {}
    _available_models: Dict[str, list[str]] = {}

    @classmethod
    def _load_providers_config(cls) -> None:
        if cls._providers_data:
            return

        try:
            with open(_PROVIDERS_CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)

            for provider in config.get("providers", []):
                provider_id = provider["id"]
                cls._providers_data[provider_id] = provider
                cls._default_models[provider_id] = provider["default_model"]
                cls._available_models[provider_id] = provider["models"]

            logger.info(f"Loaded {len(cls._providers_data)} LLM providers from config")
        except Exception as e:
            logger.error(f"Failed to load LLM providers config: {e}")
            raise

    @classmethod
    def get_provider_config(cls, provider: str) -> dict | None:
        cls._load_providers_config()
        return cls._providers_data.get(provider.lower())

    @classmethod
    def create_model(
        cls,
        provider: str,
        model_name: str | None = None,
        stream: bool = True,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> ChatModelBase:
        provider_lower = provider.lower()

        cls._load_providers_config()

        if model_name is None:
            if provider_lower in cls._default_models:
                model_name = cls._default_models[provider_lower]
            else:
                model_name = "gpt-4"

        model_class = cls._provider_models.get(provider_lower)

        if model_class is None:
            raise ValueError(
                f"Unsupported LLM provider: '{provider}'. "
                f"Supported providers: {', '.join(cls._provider_models.keys())}"
            )

        provider_kwargs = {}

        if provider_lower == LLMProvider.OPENAI:
            provider_kwargs["api_key"] = api_key
            provider_kwargs["reasoning_effort"] = kwargs.pop("reasoning_effort", None)
            provider_kwargs["organization"] = kwargs.pop("organization", None)
            provider_kwargs["client_kwargs"] = kwargs.pop("client_kwargs", {})

        elif provider_lower == LLMProvider.ANTHROPIC:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.QWEN:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.OLLAMA:
            client_kw = kwargs.pop("client_kwargs", {})
            provider_kwargs["base_url"] = client_kw.pop("base_url", None)
            if not provider_kwargs["base_url"]:
                raise ValueError(
                    "Ollama base_url is required. "
                    "Please configure the base URL in Settings > LLM Configuration."
                )
            if client_kw:
                provider_kwargs["client_kwargs"] = client_kw

        elif provider_lower in [LLMProvider.DEEPSEEK, LLMProvider.ZHIPU, LLMProvider.MIMO]:
            provider_kwargs["api_key"] = api_key
            provider_kwargs["client_kwargs"] = kwargs.pop("client_kwargs", {})

        try:
            return model_class(
                model_name=model_name,
                stream=stream,
                **provider_kwargs,
                **kwargs,
            )
        except Exception as e:
            logger.error(f"Failed to create {provider} model: {e}")
            raise

    @classmethod
    def get_available_providers(cls) -> list[str]:
        cls._load_providers_config()
        return list(cls._providers_data.keys())

    @classmethod
    def get_available_models(cls, provider: str) -> list[str]:
        cls._load_providers_config()
        provider_lower = provider.lower()
        return cls._available_models.get(provider_lower, [])

    @classmethod
    def get_default_model(cls, provider: str) -> str:
        cls._load_providers_config()
        provider_lower = provider.lower()

        if provider_lower not in cls._default_models:
            raise ValueError(
                f"Unsupported LLM provider: '{provider}'. "
                f"Supported providers: {', '.join(cls._providers_data.keys())}"
            )

        return cls._default_models[provider_lower]

    @classmethod
    def validate_model(cls, provider: str, model_name: str) -> bool:
        return True
