"""
@file main.py
@description 程序入口 - FastAPI服务器启动模块
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 启动Uvicorn服务器
- 配置端口和主机
- 支持热重载开发模式

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

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8990, reload=False)
