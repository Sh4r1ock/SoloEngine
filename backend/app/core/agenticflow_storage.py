# -*- coding: utf-8 -*-
"""
AgenticFlow 文件存储服务模块。

@file agenticflow_storage.py
@description AgenticFlow文件存储 - 将AgenticFlow数据保存到文件系统
@author SoloEngine Team
@date 2026-03-01

功能描述：
- 将AgenticFlow画布数据保存到 /data/{user_id}/agenticflow 目录
- 以 agentic_flow_id 为文件名进行存储
- 支持读写、删除操作
- 数据库中只存储元数据，文件存储实际画布数据
- 用户数据隔离

使用场景：
- AgenticFlow画布数据持久化
- 大型画布数据存储
- 数据迁移和备份
"""

import os
import json
import logging
import shutil
from typing import Optional, Dict, Any
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)


class AgenticFlowStorage:
    """AgenticFlow 存储服务（用户隔离）。"""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.storage_dir = DataPaths.get_user_agenticflow_dir(user_id)
        DataPaths.ensure_dir(self.storage_dir)
    
    def _get_flow_dir(self, flow_id: str) -> str:
        """获取Flow目录。"""
        return os.path.join(self.storage_dir, flow_id)
    
    def _get_canvas_path(self, flow_id: str) -> str:
        """获取Canvas文件路径。"""
        return os.path.join(self._get_flow_dir(flow_id), "canvas.json")
    
    def save_canvas(self, flow_id: str, canvas_data: Dict[str, Any]) -> None:
        """保存Canvas数据。"""
        flow_dir = self._get_flow_dir(flow_id)
        DataPaths.ensure_dir(flow_dir)
        canvas_path = self._get_canvas_path(flow_id)
        
        with open(canvas_path, 'w', encoding='utf-8') as f:
            json.dump(canvas_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved canvas for flow {flow_id}, user {self.user_id}")
    
    def load_canvas(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """加载Canvas数据。"""
        canvas_path = self._get_canvas_path(flow_id)
        
        if not os.path.exists(canvas_path):
            return None
        
        with open(canvas_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def delete_flow(self, flow_id: str) -> None:
        """删除Flow数据。"""
        flow_dir = self._get_flow_dir(flow_id)
        if os.path.exists(flow_dir):
            shutil.rmtree(flow_dir)
            logger.info(f"Deleted flow {flow_id}, user {self.user_id}")
