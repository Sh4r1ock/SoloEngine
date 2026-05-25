"""
SoloEngine : 调度器模块

@file scheduler.py
@description 调度器 - 工作流调度执行模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 调度和执行工作流节点
    - 管理执行顺序
    - 处理节点依赖
    - 支持并行执行
    - 智能调度策略
    - 上下文变量传递

依赖:
    - asyncio: 异步IO支持
    - typing: 类型注解支持
    - enum: 枚举类型支持
    - datetime: 日期时间处理
    - app.models.node: 节点模型
    - app.core.context_manager: 上下文管理器
    - app.core.tool_registry: 工具注册表

使用示例:
    - from app.core.scheduler import Scheduler, ExecutionMode
    - scheduler = Scheduler(collaboration_graph, ExecutionMode.ADAPTIVE)
    - result = await scheduler.start(initial_context)

使用场景：
    - 工作流执行引擎
    - 节点调度和上下文管理

注意事项：
    - 需要正确配置协作图
    - 支持上下文变量传递
    - 并行执行需要正确处理依赖关系
"""
import asyncio
from typing import Dict, Any, Optional, List, Set
from enum import Enum
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models.node import AgentNode
from app.core.context_manager import ContextManager


class ExecutionMode(Enum):
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    ADAPTIVE = "adaptive"


class NodeStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class Scheduler:
    def __init__(self, collaboration_graph: Dict[str, Any], execution_mode: ExecutionMode = ExecutionMode.ADAPTIVE):
        self.collaboration_graph = collaboration_graph
        self.nodes = collaboration_graph["nodes"]
        self.edges = collaboration_graph["edges"]
        self.context_manager = ContextManager()
        self.current_node_id: Optional[str] = None
        self.execution_log: List[Dict[str, Any]] = []
        self.execution_mode = execution_mode
        self.node_status: Dict[str, NodeStatus] = {}
        self.node_results: Dict[str, Dict[str, Any]] = {}
        self._execution_lock = asyncio.Lock()
        self._max_parallel_tasks = 10
        self._dependency_graph: Dict[str, Set[str]] = {}
        self._reverse_dependency_graph: Dict[str, Set[str]] = {}
        
        self._build_dependency_graph()
        self._initialize_node_status()
    
    def _build_dependency_graph(self):
        self._dependency_graph = {node_id: set() for node_id in self.nodes.keys()}
        self._reverse_dependency_graph = {node_id: set() for node_id in self.nodes.keys()}
        
        for edge in self.edges:
            source_id = edge.get("source")
            target_id = edge.get("target")
            if source_id and target_id:
                self._dependency_graph[target_id].add(source_id)
                self._reverse_dependency_graph[source_id].add(target_id)
    
    def _initialize_node_status(self):
        for node_id in self.nodes.keys():
            self.node_status[node_id] = NodeStatus.PENDING
    
    async def start(self, initial_context: Dict[str, Any]) -> Dict[str, Any]:
        self.context_manager.reset()
        self._initialize_node_status()
        self.node_results.clear()
        self.execution_log.clear()
        
        for key, value in initial_context.items():
            self.context_manager.update(key, value)
        
        orchestrator_node = self._find_orchestrator_node()
        if not orchestrator_node:
            raise ValueError("No orchestrator node found in the collaboration graph")
        
        self.current_node_id = orchestrator_node.id
        
        if self.execution_mode == ExecutionMode.SEQUENTIAL:
            result = await self._execute_sequential(orchestrator_node)
        elif self.execution_mode == ExecutionMode.PARALLEL:
            result = await self._execute_parallel()
        else:
            result = await self._execute_adaptive(orchestrator_node)
        
        return result
    
    async def _execute_sequential(self, start_node: AgentNode) -> Dict[str, Any]:
        current_node = start_node
        
        while current_node:
            result = await self.execute_node(current_node)
            
            next_node_id = result.get("next_node_id")
            if not next_node_id:
                return {
                    "status": "completed",
                    "message": "Execution completed successfully",
                    "final_result": result,
                    "execution_log": self.execution_log
                }
            
            next_node = self.nodes.get(next_node_id)
            if not next_node:
                raise ValueError(f"Node {next_node_id} not found")
            
            self.current_node_id = next_node_id
            current_node = next_node
        
        return {
            "status": "completed",
            "message": "Execution completed",
            "execution_log": self.execution_log
        }
    
    async def _execute_parallel(self) -> Dict[str, Any]:
        ready_nodes = self._get_ready_nodes()
        
        if not ready_nodes:
            return {
                "status": "failed",
                "message": "No nodes ready for execution",
                "execution_log": self.execution_log
            }
        
        semaphore = asyncio.Semaphore(self._max_parallel_tasks)
        
        async def execute_with_semaphore(node: AgentNode):
            async with semaphore:
                return await self.execute_node(node)
        
        while True:
            ready_nodes = self._get_ready_nodes()
            
            if not ready_nodes:
                if self._all_nodes_completed():
                    break
                
                running_nodes = [nid for nid, status in self.node_status.items() 
                               if status == NodeStatus.RUNNING]
                if running_nodes:
                    await asyncio.sleep(0.1)
                    continue
                else:
                    pending_nodes = [nid for nid, status in self.node_status.items() 
                                   if status == NodeStatus.PENDING]
                    if pending_nodes:
                        return {
                            "status": "failed",
                            "message": f"Deadlock detected. Pending nodes: {pending_nodes}",
                            "execution_log": self.execution_log
                        }
                    break
            
            tasks = [execute_with_semaphore(self.nodes[node_id]) for node_id in ready_nodes]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for node_id, result in zip(ready_nodes, results):
                if isinstance(result, Exception):
                    self.node_status[node_id] = NodeStatus.FAILED
                    self._log_node_error(node_id, str(result))
                else:
                    self.node_results[node_id] = result
        
        return self._build_final_result()
    
    async def _execute_adaptive(self, start_node: AgentNode) -> Dict[str, Any]:
        result = await self.execute_node(start_node)
        
        next_nodes = self._get_parallel_candidates(start_node.id)
        
        if len(next_nodes) <= 1:
            return await self._execute_sequential_from_result(result)
        
        return await self._execute_parallel_from_node(start_node.id, result)
    
    async def _execute_sequential_from_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        next_node_id = result.get("next_node_id")
        
        while next_node_id:
            next_node = self.nodes.get(next_node_id)
            if not next_node:
                break
            
            self.current_node_id = next_node_id
            result = await self.execute_node(next_node)
            next_node_id = result.get("next_node_id")
        
        return self._build_final_result()
    
    async def _execute_parallel_from_node(self, start_node_id: str, start_result: Dict[str, Any]) -> Dict[str, Any]:
        self.node_results[start_node_id] = start_result
        
        return await self._execute_parallel()
    
    def _get_parallel_candidates(self, node_id: str) -> List[str]:
        downstream_nodes = self._reverse_dependency_graph.get(node_id, set())
        
        parallel_candidates = []
        for candidate_id in downstream_nodes:
            dependencies = self._dependency_graph.get(candidate_id, set())
            if len(dependencies) == 1 and node_id in dependencies:
                parallel_candidates.append(candidate_id)
        
        return parallel_candidates
    
    def _get_ready_nodes(self) -> List[str]:
        ready_nodes = []
        
        for node_id, status in self.node_status.items():
            if status != NodeStatus.PENDING:
                continue
            
            dependencies = self._dependency_graph.get(node_id, set())
            all_deps_completed = all(
                self.node_status.get(dep_id) == NodeStatus.COMPLETED
                for dep_id in dependencies
            )
            
            if all_deps_completed:
                ready_nodes.append(node_id)
        
        return ready_nodes
    
    def _all_nodes_completed(self) -> bool:
        return all(
            status in (NodeStatus.COMPLETED, NodeStatus.SKIPPED, NodeStatus.FAILED)
            for status in self.node_status.values()
        )
    
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
        async with self._execution_lock:
            self.node_status[node.id] = NodeStatus.RUNNING
        
        self.execution_log.append({
            "node_id": node.id,
            "node_type": node.node_type,
            "status": "running",
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        })
        
        try:
            global_context = self.context_manager.get_all()
            
            for dep_id in self._dependency_graph.get(node.id, set()):
                if dep_id in self.node_results:
                    dep_result = self.node_results[dep_id]
                    global_context[f"result_{dep_id}"] = dep_result
            
            result = await node.run(global_context)
            
            self.context_manager.add_execution_history(node.id, node.node_type, result)
            
            async with self._execution_lock:
                self.node_status[node.id] = NodeStatus.COMPLETED
                self.node_results[node.id] = result
            
            self.execution_log.append({
                "node_id": node.id,
                "node_type": node.node_type,
                "status": "completed",
                "result": result,
                "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
            })
            
            return result
            
        except Exception as e:
            async with self._execution_lock:
                self.node_status[node.id] = NodeStatus.FAILED
            
            self._log_node_error(node.id, str(e))
            raise
    
    def _log_node_error(self, node_id: str, error_message: str):
        self.execution_log.append({
            "node_id": node_id,
            "status": "failed",
            "error": error_message,
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        })
    
    def _build_final_result(self) -> Dict[str, Any]:
        completed_count = sum(1 for s in self.node_status.values() if s == NodeStatus.COMPLETED)
        failed_count = sum(1 for s in self.node_status.values() if s == NodeStatus.FAILED)
        skipped_count = sum(1 for s in self.node_status.values() if s == NodeStatus.SKIPPED)
        
        orchestrator_result = None
        for node_id, result in self.node_results.items():
            node = self.nodes.get(node_id)
            if node and node.node_type == "orchestrator":
                orchestrator_result = result
                break
        
        final_result = orchestrator_result or list(self.node_results.values())[-1] if self.node_results else {}
        
        return {
            "status": "completed" if failed_count == 0 else "partial_failure",
            "message": f"Execution completed: {completed_count} succeeded, {failed_count} failed, {skipped_count} skipped",
            "final_result": final_result,
            "execution_summary": {
                "total_nodes": len(self.nodes),
                "completed": completed_count,
                "failed": failed_count,
                "skipped": skipped_count
            },
            "execution_log": self.execution_log,
            "node_results": self.node_results
        }
    
    def _find_orchestrator_node(self) -> Optional[AgentNode]:
        for node in self.nodes.values():
            if node.node_type == "orchestrator":
                return node
        return None
    
    def get_execution_log(self) -> list:
        return self.execution_log
    
    def get_context(self) -> Dict[str, Any]:
        return self.context_manager.get_all()
    
    def get_node_status(self) -> Dict[str, str]:
        return {node_id: status.value for node_id, status in self.node_status.items()}
    
    def get_execution_summary(self) -> Dict[str, Any]:
        return {
            "total_nodes": len(self.nodes),
            "status_distribution": {
                status.value: sum(1 for s in self.node_status.values() if s == status)
                for status in NodeStatus
            },
            "execution_mode": self.execution_mode.value
        }
    
    async def execute_nodes_parallel(self, node_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        results = {}
        semaphore = asyncio.Semaphore(self._max_parallel_tasks)
        
        async def execute_single(node_id: str):
            async with semaphore:
                node = self.nodes.get(node_id)
                if node:
                    return node_id, await self.execute_node(node)
                return node_id, {"error": "Node not found"}
        
        tasks = [execute_single(nid) for nid in node_ids]
        task_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in task_results:
            if isinstance(result, Exception):
                continue
            node_id, node_result = result
            results[node_id] = node_result
        
        return results
    
    def set_execution_mode(self, mode: ExecutionMode):
        self.execution_mode = mode
    
    def set_max_parallel_tasks(self, max_tasks: int):
        self._max_parallel_tasks = max(1, min(max_tasks, 50))
