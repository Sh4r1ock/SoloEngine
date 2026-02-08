from typing import Dict, Any, List
from pydantic import BaseModel, Field
from app.models.node import AgentNode, OrchestratorNode, PlannerNode, ExecutorNode

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
        except Exception:
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
