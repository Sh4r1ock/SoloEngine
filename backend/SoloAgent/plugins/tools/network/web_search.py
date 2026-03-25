# -*- coding: utf-8 -*-
"""
网络搜索工具模块。

@file web_search.py
@description 提供网络搜索功能，支持多种搜索引擎
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 支持多种搜索引擎（DuckDuckGo、Tavily、Serper）
- 支持结果数量限制
- 支持语言限制
- 返回结构化搜索结果

使用场景：
- 获取实时信息（天气、股票等）
- 搜索用户不了解的技术概念
- 验证信息准确性

状态: ✅ 完整实现
"""

import json
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from .base import BaseNetworkTool, NetworkResponse, NetworkToolError


@dataclass
class SearchResult:
    """
    搜索结果数据类。
    
    Attributes:
        title (str): 结果标题
        url (str): 结果链接
        content (str): 结果摘要内容
        source (str): 来源搜索引擎
    """
    title: str
    url: str
    content: str
    source: str = "duckduckgo"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "title": self.title,
            "url": self.url,
            "content": self.content,
            "source": self.source,
        }


class WebSearch(BaseNetworkTool):
    """
    网络搜索工具。
    
    支持多种搜索引擎的网络搜索工具，默认使用 DuckDuckGo（无需 API key）。
    
    支持的搜索引擎：
        - duckduckgo: 默认，无需 API key
        - tavily: 需要 TAVILY_API_KEY
        - serper: 需要 SERPER_API_KEY
    
    Attributes:
        api_keys (Dict[str, str]): 各搜索引擎的 API key
    
    Example:
        >>> search = WebSearch()
        >>> results = await search.search("Python asyncio", num=5)
        >>> for result in results:
        ...     print(result.title, result.url)
    """
    
    DUCKDUCKGO_API = "https://api.duckduckgo.com/"
    TAVILY_API = "https://api.tavily.com/search"
    SERPER_API = "https://google.serper.dev/search"
    
    def __init__(
        self,
        timeout: int = 15,
        api_keys: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        初始化搜索工具。
        
        Args:
            timeout (int, optional): 请求超时时间（秒）。默认为 15。
            api_keys (Optional[Dict[str, str]], optional): API key 字典。
                支持的 key: "tavily", "serper"。默认为 None。
        """
        super().__init__(timeout=timeout)
        self.api_keys = api_keys or {}
    
    async def search(
        self,
        query: str,
        num: int = 5,
        lr: Optional[str] = None,
        engine: str = "duckduckgo",
    ) -> List[SearchResult]:
        """
        执行网络搜索。
        
        根据指定的搜索引擎执行搜索并返回结果列表。
        
        Args:
            query (str): 搜索查询字符串。
            num (int, optional): 最大返回结果数量。默认为 5。
            lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
                默认为 None。
            engine (str, optional): 搜索引擎，可选 "duckduckgo"、"tavily"、"serper"。
                默认为 "duckduckgo"。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        
        Raises:
            NetworkToolError: 当搜索失败时抛出。
        
        Example:
            >>> results = await search.search("Python 教程", num=3, lr="lang_zh-CN")
        """
        if engine == "duckduckgo":
            return await self._search_duckduckgo(query, num, lr)
        elif engine == "tavily":
            return await self._search_tavily(query, num, lr)
        elif engine == "serper":
            return await self._search_serper(query, num, lr)
        else:
            raise NetworkToolError(f"不支持的搜索引擎: {engine}")
    
    async def _search_duckduckgo(
        self,
        query: str,
        num: int,
        lr: Optional[str],
    ) -> List[SearchResult]:
        """
        使用 DuckDuckGo 搜索。
        
        DuckDuckGo Instant Answer API，无需 API key。
        
        Args:
            query (str): 搜索查询。
            num (int): 结果数量限制。
            lr (Optional[str]): 语言限制（DuckDuckGo 不支持）。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        """
        params = {
            "q": query,
            "format": "json",
            "no_html": 1,
            "skip_disambig": 1,
        }
        
        response = await self._fetch(
            url=self.DUCKDUCKGO_API,
            params=params,
        )
        
        if not response.success:
            raise NetworkToolError(
                f"DuckDuckGo 搜索失败: {response.error_message}",
                status_code=response.status_code,
                url=response.url,
            )
        
        try:
            data = json.loads(response.content)
        except json.JSONDecodeError:
            raise NetworkToolError("DuckDuckGo 响应解析失败")
        
        results = []
        
        abstract = data.get("Abstract", "")
        abstract_url = data.get("AbstractURL", "")
        if abstract:
            results.append(SearchResult(
                title="摘要",
                url=abstract_url,
                content=abstract[:500],
                source="duckduckgo",
            ))
        
        related_topics = data.get("RelatedTopics", [])
        for topic in related_topics[:num]:
            if isinstance(topic, dict) and "Text" in topic:
                text = topic.get("Text", "")
                url = topic.get("FirstURL", "")
                title = topic.get("Text", "")[:50] + "..." if len(text) > 50 else text
                
                results.append(SearchResult(
                    title=title.replace("<b>", "").replace("</b>", ""),
                    url=url,
                    content=text[:300].replace("<b>", "").replace("</b>", ""),
                    source="duckduckgo",
                ))
        
        return results[:num]
    
    async def _search_tavily(
        self,
        query: str,
        num: int,
        lr: Optional[str],
    ) -> List[SearchResult]:
        """
        使用 Tavily 搜索。
        
        Tavily 是专为 AI 设计的搜索 API，需要 API key。
        
        Args:
            query (str): 搜索查询。
            num (int): 结果数量限制。
            lr (Optional[str]): 语言限制。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        
        Raises:
            NetworkToolError: 当缺少 API key 时抛出。
        """
        api_key = self.api_keys.get("tavily")
        if not api_key:
            raise NetworkToolError("Tavily 搜索需要设置 TAVILY_API_KEY")
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "query": query,
            "max_results": num,
            "include_answer": False,
        }
        
        if lr:
            payload["include_domains"] = []
        
        response = await self._fetch(
            url=self.TAVILY_API,
            method="POST",
            json=payload,
            headers=headers,
        )
        
        if not response.success:
            raise NetworkToolError(
                f"Tavily 搜索失败: {response.error_message}",
                status_code=response.status_code,
            )
        
        try:
            data = json.loads(response.content)
        except json.JSONDecodeError:
            raise NetworkToolError("Tavily 响应解析失败")
        
        results = []
        for item in data.get("results", [])[:num]:
            results.append(SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                content=item.get("content", ""),
                source="tavily",
            ))
        
        return results
    
    async def _search_serper(
        self,
        query: str,
        num: int,
        lr: Optional[str],
    ) -> List[SearchResult]:
        """
        使用 Serper (Google Search API) 搜索。
        
        Serper 是 Google 搜索结果的 API，需要 API key。
        
        Args:
            query (str): 搜索查询。
            num (int): 结果数量限制。
            lr (Optional[str]): 语言限制。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        
        Raises:
            NetworkToolError: 当缺少 API key 时抛出。
        """
        api_key = self.api_keys.get("serper")
        if not api_key:
            raise NetworkToolError("Serper 搜索需要设置 SERPER_API_KEY")
        
        headers = {
            "X-API-KEY": api_key,
            "Content-Type": "application/json",
        }
        
        payload = {"q": query, "num": num}
        if lr:
            payload["hl"] = lr.replace("lang_", "")
        
        response = await self._fetch(
            url=self.SERPER_API,
            method="POST",
            json=payload,
            headers=headers,
        )
        
        if not response.success:
            raise NetworkToolError(
                f"Serper 搜索失败: {response.error_message}",
                status_code=response.status_code,
            )
        
        try:
            data = json.loads(response.content)
        except json.JSONDecodeError:
            raise NetworkToolError("Serper 响应解析失败")
        
        results = []
        for item in data.get("organic", [])[:num]:
            results.append(SearchResult(
                title=item.get("title", ""),
                url=item.get("link", ""),
                content=item.get("snippet", ""),
                source="serper",
            ))
        
        return results
    
    def format_results(self, results: List[SearchResult]) -> str:
        """
        格式化搜索结果为可读文本。
        
        Args:
            results (List[SearchResult]): 搜索结果列表。
        
        Returns:
            str: 格式化后的文本。
        """
        if not results:
            return "未找到相关搜索结果。"
        
        lines = ["【搜索结果】"]
        for i, result in enumerate(results, 1):
            lines.append(f"\n{i}. {result.title}")
            lines.append(f"   URL: {result.url}")
            lines.append(f"   摘要: {result.content}")
        
        return "\n".join(lines)
    
    async def execute(
        self,
        query: str,
        num: int = 5,
        lr: Optional[str] = None,
        engine: str = "duckduckgo",
    ) -> Dict[str, Any]:
        """
        执行搜索（工具接口）。
        
        这是工具执行器调用的入口方法。
        
        Args:
            query (str): 搜索查询字符串。
            num (int, optional): 最大返回结果数量。默认为 5。
            lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
            engine (str, optional): 搜索引擎。默认为 "duckduckgo"。
        
        Returns:
            Dict[str, Any]: 包含搜索结果的字典。
        """
        try:
            results = await self.search(query, num=num, lr=lr, engine=engine)
            
            if not results:
                return {
                    "content": f"未找到关于 '{query}' 的搜索结果。",
                    "success": True,
                    "results": [],
                    "metadata": {
                        "resources_used": [f"https://duckduckgo.com/?q={query}"]
                    }
                }
            
            formatted = self.format_results(results)
            
            return {
                "content": formatted,
                "success": True,
                "results": [r.to_dict() for r in results],
                "metadata": {
                    "resources_used": [f"https://duckduckgo.com/?q={query}"]
                }
            }
            
        except NetworkToolError as e:
            return {
                "content": f"搜索出错: {e.message}",
                "success": False,
                "error_message": e.message,
                "results": [],
                "metadata": {
                    "resources_used": [f"https://duckduckgo.com/?q={query}"]
                }
            }
        except Exception as e:
            return {
                "content": f"搜索出错: {str(e)}",
                "success": False,
                "error_message": str(e),
                "results": [],
                "metadata": {
                    "resources_used": [f"https://duckduckgo.com/?q={query}"]
                }
            }
    
    @property
    def spec(self) -> Dict[str, Any]:
        """工具规范"""
        return {
            "name": "web_search",
            "description": "在网络上搜索信息。使用搜索引擎获取实时搜索结果。适用于获取实时信息或搜索不了解的技术概念。",
            "parameters": {
                "query": {
                    "type": "string",
                    "required": True,
                    "description": "搜索查询字符串",
                },
                "num": {
                    "type": "integer",
                    "required": False,
                    "default": 5,
                    "description": "最大返回结果数量（默认5）",
                },
                "lr": {
                    "type": "string",
                    "required": False,
                    "default": None,
                    "description": "语言限制，如 'lang_zh-CN' 表示中文",
                },
            },
        }


async def web_search(
    query: str,
    num: int = 5,
    lr: Optional[str] = None,
) -> Dict[str, Any]:
    """
    网络搜索工具函数。
    
    使用 DuckDuckGo 搜索引擎进行网络搜索。
    
    Args:
        query (str): 搜索查询字符串。
        num (int, optional): 最大返回结果数量。默认为 5。
        lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
    
    Returns:
        Dict[str, Any]: 包含搜索结果的字典。
    
    Example:
        >>> result = await web_search("Python asyncio")
        >>> print(result["content"])
    """
    search_tool = WebSearch()
    
    try:
        results = await search_tool.search(query, num=num, lr=lr)
        
        if not results:
            return {
                "content": f"未找到关于 '{query}' 的搜索结果。",
                "success": True,
                "results": [],
            }
        
        formatted = search_tool.format_results(results)
        
        return {
            "content": formatted,
            "success": True,
            "results": [r.to_dict() for r in results],
        }
        
    except NetworkToolError as e:
        return {
            "content": f"搜索出错: {e.message}",
            "success": False,
            "error_message": e.message,
            "results": [],
        }
    except Exception as e:
        return {
            "content": f"搜索出错: {str(e)}",
            "success": False,
            "error_message": str(e),
            "results": [],
        }


def get_web_search_tool_spec() -> Dict[str, Any]:
    """
    获取搜索工具的规范定义。
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到工具执行器。
    """
    return {
        "name": "web_search",
        "function": web_search,
        "description": "在网络上搜索信息。使用搜索引擎获取实时搜索结果。适用于获取实时信息或搜索不了解的技术概念。",
        "parameters": {
            "query": {
                "type": "string",
                "required": True,
                "description": "搜索查询字符串",
            },
            "num": {
                "type": "integer",
                "required": False,
                "default": 5,
                "description": "最大返回结果数量（默认5）",
            },
            "lr": {
                "type": "string",
                "required": False,
                "default": None,
                "description": "语言限制，如 'lang_zh-CN' 表示中文",
            },
        },
    }


__all__ = [
    "WebSearch",
    "SearchResult",
    "web_search",
    "get_web_search_tool_spec",
]
