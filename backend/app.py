"""
SoloEngine : FastAPI主应用模块

@file app.py
@description FastAPI主应用 - FastAPI应用主模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 创建和配置FastAPI应用实例
    - 注册路由和中间件
    - 配置CORS跨域支持
    - 提供项目保存和加载API
    - 系统用户和Skills初始化

依赖:
    - fastapi: FastAPI框架
    - fastapi.middleware.cors: CORS中间件
    - logging: 日志记录
    - app.api.v1: API路由模块

使用示例:
    - uvicorn app:app --host 0.0.0.0 --port 8990

使用场景：
    - 作为FastAPI服务器的入口点
    - 配置全局中间件和路由

注意事项：
    - CORS配置允许所有来源（生产环境应限制）
    - 支持热重载开发模式
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.api.v1 import agent_tools, config, run, skills, auth, marketplace, agentic_flows, run_project, mcp_servers, file_changes, browser_proxy, terminal_ws
from app.core.database import OptimisticLockError

logger = logging.getLogger(__name__)


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    from app.services.file_system_push import push_service, ws_registry
    from app.services.workspace_watcher import workspace_watcher

    push_service.set_ws_registry(ws_registry)

    change_queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    workspace_watcher.set_asyncio_queue(loop, change_queue)

    flush_task = asyncio.create_task(push_service._flush_loop())
    consumer_task = asyncio.create_task(_watchdog_consumer(change_queue))

    # 初始化系统用户（拆解原 @app.on_event("startup")，统一并入 lifespan 启动阶段）
    from app.core.database import SessionLocal
    from app.core.system_user import create_system_user

    db = SessionLocal()
    try:
        create_system_user(db)
        logger.info("System user created/verified successfully")
    except Exception as e:
        logger.error(f"Failed to create system user: {e}")
    finally:
        db.close()

    yield

    flush_task.cancel()
    consumer_task.cancel()


async def _watchdog_consumer(queue: asyncio.Queue):
    from app.services.file_system_push import push_service
    while True:
        event = await queue.get()
        push_service.push_change(
            session_id=event["session_id"],
            file_path=event["file_path"],
            operation=event["operation"],
            is_directory=event["is_directory"],
            dest_path=event.get("dest_path"),
        )


app = FastAPI(
    title="SoloEngine API",
    version="1.0.0",
    description="Agentic Builder API",
    lifespan=app_lifespan,
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"[422 VALIDATION ERROR] path={request.url.path} errors={exc.errors()} body={exc.body}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

@app.exception_handler(OptimisticLockError)
async def optimistic_lock_handler(request: Request, exc: OptimisticLockError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    # 前端固定从 8991 访问；allow_credentials=True 时禁止用 "*"（浏览器会拒绝带 Authorization 的跨源请求），
    # 必须显式列出 origin 使 Starlette 回显具体 origin 而非 "*"。
    allow_origins=[
        "http://localhost:8991",
        "http://127.0.0.1:8991",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "SoloEngine API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

app.include_router(config.router)
app.include_router(run.router)
app.include_router(skills.router)
app.include_router(agent_tools.router)
app.include_router(auth.router)
app.include_router(marketplace.router)
app.include_router(agentic_flows.router)
app.include_router(run_project.router)
app.include_router(mcp_servers.router)
app.include_router(file_changes.router)
app.include_router(browser_proxy.router)
app.include_router(terminal_ws.router)
