# -*- coding: utf-8 -*-
"""
测试安全计算器模块的正确性。
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from SoloAgent.plugins.tools.calculator import calculator, SafeCalculator, CalculatorError


def test_basic_operations():
    """测试基本运算。"""
    print("=" * 50)
    print("测试基本运算")
    print("=" * 50)
    
    test_cases = [
        ("2 + 3", 5),
        ("10 - 4", 6),
        ("3 * 4", 12),
        ("15 / 3", 5),
        ("2 ** 3", 8),
        ("10 % 3", 1),
        ("10 // 3", 3),
        ("-5", -5),
        ("+5", 5),
    ]
    
    for expr, expected in test_cases:
        result = calculator.evaluate(expr)
        status = "✓" if result["success"] and result["result"] == expected else "✗"
        print(f"{status} {expr} = {result.get('result', 'ERROR')} (expected: {expected})")


def test_operator_precedence():
    """测试运算符优先级。"""
    print("\n" + "=" * 50)
    print("测试运算符优先级")
    print("=" * 50)
    
    test_cases = [
        ("2 + 3 * 4", 14),
        ("(2 + 3) * 4", 20),
        ("10 - 2 * 3", 4),
        ("100 / 10 + 5", 15),
        ("2 ** 3 ** 2", 512),
    ]
    
    for expr, expected in test_cases:
        result = calculator.evaluate(expr)
        status = "✓" if result["success"] and result["result"] == expected else "✗"
        print(f"{status} {expr} = {result.get('result', 'ERROR')} (expected: {expected})")


def test_math_functions():
    """测试数学函数。"""
    print("\n" + "=" * 50)
    print("测试数学函数")
    print("=" * 50)
    
    import math
    
    test_cases = [
        ("abs(-5)", 5),
        ("round(3.7)", 4),
        ("min(1, 5, 3)", 1),
        ("max(1, 5, 3)", 5),
        ("sqrt(16)", 4),
        ("sin(0)", 0),
        ("cos(0)", 1),
        ("log(e)", 1),
        ("log10(100)", 2),
        ("floor(3.7)", 3),
        ("ceil(3.2)", 4),
    ]
    
    for expr, expected in test_cases:
        result = calculator.evaluate(expr)
        is_correct = result["success"] and abs(result["result"] - expected) < 0.0001
        status = "✓" if is_correct else "✗"
        print(f"{status} {expr} = {result.get('result', 'ERROR')} (expected: {expected})")


def test_constants():
    """测试数学常量。"""
    print("\n" + "=" * 50)
    print("测试数学常量")
    print("=" * 50)
    
    import math
    
    test_cases = [
        ("pi", math.pi),
        ("e", math.e),
    ]
    
    for expr, expected in test_cases:
        result = calculator.evaluate(expr)
        is_correct = result["success"] and abs(result["result"] - expected) < 0.0001
        status = "✓" if is_correct else "✗"
        print(f"{status} {expr} = {result.get('result', 'ERROR')} (expected: {expected})")


def test_error_handling():
    """测试错误处理。"""
    print("\n" + "=" * 50)
    print("测试错误处理")
    print("=" * 50)
    
    test_cases = [
        ("", "empty"),
        ("   ", "empty"),
        ("1 / 0", "division"),
        ("2 +", "syntax"),
        ("(2 + 3", "bracket"),
        ("import os", "invalid"),
        ("__import__('os')", "invalid"),
        ("eval('1+1')", "invalid"),
    ]
    
    for expr, error_type in test_cases:
        result = calculator.evaluate(expr)
        status = "✓" if not result["success"] else "✗"
        print(f"{status} '{expr}' -> {result.get('error', 'SUCCESS')} (expected error: {error_type})")


def test_security():
    """测试安全性 - 确保不会执行恶意代码。"""
    print("\n" + "=" * 50)
    print("测试安全性")
    print("=" * 50)
    
    malicious_expressions = [
        "__import__('os').system('echo hacked')",
        "open('/etc/passwd').read()",
        "exec('print(1)')",
        "eval('1+1')",
        "globals()",
        "locals()",
        "dir()",
        "help()",
        "exit()",
        "quit()",
        "os.system('ls')",
        "subprocess.run(['ls'])",
    ]
    
    all_safe = True
    for expr in malicious_expressions:
        result = calculator.evaluate(expr)
        if result["success"]:
            print(f"✗ SECURITY ISSUE: '{expr}' was executed!")
            all_safe = False
        else:
            print(f"✓ '{expr}' was safely rejected: {result['error']}")
    
    if all_safe:
        print("\n✓ All malicious expressions were safely rejected!")


def test_complex_expressions():
    """测试复杂表达式。"""
    print("\n" + "=" * 50)
    print("测试复杂表达式")
    print("=" * 50)
    
    test_cases = [
        ("(2 + 3) * (4 - 1)", 15),
        ("sin(pi/2) + cos(0)", 2),
        ("sqrt(16) + pow(2, 3)", 12),
        ("log(e ** 2)", 2),
        ("abs(-10) + min(5, 3) * max(2, 4)", 22),
    ]
    
    for expr, expected in test_cases:
        result = calculator.evaluate(expr)
        is_correct = result["success"] and abs(result["result"] - expected) < 0.0001
        status = "✓" if is_correct else "✗"
        print(f"{status} {expr} = {result.get('result', 'ERROR')} (expected: {expected})")


def main():
    """运行所有测试。"""
    print("\n" + "=" * 50)
    print("安全计算器模块测试")
    print("=" * 50)
    
    test_basic_operations()
    test_operator_precedence()
    test_math_functions()
    test_constants()
    test_error_handling()
    test_security()
    test_complex_expressions()
    
    print("\n" + "=" * 50)
    print("测试完成")
    print("=" * 50)


if __name__ == "__main__":
    main()
