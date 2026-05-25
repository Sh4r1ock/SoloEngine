# -*- coding: utf-8 -*-
"""
SoloEngine : 执行上下文管理器模块

@file execution_context.py
@description 执行上下文管理器 - 管理运行中的任务，支持取消操作
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 跟踪运行中的 asyncio.Task
    - 提供 cancel_event 信号传播
    - 支持通过 WebSocket 或 HTTP API 取消任务
    - 自动清理已完成的任务
    - 多任务并发管理

依赖:
    - asyncio: 异步IO支持
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理
    - threading: 线程锁支持

使用示例:
    - from app.core.execution_context import ExecutionContextManager
    - manager = ExecutionContextManager()
    - context = manager.register(task, user_id, flow_id, session_id, project_id)
    - success = manager.cancel(user_id, flow_id, session_id, project_id)

使用场景：
    - 用户点击停止按钮时取消正在运行的 LLM 推理
    - 超时自动取消任务
    - 多任务并发管理
"""

import asyncio
import logging
from typing import Dict, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings
from threading import Lock

logger = logging.getLogger(__name__)


@dataclass
class ExecutionContext:
    """执行上下文数据类"""
    task: asyncio.Task
    cancel_event: asyncio.Event
    session_id: str
    user_id: str
    agentic_flow_id: str
    run_project_id: str
    created_at: datetime = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    metadata: Dict[str, Any] = field(default_factory=dict)
    collector: Any = None
    run_context: Any = None
    status: str = "running"
    websocket_ref: Any = None
    chunks_sent_count: int = 0
    taken_over_event: Optional[asyncio.Event] = None


class ExecutionContextManager:
    """
    执行上下文管理器。
    
    单例模式，管理所有运行中的任务。
    支持通过四参数（user_id, agentic_flow_id, session_id, run_project_id）定位任务。
    
    Example:
        >>> manager = ExecutionContextManager()
        >>> 
        >>> # 注册任务
        >>> context = manager.register(
        ...     task=asyncio_task,
        ...     user_id="user1",
        ...     agentic_flow_id="flow1",
        ...     session_id="session1",
        ...     run_project_id="project1"
        ... )
        >>> 
        >>> # 取消任务
        >>> success = manager.cancel(
        ...     user_id="user1",
        ...     agentic_flow_id="flow1",
        ...     session_id="session1",
        ...     run_project_id="project1"
        ... )
    """
    
    _instance: Optional["ExecutionContextManager"] = None
    _lock = Lock()
    
    def __new__(cls) -> "ExecutionContextManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._contexts: Dict[str, ExecutionContext] = {}
                    cls._instance._context_lock = Lock()
        return cls._instance
    
    def _make_key(
        self, 
        user_id: str, 
        agentic_flow_id: str, 
        session_id: str, 
        run_project_id: str
    ) -> str:
        from app.utils.common_utils import make_cache_key
        return make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
    
    def register(
        self,
        task: asyncio.Task,
        user_id: str,
        agentic_flow_id: str,
        session_id: str,
        run_project_id: str,
        metadata: Dict[str, Any] = None,
        cancel_event: asyncio.Event = None,
        collector: Any = None,
        run_context: Any = None,
        websocket_ref: Any = None,
        taken_over_event: asyncio.Event = None
    ) -> ExecutionContext:
        """
        注册一个运行中的任务。
        
        Args:
            task: asyncio.Task 实例
            user_id: 用户 ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话 ID
            run_project_id: 项目 ID
            metadata: 额外的元数据
            cancel_event: 外部创建的取消事件（可选）
            collector: ChunkCollector实例
            run_context: AgenticFlowRunContext实例
            websocket_ref: 当前活跃的WebSocket连接引用
            taken_over_event: 接管信号事件
            
        Returns:
            ExecutionContext: 创建的执行上下文
        """
        key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        if cancel_event is None:
            cancel_event = asyncio.Event()
        
        context = ExecutionContext(
            task=task,
            cancel_event=cancel_event,
            session_id=session_id,
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            run_project_id=run_project_id,
            metadata=metadata or {},
            collector=collector,
            run_context=run_context,
            status="running",
            websocket_ref=websocket_ref,
            chunks_sent_count=0,
            taken_over_event=taken_over_event,
        )
        
        with self._context_lock:
            old_context = self._contexts.get(key)
            if old_context and not old_context.task.done():
                logger.warning(f"Replacing running task for key: {key}")
                old_context.cancel_event.set()
                old_context.task.cancel()
            
            self._contexts[key] = context
        
        logger.info(f"Registered execution context: {key}")
        return context
    
    def get(
        self,
        user_id: str,
        agentic_flow_id: str,
        session_id: str,
        run_project_id: str
    ) -> Optional[ExecutionContext]:
        """
        获取执行上下文。
        
        Args:
            user_id: 用户 ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话 ID
            run_project_id: 项目 ID
            
        Returns:
            ExecutionContext 或 None
        """
        key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
        with self._context_lock:
            return self._contexts.get(key)
    
    def get_cancel_event(
        self,
        user_id: str,
        agentic_flow_id: str,
        session_id: str,
        run_project_id: str
    ) -> Optional[asyncio.Event]:
        """
        获取取消事件。
        
        Args:
            user_id: 用户 ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话 ID
            run_project_id: 项目 ID
            
        Returns:
            asyncio.Event 或 None
        """
        context = self.get(user_id, agentic_flow_id, session_id, run_project_id)
        return context.cancel_event if context else None
    
    def cancel(
        self,
        user_id: str,
        agentic_flow_id: str,
        session_id: str,
        run_project_id: str
    ) -> bool:
        """
        取消运行中的任务。
        
        设置 cancel_event 信号，并调用 task.cancel()。
        流式输出循环会检测到 cancel_event 并主动退出。
        
        Args:
            user_id: 用户 ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话 ID
            run_project_id: 项目 ID
            
        Returns:
            bool: 是否成功取消（如果任务不存在或已完成返回 False）
        """
        key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with self._context_lock:
            context = self._contexts.get(key)
            
            if context is None:
                logger.warning(f"No execution context found for key: {key}")
                return False
            
            if context.task.done():
                logger.info(f"Task already done for key: {key}")
                del self._contexts[key]
                return False
            
            logger.info(f"Cancelling task for key: {key}")
            
            context.cancel_event.set()
            
            context.task.cancel()
            
            return True
    
    def unregister(
        self,
        user_id: str,
        agentic_flow_id: str,
        session_id: str,
        run_project_id: str
    ) -> bool:
        """
        注销执行上下文。
        
        通常在任务完成后调用。
        
        Args:
            user_id: 用户 ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话 ID
            run_project_id: 项目 ID
            
        Returns:
            bool: 是否成功注销
        """
        key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with self._context_lock:
            if key in self._contexts:
                del self._contexts[key]
                logger.info(f"Unregistered execution context: {key}")
                return True
            return False
    
    def cleanup_done_tasks(self) -> int:
        """
        清理已完成的任务。
        
        Returns:
            int: 清理的任务数量
        """
        cleaned = 0
        with self._context_lock:
            keys_to_remove = []
            for key, context in self._contexts.items():
                if context.task.done():
                    keys_to_remove.append(key)
            
            for key in keys_to_remove:
                del self._contexts[key]
                cleaned += 1
        
        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} completed tasks")
        
        return cleaned
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取统计信息。
        
        Returns:
            Dict: 统计信息
        """
        with self._context_lock:
            running = sum(1 for c in self._contexts.values() if not c.task.done())
            done = sum(1 for c in self._contexts.values() if c.task.done())
            
            return {
                "total_contexts": len(self._contexts),
                "running_tasks": running,
                "completed_tasks": done,
            }


execution_context_manager = ExecutionContextManager()
