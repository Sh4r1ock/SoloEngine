# -*- coding: utf-8 -*-
"""用户上传的普通 Python 代码"""

def calculate(a: int, b: int):
    """计算两个数的和与差"""
    return {
        "sum": a + b,
        "difference": a - b,
        "product": a * b
    }

def greet(name: str):
    """打招呼"""
    return {
        "message": f"Hello, {name}!",
        "status": "success"
    }
