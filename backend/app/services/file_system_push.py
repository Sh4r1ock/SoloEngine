import asyncio
import json
import time
from collections import defaultdict
from typing import Any


class FileSystemPushService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._ws_registry = None
            cls._instance._pending = defaultdict(list)
            cls._instance._event = asyncio.Event()
        return cls._instance

    def set_ws_registry(self, registry):
        self._ws_registry = registry

    def push_change(self, session_id: str, file_path: str, operation: str,
                    is_directory: bool = False):
        self._pending[session_id].append({
            "file_path": file_path,
            "operation": operation,
            "is_directory": is_directory,
        })
        self._event.set()

    async def _flush_loop(self):
        while True:
            try:
                await asyncio.wait_for(self._event.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            self._event.clear()
            await asyncio.sleep(0.3)

            for session_id in list(self._pending.keys()):
                changes = self._pending.pop(session_id)
                if not changes:
                    continue
                message = {
                    "type": "file_system_event",
                    "session_id": session_id,
                    "changes": changes,
                    "source": "watcher",
                    "timestamp": int(time.time() * 1000),
                }
                if self._ws_registry:
                    ws = self._ws_registry.get_websocket(session_id)
                    if ws:
                        try:
                            await ws.send_text(json.dumps(message, ensure_ascii=False))
                        except Exception:
                            pass


class WebSocketRegistry:
    def __init__(self):
        self._sockets = {}
        self._keys = {}

    def register(self, ws_key: str, session_id: str, websocket: Any):
        self._sockets[ws_key] = websocket
        self._keys[ws_key] = {"session_id": session_id}

    def unregister(self, ws_key: str):
        self._sockets.pop(ws_key, None)
        self._keys.pop(ws_key, None)

    def get_websocket(self, session_id: str) -> Any:
        for ws_key, keys in self._keys.items():
            if keys.get("session_id") == session_id:
                return self._sockets.get(ws_key)
        return None


push_service = FileSystemPushService()
ws_registry = WebSocketRegistry()