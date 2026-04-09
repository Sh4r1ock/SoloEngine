# -*- coding: utf-8 -*-
"""
SoloEngine : LLM统一服务层模块

@file llm_service.py
@description LLM统一服务层 - 封装LLM调用的通用逻辑，为API层提供统一接口
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 统一LLM调用接口
    - 封装配置解密和模型创建逻辑
    - 提供标准化的响应格式
    - 自动处理加密的API Key
    - 支持参数覆盖配置

依赖:
    - typing: 类型注解支持
    - SoloAgent.model: LLM工厂和模型
    - SoloAgent.model.model_response: 聊天响应
    - SoloAgent.message: 消息块
    - app.core.database: 数据库模型和加密服务

使用示例:
    - from app.core.llm_service import LLMService
    - result = await LLMService.chat(
    -     config=llm_config,
    -     message="你好",
    -     system_prompt="你是一个助手"
    - )
    - print(result["content"])

设计理念：
    通过服务层封装底层LLM抽象层，为API层提供简洁的调用接口。
    消除API层中的重复代码，遵循DRY原则。

状态: ✅ 完整实现
"""

from typing import Dict, Optional, Any

from SoloAgent.model import LLMFactory
from SoloAgent.model.model_response import ChatResponse
from SoloAgent.message import TextBlock
from app.core.database import LLMConfigModel, db_manager, encryption_service


class LLMService:
    """
    统一的LLM调用服务。
    
    封装LLM调用的通用逻辑，包括配置解密、模型创建、
    消息构建和响应处理。
    
    核心功能：
        1. 配置解密：自动处理加密的API Key
        2. 模型创建：使用LLMFactory创建模型实例
        3. 统一调用：提供标准化的chat接口
        4. 响应格式化：返回统一的响应格式
    
    Example:
        >>> result = await LLMService.chat(
        ...     config=llm_config,
        ...     message="你好",
        ...     system_prompt="你是一个助手"
        ... )
        >>> print(result["content"])
    
    Note:
        - 所有方法都是静态方法，无需实例化
        - 返回格式与原API层保持兼容
    """

    @staticmethod
    def _get_decrypted_api_key(config: LLMConfigModel) -> str:
        """
        从配置中获取解密后的API Key。
        
        Args:
            config (LLMConfigModel): LLM配置对象。
        
        Returns:
            str: 解密后的API Key，如果未配置则返回空字符串。
        
        Note:
            如果加密服务不可用，直接返回原始值。
        """
        if config.api_key:
            if encryption_service:
                return encryption_service.decrypt(config.api_key)
            return config.api_key
        return ""

    @staticmethod
    def _create_model_from_config(config: LLMConfigModel) -> Any:
        """
        根据LLM配置创建模型实例。
        
        Args:
            config (LLMConfigModel): LLM配置对象。
        
        Returns:
            Any: 模型实例（ChatModelBase子类）。
        
        Raises:
            ValueError: 当提供商不支持时抛出。
            Exception: 当模型创建失败时抛出。
        
        Note:
            - API层暂不支持流式输出，stream固定为False
            - 自动处理base_url配置
        """
        api_key = LLMService._get_decrypted_api_key(config)
        base_url = config.base_url

        model_kwargs: Dict[str, Any] = {
            "model_name": config.model_name,
            "stream": False,
            "api_key": api_key,
        }

        if base_url:
            model_kwargs["base_url"] = base_url

        return LLMFactory.create_model(
            provider=config.provider,
            **model_kwargs
        )

    @staticmethod
    async def chat(
        config: LLMConfigModel,
        message: str,
        system_prompt: Optional[str] = None,
        conversation_history: Optional[list] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        统一的LLM对话接口。
        
        封装完整的LLM调用流程，返回标准化的响应格式。
        
        Args:
            config (LLMConfigModel): LLM配置对象。
            message (str): 用户消息。
            system_prompt (str | None): 系统提示词。默认为None。
            conversation_history (list | None): 对话历史。默认为None。
            temperature (float | None): 温度参数，覆盖配置。默认为None。
            max_tokens (int | None): 最大Token数，覆盖配置。默认为None。
            model (str | None): 模型名称，覆盖配置。默认为None。
        
        Returns:
            Dict[str, Any]: 统一格式的响应字典，包含：
                - content: 生成的文本内容
                - model: 使用的模型名称
                - provider: 提供商名称
                - config_id: 配置ID
                - config_name: 配置名称
                - tokens_used: Token使用量统计
                - finish_reason: 完成原因
        
        Raises:
            ValueError: 当提供商不支持时抛出。
            Exception: 当API调用失败时抛出。
        
        Example:
            >>> result = await LLMService.chat(
            ...     config=config,
            ...     message="你好",
            ...     temperature=0.7
            ... )
            >>> print(result["content"])
        
        Note:
            - 对话历史格式：[{"role": "user/assistant", "content": "..."}]
            - Token统计字段统一为prompt_tokens/completion_tokens/total_tokens
        """
        model_name = model or config.model_name
        llm_model = LLMService._create_model_from_config(config)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        if conversation_history:
            messages.extend(conversation_history)

        messages.append({"role": "user", "content": message})

        call_kwargs: Dict[str, Any] = {}
        if temperature is not None:
            call_kwargs["temperature"] = temperature
        if max_tokens is not None:
            call_kwargs["max_tokens"] = max_tokens

        response: ChatResponse = await llm_model(messages, **call_kwargs)

        content = response.get_text_content()

        tokens_used = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        }

        if response.usage:
            tokens_used["prompt_tokens"] = response.usage.input_tokens
            tokens_used["completion_tokens"] = response.usage.output_tokens
            tokens_used["total_tokens"] = (
                response.usage.input_tokens + response.usage.output_tokens
            )

        return {
            "content": content,
            "model": model_name,
            "provider": config.provider,
            "config_id": config.id,
            "config_name": config.name,
            "tokens_used": tokens_used,
            "finish_reason": response.stop_reason or response.finish_reason or "stop",
        }
