# -*- coding: utf-8 -*-
"""The state module in SoloEngine."""
from collections import OrderedDict
from typing import Any

from ..types import JSONSerializableObject


class StateModule:
    """The state module class in SoloEngine to support nested state
    serialization and deserialization."""

    def __init__(self) -> None:
        """Initialize the state module."""
        self._module_dict = OrderedDict()
        self._attribute_dict = OrderedDict()

    def __setattr__(self, key: str, value: Any) -> None:
        """Set attributes and record state modules."""
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
        """Delete attributes and remove from state modules."""
        if key in self._module_dict:
            self._module_dict.pop(key)
        if key in self._attribute_dict:
            self._attribute_dict.pop(key)
        super().__delattr__(key)

    def state_dict(self) -> dict:
        """Get the state dictionary of the module, including the nested
        state modules."""
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
        """Load the state dictionary to the module."""
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