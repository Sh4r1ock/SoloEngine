from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import uuid
from app.schemas.response import CanvasSchema, ExecutionRequestSchema, ExecutionResponseSchema
from app.core.canvas_parser import CanvasParser
from app.core.scheduler import Scheduler

router = APIRouter()

projects_db: Dict[str, Dict[str, Any]] = {}

@router.get("/projects/{project_id}/canvas")
async def get_canvas(project_id: str):
    if project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": projects_db[project_id]
    }

@router.put("/projects/{project_id}/canvas")
async def update_canvas(project_id: str, canvas_data: CanvasSchema):
    if project_id not in projects_db:
        projects_db[project_id] = {
            "id": project_id,
            "name": f"Project {project_id}",
            "canvas": canvas_data.dict()
        }
    else:
        projects_db[project_id]["canvas"] = canvas_data.dict()
    
    return {
        "code": 200,
        "message": "updated",
        "data": projects_db[project_id]
    }

@router.post("/projects/{project_id}/run")
async def run_project(project_id: str, request: ExecutionRequestSchema):
    if project_id not in projects_db:
        raise HTTPException(status_code=404, detail="Project not found")
    
    canvas_data = projects_db[project_id]["canvas"]
    
    try:
        协作图 = CanvasParser.parse(canvas_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    task_id = str(uuid.uuid4())
    
    scheduler = Scheduler(协作图)
    initial_context = {"user_input": request.input}
    
    return {
        "code": 200,
        "message": "started",
        "data": {
            "task_id": task_id,
            "project_id": project_id
        }
    }

@router.get("/projects")
async def get_projects():
    return {
        "code": 200,
        "message": "success",
        "data": list(projects_db.values())
    }

@router.post("/projects")
async def create_project(name: str):
    project_id = str(uuid.uuid4())
    projects_db[project_id] = {
        "id": project_id,
        "name": name,
        "canvas": {
            "nodes": [],
            "edges": []
        }
    }
    
    return {
        "code": 201,
        "message": "created",
        "data": projects_db[project_id]
    }
