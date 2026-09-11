# -*- coding: utf-8 -*-
"""
文件增量变更计算纯函数模块（NQ4：从 FileChangeManager 下沉为模块级纯函数）。

@file incremental.py
@description 工具调用 → 增量变更 dict 计算（纯逻辑，无实例状态、无 DB）
@author Sh4rlock
@date 2026-08-17

功能描述：
根据工具调用（tool_call）与工作目录，计算单次文件操作的增量变更：
- 多文件路径批量计算
- 单文件计算（ContentType 判定 + FileOperation 推导）

纯函数、无实例状态：供 FileChangeManager（兼容转发）与
SoloAgent.file_change_tracking（NQ4：不再依赖 FileChangeManager 单例实例）共同使用。
"""

from typing import Dict, List, Any

from app.utils.file_utils import (
    get_content_type,
    normalize_file_path,
)
from .file_change_types import FileOperation, ContentType

logger = None  # 本模块为纯计算，不引入日志依赖（有需要时由调用方记录）

FILE_OP_TOOLS = {
    "Write", "SearchReplace", "DeleteFile",
    "write_file", "search_replace", "delete_file", "create_file", "edit_file",
}


def compute_single_file_change(
    tool_name: str,
    tool_args: Dict[str, Any],
    file_path: str,
    working_dir: str,
    tool_call_id: str,
) -> Dict[str, Any] | None:
    """单文件增量变更计算（原 FileChangeManager._compute_single_file_change，纯函数）。"""
    rel_path = normalize_file_path(file_path, working_dir) if working_dir else file_path.replace('\\', '/')

    content_type = get_content_type(rel_path) if working_dir else ContentType.TEXT.value

    if content_type != ContentType.TEXT.value:
        operation = FileOperation.DELETED.value if tool_name in ("DeleteFile", "delete_file") else FileOperation.CREATED.value
        change = {
            "file_path": rel_path,
            "operation": operation,
            "content_type": content_type,
            "tool_call_id": tool_call_id,
        }
        return change

    if tool_name in ("DeleteFile", "delete_file"):
        operation = FileOperation.DELETED.value
    elif tool_name in ("Write", "write_file", "create_file"):
        operation = FileOperation.CREATED.value
    else:
        operation = FileOperation.MODIFIED.value

    change = {
        "file_path": rel_path,
        "operation": operation,
        "content_type": content_type,
        "tool_call_id": tool_call_id,
    }

    return change


def compute_incremental_change(
    tool_call: Dict[str, Any],
    working_dir: str,
) -> List[Dict[str, Any]] | Dict[str, Any] | None:
    """增量变更计算入口（原 FileChangeManager.compute_incremental_change，纯函数）。"""
    tool_name = tool_call.get("name")
    if not tool_name or tool_name not in FILE_OP_TOOLS:
        return None

    tool_args = tool_call.get("arguments") or {}

    file_paths = tool_args.get("file_paths", [])
    if not file_paths:
        single_path = tool_args.get("path") or tool_args.get("file_path") or tool_args.get("filepath")
        if single_path:
            file_paths = [single_path]

    if not file_paths:
        return None

    if len(file_paths) == 1:
        return compute_single_file_change(
            tool_name, tool_args, file_paths[0], working_dir, tool_call.get("id")
        )

    changes = []
    for fp in file_paths:
        change = compute_single_file_change(
            tool_name, tool_args, fp, working_dir, tool_call.get("id")
        )
        if change:
            changes.append(change)

    return changes