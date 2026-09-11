# -*- coding: utf-8 -*-
"""
SoloEngine : 运行API包

@package run
@description run.py 拆分后的包入口，聚合导出全部公开符号（外部 import 路径不变）

模块结构：
    - message_queue.py : MessageQueue（业务消息队列）
    - run_save.py      : save_session_message / load_and_distribute_memories / aggregate_incremental_to_net_view / _filter_tool_results
    - run_collector.py : ChunkCollector（流式块收集）
    - run_context.py   : AgenticFlowRunContext（运行上下文）
    - run_api.py       : HTTP 端点 + Pydantic 模型 + 会话查询
    - run_ws.py        : WebSocket 端点
"""
from .message_queue import MessageQueue
from .run_save import (
    aggregate_incremental_to_net_view,
    save_session_message,
    load_and_distribute_memories,
    _filter_tool_results,
    aggregate_token_totals,
)
from .run_collector import ChunkCollector
from .run_context import AgenticFlowRunContext
from .run_api import (
    router,
    ExecuteJSONRequest,
    ExecuteNodeRequest,
    execute_workflow,
    execute_single_node,
    stream_workflow,
    get_sessions,
    get_session,
    delete_session,
    get_session_messages,
    clear_flow_cache,
    clear_all_cache,
    get_cache_stats,
)
from .run_ws import run_websocket, _send_event

__all__ = [
    "MessageQueue",
    "aggregate_incremental_to_net_view",
    "save_session_message",
    "load_and_distribute_memories",
    "_filter_tool_results",
    "aggregate_token_totals",
    "ChunkCollector",
    "AgenticFlowRunContext",
    "router",
    "ExecuteJSONRequest",
    "ExecuteNodeRequest",
    "execute_workflow",
    "execute_single_node",
    "stream_workflow",
    "get_sessions",
    "get_session",
    "delete_session",
    "get_session_messages",
    "clear_flow_cache",
    "clear_all_cache",
    "get_cache_stats",
    "run_websocket",
    "_send_event",
]
