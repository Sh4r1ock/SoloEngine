# -*- coding: utf-8 -*-
"""
SoloEngine : AgenticFlow网关注册模块，提供编译后 Flow 的注册缓存

@file agenticflow_gateway.py
@description 为 AgenticFlow 提供编译后 Flow 的注册与查询
@author Sh4rlock
@date 2026-04-09

功能描述：
- 当编译 AgenticFlow 后，注册编译后的 Flow 实例，供查询使用

使用场景：
- AgenticFlow 编译后由 flow_compiler 调用 register_compiled_flow 注册

状态: 精简实现（仅保留 register_compiled_flow 活路径）
"""

import asyncio
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


class AgenticFlowGateway:
    """
    AgenticFlow 网关管理器

    职责:
        - 缓存编译后的 AgenticFlow 实例
        - 为每个 Flow 维护独立执行锁

    属性:
        _compiled_flows (Dict[str, Any]): 编译后的 Flow 实例缓存
        _execution_locks (Dict[str, asyncio.Lock]): 每个 agentic_flow_id 的执行锁，支持并发控制

    示例:
        >>> gateway = AgenticFlowGateway()
        >>> gateway.register_compiled_flow("flow_id", compiled_flow)
    """

    def __init__(self):
        """
        初始化AgenticFlow网关管理器

        初始化所有存储字典和锁
        """
        self._compiled_flows: Dict[str, Any] = {}
        self._execution_locks: Dict[str, asyncio.Lock] = {}

    def register_compiled_flow(self, agentic_flow_id: str, compiled_flow: Any) -> str:
        """
        注册编译后的 AgenticFlow

        Args:
            agentic_flow_id: AgenticFlow ID
            compiled_flow: 编译后的 Flow 实例

        Returns:
            注册的路由路径

        Example:
            >>> path = gateway.register_compiled_flow("flow_id", compiled_flow)
        """
        self._compiled_flows[agentic_flow_id] = compiled_flow

        if agentic_flow_id not in self._execution_locks:
            self._execution_locks[agentic_flow_id] = asyncio.Lock()

        route_path = f"/api/v1/agentic-flows/{agentic_flow_id}/execute"
        logger.info(f"AgenticFlow registered: {route_path}")
        return route_path


agenticflow_gateway = AgenticFlowGateway()
