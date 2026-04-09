# -*- coding: utf-8 -*-
"""
SoloEngine : Plan插件模块，提供任务规划功能

@file __init__.py
@description Plan插件模块入口，统一导出计划相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Plan插件的入口，提供以下核心组件的统一导出：
    - PlanNotebookPlugin: 计划笔记本插件
    - Plan: 计划类
    - PlanStep: 计划步骤类
    - PlanMemory: 计划记忆类

依赖:
    - .plan_notebook: 计划笔记本实现

使用示例:
    - from SoloAgent.plugins.plan import PlanNotebookPlugin
    - planner = PlanNotebookPlugin()
"""

from .plan_notebook import PlanNotebookPlugin, Plan, PlanStep, PlanMemory

__all__ = ["PlanNotebookPlugin", "Plan", "PlanStep", "PlanMemory"]
