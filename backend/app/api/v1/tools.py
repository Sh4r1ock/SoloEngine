from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
import uuid
from app.core.tool_registry import tool_registry

router = APIRouter()

tools_db: Dict[str, Dict[str, Any]] = {}

@router.get("/tools")
async def get_tools():
    available_tools = tool_registry.get_available_tools()
    
    return {
        "code": 200,
        "message": "success",
        "data": [
            {
                "id": tool_id,
                "name": tool_id,
                "description": description
            }
            for tool_id, description in available_tools.items()
        ]
    }

@router.post("/tools")
async def register_tool(name: str, tool_type: str, config: Dict[str, Any]):
    tool_id = str(uuid.uuid4())
    
    tools_db[tool_id] = {
        "id": tool_id,
        "name": name,
        "type": tool_type,
        "config": config
    }
    
    return {
        "code": 201,
        "message": "created",
        "data": tools_db[tool_id]
    }

@router.get("/tools/{tool_id}")
async def get_tool(tool_id: str):
    if tool_id not in tools_db:
        raise HTTPException(status_code=404, detail="Tool not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": tools_db[tool_id]
    }

@router.delete("/tools/{tool_id}")
async def delete_tool(tool_id: str):
    if tool_id not in tools_db:
        raise HTTPException(status_code=404, detail="Tool not found")
    
    del tools_db[tool_id]
    
    return {
        "code": 200,
        "message": "deleted"
    }
