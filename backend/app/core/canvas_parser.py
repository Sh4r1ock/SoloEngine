# -*- coding: utf-8 -*-
"""
SoloEngine : 画布解析器模块

@file canvas_parser.py
@description 工作流画布数据解析模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 解析画布JSON数据
    - 构建执行图
    - 解析节点数据、解析边数据
    - 构建执行依赖图、验证画布结构

依赖:
    - logging: 日志记录
    - typing: 类型注解支持
    - pydantic: 数据验证
    - app.models.node: 节点模型

使用示例:
    - from app.core.canvas_parser import CanvasParser
    - is_valid = CanvasParser.validate(canvas_data)
    - parsed = CanvasParser.parse(canvas_data)

注意事项：
    - 支持orchestrator、planner、executor、custom四种Agent类型
    - ReactFlow节点类型统一为'agent'
"""
import logging
from typing import Dict, Any, List
from pydantic import BaseModel
from app.models.node import OrchestratorNode, PlannerNode, ExecutorNode

logger = logging.getLogger(__name__)


class NodeData(BaseModel):
    """
    节点数据模型
    
    属性:
        id (str): 节点ID
        type (str): 节点类型
        position (Dict[str, float]): 节点位置
        data (Dict[str, Any]): 节点数据
    """
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]


class EdgeData(BaseModel):
    """
    边数据模型
    
    属性:
        id (str): 边ID
        source (str): 源节点ID
        target (str): 目标节点ID
        label (str): 边标签
    """
    id: str
    source: str
    target: str
    label: str


class CanvasData(BaseModel):
    """
    画布数据模型
    
    属性:
        nodes (List[NodeData]): 节点列表
        edges (List[EdgeData]): 边列表
    """
    nodes: List[NodeData]
    edges: List[EdgeData]


class CanvasParser:
    """
    画布解析器
    
    职责:
        - 验证画布数据格式
        - 解析画布数据为可执行的节点和边
        - 构建执行依赖图
    
    示例:
        >>> is_valid = CanvasParser.validate(canvas_data)
        >>> parsed = CanvasParser.parse(canvas_data)
    """

    @staticmethod
    def validate(canvas_data: Dict[str, Any]) -> bool:
        """
        验证画布数据格式
        
        Args:
            canvas_data: 画布数据字典
            
        Returns:
            是否验证通过
            
        Example:
            >>> is_valid = CanvasParser.validate({"nodes": [], "edges": []})
        """
        try:
            CanvasData(**canvas_data)
            return True
        except Exception as e:
            logger.warning(f"Canvas validation failed: {e}")
            return False
    
    @staticmethod
    def parse(canvas_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        解析画布数据
        
        Args:
            canvas_data: 画布数据字典
            
        Returns:
            包含nodes和edges的解析结果字典
            
        Raises:
            ValueError: 如果画布数据无效
            
        Example:
            >>> parsed = CanvasParser.parse(canvas_data)
            >>> nodes = parsed["nodes"]
        """
        if not CanvasParser.validate(canvas_data):
            raise ValueError("Invalid canvas data")
        
        nodes = {}
        edges = {}
        
        for node_data in canvas_data.get("nodes", []):
            node_id = node_data["id"]
            node_type = node_data.get("type")
            node_config = node_data.get("data", {})
            
            # 只处理agent类型节点
            if node_type != "agent":
                continue
            
            # 从node_config中获取agentType
            agent_type = node_config.get("agentType", "custom")
            
            if agent_type == "orchestrator":
                node = OrchestratorNode(node_id, node_config.get("name", ""), node_config)
            elif agent_type == "planner":
                node = PlannerNode(node_id, node_config.get("name", ""), node_config)
            elif agent_type == "executor":
                node = ExecutorNode(node_id, node_config.get("name", ""), node_config)
            else:
                # custom类型也使用ExecutorNode作为基类
                node = ExecutorNode(node_id, node_config.get("name", ""), node_config)
            
            nodes[node_id] = node
        
        for edge_data in canvas_data.get("edges", []):
            edge_id = edge_data["id"]
            edges[edge_id] = {
                "source": edge_data["source"],
                "target": edge_data["target"],
                "label": edge_data.get("label", "")
            }
        
        return {
            "nodes": nodes,
            "edges": edges
        }
