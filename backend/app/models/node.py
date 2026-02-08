from abc import ABC, abstractmethod
from typing import Literal, Dict, Any
import json

class AgentNode(ABC):
    def __init__(self, id: str, name: str, node_type: Literal["orchestrator", "planner", "executor"], config: Dict[str, Any]):
        self.id = id
        self.name = name
        self.node_type = node_type
        self.config = config
    
    @abstractmethod
    async def run(self, global_context: Dict[str, Any]) -> Dict[str, Any]:
        pass

class OrchestratorNode(AgentNode):
    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "orchestrator", config)
    
    async def run(self, global_context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = self.config.get("system_prompt", "")
        user_prompt = self.config.get("user_prompt", "")
        
        result = {
            "node_id": self.id,
            "node_type": "orchestrator",
            "status": "completed",
            "message": f"Orchestrator {self.name} executed successfully",
            "next_node_id": self.config.get("next_node_id")
        }
        
        return result

class PlannerNode(AgentNode):
    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "planner", config)
    
    async def run(self, global_context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = self.config.get("system_prompt", "")
        user_prompt = self.config.get("user_prompt", "")
        
        plan = {
            "steps": [
                {"step": 1, "description": "Analyze the user request"},
                {"step": 2, "description": "Break down into subtasks"},
                {"step": 3, "description": "Assign to appropriate executors"}
            ]
        }
        
        result = {
            "node_id": self.id,
            "node_type": "planner",
            "status": "completed",
            "message": f"Planner {self.name} generated plan",
            "plan": plan,
            "next_node_id": self.config.get("next_node_id")
        }
        
        return result

class ExecutorNode(AgentNode):
    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "executor", config)
    
    async def run(self, global_context: Dict[str, Any]) -> Dict[str, Any]:
        system_prompt = self.config.get("system_prompt", "")
        user_prompt = self.config.get("user_prompt", "")
        skills = self.config.get("skills", [])
        
        execution_result = {
            "status": "success",
            "output": f"Executor {self.name} completed the task"
        }
        
        result = {
            "node_id": self.id,
            "node_type": "executor",
            "status": "completed",
            "message": f"Executor {self.name} executed successfully",
            "execution_result": execution_result,
            "next_node_id": self.config.get("next_node_id")
        }
        
        return result
