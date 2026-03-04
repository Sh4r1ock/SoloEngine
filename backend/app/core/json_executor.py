# -*- coding: utf-8 -*-
"""
JSON工作流执行器。

@file json_executor.py
@description JSON执行器 - 从JSON导入并执行工作流
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 从JSON数据导入工作流
- 解析节点和边关系
- 执行工作流
- 支持子Agent自动调用

使用场景：
- 调试端执行JSON工作流
- 项目导入执行
"""

import os
import json
import uuid
import logging
import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime
from dataclasses import dataclass

from app.core.database import db_manager, get_db_context
from app.core.agent_executor import AgentExecutor, AgentConfig, AgentExecutorFactory

logger = logging.getLogger(__name__)


@dataclass
class NodeData:
    """节点数据。"""
    id: str
    name: str
    agent_type: str
    model_provider: str
    model_name: str
    system_prompt: str
    user_prompt: str
    skills: List[str]
    mcp_tools: List[str]
    desc: str = ""
    position: Dict[str, float] = None


@dataclass
class EdgeData:
    """边数据。"""
    id: str
    source: str
    target: str
    source_handle: str = None
    target_handle: str = None


class JSONWorkflowExecutor:
    """
    JSON工作流执行器。
    
    从JSON数据导入工作流并执行。
    支持节点依赖解析和子Agent自动调用。
    """

    def __init__(self):
        self.nodes: Dict[str, NodeData] = {}
        self.edges: List[EdgeData] = []
        self.executors: Dict[str, AgentExecutor] = {}
        self.execution_id: Optional[str] = None
        self._execution_context: Dict[str, Any] = {}

    def load_from_json(self, json_data: Dict[str, Any]) -> bool:
        try:
            nodes_data = json_data.get("nodes", [])
            edges_data = json_data.get("edges", [])

            self.nodes.clear()
            self.edges.clear()
            self.executors.clear()

            for node_json in nodes_data:
                node_data = self._parse_node(node_json)
                self.nodes[node_data.id] = node_data

            for edge_json in edges_data:
                edge_data = self._parse_edge(edge_json)
                self.edges.append(edge_data)

            self._build_executors()
            self._build_agent_hierarchy()

            logger.info(f"Loaded workflow: {len(self.nodes)} nodes, {len(self.edges)} edges")
            return True

        except Exception as e:
            logger.error(f"Failed to load workflow from JSON: {e}")
            return False

    def load_from_file(self, file_path: str) -> bool:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                json_data = json.load(f)
            return self.load_from_json(json_data)
        except Exception as e:
            logger.error(f"Failed to load workflow from file: {e}")
            return False

    def _parse_node(self, node_json: Dict[str, Any]) -> NodeData:
        data = node_json.get("data", {})
        return NodeData(
            id=node_json.get("id", str(uuid.uuid4())),
            name=data.get("name", "Unnamed Node"),
            agent_type=data.get("agentType", "executor"),
            model_provider=data.get("model_config", {}).get("provider", "openai"),
            model_name=data.get("model_config", {}).get("model", "gpt-4"),
            system_prompt=data.get("system_prompt", ""),
            user_prompt=data.get("user_prompt", ""),
            skills=data.get("skills", []),
            mcp_tools=data.get("mcp_tools", []),
            desc=data.get("desc", ""),
            position=node_json.get("position")
        )

    def _parse_edge(self, edge_json: Dict[str, Any]) -> EdgeData:
        return EdgeData(
            id=edge_json.get("id", str(uuid.uuid4())),
            source=edge_json.get("source", ""),
            target=edge_json.get("target", ""),
            source_handle=edge_json.get("sourceHandle"),
            target_handle=edge_json.get("targetHandle")
        )

    def _build_executors(self):
        for node_id, node_data in self.nodes.items():
            config = AgentConfig(
                id=node_id,
                name=node_data.name,
                agent_type=node_data.agent_type,
                description=node_data.desc,
                model_provider=node_data.model_provider,
                model_name=node_data.model_name,
                system_prompt=node_data.system_prompt,
                user_prompt=node_data.user_prompt,
                skills=node_data.skills,
                mcp_tools=node_data.mcp_tools
            )
            executor = AgentExecutorFactory.create(config)
            self.executors[node_id] = executor

    def _build_agent_hierarchy(self):
        for edge in self.edges:
            parent = self.executors.get(edge.source)
            child = self.executors.get(edge.target)

            if parent and child:
                parent.register_child_agent(child)

    def get_entry_nodes(self) -> List[str]:
        target_nodes = {edge.target for edge in self.edges}
        entry_nodes = [
            node_id for node_id in self.nodes.keys()
            if node_id not in target_nodes
        ]
        return entry_nodes

    def get_downstream_nodes(self, node_id: str) -> List[str]:
        return [
            edge.target for edge in self.edges
            if edge.source == node_id
        ]

    def get_upstream_nodes(self, node_id: str) -> List[str]:
        return [
            edge.source for edge in self.edges
            if edge.target == node_id
        ]

    async def execute(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        context = context or {}

        with get_db_context() as db:
            self.execution_id = os.urandom(16).hex()
            execution_record = db_manager.create_execution(
                db,
                project_name=context.get("project_name", "json_workflow"),
                input_message=input_message,
                user_id=context.get("user_id", "default_user")
            )
            self.execution_id = execution_record.id

            db_manager.update_execution(db, self.execution_id, status="running")

            self._execution_context = {
                "input": input_message,
                "context": context,
                "results": {},
                "messages": []
            }

            entry_nodes = self.get_entry_nodes()
            if not entry_nodes:
                entry_nodes = list(self.nodes.keys())

            results = {}
            for entry_node_id in entry_nodes:
                result = await self._execute_node(entry_node_id, input_message, context)
                results[entry_node_id] = result

            output = self._aggregate_results(results)

            db_manager.update_execution(
                db, self.execution_id,
                status="completed",
                output_message=output
            )

            return {
                "execution_id": self.execution_id,
                "status": "completed",
                "output": output,
                "node_results": results
            }

    async def _execute_node(self, node_id: str, input_message: str, 
                            context: Dict[str, Any]) -> Dict[str, Any]:
        node_data = self.nodes.get(node_id)
        executor = self.executors.get(node_id)

        if not node_data or not executor:
            return {"error": f"Node {node_id} not found"}

        with get_db_context() as db:
            db_manager.add_execution_step(
                db,
                execution_id=self.execution_id,
                step_type="node_execution",
                node_id=node_id,
                node_name=node_data.name
            )

            await executor.initialize()

            result = await executor.execute(input_message, context)

            self._execution_context["results"][node_id] = result

            downstream_nodes = self.get_downstream_nodes(node_id)
            for downstream_id in downstream_nodes:
                child_input = self._prepare_child_input(node_id, downstream_id, result)
                child_result = await self._execute_node(downstream_id, child_input, context)
                result["child_results"] = result.get("child_results", [])
                result["child_results"].append(child_result)

            return result

    def _prepare_child_input(self, parent_id: str, child_id: str, 
                             parent_result: Dict[str, Any]) -> str:
        child_node = self.nodes.get(child_id)
        if child_node and child_node.user_prompt:
            prompt = child_node.user_prompt
            prompt = prompt.replace("{parent_output}", parent_result.get("output", ""))
            prompt = prompt.replace("{parent_id}", parent_id)
            return prompt
        return parent_result.get("output", "")

    def _aggregate_results(self, results: Dict[str, Any]) -> str:
        outputs = []
        for node_id, result in results.items():
            if isinstance(result, dict):
                output = result.get("output", "")
                if output:
                    node_name = self.nodes.get(node_id, NodeData(id="", name=node_id, agent_type="", 
                                           model_provider="", model_name="", system_prompt="", 
                                           user_prompt="", skills=[], mcp_tools=[])).name
                    outputs.append(f"[{node_name}]: {output}")

        return "\n\n".join(outputs) if outputs else "Execution completed"

    async def execute_node_by_id(self, node_id: str, input_message: str,
                                  context: Dict[str, Any] = None) -> Dict[str, Any]:
        if node_id not in self.executors:
            return {"error": f"Node {node_id} not found"}

        executor = self.executors[node_id]
        await executor.initialize()
        return await executor.execute(input_message, context)

    def get_workflow_info(self) -> Dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": node.id,
                    "name": node.name,
                    "type": node.agent_type,
                    "model": f"{node.model_provider}/{node.model_name}"
                }
                for node in self.nodes.values()
            ],
            "edges": [
                {
                    "id": edge.id,
                    "source": edge.source,
                    "target": edge.target
                }
                for edge in self.edges
            ],
            "entry_nodes": self.get_entry_nodes(),
            "total_nodes": len(self.nodes),
            "total_edges": len(self.edges)
        }

    def to_json(self) -> Dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": node.id,
                    "type": "agentNode",
                    "position": node.position or {"x": 0, "y": 0},
                    "data": {
                        "name": node.name,
                        "desc": node.desc,
                        "agentType": node.agent_type,
                        "model_config": {
                            "provider": node.model_provider,
                            "model": node.model_name
                        },
                        "system_prompt": node.system_prompt,
                        "user_prompt": node.user_prompt,
                        "skills": node.skills,
                        "mcp_tools": node.mcp_tools
                    }
                }
                for node in self.nodes.values()
            ],
            "edges": [
                {
                    "id": edge.id,
                    "source": edge.source,
                    "target": edge.target,
                    "sourceHandle": edge.source_handle,
                    "targetHandle": edge.target_handle
                }
                for edge in self.edges
            ]
        }

    def save_to_file(self, file_path: str) -> bool:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(self.to_json(), f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logger.error(f"Failed to save workflow: {e}")
            return False


class WorkflowRunner:
    """工作流运行器，提供简化的执行接口。"""

    @staticmethod
    async def run_from_json(json_data: Dict[str, Any], input_message: str,
                            context: Dict[str, Any] = None) -> Dict[str, Any]:
        executor = JSONWorkflowExecutor()
        if executor.load_from_json(json_data):
            return await executor.execute(input_message, context)
        return {"error": "Failed to load workflow"}

    @staticmethod
    async def run_from_file(file_path: str, input_message: str,
                            context: Dict[str, Any] = None) -> Dict[str, Any]:
        executor = JSONWorkflowExecutor()
        if executor.load_from_file(file_path):
            return await executor.execute(input_message, context)
        return {"error": "Failed to load workflow"}

    @staticmethod
    async def run_node(json_data: Dict[str, Any], node_id: str,
                       input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        executor = JSONWorkflowExecutor()
        if executor.load_from_json(json_data):
            return await executor.execute_node_by_id(node_id, input_message, context)
        return {"error": "Failed to load workflow"}
