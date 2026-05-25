# -*- coding: utf-8 -*-
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from zoneinfo import ZoneInfo

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON, Boolean, Index, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.config import settings
from app.utils.timezone_utils import format_iso


class FileContentBlobModel(Base):
    __tablename__ = "file_content_blobs"

    content_hash = Column(String(64), primary_key=True)
    content = Column(Text, nullable=True)
    is_large_file = Column(Boolean, default=False)
    file_size = Column(Integer, default=0)
    ref_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))


class FileChangeModel(Base):
    __tablename__ = "file_changes"
    __table_args__ = (
        Index('idx_file_changes_session_message', 'session_id', 'message_id'),
        Index('idx_file_changes_file_path', 'file_path'),
        Index('idx_file_changes_session_agent', 'session_id', 'agent_id'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True)
    message_id = Column(String(36), ForeignKey("session_messages.id"), nullable=False, index=True)
    agent_id = Column(String(36), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    
    file_path = Column(String(500), nullable=False)
    operation = Column(String(20), nullable=False)
    tool_call_id = Column(String(100), nullable=True, index=True)
    file_hash = Column(String(64), nullable=True)
    content_type = Column(String(20), default="text")
    before_content_hash = Column(String(64), nullable=True)
    after_content_hash = Column(String(64), nullable=True)
    
    diff_data = Column(JSON, nullable=True)
    
    lines_added = Column(Integer, default=0)
    lines_removed = Column(Integer, default=0)
    
    status = Column(String(20), default="pending")
    
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    
    session = relationship("AgenticFlowSessionModel", backref="file_changes")
    message = relationship("SessionMessageModel", backref="file_changes")
    user = relationship("UserModel", backref="file_changes")
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "message_id": self.message_id,
            "agent_id": self.agent_id,
            "file_path": self.file_path,
            "operation": self.operation,
            "tool_call_id": self.tool_call_id,
            "file_hash": self.file_hash,
            "content_type": self.content_type,
            "before_content_hash": self.before_content_hash,
            "after_content_hash": self.after_content_hash,
            "diff_data": self.diff_data,
            "lines_added": self.lines_added,
            "lines_removed": self.lines_removed,
            "status": self.status,
            "created_at": format_iso(self.created_at),
        }
