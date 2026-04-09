# -*- coding: utf-8 -*-
"""
SoloEngine : 计划笔记本插件，提供任务规划功能

@file plan_notebook.py
@description 计划笔记本插件实现，支持创建、管理、执行计划
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供计划笔记本插件，包括：
    - PlanStep: 计划步骤数据类
    - Plan: 计划数据类
    - PlanMemory: 计划记忆存储
    - PlanNotebookPlugin: 计划笔记本插件
    - 支持创建、更新、删除计划
    - 支持步骤管理和进度追踪

依赖:
    - json: JSON处理
    - uuid: UUID生成
    - logging: 日志记录
    - typing: 类型提示
    - dataclasses: 数据类
    - datetime: 日期时间
    - pathlib: 路径处理
    - ...core.interfaces: 核心接口

使用示例:
    - from SoloAgent.plugins.plan import PlanNotebookPlugin
    - planner = PlanNotebookPlugin()
    - plan = await planner.create_plan("目标", steps=["步骤1", "步骤2"])
    - progress = await planner.get_plan_progress(plan["plan_id"])
"""

import json
import uuid
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from ...core.interfaces import IPlanNotebook

logger = logging.getLogger(__name__)


@dataclass
class PlanStep:
    """
    计划步骤数据类

    职责:
        - 存储计划步骤信息
        - 管理步骤状态
        - 记录执行结果

    属性:
        step_id: 步骤唯一标识
        description: 步骤描述
        status: 步骤状态（pending/in_progress/completed/failed）
        dependencies: 依赖的步骤ID列表
        result: 执行结果
        error: 错误信息
        created_at: 创建时间
        updated_at: 更新时间

    示例:
        >>> step = PlanStep(
        ...     step_id="plan-123_step_0",
        ...     description="执行步骤1",
        ...     status="pending"
        ... )
    """
    step_id: str
    description: str
    status: str = "pending"  # pending, in_progress, completed, failed
    dependencies: List[str] = field(default_factory=list)
    result: Optional[str] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class Plan:
    """
    计划数据类

    职责:
        - 存储计划信息
        - 管理计划步骤
        - 记录计划状态

    属性:
        plan_id: 计划唯一标识
        goal: 计划目标
        steps: 步骤列表
        context: 上下文信息
        status: 计划状态（draft/active/completed/abandoned）
        version: 版本号
        created_at: 创建时间
        updated_at: 更新时间

    示例:
        >>> plan = Plan(
        ...     plan_id="plan-123",
        ...     goal="完成项目",
        ...     steps=[step1, step2]
        ... )
    """
    plan_id: str
    goal: str
    steps: List[PlanStep] = field(default_factory=list)
    context: Dict[str, Any] = field(default_factory=dict)
    status: str = "draft"  # draft, active, completed, abandoned
    version: int = 1
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())


class PlanMemory:
    """
    计划记忆存储类

    职责:
        - 存储和加载计划
        - 管理计划文件
        - 提供计划查询功能

    属性:
        storage_path: 存储路径
        _plans: 计划字典

    示例:
        >>> memory = PlanMemory("/path/to/plans")
        >>> memory.save(plan)
        >>> loaded_plan = memory.load("plan-123")
    """

    def __init__(self, storage_path: Optional[str] = None):
        """
        初始化计划记忆存储

        Args:
            storage_path: 存储路径，默认为"plans"

        示例:
            >>> memory = PlanMemory("/path/to/plans")
        """
        self.storage_path = Path(storage_path) if storage_path else Path("plans")
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self._plans: Dict[str, Plan] = {}
        """计划字典 {plan_id: Plan}"""
        self._load_plans()

    def _load_plans(self):
        """加载已保存的计划。"""
        for plan_file in self.storage_path.glob("*.json"):
            try:
                with open(plan_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    plan = self._dict_to_plan(data)
                    self._plans[plan.plan_id] = plan
            except Exception as e:
                logger.error(f"Failed to load plan {plan_file}: {e}")

    def _dict_to_plan(self, data: Dict[str, Any]) -> Plan:
        """将字典转换为计划对象。"""
        steps = [
            PlanStep(
                step_id=s["step_id"],
                description=s["description"],
                status=s.get("status", "pending"),
                dependencies=s.get("dependencies", []),
                result=s.get("result"),
                error=s.get("error"),
                created_at=s.get("created_at", datetime.now().isoformat()),
                updated_at=s.get("updated_at", datetime.now().isoformat()),
            )
            for s in data.get("steps", [])
        ]
        
        return Plan(
            plan_id=data["plan_id"],
            goal=data["goal"],
            steps=steps,
            context=data.get("context", {}),
            status=data.get("status", "draft"),
            version=data.get("version", 1),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
        )

    def _plan_to_dict(self, plan: Plan) -> Dict[str, Any]:
        """将计划对象转换为字典。"""
        return {
            "plan_id": plan.plan_id,
            "goal": plan.goal,
            "steps": [
                {
                    "step_id": s.step_id,
                    "description": s.description,
                    "status": s.status,
                    "dependencies": s.dependencies,
                    "result": s.result,
                    "error": s.error,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                }
                for s in plan.steps
            ],
            "context": plan.context,
            "status": plan.status,
            "version": plan.version,
            "created_at": plan.created_at,
            "updated_at": plan.updated_at,
        }

    def save(self, plan: Plan):
        """保存计划。"""
        plan_file = self.storage_path / f"{plan.plan_id}.json"
        try:
            with open(plan_file, "w", encoding="utf-8") as f:
                json.dump(self._plan_to_dict(plan), f, indent=2, ensure_ascii=False)
            self._plans[plan.plan_id] = plan
            logger.info(f"Saved plan: {plan.plan_id}")
        except Exception as e:
            logger.error(f"Failed to save plan {plan.plan_id}: {e}")
            raise

    def load(self, plan_id: str) -> Optional[Plan]:
        """加载计划。"""
        return self._plans.get(plan_id)

    def delete(self, plan_id: str) -> bool:
        """删除计划。"""
        if plan_id in self._plans:
            del self._plans[plan_id]
            plan_file = self.storage_path / f"{plan_id}.json"
            if plan_file.exists():
                plan_file.unlink()
            logger.info(f"Deleted plan: {plan_id}")
            return True
        return False

    def list_plans(self, status: Optional[str] = None) -> List[Plan]:
        """列出计划。"""
        plans = list(self._plans.values())
        if status:
            plans = [p for p in plans if p.status == status]
        return sorted(plans, key=lambda p: p.updated_at, reverse=True)

    def search(self, query: str) -> List[Plan]:
        """搜索计划。"""
        query_lower = query.lower()
        results = []
        for plan in self._plans.values():
            if query_lower in plan.goal.lower():
                results.append(plan)
                continue
            for step in plan.steps:
                if query_lower in step.description.lower():
                    results.append(plan)
                    break
        return results


class PlanNotebookPlugin(IPlanNotebook):
    """
    计划笔记本插件

    职责:
        - 实现IPlanNotebook接口
        - 提供计划创建、管理、执行功能
        - 支持步骤管理和进度追踪
        - 自动保存计划状态

    属性:
        memory: 计划记忆存储
        _auto_save: 是否自动保存
        _max_plans: 最大计划数量
        _initialized: 是否已初始化
        _current_plan_id: 当前计划ID

    示例:
        >>> planner = PlanNotebookPlugin()
        >>> plan = await planner.create_plan("目标", steps=["步骤1"])
        >>> progress = await planner.get_plan_progress(plan["plan_id"])
    """

    def __init__(self, storage_path: Optional[str] = None, auto_save: bool = True, max_plans: int = 10):
        """
        初始化计划笔记本插件

        Args:
            storage_path: 存储路径
            auto_save: 是否自动保存
            max_plans: 最大计划数量

        示例:
            >>> planner = PlanNotebookPlugin("/path/to/plans", auto_save=True)
        """
        self.memory = PlanMemory(storage_path)
        self._auto_save = auto_save
        self._max_plans = max_plans
        self._initialized = False
        self._current_plan_id: Optional[str] = None

    async def create_plan(self, goal: str, **kwargs) -> dict:
        """创建新计划。

        Args:
            goal: 计划目标
            **kwargs: 其他参数，可包含:
                - steps: 初始步骤列表
                - context: 上下文信息

        Returns:
            创建的计划
        """
        plan_id = str(uuid.uuid4())
        
        steps = []
        for i, step_desc in enumerate(kwargs.get("steps", [])):
            step = PlanStep(
                step_id=f"{plan_id}_step_{i}",
                description=step_desc if isinstance(step_desc, str) else step_desc.get("description", ""),
                dependencies=step_desc.get("dependencies", []) if isinstance(step_desc, dict) else [],
            )
            steps.append(step)
        
        plan = Plan(
            plan_id=plan_id,
            goal=goal,
            steps=steps,
            context=kwargs.get("context", {}),
            status="draft",
        )
        
        self.memory.save(plan)
        
        self._current_plan_id = plan_id
        self._initialized = True
        
        logger.info(f"Created plan: {plan_id} - {goal}")
        
        return self.memory._plan_to_dict(plan)

    async def initialize_if_needed(self) -> None:
        """初始化计划笔记本（如果尚未初始化）。"""
        if not self._initialized:
            plans = self.memory.list_plans(status="active")
            if plans:
                self._current_plan_id = plans[0].plan_id
            self._initialized = True
            logger.info("PlanNotebookPlugin initialized")

    def get_current_plan(self) -> Optional[Dict[str, Any]]:
        """获取当前活动计划。
        
        Returns:
            当前计划字典，如果没有活动计划则返回 None。
        """
        if not self._current_plan_id:
            return None
        
        plan = self.memory.load(self._current_plan_id)
        if plan:
            plan_dict = self.memory._plan_to_dict(plan)
            completed = sum(1 for s in plan.steps if s.status == "completed")
            total = len(plan.steps)
            plan_dict["name"] = plan.goal
            plan_dict["current_step"] = completed
            plan_dict["total_steps"] = total
            plan_dict["progress"] = completed / total if total > 0 else 0
            return plan_dict
        return None

    def set_current_plan(self, plan_id: str) -> None:
        """设置当前活动计划。
        
        Args:
            plan_id: 计划 ID
        """
        if self.memory.load(plan_id):
            self._current_plan_id = plan_id
            logger.info(f"Set current plan: {plan_id}")

    async def update_plan(self, plan_id: str, updates: dict) -> None:
        """更新计划。

        Args:
            plan_id: 计划 ID
            updates: 更新内容
        """
        plan = self.memory.load(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        if "goal" in updates:
            plan.goal = updates["goal"]
        
        if "status" in updates:
            plan.status = updates["status"]
        
        if "context" in updates:
            plan.context.update(updates["context"])
        
        if "steps" in updates:
            for step_update in updates["steps"]:
                step_id = step_update.get("step_id")
                if step_id:
                    for step in plan.steps:
                        if step.step_id == step_id:
                            if "description" in step_update:
                                step.description = step_update["description"]
                            if "status" in step_update:
                                step.status = step_update["status"]
                            if "result" in step_update:
                                step.result = step_update["result"]
                            if "error" in step_update:
                                step.error = step_update["error"]
                            step.updated_at = datetime.now().isoformat()
                            break
        
        plan.version += 1
        plan.updated_at = datetime.now().isoformat()
        
        self.memory.save(plan)
        
        logger.info(f"Updated plan: {plan_id}")

    async def get_plan(self, plan_id: str) -> Optional[dict]:
        """获取计划。

        Args:
            plan_id: 计划 ID

        Returns:
            计划详情，如果不存在返回 None
        """
        plan = self.memory.load(plan_id)
        if plan:
            return self.memory._plan_to_dict(plan)
        return None

    async def delete_plan(self, plan_id: str) -> None:
        """删除计划。

        Args:
            plan_id: 计划 ID
        """
        self.memory.delete(plan_id)
        logger.info(f"Deleted plan: {plan_id}")

    async def add_step(
        self,
        plan_id: str,
        description: str,
        dependencies: Optional[List[str]] = None,
    ) -> dict:
        """添加步骤。

        Args:
            plan_id: 计划 ID
            description: 步骤描述
            dependencies: 依赖的步骤 ID 列表

        Returns:
            创建的步骤
        """
        plan = self.memory.load(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        step = PlanStep(
            step_id=f"{plan_id}_step_{len(plan.steps)}",
            description=description,
            dependencies=dependencies or [],
        )
        
        plan.steps.append(step)
        plan.version += 1
        plan.updated_at = datetime.now().isoformat()
        
        self.memory.save(plan)
        
        return {
            "step_id": step.step_id,
            "description": step.description,
            "status": step.status,
            "dependencies": step.dependencies,
        }

    async def update_step(
        self,
        plan_id: str,
        step_id: str,
        status: Optional[str] = None,
        result: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """更新步骤状态。

        Args:
            plan_id: 计划 ID
            step_id: 步骤 ID
            status: 新状态
            result: 执行结果
            error: 错误信息
        """
        plan = self.memory.load(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        for step in plan.steps:
            if step.step_id == step_id:
                if status:
                    step.status = status
                if result:
                    step.result = result
                if error:
                    step.error = error
                step.updated_at = datetime.now().isoformat()
                break
        
        plan.version += 1
        plan.updated_at = datetime.now().isoformat()
        
        self.memory.save(plan)

    async def get_next_step(self, plan_id: str) -> Optional[dict]:
        """获取下一个可执行的步骤。

        Args:
            plan_id: 计划 ID

        Returns:
            下一个步骤，如果没有返回 None
        """
        plan = self.memory.load(plan_id)
        if not plan:
            return None

        completed_steps = {
            s.step_id for s in plan.steps if s.status == "completed"
        }

        for step in plan.steps:
            if step.status != "pending":
                continue
            
            # 检查依赖是否都已完成
            if all(dep in completed_steps for dep in step.dependencies):
                return {
                    "step_id": step.step_id,
                    "description": step.description,
                    "status": step.status,
                    "dependencies": step.dependencies,
                }
        
        return None

    async def list_plans(self, status: Optional[str] = None) -> List[dict]:
        """列出计划。

        Args:
            status: 过滤状态

        Returns:
            计划列表
        """
        plans = self.memory.list_plans(status)
        return [self.memory._plan_to_dict(p) for p in plans]

    async def search_plans(self, query: str) -> List[dict]:
        """搜索计划。

        Args:
            query: 搜索关键词

        Returns:
            匹配的计划列表
        """
        plans = self.memory.search(query)
        return [self.memory._plan_to_dict(p) for p in plans]

    async def get_plan_progress(self, plan_id: str) -> dict:
        """获取计划进度。

        Args:
            plan_id: 计划 ID

        Returns:
            进度信息
        """
        plan = self.memory.load(plan_id)
        if not plan:
            raise ValueError(f"Plan not found: {plan_id}")

        total_steps = len(plan.steps)
        completed_steps = sum(1 for s in plan.steps if s.status == "completed")
        in_progress_steps = sum(1 for s in plan.steps if s.status == "in_progress")
        failed_steps = sum(1 for s in plan.steps if s.status == "failed")
        pending_steps = sum(1 for s in plan.steps if s.status == "pending")

        progress = (completed_steps / total_steps * 100) if total_steps > 0 else 0

        return {
            "plan_id": plan_id,
            "total_steps": total_steps,
            "completed_steps": completed_steps,
            "in_progress_steps": in_progress_steps,
            "failed_steps": failed_steps,
            "pending_steps": pending_steps,
            "progress": round(progress, 2),
            "status": plan.status,
        }
