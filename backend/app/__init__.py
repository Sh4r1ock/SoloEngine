# -*- coding: utf-8 -*-
"""
SoloEngine : 应用模块入口

@file __init__.py
@description 应用模块入口，初始化FastAPI应用
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是应用模块的入口，执行以下初始化操作：
    - 加载环境变量
    - 配置系统路径
    - 导入FastAPI应用实例

依赖:
    - dotenv: 环境变量加载
    - pathlib: 路径处理
    - sys: 系统路径配置

使用示例:
    - from app import app
    - uvicorn.run(app)
"""

from dotenv import load_dotenv
from pathlib import Path

# 从项目根目录加载.env文件
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import importlib.util

# 直接加载 FastAPI 主应用（backend/app.py）并导出 app 实例。
# 替代原 __getattr__ 懒加载 exec（3 层间接启动链路）；main.py 以对象方式
# uvicorn.run(app, ...) 启动，`uvicorn app:app` 字符串方式（如 _start_server.py）仍兼容。
_app_spec = importlib.util.spec_from_file_location(
    "_backend_app_module", backend_dir / "app.py"
)
_app_module = importlib.util.module_from_spec(_app_spec)
_app_spec.loader.exec_module(_app_module)
app = _app_module.app

__all__ = ["app"]
