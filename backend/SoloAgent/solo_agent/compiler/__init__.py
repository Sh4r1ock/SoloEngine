"""
AgenticFlow编译器机制-__init__.py: AgenticFlow编译器模块

@file __init__.py
@description AgenticFlow编译器模块入口，统一导出编译相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是AgenticFlow编译器机制的入口，提供以下核心组件的统一导出：
- AgenticFlowCompiler: 编译器主类，将画布配置编译为可执行流程
- CompiledFlow: 编译后的流程对象，包含执行逻辑
- CompiledFlowFactory: 流程工厂，用于创建CompiledFlow实例
- FlowRunner: 流程运行器，执行编译后的流程
- ExecutionEvent: 执行事件，用于流程执行过程中的事件通知

依赖:
- .flow_compiler: 编译器实现模块

使用示例:
- from SoloAgent.solo_agent.compiler import AgenticFlowCompiler
- from SoloAgent.solo_agent.compiler import CompiledFlow, FlowRunner
"""
from .flow_compiler import (
    AgenticFlowCompiler, 
    CompiledFlow, 
    CompiledFlowFactory,
    FlowRunner,
    ExecutionEvent
)

__all__ = [
    "AgenticFlowCompiler",
    "CompiledFlow",
    "CompiledFlowFactory",
    "FlowRunner",
    "ExecutionEvent",
]
