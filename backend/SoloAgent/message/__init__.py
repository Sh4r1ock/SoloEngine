# -*- coding: utf-8 -*-
"""
消息系统机制-__init__.py: 消息系统模块入口

@file __init__.py
@description 消息系统模块入口，统一导出消息相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是消息系统机制的入口，提供以下核心组件的统一导出：
- Msg: 消息基类
- ContentBlock: 内容块基类
- TextBlock: 文本内容块
- ThinkingBlock: 思考内容块
- ToolUseBlock: 工具使用块
- ToolResultBlock: 工具结果块
- ImageBlock: 图像内容块
- AudioBlock: 音频内容块
- VideoBlock: 视频内容块
- Base64Source: Base64数据源
- URLSource: URL数据源

依赖:
- .message_block: 消息内容块定义
- .message_base: 消息基类定义

使用示例:
- from SoloAgent.message import Msg, TextBlock
- from SoloAgent.message import ToolUseBlock, ToolResultBlock
"""

from .message_block import (
    ContentBlock,
    TextBlock,
    ThinkingBlock,
    ToolCallsBlock,
    ToolResultBlock,
    ImageBlock,
    AudioBlock,
    VideoBlock,
    Base64Source,
    URLSource,
)
from .message_base import Msg


__all__ = [
    "TextBlock",
    "ThinkingBlock",
    "Base64Source",
    "URLSource",
    "ImageBlock",
    "AudioBlock",
    "VideoBlock",
    "ToolCallsBlock",
    "ToolResultBlock",
    "ContentBlock",
    "Msg",
]
