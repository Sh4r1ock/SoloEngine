# -*- coding: utf-8 -*-
import os
import logging
from typing import Optional

from app.core.database import get_db_context
from app.models.file_change import FileContentBlobModel
from app.utils.file_utils import compute_content_hash

logger = logging.getLogger("SoloEngine")


class ContentAddressableStorage:
    LARGE_FILE_THRESHOLD = 100 * 1024

    def __init__(self):
        from app.core.data_paths import DataPaths
        self._blob_dir = os.path.join(DataPaths.get_data_root(), "file_blobs")
        os.makedirs(self._blob_dir, exist_ok=True)

    def store_content(self, content: bytes) -> str:
        content_hash = compute_content_hash(content)
        with get_db_context() as db:
            existing = db.query(FileContentBlobModel).filter(
                FileContentBlobModel.content_hash == content_hash
            ).first()
            if existing:
                return content_hash

            is_large = len(content) > self.LARGE_FILE_THRESHOLD
            text_content = None
            if not is_large:
                try:
                    text_content = content.decode('utf-8')
                except UnicodeDecodeError:
                    text_content = content.decode('utf-8', errors='replace')

            blob = FileContentBlobModel(
                content_hash=content_hash,
                content=text_content,
                is_large_file=is_large,
                file_size=len(content),
            )
            db.add(blob)

            if is_large:
                blob_path = os.path.join(self._blob_dir, content_hash)
                if not os.path.exists(blob_path):
                    with open(blob_path, 'wb') as f:
                        f.write(content)

            db.commit()
            return content_hash

    def get_content(self, content_hash: str) -> Optional[bytes]:
        with get_db_context() as db:
            blob = db.query(FileContentBlobModel).filter(
                FileContentBlobModel.content_hash == content_hash
            ).first()
            if not blob:
                return None
            if blob.is_large_file:
                blob_path = os.path.join(self._blob_dir, content_hash)
                if os.path.exists(blob_path):
                    with open(blob_path, 'rb') as f:
                        return f.read()
                return None
            if blob.content is not None:
                return blob.content.encode('utf-8')
            return None

    def store_file(self, file_path: str) -> str:
        with open(file_path, 'rb') as f:
            content = f.read()
        return self.store_content(content)

    def restore_file(self, content_hash: str, target_path: str) -> bool:
        content = self.get_content(content_hash)
        if content is None:
            logger.error(f"CAS content not found: {content_hash}")
            return False
        parent_dir = os.path.dirname(target_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        with open(target_path, 'wb') as f:
            f.write(content)
        return True

cas = ContentAddressableStorage()
