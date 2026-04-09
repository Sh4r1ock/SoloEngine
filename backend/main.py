"""
SoloEngine : 程序入口模块

@file main.py
@description 程序入口 - FastAPI服务器启动模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 启动Uvicorn服务器
    - 配置端口和主机
    - 支持热重载开发模式
    - Windows事件循环策略设置

依赖:
    - sys: 系统接口
    - asyncio: 异步IO支持
    - uvicorn: ASGI服务器
    - app.core.config: 应用配置

使用示例:
    - python main.py

使用场景：
    - 作为Python程序的入口点
    - 启动FastAPI Web服务器

注意事项：
    - 默认监听0.0.0.0:8990
    - 开发模式下启用热重载
"""
import sys
import asyncio

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=settings.BACKEND_PORT, reload=False)
