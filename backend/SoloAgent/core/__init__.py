# -*- coding: utf-8 -*-
"""
SoloEngine : SoloEngine Core模块，定义核心接口和ReAct引擎

@file __init__.py
@description SoloEngine Core模块入口，统一导出核心插件接口和ReAct引擎
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是ReAct核心机制的入口，提供以下核心组件的统一导出：
    - 核心插件接口: IMemory记忆接口, IRAG检索接口, IToolExecutor工具执行器接口
    - MCP客户端接口: IMCPClient，用于Model Context Protocol
    - 计划笔记本接口: IPlanNotebook，用于任务规划
    - TTS模型接口: ITTSModel，用于语音合成
    - ReAct核心引擎: ReActCore，实现推理-行动循环
    - 枚举类型: CompletionReason任务完成原因, StopReason停止原因

依赖:
    - .interfaces: 核心插件接口定义模块
    - .react_core: ReAct核心引擎实现模块

使用示例:
    - from SoloAgent.core import ReActCore, IMemory, IToolExecutor
    - from SoloAgent.core import CompletionReason, StopReason
"""

from .interfaces import (
    IMemory,
    IRAG,
    IToolExecutor,
    IMCPClient,
    IPlanNotebook,
    ITTSModel,
)
from .react_core import ReActCore, CompletionReason, StopReason

__all__ = [
    "IMemory",
    "IRAG",
    "IToolExecutor",
    "IMCPClient",
    "IPlanNotebook",
    "ITTSModel",
    "ReActCore",
    "CompletionReason",
    "StopReason",
]
