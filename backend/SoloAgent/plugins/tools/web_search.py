# -*- coding: utf-8 -*-
"""
网络搜索工具模块 - 使用 DuckDuckGo API 获取真实搜索结果

@file web_search.py
@description 网络搜索工具 - 使用 DuckDuckGo Instant Answer API
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 使用 DuckDuckGo Instant Answer API 获取搜索结果
- 无需API密钥
- 支持中英文搜索

使用场景：
- ToolkitExecutor 工具注册
- ReActAgent 工具调用
"""

import httpx
from typing import Dict, Any
from .toolkit_executor import ToolResponse


async def web_search(query: str, max_results: int = 5) -> ToolResponse:
    """
    在网络上搜索信息（真实API调用）
    
    使用 DuckDuckGo Instant Answer API，无需API密钥。
    
    Args:
        query: 搜索关键词
        max_results: 最大结果数量（默认5）
    
    Returns:
        ToolResponse: 包含搜索结果的响应
    
    Example:
        >>> result = await web_search("Python asyncio")
        >>> print(result.content)
        【搜索结果】关于 'Python asyncio'：
        asyncio is a library to write concurrent code...
    """
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.get(
                "https://api.duckduckgo.com/",
                params={
                    "q": query,
                    "format": "json",
                    "no_html": 1,
                    "skip_disambig": 1
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                abstract = data.get("Abstract", "")
                related_topics = data.get("RelatedTopics", [])
                
                results = []
                
                if abstract:
                    results.append(f"摘要: {abstract[:500]}")
                
                for i, topic in enumerate(related_topics[:max_results]):
                    if isinstance(topic, dict) and "Text" in topic:
                        results.append(f"相关结果{i+1}: {topic['Text'][:300]}")
                
                if results:
                    result_text = f"【搜索结果】关于 '{query}'：\n" + "\n".join(results)
                    return ToolResponse(content=result_text)
                else:
                    return ToolResponse(
                        content=f"【搜索结果】DuckDuckGo未找到关于 '{query}' 的即时答案。建议：1) 尝试更具体的关键词 2) 使用其他搜索引擎",
                        success=True
                    )
            elif response.status_code == 202:
                return ToolResponse(
                    content=f"【搜索结果】DuckDuckGo API返回202（请求已接受，正在处理）。请稍后重试或尝试其他关键词。",
                    success=True
                )
            else:
                return ToolResponse(
                    content=f"搜索API请求失败：HTTP {response.status_code}",
                    success=False,
                    error_message=f"HTTP {response.status_code}"
                )
        except Exception as e:
            return ToolResponse(
                content=f"搜索出错：{str(e)}",
                success=False,
                error_message=str(e)
            )


def get_web_search_tool_spec() -> Dict[str, Any]:
    """
    获取搜索工具的规范定义
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到 ToolkitExecutor
    """
    return {
        "name": "web_search",
        "function": web_search,
        "description": "在网络上搜索信息。使用DuckDuckGo API获取实时搜索结果。",
        "parameters": {
            "query": {
                "type": "string",
                "required": True,
                "description": "搜索关键词"
            },
            "max_results": {
                "type": "integer",
                "required": False,
                "default": 5,
                "description": "最大结果数量（默认5）"
            }
        }
    }
