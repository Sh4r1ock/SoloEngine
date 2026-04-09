# -*- coding: utf-8 -*-
"""
SoloEngine : TTS模块，提供文本转语音功能

@file __init__.py
@description TTS模块入口，统一导出TTS类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是TTS模块的入口，提供以下核心类的统一导出：
    - SimpleTTSModel: 简单TTS模型

依赖:
    - .simple_tts: 简单TTS实现

使用示例:
    - from SoloAgent.tts import SimpleTTSModel
    - tts = SimpleTTSModel()
"""

from .simple_tts import SimpleTTSModel

__all__ = ["SimpleTTSModel"]
