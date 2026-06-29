# -*- coding: utf-8 -*-
"""
消息内容块模块。

@file message_block.py
@description 定义消息中使用的各种内容块类型
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 定义消息内容的结构化块类型
- 支持多种内容类型（文本、图像、音频、视频、工具调用等）
- 使用 TypedDict 实现类型安全

内容块类型：
    - TextBlock: 文本内容块
    - ThinkingBlock: 思考过程块（如 Claude 的 extended thinking）
    - ImageBlock: 图像内容块
    - AudioBlock: 音频内容块
    - VideoBlock: 视频内容块
    - ToolUseBlock: 工具调用请求块
    - ToolResultBlock: 工具调用结果块

数据源类型：
    - Base64Source: Base64 编码的数据源
    - URLSource: URL 引用的数据源

设计理念：
    使用 TypedDict 定义内容块结构，提供类型提示的同时保持
    字典的灵活性。所有块都有 type 字段用于区分类型。

状态: ✅ 完整实现
"""

from typing import Literal, List
from typing_extensions import TypedDict, Required


class TextBlock(TypedDict, total=False):
    """
    文本内容块。
    
    用于表示纯文本内容，是最常用的内容块类型。
    
    Attributes:
        type (Literal["text"]): 块类型标识，固定为 "text"。
        text (str): 文本内容。
    
    Example:
        >>> block: TextBlock = {
        ...     "type": "text",
        ...     "text": "你好，世界！"
        ... }
    """

    type: Required[Literal["text"]]
    """块类型标识，固定为 'text'"""

    text: str
    """文本内容"""


class ThinkingBlock(TypedDict, total=False):
    """
    思考过程块。
    
    用于表示模型的思考过程，如 Claude 的 extended thinking 功能。
    思考内容通常不直接展示给用户，但可用于调试和分析。
    
    Attributes:
        type (Literal["thinking"]): 块类型标识，固定为 "thinking"。
        thinking (str): 思考过程内容。
    
    Example:
        >>> block: ThinkingBlock = {
        ...     "type": "thinking",
        ...     "thinking": "让我分析一下这个问题..."
        ... }
    
    Note:
        仅部分模型（如 Claude）支持此块类型。
    """

    type: Required[Literal["thinking"]]
    """块类型标识，固定为 "thinking" """

    thinking: str
    """思考过程内容"""


class Base64Source(TypedDict, total=False):
    """
    Base64 编码的数据源。
    
    用于表示内嵌的二进制数据，如图像、音频等。
    数据使用 Base64 编码，符合 RFC 2397 规范。
    
    Attributes:
        type (Literal["base64"]): 数据源类型，固定为 "base64"。
        media_type (str): 媒体类型，如 "image/jpeg", "audio/mpeg"。
        data (str): Base64 编码的数据。
    
    Example:
        >>> source: Base64Source = {
        ...     "type": "base64",
        ...     "media_type": "image/jpeg",
        ...     "data": "/9j/4AAQSkZJRgABAQAAAQABAAD..."
        ... }
    
    Note:
        - media_type 必须是有效的 MIME 类型
        - 数据不应包含 data URI 前缀
    """

    type: Required[Literal["base64"]]
    """数据源类型，固定为 "base64" """

    media_type: Required[str]
    """媒体类型，如 "image/jpeg" 或 "audio/mpeg" """

    data: Required[str]
    """Base64 编码的数据，符合 RFC 2397 规范"""


class URLSource(TypedDict, total=False):
    """
    URL 引用的数据源。
    
    用于表示通过 URL 引用的外部资源，如图像、音频等。
    
    Attributes:
        type (Literal["url"]): 数据源类型，固定为 "url"。
        url (str): 资源的 URL 地址。
    
    Example:
        >>> source: URLSource = {
        ...     "type": "url",
        ...     "url": "https://example.com/image.jpg"
        ... }
    
    Note:
        URL 必须可公开访问，否则可能导致加载失败。
    """

    type: Required[Literal["url"]]
    """数据源类型，固定为 "url" """

    url: Required[str]
    """资源的 URL 地址"""


class ImageBlock(TypedDict, total=False):
    """
    图像内容块。
    
    用于表示图像内容，支持 Base64 编码和 URL 两种数据源。
    
    Attributes:
        type (Literal["image"]): 块类型标识，固定为 "image"。
        source (Base64Source | URLSource): 图像数据源。
    
    Example:
        >>> # 使用 Base64 数据源
        >>> block: ImageBlock = {
        ...     "type": "image",
        ...     "source": {
        ...         "type": "base64",
        ...         "media_type": "image/png",
        ...         "data": "iVBORw0KGgoAAAANSUhEUgAA..."
        ...     }
        ... }
        >>> 
        >>> # 使用 URL 数据源
        >>> block: ImageBlock = {
        ...     "type": "image",
        ...     "source": {
        ...         "type": "url",
        ...         "url": "https://example.com/photo.jpg"
        ...     }
        ... }
    
    Note:
        支持的图像格式取决于具体的 LLM 提供商。
    """

    type: Required[Literal["image"]]
    """块类型标识，固定为 "image" """

    source: Required[Base64Source | URLSource]
    """图像数据源"""


class AudioBlock(TypedDict, total=False):
    """
    音频内容块。
    
    用于表示音频内容，支持 Base64 编码和 URL 两种数据源。
    
    Attributes:
        type (Literal["audio"]): 块类型标识，固定为 "audio"。
        source (Base64Source | URLSource): 音频数据源。
    
    Example:
        >>> block: AudioBlock = {
        ...     "type": "audio",
        ...     "source": {
        ...         "type": "base64",
        ...         "media_type": "audio/mpeg",
        ...         "data": "//uQxAAAAAANIAAAAAExBTUUzLjEwMFVVVVVV..."
        ...     }
        ... }
    
    Note:
        支持的音频格式取决于具体的 LLM 提供商。
    """

    type: Required[Literal["audio"]]
    """块类型标识，固定为 "audio" """

    source: Required[Base64Source | URLSource]
    """音频数据源"""


class VideoBlock(TypedDict, total=False):
    """
    视频内容块。
    
    用于表示视频内容，支持 Base64 编码和 URL 两种数据源。
    
    Attributes:
        type (Literal["video"]): 块类型标识，固定为 "video"。
        source (Base64Source | URLSource): 视频数据源。
    
    Example:
        >>> block: VideoBlock = {
        ...     "type": "video",
        ...     "source": {
        ...         "type": "url",
        ...         "url": "https://example.com/video.mp4"
        ...     }
        ... }
    
    Note:
        视频支持取决于具体的 LLM 提供商，目前大多数模型不支持视频输入。
    """

    type: Required[Literal["video"]]
    """块类型标识，固定为 "video" """

    source: Required[Base64Source | URLSource]
    """视频数据源"""


class ToolUseBlock(TypedDict, total=False):
    """
    工具调用请求块。
    
    用于表示 LLM 请求调用的工具，包含工具名称和参数。
    由 LLM 生成，Agent 执行后返回 ToolResultBlock。
    
    Attributes:
        type (Literal["tool_use"]): 块类型标识，固定为 "tool_use"。
        id (str): 工具调用的唯一标识符，用于关联调用结果。
        name (str): 工具名称。
        input (dict[str, object]): 工具参数，格式取决于工具定义。
    
    Example:
        >>> block: ToolUseBlock = {
        ...     "type": "tool_use",
        ...     "id": "call_abc123",
        ...     "name": "get_weather",
        ...     "input": {"city": "北京", "unit": "celsius"}
        ... }
    
    Note:
        - id 用于关联 ToolResultBlock
        - input 必须符合工具的参数规范
    """

    type: Required[Literal["tool_use"]]
    """块类型标识，固定为 "tool_use" """

    id: Required[str]
    """工具调用的唯一标识符，用于关联调用结果"""

    name: Required[str]
    """工具名称"""

    input: Required[dict[str, object]]
    """工具参数，格式取决于工具定义"""


class ToolCallFunction(TypedDict, total=False):
    """工具调用函数信息"""
    name: str
    """函数名称"""
    arguments: str
    """函数参数（JSON 字符串）"""


class ToolCallItem(TypedDict, total=False):
    """单个工具调用项"""
    index: int
    """工具调用索引"""
    id: str
    """工具调用唯一标识符"""
    type: Literal["function"]
    """调用类型，固定为 "function" """
    function: ToolCallFunction
    """函数信息"""
    status: str
    """状态："start" 或 "end" """


class ToolCallsBlock(TypedDict, total=False):
    """
    工具调用块（OpenAI 格式）。

    用于表示 LLM 请求调用的工具，包含工具调用列表。
    这是 SoloEngine 内部统一使用的工具调用格式。

    Attributes:
        type (Literal["tool_calls"]): 块类型标识，固定为 "tool_calls"。
        tool_calls (List[ToolCallItem]): 工具调用列表。
    """
    type: Required[Literal["tool_calls"]]
    """块类型标识，固定为 "tool_calls" """
    tool_calls: Required[List[ToolCallItem]]
    """工具调用列表"""


class ToolResultBlock(TypedDict, total=False):
    """
    工具调用结果块。
    
    用于表示工具执行的返回结果，与 ToolUseBlock 配对使用。
    由 Agent 执行工具后生成，返回给 LLM 进行后续处理。
    
    Attributes:
        type (Literal["tool_result"]): 块类型标识，固定为 "tool_result"。
        id (str): 关联的工具调用 ID，与 ToolUseBlock.id 对应。
        output (str | List[...]): 工具执行的输出结果。
        name (str): 工具名称。
    
    Example:
        >>> block: ToolResultBlock = {
        ...     "type": "tool_result",
        ...     "id": "call_abc123",
        ...     "name": "get_weather",
        ...     "output": "北京当前温度：25°C，晴朗"
        ... }
    
    Note:
        - id 必须与对应的 ToolUseBlock.id 一致
        - output 可以是字符串或内容块列表（如返回图像）
    """

    type: Required[Literal["tool_result"]]
    """块类型标识，固定为 "tool_result" """

    id: Required[str]
    """关联的工具调用 ID，与 ToolUseBlock.id 对应"""

    output: Required[
        str | List[TextBlock | ImageBlock | AudioBlock | VideoBlock]
    ]
    """工具执行的输出结果"""

    name: Required[str]
    """工具名称"""


ContentBlock = (
    ToolCallsBlock
    | ToolResultBlock
    | TextBlock
    | ThinkingBlock
    | ImageBlock
    | AudioBlock
    | VideoBlock
)
"""
内容块联合类型。

定义所有可能的内容块类型，用于类型注解。
一条消息可以包含多个不同类型的内容块。

支持的类型：
    - TextBlock: 文本内容
    - ThinkingBlock: 思考过程
    - ImageBlock: 图像内容
    - AudioBlock: 音频内容
    - VideoBlock: 视频内容
    - ToolUseBlock: 工具调用请求
    - ToolResultBlock: 工具调用结果
"""
