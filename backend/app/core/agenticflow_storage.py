# -*- coding: utf-8 -*-
"""
AgenticFlow 文件存储服务模块。

@file agenticflow_storage.py
@description AgenticFlow文件存储 - 将AgenticFlow数据保存到文件系统
@author SoloEngine Team
@date 2026-03-01

功能描述：
- 将AgenticFlow画布数据保存到 /data/agenticflow 目录
- 以 agenticflow_id 为文件名进行存储
- 支持读写、删除操作
- 数据库中只存储元数据，文件存储实际画布数据

使用场景：
- AgenticFlow画布数据持久化
- 大型画布数据存储
- 数据迁移和备份
"""

import os
import json
import logging
from typing import Optional, Dict, Any
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

AGENTICFLOW_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "data", "agenticflow"
)


class AgenticFlowStorageService:
    """AgenticFlow文件存储服务。"""

    def __init__(self, storage_dir: str = None):
        self.storage_dir = storage_dir or AGENTICFLOW_STORAGE_DIR
        self._ensure_storage_dir()

    def _ensure_storage_dir(self):
        """确保存储目录存在。"""
        os.makedirs(self.storage_dir, exist_ok=True)
        logger.info(f"AgenticFlow storage directory: {self.storage_dir}")

    def _get_file_path(self, flow_id: str) -> str:
        """获取AgenticFlow文件路径。"""
        return os.path.join(self.storage_dir, f"{flow_id}.json")

    def save_canvas(self, flow_id: str, canvas_data: Dict[str, Any]) -> bool:
        """
        保存画布数据到文件。
        
        Args:
            flow_id: AgenticFlow ID
            canvas_data: 画布数据（包含nodes, edges等）
            
        Returns:
            bool: 保存是否成功
        """
        try:
            file_path = self._get_file_path(flow_id)
            
            data = {
                "flow_id": flow_id,
                "canvas_data": canvas_data,
                "updated_at": datetime.utcnow().isoformat(),
            }
            
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Saved canvas data to {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save canvas data for flow {flow_id}: {e}")
            return False

    def load_canvas(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """
        从文件加载画布数据。
        
        Args:
            flow_id: AgenticFlow ID
            
        Returns:
            Optional[Dict]: 画布数据，如果文件不存在则返回None
        """
        try:
            file_path = self._get_file_path(flow_id)
            
            if not os.path.exists(file_path):
                logger.info(f"Canvas file not found for flow {flow_id}")
                return None
            
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            canvas_data = data.get("canvas_data", {"nodes": [], "edges": []})
            logger.info(f"Loaded canvas data from {file_path}")
            return canvas_data
            
        except Exception as e:
            logger.error(f"Failed to load canvas data for flow {flow_id}: {e}")
            return None

    def delete_canvas(self, flow_id: str) -> bool:
        """
        删除画布数据文件。
        
        Args:
            flow_id: AgenticFlow ID
            
        Returns:
            bool: 删除是否成功
        """
        try:
            file_path = self._get_file_path(flow_id)
            
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Deleted canvas file {file_path}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete canvas file for flow {flow_id}: {e}")
            return False

    def exists(self, flow_id: str) -> bool:
        """
        检查画布文件是否存在。
        
        Args:
            flow_id: AgenticFlow ID
            
        Returns:
            bool: 文件是否存在
        """
        file_path = self._get_file_path(flow_id)
        return os.path.exists(file_path)

    def get_file_info(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """
        获取画布文件信息。
        
        Args:
            flow_id: AgenticFlow ID
            
        Returns:
            Optional[Dict]: 文件信息，如果文件不存在则返回None
        """
        try:
            file_path = self._get_file_path(flow_id)
            
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            return {
                "flow_id": flow_id,
                "file_path": file_path,
                "file_size": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
            
        except Exception as e:
            logger.error(f"Failed to get file info for flow {flow_id}: {e}")
            return None


agenticflow_storage = AgenticFlowStorageService()
