# -*- coding: utf-8 -*-
"""
Agent 钩子类型定义模块。

@file hook.py
@description 定义 Agent 生命周期钩子的类型
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 定义 Agent 钩子的类型名称
- 支持基础 Agent 钩子和 ReAct Agent 钩子
- 用于在 Agent 生命周期的特定点注入自定义逻辑

钩子类型：
    基础 Agent 钩子（AgentHookTypes）：
        - pre_reply: 回复前钩子
        - post_reply: 回复后钩子
        - pre_print: 打印前钩子
        - post_print: 打印后钩子
        - pre_observe: 观察前钩子
        - post_observe: 观察后钩子
    
    ReAct Agent 钩子（ReActAgentHookTypes）：
        - 继承所有基础钩子
        - pre_reasoning: 推理前钩子
        - post_reasoning: 推理后钩子
        - pre_acting: 行动前钩子
        - post_acting: 行动后钩子

设计理念：
    钩子系统允许在 Agent 执行流程的关键点插入自定义逻辑，
    如日志记录、性能监控、状态检查等。

使用场景：
    - 日志记录：记录 Agent 的执行过程
    - 性能监控：测量各阶段的执行时间
    - 状态检查：验证 Agent 状态
    - 调试：在关键点打印调试信息

状态: ✅ 完整实现
"""

from typing import Literal


AgentHookTypes = (
    str
    | Literal[
        "pre_reply",
        "post_reply",
        "pre_print",
        "post_print",
        "pre_observe",
        "post_observe",
    ]
)
"""
基础 Agent 钩子类型。

定义 Agent 生命周期中可注入钩子的关键点。

支持的钩子点：
    - pre_reply: 在 Agent 生成回复之前触发。
        可用于修改输入消息或添加上下文。
    
    - post_reply: 在 Agent 生成回复之后触发。
        可用于后处理回复或记录日志。
    
    - pre_print: 在打印输出之前触发。
        可用于格式化输出或添加前缀。
    
    - post_print: 在打印输出之后触发。
        可用于清理或追加输出。
    
    - pre_observe: 在 Agent 观察环境之前触发。
        可用于准备观察数据。
    
    - post_observe: 在 Agent 观察环境之后触发。
        可用于处理观察结果。

Example:
    >>> def log_reply(agent, message, **kwargs):
    ...     print(f"Agent {agent.name} received: {message}")
    >>> 
    >>> agent.add_hook("pre_reply", log_reply)

Note:
    - str 类型允许自定义钩子名称
    - 钩子函数签名取决于具体钩子点
"""


ReActAgentHookTypes = (
    AgentHookTypes
    | Literal[
        "pre_reasoning",
        "post_reasoning",
        "pre_acting",
        "post_acting",
    ]
)
"""
ReAct Agent 钩子类型。

继承基础 Agent 钩子，并添加 ReAct 架构特有的钩子点。

支持的额外钩子点：
    - pre_reasoning: 在推理阶段之前触发。
        ReAct 循环中的 "Thought" 阶段开始前。
        可用于注入额外的上下文或修改状态。
    
    - post_reasoning: 在推理阶段之后触发。
        ReAct 循环中的 "Thought" 阶段结束后。
        可用于分析推理结果或记录思考过程。
    
    - pre_acting: 在行动阶段之前触发。
        ReAct 循环中的 "Action" 阶段开始前。
        可用于验证工具调用参数。
    
    - post_acting: 在行动阶段之后触发。
        ReAct 循环中的 "Action" 阶段结束后。
        可用于处理工具执行结果或记录行动。

ReAct 循环流程：
    1. pre_reasoning -> 推理 -> post_reasoning
    2. pre_acting -> 行动 -> post_acting
    3. 重复直到任务完成

Example:
    >>> def log_reasoning(agent, reasoning_result, **kwargs):
    ...     print(f"Reasoning: {reasoning_result}")
    >>> 
    >>> agent.add_hook("post_reasoning", log_reasoning)

Note:
    - 包含所有 AgentHookTypes 的钩子点
    - 钩子函数可以返回修改后的值来影响后续流程
"""
