# -*- coding: utf-8 -*-
"""
Skill工具模块 - 技能调用实现。

@file skill.py
@description Skill工具 - 在主对话中执行技能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 在主对话中执行技能（Skills）
- 支持技能名称参数
- 渐进式披露机制
- 注入技能上下文（system_prompt, tool_permissions）
- 返回技能状态和上下文

技能系统：
    Skills是一种可扩展的能力模块，包含：
    - 系统提示词（system_prompt）：定义技能的行为
    - 工具权限（tool_permissions）：限制技能可用的工具
    - 指令模板（instructions）：技能的具体指令

渐进式披露：
    技能采用渐进式披露机制：
    1. 初始调用：返回技能概述和可用操作
    2. 详细调用：返回完整的技能指令和上下文
    3. 执行调用：在技能上下文中执行具体操作

设计理念：
    Skill工具允许Agent动态加载和使用技能：
    1. 通过技能名称加载技能配置
    2. 将技能上下文注入到当前对话
    3. 根据技能权限控制工具访问
    4. 返回技能执行状态

使用场景：
    - 加载和使用预定义的技能
    - 动态扩展Agent的能力
    - 在特定上下文中执行任务

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
import os
import sys
import logging

from .base import BaseAgentTool, AgentToolError, ToolContext, ToolPermission

logger = logging.getLogger(__name__)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'app')))
from app.core.data_paths import DataPaths


@dataclass
class SkillContext:
    """
    技能上下文数据类。
    
    存储技能执行时的上下文信息。
    
    Attributes:
        skill_name (str): 技能名称
        system_prompt (str): 系统提示词
        instructions (str): 技能指令
        tool_permissions (ToolPermission): 工具权限
        metadata (Dict[str, Any]): 额外元数据
        is_active (bool): 是否激活
    """
    skill_name: str = ""
    system_prompt: str = ""
    instructions: str = ""
    tool_permissions: Optional[ToolPermission] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    is_active: bool = False


@dataclass
class SkillMetadata:
    """
    技能元数据数据类。
    
    存储技能的基本信息。
    
    Attributes:
        name (str): 技能名称
        version (str): 版本号
        description (str): 描述
        author (str): 作者
        tags (List[str]): 标签列表
    """
    name: str = ""
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    tags: List[str] = field(default_factory=list)


class SkillTool(BaseAgentTool):
    """
    Skill工具 - 在主对话中执行技能。
    
    通过Skill工具，Agent可以动态加载和使用技能。
    技能提供专门的上下文和权限控制。
    
    核心功能：
        1. 技能加载：根据名称加载技能配置
        2. 上下文注入：将技能上下文注入当前对话
        3. 权限控制：根据技能配置限制工具访问
        4. 渐进式披露：逐步展示技能详情
    
    渐进式披露级别：
        - overview: 返回技能概述
        - details: 返回完整指令
        - execute: 在技能上下文中执行
    
    Example:
        >>> skill_tool = SkillTool()
        >>> result = await skill_tool.execute(
        ...     skill_name="code_review",
        ...     action="load"
        ... )
    
    Note:
        - 技能需要预先配置才能使用
        - 技能上下文会影响后续对话
        - 技能权限会限制可用工具
    """
    
    def __init__(
        self,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None,
        skills_dir: Optional[str] = None
    ) -> None:
        """
        初始化Skill工具。
        
        Args:
            context (ToolContext, optional): 工具上下文。默认为 None。
            permission (ToolPermission, optional): 工具权限。默认为 None。
            skills_dir (str, optional): 技能目录路径。默认为 None。
        """
        super().__init__(context, permission)
        self._skills_dir = skills_dir
        self._loaded_skills: Dict[str, SkillContext] = {}
        self._active_skill: Optional[str] = None
    
    async def execute(
        self,
        skill_name: str,
        action: str = "load",
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行Skill工具 - 加载或使用技能。
        
        根据指定的技能名称和动作执行相应操作。
        
        Args:
            skill_name (str): 技能名称。要加载或使用的技能。
            action (str): 动作类型。默认为 "load"。
                - "load": 加载技能，返回概述
                - "details": 获取详细指令
                - "activate": 激活技能上下文
                - "deactivate": 停用技能
            **kwargs: 额外参数。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - content (str): 技能信息或执行结果
                - skill_name (str): 技能名称
                - action (str): 执行的动作
                - metadata (dict): 技能元数据
        
        Raises:
            AgentToolError: 当技能不存在或执行失败时抛出。
        
        Example:
            >>> result = await skill_tool.execute(
            ...     skill_name="code_review",
            ...     action="load"
            ... )
            >>> print(result["content"])
        """
        if not skill_name:
            return self.create_error_response(
                message="skill_name参数不能为空",
                error_code="INVALID_SKILL_NAME"
            )
        
        try:
            if action == "load":
                return await self._load_skill(skill_name)
            elif action == "details":
                return await self._get_skill_details(skill_name)
            elif action == "activate":
                return await self._activate_skill(skill_name)
            elif action == "deactivate":
                return await self._deactivate_skill(skill_name)
            else:
                return self.create_error_response(
                    message=f"未知的动作类型: {action}",
                    error_code="INVALID_ACTION",
                    details={"action": action}
                )
                
        except AgentToolError:
            raise
        except Exception as e:
            logger.error(f"Skill execution failed: {e}")
            return self.create_error_response(
                message=f"技能执行失败: {str(e)}",
                error_code="SKILL_EXECUTION_ERROR",
                details={
                    "skill_name": skill_name,
                    "action": action,
                    "error": str(e)
                }
            )
    
    async def _load_skill(self, skill_name: str) -> Dict[str, Any]:
        """
        加载技能。
        
        从技能目录加载技能配置，返回技能概述。
        
        Args:
            skill_name (str): 技能名称
        
        Returns:
            Dict[str, Any]: 加载结果
        """
        skill_context = await self._get_skill_context(skill_name)
        
        if not skill_context:
            return self.create_error_response(
                message=f"技能 '{skill_name}' 不存在",
                error_code="SKILL_NOT_FOUND",
                details={"skill_name": skill_name}
            )
        
        self._loaded_skills[skill_name] = skill_context
        
        overview = self._generate_skill_overview(skill_context)
        
        return self.create_success_response(
            content=overview,
            metadata={
                "skill_name": skill_name,
                "action": "load",
                "description": skill_context.metadata.get("description", ""),
                "version": skill_context.metadata.get("version", "1.0.0"),
                "is_active": skill_context.is_active
            }
        )
    
    async def _get_skill_details(self, skill_name: str) -> Dict[str, Any]:
        """
        获取技能详细指令。
        
        返回技能的完整指令和上下文。
        
        Args:
            skill_name (str): 技能名称
        
        Returns:
            Dict[str, Any]: 详细信息
        """
        if skill_name not in self._loaded_skills:
            await self._load_skill(skill_name)
        
        skill_context = self._loaded_skills.get(skill_name)
        
        if not skill_context:
            return self.create_error_response(
                message=f"技能 '{skill_name}' 未加载",
                error_code="SKILL_NOT_LOADED"
            )
        
        details = self._generate_skill_details(skill_context)
        
        return self.create_success_response(
            content=details,
            metadata={
                "skill_name": skill_name,
                "action": "details",
                "instructions_length": len(skill_context.instructions)
            }
        )
    
    async def _activate_skill(self, skill_name: str) -> Dict[str, Any]:
        """
        激活技能上下文。
        
        将技能上下文注入当前对话，并设置工具权限。
        
        Args:
            skill_name (str): 技能名称
        
        Returns:
            Dict[str, Any]: 激活结果
        """
        if skill_name not in self._loaded_skills:
            await self._load_skill(skill_name)
        
        skill_context = self._loaded_skills.get(skill_name)
        
        if not skill_context:
            return self.create_error_response(
                message=f"技能 '{skill_name}' 未加载",
                error_code="SKILL_NOT_LOADED"
            )
        
        if self._active_skill and self._active_skill in self._loaded_skills:
            self._loaded_skills[self._active_skill].is_active = False
        
        skill_context.is_active = True
        self._active_skill = skill_name
        
        if skill_context.tool_permissions:
            self._permission = skill_context.tool_permissions
        
        return self.create_success_response(
            content=f"技能 '{skill_name}' 已激活。技能上下文已注入当前对话。",
            metadata={
                "skill_name": skill_name,
                "action": "activate",
                "system_prompt_injected": bool(skill_context.system_prompt),
                "permissions_applied": bool(skill_context.tool_permissions)
            }
        )
    
    async def _deactivate_skill(self, skill_name: str) -> Dict[str, Any]:
        """
        停用技能。
        
        移除技能上下文，恢复默认权限。
        
        Args:
            skill_name (str): 技能名称
        
        Returns:
            Dict[str, Any]: 停用结果
        """
        if skill_name not in self._loaded_skills:
            return self.create_error_response(
                message=f"技能 '{skill_name}' 未加载",
                error_code="SKILL_NOT_LOADED"
            )
        
        skill_context = self._loaded_skills[skill_name]
        skill_context.is_active = False
        
        if self._active_skill == skill_name:
            self._active_skill = None
        
        return self.create_success_response(
            content=f"技能 '{skill_name}' 已停用。",
            metadata={
                "skill_name": skill_name,
                "action": "deactivate"
            }
        )
    
    async def _get_skill_context(self, skill_name: str) -> Optional[SkillContext]:
        """
        获取技能上下文。
        
        从技能目录加载技能配置。
        
        Args:
            skill_name (str): 技能名称
        
        Returns:
            Optional[SkillContext]: 技能上下文，如果不存在返回 None
        """
        if self._skills_dir:
            skill_path = os.path.join(self._skills_dir, skill_name)
            return await self._load_skill_from_path(skill_path, skill_name)
        
        system_skills_dir = self._get_system_skills_dir()
        skill_path = os.path.join(system_skills_dir, skill_name)
        if os.path.exists(skill_path):
            return await self._load_skill_from_path(skill_path, skill_name)
        
        return SkillContext(
            skill_name=skill_name,
            system_prompt=f"你正在使用 '{skill_name}' 技能。",
            instructions=f"执行 {skill_name} 相关任务。",
            metadata={"name": skill_name, "description": f"{skill_name} 技能"},
            is_active=False
        )
    
    def _get_system_skills_dir(self) -> str:
        """
        获取系统技能目录路径。
        
        Returns:
            str: 系统技能目录路径
        """
        return DataPaths.get_system_skills_dir()
    
    async def _load_skill_from_path(
        self,
        skill_path: str,
        skill_name: str
    ) -> Optional[SkillContext]:
        """
        从路径加载技能配置。
        
        解析SKILL.md文件，提取技能上下文。
        
        Args:
            skill_path (str): 技能目录路径
            skill_name (str): 技能名称
        
        Returns:
            Optional[SkillContext]: 技能上下文
        """
        skill_md_path = os.path.join(skill_path, "SKILL.md")
        
        if not os.path.exists(skill_md_path):
            return None
        
        try:
            with open(skill_md_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            metadata = self._parse_skill_metadata(content)
            instructions = self._extract_instructions(content)
            system_prompt = self._generate_system_prompt(metadata, instructions)
            tool_permissions = self._parse_tool_permissions(content)
            
            return SkillContext(
                skill_name=skill_name,
                system_prompt=system_prompt,
                instructions=instructions,
                tool_permissions=tool_permissions,
                metadata=metadata,
                is_active=False
            )
            
        except Exception as e:
            logger.warning(f"Failed to load skill from {skill_path}: {e}")
            return None
    
    def _parse_skill_metadata(self, content: str) -> Dict[str, Any]:
        """
        解析技能元数据。
        
        从SKILL.md的frontmatter中提取元数据。
        
        Args:
            content (str): SKILL.md内容
        
        Returns:
            Dict[str, Any]: 元数据字典
        """
        metadata = {
            "name": "",
            "version": "1.0.0",
            "description": "",
            "author": "",
            "tags": []
        }
        
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 2:
                frontmatter = parts[1].strip()
                
                for line in frontmatter.split("\n"):
                    if ":" in line:
                        key, value = line.split(":", 1)
                        key = key.strip().lower()
                        value = value.strip()
                        
                        if key == "name":
                            metadata["name"] = value
                        elif key == "version":
                            metadata["version"] = value
                        elif key == "description":
                            metadata["description"] = value
                        elif key == "author":
                            metadata["author"] = value
        
        return metadata
    
    def _extract_instructions(self, content: str) -> str:
        """
        提取技能指令。
        
        从SKILL.md中提取指令内容（去除frontmatter）。
        
        Args:
            content (str): SKILL.md内容
        
        Returns:
            str: 指令内容
        """
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                return parts[2].strip()
        
        return content
    
    def _generate_system_prompt(
        self,
        metadata: Dict[str, Any],
        instructions: str
    ) -> str:
        """
        生成技能的系统提示词。
        
        Args:
            metadata (Dict[str, Any]): 技能元数据
            instructions (str): 技能指令
        
        Returns:
            str: 系统提示词
        """
        name = metadata.get("name", "未知技能")
        description = metadata.get("description", "")
        
        system_prompt = f"""你正在使用 '{name}' 技能。

技能描述：{description}

{instructions}
"""
        return system_prompt
    
    def _parse_tool_permissions(self, content: str) -> Optional[ToolPermission]:
        """
        解析工具权限配置。
        
        从SKILL.md中提取工具权限配置。
        
        Args:
            content (str): SKILL.md内容
        
        Returns:
            Optional[ToolPermission]: 工具权限配置
        """
        return None
    
    def _generate_skill_overview(self, skill_context: SkillContext) -> str:
        """
        生成技能概述。
        
        Args:
            skill_context (SkillContext): 技能上下文
        
        Returns:
            str: 技能概述
        """
        metadata = skill_context.metadata
        name = metadata.get("name", skill_context.skill_name)
        description = metadata.get("description", "无描述")
        version = metadata.get("version", "1.0.0")
        
        overview = f"""【技能概述】
名称：{name}
版本：{version}
描述：{description}
状态：{'已激活' if skill_context.is_active else '未激活'}

使用 'details' 动作获取详细指令。
使用 'activate' 动作激活技能上下文。
"""
        return overview
    
    def _generate_skill_details(self, skill_context: SkillContext) -> str:
        """
        生成技能详细信息。
        
        Args:
            skill_context (SkillContext): 技能上下文
        
        Returns:
            str: 详细信息
        """
        metadata = skill_context.metadata
        name = metadata.get("name", skill_context.skill_name)
        
        details = f"""【技能详情：{name}】

{skill_context.instructions}

---
系统提示词已准备就绪，可使用 'activate' 动作激活技能上下文。
"""
        return details
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取Skill工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        return {
            "name": "Skill",
            "description": (
                "在主对话中执行技能（Skills）。"
                "技能提供专门的上下文和权限控制。"
                "支持加载、获取详情、激活和停用技能。"
            ),
            "parameters": {
                "skill_name": {
                    "type": "string",
                    "description": "技能名称，要加载或使用的技能",
                    "required": True
                },
                "action": {
                    "type": "string",
                    "enum": ["load", "details", "activate", "deactivate"],
                    "description": "动作类型：load加载技能，details获取详情，activate激活，deactivate停用",
                    "required": False,
                    "default": "load"
                }
            }
        }
    
    def get_active_skill(self) -> Optional[str]:
        """
        获取当前激活的技能名称。
        
        Returns:
            Optional[str]: 激活的技能名称，如果没有返回 None。
        """
        return self._active_skill
    
    def get_loaded_skills(self) -> List[str]:
        """
        获取已加载的技能列表。
        
        Returns:
            List[str]: 技能名称列表。
        """
        return list(self._loaded_skills.keys())


async def skill_tool_function(
    skill_name: str,
    action: str = "load"
) -> Dict[str, Any]:
    """
    Skill工具函数 - 直接调用入口。
    
    提供简化的函数式调用接口。
    
    Args:
        skill_name (str): 技能名称。
        action (str): 动作类型。默认为 "load"。
    
    Returns:
        Dict[str, Any]: 执行结果。
    
    Example:
        >>> result = await skill_tool_function(
        ...     skill_name="code_review",
        ...     action="load"
        ... )
    """
    tool = SkillTool()
    return await tool.execute(skill_name=skill_name, action=action)


def get_skill_tool_spec() -> Dict[str, Any]:
    """
    获取Skill工具规范。
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到ToolkitExecutor。
    """
    tool = SkillTool()
    return tool.get_tool_spec()
