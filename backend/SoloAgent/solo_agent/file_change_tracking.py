# -*- coding: utf-8 -*-
"""
SoloEngine : 文件变更追踪模块

@file file_change_tracking.py
@description 从 agent.py 提取的文件变更追踪逻辑：工具调用前后文件哈希比对、
            增量变更计算、CAS 内容寻址存储、diff 生成与事件上报
@author Sh4rlock
@date 2026-08-13

功能描述：
本模块提供工具执行过程中的文件变更追踪：
    - 工具执行前记录文件 CAS 哈希（on_tool_executing）
    - 工具执行后计算增量变更并上报事件（on_tool_executed）
    - 文件路径提取与 MCP 工具文件路径识别

设计说明：
    - 纯文件边界移动：公开方法签名与 agent.py 原实现完全一致
    - 状态（working_dir / pre_tool_hashes / event_callback）经 agent 引用访问
"""

import os
from typing import Any, Dict, List, Optional


class FileChangeTracker:
    """文件变更追踪器，负责工具调用前后文件哈希比对与变更计算。"""

    FILE_OP_TOOLS = {"Write", "SearchReplace", "DeleteFile", "write_file", "search_replace", "delete_file", "create_file", "edit_file"}

    MCP_FILE_PATH_PARAMS = {
        "path", "file_path", "filePath", "filepath",
        "source_path", "target_path", "output_path", "destination",
        "notebook_path", "image_path", "document_path",
        "directory", "dir_path", "folder_path",
    }

    MCP_FILE_PATH_ARRAY_PARAMS = {
        "paths", "files", "file_paths", "filePaths",
    }

    def __init__(self, agent: Any) -> None:
        """绑定宿主 SoloAgent 实例（访问 working_dir / pre_tool_hashes / event_callback）。"""
        self._agent = agent

    # ------------------------------------------------------------------ #
    # 工具执行前：记录文件 CAS 哈希
    # ------------------------------------------------------------------ #
    async def on_tool_executing(self, tool_call: Dict) -> None:
        tool_name = tool_call.get("name")

        if tool_name in self.FILE_OP_TOOLS:
            file_paths = self.extract_all_file_paths(tool_call)
            for fp in file_paths:
                abs_path = os.path.join(self._agent._working_dir, fp) if not os.path.isabs(fp) else fp
                # 仅对文件存储 CAS（LS 等工具返回的路径可能为目录，
                # 目录 open('rb') 会抛 PermissionError）
                if os.path.exists(abs_path) and os.path.isfile(abs_path):
                    from app.core.content_addressable_storage import cas
                    from app.utils.file_utils import normalize_file_path
                    before_hash = cas.store_file(abs_path)
                    rel_path = normalize_file_path(abs_path, self._agent._working_dir)
                    self._agent._pre_tool_hashes[rel_path] = before_hash

        elif self.is_mcp_tool(tool_name):
            file_paths = self.extract_mcp_file_paths(tool_call)
            for fp in file_paths:
                abs_path = os.path.join(self._agent._working_dir, fp) if not os.path.isabs(fp) else fp
                if os.path.exists(abs_path) and os.path.isfile(abs_path):
                    from app.core.content_addressable_storage import cas
                    from app.utils.file_utils import normalize_file_path
                    before_hash = cas.store_file(abs_path)
                    rel_path = normalize_file_path(abs_path, self._agent._working_dir)
                    self._agent._pre_tool_hashes[rel_path] = before_hash

    # ------------------------------------------------------------------ #
    # 工具执行后：计算增量变更并上报事件
    # ------------------------------------------------------------------ #
    async def on_tool_executed(self, tool_call: Dict, result: Any):
        if not self._agent._working_dir:
            return

        tool_name = tool_call.get("name")
        change_list = []
        _working_dir = self._agent._working_dir
        _pre_tool_hashes = self._agent._pre_tool_hashes

        try:
            if tool_name in self.FILE_OP_TOOLS:
                # NQ4：直接导入 services 层下沉的纯函数（不再依赖 FileChangeManager
                # 单例实例；延迟 import 保持函数内加载，避免模块级反向依赖）
                from app.services.file_change.incremental import compute_incremental_change
                changes = compute_incremental_change(
                    tool_call=tool_call,
                    working_dir=_working_dir
                )
                change_list = changes if isinstance(changes, list) else ([changes] if changes else [])
                for change in change_list:
                    if change:
                        fp = change.get("file_path", "")
                        abs_path = os.path.join(_working_dir, fp)

                        if fp in _pre_tool_hashes and change.get("operation") == "created":
                            change["operation"] = "modified"

                        if change.get("operation") == "deleted":
                            change["before_content_hash"] = _pre_tool_hashes.pop(fp, None)
                            change["after_content_hash"] = None
                        elif os.path.exists(abs_path):
                            from app.core.content_addressable_storage import cas
                            after_hash = cas.store_file(abs_path)
                            change["before_content_hash"] = _pre_tool_hashes.get(fp)
                            change["after_content_hash"] = after_hash
                            _pre_tool_hashes[fp] = after_hash

                        if change.get("content_type", "text") == "text":
                            if change.get("operation") == "deleted":
                                if change.get("before_content_hash"):
                                    try:
                                        from app.core.content_addressable_storage import cas
                                        from app.utils.file_utils import compute_text_diff
                                        old_bytes = cas.get_content(change["before_content_hash"])
                                        old_content = old_bytes.decode('utf-8', errors='replace') if old_bytes else ""
                                        diff_data = compute_text_diff(old_content, "", fp)
                                        change["diff"] = diff_data
                                    except Exception as e:
                                        import logging
                                        logging.getLogger("SoloEngine").warning(f"Failed to compute diff for deleted {fp}: {e}")
                            elif os.path.exists(abs_path):
                                try:
                                    from app.core.content_addressable_storage import cas
                                    from app.utils.file_utils import compute_text_diff
                                    if change.get("before_content_hash"):
                                        old_bytes = cas.get_content(change["before_content_hash"])
                                        old_content = old_bytes.decode('utf-8', errors='replace') if old_bytes else ""
                                    else:
                                        old_content = ""
                                    with open(abs_path, 'rb') as f:
                                        new_content = f.read().decode('utf-8', errors='replace')
                                    diff_data = compute_text_diff(old_content, new_content, fp)
                                    change["diff"] = diff_data
                                except Exception as e:
                                    import logging
                                    logging.getLogger("SoloEngine").warning(f"Failed to compute diff for {fp}: {e}")

                        if "content_type" not in change:
                            from app.utils.file_utils import get_content_type
                            change["content_type"] = get_content_type(fp)

            elif self.is_mcp_tool(tool_name):
                file_paths = self.extract_mcp_file_paths(tool_call)
                from app.core.content_addressable_storage import cas
                from app.utils.file_utils import get_content_type, normalize_file_path
                for fp in file_paths:
                    abs_path = os.path.join(_working_dir, fp) if not os.path.isabs(fp) else fp
                    rel_path = normalize_file_path(abs_path, _working_dir)
                    before_hash = _pre_tool_hashes.get(rel_path)
                    content_type = get_content_type(rel_path)

                    # 仅对文件存储 CAS（LS 等工具返回的路径可能为目录，
                    # 目录 open('rb') 会抛 PermissionError）
                    if os.path.exists(abs_path) and os.path.isfile(abs_path):
                        after_hash = cas.store_file(abs_path)
                        if before_hash and before_hash != after_hash:
                            change_list.append({
                                "file_path": rel_path,
                                "operation": "modified",
                                "tool_call_id": tool_call.get("id"),
                                "before_content_hash": before_hash,
                                "after_content_hash": after_hash,
                                "content_type": content_type,
                            })
                        elif not before_hash:
                            change_list.append({
                                "file_path": rel_path,
                                "operation": "created",
                                "tool_call_id": tool_call.get("id"),
                                "before_content_hash": None,
                                "after_content_hash": after_hash,
                                "content_type": content_type,
                            })
                    elif before_hash:
                        change_list.append({
                            "file_path": rel_path,
                            "operation": "deleted",
                            "tool_call_id": tool_call.get("id"),
                            "before_content_hash": before_hash,
                            "after_content_hash": None,
                            "content_type": content_type,
                        })

            if change_list and self._agent._event_callback:
                # C6：ExecutionEvent 定义在 .compiler.events（flow_compiler 仅为 re-export），
                # 直接从真实定义处导入，避免反向依赖 flow_compiler 实现模块
                from .compiler.events import ExecutionEvent
                event = ExecutionEvent(
                    event_type="file_change_preview",
                    agent_id=self._agent.agent_id,
                    agent_name=self._agent.name,
                    file_changes=change_list,
                )
                self._agent._event_callback(event)

        except Exception as e:
            import logging
            logging.getLogger("SoloEngine").warning(f"Failed to compute change: {e}", exc_info=True)

    # ------------------------------------------------------------------ #
    # 文件路径提取辅助
    # ------------------------------------------------------------------ #
    @staticmethod
    def extract_all_file_paths(tool_call: Dict) -> List[str]:
        args = tool_call.get("arguments", {}) or tool_call.get("function", {}).get("arguments", {})
        if isinstance(args, str):
            import json
            try:
                args = json.loads(args)
            except Exception:
                return []

        paths = []
        single = args.get("path") or args.get("file_path") or args.get("filePath")
        if single and isinstance(single, str):
            paths.append(single)

        multi = args.get("file_paths") or args.get("filePaths")
        if multi and isinstance(multi, list):
            paths.extend([p for p in multi if isinstance(p, str)])

        return paths

    @classmethod
    def is_mcp_tool(cls, tool_name: str) -> bool:
        return tool_name not in cls.FILE_OP_TOOLS and tool_name not in {"RunCommand", "Task"}

    def extract_mcp_file_paths(self, tool_call: Dict) -> List[str]:
        args = tool_call.get("arguments", {}) or {}
        if isinstance(args, str):
            import json
            try:
                args = json.loads(args)
            except Exception:
                return []

        file_paths = []

        for param_name in self.MCP_FILE_PATH_PARAMS:
            if param_name in args and isinstance(args[param_name], str):
                val = args[param_name]
                if self.looks_like_file_path(val):
                    file_paths.append(val)

        for param_name, val in args.items():
            if param_name in self.MCP_FILE_PATH_PARAMS:
                continue
            if isinstance(val, str) and self.looks_like_file_path(val):
                param_lower = param_name.lower()
                if any(kw in param_lower for kw in ("path", "file", "dir", "output", "dest", "source", "target", "folder", "location", "uri")):
                    file_paths.append(val)

        for param_name in self.MCP_FILE_PATH_ARRAY_PARAMS:
            if param_name in args and isinstance(args[param_name], list):
                file_paths.extend([p for p in args[param_name] if isinstance(p, str) and self.looks_like_file_path(p)])

        if "uri" in args and isinstance(args["uri"], str) and args["uri"].startswith("file://"):
            from urllib.parse import urlparse
            parsed = urlparse(args["uri"])
            if parsed.path:
                file_paths.append(parsed.path)

        return list(set(file_paths))

    @staticmethod
    def looks_like_file_path(val: str) -> bool:
        if not val or len(val) < 2:
            return False
        return (
            val.startswith("/") or
            val.startswith("./") or
            val.startswith("..") or
            val.startswith("~") or
            (len(val) > 2 and val[1] == ":") or
            "." in os.path.basename(val)
        )
