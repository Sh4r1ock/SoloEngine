# -*- coding: utf-8 -*-
"""
数据库持久化记忆插件模块。

@file database_memory.py
@description 基于SQLite数据库的记忆持久化插件，每条记录存储一条完整对话（多轮消息）
@author SoloEngine Team
@date 2026-02-25

设计理念：
- 一条数据库记录 = 一个完整对话（多轮消息）
- 使用JSON格式存储对话内容
- 使用乐观锁（version字段）处理并发更新
- 依附于AgenticFlowRunModel

数据库关系：
- AgentMemoryModel.run_id -> AgenticFlowRunModel.id
- AgentMemoryModel.user_id -> UserModel.id
- AgentMemoryModel.agentic_flow_id -> AgenticFlowModel.id

状态: ✅ 完整实现
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid
import logging
import json

from ...core.interfaces import IMemory
from ...message import Msg

logger = logging.getLogger(__name__)


def _get_agent_memory_model():
    try:
        from app.core.database import AgentMemoryModel
        return AgentMemoryModel
    except ImportError:
        from backend.app.core.database import AgentMemoryModel
        return AgentMemoryModel


def _get_session_local():
    try:
        from app.core.database import SessionLocal
        return SessionLocal
    except ImportError:
        from backend.app.core.database import SessionLocal
        return SessionLocal


class OptimisticLockError(Exception):
    """乐观锁冲突异常。"""
    pass


class DatabaseMemoryPlugin(IMemory):
    """
    数据库持久化记忆插件。
    
    设计理念：
        一条数据库记录 = 一个完整对话（多轮消息）
        
    存储格式：
        content字段存储JSON格式的对话：
        {
            "messages": [
                {"role": "user", "content": "你好", "name": "user", "metadata": {}},
                {"role": "assistant", "content": "你好！", "name": "assistant", "metadata": {}},
                ...
            ],
            "created_at": "2026-02-25T10:00:00",
            "updated_at": "2026-02-25T10:05:00"
        }
    
    乐观锁：
        使用version字段实现乐观锁，每次更新时检查版本号。
    
    Example:
        >>> memory = DatabaseMemoryPlugin({
        ...     "run_id": "run_123",
        ...     "user_id": "user_456",
        ...     "agentic_flow_id": "flow_789"
        ... })
        >>> await memory.add(Msg(name="user", content="你好", role="user"))
        >>> await memory.add(Msg(name="assistant", content="你好！", role="assistant"))
        >>> # 一条记录存储了整个对话
    """
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """
        初始化数据库记忆插件。
        
        Args:
            config (dict, optional): 配置字典，必须包含：
                - run_id: AgenticFlowRunModel 的 ID（必需）
                - user_id: 用户ID（必需）
                - agentic_flow_id: AgenticFlowModel 的 ID（可选）
                - agent_id: AgentModel 的 ID（可选）
                - run_project_id: RunProjectModel 的 ID（可选）
                - auto_load: 是否自动加载历史记忆（默认 True）
        """
        config = config or {}
        
        self._run_id = config.get("run_id")
        self._user_id = config.get("user_id")
        self._agentic_flow_id = config.get("agentic_flow_id")
        self._agent_id = config.get("agent_id")
        self._run_project_id = config.get("run_project_id")
        self._auto_load = config.get("auto_load", True)
        
        if not self._run_id:
            raise ValueError("run_id is required for DatabaseMemoryPlugin")
        if not self._user_id:
            raise ValueError("user_id is required for DatabaseMemoryPlugin")
        
        self._messages: List[Dict[str, Any]] = []
        self._record_id: Optional[str] = None
        self._version: int = 1
        self._created_at: Optional[str] = None
        self._updated_at: Optional[str] = None
        
        if self._auto_load:
            self._load_from_database()
    
    def _get_db_session(self):
        SessionLocal = _get_session_local()
        return SessionLocal()
    
    def _load_from_database(self) -> None:
        """从数据库加载对话记录。
        
        修复：按 agentic_flow_id 加载记忆，而不是 run_id
        这样同一个 AgenticFlow 的不同运行可以共享记忆
        """
        AgentMemoryModel = _get_agent_memory_model()
        
        try:
            db = self._get_db_session()
            try:
                if self._agentic_flow_id:
                    record = db.query(AgentMemoryModel).filter(
                        AgentMemoryModel.agentic_flow_id == self._agentic_flow_id,
                        AgentMemoryModel.user_id == self._user_id
                    ).order_by(AgentMemoryModel.created_at.desc()).first()
                else:
                    record = db.query(AgentMemoryModel).filter(
                        AgentMemoryModel.run_id == self._run_id,
                        AgentMemoryModel.user_id == self._user_id
                    ).first()
                
                if record:
                    self._record_id = record.id
                    self._version = record.version or 1
                    
                    try:
                        data = json.loads(record.content) if record.content else {}
                        self._messages = data.get("messages", [])
                        self._created_at = data.get("created_at")
                        self._updated_at = data.get("updated_at")
                    except json.JSONDecodeError:
                        self._messages = []
                    
                    logger.info(f"Loaded conversation with {len(self._messages)} messages from database")
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Failed to load conversation from database: {e}")
    
    def _save_to_database(self) -> None:
        """保存对话记录到数据库（带乐观锁）。"""
        AgentMemoryModel = _get_agent_memory_model()
        
        now = datetime.now(timezone.utc).isoformat()
        self._updated_at = now
        
        if not self._created_at:
            self._created_at = now
        
        content_data = {
            "messages": self._messages,
            "created_at": self._created_at,
            "updated_at": self._updated_at
        }
        
        try:
            db = self._get_db_session()
            try:
                if self._record_id:
                    record = db.query(AgentMemoryModel).filter(
                        AgentMemoryModel.id == self._record_id
                    ).first()
                    
                    if record:
                        if record.version != self._version:
                            raise OptimisticLockError(
                                f"Version conflict: expected {self._version}, got {record.version}"
                            )
                        
                        record.content = json.dumps(content_data, ensure_ascii=False)
                        record.version = self._version + 1
                        self._version = record.version
                        db.commit()
                        db.refresh(record)
                        logger.debug(f"Updated conversation record {self._record_id}, version: {self._version}")
                    else:
                        self._create_new_record(db, content_data)
                else:
                    self._create_new_record(db, content_data)
            finally:
                db.close()
        except OptimisticLockError:
            raise
        except Exception as e:
            logger.warning(f"Failed to save conversation to database: {e}")
    
    def _create_new_record(self, db, content_data: dict) -> None:
        """创建新的对话记录或更新现有记录。
        
        修复：如果已存在相同 agentic_flow_id 的记录，则更新它
        """
        AgentMemoryModel = _get_agent_memory_model()
        
        if self._agentic_flow_id:
            existing_record = db.query(AgentMemoryModel).filter(
                AgentMemoryModel.agentic_flow_id == self._agentic_flow_id,
                AgentMemoryModel.user_id == self._user_id
            ).order_by(AgentMemoryModel.created_at.desc()).first()
            
            if existing_record:
                existing_record.content = json.dumps(content_data, ensure_ascii=False)
                existing_record.version = (existing_record.version or 1) + 1
                existing_record.run_id = self._run_id
                db.commit()
                db.refresh(existing_record)
                
                self._record_id = existing_record.id
                self._version = existing_record.version
                logger.debug(f"Updated existing conversation record {self._record_id} for agentic_flow_id {self._agentic_flow_id}")
                return
        
        record = AgentMemoryModel(
            run_id=self._run_id,
            user_id=self._user_id,
            agentic_flow_id=self._agentic_flow_id,
            agent_id=self._agent_id,
            run_project_id=self._run_project_id,
            role="conversation",
            content=json.dumps(content_data, ensure_ascii=False),
            meta_data={"type": "conversation_storage"},
            version=1
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        
        self._record_id = record.id
        self._version = record.version
        logger.debug(f"Created new conversation record {self._record_id}")
    
    async def add(self, msg: Msg, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        将消息添加到对话中。
        
        Args:
            msg (Msg): 要添加的消息对象。
            metadata (dict, optional): 消息元数据。
        """
        message_data = {
            "role": msg.role or msg.name or "unknown",
            "content": msg.get_text_content() or "",
            "name": msg.name or "",
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        self._messages.append(message_data)
        self._save_to_database()
    
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
                name=msg_data.get("name", ""),
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
            msg = Msg(
                name=msg_data.get("name", ""),
                content=msg_data.get("content", ""),
                role=msg_data.get("role", "user")
            )
            result.append(msg)
        return result
    
    async def get_messages_by_role(self, role: str) -> List[Msg]:
        """
        获取指定角色的消息。
        
        Args:
            role (str): 角色名称（user, assistant, system, tool）。
        
        Returns:
            List[Msg]: 该角色的消息列表。
        """
        result = []
        for msg_data in self._messages:
            if msg_data.get("role") == role:
                msg = Msg(
                    name=msg_data.get("name", ""),
                    content=msg_data.get("content", ""),
                    role=msg_data.get("role", "user")
                )
                result.append(msg)
        return result
    
    async def clear(self) -> None:
        """
        清空对话记录。
        
        同时删除数据库中的记录。
        """
        self._messages.clear()
        self._created_at = None
        self._updated_at = None
        
        AgentMemoryModel = _get_agent_memory_model()
        
        try:
            db = self._get_db_session()
            try:
                if self._record_id:
                    db.query(AgentMemoryModel).filter(
                        AgentMemoryModel.id == self._record_id
                    ).delete()
                    db.commit()
                    logger.info(f"Cleared conversation record {self._record_id}")
                
                self._record_id = None
                self._version = 1
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"Failed to clear conversation from database: {e}")
    
    async def get_memory_state(self) -> dict:
        """
        获取当前记忆状态。
        
        Returns:
            dict: 记忆状态字典。
        """
        return {
            "type": "database_conversation",
            "run_id": self._run_id,
            "user_id": self._user_id,
            "agentic_flow_id": self._agentic_flow_id,
            "record_id": self._record_id,
            "version": self._version,
            "message_count": len(self._messages),
            "created_at": self._created_at,
            "updated_at": self._updated_at,
        }
    
    async def set_memory_state(self, state: dict) -> None:
        """
        设置记忆状态。
        
        Args:
            state (dict): 记忆状态字典。
        """
        if "run_id" in state:
            self._run_id = state["run_id"]
        if "user_id" in state:
            self._user_id = state["user_id"]
        if "agentic_flow_id" in state:
            self._agentic_flow_id = state["agentic_flow_id"]
        
        self._messages.clear()
        self._record_id = None
        self._version = 1
        self._load_from_database()
    
    @property
    def run_id(self) -> str:
        """获取运行记录ID。"""
        return self._run_id
    
    @property
    def user_id(self) -> str:
        """获取用户ID。"""
        return self._user_id
    
    @property
    def version(self) -> int:
        """获取当前版本号（乐观锁）。"""
        return self._version
    
    @property
    def record_id(self) -> Optional[str]:
        """获取数据库记录ID。"""
        return self._record_id
