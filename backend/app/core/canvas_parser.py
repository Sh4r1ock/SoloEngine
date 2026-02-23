"""
@file canvas_parser.py
@description 画布解析器 - 工作流画布数据解析模块
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 解析画布JSON数据
- 构建执行图
- 解析节点数据、解析边数据
- 构建执行依赖图、验证画布结构

使用场景：
- 工作流执行前的数据验证和转换
- 将前端画布数据转换为可执行的协作图

注意事项：
- 支持orchestrator、planner、executor三种节点类型
- 验证画布数据的完整性和有效性
"""
import logging
from typing import Dict, Any, List
from pydantic import BaseModel, Field
from app.models.node import AgentNode, OrchestratorNode, PlannerNode, ExecutorNode

logger = logging.getLogger(__name__)

class NodeData(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]

class EdgeData(BaseModel):
    id: str
    source: str
    target: str
    label: str

class CanvasData(BaseModel):
    nodes: List[NodeData]
    edges: List[EdgeData]

class CanvasParser:
    @staticmethod
    def validate(canvas_data: Dict[str, Any]) -> bool:
        try:
            CanvasData(**canvas_data)
            return True
        except Exception as e:
            logger.warning(f"Canvas validation failed: {e}")
            return False
    
    @staticmethod
    def parse(canvas_data: Dict[str, Any]) -> Dict[str, Any]:
        if not CanvasParser.validate(canvas_data):
            raise ValueError("Invalid canvas data")
        
        nodes = {}
        edges = {}
        
        for node_data in canvas_data.get("nodes", []):
            node_id = node_data["id"]
            node_type = node_data["type"]
            node_config = node_data["data"]
            
            if node_type == "orchestrator":
                node = OrchestratorNode(node_id, node_config.get("name", ""), node_config)
            elif node_type == "planner":
                node = PlannerNode(node_id, node_config.get("name", ""), node_config)
            elif node_type == "executor":
                node = ExecutorNode(node_id, node_config.get("name", ""), node_config)
            else:
                continue
            
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
