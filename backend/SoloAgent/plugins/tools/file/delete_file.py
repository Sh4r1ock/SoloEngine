# -*- coding: utf-8 -*-
"""
文件删除工具模块。

@file delete_file.py
@description 提供文件删除功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 支持一次删除多个文件
- 删除前验证文件存在
- 返回每个文件的删除结果

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any, List

from .base import BaseFileTool, FileToolError


class DeleteFile(BaseFileTool):
    """
    文件删除工具。
    
    删除一个或多个文件，支持批量删除。
    
    核心功能：
        1. 批量删除：一次删除多个文件
        2. 存在验证：删除前验证文件存在
        3. 结果返回：返回每个文件的删除结果
    
    注意事项：
        - 只能删除文件，不能删除目录
        - 删除前必须验证文件存在
        - 删除操作不可逆
    
    Example:
        >>> delete_tool = DeleteFile()
        >>> result = delete_tool.execute(
        ...     file_paths=["/path/to/file1.py", "/path/to/file2.py"]
        ... )
    """
    
    def execute(
        self,
        file_paths: List[str],
    ) -> Dict[str, Any]:
        """
        执行文件删除操作。
        
        删除指定的文件列表。删除前会验证每个文件是否存在。
        
        Args:
            file_paths (List[str]): 要删除的文件绝对路径列表。
        
        Returns:
            Dict[str, Any]: 删除结果，包含：
                - content (str): 操作结果摘要
                - success (bool): 整体是否成功
                - error_message (Optional[str]): 错误信息
                - results (List[Dict]): 每个文件的删除结果
                    - path: 文件路径
                    - success: 是否成功
                    - error: 错误信息（如果失败）
        
        Raises:
            FileToolError: 当 file_paths 为空时抛出。
            FileToolError: 当路径不是绝对路径时抛出。
            FileToolError: 当文件不存在时抛出。
        
        Example:
            >>> result = delete_tool.execute(
            ...     file_paths=["/home/user/temp1.txt", "/home/user/temp2.txt"]
            ... )
            >>> print(result["success"])  # True
        """
        if not file_paths:
            raise FileToolError("file_paths 不能为空")
        
        results: List[Dict[str, Any]] = []
        success_count = 0
        fail_count = 0
        
        for file_path in file_paths:
            self.validate_absolute_path(file_path)
            
            if not self.file_exists(file_path):
                results.append({
                    "path": file_path,
                    "success": False,
                    "error": f"文件不存在: {file_path}",
                })
                fail_count += 1
                continue
            
            try:
                os.remove(file_path)
                results.append({
                    "path": file_path,
                    "success": True,
                    "error": None,
                })
                success_count += 1
            except Exception as e:
                results.append({
                    "path": file_path,
                    "success": False,
                    "error": str(e),
                })
                fail_count += 1
        
        overall_success = fail_count == 0
        
        content = f"删除完成: 成功 {success_count} 个, 失败 {fail_count} 个"
        
        return {
            "content": content,
            "success": overall_success,
            "error_message": None if overall_success else f"有 {fail_count} 个文件删除失败",
            "results": results,
            "success_count": success_count,
            "fail_count": fail_count,
        }


def delete_files(
    file_paths: List[str],
) -> Dict[str, Any]:
    """
    删除文件的便捷函数。
    
    Args:
        file_paths (List[str]): 要删除的文件绝对路径列表。
    
    Returns:
        Dict[str, Any]: 删除结果。
    
    Example:
        >>> result = delete_files(["/path/to/file1.py", "/path/to/file2.py"])
    """
    tool = DeleteFile()
    return tool.execute(file_paths=file_paths)


def get_delete_file_tool_spec() -> Dict[str, Any]:
    """
    获取删除文件工具的规范定义。
    
    Returns:
        Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
    """
    return {
        "name": "DeleteFile",
        "description": (
            "删除一个或多个文件。"
            "删除前会验证文件是否存在。"
            "支持批量删除，返回每个文件的删除结果。"
            "注意：删除操作不可逆。"
        ),
        "parameters": {
            "file_paths": {
                "type": "array",
                "items": {"type": "string"},
                "description": "要删除的文件绝对路径列表。",
                "required": True,
            },
        },
    }
