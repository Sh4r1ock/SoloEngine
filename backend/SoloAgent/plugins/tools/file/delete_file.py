# -*- coding: utf-8 -*-
"""
SoloEngine : 文件删除工具模块，提供文件删除功能

@file delete_file.py
@description 提供文件删除功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 支持一次删除多个文件
- 删除前验证文件存在
- 返回每个文件的删除结果

状态: ✅ 模块初始化完成
"""

import logging
import os
from typing import Dict, Any, List

from .base import BaseFileTool, FileToolError
from .._hitl import request_approval, plan_mode_guard

logger = logging.getLogger(__name__)


class DeleteFile(BaseFileTool):
    """
    文件删除工具。

    删除一个或多个文件，支持批量删除。
    删除属于高风险操作：执行前等待用户在工具调用面板中批准/驳回，
    用户批准后才真正删除（对齐主流 AI IDE 的删除批准设计）。

    核心功能：
        1. 批量删除：一次删除多个文件
        2. 存在验证：删除前验证文件存在
        3. 结果返回：返回每个文件的删除结果

    注意事项：
        - 只能删除文件，不能删除目录
        - 删除前必须验证文件存在
        - 删除操作不可逆，需要用户批准

    Example:
        >>> delete_tool = DeleteFile()
        >>> result = await delete_tool.execute(
        ...     file_paths=["/path/to/file1.py", "/path/to/file2.py"]
        ... )
    """

    async def execute(
        self,
        file_paths: List[str],
    ) -> Dict[str, Any]:
        """
        执行文件删除操作。

        删除前等待用户在工具调用面板中批准，批准后才删除。

        Args:
            file_paths (List[str]): 要删除的文件绝对路径列表。

        Returns:
            Dict[str, Any]: 删除结果，包含：
                - content (str): 操作结果摘要
                - success (bool): 整体是否成功
                - error_message (Optional[str]): 错误信息
                - results (List[Dict]): 每个文件的删除结果
                - approved (bool): 用户是否批准
                - canceled (bool): 是否被用户取消
                - success_count (int): 成功删除数
                - fail_count (int): 失败数

        Raises:
            FileToolError: 当 file_paths 为空时抛出。
            FileToolError: 当路径不是绝对路径时抛出。
        """
        # Plan 模式守卫（read-only 锁定）：处于计划模式时拒绝删除（特殊点位处理，非 plan 模式返回 None 放行原路径）
        guard = plan_mode_guard(__class__.__name__)
        if guard:
            return guard

        if not file_paths:
            raise FileToolError("file_paths 不能为空")

        for file_path in file_paths:
            self.validate_absolute_path(file_path)

        # 删除属于高风险操作：等待用户在工具调用面板中批准/驳回（统一 HITL 批准机制）。
        # 用户决策经前端 → WS execute → run.py enqueue_message 进入业务消息队列，
        # request_approval 内部 await 该队列即实现"删除前等待用户批准"。
        approved = await request_approval("删除文件确认")
        if approved is False:
            return {
                "content": "用户未批准删除操作，未删除任何文件。",
                "success": False,
                "error_message": "用户未批准删除操作",
                "approved": False,
                "canceled": True,
                "results": [],
                "success_count": 0,
                "fail_count": 0,
                "metadata": {"resources_used": file_paths},
            }

        results: List[Dict[str, Any]] = []
        success_count = 0
        fail_count = 0

        for file_path in file_paths:
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
            "approved": True,
            "canceled": False,
            "success_count": success_count,
            "fail_count": fail_count,
            "metadata": {
                "resources_used": file_paths
            }
        }

    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取删除文件工具的规范定义。

        Returns:
            Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
        """
        return {
            "name": "DeleteFile",
            "description": (
                "删除一个或多个文件。"
                "删除属于高风险操作，调用后工具会暂停等待用户批准，"
                "用户批准后才真正删除文件。"
                "支持批量删除，返回每个文件的删除结果。"
                "注意：删除操作不可逆。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要删除的文件绝对路径列表。",
                    },
                },
                "required": ["file_paths"],
            },
        }

