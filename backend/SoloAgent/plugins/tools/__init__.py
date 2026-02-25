# -*- coding: utf-8 -*-
"""Tool plugins for SoloEngine."""

from .toolkit_executor import ToolkitExecutor, ToolResponse
from .calculator import SafeCalculator, CalculatorError, CalculatorErrorType, calculator
from .weather import get_weather, get_weather_tool_spec
from .web_search import web_search, get_web_search_tool_spec

from .finish_function_calling import (
    FINISH_TOOL_NAME,
    FINISH_TOOL_SPEC,
    get_finish_tool_spec,
    is_finish_tool_call,
    extract_finish_answer,
    check_finish_by_function_calling,
)

from .finish_structured import (
    FINISH_ACTION,
    STRUCTURED_FINISH_SCHEMA,
    get_structured_finish_schema,
    parse_structured_output,
    is_finish_action,
    extract_structured_answer,
    check_finish_by_structured_output,
)

from .finish_markers import (
    CompletionMarkers,
    check_finish_by_markers,
)

__all__ = [
    "ToolkitExecutor",
    "ToolResponse",
    "SafeCalculator",
    "CalculatorError",
    "CalculatorErrorType",
    "calculator",
    "get_weather",
    "get_weather_tool_spec",
    "web_search",
    "get_web_search_tool_spec",
    "FINISH_TOOL_NAME",
    "FINISH_TOOL_SPEC",
    "get_finish_tool_spec",
    "is_finish_tool_call",
    "extract_finish_answer",
    "check_finish_by_function_calling",
    "FINISH_ACTION",
    "STRUCTURED_FINISH_SCHEMA",
    "get_structured_finish_schema",
    "parse_structured_output",
    "is_finish_action",
    "extract_structured_answer",
    "check_finish_by_structured_output",
    "CompletionMarkers",
    "check_finish_by_markers",
]
