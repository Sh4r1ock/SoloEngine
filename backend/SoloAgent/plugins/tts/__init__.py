# -*- coding: utf-8 -*-
"""
SoloEngine : TTS插件模块，提供文本转语音功能

@file __init__.py
@description TTS插件模块入口，统一导出TTS相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是TTS插件的入口，提供以下核心组件的统一导出：
    - ITTSModel: TTS模型接口
    - OpenAITTSModel: OpenAI TTS模型
    - AzureTTSModel: Azure TTS模型
    - EdgeTTSModel: Edge TTS模型
    - LocalTTSModel: 本地TTS模型

依赖:
    - ...core.interfaces: 核心接口
    - .openai_tts: OpenAI TTS实现
    - .azure_tts: Azure TTS实现
    - .edge_tts: Edge TTS实现
    - .local_tts: 本地TTS实现

使用示例:
    - from SoloAgent.plugins.tts import OpenAITTSModel
    - tts = OpenAITTSModel(api_key="your_key")
    - audio = await tts.synthesize("Hello")
"""

from ...core.interfaces import ITTSModel

__all__ = [
    "ITTSModel",
    "OpenAITTSModel",
    "AzureTTSModel", 
    "EdgeTTSModel",
    "LocalTTSModel",
]

try:
    from .openai_tts import OpenAITTSModel
except ImportError:
    pass

try:
    from .azure_tts import AzureTTSModel
except ImportError:
    pass

try:
    from .edge_tts import EdgeTTSModel
except ImportError:
    pass

try:
    from .local_tts import LocalTTSModel
except ImportError:
    pass
