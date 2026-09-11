# -*- coding: utf-8 -*-
"""
文件变更增量 → 净视图 聚合模块（C11：从 api 层 run_save.py 下移到 services 层公共位置）。

@file aggregation.py
@description 增量变更（多次写入同一文件的变更列表）聚合为净视图（每个文件一条最终变更）
@author Sh4rlock
@date 2026-08-17

功能描述：
将"增量变更列表"（同一文件可能多次 Write/Delete，每次产生一条变更）聚合为
"净视图"（每个文件取首次 before_hash + 末次 after_hash，最终状态一条）：
- 首 before 空 + 末 after 有 → created（新建）
- 首 before 有 + 末 after 空 → deleted（删除）
- before != after → modified（修改）
- before == after → 无变化，跳过

纯 dict 操作、无 DB 依赖。供 api 层（run_save / run_context / run_api）与
services 层（file_change_manager）共同导入，消除 api↔services 循环依赖。
"""

from typing import Dict, List

from .file_change_manager import FileChange


def aggregate_incremental_to_net_view(incremental_changes: List[Dict]):
    file_states = {}
    for change in incremental_changes:
        fp = change.get("file_path", "")
        if not fp:
            continue
        if fp not in file_states:
            file_states[fp] = {
                "first_before_hash": change.get("before_content_hash"),
                "content_type": change.get("content_type", "text"),
            }
        file_states[fp]["last_after_hash"] = change.get("after_content_hash")

    result = []
    for fp, state in file_states.items():
        first_before = state["first_before_hash"]
        last_after = state["last_after_hash"]
        content_type = state.get("content_type", "text")
        if first_before is None and last_after is None:
            continue
        elif first_before is None:
            result.append(FileChange(file_path=fp, operation="created", new_hash=last_after, content_type=content_type))
        elif last_after is None:
            result.append(FileChange(file_path=fp, operation="deleted", old_hash=first_before, content_type=content_type))
        elif first_before != last_after:
            result.append(FileChange(file_path=fp, operation="modified", old_hash=first_before, new_hash=last_after, content_type=content_type))
    return result