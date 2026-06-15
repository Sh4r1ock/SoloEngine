# -*- coding: utf-8 -*-
"""
SoloEngine : AgenticFlow 数据库存储服务模块

@file agenticflow_storage.py
@description AgenticFlow数据库存储 - 将AgenticFlow画布数据保存到数据库
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 将AgenticFlow画布数据保存到数据库agentic_flows.canvas_data列
    - 支持读写操作
    - 用户数据隔离

依赖:
    - logging: 日志记录
    - typing: 类型注解支持
    - app.core.database: 数据库管理

使用示例:
    - from app.core.agenticflow_storage import AgenticFlowStorage
    - storage = AgenticFlowStorage()
    - storage.save_canvas(db, "flow_id", canvas_data)
"""

import json
import logging
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

from app.core.database import AgenticFlowModel

logger = logging.getLogger(__name__)


class AgenticFlowStorage:
    """
    AgenticFlow 存储服务（数据库存储）
    
    职责:
        - 管理AgenticFlow画布数据的数据库存储
        - 提供用户数据隔离
        - 支持保存、加载操作
    
    示例:
        >>> storage = AgenticFlowStorage()
        >>> storage.save_canvas(db, "flow_1", {"nodes": [], "edges": []})
        >>> canvas = storage.load_canvas(db, "flow_1")
    """
    
    def __init__(self, user_id: str = None):
        self.user_id = user_id
    
    def save_canvas(self, db: Session, flow_id: str, canvas_data: Dict[str, Any]) -> None:
        flow = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == flow_id).first()
        if flow:
            flow.canvas_data = json.dumps(canvas_data, ensure_ascii=False) if canvas_data else None
            db.commit()
            logger.info(f"Saved canvas for flow {flow_id} to database")
        else:
            logger.warning(f"Flow {flow_id} not found, cannot save canvas")
    
    def load_canvas(self, db: Session, flow_id: str) -> Optional[Dict[str, Any]]:
        flow = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == flow_id).first()
        if flow and flow.canvas_data:
            try:
                return json.loads(flow.canvas_data)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"Failed to parse canvas_data for flow {flow_id}")
                return None
        return None
    
    def delete_flow(self, db: Session, flow_id: str) -> None:
        flow = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == flow_id).first()
        if flow:
            flow.canvas_data = None
            db.commit()
            logger.info(f"Cleared canvas_data for flow {flow_id}")
