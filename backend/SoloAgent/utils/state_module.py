# -*- coding: utf-8 -*-
"""
SoloEngine : 状态模块，支持嵌套状态的序列化和反序列化

@file state_module.py
@description 提供状态模块类，支持嵌套状态的序列化和反序列化
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - StateModule: 状态模块类，支持嵌套状态的序列化和反序列化
    - 自动追踪嵌套的状态模块
    - 支持自定义序列化/反序列化方法

依赖:
    - collections.OrderedDict: 有序字典
    - typing: 类型注解支持
    - ..types: SoloEngine类型系统

使用示例:
    - from SoloAgent.utils.state_module import StateModule
    - class MyModule(StateModule):
    -     def __init__(self):
    -         super().__init__()
    -         self.value = 10
"""
from collections import OrderedDict
from typing import Any

from ..types import JSONSerializableObject


class StateModule:
    """
    状态模块类，支持嵌套状态的序列化和反序列化
    
    职责:
        - 管理模块状态，支持嵌套状态模块
        - 提供状态的序列化(state_dict)和反序列化(load_state_dict)功能
        - 自动追踪子状态模块
    
    属性:
        _module_dict (OrderedDict): 存储嵌套的状态模块
        _attribute_dict (OrderedDict): 存储普通属性
    
    示例:
        >>> class MyModule(StateModule):
        ...     def __init__(self):
        ...         super().__init__()
        ...         self.value = 10
        >>> module = MyModule()
        >>> state = module.state_dict()
        >>> module.load_state_dict(state)
    """

    def __init__(self) -> None:
        """
        初始化状态模块
        
        初始化有序字典用于存储模块和属性
        """
        self._module_dict = OrderedDict()
        self._attribute_dict = OrderedDict()

    def __setattr__(self, key: str, value: Any) -> None:
        """
        设置属性并记录状态模块
        
        Args:
            key: 属性名
            value: 属性值
            
        Raises:
            AttributeError: 如果在构造函数中未调用super().__init__()
        """
        if isinstance(value, StateModule):
            if not hasattr(self, "_module_dict"):
                raise AttributeError(
                    f"Call the super().__init__() method within the "
                    f"constructor of {self.__class__.__name__} before setting "
                    f"any attributes.",
                )
            self._module_dict[key] = value
        super().__setattr__(key, value)

    def __delattr__(self, key: str) -> None:
        """
        删除属性并从状态模块中移除
        
        Args:
            key: 要删除的属性名
        """
        if key in self._module_dict:
            self._module_dict.pop(key)
        if key in self._attribute_dict:
            self._attribute_dict.pop(key)
        super().__delattr__(key)

    def state_dict(self) -> dict:
        """
        获取模块的状态字典，包括嵌套的状态模块
        
        Returns:
            包含所有状态和嵌套模块状态的字典
            
        Example:
            >>> module = StateModule()
            >>> state = module.state_dict()
        """
        state = {}
        
        # Add attributes
        for key, value in self._attribute_dict.items():
            if hasattr(value, "to_json") and callable(value.to_json):
                state[key] = value.to_json()
            else:
                state[key] = value
        
        # Add nested modules
        for key, module in self._module_dict.items():
            state[key] = module.state_dict()
        
        return state

    def load_state_dict(self, state: dict) -> None:
        """
        从状态字典加载状态到模块
        
        Args:
            state: 包含状态的字典
            
        Example:
            >>> module = StateModule()
            >>> module.load_state_dict({'key': 'value'})
        """
        for key, value in state.items():
            if key in self._module_dict:
                # This is a nested module
                self._module_dict[key].load_state_dict(value)
            elif key in self._attribute_dict:
                # This is an attribute
                attr_value = self._attribute_dict[key]
                if hasattr(attr_value, "load_json") and callable(attr_value.load_json):
                    setattr(self, key, attr_value.load_json(value))
                else:
                    setattr(self, key, value)
            else:
                # New attribute
                setattr(self, key, value)
