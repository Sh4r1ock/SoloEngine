# -*- coding: utf-8 -*-
"""
SoloEngine : 黑洞记忆插件，无记忆功能实现

@file blackhole_memory.py
@description 黑洞记忆插件实现，用于禁用记忆功能
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供黑洞记忆插件，包括：
    - BlackholeMemoryPlugin: 黑洞记忆插件，丢弃所有消息
    - 实现IMemory接口但不做任何存储操作
    - 用于禁用记忆功能的场景

依赖:
    - typing: 类型提示
    - ...core.interfaces: 核心接口
    - ...message: 消息类型

使用示例:
    - from SoloAgent.plugins.memory import BlackholeMemoryPlugin
    - memory = BlackholeMemoryPlugin()
    - await memory.add(msg)  # 不执行任何操作
    - results = await memory.retrieve("query")  # 返回空列表
"""

from typing import List

from ...core.interfaces import IMemory
from ...message import Msg


class BlackholeMemoryPlugin(IMemory):
    """
    黑洞记忆插件

    职责:
        - 实现IMemory接口但不做任何存储操作
        - 丢弃所有添加的消息
        - 返回空的检索结果
        - 用于禁用记忆功能的场景

    属性:
        无

    示例:
        >>> memory = BlackholeMemoryPlugin()
        >>> await memory.add(msg)  # 不执行任何操作
        >>> results = await memory.retrieve("query")  # 返回空列表
        >>> state = await memory.get_memory_state()  # 返回空状态
    """

    async def add(self, msg: Msg) -> None:
        """
        添加消息（不执行任何操作）

        Args:
            msg: 消息对象

        示例:
            >>> await memory.add(msg)  # 无操作
        """
        pass

    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        """
        检索消息（返回空列表）

        Args:
            query: 查询字符串
            limit: 返回数量限制

        Returns:
            List[Msg]: 空列表

        示例:
            >>> results = await memory.retrieve("query")
            >>> print(results)  # []
        """
        return []

    async def clear(self) -> None:
        """
        清空记忆（不执行任何操作）

        示例:
            >>> await memory.clear()  # 无操作
        """
        pass

    async def get_memory_state(self) -> dict:
        """
        获取记忆状态

        Returns:
            dict: 黑洞记忆状态

        示例:
            >>> state = await memory.get_memory_state()
            >>> print(state)  # {"type": "blackhole", "message_count": 0}
        """
        return {"type": "blackhole", "message_count": 0}

    async def set_memory_state(self, state: dict) -> None:
        """
        设置记忆状态（不执行任何操作）

        Args:
            state: 状态字典

        示例:
            >>> await memory.set_memory_state({})  # 无操作
        """
        pass