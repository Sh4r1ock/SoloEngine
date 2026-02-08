from typing import Dict, Any, Optional
from app.models.node import AgentNode
from app.core.context_manager import ContextManager
from app.core.tool_registry import tool_registry

class Scheduler:
    def __init__(self, 协作图: Dict[str, Any]):
        self.协作图 = 协作图
        self.nodes = 协作图["nodes"]
        self.edges = 协作图["edges"]
        self.context_manager = ContextManager()
        self.current_node_id: Optional[str] = None
        self.execution_log = []
    
    async def start(self, initial_context: Dict[str, Any]) -> Dict[str, Any]:
        self.context_manager.reset()
        
        for key, value in initial_context.items():
            self.context_manager.update(key, value)
        
        orchestrator_node = self._find_orchestrator_node()
        if not orchestrator_node:
            raise ValueError("No orchestrator node found in the collaboration graph")
        
        self.current_node_id = orchestrator_node.id
        
        result = await self.execute_node(orchestrator_node)
        return result
    
    async def schedule_next(self, node_result: Dict[str, Any]) -> Dict[str, Any]:
        next_node_id = node_result.get("next_node_id")
        
        if not next_node_id:
            return {
                "status": "completed",
                "message": "Execution completed successfully",
                "final_result": node_result
            }
        
        next_node = self.nodes.get(next_node_id)
        if not next_node:
            raise ValueError(f"Node {next_node_id} not found")
        
        self.current_node_id = next_node_id
        result = await self.execute_node(next_node)
        return result
    
    async def execute_node(self, node: AgentNode) -> Dict[str, Any]:
        self.execution_log.append({
            "node_id": node.id,
            "node_type": node.node_type,
            "status": "running"
        })
        
        global_context = self.context_manager.get_all()
        result = await node.run(global_context)
        
        self.context_manager.add_execution_history(node.id, node.node_type, result)
        
        self.execution_log.append({
            "node_id": node.id,
            "node_type": node.node_type,
            "status": "completed",
            "result": result
        })
        
        return result
    
    def _find_orchestrator_node(self) -> Optional[AgentNode]:
        for node in self.nodes.values():
            if node.node_type == "orchestrator":
                return node
        return None
    
    def get_execution_log(self) -> list:
        return self.execution_log
    
    def get_context(self) -> Dict[str, Any]:
        return self.context_manager.get_all()
