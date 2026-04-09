# -*- coding: utf-8 -*-
"""
SoloEngine : JSON会话模块，提供JSON格式的会话状态存储

@file json_session.py
@description 提供JSON格式的会话状态存储和加载
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供JSON会话实现，包括：
    - JSONSession: JSON会话类
    - 支持会话状态的JSON格式存储
    - 支持从JSON文件加载会话状态
    - 支持状态模块映射

依赖:
    - json: JSON处理
    - os: 操作系统接口
    - .session_base: 会话基类
    - ..utils.state_module: 状态模块
    - ..utils: 工具函数

使用示例:
    - from SoloAgent.session import JSONSession
    - session = JSONSession(save_dir="./sessions")
    - await session.save_session_state("session-123", memory=memory_module)
    - await session.load_session_state("session-123", memory=memory_module)
"""

import json
import os

from .session_base import SessionBase
from ..utils.state_module import StateModule
from ..utils import logger


class JSONSession(SessionBase):
    """
    JSON会话类

    职责:
        - 实现基于JSON的会话状态存储
        - 支持会话状态保存到JSON文件
        - 支持从JSON文件加载会话状态
        - 管理状态模块映射

    属性:
        save_dir: 保存目录

    示例:
        >>> session = JSONSession(save_dir="./sessions")
        >>> await session.save_session_state("session-123", memory=memory_module)
        >>> await session.load_session_state("session-123", memory=memory_module)
    """

    def __init__(
        self,
        session_id: str | None = None,
        save_dir: str = "./",
    ) -> None:
        """
        初始化JSON会话类

        Args:
            session_id: 会话ID（已弃用，请使用save_session_state和load_session_state方法）
            save_dir: 保存目录，默认为当前目录

        示例:
            >>> session = JSONSession(save_dir="./sessions")
        """
        self.save_dir = save_dir

        if session_id is not None:
            logger.warning(
                "The `session_id` argument in the JSONSession constructor is "
                "deprecated. Please pass the `session_id` to the "
                "`save_session_state` and `load_session_state` methods instead.",
            )

    def _get_save_path(self, session_id: str) -> str:
        """
        获取会话状态的保存路径

        Args:
            session_id: 会话ID

        Returns:
            str: 保存路径

        示例:
            >>> path = session._get_save_path("session-123")
            >>> print(path)  # "./sessions/session-123.json"
        """
        os.makedirs(self.save_dir, exist_ok=True)
        return os.path.join(self.save_dir, f"{session_id}.json")

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
        save_path = self._get_save_path(session_id)
        
        # Collect state from all modules
        state = {}
        for name, module in state_modules_mapping.items():
            if isinstance(module, StateModule):
                state[name] = module.state_dict()
            else:
                state[name] = module
        
        # Save to file
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Session state saved to {save_path}")

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
            allow_not_exist: 是否允许会话文件不存在
            **state_modules_mapping: 状态模块名称到实例的映射字典

        Raises:
            FileNotFoundError: 当allow_not_exist为False且文件不存在时抛出

        示例:
            >>> await session.load_session_state("session-123", memory=memory_module)
        """
        save_path = self._get_save_path(session_id)
        
        if not os.path.exists(save_path):
            if allow_not_exist:
                logger.info(f"Session file {save_path} does not exist, skipping load.")
                return
            else:
                raise FileNotFoundError(f"Session file {save_path} does not exist.")
        
        # Load from file
        with open(save_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        
        # Restore state to modules
        for name, module in state_modules_mapping.items():
            if name in state:
                if isinstance(module, StateModule):
                    module.load_state_dict(state[name])
                else:
                    # For non-StateModule objects, just set the value
                    setattr(module, name, state[name])
        
        logger.info(f"Session state loaded from {save_path}")