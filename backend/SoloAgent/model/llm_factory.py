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

支持的提供商：
    - openai: OpenAI GPT 系列
    - anthropic: Anthropic Claude 系列
    - qwen: 阿里通义千问系列
    - ollama: Ollama 本地模型

设计模式：
    使用工厂模式封装模型创建逻辑，客户端代码无需
    了解具体模型类的实现细节。

使用场景：
    - 从配置文件动态创建模型
    - 切换不同提供商的模型
    - 查询可用模型列表

状态: ✅ 完整实现
"""

from typing import Literal, Dict, Any, Type

from .model_base import ChatModelBase
from .openai_model import OpenAIChatModel
from .anthropic_model import AnthropicChatModel
from .qwen_model import QwenChatModel
from .ollama_model import OllamaChatModel
from ..utils.logging import logger


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
    
    Example:
        >>> provider = LLMProvider.OPENAI
        >>> model = LLMFactory.create_model(provider, api_key="...")
    """

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    QWEN = "qwen"
    OLLAMA = "ollama"
    DEEPSEEK = "deepseek"
    ZHIPU = "zhipu"


class LLMFactory:
    """
    LLM 模型工厂类。
    
    提供统一的模型创建接口，根据提供商名称创建对应的模型实例。
    支持查询可用提供商和模型列表。
    
    核心功能：
        1. 模型实例创建：create_model()
        2. 提供商查询：get_available_providers()
        3. 模型列表查询：get_available_models()
        4. 模型验证：validate_model()
    
    支持的提供商：
        - openai: GPT-4, GPT-3.5, GPT-4o, o3-mini 等
        - anthropic: Claude 3 系列（Opus, Sonnet, Haiku）
        - qwen: 通义千问系列（Plus, Turbo, Max, Long）
        - ollama: 本地模型（Llama, Mistral, Gemma 等）
    
    Example:
        >>> # 创建 OpenAI 模型
        >>> model = LLMFactory.create_model(
        ...     provider="openai",
        ...     model_name="gpt-4",
        ...     api_key="sk-..."
        ... )
        >>> 
        >>> # 创建 Ollama 本地模型
        >>> model = LLMFactory.create_model(
        ...     provider="ollama",
        ...     model_name="llama2",
        ...     base_url="http://localhost:11434"
        ... )
        >>> 
        >>> # 查询可用模型
        >>> models = LLMFactory.get_available_models("openai")
        >>> print(models)  # ['gpt-4', 'gpt-4-turbo', ...]
    
    Note:
        - 工厂方法都是类方法，无需实例化
        - 未指定模型名时使用默认模型
        - 创建失败会抛出异常
    """

    _provider_models: Dict[str, Type[ChatModelBase]] = {
        LLMProvider.OPENAI: OpenAIChatModel,
        LLMProvider.ANTHROPIC: AnthropicChatModel,
        LLMProvider.QWEN: QwenChatModel,
        LLMProvider.OLLAMA: OllamaChatModel,
        LLMProvider.DEEPSEEK: OpenAIChatModel,
        LLMProvider.ZHIPU: OpenAIChatModel,
    }
    """提供商到模型类的映射字典"""

    _default_models: Dict[str, str] = {
        LLMProvider.OPENAI: "gpt-4",
        LLMProvider.ANTHROPIC: "claude-3-5-sonnet-20241022",
        LLMProvider.QWEN: "qwen-plus",
        LLMProvider.OLLAMA: "llama2",
        LLMProvider.DEEPSEEK: "deepseek-chat",
        LLMProvider.ZHIPU: "glm-4",
    }
    """各提供商的默认模型"""

    _available_models: Dict[str, list[str]] = {
        LLMProvider.OPENAI: [
            "gpt-4",
            "gpt-4-turbo",
            "gpt-4-turbo-preview",
            "gpt-3.5-turbo",
            "gpt-3.5-turbo-preview",
            "o3-mini",
            "o3-mini-turbo",
            "gpt-4o",
            "gpt-4o-mini",
        ],
        LLMProvider.ANTHROPIC: [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-sonnet-20240620",
            "claude-3-opus-20240229",
            "claude-3-haiku-20240307",
        ],
        LLMProvider.QWEN: [
            "qwen-plus",
            "qwen-turbo",
            "qwen-turbo",
            "qwen-long",
            "qwen-max",
            "qwen-max-longcontext",
        ],
        LLMProvider.OLLAMA: [
            "llama2",
            "llama3",
            "llama3.1",
            "llama2:70b",
            "llama2:13b",
            "mistral",
            "gemma:2b",
            "gemma:7b",
        ],
        LLMProvider.DEEPSEEK: [
            "deepseek-chat",
            "deepseek-coder",
            "deepseek-reasoner",
        ],
        LLMProvider.ZHIPU: [
            "glm-4",
            "glm-4-plus",
            "glm-4-air",
            "glm-4-flash",
        ],
    }
    """各提供商的可用模型列表"""

    @classmethod
    def create_model(
        cls,
        provider: str,
        model_name: str | None = None,
        stream: bool = True,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> ChatModelBase:
        """
        根据提供商创建模型实例。
        
        这是工厂的主要方法，根据提供商名称创建对应的模型实例。
        支持自动选择默认模型和提供商特定参数处理。
        
        Args:
            provider (str): 提供商名称，支持：
                - "openai": OpenAI GPT 系列
                - "anthropic": Anthropic Claude 系列
                - "qwen": 通义千问系列
                - "ollama": Ollama 本地模型
            model_name (str | None): 模型名称。如果未指定，
                使用该提供商的默认模型。默认为 None。
            stream (bool): 是否启用流式输出。默认为 True。
            api_key (str | None): API 密钥。
                - OpenAI/Anthropic/Qwen: 必需
                - Ollama: 不需要
            **kwargs: 提供商特定参数，如：
                - OpenAI: organization, reasoning_effort
                - Ollama: base_url
        
        Returns:
            ChatModelBase: 创建的模型实例。
        
        Raises:
            ValueError: 当提供商不支持时抛出。
            Exception: 当模型创建失败时抛出。
        
        Example:
            >>> # 使用默认模型
            >>> model = LLMFactory.create_model("openai", api_key="sk-...")
            >>> 
            >>> # 指定模型
            >>> model = LLMFactory.create_model(
            ...     "anthropic",
            ...     model_name="claude-3-opus-20240229",
            ...     api_key="..."
            ... )
            >>> 
            >>> # Ollama 本地模型
            >>> model = LLMFactory.create_model(
            ...     "ollama",
            ...     model_name="llama2",
            ...     base_url="http://localhost:11434"
            ... )
        
        Note:
            - 提供商名称不区分大小写
            - 未指定模型名时使用默认模型
            - 创建失败会记录错误日志并重新抛出异常
        """
        provider_lower = provider.lower()

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
            provider_kwargs["reasoning_effort"] = kwargs.get("reasoning_effort")
            provider_kwargs["organization"] = kwargs.get("organization")
            base_url = kwargs.pop("base_url", None)
            if base_url:
                provider_kwargs["client_kwargs"] = {"base_url": base_url}

        elif provider_lower == LLMProvider.ANTHROPIC:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.QWEN:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.OLLAMA:
            provider_kwargs["base_url"] = kwargs.get("base_url", "http://localhost:11434")

        elif provider_lower in [LLMProvider.DEEPSEEK, LLMProvider.ZHIPU]:
            provider_kwargs["api_key"] = api_key
            base_url = kwargs.pop("base_url", None)
            if base_url:
                provider_kwargs["client_kwargs"] = {"base_url": base_url}

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
        """
        获取可用的 LLM 提供商列表。
        
        Returns:
            list[str]: 提供商名称列表，如 ['openai', 'anthropic', 'qwen', 'ollama']。
        
        Example:
            >>> providers = LLMFactory.get_available_providers()
            >>> print(providers)  # ['openai', 'anthropic', 'qwen', 'ollama']
        """
        return list(cls._provider_models.keys())

    @classmethod
    def get_available_models(cls, provider: str) -> list[str]:
        """
        获取指定提供商的可用模型列表。
        
        Args:
            provider (str): 提供商名称。
        
        Returns:
            list[str]: 该提供商支持的模型名称列表。对于未知的提供商返回空列表。
        
        Example:
            >>> models = LLMFactory.get_available_models("openai")
            >>> print(models)  # ['gpt-4', 'gpt-4-turbo', ...]
        
        Note:
            返回的列表可能不是完整的，实际可用模型取决于 API 密钥权限。
            对于未知的提供商，返回空列表而非抛出异常。
        """
        provider_lower = provider.lower()
        return cls._available_models.get(provider_lower, [])

    @classmethod
    def get_default_model(cls, provider: str) -> str:
        """
        获取指定提供商的默认模型。
        
        Args:
            provider (str): 提供商名称。
        
        Returns:
            str: 默认模型名称。
        
        Raises:
            ValueError: 当提供商不支持时抛出。
        
        Example:
            >>> default = LLMFactory.get_default_model("openai")
            >>> print(default)  # 'gpt-4'
        """
        provider_lower = provider.lower()

        if provider_lower not in cls._default_models:
            raise ValueError(
                f"Unsupported LLM provider: '{provider}'. "
                f"Supported providers: {', '.join(cls._provider_models.keys())}"
            )

        return cls._default_models[provider_lower]

    @classmethod
    def validate_model(cls, provider: str, model_name: str) -> bool:
        """
        验证模型是否在提供商的可用列表中。
        
        修改后：始终返回 True，允许使用任意模型名称（包括自定义模型、新模型等）
        实际可用性由 API 调用时决定。
        
        Args:
            provider (str): 提供商名称。
            model_name (str): 模型名称。
        
        Returns:
            bool: 始终返回 True，允许任意模型名称。
        
        Example:
            >>> LLMFactory.validate_model("openai", "gpt-4")  # True
            >>> LLMFactory.validate_model("openai", "custom-model")  # True
        
        Note:
            此方法不再限制模型名称，允许用户输入任意模型。
            实际可用性由 API 调用时决定。
        """
        # 不再限制模型名称，允许用户输入任意模型
        # 实际可用性由 API 调用时决定
        return True
