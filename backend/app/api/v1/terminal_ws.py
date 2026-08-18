# -*- coding: utf-8 -*-
"""
SoloEngine : 终端面板 WebSocket 通道（API 层）

@file terminal_ws.py
@description 真实多终端的 API 端点：REST 创建/销毁 PTY 会话 + WebSocket 双向 I/O。
             会话管理与输出分发位于核心层 app/core/terminal_manager.py，
             本模块仅承载 FastAPI 路由，不包含 PTY 会话逻辑（分层解耦）。
@author Sh4rlock
@date 2026-08-11

端点：
- POST   /api/v1/terminal/sessions        创建 PTY 会话（返回 terminal_id）
- DELETE /api/v1/terminal/sessions/{id}   销毁会话
- GET    /api/v1/terminal/sessions        列出全部会话
- WS     /api/v1/terminal/ws/{id}         双向通道：
     接收 {type:"input", data} -> session.write(data)
     接收 {type:"resize", cols, rows} -> session.resize
     推送 {type:"output", data} / {type:"exit", code}
"""

import logging

from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect

from app.core.terminal_manager import terminal_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["terminal"])


# ---------------------------------------------------------------------------
# REST：创建 / 销毁 / 列出终端会话
# ---------------------------------------------------------------------------

@router.post("/terminal/sessions")
async def create_terminal_session(payload: dict = Body(default={})) -> dict:
    """创建终端会话，返回 terminal_id（前端标签 key + WS 连接地址）。"""
    cwd = payload.get("cwd")
    session = terminal_manager.create(cwd)
    return {"terminal_id": session.id, "cwd": session.cwd}


@router.delete("/terminal/sessions/{terminal_id}")
async def delete_terminal_session(terminal_id: str) -> dict:
    """销毁终端会话（关闭 PTY 进程，清理连接）。"""
    ok = terminal_manager.close(terminal_id)
    return {"success": ok}


@router.get("/terminal/sessions")
async def list_terminal_sessions() -> dict:
    """列出全部终端会话。"""
    return {"sessions": list(terminal_manager.get_all().keys())}


# ---------------------------------------------------------------------------
# WS：双向 I/O 通道
# ---------------------------------------------------------------------------

@router.websocket("/terminal/ws/{terminal_id}")
async def terminal_ws(websocket: WebSocket, terminal_id: str) -> None:
    session = terminal_manager.get(terminal_id)
    if session is None:
        await websocket.close(code=4004, reason="terminal not found")
        return

    await websocket.accept()
    session.add_client(websocket)
    # 回放终端当前快照（仅最后一个提示符），使新连接 xterm 显示终端状态而非空白
    await session.replay_snapshot(websocket)
    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")
            if msg_type == "input":
                session.write(msg.get("data", ""))
            elif msg_type == "resize":
                session.resize(msg.get("cols"), msg.get("rows"))
            elif msg_type == "close":
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"[Terminal] ws error {terminal_id}: {e}")
    finally:
        session.remove_client(websocket)
