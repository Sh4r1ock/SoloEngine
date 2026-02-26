# -*- coding: utf-8 -*-
def main(query: str, limit: int = 10) -> dict:
    """测试工具"""
    results = []
    for i in range(limit):
        results.append({"id": i, "text": f"Result for: {query}"})
    return {"status": "success", "data": results}
