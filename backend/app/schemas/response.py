# -*- coding: utf-8 -*-
"""
SoloEngine : API响应Schema模块

@file response.py
@description API响应数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义API响应的数据模型，包括：
    - 节点数据Schema
    - 边数据Schema
    - 画布Schema
    - 项目Schema
    - 工具Schema
    - 执行请求/响应Schema
    - 事件Schema

依赖:
    - pydantic: 数据验证
    - typing: 类型注解

使用示例:
    - from app.schemas.response import ProjectSchema
    - project = ProjectSchema(id="1", name="test", canvas=canvas)
"""

from pydantic import BaseModel
from typing import List, Dict, Any


class NodeDataSchema(BaseModel):
    """节点数据Schema"""
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]


class EdgeDataSchema(BaseModel):
    """边数据Schema"""
    id: str
    source: str
    target: str
    label: str


class CanvasSchema(BaseModel):
    """画布Schema"""
    nodes: List[NodeDataSchema]
    edges: List[EdgeDataSchema]


class ProjectSchema(BaseModel):
    """项目Schema"""
    id: str
    name: str
    canvas: CanvasSchema


class ToolSchema(BaseModel):
    """工具Schema"""
    id: str
    name: str
    type: str
    config: Dict[str, Any]


class ExecutionRequestSchema(BaseModel):
    """执行请求Schema"""
    input: str


class ExecutionResponseSchema(BaseModel):
    """执行响应Schema"""
    task_id: str
    status: str
    message: str


class AgentUpdateEvent(BaseModel):
    """Agent更新事件Schema"""
    node_id: str
    status: str
    message: str


class ToolCallEvent(BaseModel):
    """工具调用事件Schema"""
    tool_id: str
    args: Dict[str, Any]
    result: Any


class ResponseStreamingEvent(BaseModel):
    """响应流事件Schema"""
    text: str
    done: bool


class ExecutionCompleteEvent(BaseModel):
    """执行完成事件Schema"""
    task_id: str
    result: Dict[str, Any]
