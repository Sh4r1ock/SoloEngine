from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Any
import json
import uuid
from app.core.canvas_parser import CanvasParser
from app.core.scheduler import Scheduler
from app.schemas.response import AgentUpdateEvent, ToolCallEvent, ResponseStreamingEvent, ExecutionCompleteEvent

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, task_id: str):
        await websocket.accept()
        self.active_connections[task_id] = websocket
    
    def disconnect(self, task_id: str):
        if task_id in self.active_connections:
            del self.active_connections[task_id]
    
    async def send_event(self, task_id: str, event: Dict[str, Any]):
        if task_id in self.active_connections:
            await self.active_connections[task_id].send_json(event)

manager = ConnectionManager()

@router.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await manager.connect(websocket, task_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "execution-start":
                project_id = data.get("project_id")
                user_input = data.get("input", "")
                
                await execute_workflow(task_id, project_id, user_input)
            
    except WebSocketDisconnect:
        manager.disconnect(task_id)

async def execute_workflow(task_id: str, project_id: str, user_input: str):
    from app.api.v1.projects import projects_db
    
    if project_id not in projects_db:
        await manager.send_event(task_id, {
            "type": "error",
            "message": "Project not found"
        })
        return
    
    canvas_data = projects_db[project_id]["canvas"]
    
    try:
        协作图 = CanvasParser.parse(canvas_data)
    except ValueError as e:
        await manager.send_event(task_id, {
            "type": "error",
            "message": str(e)
        })
        return
    
    scheduler = Scheduler(协作图)
    initial_context = {"user_input": user_input}
    
    try:
        result = await scheduler.start(initial_context)
        
        await manager.send_event(task_id, {
            "type": "agent-update",
            "node_id": result.get("node_id"),
            "status": result.get("status"),
            "message": result.get("message")
        })
        
        while result.get("next_node_id"):
            result = await scheduler.schedule_next(result)
            
            await manager.send_event(task_id, {
                "type": "agent-update",
                "node_id": result.get("node_id"),
                "status": result.get("status"),
                "message": result.get("message")
            })
        
        await manager.send_event(task_id, {
            "type": "execution-complete",
            "task_id": task_id,
            "result": result
        })
        
    except Exception as e:
        await manager.send_event(task_id, {
            "type": "error",
            "message": str(e)
        })
