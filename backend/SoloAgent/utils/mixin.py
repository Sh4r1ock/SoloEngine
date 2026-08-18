# -*- coding: utf-8 -*-
"""
SoloEngine : Mixin工具模块，提供字典Mixin类

@file mixin.py
@description 提供字典Mixin类，支持属性式访问
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下Mixin类：
    - DictMixin: 字典Mixin，支持属性式访问字典项

依赖:
    - 无

使用示例:
    - from SoloAgent.utils.mixin import DictMixin
    - obj = DictMixin({'key': 'value'})
    - print(obj.key)  # 输出: value
"""


class DictMixin(dict):
    """
    字典Mixin类，支持属性式访问
    
    职责:
        - 允许使用点号语法访问字典项
        - 提供类似对象的属性访问体验
    
    属性:
        继承自dict的所有方法和属性
    
    示例:
        >>> obj = DictMixin({'name': 'SoloEngine', 'version': '1.0'})
        >>> print(obj.name)
        'SoloEngine'
        >>> obj.new_key = 'new_value'
        >>> print(obj['new_key'])
        'new_value'
    """

    __setattr__ = dict.__setitem__

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")
