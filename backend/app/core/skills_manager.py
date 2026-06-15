# -*- coding: utf-8 -*-
"""
SoloEngine : Skills包管理器模块

@file skills_manager.py
@description Skills管理器 - Skills包管理模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 管理Skills包的安装、卸载、更新
    - 安装Skills包、卸载Skills包
    - 更新Skills包、加载Skills配置
    - Skills包的导入导出
    - Skills包搜索

依赖:
    - os: 操作系统接口
    - shutil: 文件操作
    - logging: 日志记录
    - typing: 类型注解支持
    - pathlib: 路径处理
    - zipfile: ZIP文件处理
    - tempfile: 临时文件处理
    - app.utils.skill_parser: Skill解析器

使用示例:
    - from app.core.skills_manager import SkillsManager
    - manager = SkillsManager()
    - packages = manager.list_packages()
    - manager.import_package("/path/to/skill.zip")

使用场景：
    - Skills包的生命周期管理
    - Skills包的导入导出

注意事项：
    - Skills包需要正确配置元数据
    - 支持ZIP格式导入导出
"""

import os
import shutil
import logging
from typing import List, Dict, Optional, Any
from pathlib import Path
import zipfile
import tempfile

from app.utils.skill_parser import SkillParser, SkillsPackageBuilder

logger = logging.getLogger(__name__)


class SkillsManager:
    """Skills 包管理器。"""

    def __init__(self, skills_dir: Optional[str] = None):
        """初始化 Skills 管理器。

        Args:
            skills_dir: Skills 根目录，默认为 ./skills
        """
        if skills_dir:
            self.skills_dir = skills_dir
        else:
            # 默认使用项目根目录下的 skills 目录
            self.skills_dir = os.path.join(os.getcwd(), "skills")

        # 确保 skills 目录存在
        os.makedirs(self.skills_dir, exist_ok=True)

        self.parser = SkillParser(self.skills_dir)

    def list_packages(self) -> List[Dict[str, Any]]:
        """列出所有 Skills 包。

        Returns:
            Skills 包列表
        """
        packages = []

        for package_path in self.parser.list_packages():
            try:
                package = self.parser.parse_package(package_path)
                packages.append({
                    "path": package_path,
                    "name": package.name,
                    "metadata": package.metadata.to_dict() if package.metadata else None,
                    "skill_count": len(package.skills),
                    "created_at": os.path.getctime(package_path),
                    "modified_at": os.path.getmtime(package_path),
                })
            except Exception as e:
                logger.error(f"解析包 {package_path} 失败: {e}")

        # 按修改时间排序
        packages.sort(key=lambda x: x["modified_at"], reverse=True)
        return packages

    def get_package(self, package_name: str) -> Optional[Dict[str, Any]]:
        """获取指定的 Skills 包。

        Args:
            package_name: 包名称

        Returns:
            Skills 包信息
        """
        package_path = os.path.join(self.skills_dir, package_name)

        if not os.path.exists(package_path):
            return None

        try:
            package = self.parser.parse_package(package_path)
            return package.to_dict()
        except Exception as e:
            logger.error(f"解析包 {package_name} 失败: {e}")
            return None

    def create_package(
        self,
        name: str,
        description: str = "",
        author: str = "",
        tags: List[str] = None,
    ) -> str:
        """创建新的 Skills 包。

        Args:
            name: 包名称
            description: 描述
            author: 作者
            tags: 标签

        Returns:
            新包的路径
        """
        return SkillsPackageBuilder.create_package(
            self.skills_dir,
            name,
            description,
            author,
            tags,
        )

    def delete_package(self, package_name: str) -> bool:
        """删除 Skills 包。

        Args:
            package_name: 包名称

        Returns:
            是否成功删除
        """
        package_path = os.path.join(self.skills_dir, package_name)

        if not os.path.exists(package_path):
            return False

        try:
            shutil.rmtree(package_path)
            return True
        except Exception as e:
            logger.error(f"删除包 {package_name} 失败: {e}")
            return False

    def import_package(self, source_path: str) -> Optional[str]:
        """导入 Skills 包。

        Args:
            source_path: 源文件/目录路径

        Returns:
            导入后的包路径
        """
        # 检查源路径类型
        if os.path.isfile(source_path):
            # ZIP 文件
            if source_path.endswith('.zip'):
                return self._import_zip(source_path)
            else:
                logger.error(f"不支持的文件类型: {source_path}")
                return None
        elif os.path.isdir(source_path):
            # 目录
            return self._import_directory(source_path)
        else:
            logger.error(f"无效的源路径: {source_path}")
            return None

    def _import_zip(self, zip_path: str) -> Optional[str]:
        """从 ZIP 文件导入。"""
        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                # 找到 SKILL.md 以确定包名称
                package_name = None
                for file_info in zip_ref.filelist:
                    if file_info.filename.endswith('SKILL.md'):
                        # 获取顶层目录名
                        path_parts = file_info.filename.split('/')
                        if len(path_parts) > 0:
                            package_name = path_parts[0]
                        break

                if not package_name:
                    package_name = Path(zip_path).stem

                # 提取包
                extract_dir = os.path.join(self.skills_dir, package_name)
                os.makedirs(extract_dir, exist_ok=True)

                zip_ref.extractall(extract_dir)

                # 验证包
                if os.path.exists(os.path.join(extract_dir, "SKILL.md")):
                    return extract_dir
                else:
                    shutil.rmtree(extract_dir)
                    logger.error(f"ZIP 文件中未找到 SKILL.md: {zip_path}")
                    return None

        except Exception as e:
            logger.error(f"导入 ZIP 文件失败: {e}")
            return None

    def _import_directory(self, source_dir: str) -> Optional[str]:
        """从目录导入。"""
        try:
            # 检查是否包含 SKILL.md
            skill_md_path = os.path.join(source_dir, "SKILL.md")
            if not os.path.exists(skill_md_path):
                logger.error(f"目录中未找到 SKILL.md: {source_dir}")
                return None

            # 获取包名称
            package_name = os.path.basename(source_dir)
            dest_dir = os.path.join(self.skills_dir, package_name)

            # 复制目录
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir)

            shutil.copytree(source_dir, dest_dir)

            return dest_dir

        except Exception as e:
            logger.error(f"导入目录失败: {e}")
            return None

    def export_package(
        self,
        package_name: str,
        format: str = "zip",
    ) -> Optional[str]:
        """导出 Skills 包。

        Args:
            package_name: 包名称
            format: 导出格式 ('zip' 或 'dir')

        Returns:
            导出后的路径
        """
        source_path = os.path.join(self.skills_dir, package_name)

        if not os.path.exists(source_path):
            return None

        try:
            if format == "zip":
                # 导出为 ZIP
                export_path = os.path.join(
                    tempfile.gettempdir(),
                    f"{package_name}.zip"
                )

                with zipfile.ZipFile(export_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
                    for root, dirs, files in os.walk(source_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, source_path)
                            zip_ref.write(file_path, arcname)

                return export_path

            elif format == "dir":
                # 返回目录路径
                return source_path

            else:
                logger.error(f"不支持的导出格式: {format}")
                return None

        except Exception as e:
            logger.error(f"导出包 {package_name} 失败: {e}")
            return None

    def search_packages(
        self,
        query: str,
        tags: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """搜索 Skills 包。

        Args:
            query: 搜索查询
            tags: 标签过滤

        Returns:
            匹配的包列表
        """
        all_packages = self.list_packages()
        results = []

        for package in all_packages:
            # 名称搜索
            if query.lower() in package["name"].lower():
                results.append(package)
                continue

            # 描述搜索
            metadata = package.get("metadata", {})
            description = metadata.get("description", "")
            if query.lower() in description.lower():
                results.append(package)
                continue

            # 标签过滤
            if tags:
                package_tags = metadata.get("tags", [])
                if any(tag in package_tags for tag in tags):
                    results.append(package)

        return results
