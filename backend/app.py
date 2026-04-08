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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import tools, websocket, config, run, skills, auth, export, package, marketplace, agentic_flows, agent_tools, run_project, settings, mcp_servers
import logging

logger = logging.getLogger(__name__)



app = FastAPI(title="SoloEngine API", version="1.0.0", description="Agentic Builder API")

from fastapi.exceptions import RequestValidationError
from fastapi.requests import Request
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"[422 VALIDATION ERROR] path={request.url.path} errors={exc.errors()} body={exc.body}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

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
    from app.core.system_user import create_system_user
    from app.api.v1.skills import sync_system_skills
    
    db = SessionLocal()
    try:
        create_system_user(db)
        logger.info("System user created/verified successfully")
    except Exception as e:
        logger.error(f"Failed to create system user: {e}")
    finally:
        db.close()
    
    db = SessionLocal()
    try:
        count = sync_system_skills(db)
        logger.info(f"System skills synchronized successfully: {count} skills")
    except Exception as e:
        logger.error(f"Failed to sync system skills: {e}")
    finally:
        db.close()

@app.get("/")
async def root():
    return {"message": "SoloEngine API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

app.include_router(config.router)
app.include_router(run.router)
app.include_router(skills.router)
app.include_router(tools.router)
app.include_router(websocket.router)
app.include_router(auth.router)
app.include_router(export.router)
app.include_router(package.router)
app.include_router(marketplace.router)
app.include_router(agentic_flows.router)
app.include_router(agent_tools.router)
app.include_router(run_project.router)
app.include_router(settings.router)
app.include_router(mcp_servers.router)
