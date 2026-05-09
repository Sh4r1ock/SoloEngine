# -*- coding: utf-8 -*-
"""
网络搜索工具模块。

@file web_search.py
@description 提供网络搜索功能，支持多种搜索引擎
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 支持多种搜索引擎（DuckDuckGo、Bing、Tavily、Serper）
- DuckDuckGo 和 Bing 通过 HTML 页面爬取实现，免费免 API Key
- Tavily 和 Serper 需配置 API Key，提供更高质量结果
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
import re
from html import unescape
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
    
    支持多种搜索引擎的网络搜索工具。
    
    支持的搜索引擎：
        - bing: 默认，通过 HTML 页面爬取实现（免费，无需 API Key）
        - duckduckgo: 通过 HTML 页面爬取实现（免费，部分区域可能不可用）
        - tavily: 需要 TAVILY_API_KEY（结果质量高，适合 AI）
        - serper: 需要 SERPER_API_KEY（Google 搜索结果）
    
    Attributes:
        api_keys (Dict[str, str]): 各搜索引擎的 API key
    
    Example:
        >>> search = WebSearch()
        >>> results = await search.search("Python asyncio", num=5)
        >>> for result in results:
        ...     print(result.title, result.url)
    """
    
    DUCKDUCKGO_URL = "https://html.duckduckgo.com/html/"
    BING_URL = "https://www.bing.com/search"
    TAVILY_API = "https://api.tavily.com/search"
    SERPER_API = "https://google.serper.dev/search"
    
    def __init__(
        self,
        timeout: int = 25,
        api_keys: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        初始化搜索工具。
        
        Args:
            timeout (int, optional): 请求超时时间（秒）。默认为 25。
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
        engine: str = "bing",
    ) -> List[SearchResult]:
        """
        执行网络搜索。
        
        根据指定的搜索引擎执行搜索并返回结果列表。
        
        Args:
            query (str): 搜索查询字符串。
            num (int, optional): 最大返回结果数量。默认为 5。
            lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
                默认为 None（DuckDuckGo/Bing 页面爬取目前不支持 lr 过滤）。
            engine (str, optional): 搜索引擎。
                可选 "duckduckgo"、"bing"、"tavily"、"serper"。
                默认为 "bing"。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        
        Raises:
            NetworkToolError: 当搜索失败时抛出。
        
        Example:
            >>> results = await search.search("Python 教程", num=3, lr="lang_zh-CN")
        """
        if engine == "duckduckgo":
            return await self._search_duckduckgo(query, num, lr)
        elif engine == "bing":
            return await self._search_bing(query, num, lr)
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
        
        通过爬取 DuckDuckGo HTML 搜索结果页面实现，免费免 API Key。
        解析 .result__a（标题+链接）、.result__snippet（摘要）结构。
        
        Args:
            query (str): 搜索查询。
            num (int): 结果数量限制。
            lr (Optional[str]): 语言限制（HTML 爬取不支持此参数）。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        """
        params = {"q": query}
        
        response = await self._fetch(
            url=self.DUCKDUCKGO_URL,
            params=params,
        )
        
        if not response.success:
            raise NetworkToolError(
                f"DuckDuckGo 搜索失败: {response.error_message}",
                status_code=response.status_code,
                url=response.url,
            )
        
        html = response.content
        results: List[SearchResult] = []
        
        result_blocks = re.findall(
            r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            html,
            re.DOTALL,
        )
        
        snippets = re.findall(
            r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
            html,
            re.DOTALL,
        )
        
        count = min(len(result_blocks), len(snippets), num)
        
        for i in range(count):
            href = result_blocks[i][0]
            title_html = result_blocks[i][1]
            snippet_html = snippets[i] if i < len(snippets) else ""
            
            title = re.sub(r'<[^>]+>', '', unescape(title_html)).strip()
            snippet = re.sub(r'<[^>]+>', '', unescape(snippet_html)).strip()
            
            if title and href:
                results.append(SearchResult(
                    title=title[:200],
                    url=href,
                    content=snippet[:300],
                    source="duckduckgo",
                ))
        
        return results[:num]
    
    async def _search_bing(
        self,
        query: str,
        num: int,
        lr: Optional[str],
    ) -> List[SearchResult]:
        """
        使用 Bing 搜索。
        
        通过爬取 Bing HTML 搜索结果页面实现，免费免 API Key。
        解析 .b_algo > h2 > a（标题+链接）、.b_caption > p（摘要）结构。
        
        Args:
            query (str): 搜索查询。
            num (int): 结果数量限制。
            lr (Optional[str]): 语言限制，如 "lang_zh-CN"。
        
        Returns:
            List[SearchResult]: 搜索结果列表。
        """
        params = {"q": query}
        headers = {
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        
        if lr:
            lang_code = lr.replace("lang_", "")
            if lang_code.lower().startswith("zh"):
                params["cc"] = "cn"
                params["setlang"] = "zh-Hans"
            elif lang_code.lower().startswith("en"):
                params["setlang"] = "en"
            else:
                params["setlang"] = lang_code.split("-")[0] if "-" in lang_code else lang_code
        
        response = await self._fetch(
            url=self.BING_URL,
            params=params,
            headers=headers,
        )
        
        if not response.success:
            raise NetworkToolError(
                f"Bing 搜索失败: {response.error_message}",
                status_code=response.status_code,
                url=response.url,
            )
        
        html = response.content
        results: List[SearchResult] = []
        
        algo_blocks = re.findall(
            r'<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>(.*?)(?=<li[^>]*class="[^"]*b_algo[^"]*"|</ol>|$)',
            html,
            re.DOTALL,
        )
        
        for block in algo_blocks:
            if len(results) >= num:
                break
            
            link_match = re.search(
                r'<a[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>',
                block,
                re.DOTALL,
            )
            if not link_match:
                continue
            
            href = link_match.group(1)
            title = re.sub(r'<[^>]+>', '', unescape(link_match.group(2))).strip()
            title = re.split(r'(?=https?://)', title, maxsplit=1)[0].strip()
            
            caption_match = re.search(
                r'<p[^>]*>(.*?)</p>',
                block,
                re.DOTALL,
            )
            snippet = ""
            if caption_match:
                snippet = re.sub(r'<[^>]+>', '', unescape(caption_match.group(1))).strip()
            
            if title and href:
                results.append(SearchResult(
                    title=title[:200],
                    url=href,
                    content=snippet[:300],
                    source="bing",
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
    
    def _resource_url(self, query: str, engine: str) -> str:
        """根据引擎类型生成所使用的资源URL。"""
        engine_urls = {
            "duckduckgo": f"https://html.duckduckgo.com/html/?q={query}",
            "bing": f"https://www.bing.com/search?q={query}",
            "tavily": "https://api.tavily.com/search",
            "serper": "https://google.serper.dev/search",
        }
        return engine_urls.get(engine, f"https://html.duckduckgo.com/html/?q={query}")
    
    async def execute(
        self,
        query: str,
        num: int = 5,
        lr: Optional[str] = None,
        engine: str = "bing",
    ) -> Dict[str, Any]:
        """
        执行搜索（工具接口）。
        
        这是工具执行器调用的入口方法。
        
        Args:
            query (str): 搜索查询字符串。
            num (int, optional): 最大返回结果数量。默认为 5。
            lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
            engine (str, optional): 搜索引擎。
                可选 "duckduckgo"、"bing"、"tavily"、"serper"。
                默认为 "bing"。
        
        Returns:
            Dict[str, Any]: 包含搜索结果的字典。
        """
        try:
            results = await self.search(query, num=num, lr=lr, engine=engine)
            resource_url = self._resource_url(query, engine)
            
            if not results:
                return {
                    "content": f"未找到关于 '{query}' 的搜索结果。",
                    "success": True,
                    "results": [],
                    "metadata": {
                        "resources_used": [resource_url]
                    }
                }
            
            formatted = self.format_results(results)
            
            return {
                "content": formatted,
                "success": True,
                "results": [r.to_dict() for r in results],
                "metadata": {
                    "resources_used": [resource_url]
                }
            }
            
        except NetworkToolError as e:
            return {
                "content": f"搜索出错: {e.message}",
                "success": False,
                "error_message": e.message,
                "results": [],
                "metadata": {
                    "resources_used": [self._resource_url(query, engine)]
                }
            }
        except Exception as e:
            return {
                "content": f"搜索出错: {str(e)}",
                "success": False,
                "error_message": str(e),
                "results": [],
                "metadata": {
                    "resources_used": [self._resource_url(query, engine)]
                }
            }
    
    @property
    def spec(self) -> Dict[str, Any]:
        """工具规范"""
        return {
            "name": "web_search",
            "description": "在网络上搜索信息。免费免 API Key，默认使用 Bing 页面爬取。支持 DuckDuckGo、Bing、Tavily、Serper 多种引擎。适用于获取实时信息或搜索不了解的技术概念。",
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
                "engine": {
                    "type": "string",
                    "required": False,
                    "default": "bing",
                    "description": "搜索引擎：bing（默认，免费）、duckduckgo（免费）、tavily（需API Key）、serper（需API Key）",
                },
            },
        }


async def web_search(
    query: str,
    num: int = 5,
    lr: Optional[str] = None,
    engine: str = "bing",
) -> Dict[str, Any]:
    """
    网络搜索工具函数。
    
    默认使用 Bing HTML 页面爬取进行网络搜索（免费免 API Key）。
    
    Args:
        query (str): 搜索查询字符串。
        num (int, optional): 最大返回结果数量。默认为 5。
        lr (Optional[str], optional): 语言限制，如 "lang_zh-CN"。
        engine (str, optional): 搜索引擎。
            可选 "duckduckgo"、"bing"、"tavily"、"serper"。
            默认为 "bing"。
    
    Returns:
        Dict[str, Any]: 包含搜索结果的字典。
    
    Example:
        >>> result = await web_search("Python asyncio")
        >>> print(result["content"])
    """
    search_tool = WebSearch()
    
    try:
        results = await search_tool.search(query, num=num, lr=lr, engine=engine)
        
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
        "description": "在网络上搜索信息。免费免 API Key，默认使用 Bing 页面爬取。支持 DuckDuckGo、Bing、Tavily、Serper 多种引擎。适用于获取实时信息或搜索不了解的技术概念。",
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
            "engine": {
                "type": "string",
                "required": False,
                "default": "bing",
                "description": "搜索引擎：bing（默认，免费）、duckduckgo（免费）、tavily（需API Key）、serper（需API Key）",
            },
        },
    }


__all__ = [
    "WebSearch",
    "SearchResult",
    "web_search",
    "get_web_search_tool_spec",
]
