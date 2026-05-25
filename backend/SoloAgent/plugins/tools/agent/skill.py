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
- 返回技能状态和上下文

渐进式披露：
    技能采用渐进式披露机制：
    1. 第一级：Metadata（name + description）在 Tool Spec 中
    2. 第二级：SKILL.md 完整内容 + folder_path 在 Skill 触发时加载

设计理念：
    文件系统即上下文：
    - SKILL.md 作为"目录"和"指引"
    - 模型根据指引，使用已有的 Read 工具按需读取嵌套资源
    - 不需要预扫描、预加载任何资源

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
import os
import sys
import logging

from .base import BaseAgentTool, ToolContext, ToolPermission

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
        tool_permissions (ToolPermission): 工具权限
        metadata (Dict[str, Any]): 额外元数据（包含 folder_path, description 等）
        is_active (bool): 是否激活
    """
    skill_name: str = ""
    tool_permissions: Optional[ToolPermission] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    is_active: bool = False


class SkillTool(BaseAgentTool):
    needs_runtime_data = True
    """
    Skill工具 - 在主对话中执行技能。
    
    通过Skill工具，Agent可以动态加载和使用技能。
    技能提供专门的上下文和权限控制。
    
    核心功能：
        1. 技能加载：根据名称加载技能配置
        2. 上下文注入：将技能上下文注入当前对话
        3. 渐进式披露：逐步展示技能详情
        4. 返回 folder_path：让模型可以使用 Read 工具读取嵌套资源
    
    渐进式披露级别：
        - 第一级：Metadata（name + description）在 Tool Spec 中
        - 第二级：SKILL.md 完整内容 + folder_path 在 Skill 触发时加载
    
    Example:
        >>> skill_tool = SkillTool(skills_info=[{"name": "canvas-design", "folder_path": "...", "description": "..."}])
        >>> result = await skill_tool.execute(name="canvas-design")
    
    Note:
        - 技能需要预先配置才能使用
        - 技能上下文会影响后续对话
        - 返回 folder_path 让模型可以使用 Read 工具读取嵌套资源
    """
    
    def __init__(
        self,
        skills_info: Optional[List[Dict[str, Any]]] = None,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None,
        skills_dir: Optional[str] = None
    ) -> None:
        """
        初始化Skill工具。
        
        Args:
            skills_info (List[Dict[str, Any]], optional): Skills 信息列表（从编译阶段传入）
                [{"id": "...", "name": "...", "folder_path": "...", "description": "...", ...}]
            context (ToolContext, optional): 工具上下文。默认为 None。
            permission (ToolPermission, optional): 工具权限。默认为 None。
            skills_dir (str, optional): 技能目录路径。默认为 None。
        """
        super().__init__(context, permission)
        self._skills_dir = skills_dir
        self._skills_info = skills_info or []
        self._loaded_skills: Dict[str, SkillContext] = {}
        self._active_skill: Optional[str] = None
        
        for skill in self._skills_info:
            if isinstance(skill, dict):
                name = skill.get("name", skill.get("id", ""))
                if not name:
                    continue
                self._loaded_skills[name] = SkillContext(
                    skill_name=name,
                    metadata={
                        "id": skill.get("id"),
                        "name": name,
                        "description": skill.get("description", ""),
                        "folder_path": skill.get("folder_path"),
                    },
                    is_active=False
                )
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范 - 包含 available_skills XML。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        available_skills_xml = self._format_available_skills_xml()
        skill_names = list(self._loaded_skills.keys())
        
        description = f"""Execute a skill within the main conversation.

Available skills:
{available_skills_xml}

When to use this tool:
  - When a skill is relevant to the user's request
  - When you need specialized capabilities provided by a skill

IMPORTANT: When a skill is relevant, you must invoke this tool IMMEDIATELY as your first action.
NEVER just announce or mention a skill in your text response without actually calling this tool.
Do not invoke a skill if it is already running."""
        
        properties = {
            "name": {
                "type": "string",
                "description": "The skill name (no arguments).",
            }
        }
        
        if skill_names:
            properties["name"]["enum"] = skill_names
        
        return {
            "name": "Skill",
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": ["name"]
            }
        }
    
    def _format_available_skills_xml(self) -> str:
        """
        生成 available_skills XML。
        
        Returns:
            str: available_skills XML 字符串
        """
        if not self._loaded_skills:
            return "<available_skills>\nNo skills available.\n</available_skills>"
        
        lines = ["<available_skills>"]
        for skill_name, skill_context in self._loaded_skills.items():
            description = skill_context.metadata.get("description", "")
            if description:
                lines.append(f"- {skill_name}: {description}")
            else:
                lines.append(f"- {skill_name}")
        lines.append("</available_skills>")
        return "\n".join(lines)
    
    async def execute(
        self,
        name: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行Skill工具 - 返回完整内容 + folder_path。
        
        Args:
            name (str): 技能名称。要加载的技能。
            **kwargs: 额外参数（忽略）。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - skill_name (str): 技能名称
                - content (str): SKILL.md 完整内容
                - folder_path (str): 技能文件夹路径（用于读取嵌套资源）
                - metadata (dict): 技能元数据
        
        Example:
            >>> result = await skill_tool.execute(name="canvas-design")
            >>> print(result["content"])
            >>> print(result["folder_path"])
        """
        if not name:
            return self.create_error_response(
                message="Skill name is required",
                error_code="INVALID_SKILL_NAME"
            )
        
        if self._active_skill == name:
            return self.create_error_response(
                message=f"Skill '{name}' is already running",
                error_code="SKILL_ALREADY_RUNNING"
            )
        
        skill_context = self._loaded_skills.get(name)
        if not skill_context:
            skill_context = await self._get_skill_context(name)
            if not skill_context:
                return self.create_error_response(
                    message=f"Skill '{name}' not found",
                    error_code="SKILL_NOT_FOUND",
                    details={"skill_name": name}
                )
            self._loaded_skills[name] = skill_context
        
        self._active_skill = name
        skill_context.is_active = True
        
        folder_path = skill_context.metadata.get("folder_path", "")
        logger.info(f"[SkillTool] Executing skill '{name}', folder_path: {folder_path}")
        
        instructions = ""
        logger.info(f"[SkillTool] Initial instructions length: 0")
        
        if not instructions and folder_path:
            skill_md_path = os.path.join(folder_path, "SKILL.md")
            logger.info(f"[SkillTool] Trying to read SKILL.md from: {skill_md_path}")
            if os.path.exists(skill_md_path):
                try:
                    with open(skill_md_path, "r", encoding="utf-8") as f:
                        instructions = f.read()
                    logger.info(f"[SkillTool] Read SKILL.md successfully, length: {len(instructions)}")
                except Exception as e:
                    logger.warning(f"Failed to read SKILL.md for '{name}': {e}")
        else:
            logger.info(f"[SkillTool] Using pre-loaded instructions, length: {len(instructions) if instructions else 0}")
        
        logger.info(f"[SkillTool] Final instructions length: {len(instructions) if instructions else 0}")
        
        resources_used = []
        if folder_path and os.path.exists(folder_path):
            for subdir in ["references", "scripts", "assets"]:
                subdir_path = os.path.join(folder_path, subdir)
                if os.path.exists(subdir_path):
                    for root, dirs, files in os.walk(subdir_path):
                        for file in files:
                            full_path = os.path.join(root, file)
                            rel_path = os.path.relpath(full_path, folder_path)
                            resources_used.append(rel_path)
        
        import json
        return {
            "success": True,
            "skill_name": name,
            "error_message": None,
            "content": json.dumps({
                "instructions": instructions if instructions else "",
                "skill_directory": folder_path
            }, ensure_ascii=False),
            "metadata": {
                "resources_used": resources_used
            }
        }
    
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
        
        return None
    
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
            metadata["folder_path"] = skill_path
            
            return SkillContext(
                skill_name=skill_name,
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

