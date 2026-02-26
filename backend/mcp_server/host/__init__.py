# -*- coding: utf-8 -*-
"""
MCP Host 模块 - 服务管理层。

MCP Host是整个管理工具的总管，负责：
- 管理Client实例（创建、销毁、维护Client Pool）
- 转发调用请求（将调用请求路由到对应的Client）
- 显示Server列表（提供所有已注册Server的信息）
- 增删改查Server（注册、注销、启动、停止Server）
"""

from .registry import ServiceRegistry
from .lifecycle import LifecycleManager
from .caller import UnifiedCaller

__all__ = ["ServiceRegistry", "LifecycleManager", "UnifiedCaller"]
