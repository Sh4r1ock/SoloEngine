from typing import Dict, Any, Optional
from datetime import datetime

class ContextManager:
    def __init__(self):
        self.global_context = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now().isoformat()
        }
    
    def update(self, key: str, value: Any):
        self.global_context[key] = value
    
    def get(self, key: str, default: Any = None) -> Any:
        return self.global_context.get(key, default)
    
    def add_execution_history(self, node_id: str, node_type: str, result: Dict[str, Any]):
        history_entry = {
            "node_id": node_id,
            "node_type": node_type,
            "timestamp": datetime.now().isoformat(),
            "result": result
        }
        self.global_context["execution_history"].append(history_entry)
    
    def reset(self):
        self.global_context = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now().isoformat()
        }
    
    def get_all(self) -> Dict[str, Any]:
        return self.global_context.copy()
