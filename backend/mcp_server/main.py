# -*- coding: utf-8 -*-
"""
MCP Service - 独立的MCP管理服务主入口。

独立部署于端口8992，提供MCP服务器的插件化管理。
"""

import os
import sys
import logging
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mcp_server.config import MCP_SERVICE_PORT, MCP_SERVICE_HOST, CORS_ORIGINS
from mcp_server.routes import router
from mcp_server.database import init_db
from mcp_server.host.lifecycle import lifecycle_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    logger.info("MCP Service starting up...")
    init_db()
    logger.info("Database initialized")
    
    yield
    
    logger.info("MCP Service shutting down...")
    await lifecycle_manager.disconnect_all()
    logger.info("All MCP connections closed")


def create_app() -> FastAPI:
    """创建FastAPI应用。"""
    app = FastAPI(
        title="MCP Service",
        description="独立的MCP管理服务，提供MCP服务器的插件化管理",
        version="1.0.0",
        lifespan=lifespan,
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    app.include_router(router)
    
    @app.get("/")
    async def root():
        return {
            "service": "MCP Service",
            "version": "1.0.0",
            "port": MCP_SERVICE_PORT,
            "status": "running",
        }
    
    return app


app = create_app()


def run():
    """运行MCP服务。"""
    import uvicorn
    uvicorn.run(
        app,
        host=MCP_SERVICE_HOST,
        port=MCP_SERVICE_PORT,
    )


if __name__ == "__main__":
    run()
