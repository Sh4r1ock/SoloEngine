# -*- coding: utf-8 -*-
"""
SoloEngine : 会话基类模块，提供会话管理基础接口

@file session_base.py
@description 提供会话基类定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供会话基类，包括：
    - SessionBase: 会话基类
    - 定义会话状态保存和加载接口
    - 支持状态模块映射

依赖:
    - abc: 抽象基类
    - ..utils.state_module: 状态模块

使用示例:
    - from SoloAgent.session import SessionBase
    - class MySession(SessionBase):
    -     async def save_session_state(self, session_id, **state_modules):
    -         pass
"""

from abc import abstractmethod

from ..utils.state_module import StateModule


class SessionBase:
    """
    会话基类

    职责:
        - 定义会话状态保存接口
        - 定义会话状态加载接口
        - 支持状态模块映射

    属性:
        无

    示例:
        >>> class MySession(SessionBase):
        ...     async def save_session_state(self, session_id, **state_modules):
        ...         pass
        ...     async def load_session_state(self, session_id, allow_not_exist=True, **state_modules):
        ...         pass
    """

    @abstractmethod
    async def save_session_state(
        self,
        session_id: str,
        **state_modules_mapping: StateModule,
    ) -> None:
        """
        保存会话状态

        Args:
            session_id: 会话ID
            **state_modules_mapping: 状态模块名称到实例的映射字典

        示例:
            >>> await session.save_session_state("session-123", memory=memory_module)
        """
        pass

    @abstractmethod
    async def load_session_state(
        self,
        session_id: str,
        allow_not_exist: bool = True,
        **state_modules_mapping: StateModule,
    ) -> None:
        """
        加载会话状态

        Args:
            session_id: 会话ID
            allow_not_exist: 允许会话不存在
            **state_modules_mapping: 状态模块名称到实例的映射字典

        示例:
            >>> await session.load_session_state("session-123", memory=memory_module)
        """
        pass