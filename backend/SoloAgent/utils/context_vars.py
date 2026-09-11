# -*- coding: utf-8 -*-
"""
SoloEngine : 并发工具调用上下文变量

@file context_vars.py
@description 工具交互回答按 tool_call_id 路由所需的上下文变量

react_core._execute_single_tool 在工具执行前 set 当前 tool_call_id，
工具内 human_in_the_loop.wait_for_user_message 读取并据此把回答 Future 注册到
run_context._pending_interactions[call_id]——asyncio 并发工具各自 task
（asyncio.gather）拥有独立 context，并发审批互不覆盖，回答按 id 精确送达。
"""
import contextvars

# 当前执行的 tool_call_id（无工具上下文时 default=None，兼容非 AgenticFlow 场景）
tool_call_id_var = contextvars.ContextVar("tool_call_id", default=None)
