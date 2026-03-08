"""
@file context_manager.py
@description 上下文管理器 - 工作流执行上下文管理模块
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 管理全局上下文
- 存储执行状态和数据
- 支持快照和恢复
- 变量存储管理

使用场景：
- 工作流执行过程中的状态管理
- 节点间数据传递

注意事项：
- 线程安全的上下文操作
- 支持序列化和反序列化
"""
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import json
import copy


class ContextManager:
    def __init__(self):
        self.global_context: Dict[str, Any] = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        self._snapshots: List[Dict[str, Any]] = []
        self._max_snapshots = 50
        self._variables: Dict[str, Any] = {}
        self._metadata: Dict[str, Any] = {}
    
    def update(self, key: str, value: Any) -> None:
        self.global_context[key] = value
    
    def get(self, key: str, default: Any = None) -> Any:
        return self.global_context.get(key, default)
    
    def delete(self, key: str) -> bool:
        if key in self.global_context:
            del self.global_context[key]
            return True
        return False
    
    def add_execution_history(self, node_id: str, node_type: str, result: Dict[str, Any]) -> None:
        history_entry = {
            "node_id": node_id,
            "node_type": node_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "result": result
        }
        self.global_context["execution_history"].append(history_entry)
    
    def reset(self) -> None:
        self.global_context = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        self._variables.clear()
        self._metadata.clear()
    
    def get_all(self) -> Dict[str, Any]:
        return copy.deepcopy(self.global_context)
    
    def set_all(self, context: Dict[str, Any]) -> None:
        self.global_context = copy.deepcopy(context)
    
    def create_snapshot(self, label: Optional[str] = None) -> str:
        snapshot_id = f"snapshot_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}"
        snapshot = {
            "id": snapshot_id,
            "label": label or snapshot_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "context": copy.deepcopy(self.global_context),
            "variables": copy.deepcopy(self._variables),
            "metadata": copy.deepcopy(self._metadata)
        }
        
        self._snapshots.append(snapshot)
        
        if len(self._snapshots) > self._max_snapshots:
            self._snapshots.pop(0)
        
        return snapshot_id
    
    def restore_snapshot(self, snapshot_id: str) -> bool:
        for snapshot in self._snapshots:
            if snapshot["id"] == snapshot_id:
                self.global_context = copy.deepcopy(snapshot["context"])
                self._variables = copy.deepcopy(snapshot["variables"])
                self._metadata = copy.deepcopy(snapshot["metadata"])
                return True
        return False
    
    def restore_from_data(self, context_data: Dict[str, Any]) -> bool:
        try:
            if "context" in context_data:
                self.global_context = copy.deepcopy(context_data["context"])
            if "variables" in context_data:
                self._variables = copy.deepcopy(context_data["variables"])
            if "metadata" in context_data:
                self._metadata = copy.deepcopy(context_data["metadata"])
            return True
        except Exception:
            return False
    
    def get_snapshot(self, snapshot_id: str) -> Optional[Dict[str, Any]]:
        for snapshot in self._snapshots:
            if snapshot["id"] == snapshot_id:
                return copy.deepcopy(snapshot)
        return None
    
    def list_snapshots(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": s["id"],
                "label": s["label"],
                "timestamp": s["timestamp"]
            }
            for s in self._snapshots
        ]
    
    def delete_snapshot(self, snapshot_id: str) -> bool:
        for i, snapshot in enumerate(self._snapshots):
            if snapshot["id"] == snapshot_id:
                self._snapshots.pop(i)
                return True
        return False
    
    def clear_snapshots(self) -> None:
        self._snapshots.clear()
    
    def set_variable(self, key: str, value: Any) -> None:
        self._variables[key] = value
    
    def get_variable(self, key: str, default: Any = None) -> Any:
        return self._variables.get(key, default)
    
    def delete_variable(self, key: str) -> bool:
        if key in self._variables:
            del self._variables[key]
            return True
        return False
    
    def get_all_variables(self) -> Dict[str, Any]:
        return copy.deepcopy(self._variables)
    
    def set_all_variables(self, variables: Dict[str, Any]) -> None:
        self._variables = copy.deepcopy(variables)
    
    def set_metadata(self, key: str, value: Any) -> None:
        self._metadata[key] = value
    
    def get_metadata(self, key: str, default: Any = None) -> Any:
        return self._metadata.get(key, default)
    
    def get_all_metadata(self) -> Dict[str, Any]:
        return copy.deepcopy(self._metadata)
    
    def serialize(self) -> str:
        data = {
            "context": self.global_context,
            "variables": self._variables,
            "metadata": self._metadata,
            "snapshots": self._snapshots
        }
        return json.dumps(data, ensure_ascii=False, default=str)
    
    def deserialize(self, data_str: str) -> bool:
        try:
            data = json.loads(data_str)
            self.global_context = data.get("context", {})
            self._variables = data.get("variables", {})
            self._metadata = data.get("metadata", {})
            self._snapshots = data.get("snapshots", [])
            return True
        except Exception:
            return False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "context": copy.deepcopy(self.global_context),
            "variables": copy.deepcopy(self._variables),
            "metadata": copy.deepcopy(self._metadata),
            "snapshots": copy.deepcopy(self._snapshots)
        }
    
    def from_dict(self, data: Dict[str, Any]) -> bool:
        try:
            self.global_context = data.get("context", {})
            self._variables = data.get("variables", {})
            self._metadata = data.get("metadata", {})
            self._snapshots = data.get("snapshots", [])
            return True
        except Exception:
            return False
    
    def merge_context(self, other_context: Dict[str, Any], overwrite: bool = False) -> None:
        for key, value in other_context.items():
            if overwrite or key not in self.global_context:
                self.global_context[key] = copy.deepcopy(value)
    
    def get_execution_history(self) -> List[Dict[str, Any]]:
        return copy.deepcopy(self.global_context.get("execution_history", []))
    
    def get_last_execution(self) -> Optional[Dict[str, Any]]:
        history = self.global_context.get("execution_history", [])
        return copy.deepcopy(history[-1]) if history else None
    
    def clear_execution_history(self) -> None:
        self.global_context["execution_history"] = []
    
    def set_user_input(self, user_input: str) -> None:
        self.global_context["user_input"] = user_input
    
    def get_user_input(self) -> str:
        return self.global_context.get("user_input", "")
    
    def set_current_plan(self, plan: Any) -> None:
        self.global_context["current_plan"] = plan
    
    def get_current_plan(self) -> Any:
        return self.global_context.get("current_plan")
    
    def get_context_size(self) -> int:
        return len(json.dumps(self.global_context, default=str))
    
    def get_summary(self) -> Dict[str, Any]:
        return {
            "context_keys": list(self.global_context.keys()),
            "variable_count": len(self._variables),
            "snapshot_count": len(self._snapshots),
            "execution_history_count": len(self.global_context.get("execution_history", [])),
            "created_at": self.global_context.get("created_at"),
            "context_size_bytes": self.get_context_size()
        }
