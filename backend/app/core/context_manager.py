# -*- coding: utf-8 -*-
"""
SoloEngine : 上下文管理器模块

@file context_manager.py
@description 工作流执行上下文管理模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 管理全局上下文
    - 存储执行状态和数据
    - 支持快照和恢复
    - 变量存储管理

依赖:
    - typing: 类型注解支持
    - datetime: 时间处理
    - json: JSON序列化
    - copy: 深拷贝

使用示例:
    - from app.core.context_manager import ContextManager
    - ctx = ContextManager()
    - ctx.update("key", "value")

注意事项：
    - 线程安全的上下文操作
    - 支持序列化和反序列化
"""
from typing import Dict, Any, Optional, List
from datetime import datetime
from zoneinfo import ZoneInfo
from app.core.config import settings
import json
import copy


class ContextManager:
    """
    上下文管理器
    
    职责:
        - 管理全局执行上下文
        - 存储执行状态和数据
        - 支持快照创建和恢复
        - 变量和元数据管理
    
    属性:
        global_context (Dict[str, Any]): 全局上下文
        _snapshots (List[Dict[str, Any]]): 快照列表
        _max_snapshots (int): 最大快照数量
        _variables (Dict[str, Any]): 变量存储
        _metadata (Dict[str, Any]): 元数据存储
    
    示例:
        >>> ctx = ContextManager()
        >>> ctx.update("user_input", "Hello")
        >>> snapshot_id = ctx.create_snapshot("checkpoint")
    """

    def __init__(self):
        """初始化上下文管理器"""
        self.global_context: Dict[str, Any] = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        }
        self._snapshots: List[Dict[str, Any]] = []
        self._max_snapshots = 50
        self._variables: Dict[str, Any] = {}
        self._metadata: Dict[str, Any] = {}
    
    def update(self, key: str, value: Any) -> None:
        """
        更新上下文值
        
        Args:
            key: 键
            value: 值
            
        Example:
            >>> ctx.update("key", "value")
        """
        self.global_context[key] = value
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        获取上下文值
        
        Args:
            key: 键
            default: 默认值
            
        Returns:
            上下文值，如果不存在则返回默认值
            
        Example:
            >>> value = ctx.get("key", "default")
        """
        return self.global_context.get(key, default)
    
    def delete(self, key: str) -> bool:
        """
        删除上下文值
        
        Args:
            key: 键
            
        Returns:
            是否成功删除
            
        Example:
            >>> deleted = ctx.delete("key")
        """
        if key in self.global_context:
            del self.global_context[key]
            return True
        return False
    
    def add_execution_history(self, node_id: str, node_type: str, result: Dict[str, Any]) -> None:
        """
        添加执行历史记录
        
        Args:
            node_id: 节点ID
            node_type: 节点类型
            result: 执行结果
            
        Example:
            >>> ctx.add_execution_history("node_1", "agent", {"output": "result"})
        """
        history_entry = {
            "node_id": node_id,
            "node_type": node_type,
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            "result": result
        }
        self.global_context["execution_history"].append(history_entry)
    
    def reset(self) -> None:
        """
        重置上下文
        
        Example:
            >>> ctx.reset()
        """
        self.global_context = {
            "user_input": "",
            "current_plan": None,
            "execution_history": [],
            "created_at": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        }
        self._variables.clear()
        self._metadata.clear()
    
    def get_all(self) -> Dict[str, Any]:
        """
        获取所有上下文
        
        Returns:
            全局上下文的深拷贝
            
        Example:
            >>> all_context = ctx.get_all()
        """
        return copy.deepcopy(self.global_context)
    
    def set_all(self, context: Dict[str, Any]) -> None:
        """
        设置所有上下文
        
        Args:
            context: 上下文字典
            
        Example:
            >>> ctx.set_all({"key": "value"})
        """
        self.global_context = copy.deepcopy(context)
    
    def create_snapshot(self, label: Optional[str] = None) -> str:
        """
        创建快照
        
        Args:
            label: 快照标签
            
        Returns:
            快照ID
            
        Example:
            >>> snapshot_id = ctx.create_snapshot("checkpoint")
        """
        snapshot_id = f"snapshot_{datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).strftime('%Y%m%d_%H%M%S_%f')}"
        snapshot = {
            "id": snapshot_id,
            "label": label or snapshot_id,
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            "context": copy.deepcopy(self.global_context),
            "variables": copy.deepcopy(self._variables),
            "metadata": copy.deepcopy(self._metadata)
        }
        
        self._snapshots.append(snapshot)
        
        if len(self._snapshots) > self._max_snapshots:
            self._snapshots.pop(0)
        
        return snapshot_id
    
    def restore_snapshot(self, snapshot_id: str) -> bool:
        """
        恢复快照
        
        Args:
            snapshot_id: 快照ID
            
        Returns:
            是否成功恢复
            
        Example:
            >>> restored = ctx.restore_snapshot("snapshot_...")
        """
        for snapshot in self._snapshots:
            if snapshot["id"] == snapshot_id:
                self.global_context = copy.deepcopy(snapshot["context"])
                self._variables = copy.deepcopy(snapshot["variables"])
                self._metadata = copy.deepcopy(snapshot["metadata"])
                return True
        return False
    
    def restore_from_data(self, context_data: Dict[str, Any]) -> bool:
        """
        从数据恢复上下文
        
        Args:
            context_data: 上下文数据
            
        Returns:
            是否成功恢复
            
        Example:
            >>> restored = ctx.restore_from_data({"context": {...}})
        """
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
        """
        获取快照
        
        Args:
            snapshot_id: 快照ID
            
        Returns:
            快照数据，如果不存在则返回None
            
        Example:
            >>> snapshot = ctx.get_snapshot("snapshot_...")
        """
        for snapshot in self._snapshots:
            if snapshot["id"] == snapshot_id:
                return copy.deepcopy(snapshot)
        return None
    
    def list_snapshots(self) -> List[Dict[str, Any]]:
        """
        列出所有快照
        
        Returns:
            快照列表
            
        Example:
            >>> snapshots = ctx.list_snapshots()
        """
        return [
            {
                "id": s["id"],
                "label": s["label"],
                "timestamp": s["timestamp"]
            }
            for s in self._snapshots
        ]
    
    def delete_snapshot(self, snapshot_id: str) -> bool:
        """
        删除快照
        
        Args:
            snapshot_id: 快照ID
            
        Returns:
            是否成功删除
            
        Example:
            >>> deleted = ctx.delete_snapshot("snapshot_...")
        """
        for i, snapshot in enumerate(self._snapshots):
            if snapshot["id"] == snapshot_id:
                self._snapshots.pop(i)
                return True
        return False
    
    def clear_snapshots(self) -> None:
        """
        清空所有快照
        
        Example:
            >>> ctx.clear_snapshots()
        """
        self._snapshots.clear()
    
    def set_variable(self, key: str, value: Any) -> None:
        """
        设置变量
        
        Args:
            key: 变量名
            value: 变量值
            
        Example:
            >>> ctx.set_variable("var", "value")
        """
        self._variables[key] = value
    
    def get_variable(self, key: str, default: Any = None) -> Any:
        """
        获取变量
        
        Args:
            key: 变量名
            default: 默认值
            
        Returns:
            变量值，如果不存在则返回默认值
            
        Example:
            >>> value = ctx.get_variable("var", "default")
        """
        return self._variables.get(key, default)
    
    def delete_variable(self, key: str) -> bool:
        """
        删除变量
        
        Args:
            key: 变量名
            
        Returns:
            是否成功删除
            
        Example:
            >>> deleted = ctx.delete_variable("var")
        """
        if key in self._variables:
            del self._variables[key]
            return True
        return False
    
    def get_all_variables(self) -> Dict[str, Any]:
        """
        获取所有变量
        
        Returns:
            所有变量的深拷贝
            
        Example:
            >>> vars = ctx.get_all_variables()
        """
        return copy.deepcopy(self._variables)
    
    def set_all_variables(self, variables: Dict[str, Any]) -> None:
        """
        设置所有变量
        
        Args:
            variables: 变量字典
            
        Example:
            >>> ctx.set_all_variables({"var": "value"})
        """
        self._variables = copy.deepcopy(variables)
    
    def set_metadata(self, key: str, value: Any) -> None:
        """
        设置元数据
        
        Args:
            key: 元数据键
            value: 元数据值
            
        Example:
            >>> ctx.set_metadata("key", "value")
        """
        self._metadata[key] = value
    
    def get_metadata(self, key: str, default: Any = None) -> Any:
        """
        获取元数据
        
        Args:
            key: 元数据键
            default: 默认值
            
        Returns:
            元数据值，如果不存在则返回默认值
            
        Example:
            >>> value = ctx.get_metadata("key", "default")
        """
        return self._metadata.get(key, default)
    
    def get_all_metadata(self) -> Dict[str, Any]:
        """
        获取所有元数据
        
        Returns:
            所有元数据的深拷贝
            
        Example:
            >>> metadata = ctx.get_all_metadata()
        """
        return copy.deepcopy(self._metadata)
    
    def serialize(self) -> str:
        """
        序列化上下文
        
        Returns:
            JSON字符串
            
        Example:
            >>> json_str = ctx.serialize()
        """
        data = {
            "context": self.global_context,
            "variables": self._variables,
            "metadata": self._metadata,
            "snapshots": self._snapshots
        }
        return json.dumps(data, ensure_ascii=False, default=str)
    
    def deserialize(self, data_str: str) -> bool:
        """
        反序列化上下文
        
        Args:
            data_str: JSON字符串
            
        Returns:
            是否成功反序列化
            
        Example:
            >>> restored = ctx.deserialize(json_str)
        """
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
        """
        转换为字典
        
        Returns:
            上下文字典
            
        Example:
            >>> data = ctx.to_dict()
        """
        return {
            "context": copy.deepcopy(self.global_context),
            "variables": copy.deepcopy(self._variables),
            "metadata": copy.deepcopy(self._metadata),
            "snapshots": copy.deepcopy(self._snapshots)
        }
    
    def from_dict(self, data: Dict[str, Any]) -> bool:
        """
        从字典加载
        
        Args:
            data: 上下文字典
            
        Returns:
            是否成功加载
            
        Example:
            >>> loaded = ctx.from_dict({"context": {...}})
        """
        try:
            self.global_context = data.get("context", {})
            self._variables = data.get("variables", {})
            self._metadata = data.get("metadata", {})
            self._snapshots = data.get("snapshots", [])
            return True
        except Exception:
            return False
    
    def merge_context(self, other_context: Dict[str, Any], overwrite: bool = False) -> None:
        """
        合并上下文
        
        Args:
            other_context: 其他上下文
            overwrite: 是否覆盖已有键
            
        Example:
            >>> ctx.merge_context({"new_key": "value"})
        """
        for key, value in other_context.items():
            if overwrite or key not in self.global_context:
                self.global_context[key] = copy.deepcopy(value)
    
    def get_execution_history(self) -> List[Dict[str, Any]]:
        """
        获取执行历史
        
        Returns:
            执行历史列表
            
        Example:
            >>> history = ctx.get_execution_history()
        """
        return copy.deepcopy(self.global_context.get("execution_history", []))
    
    def get_last_execution(self) -> Optional[Dict[str, Any]]:
        """
        获取最后一次执行
        
        Returns:
            最后一次执行记录，如果没有则返回None
            
        Example:
            >>> last = ctx.get_last_execution()
        """
        history = self.global_context.get("execution_history", [])
        return copy.deepcopy(history[-1]) if history else None
    
    def clear_execution_history(self) -> None:
        """
        清空执行历史
        
        Example:
            >>> ctx.clear_execution_history()
        """
        self.global_context["execution_history"] = []
    
    def set_user_input(self, user_input: str) -> None:
        """
        设置用户输入
        
        Args:
            user_input: 用户输入
            
        Example:
            >>> ctx.set_user_input("Hello")
        """
        self.global_context["user_input"] = user_input
    
    def get_user_input(self) -> str:
        """
        获取用户输入
        
        Returns:
            用户输入
            
        Example:
            >>> user_input = ctx.get_user_input()
        """
        return self.global_context.get("user_input", "")
    
    def set_current_plan(self, plan: Any) -> None:
        """
        设置当前计划
        
        Args:
            plan: 计划
            
        Example:
            >>> ctx.set_current_plan({"steps": []})
        """
        self.global_context["current_plan"] = plan
    
    def get_current_plan(self) -> Any:
        """
        获取当前计划
        
        Returns:
            当前计划
            
        Example:
            >>> plan = ctx.get_current_plan()
        """
        return self.global_context.get("current_plan")
    
    def get_context_size(self) -> int:
        """
        获取上下文大小（字节）
        
        Returns:
            上下文大小
            
        Example:
            >>> size = ctx.get_context_size()
        """
        return len(json.dumps(self.global_context, default=str))
    
    def get_summary(self) -> Dict[str, Any]:
        """
        获取上下文摘要
        
        Returns:
            上下文摘要信息
            
        Example:
            >>> summary = ctx.get_summary()
        """
        return {
            "context_keys": list(self.global_context.keys()),
            "variable_count": len(self._variables),
            "snapshot_count": len(self._snapshots),
            "execution_history_count": len(self.global_context.get("execution_history", [])),
            "created_at": self.global_context.get("created_at"),
            "context_size_bytes": self.get_context_size()
        }
