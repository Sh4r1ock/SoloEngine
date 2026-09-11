import os
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

from app.core.content_addressable_storage import cas
from app.utils.file_utils import (
    compute_text_diff,
)
from .file_change_types import FileOperation, ContentType

logger = logging.getLogger("SoloEngine")


@dataclass
class FileChange:
    file_path: str
    operation: str
    content_type: str = "text"
    old_content: Optional[str] = None
    new_content: Optional[str] = None
    old_hash: Optional[str] = None
    new_hash: Optional[str] = None
    diff_data: Optional[Dict[str, Any]] = None
    lines_added: int = 0
    lines_removed: int = 0


class FileChangeManager:

    def compute_diff_for_change(
        self,
        change: FileChange,
        working_dir: str
    ) -> Optional[Dict[str, Any]]:
        try:
            if change.content_type != ContentType.TEXT.value:
                return {
                    "lines_added": 0,
                    "lines_removed": 0,
                    "hunks": [],
                    "is_binary": True,
                }

            old_content = ""
            new_content = ""

            if change.operation == FileOperation.CREATED.value:
                current_path = os.path.join(working_dir, change.file_path)
                if os.path.exists(current_path):
                    with open(current_path, 'rb') as f:
                        new_content = f.read().decode('utf-8', errors='replace')
                return compute_text_diff("", new_content, change.file_path)

            elif change.operation == FileOperation.MODIFIED.value:
                old_bytes = cas.get_content(change.old_hash)
                if old_bytes:
                    old_content = old_bytes.decode('utf-8', errors='replace')

                current_path = os.path.join(working_dir, change.file_path)
                if os.path.exists(current_path):
                    with open(current_path, 'rb') as f:
                        new_content = f.read().decode('utf-8', errors='replace')

                return compute_text_diff(old_content, new_content, change.file_path)

            elif change.operation == FileOperation.DELETED.value:
                old_bytes = cas.get_content(change.old_hash)
                if old_bytes:
                    old_content = old_bytes.decode('utf-8', errors='replace')
                return compute_text_diff(old_content, "", change.file_path)

        except Exception as e:
            logger.error(f"Failed to compute diff for {change.file_path}: {e}")

        return None

    def compute_incremental_change(
        self,
        tool_call: Dict[str, Any],
        working_dir: str
    ) -> List[Dict[str, Any]] | Dict[str, Any] | None:
        # NQ4：计算逻辑已下沉为 incremental 模块纯函数，本方法仅兼容转发
        #（行为与历史实现完全一致：多文件批量 / 单文件判定）
        from .incremental import compute_incremental_change as _compute_incremental_change
        return _compute_incremental_change(tool_call, working_dir)

    def _compute_single_file_change(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        file_path: str,
        working_dir: str,
        tool_call_id: str
    ) -> Dict[str, Any] | None:
        # NQ4：逻辑已下沉为 incremental 模块纯函数，本方法仅兼容转发
        from .incremental import compute_single_file_change as _compute_single_file_change
        return _compute_single_file_change(
            tool_name, tool_args, file_path, working_dir, tool_call_id,
        )

    def aggregate_incremental_to_net_view_from_models(self, models) -> List[FileChange]:
        # C11：改为从 services 层公共位置导入（不再从 api 层 run import，
        # 消除 services → api 反向依赖）
        from app.services.file_change.aggregation import aggregate_incremental_to_net_view

        incremental_dicts = []
        for m in models:
            incremental_dicts.append({
                "file_path": m.file_path,
                "operation": m.operation,
                "before_content_hash": m.before_content_hash,
                "after_content_hash": m.after_content_hash,
                "content_type": m.content_type,
            })
        return aggregate_incremental_to_net_view(incremental_dicts)

    def delete_file_changes_and_cleanup(self, db, filter_condition) -> int:
        from app.core.database import FileChangeModel, FileContentBlobModel
        from app.core.content_addressable_storage import cas

        records = db.query(
            FileChangeModel.before_content_hash,
            FileChangeModel.after_content_hash
        ).filter(filter_condition).all()

        candidate_hashes = set()
        for before, after in records:
            if before:
                candidate_hashes.add(before)
            if after:
                candidate_hashes.add(after)

        count = db.query(FileChangeModel).filter(filter_condition).delete(
            synchronize_session=False
        )
        db.flush()

        if candidate_hashes:
            still_referenced = set()
            for (before, after) in db.query(
                FileChangeModel.before_content_hash,
                FileChangeModel.after_content_hash
            ).all():
                if before and before in candidate_hashes:
                    still_referenced.add(before)
                if after and after in candidate_hashes:
                    still_referenced.add(after)

            to_delete = candidate_hashes - still_referenced

            if to_delete:
                blobs = db.query(FileContentBlobModel).filter(
                    FileContentBlobModel.content_hash.in_(to_delete)
                ).all()
                for blob in blobs:
                    if blob.is_large_file:
                        blob_path = os.path.join(cas._blob_dir, blob.content_hash)
                        if os.path.exists(blob_path):
                            os.remove(blob_path)
                    db.delete(blob)

        db.commit()
        return count


file_change_manager = FileChangeManager()
