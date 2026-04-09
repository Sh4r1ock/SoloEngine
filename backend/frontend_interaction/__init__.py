# -*- coding: utf-8 -*-
"""
SoloEngine : 前端交互模块入口

@file __init__.py
@description 前端交互模块入口，导出所有前端交互子模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是前端交互模块的入口，包含以下子模块：
    - save_service: 保存服务模块

依赖:
    - frontend_interaction.save_service: 保存服务

使用示例:
    - from frontend_interaction import save_service
"""

from . import save_service

__all__ = ["save_service"]
