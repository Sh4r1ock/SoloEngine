# -*- coding: utf-8 -*-
"""
安全计算器模块 - 使用 simpleeval 库安全地求值数学表达式。

@file calculator.py
@description 安全计算器 - 数学表达式安全求值模块
@author SoloEngine Team
@date 2026-02-24

功能描述：
- 使用 simpleeval 库安全地求值数学表达式
- 提供可配置的运算符和函数白名单
- 完善的输入验证和错误处理
- 支持常用数学函数和常量

使用场景：
- tool_registry.py 中的计算器工具
- toolkit_executor.py 中的计算器工具
- 其他需要安全数学表达式求值的场景

注意事项：
- 不支持任意代码执行
- 所有运算符和函数都是白名单控制
- 有表达式长度和结果幅度限制
"""

import ast
import logging
import math
import re
from enum import Enum
from typing import Any, Dict, Optional

try:
    from simpleeval import SimpleEval, InvalidExpression
    SIMPLEEVAL_AVAILABLE = True
except ImportError:
    SIMPLEEVAL_AVAILABLE = False
    SimpleEval = None
    InvalidExpression = Exception

logger = logging.getLogger(__name__)


class CalculatorErrorType(Enum):
    """计算器错误类型枚举。"""
    EMPTY_EXPRESSION = "empty_expression"
    EXPRESSION_TOO_LONG = "expression_too_long"
    INVALID_SYNTAX = "invalid_syntax"
    DIVISION_BY_ZERO = "division_by_zero"
    NUMERICAL_OVERFLOW = "numerical_overflow"
    RESULT_TOO_LARGE = "result_too_large"
    INVALID_CHARACTERS = "invalid_characters"
    MISMATCHED_BRACKETS = "mismatched_brackets"
    UNKNOWN_ERROR = "unknown_error"


class CalculatorError(Exception):
    """计算器错误异常类。"""
    
    def __init__(self, error_type: CalculatorErrorType, message: str):
        self.error_type = error_type
        self.message = message
        super().__init__(message)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "error_type": self.error_type.value,
            "message": self.message
        }


class SafeCalculator:
    """安全计算器类 - 使用 simpleeval 进行安全的数学表达式求值。"""
    
    DEFAULT_MAX_EXPRESSION_LENGTH = 1000
    DEFAULT_MAX_RESULT_MAGNITUDE = 1e100
    
    def __init__(
        self,
        max_expression_length: int = DEFAULT_MAX_EXPRESSION_LENGTH,
        max_result_magnitude: float = DEFAULT_MAX_RESULT_MAGNITUDE,
    ):
        """
        初始化安全计算器。
        
        Args:
            max_expression_length: 表达式最大长度
            max_result_magnitude: 结果最大幅度
        """
        self._max_expression_length = max_expression_length
        self._max_result_magnitude = max_result_magnitude
        
        if SIMPLEEVAL_AVAILABLE:
            self._evaluator = SimpleEval()
            self._setup_safe_operators()
            self._setup_safe_functions()
        else:
            self._evaluator = None
            logger.warning(
                "simpleeval library not available, calculator will use fallback mode"
            )
    
    def _setup_safe_operators(self) -> None:
        """配置安全的运算符。"""
        self._evaluator.operators = {
            ast.Add: lambda a, b: a + b,
            ast.Sub: lambda a, b: a - b,
            ast.Mult: lambda a, b: a * b,
            ast.Div: self._safe_div,
            ast.FloorDiv: self._safe_floordiv,
            ast.Mod: self._safe_mod,
            ast.Pow: self._safe_pow,
            ast.USub: lambda a: -a,
            ast.UAdd: lambda a: +a,
        }
    
    def _setup_safe_functions(self) -> None:
        """配置安全的数学函数。"""
        self._evaluator.functions = {
            'abs': abs,
            'round': round,
            'min': min,
            'max': max,
            'sum': sum,
            'pow': self._safe_pow,
            'sqrt': self._safe_sqrt,
            'sin': math.sin,
            'cos': math.cos,
            'tan': math.tan,
            'asin': math.asin,
            'acos': math.acos,
            'atan': math.atan,
            'sinh': math.sinh,
            'cosh': math.cosh,
            'tanh': math.tanh,
            'log': self._safe_log,
            'log10': math.log10,
            'log2': math.log2,
            'exp': self._safe_exp,
            'floor': math.floor,
            'ceil': math.ceil,
            'factorial': self._safe_factorial,
        }
        
        self._evaluator.names = {
            'pi': math.pi,
            'e': math.e,
            'tau': math.tau,
            'inf': math.inf,
        }
    
    @staticmethod
    def _safe_div(a: Any, b: Any) -> Any:
        """安全除法，处理除以零。"""
        if b == 0:
            raise CalculatorError(
                CalculatorErrorType.DIVISION_BY_ZERO,
                "Division by zero"
            )
        return a / b
    
    @staticmethod
    def _safe_floordiv(a: Any, b: Any) -> Any:
        """安全整除，处理除以零。"""
        if b == 0:
            raise CalculatorError(
                CalculatorErrorType.DIVISION_BY_ZERO,
                "Division by zero"
            )
        return a // b
    
    @staticmethod
    def _safe_mod(a: Any, b: Any) -> Any:
        """安全取模，处理除以零。"""
        if b == 0:
            raise CalculatorError(
                CalculatorErrorType.DIVISION_BY_ZERO,
                "Division by zero"
            )
        return a % b
    
    def _safe_pow(self, a: Any, b: Any) -> Any:
        """安全幂运算，处理溢出。"""
        try:
            result = a ** b
            if isinstance(result, (int, float)) and abs(result) > self._max_result_magnitude:
                raise CalculatorError(
                    CalculatorErrorType.RESULT_TOO_LARGE,
                    f"Result magnitude too large (max {self._max_result_magnitude})"
                )
            return result
        except OverflowError:
            raise CalculatorError(
                CalculatorErrorType.NUMERICAL_OVERFLOW,
                "Numerical overflow in power operation"
            )
    
    def _safe_sqrt(self, a: Any) -> Any:
        """安全平方根，处理负数。"""
        if a < 0:
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                "Cannot calculate square root of negative number"
            )
        return math.sqrt(a)
    
    def _safe_log(self, a: Any, base: Optional[float] = None) -> Any:
        """安全对数，处理非正数。"""
        if a <= 0:
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                "Cannot calculate logarithm of non-positive number"
            )
        if base is None:
            return math.log(a)
        if base <= 0 or base == 1:
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                "Invalid logarithm base"
            )
        return math.log(a, base)
    
    def _safe_exp(self, a: Any) -> Any:
        """安全指数，处理溢出。"""
        try:
            result = math.exp(a)
            if abs(result) > self._max_result_magnitude:
                raise CalculatorError(
                    CalculatorErrorType.RESULT_TOO_LARGE,
                    f"Result magnitude too large (max {self._max_result_magnitude})"
                )
            return result
        except OverflowError:
            raise CalculatorError(
                CalculatorErrorType.NUMERICAL_OVERFLOW,
                "Numerical overflow in exponential operation"
            )
    
    def _safe_factorial(self, a: Any) -> Any:
        """安全阶乘，处理负数和大数。"""
        if not isinstance(a, int) or a < 0:
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                "Factorial requires non-negative integer"
            )
        if a > 170:
            raise CalculatorError(
                CalculatorErrorType.RESULT_TOO_LARGE,
                "Factorial result too large"
            )
        return math.factorial(a)
    
    def _validate_expression(self, expression: str) -> None:
        """
        验证表达式的基本有效性。
        
        Args:
            expression: 要验证的表达式
            
        Raises:
            CalculatorError: 如果表达式无效
        """
        if not expression or not expression.strip():
            raise CalculatorError(
                CalculatorErrorType.EMPTY_EXPRESSION,
                "Expression cannot be empty"
            )
        
        if len(expression) > self._max_expression_length:
            raise CalculatorError(
                CalculatorErrorType.EXPRESSION_TOO_LONG,
                f"Expression too long (max {self._max_expression_length} characters)"
            )
        
        if not self._check_brackets(expression):
            raise CalculatorError(
                CalculatorErrorType.MISMATCHED_BRACKETS,
                "Mismatched brackets in expression"
            )
    
    def _check_brackets(self, expression: str) -> bool:
        """
        检查括号是否匹配。
        
        Args:
            expression: 要检查的表达式
            
        Returns:
            括号是否匹配
        """
        stack = []
        bracket_pairs = {'(': ')', '[': ']', '{': '}'}
        
        for char in expression:
            if char in bracket_pairs:
                stack.append(char)
            elif char in bracket_pairs.values():
                if not stack or bracket_pairs[stack.pop()] != char:
                    return False
        
        return len(stack) == 0
    
    def evaluate(self, expression: str) -> Dict[str, Any]:
        """
        安全地求值数学表达式。
        
        Args:
            expression: 要求值的数学表达式
            
        Returns:
            包含以下字段的字典：
                - success: 是否成功
                - result: 求值结果（成功时）
                - error: 错误消息（失败时）
                - error_type: 错误类型（失败时）
        """
        try:
            self._validate_expression(expression)
            
            if SIMPLEEVAL_AVAILABLE:
                result = self._evaluator.eval(expression)
            else:
                result = self._fallback_evaluate(expression)
            
            if isinstance(result, (int, float)):
                if abs(result) > self._max_result_magnitude:
                    return {
                        "success": False,
                        "error": f"Result magnitude too large (max {self._max_result_magnitude})",
                        "error_type": CalculatorErrorType.RESULT_TOO_LARGE.value
                    }
            
            return {
                "success": True,
                "result": result
            }
            
        except CalculatorError as e:
            logger.warning(f"Calculator error for expression '{expression}': {e.message}")
            return {
                "success": False,
                "error": e.message,
                "error_type": e.error_type.value
            }
        except InvalidExpression as e:
            logger.warning(f"Invalid expression '{expression}': {e}")
            return {
                "success": False,
                "error": f"Invalid mathematical expression: {str(e)}",
                "error_type": CalculatorErrorType.INVALID_SYNTAX.value
            }
        except ZeroDivisionError:
            return {
                "success": False,
                "error": "Division by zero",
                "error_type": CalculatorErrorType.DIVISION_BY_ZERO.value
            }
        except OverflowError:
            return {
                "success": False,
                "error": "Numerical overflow",
                "error_type": CalculatorErrorType.NUMERICAL_OVERFLOW.value
            }
        except Exception as e:
            logger.error(f"Unexpected error evaluating expression '{expression}': {e}")
            return {
                "success": False,
                "error": f"Evaluation error: {str(e)}",
                "error_type": CalculatorErrorType.UNKNOWN_ERROR.value
            }
    
    def _fallback_evaluate(self, expression: str) -> Any:
        """
        后备求值方法（当 simpleeval 不可用时）。
        使用更严格的验证，但仍使用 ast.literal_eval 的安全变体。
        
        Args:
            expression: 要求值的表达式
            
        Returns:
            求值结果
            
        Raises:
            CalculatorError: 如果表达式无效或不安全
        """
        allowed_chars = set("0123456789+-*/.() %^")
        clean_expr = expression.replace(" ", "")
        
        if not all(c in allowed_chars for c in clean_expr):
            raise CalculatorError(
                CalculatorErrorType.INVALID_CHARACTERS,
                "Expression contains invalid characters"
            )
        
        try:
            tree = ast.parse(clean_expr, mode='eval')
            return self._eval_ast_node(tree.body)
        except SyntaxError as e:
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                f"Invalid expression syntax: {str(e)}"
            )
    
    def _eval_ast_node(self, node: ast.AST) -> Any:
        """
        递归求值 AST 节点（后备方法）。
        
        Args:
            node: AST 节点
            
        Returns:
            求值结果
        """
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise CalculatorError(
                CalculatorErrorType.INVALID_SYNTAX,
                "Only numeric constants are allowed"
            )
        
        if isinstance(node, ast.BinOp):
            left = self._eval_ast_node(node.left)
            right = self._eval_ast_node(node.right)
            
            if isinstance(node.op, ast.Add):
                return left + right
            elif isinstance(node.op, ast.Sub):
                return left - right
            elif isinstance(node.op, ast.Mult):
                return left * right
            elif isinstance(node.op, ast.Div):
                return self._safe_div(left, right)
            elif isinstance(node.op, ast.FloorDiv):
                return self._safe_floordiv(left, right)
            elif isinstance(node.op, ast.Mod):
                return self._safe_mod(left, right)
            elif isinstance(node.op, ast.Pow):
                return self._safe_pow(left, right)
            else:
                raise CalculatorError(
                    CalculatorErrorType.INVALID_SYNTAX,
                    f"Unsupported operator: {type(node.op).__name__}"
                )
        
        if isinstance(node, ast.UnaryOp):
            operand = self._eval_ast_node(node.operand)
            if isinstance(node.op, ast.USub):
                return -operand
            elif isinstance(node.op, ast.UAdd):
                return +operand
            else:
                raise CalculatorError(
                    CalculatorErrorType.INVALID_SYNTAX,
                    f"Unsupported unary operator: {type(node.op).__name__}"
                )
        
        raise CalculatorError(
            CalculatorErrorType.INVALID_SYNTAX,
            f"Unsupported expression type: {type(node).__name__}"
        )


calculator = SafeCalculator()
