# -*- coding: utf-8 -*-
import asyncio
import logging

logger = logging.getLogger("SoloEngine")


class MessageQueue:
    """消息队列。支持异步等待、入队、drain。内部使用 asyncio.Queue。"""

    def __init__(self):
        self._queue = asyncio.Queue()

    def enqueue(self, message) -> None:
        """同步入队。"""
        self._queue.put_nowait(message)

    async def get(self):
        """异步等待并取出一条消息（HITL 等待用户回答等场景）。

        与 enqueue（put_nowait）对称：入队同步、出队异步等待。
        """
        return await self._queue.get()

    def remove(self, index: int) -> bool:
        """按索引删除。"""
        items = []
        while not self._queue.empty():
            items.append(self._queue.get_nowait())
        len_before = len(items)
        removed = 0 <= index < len_before
        if removed:
            del items[index]
        for item in items:
            self._queue.put_nowait(item)
        return removed

    def drain_all(self) -> list:
        """Drain 所有消息，连续相同 name 的条目合并为一条。"""
        items = []
        while not self._queue.empty():
            items.append(self._queue.get_nowait())

        merged = []
        for msg in items:
            msg_name = getattr(msg, 'name', None)
            msg_content = getattr(msg, 'content', None)
            msg_role = getattr(msg, 'role', 'user')
            if merged and getattr(merged[-1], 'name', None) == msg_name:
                setattr(merged[-1], 'content',
                        (getattr(merged[-1], 'content', None) or "") + "\n" + (msg_content or ""))
            else:
                from SoloAgent.message.message_base import Msg as _Msg
                merged.append(_Msg(name=msg_name, content=msg_content, role=msg_role, metadata=getattr(msg, 'metadata', None)))
        return merged

    @property
    def has_pending(self) -> bool:
        return not self._queue.empty()
