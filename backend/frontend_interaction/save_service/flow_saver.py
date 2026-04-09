# -*- coding: utf-8 -*-
"""
SoloEngine : Flow保存器模块

@file flow_saver.py
@description Flow保存器 - AgenticFlow保存和加载管理
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - AgenticFlow保存
    - AgenticFlow加载
    - Flow列表管理
    - Flow删除

依赖:
    - typing: 类型注解支持
    - datetime: 日期时间处理
    - .file_manager: 文件管理器

使用示例:
    - from frontend_interaction.save_service.flow_saver import FlowSaver
    - saver = FlowSaver()
    - saver.save_flow("my_flow", nodes, edges)
    - flow = saver.load_flow("my_flow")
"""

from typing import Dict, Any, List, Optional
from .file_manager import FileManager


class FlowSaver:
    def __init__(self, file_manager: FileManager = None):
        if file_manager is None:
            file_manager = FileManager()
        self.file_manager = file_manager

    def save_flow(self, project_name: str, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
        flow_data = {
            "project_name": project_name,
            "nodes": nodes,
            "edges": edges,
            "saved_at": self._get_current_timestamp()
        }
        self.file_manager.save_flow_to_file(project_name, flow_data)
        return flow_data

    def load_flow(self, project_name: str) -> Optional[Dict[str, Any]]:
        return self.file_manager.load_flow_from_file(project_name)

    def list_flows(self) -> List[Dict[str, Any]]:
        flow_names = self.file_manager.list_all_flows()
        flows = []
        for name in flow_names:
            flow_data = self.file_manager.load_flow_from_file(name)
            if flow_data:
                flows.append(flow_data)
        return flows

    def delete_flow(self, project_name: str) -> bool:
        return self.file_manager.delete_flow_file(project_name)

    def flow_exists(self, project_name: str) -> bool:
        return self.file_manager.flow_exists(project_name)

    def _get_current_timestamp(self) -> str:
        from datetime import datetime
        return datetime.now().isoformat()
