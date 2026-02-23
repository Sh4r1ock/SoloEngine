# -*- coding: utf-8 -*-
"""LLM factory for creating model instances by provider."""
from typing import Literal, Dict, Any, Type

from .model_base import ChatModelBase
from .openai_model import OpenAIChatModel
from .anthropic_model import AnthropicChatModel
from .qwen_model import QwenChatModel
from .ollama_model import OllamaChatModel
from ..utils.logging import logger


class LLMProvider:
    """Supported LLM providers."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    QWEN = "qwen"
    OLLAMA = "ollama"


class LLMFactory:
    """Factory for creating LLM model instances by provider."""

    # Mapping of provider to model class
    _provider_models: Dict[str, Type[ChatModelBase]] = {
        LLMProvider.OPENAI: OpenAIChatModel,
        LLMProvider.ANTHROPIC: AnthropicChatModel,
        LLMProvider.QWEN: QwenChatModel,
        LLMProvider.OLLAMA: OllamaChatModel,
    }

    # Default models for each provider
    _default_models: Dict[str, str] = {
        LLMProvider.OPENAI: "gpt-4",
        LLMProvider.ANTHROPIC: "claude-3-5-sonnet-20241022",
        LLMProvider.QWEN: "qwen-plus",
        LLMProvider.OLLAMA: "llama2",
    }

    # Available models for each provider
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
    }

    @classmethod
    def create_model(
        cls,
        provider: str,
        model_name: str | None = None,
        stream: bool = True,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> ChatModelBase:
        """Create a model instance based on provider.

        Args:
            provider (str): The LLM provider name.
            model_name (str | None): The model name. If not specified,
                uses the default model for the provider.
            stream (bool): Whether to use streaming output.
            api_key (str | None): The API key for the provider.
            **kwargs: Additional keyword arguments to pass to the model.

        Returns:
            ChatModelBase: An instance of the appropriate model class.

        Raises:
            ValueError: If provider is not supported.
        """
        provider_lower = provider.lower()

        # Use default model if not specified
        if model_name is None:
            if provider_lower in cls._default_models:
                model_name = cls._default_models[provider_lower]
            else:
                model_name = "gpt-4"  # Fallback to OpenAI

        # Get model class for provider
        model_class = cls._provider_models.get(provider_lower)

        if model_class is None:
            raise ValueError(
                f"Unsupported LLM provider: '{provider}'. "
                f"Supported providers: {', '.join(cls._provider_models.keys())}"
            )

        # Provider-specific parameters
        provider_kwargs = {}

        if provider_lower == LLMProvider.OPENAI:
            provider_kwargs["api_key"] = api_key
            provider_kwargs["reasoning_effort"] = kwargs.get("reasoning_effort")
            provider_kwargs["organization"] = kwargs.get("organization")

        elif provider_lower == LLMProvider.ANTHROPIC:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.QWEN:
            provider_kwargs["api_key"] = api_key

        elif provider_lower == LLMProvider.OLLAMA:
            # Ollama doesn't require API key, uses local service
            provider_kwargs["base_url"] = kwargs.get("base_url", "http://localhost:11434")

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
        """Get list of available LLM providers.

        Returns:
            list[str]: List of provider names.
        """
        return list(cls._provider_models.keys())

    @classmethod
    def get_available_models(cls, provider: str) -> list[str]:
        """Get list of available models for a provider.

        Args:
            provider (str): The provider name.

        Returns:
            list[str]: List of model names.

        Raises:
            ValueError: If provider is not supported.
        """
        provider_lower = provider.lower()

        if provider_lower not in cls._available_models:
            raise ValueError(
                f"Unsupported LLM provider: '{provider}'. "
                f"Supported providers: {', '.join(cls._provider_models.keys())}"
            )

        return cls._available_models[provider_lower]

    @classmethod
    def get_default_model(cls, provider: str) -> str:
        """Get the default model for a provider.

        Args:
            provider (str): The provider name.

        Returns:
            str: The default model name.

        Raises:
            ValueError: If provider is not supported.
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
        """Validate if a model name is available for a provider.

        Args:
            provider (str): The provider name.
            model_name (str): The model name to validate.

        Returns:
            bool: True if model is available for the provider.
        """
        provider_lower = provider.lower()
        available_models = cls._available_models.get(provider_lower, [])

        return model_name in available_models
