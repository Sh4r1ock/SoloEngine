"""
@file app.py
@description FastAPI主应用 - FastAPI应用主模块
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 创建和配置FastAPI应用实例
- 注册路由和中间件
- 配置CORS跨域支持
- 提供项目保存和加载API

使用场景：
- 作为FastAPI服务器的入口点
- 配置全局中间件和路由

注意事项：
- CORS配置允许所有来源（生产环境应限制）
- 支持热重载开发模式
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from frontend_interaction.save_service.flow_saver import FlowSaver
from app.api.v1 import projects, tools, websocket, config, debug, skills, auth, export, package, history, marketplace, agentic_flows, agent_tools, debug_project
import logging

logger = logging.getLogger(__name__)

app = FastAPI(title="SoloEngine API", version="1.0.0", description="Agentic Builder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """应用启动时执行初始化操作。"""
    from app.core.database import SessionLocal
    from app.api.v1.skills import sync_system_skills
    
    db = SessionLocal()
    try:
        count = sync_system_skills(db)
        logger.info(f"System skills synchronized successfully: {count} skills")
    except Exception as e:
        logger.error(f"Failed to sync system skills: {e}")
    finally:
        db.close()

flow_saver = FlowSaver()

class SaveFlowRequest(BaseModel):
    project_name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]

class SaveFlowResponse(BaseModel):
    code: int
    message: str
    data: Optional[Dict[str, Any]] = None

class FlowListResponse(BaseModel):
    code: int
    message: str
    data: List[Dict[str, Any]]

class FlowResponse(BaseModel):
    code: int
    message: str
    data: Optional[Dict[str, Any]] = None

@app.get("/")
async def root():
    return {"message": "Agentic Flow Save Service API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/api/v1/save-flow", response_model=SaveFlowResponse)
async def save_flow(request: SaveFlowRequest):
    try:
        flow_data = flow_saver.save_flow(request.project_name, request.nodes, request.edges)
        return SaveFlowResponse(
            code=200,
            message="saved",
            data=flow_data
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/flows", response_model=FlowListResponse)
async def list_flows():
    try:
        flows = flow_saver.list_flows()
        return FlowListResponse(
            code=200,
            message="success",
            data=flows
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/flows/{project_name}", response_model=FlowResponse)
async def get_flow(project_name: str):
    try:
        flow_data = flow_saver.load_flow(project_name)
        if flow_data is None:
            raise HTTPException(status_code=404, detail=f"Flow '{project_name}' not found")
        return FlowResponse(
            code=200,
            message="success",
            data=flow_data
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/flows/{project_name}", response_model=FlowResponse)
async def delete_flow(project_name: str):
    try:
        deleted = flow_saver.delete_flow(project_name)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Flow '{project_name}' not found")
        return FlowResponse(
            code=200,
            message="deleted",
            data={"project_name": project_name}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(config.router)
app.include_router(debug.router)
app.include_router(skills.router)
app.include_router(projects.router)
app.include_router(tools.router)
app.include_router(websocket.router)
app.include_router(auth.router)
app.include_router(export.router)
app.include_router(package.router)
app.include_router(history.router)
app.include_router(marketplace.router)
app.include_router(agentic_flows.router)
app.include_router(agent_tools.router)
app.include_router(debug_project.router)
