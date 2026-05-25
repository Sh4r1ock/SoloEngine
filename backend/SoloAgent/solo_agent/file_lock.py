import asyncio
from typing import Dict

_file_locks: Dict[str, asyncio.Lock] = {}


def get_file_lock(file_path: str) -> asyncio.Lock:
    if file_path not in _file_locks:
        _file_locks[file_path] = asyncio.Lock()
    return _file_locks[file_path]
