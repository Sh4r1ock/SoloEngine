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

def __getattr__(name):
    if name != "app":
        raise AttributeError(name)
    parent_app_path = backend_dir / "app.py"
    if not parent_app_path.exists():
        raise ImportError("app.py not found in backend directory")
    import importlib.util
    spec = importlib.util.spec_from_file_location("_app_module", parent_app_path)
    _app_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(_app_module)
    globals()["app"] = _app_module.app
    return _app_module.app

__all__ = ["app"]
