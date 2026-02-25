# -*- coding: utf-8 -*-
"""
MCP Filesystem Server - 提供真实的文件系统操作工具
"""

import os
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

from mcp.server.fastmcp import FastMCP

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mcp = FastMCP("Filesystem MCP Server", json_response=True)

BASE_DIR = Path(__file__).parent.parent.parent / "mcp_workspace"
BASE_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_path(path: str) -> Path:
    resolved = (BASE_DIR / path).resolve()
    if not str(resolved).startswith(str(BASE_DIR.resolve())):
        raise ValueError(f"Access denied: path outside workspace: {path}")
    return resolved


@mcp.tool()
def list_files(directory: str = ".") -> Dict[str, Any]:
    """List files and directories in the specified directory.
    
    Args:
        directory: Directory path relative to workspace root (default: ".")
    
    Returns:
        Dictionary containing list of files and directories
    """
    try:
        target_dir = _resolve_path(directory)
        if not target_dir.exists():
            return {"success": False, "error": f"Directory not found: {directory}"}
        
        if not target_dir.is_dir():
            return {"success": False, "error": f"Not a directory: {directory}"}
        
        items = []
        for item in target_dir.iterdir():
            stat = item.stat()
            items.append({
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "size": stat.st_size if item.is_file() else None,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        
        return {
            "success": True,
            "directory": str(target_dir.relative_to(BASE_DIR)),
            "items": sorted(items, key=lambda x: (x["type"] == "file", x["name"])),
        }
    except Exception as e:
        logger.error(f"list_files error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def read_file(filepath: str) -> Dict[str, Any]:
    """Read content from a file.
    
    Args:
        filepath: File path relative to workspace root
    
    Returns:
        Dictionary containing file content
    """
    try:
        target_file = _resolve_path(filepath)
        if not target_file.exists():
            return {"success": False, "error": f"File not found: {filepath}"}
        
        if not target_file.is_file():
            return {"success": False, "error": f"Not a file: {filepath}"}
        
        content = target_file.read_text(encoding="utf-8")
        stat = target_file.stat()
        
        return {
            "success": True,
            "filepath": str(target_file.relative_to(BASE_DIR)),
            "content": content,
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }
    except UnicodeDecodeError:
        return {"success": False, "error": f"Cannot read binary file: {filepath}"}
    except Exception as e:
        logger.error(f"read_file error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def write_file(filepath: str, content: str) -> Dict[str, Any]:
    """Write content to a file, creating it if it doesn't exist.
    
    Args:
        filepath: File path relative to workspace root
        content: Content to write to the file
    
    Returns:
        Dictionary indicating success or failure
    """
    try:
        target_file = _resolve_path(filepath)
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(content, encoding="utf-8")
        
        stat = target_file.stat()
        
        logger.info(f"Written to file: {filepath}")
        
        return {
            "success": True,
            "filepath": str(target_file.relative_to(BASE_DIR)),
            "size": stat.st_size,
            "created": not target_file.exists() or stat.st_size == len(content),
        }
    except Exception as e:
        logger.error(f"write_file error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def create_file(filepath: str, content: str = "") -> Dict[str, Any]:
    """Create a new file with optional content.
    
    Args:
        filepath: File path relative to workspace root
        content: Initial content for the file (default: empty)
    
    Returns:
        Dictionary indicating success or failure
    """
    try:
        target_file = _resolve_path(filepath)
        
        if target_file.exists():
            return {"success": False, "error": f"File already exists: {filepath}"}
        
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(content, encoding="utf-8")
        
        logger.info(f"Created file: {filepath}")
        
        return {
            "success": True,
            "filepath": str(target_file.relative_to(BASE_DIR)),
            "size": len(content),
        }
    except Exception as e:
        logger.error(f"create_file error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_file(filepath: str) -> Dict[str, Any]:
    """Delete a file.
    
    Args:
        filepath: File path relative to workspace root
    
    Returns:
        Dictionary indicating success or failure
    """
    try:
        target_file = _resolve_path(filepath)
        
        if not target_file.exists():
            return {"success": False, "error": f"File not found: {filepath}"}
        
        if not target_file.is_file():
            return {"success": False, "error": f"Not a file: {filepath}"}
        
        target_file.unlink()
        
        logger.info(f"Deleted file: {filepath}")
        
        return {"success": True, "filepath": filepath}
    except Exception as e:
        logger.error(f"delete_file error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def create_directory(dirpath: str) -> Dict[str, Any]:
    """Create a new directory.
    
    Args:
        dirpath: Directory path relative to workspace root
    
    Returns:
        Dictionary indicating success or failure
    """
    try:
        target_dir = _resolve_path(dirpath)
        
        if target_dir.exists():
            return {"success": False, "error": f"Directory already exists: {dirpath}"}
        
        target_dir.mkdir(parents=True, exist_ok=False)
        
        logger.info(f"Created directory: {dirpath}")
        
        return {"success": True, "dirpath": dirpath}
    except Exception as e:
        logger.error(f"create_directory error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def delete_directory(dirpath: str) -> Dict[str, Any]:
    """Delete an empty directory.
    
    Args:
        dirpath: Directory path relative to workspace root
    
    Returns:
        Dictionary indicating success or failure
    """
    try:
        target_dir = _resolve_path(dirpath)
        
        if not target_dir.exists():
            return {"success": False, "error": f"Directory not found: {dirpath}"}
        
        if not target_dir.is_dir():
            return {"success": False, "error": f"Not a directory: {dirpath}"}
        
        if any(target_dir.iterdir()):
            return {"success": False, "error": f"Directory not empty: {dirpath}"}
        
        target_dir.rmdir()
        
        logger.info(f"Deleted directory: {dirpath}")
        
        return {"success": True, "dirpath": dirpath}
    except Exception as e:
        logger.error(f"delete_directory error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def file_exists(filepath: str) -> Dict[str, Any]:
    """Check if a file or directory exists.
    
    Args:
        filepath: Path relative to workspace root
    
    Returns:
        Dictionary indicating existence and type
    """
    try:
        target = _resolve_path(filepath)
        
        if not target.exists():
            return {"success": True, "exists": False, "path": filepath}
        
        return {
            "success": True,
            "exists": True,
            "path": filepath,
            "type": "directory" if target.is_dir() else "file",
            "size": target.stat().st_size if target.is_file() else None,
        }
    except Exception as e:
        logger.error(f"file_exists error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def search_files(pattern: str, directory: str = ".") -> Dict[str, Any]:
    """Search for files matching a pattern.
    
    Args:
        pattern: Glob pattern to match (e.g., "*.py", "*.txt")
        directory: Directory to search in (default: ".")
    
    Returns:
        Dictionary containing list of matching files
    """
    try:
        target_dir = _resolve_path(directory)
        
        if not target_dir.exists():
            return {"success": False, "error": f"Directory not found: {directory}"}
        
        matches = list(target_dir.glob(pattern))
        
        results = []
        for match in matches:
            rel_path = match.relative_to(BASE_DIR)
            stat = match.stat()
            results.append({
                "path": str(rel_path),
                "type": "directory" if match.is_dir() else "file",
                "size": stat.st_size if match.is_file() else None,
            })
        
        return {
            "success": True,
            "pattern": pattern,
            "directory": directory,
            "matches": results,
            "count": len(results),
        }
    except Exception as e:
        logger.error(f"search_files error: {e}")
        return {"success": False, "error": str(e)}


@mcp.tool()
def get_workspace_info() -> Dict[str, Any]:
    """Get information about the workspace.
    
    Returns:
        Dictionary containing workspace information
    """
    try:
        total_size = 0
        file_count = 0
        dir_count = 0
        
        for root, dirs, files in os.walk(BASE_DIR):
            dir_count += len(dirs)
            for f in files:
                fp = Path(root) / f
                total_size += fp.stat().st_size
                file_count += 1
        
        return {
            "success": True,
            "workspace": str(BASE_DIR),
            "total_files": file_count,
            "total_directories": dir_count,
            "total_size_bytes": total_size,
            "total_size_human": f"{total_size / 1024:.2f} KB" if total_size < 1024 * 1024 else f"{total_size / (1024 * 1024):.2f} MB",
        }
    except Exception as e:
        logger.error(f"get_workspace_info error: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport="streamable-http")
