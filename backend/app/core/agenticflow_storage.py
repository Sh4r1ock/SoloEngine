# -*- coding: utf-8 -*-
"""
SoloEngine : AgenticFlow 文件存储服务模块

@file agenticflow_storage.py
@description AgenticFlow文件存储 - 将AgenticFlow数据保存到文件系统
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 将AgenticFlow画布数据保存到 /data/{user_id}/agenticflow 目录
    - 以 agentic_flow_id 为文件名进行存储
    - 支持读写、删除操作
    - 数据库中只存储元数据，文件存储实际画布数据
    - 用户数据隔离

依赖:
    - os: 操作系统接口
    - json: JSON处理
    - logging: 日志记录
    - shutil: 文件操作
    - typing: 类型注解支持
    - app.core.data_paths: 数据路径管理

使用示例:
    - from app.core.agenticflow_storage import AgenticFlowStorage
    - storage = AgenticFlowStorage("user_123")
    - storage.save_canvas("flow_id", canvas_data)
"""

import os
import json
import logging
import shutil
from typing import Optional, Dict, Any
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)


class AgenticFlowStorage:
    """
    AgenticFlow 存储服务（用户隔离）
    
    职责:
        - 管理AgenticFlow画布数据的文件存储
        - 提供用户数据隔离
        - 支持保存、加载、删除操作
    
    属性:
        user_id (str): 用户ID
        storage_dir (str): 存储目录路径
    
    示例:
        >>> storage = AgenticFlowStorage("user_123")
        >>> storage.save_canvas("flow_1", {"nodes": [], "edges": []})
        >>> canvas = storage.load_canvas("flow_1")
    """
    
    def __init__(self, user_id: str):
        """
        初始化存储服务
        
        Args:
            user_id: 用户ID
        """
        self.user_id = user_id
        self.storage_dir = DataPaths.get_user_agenticflow_dir(user_id)
        DataPaths.ensure_dir(self.storage_dir)
    
    def _get_flow_dir(self, flow_id: str) -> str:
        """
        获取Flow目录
        
        Args:
            flow_id: Flow ID
            
        Returns:
            Flow目录路径
            
        Example:
            >>> flow_dir = storage._get_flow_dir("flow_1")
        """
        return os.path.join(self.storage_dir, flow_id)
    
    def _get_canvas_path(self, flow_id: str) -> str:
        """
        获取Canvas文件路径
        
        Args:
            flow_id: Flow ID
            
        Returns:
            Canvas文件完整路径
            
        Example:
            >>> canvas_path = storage._get_canvas_path("flow_1")
        """
        return os.path.join(self._get_flow_dir(flow_id), "canvas.json")
    
    def save_canvas(self, flow_id: str, canvas_data: Dict[str, Any]) -> None:
        """
        保存Canvas数据
        
        Args:
            flow_id: Flow ID
            canvas_data: 画布数据字典
            
        Example:
            >>> storage.save_canvas("flow_1", {"nodes": [], "edges": []})
        """
        flow_dir = self._get_flow_dir(flow_id)
        DataPaths.ensure_dir(flow_dir)
        canvas_path = self._get_canvas_path(flow_id)
        
        with open(canvas_path, 'w', encoding='utf-8') as f:
            json.dump(canvas_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved canvas for flow {flow_id}, user {self.user_id}")
    
    def load_canvas(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """
        加载Canvas数据
        
        Args:
            flow_id: Flow ID
            
        Returns:
            画布数据字典，如果不存在则返回None
            
        Example:
            >>> canvas = storage.load_canvas("flow_1")
        """
        canvas_path = self._get_canvas_path(flow_id)
        
        if not os.path.exists(canvas_path):
            return None
        
        with open(canvas_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def delete_flow(self, flow_id: str) -> None:
        """
        删除Flow数据
        
        Args:
            flow_id: Flow ID
            
        Example:
            >>> storage.delete_flow("flow_1")
        """
        flow_dir = self._get_flow_dir(flow_id)
        if os.path.exists(flow_dir):
            shutil.rmtree(flow_dir)
            logger.info(f"Deleted flow {flow_id}, user {self.user_id}")
