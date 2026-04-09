# -*- coding: utf-8 -*-
"""
SoloEngine : Skills包解析器模块

@file skill_parser.py
@description Skills包解析器 - 用于解析SKILL.md和包结构
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 解析SKILL.md文件
    - 解析Skills包结构
    - 生成Skills提示词
    - 创建新Skills包

依赖:
    - os: 操作系统接口
    - re: 正则表达式
    - yaml: YAML解析
    - typing: 类型注解支持
    - pathlib: 路径处理
    - logging: 日志记录

使用示例:
    - from app.utils.skill_parser import SkillParser, SkillsPackageBuilder
    - parser = SkillParser("/path/to/skills")
    - package = parser.parse_package("/path/to/skill")

设计理念：
    Skills包采用SKILL.md作为元数据文件，支持YAML前置元数据。
"""

import os
import re
import yaml
from typing import Dict, List, Optional, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class SkillMetadata:
    """Skills 包元数据。"""

    def __init__(
        self,
        name: str,
        version: str = "1.0.0",
        description: str = "",
        author: str = "",
        tags: List[str] = None,
        instructions: str = "",
    ):
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.tags = tags or []
        self.instructions = instructions

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "tags": self.tags,
            "instructions": self.instructions,
        }


class SkillFile:
    """Skill 文件信息。"""

    def __init__(
        self,
        path: str,
        name: str,
        type: str,  # 'skill', 'script', 'reference', 'asset'
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.path = path
        self.name = name
        self.type = type
        self.content = content
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "path": self.path,
            "name": self.name,
            "type": self.type,
            "content": self.content,
            "metadata": self.metadata,
        }


class SkillsPackage:
    """Skills 包。"""

    def __init__(self, root_path: str):
        self.root_path = root_path
        self.name = Path(root_path).name
        self.metadata: Optional[SkillMetadata] = None
        self.skills: List[SkillFile] = []
        self.common_files: List[SkillFile] = []

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "root_path": self.root_path,
            "name": self.name,
            "metadata": self.metadata.to_dict() if self.metadata else None,
            "skills": [s.to_dict() for s in self.skills],
            "common_files": [f.to_dict() for f in self.common_files],
        }


class SkillParser:
    """Skills 包解析器。"""

    FRONTMATTER_PATTERN = re.compile(r'^---\s*\n(.*?)\n---\s*\n(.*)$', re.DOTALL)

    def __init__(self, skills_dir: str):
        """初始化解析器。

        Args:
            skills_dir: Skills 根目录
        """
        self.skills_dir = skills_dir

    def parse_package(self, package_path: str) -> SkillsPackage:
        """解析 Skills 包。

        Args:
            package_path: Skills 包路径

        Returns:
            SkillsPackage 对象
        """
        package = SkillsPackage(package_path)

        # 解析 SKILL.md
        skill_md_path = os.path.join(package_path, "SKILL.md")
        if os.path.exists(skill_md_path):
            package.metadata = self.parse_skill_md(skill_md_path)

        # 解析 skills 目录
        skills_dir = os.path.join(package_path, "skills")
        if os.path.exists(skills_dir):
            self._parse_skills_dir(skills_dir, package)

        # 解析 common 目录
        common_dir = os.path.join(package_path, "common")
        if os.path.exists(common_dir):
            self._parse_common_dir(common_dir, package)

        return package

    def parse_skill_md(self, skill_md_path: str) -> SkillMetadata:
        """解析 SKILL.md 文件。

        Args:
            skill_md_path: SKILL.md 文件路径

        Returns:
            SkillMetadata 对象
        """
        with open(skill_md_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 解析 frontmatter
        match = self.FRONTMATTER_PATTERN.match(content)
        if match:
            frontmatter_str = match.group(1)
            instructions = match.group(2)

            try:
                frontmatter = yaml.safe_load(frontmatter_str)
            except yaml.YAMLError as e:
                logger.error(f"解析 SKILL.md frontmatter 失败: {e}")
                frontmatter = {}
        else:
            frontmatter = {}
            instructions = content

        return SkillMetadata(
            name=frontmatter.get("name", ""),
            version=frontmatter.get("version", "1.0.0"),
            description=frontmatter.get("description", ""),
            author=frontmatter.get("author", ""),
            tags=frontmatter.get("tags", []),
            instructions=instructions,
        )

    def _parse_skills_dir(self, skills_dir: str, package: SkillsPackage):
        """解析 skills 目录。"""
        for skill_name in os.listdir(skills_dir):
            skill_path = os.path.join(skills_dir, skill_name)
            if not os.path.isdir(skill_path):
                continue

            # 解析子技能的 SKILL.md
            skill_md_path = os.path.join(skill_path, "SKILL.md")
            if os.path.exists(skill_md_path):
                with open(skill_md_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                package.skills.append(SkillFile(
                    path=skill_md_path,
                    name=skill_name,
                    type="skill",
                    content=content,
                ))

            # 解析 scripts 目录
            scripts_dir = os.path.join(skill_path, "scripts")
            if os.path.exists(scripts_dir):
                for script_file in os.listdir(scripts_dir):
                    script_path = os.path.join(scripts_dir, script_file)
                    if os.path.isfile(script_path):
                        with open(script_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        package.skills.append(SkillFile(
                            path=script_path,
                            name=f"{skill_name}/{script_file}",
                            type="script",
                            content=content,
                        ))

            # 解析 references 目录
            refs_dir = os.path.join(skill_path, "references")
            if os.path.exists(refs_dir):
                for ref_file in os.listdir(refs_dir):
                    ref_path = os.path.join(refs_dir, ref_file)
                    if os.path.isfile(ref_path):
                        with open(ref_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        package.skills.append(SkillFile(
                            path=ref_path,
                            name=f"{skill_name}/{ref_file}",
                            type="reference",
                            content=content,
                        ))

    def _parse_common_dir(self, common_dir: str, package: SkillsPackage):
        """解析 common 目录。"""
        # templates
        templates_dir = os.path.join(common_dir, "templates")
        if os.path.exists(templates_dir):
            for template_file in os.listdir(templates_dir):
                template_path = os.path.join(templates_dir, template_file)
                if os.path.isfile(template_path):
                    with open(template_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    package.common_files.append(SkillFile(
                        path=template_path,
                        name=f"templates/{template_file}",
                        type="script",
                        content=content,
                    ))

        # references
        refs_dir = os.path.join(common_dir, "references")
        if os.path.exists(refs_dir):
            for ref_file in os.listdir(refs_dir):
                ref_path = os.path.join(refs_dir, ref_file)
                if os.path.isfile(ref_path):
                    with open(ref_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    package.common_files.append(SkillFile(
                        path=ref_path,
                        name=f"references/{ref_file}",
                        type="reference",
                        content=content,
                    ))

    def generate_prompt(
        self,
        package: SkillsPackage,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """生成包含 Skills 的提示词。

        Args:
            package: Skills 包
            context: 上下文变量

        Returns:
            生成的提示词
        """
        if not package.metadata:
            return ""

        instructions = package.metadata.instructions
        context = context or {}

        # 替换上下文变量
        for key, value in context.items():
            instructions = instructions.replace(f"{{{{ {key} }}}}", str(value))

        return instructions

    def list_packages(self) -> List[str]:
        """列出所有 Skills 包。"""
        if not os.path.exists(self.skills_dir):
            return []

        packages = []
        for name in os.listdir(self.skills_dir):
            path = os.path.join(self.skills_dir, name)
            if os.path.isdir(path) and os.path.exists(os.path.join(path, "SKILL.md")):
                packages.append(path)

        return packages


class SkillsPackageBuilder:
    """Skills 包构建器，用于创建新的 Skills 包。"""

    @staticmethod
    def create_package(
        skills_dir: str,
        name: str,
        description: str = "",
        author: str = "",
        tags: List[str] = None,
    ) -> str:
        """创建新的 Skills 包。

        Args:
            skills_dir: Skills 根目录
            name: 包名称
            description: 描述
            author: 作者
            tags: 标签

        Returns:
            新包的路径
        """
        package_path = os.path.join(skills_dir, name)

        # 创建目录结构
        os.makedirs(package_path, exist_ok=True)
        os.makedirs(os.path.join(package_path, "skills"), exist_ok=True)
        os.makedirs(os.path.join(package_path, "common", "templates"), exist_ok=True)
        os.makedirs(os.path.join(package_path, "common", "references"), exist_ok=True)

        # 创建 SKILL.md
        skill_md_content = f"""---
name: {name}
version: 1.0.0
description: {description}
author: {author}
tags: {tags or []}
---

# {name}

{description}

## 指令

在此处编写你的技能指令...

## 示例

以下是使用此技能的示例：

```text
用户需求: [用户的具体需求]
执行步骤: [详细的执行步骤]
```
"""

        with open(os.path.join(package_path, "SKILL.md"), 'w', encoding='utf-8') as f:
            f.write(skill_md_content)

        # 创建示例技能
        example_skill_dir = os.path.join(package_path, "skills", "example")
        os.makedirs(example_skill_dir, exist_ok=True)

        example_skill_content = f"""---
name: 示例技能
description: 示例技能的描述
---

# 示例技能

这是 {name} 包中的一个示例技能。

## 使用说明

在此处编写技能的使用说明...
"""

        with open(os.path.join(example_skill_dir, "SKILL.md"), 'w', encoding='utf-8') as f:
            f.write(example_skill_content)

        return package_path
