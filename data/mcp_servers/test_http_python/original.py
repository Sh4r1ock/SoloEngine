# -*- coding: utf-8 -*-
"""
自定义MCP工具模块
主函数名必须为 main
"""

def main(query: str, limit: int = 10) -> dict:
    """
    工具主函数
    
    Args:
        query: 查询关键词
        limit: 返回数量限制
    
    Returns:
        dict: 返回结果
    """
    results = []
    for i in range(limit):
        results.append({
            "id": i,
            "text": f"Result for: {query}"
        })
    
    return {
        "status": "success",
        "data": results,
        "total": len(results)
    }
