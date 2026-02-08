from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class NodeDataSchema(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]

class EdgeDataSchema(BaseModel):
    id: str
    source: str
    target: str
    label: str

class CanvasSchema(BaseModel):
    nodes: List[NodeDataSchema]
    edges: List[EdgeDataSchema]

class ProjectSchema(BaseModel):
    id: str
    name: str
    canvas: CanvasSchema

class ToolSchema(BaseModel):
    id: str
    name: str
    type: str
    config: Dict[str, Any]

class ExecutionRequestSchema(BaseModel):
    input: str

class ExecutionResponseSchema(BaseModel):
    task_id: str
    status: str
    message: str

class AgentUpdateEvent(BaseModel):
    node_id: str
    status: str
    message: str

class ToolCallEvent(BaseModel):
    tool_id: str
    args: Dict[str, Any]
    result: Any

class ResponseStreamingEvent(BaseModel):
    text: str
    done: bool

class ExecutionCompleteEvent(BaseModel):
    task_id: str
    result: Dict[str, Any]
