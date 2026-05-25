# -*- coding: utf-8 -*-
"""
SoloEngine : 简单TTS模型，提供占位符实现

@file simple_tts.py
@description 提供简单的TTS模型占位符实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - SimpleTTSModel: 简单TTS模型，返回空音频数据
    - 用于不需要或不支持TTS的环境

依赖:
    - typing: 类型注解支持
    - ..core.interfaces: 核心接口定义

使用示例:
    - from SoloAgent.tts import SimpleTTSModel
    - tts = SimpleTTSModel()
    - audio = await tts.synthesize("Hello World")
"""

from ..core.interfaces import ITTSModel


class SimpleTTSModel(ITTSModel):
    """
    简单TTS模型，返回空音频数据作为占位符
    
    职责:
        - 提供TTS接口的占位符实现
        - 用于不需要或不支持TTS的环境
    
    属性:
        无
    
    示例:
        >>> tts = SimpleTTSModel()
        >>> audio = await tts.synthesize("Hello World")
        >>> print(len(audio))
        0
    """
    
    async def synthesize(self, text: str, **kwargs) -> bytes:
        """
        将文本合成为语音
        
        返回空字节作为占位符
        
        Args:
            text: 要合成的文本
            **kwargs: 额外参数（被忽略）
            
        Returns:
            空字节串
            
        Example:
            >>> tts = SimpleTTSModel()
            >>> audio = await tts.synthesize("Hello World")
        """
        # Log that TTS was called (optional)
        # import logging
        # logging.getLogger(__name__).info(f"TTS synthesized: {text[:50]}...")
        return b""
