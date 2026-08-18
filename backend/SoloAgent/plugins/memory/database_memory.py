# -*- coding: utf-8 -*-
"""
数据库持久化记忆插件模块。

@file database_memory.py
@description 基于SQLite数据库的记忆持久化插件
@author SoloEngine Team
@date 2026-02-25

设计理念：
- 一次对话只产生2条数据库记录（1条 user + 1条 assistant）
- 使用 data 字段存储消息内容数组
- 支持多轮推理过程：reasoning_content、tool_calls、content 可以多次出现

状态: ✅ 完整实现
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from zoneinfo import ZoneInfo
from app.core.config import settings
from app.utils.timezone_utils import format_iso
import logging

from ...core.interfaces import IMemory
from ...message import Msg

logger = logging.getLogger(__name__)


def _get_session_message_model():
    try:
        from app.core.database import SessionMessageModel
        return SessionMessageModel
    except ImportError:
        from backend.app.core.database import SessionMessageModel
        return SessionMessageModel


def _get_session_model():
    try:
        from app.core.database import AgenticFlowSessionModel
        return AgenticFlowSessionModel
    except ImportError:
        from backend.app.core.database import AgenticFlowSessionModel
        return AgenticFlowSessionModel


def _get_session_local():
    try:
        from app.core.database import SessionLocal
        return SessionLocal
    except ImportError:
        from backend.app.core.database import SessionLocal
        return SessionLocal


class DatabaseMemoryPlugin(IMemory):
    """
    数据库持久化记忆插件。
    
    设计理念：
        一次对话只产生2条数据库记录（1条 user + 1条 assistant）
        使用 data 字段存储消息内容数组
        
    Example:
        >>> memory = DatabaseMemoryPlugin({
        ...     "session_id": "session_123",
        ...     "user_id": "user_456",
        ...     "agentic_flow_id": "flow_789"
        ... })
        >>> await memory.add(Msg(name="user", content="你好", role="user"))
        >>> await memory.add(Msg(name="assistant", content="你好！", role="assistant"))
    """
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """
        初始化数据库记忆插件。
        
        Args:
            config (dict, optional): 配置字典，必须包含：
                - session_id: AgenticFlowSessionModel 的 ID（必需）
                - user_id: 用户ID（必需）
                - agentic_flow_id: AgenticFlowModel 的 ID（可选）
                - run_project_id: RunProjectModel 的 ID（可选）
                - auto_load: 是否自动加载历史记忆（默认 True）
                - max_memory_length: 最大记忆长度（可选）
        """
        config = config or {}
        
        self._session_id = config.get("session_id")
        self._user_id = config.get("user_id")
        self._agentic_flow_id = config.get("agentic_flow_id")
        self._run_project_id = config.get("run_project_id")
        self._auto_load = config.get("auto_load", True)
        self._max_memory_length = config.get("max_memory_length")
        
        if not self._session_id:
            raise ValueError("session_id is required for DatabaseMemoryPlugin")
        if not self._user_id:
            raise ValueError("user_id is required for DatabaseMemoryPlugin")
        
        self._messages: List[Dict[str, Any]] = []
        
        if self._auto_load:
            self._load_from_database()
    
    def _ensure_session_exists(self) -> None:
        """确保 session 存在，不存在则创建。
        注意：这个方法只在保存第一条消息时才应该被调用
        """
        AgenticFlowSessionModel = _get_session_model()
        
        if not self._run_project_id:
            raise ValueError("run_project_id is required for creating a session")
        
        if not self._user_id:
            raise ValueError("user_id is required for creating a session")
        
        if not self._agentic_flow_id:
            raise ValueError("agentic_flow_id is required for creating a session")
        
        try:
            db = self._get_db_session()
            try:
                session = db.query(AgenticFlowSessionModel).filter(
                    AgenticFlowSessionModel.id == self._session_id
                ).first()
                
                if not session:
                    session = AgenticFlowSessionModel(
                        id=self._session_id,
                        user_id=self._user_id,
                        agentic_flow_id=self._agentic_flow_id,
                        run_project_id=self._run_project_id,
                        status="pending",
                    )
                    db.add(session)
                    db.commit()
                    logger.info(f"Created new session {self._session_id}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Failed to ensure session exists: {e}")
            raise
    
    def _get_db_session(self):
        SessionLocal = _get_session_local()
        return SessionLocal()
    
    def _load_from_database(self) -> None:
        """从数据库加载对话记录。"""
        SessionMessageModel = _get_session_message_model()
        
        try:
            db = self._get_db_session()
            try:
                query = db.query(SessionMessageModel).filter(
                    SessionMessageModel.session_id == self._session_id,
                    SessionMessageModel.user_id == self._user_id,
                    SessionMessageModel.is_deleted == False
                ).order_by(SessionMessageModel.message_index)
                
                if self._max_memory_length:
                    total_count = query.count()
                    if total_count > self._max_memory_length:
                        offset = total_count - self._max_memory_length
                        query = query.offset(offset)
                
                records = query.all()
                
                self._messages = []
                for record in records:
                    data = record.data or []
                    
                    message_data = {
                        "id": record.id,
                        "role": record.role,
                        "data": data,
                        "prompt_tokens": record.prompt_tokens,
                        "completion_tokens": record.completion_tokens,
                        "total_tokens": record.total_tokens,
                        "system_prompt_token": record.system_prompt_token,
                        "user_prompt_token": record.user_prompt_token,
                        "assistant_prompt_token": record.assistant_prompt_token,
                        "token_usage_history": record.token_usage_history,
                        "message_index": record.message_index,
                        "created_at": format_iso(record.created_at) if record.created_at else None,
                    }
                    self._messages.append(message_data)
                
                logger.info(f"Loaded {len(self._messages)} messages from database for session {self._session_id}")
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Failed to load messages from database: {e}")
    
    def _save_message_to_database(self, message_data: Dict[str, Any]) -> Optional[str]:
        """保存单条消息到数据库。"""
        SessionMessageModel = _get_session_message_model()
        
        try:
            db = self._get_db_session()
            try:
                self._ensure_session_exists()
                
                max_index = db.query(SessionMessageModel.message_index).filter(
                    SessionMessageModel.session_id == self._session_id,
                    SessionMessageModel.is_deleted == False
                ).order_by(SessionMessageModel.message_index.desc()).first()
                
                next_index = (max_index[0] + 1) if max_index and max_index[0] is not None else 0
                
                data = message_data.get("data", [])
                
                record = SessionMessageModel(
                    session_id=self._session_id,
                    user_id=self._user_id,
                    agent_id=self._agentic_flow_id,
                    role=message_data.get("role", "user"),
                    data=data,
                    status=message_data.get("status", "completed"),
                    error=message_data.get("error"),
                    message_index=next_index,
                    prompt_tokens=message_data.get("prompt_tokens"),
                    completion_tokens=message_data.get("completion_tokens"),
                    total_tokens=message_data.get("total_tokens"),
                    system_prompt_token=message_data.get("system_prompt_token"),
                    user_prompt_token=message_data.get("user_prompt_token"),
                    assistant_prompt_token=message_data.get("assistant_prompt_token"),
                    token_usage_history=message_data.get("token_usage_history"),
                )

                db.add(record)
                db.commit()
                db.refresh(record)

                if message_data.get("prompt_tokens") or message_data.get("completion_tokens"):
                    self._update_session_token_usage(
                        db,
                        message_data.get("prompt_tokens", 0),
                        message_data.get("completion_tokens", 0),
                        message_data.get("system_prompt_token", 0),
                        message_data.get("user_prompt_token", 0),
                        message_data.get("assistant_prompt_token", 0),
                    )
                
                logger.debug(f"Saved message {record.id} at index {next_index}")
                return record.id
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Failed to save message to database: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _update_session_token_usage(self, db, prompt_tokens: int, completion_tokens: int,
                                      system_prompt_token: int = 0, user_prompt_token: int = 0,
                                      assistant_prompt_token: int = 0) -> None:
        """更新会话的 token 使用统计。

        统一委托给 db_manager.update_session_token_usage，避免重复实现。
        """
        from app.core.database import db_manager
        try:
            db_manager.update_session_token_usage(
                db=db,
                session_id=self._session_id,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                system_prompt_token=system_prompt_token,
                user_prompt_token=user_prompt_token,
                assistant_prompt_token=assistant_prompt_token,
            )
        except Exception as e:
            logger.warning(f"Failed to update session token usage: {e}")
    
    async def add(self, msg: Msg, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        将消息添加到对话中。
        
        Args:
            msg (Msg): 要添加的消息对象。
            metadata (dict, optional): 消息元数据，必须包含：
                - data: 消息内容数组（新格式）
                - prompt_tokens: 输入 token 数
                - completion_tokens: 输出 token 数
                - total_tokens: 总 token 数
        """
        metadata = metadata or {}
        
        message_data = {
            "role": msg.role or msg.name or "unknown",
            "data": metadata.get("data", []),
            "status": metadata.get("status", "completed"),
            "prompt_tokens": metadata.get("prompt_tokens"),
            "completion_tokens": metadata.get("completion_tokens"),
            "total_tokens": metadata.get("total_tokens"),
        }
        
        message_id = self._save_message_to_database(message_data)
        if message_id:
            message_data["id"] = message_id
            message_data["message_index"] = len(self._messages)
            self._messages.append(message_data)
        else:
            logger.error(f"Failed to save message to database for session {self._session_id}")
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        """
        从对话中检索最近的消息。
        
        Args:
            query (str): 查询文本（当前未使用）。
            limit (int, optional): 返回消息的最大数量。
        
        Returns:
            List[Msg]: 最近的消息列表。
        """
        result = []
        for msg_data in self._messages[-limit:]:
            msg = Msg(
                name=msg_data.get("role", ""),
                content=msg_data.get("content", ""),
                role=msg_data.get("role", "user")
            )
            result.append(msg)
        return result
    
    async def retrieve_all(self) -> List[Msg]:
        """
        获取所有消息。
        
        Returns:
            List[Msg]: 所有消息列表。
        """
        result = []
        for msg_data in self._messages:
            metadata = {}
            if msg_data.get("prompt_tokens"):
                metadata["prompt_tokens"] = msg_data["prompt_tokens"]
            if msg_data.get("completion_tokens"):
                metadata["completion_tokens"] = msg_data["completion_tokens"]
            if msg_data.get("total_tokens"):
                metadata["total_tokens"] = msg_data["total_tokens"]
            
            msg = Msg(
                name=msg_data.get("role", ""),
                content=msg_data.get("content", ""),
                role=msg_data.get("role", "user"),
                metadata=metadata if metadata else None
            )
            result.append(msg)
        return result
    
    async def get_messages_by_role(self, role: str) -> List[Msg]:
        """
        获取指定角色的消息。
        
        Args:
            role (str): 角色名称（user, assistant, system）。
        
        Returns:
            List[Msg]: 该角色的消息列表。
        """
        result = []
        for msg_data in self._messages:
            if msg_data.get("role") == role:
                msg = Msg(
                    name=msg_data.get("role", ""),
                    content=msg_data.get("content", ""),
                    role=msg_data.get("role", "user")
                )
                result.append(msg)
        return result
    
    async def get_messages_by_index_range(self, start: int, end: int) -> List[Msg]:
        """
        按索引范围获取消息。
        
        Args:
            start (int): 起始索引。
            end (int): 结束索引。
        
        Returns:
            List[Msg]: 消息列表。
        """
        result = []
        for msg_data in self._messages[start:end]:
            msg = Msg(
                name=msg_data.get("role", ""),
                content=msg_data.get("content", ""),
                role=msg_data.get("role", "user")
            )
            result.append(msg)
        return result
    
    async def get_token_usage(self) -> Dict[str, int]:
        """
        获取 token 使用统计。
        
        Returns:
            Dict[str, int]: token 使用统计。
        """
        total_prompt = sum(m.get("prompt_tokens", 0) or 0 for m in self._messages)
        total_completion = sum(m.get("completion_tokens", 0) or 0 for m in self._messages)
        total = sum(m.get("total_tokens", 0) or 0 for m in self._messages)
        
        return {
            "prompt_tokens": total_prompt,
            "completion_tokens": total_completion,
            "total_tokens": total,
        }
    
    async def clear(self) -> None:
        """
        清空对话记录。
        
        同时删除数据库中的记录。
        """
        SessionMessageModel = _get_session_message_model()
        
        try:
            db = self._get_db_session()
            try:
                db.query(SessionMessageModel).filter(
                    SessionMessageModel.session_id == self._session_id
                ).delete()
                db.commit()
                logger.info(f"Cleared all messages for session {self._session_id}")
                
                self._messages.clear()
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Failed to clear messages from database: {e}")
    
    async def get_memory_state(self) -> dict:
        """
        获取当前记忆状态。
        
        Returns:
            dict: 记忆状态字典。
        """
        return {
            "type": "database_session_messages",
            "session_id": self._session_id,
            "user_id": self._user_id,
            "agentic_flow_id": self._agentic_flow_id,
            "message_count": len(self._messages),
            "token_usage": await self.get_token_usage(),
        }
    
    async def set_memory_state(self, state: dict) -> None:
        """
        设置记忆状态。
        
        Args:
            state (dict): 记忆状态字典。
        """
        if "session_id" in state:
            self._session_id = state["session_id"]
        if "user_id" in state:
            self._user_id = state["user_id"]
        if "agentic_flow_id" in state:
            self._agentic_flow_id = state["agentic_flow_id"]
        
        self._messages.clear()
        self._load_from_database()
    
    @property
    def session_id(self) -> str:
        """获取会话ID。"""
        return self._session_id
    
    @property
    def user_id(self) -> str:
        """获取用户ID。"""
        return self._user_id
    
    @property
    def message_count(self) -> int:
        """获取消息数量。"""
        return len(self._messages)
