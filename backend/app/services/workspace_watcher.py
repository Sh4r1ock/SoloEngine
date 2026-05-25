import asyncio
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


class WorkspaceWatcher:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._observers = {}
            cls._instance._change_queue = None
            cls._instance._loop = None
        return cls._instance

    def set_asyncio_queue(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._change_queue = queue

    def start_watching(self, session_id: str, working_dir: str):
        if session_id in self._observers:
            return
        observer = Observer()
        handler = WorkspaceEventHandler(session_id, working_dir, self._on_change)
        observer.schedule(handler, working_dir, recursive=True)
        observer.start()
        self._observers[session_id] = observer

    def stop_watching(self, session_id: str):
        observer = self._observers.pop(session_id, None)
        if observer:
            observer.stop()
            observer.join(timeout=5)

    def _on_change(self, session_id: str, file_path: str, operation: str, is_directory: bool):
        if self._loop and self._change_queue:
            try:
                self._loop.call_soon_threadsafe(
                    self._change_queue.put_nowait,
                    {
                        "session_id": session_id,
                        "file_path": file_path,
                        "operation": operation,
                        "is_directory": is_directory,
                    },
                )
            except Exception:
                pass


class WorkspaceEventHandler(FileSystemEventHandler):
    IGNORE_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"}
    IGNORE_SUFFIXES = (".pyc", ".pyo", ".~")

    def __init__(self, session_id: str, working_dir: str, on_change_callback):
        self.session_id = session_id
        self.working_dir = os.path.abspath(working_dir)
        self.on_change = on_change_callback

    def on_created(self, event):
        rel_path = self._normalize(event.src_path)
        if self._ignored(rel_path):
            return
        self.on_change(self.session_id, rel_path, "created", event.is_directory)

    def on_deleted(self, event):
        rel_path = self._normalize(event.src_path)
        if self._ignored(rel_path):
            return
        self.on_change(self.session_id, rel_path, "deleted", event.is_directory)

    def on_modified(self, event):
        if event.is_directory:
            return
        rel_path = self._normalize(event.src_path)
        if self._ignored(rel_path):
            return
        self.on_change(self.session_id, rel_path, "modified", event.is_directory)

    def on_moved(self, event):
        rel_path = self._normalize(event.src_path)
        dest_path = self._normalize(event.dest_path)
        if self._ignored(rel_path) and self._ignored(dest_path):
            return
        self.on_change(self.session_id, rel_path, "moved", event.is_directory)

    def _normalize(self, abs_path: str) -> str:
        return os.path.relpath(abs_path, self.working_dir).replace("\\", "/")

    def _ignored(self, rel_path: str) -> bool:
        parts = rel_path.replace("\\", "/").split("/")
        if parts and parts[0] in self.IGNORE_DIRS:
            return True
        if rel_path.endswith(self.IGNORE_SUFFIXES):
            return True
        return False


workspace_watcher = WorkspaceWatcher()