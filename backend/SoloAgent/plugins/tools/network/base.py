# -*- coding: utf-8 -*-
"""
网络工具基类模块。

@file base.py
@description 提供网络工具的公共功能和基础类
@author SoloEngine Team
@date 2026-03-02

功能描述：
- HTTP 客户端管理
- 超时处理
- 错误处理
- 响应解析

使用场景：
- WebSearch: 网络搜索工具基类
- WebFetch: 网页获取工具基类
"""

import httpx
from typing import Dict, Any, Optional, Union
from dataclasses import dataclass


class NetworkToolError(Exception):
    """
    网络工具错误基类。
    
    所有网络工具相关的异常都继承此类。
    
    Attributes:
        message (str): 错误信息
        status_code (Optional[int]): HTTP 状态码
        url (Optional[str]): 请求的 URL
    
    Example:
        >>> raise NetworkToolError("请求超时", url="https://example.com")
    """
    
    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        url: Optional[str] = None,
    ) -> None:
        """
        初始化网络工具错误。
        
        Args:
            message (str): 错误信息。
            status_code (Optional[int], optional): HTTP 状态码。默认为 None。
            url (Optional[str], optional): 请求的 URL。默认为 None。
        """
        self.message = message
        self.status_code = status_code
        self.url = url
        super().__init__(self.message)
    
    def __str__(self) -> str:
        """返回错误字符串表示。"""
        parts = [self.message]
        if self.status_code:
            parts.append(f"状态码: {self.status_code}")
        if self.url:
            parts.append(f"URL: {self.url}")
        return " | ".join(parts)


@dataclass
class NetworkResponse:
    """
    网络响应数据类。
    
    封装 HTTP 响应的标准化数据结构。
    
    Attributes:
        content (str): 响应内容
        status_code (int): HTTP 状态码
        success (bool): 是否成功
        error_message (Optional[str]): 错误信息
        headers (Dict[str, str]): 响应头
        url (str): 请求的 URL
    
    Example:
        >>> response = NetworkResponse(
        ...     content="页面内容",
        ...     status_code=200,
        ...     success=True,
        ...     url="https://example.com"
        ... )
    """
    content: str
    status_code: int
    success: bool = True
    error_message: Optional[str] = None
    headers: Dict[str, str] = None
    url: str = ""
    
    def __post_init__(self):
        if self.headers is None:
            self.headers = {}
    
    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典格式。
        
        Returns:
            Dict[str, Any]: 包含所有属性的字典。
        """
        return {
            "content": self.content,
            "status_code": self.status_code,
            "success": self.success,
            "error_message": self.error_message,
            "headers": self.headers,
            "url": self.url,
        }


class BaseNetworkTool:
    """
    网络工具基类。
    
    提供网络请求的公共功能，包括 HTTP 客户端管理、
    超时处理、错误处理等。
    
    Attributes:
        DEFAULT_TIMEOUT (int): 默认超时时间（秒）
        DEFAULT_HEADERS (Dict[str, str]): 默认请求头
    
    Example:
        >>> class MyNetworkTool(BaseNetworkTool):
        ...     async def fetch_data(self, url: str) -> NetworkResponse:
        ...         return await self._fetch(url)
    """
    
    DEFAULT_TIMEOUT = 30
    DEFAULT_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    
    def __init__(
        self,
        timeout: int = DEFAULT_TIMEOUT,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        初始化网络工具。
        
        Args:
            timeout (int, optional): 超时时间（秒）。默认为 30。
            headers (Optional[Dict[str, str]], optional): 自定义请求头。
                会与默认请求头合并。默认为 None。
        """
        self.timeout = timeout
        self.headers = {**self.DEFAULT_HEADERS, **(headers or {})}
    
    async def _fetch(
        self,
        url: str,
        method: str = "GET",
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None,
        follow_redirects: bool = True,
    ) -> NetworkResponse:
        """
        通用 HTTP 请求方法。
        
        执行 HTTP 请求并返回标准化的响应对象。
        
        Args:
            url (str): 请求 URL。
            method (str, optional): HTTP 方法。默认为 "GET"。
            params (Optional[Dict[str, Any]], optional): URL 参数。默认为 None。
            data (Optional[Dict[str, Any]], optional): 表单数据。默认为 None。
            json (Optional[Dict[str, Any]], optional): JSON 数据。默认为 None。
            headers (Optional[Dict[str, str]], optional): 额外请求头。默认为 None。
            timeout (Optional[int], optional): 超时时间。默认为 None。
            follow_redirects (bool, optional): 是否跟随重定向。默认为 True。
        
        Returns:
            NetworkResponse: 标准化的响应对象。
        
        Raises:
            NetworkToolError: 当请求失败时抛出。
        
        Example:
            >>> response = await self._fetch(
            ...     "https://api.example.com/data",
            ...     params={"page": 1},
            ...     headers={"Authorization": "Bearer token"}
            ... )
        """
        request_headers = {**self.headers, **(headers or {})}
        request_timeout = timeout or self.timeout
        
        try:
            async with httpx.AsyncClient(timeout=request_timeout) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params,
                    data=data,
                    json=json,
                    headers=request_headers,
                    follow_redirects=follow_redirects,
                )
                
                return NetworkResponse(
                    content=response.text,
                    status_code=response.status_code,
                    success=response.is_success,
                    error_message=None if response.is_success else f"HTTP {response.status_code}",
                    headers=dict(response.headers),
                    url=str(response.url),
                )
                
        except httpx.TimeoutException as e:
            return NetworkResponse(
                content="",
                status_code=0,
                success=False,
                error_message=f"请求超时: {str(e)}",
                url=url,
            )
        except httpx.NetworkError as e:
            return NetworkResponse(
                content="",
                status_code=0,
                success=False,
                error_message=f"网络错误: {str(e)}",
                url=url,
            )
        except Exception as e:
            return NetworkResponse(
                content="",
                status_code=0,
                success=False,
                error_message=f"未知错误: {str(e)}",
                url=url,
            )
    
    async def _fetch_bytes(
        self,
        url: str,
        timeout: Optional[int] = None,
    ) -> tuple[bytes, int, bool]:
        """
        获取二进制内容。
        
        用于下载文件或图片等二进制数据。
        
        Args:
            url (str): 请求 URL。
            timeout (Optional[int], optional): 超时时间。默认为 None。
        
        Returns:
            tuple[bytes, int, bool]: (二进制内容, 状态码, 是否成功)
        """
        request_timeout = timeout or self.timeout
        
        try:
            async with httpx.AsyncClient(timeout=request_timeout) as client:
                response = await client.get(url, headers=self.headers, follow_redirects=True)
                return response.content, response.status_code, response.is_success
        except Exception:
            return b"", 0, False


__all__ = [
    "NetworkToolError",
    "NetworkResponse",
    "BaseNetworkTool",
]
