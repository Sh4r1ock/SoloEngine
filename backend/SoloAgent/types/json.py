# -*- coding: utf-8 -*-
"""
SoloEngine : JSON类型定义模块，定义JSON可序列化类型

@file json.py
@description 定义JSON可序列化类型
@author Sh4rlock
@date 2026-04-09

功能描述：
- 定义 JSON 原始类型
- 定义 JSON 可序列化对象类型
- 提供类型安全的 JSON 数据结构定义

类型定义：
    JSONPrimitive: JSON 原始类型
        - str: 字符串
        - int: 整数
        - float: 浮点数
        - bool: 布尔值
        - None: 空值
    
    JSONSerializableObject: JSON 可序列化对象
        - JSONPrimitive: 原始类型
        - list[JSONSerializableObject]: 数组
        - dict[str, JSONSerializableObject]: 对象

设计理念：
    使用递归类型定义，确保类型系统可以正确表示
    任意深度的嵌套 JSON 结构。

使用场景：
    - API 响应数据的类型注解
    - 配置文件的类型定义
    - 元数据的类型约束

状态: ✅ 完整实现
"""

from typing import Union


JSONPrimitive = Union[
    str,
    int,
    float,
    bool,
    None,
]
"""
JSON 原始类型。

定义 JSON 规范中的原始数据类型，这些类型可以直接
被 JSON 序列化和反序列化。

支持的类型：
    - str: 字符串，如 "hello"
    - int: 整数，如 42
    - float: 浮点数，如 3.14
    - bool: 布尔值，如 true/false
    - None: 空值，对应 JSON 的 null

Example:
    >>> value: JSONPrimitive = "hello"
    >>> value: JSONPrimitive = 42
    >>> value: JSONPrimitive = None

Note:
    Python 的 bool 类型在 JSON 中序列化为 true/false。
"""


JSONSerializableObject = Union[
    JSONPrimitive,
    list["JSONSerializableObject"],
    dict[
        str,
        "JSONSerializableObject",
    ],
]
"""
JSON 可序列化对象类型。

定义可以被 JSON 序列化的完整数据结构，包括：
- 原始类型（字符串、数字、布尔值、null）
- 数组（列表）
- 对象（字典）

这是一个递归类型定义，允许任意深度的嵌套结构。

Example:
    >>> # 原始类型
    >>> data: JSONSerializableObject = "hello"
    >>> 
    >>> # 简单对象
    >>> data: JSONSerializableObject = {"name": "Alice", "age": 30}
    >>> 
    >>> # 嵌套结构
    >>> data: JSONSerializableObject = {
    ...     "user": {
    ...         "name": "Bob",
    ...         "tags": ["admin", "developer"]
    ...     },
    ...     "active": True,
    ...     "score": 95.5
    ... }
    >>> 
    >>> # 数组
    >>> data: JSONSerializableObject = [1, 2, 3, {"key": "value"}]

Note:
    - 字典的键必须是字符串类型
    - 不支持 Python 特有类型（如 set, tuple, datetime）
    - 使用 json.dumps/loads 进行序列化和反序列化
"""
