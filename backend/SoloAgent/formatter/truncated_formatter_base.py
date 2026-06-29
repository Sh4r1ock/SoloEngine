# -*- coding: utf-8 -*-
"""
SoloEngine : 截断格式化器基类，支持消息截断

@file truncated_formatter_base.py
@description 实现支持Token限制的消息格式化器基类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供截断格式化器基类，包括：
    - TruncatedFormatterBase: 截断格式化器基类
    - 支持Token计数和限制
    - 支持消息截断策略
    - 支持消息分组处理

依赖:
    - abc: 抽象基类
    - copy: 深拷贝
    - typing: 类型提示
    - .formatter_base: 格式化器基类
    - ..message: 消息类型
    - ..tracing: 追踪装饰器

使用示例:
    - from SoloAgent.formatter import TruncatedFormatterBase
    - formatter = TruncatedFormatterBase()
"""
from abc import ABC
from copy import deepcopy
from typing import (
    Any,
    Tuple,
    Literal,
    AsyncGenerator,
)

from .formatter_base import FormatterBase
from ..message import Msg
from ..tracing import trace_format


class TruncatedFormatterBase(FormatterBase, ABC):
    """
    截断格式化器基类

    职责:
        - 格式化输入消息为所需格式
        - 支持Token限制和截断
        - 管理消息分组
        - 处理系统消息、工具序列和Agent消息

    属性:
        (无额外属性)

    示例:
        >>> formatter = TruncatedFormatterBase()
        >>> formatted = await formatter.format(messages)
    """

    def __init__(self) -> None:
        pass

    @trace_format
    async def format(
        self,
        msgs: list[Msg],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        self.assert_list_of_msgs(msgs)
        msgs = deepcopy(msgs)
        return await self._format(msgs)

    async def _format(self, msgs: list[Msg]) -> list[dict[str, Any]]:
        """Format the input messages into the required format. This method
        should be implemented by the subclasses."""

        formatted_msgs = []
        start_index = 0
        if len(msgs) > 0 and msgs[0].role == "system":
            formatted_msgs.append(
                await self._format_system_message(msgs[0]),
            )
            start_index = 1

        is_first_agent_message = True
        async for typ, group in self._group_messages(msgs[start_index:]):
            match typ:
                case "tool_sequence":
                    formatted_msgs.extend(
                        await self._format_tool_sequence(group),
                    )
                case "agent_message":
                    formatted_msgs.extend(
                        await self._format_agent_message(
                            group,
                            is_first_agent_message,
                        ),
                    )
                    is_first_agent_message = False

        return formatted_msgs

    async def _format_system_message(
        self,
        msg: Msg,
    ) -> dict[str, Any]:
        """
        格式化系统消息为LLM API格式

        这是默认实现。对于某些有特定要求的LLM API，
        可能需要实现自定义格式化函数来满足特定需求。

        Args:
            msg: 系统消息对象

        Returns:
            dict[str, Any]: 格式化后的系统消息字典

        示例:
            >>> system_msg = Msg(name="system", content="你是助手", role="system")
            >>> formatted = await formatter._format_system_message(system_msg)
        """
        return {
            "role": "system",
            "content": msg.get_content_blocks("text"),
        }

    async def _format_tool_sequence(
        self,
        msgs: list[Msg],
    ) -> list[dict[str, Any]]:
        """
        格式化工具调用/结果消息序列

        将工具调用和结果消息序列格式化为LLM API所需的格式

        Args:
            msgs: 工具调用/结果消息列表

        Returns:
            list[dict[str, Any]]: 格式化后的消息列表

        Raises:
            NotImplementedError: 子类必须实现此方法

        示例:
            >>> tool_msgs = [msg1, msg2]
            >>> formatted = await formatter._format_tool_sequence(tool_msgs)
        """
        raise NotImplementedError(
            "_format_tool_sequence is not implemented",
        )

    async def _format_agent_message(
        self,
        msgs: list[Msg],
        is_first: bool = True,
    ) -> list[dict[str, Any]]:
        """
        格式化Agent消息序列

        将不包含工具调用/结果的Agent消息序列格式化为LLM API所需的格式

        Args:
            msgs: Agent消息列表
            is_first: 是否为第一条Agent消息

        Returns:
            list[dict[str, Any]]: 格式化后的消息列表

        Raises:
            NotImplementedError: 子类必须实现此方法

        示例:
            >>> agent_msgs = [msg1, msg2]
            >>> formatted = await formatter._format_agent_message(agent_msgs)
        """
        raise NotImplementedError(
            "_format_agent_message is not implemented",
        )

    @staticmethod
    async def _group_messages(
        msgs: list[Msg],
    ) -> AsyncGenerator[
        Tuple[Literal["tool_sequence", "agent_message"], list[Msg]],
        None,
    ]:
        """
        将输入消息分组为两种类型

        两种类型分别是：
        - agent_message: 不包含工具调用/结果的Agent消息
        - tool_sequence: 由工具调用/结果组成的消息序列

        注意：分组操作用于多Agent场景，其中多个实体参与输入消息。
        为了兼容工具API，我们必须对消息进行分组并使用不同的策略格式化。

        Args:
            msgs: 要分组的输入消息列表（不应包含系统提示消息）

        Yields:
            AsyncGenerator[Tuple[str, list[Msg]], None]: 生成器，
                产生分组类型和该组中的消息列表。
                分组类型可以是"tool_sequence"或"agent_message"

        示例:
            >>> async for group_type, group_msgs in formatter._group_messages(msgs):
            ...     print(f"Type: {group_type}, Count: {len(group_msgs)}")
        """

        group_type: Literal["tool_sequence", "agent_message"] | None = None
        group = []
        for msg in msgs:
            is_tool_related = (
                msg.has_content_blocks("tool_calls") or
                msg.has_content_blocks("tool_result")
            )
            if group_type is None:
                if is_tool_related:
                    group_type = "tool_sequence"
                else:
                    group_type = "agent_message"

                group.append(msg)
                continue

            if group_type == "tool_sequence":
                if is_tool_related:
                    group.append(msg)
                else:
                    yield group_type, group
                    group = [msg]
                    group_type = "agent_message"

            elif group_type == "agent_message":
                if is_tool_related:
                    yield group_type, group
                    group = [msg]
                    group_type = "tool_sequence"
                else:
                    group.append(msg)
        if group_type:
            yield group_type, group