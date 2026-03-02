# -*- coding: utf-8 -*-
"""
网页获取工具模块。

@file web_fetch.py
@description 提供网页内容获取和 HTML 转 Markdown 功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 获取 URL 内容
- 将 HTML 转换为 Markdown
- 移除脚本、样式、导航、页脚等无关内容
- 支持内容截断

使用场景：
- 获取网页详细内容
- 分析网页结构
- 提取网页文本

状态: ✅ 完整实现
"""

import re
from typing import Dict, Any, Optional
from html.parser import HTMLParser

from .base import BaseNetworkTool, NetworkResponse, NetworkToolError


class HTMLToMarkdownConverter(HTMLParser):
    """
    HTML 转 Markdown 转换器。
    
    将 HTML 内容转换为 Markdown 格式，移除脚本、样式等无关内容。
    
    Attributes:
        result (str): 转换结果
        in_script (bool): 是否在 script 标签内
        in_style (bool): 是否在 style 标签内
        in_nav (bool): 是否在 nav 标签内
        in_footer (bool): 是否在 footer 标签内
        in_header (bool): 是否在 header 标签内
        skip_tags (set): 需要跳过的标签集合
    
    Example:
        >>> converter = HTMLToMarkdownConverter()
        >>> markdown = converter.convert("<h1>Title</h1><p>Content</p>")
    """
    
    SKIP_TAGS = {"script", "style", "nav", "footer", "header", "aside", "noscript"}
    
    def __init__(self) -> None:
        """初始化转换器。"""
        super().__init__()
        self.result = ""
        self.skip_depth = 0
        self.current_skip_tag = None
        self.list_depth = 0
        self.in_pre = False
        self.in_code = False
        self.in_blockquote = False
        self.pending_newlines = 0
        self.current_href = None
    
    def convert(self, html: str) -> str:
        """
        转换 HTML 为 Markdown。
        
        Args:
            html (str): HTML 内容。
        
        Returns:
            str: Markdown 内容。
        """
        self.result = ""
        self.skip_depth = 0
        self.current_skip_tag = None
        self.list_depth = 0
        self.in_pre = False
        self.in_code = False
        self.in_blockquote = False
        self.pending_newlines = 0
        self.current_href = None
        
        try:
            self.feed(html)
        except Exception:
            pass
        
        result = self._clean_result(self.result)
        return result
    
    def _clean_result(self, text: str) -> str:
        """
        清理转换结果。
        
        Args:
            text (str): 原始结果。
        
        Returns:
            str: 清理后的结果。
        """
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r" {2,}", " ", text)
        text = text.strip()
        return text
    
    def _add_text(self, text: str) -> None:
        """添加文本到结果。"""
        if self.skip_depth > 0:
            return
        self.result += text
    
    def _add_newlines(self, count: int = 1) -> None:
        """添加换行。"""
        if self.skip_depth > 0:
            return
        self.pending_newlines = max(self.pending_newlines, count)
    
    def _flush_newlines(self) -> None:
        """刷新待处理的换行。"""
        if self.pending_newlines > 0:
            self.result += "\n" * self.pending_newlines
            self.pending_newlines = 0
    
    def handle_starttag(self, tag: str, attrs: list) -> None:
        """处理开始标签。"""
        tag = tag.lower()
        attrs_dict = dict(attrs)
        
        if tag in self.SKIP_TAGS:
            if self.skip_depth == 0:
                self.current_skip_tag = tag
            self.skip_depth += 1
            return
        
        if self.skip_depth > 0:
            return
        
        self._flush_newlines()
        
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self._add_text("\n" + "#" * level + " ")
            self._add_newlines(1)
        
        elif tag == "p":
            self._add_newlines(2)
        
        elif tag == "br":
            self._add_text("\n")
        
        elif tag == "hr":
            self._add_text("\n---\n")
        
        elif tag in ("strong", "b"):
            self._add_text("**")
        
        elif tag in ("em", "i"):
            self._add_text("*")
        
        elif tag == "code":
            self.in_code = True
            if not self.in_pre:
                self._add_text("`")
        
        elif tag == "pre":
            self.in_pre = True
            self._add_text("\n```\n")
        
        elif tag == "blockquote":
            self.in_blockquote = True
            self._add_text("\n> ")
        
        elif tag == "a":
            self.current_href = attrs_dict.get("href", "")
            self._add_text("[")
        
        elif tag == "img":
            alt = attrs_dict.get("alt", "")
            src = attrs_dict.get("src", "")
            self._add_text(f"![{alt}]({src})")
        
        elif tag in ("ul", "ol"):
            self.list_depth += 1
            self._add_newlines(1)
        
        elif tag == "li":
            indent = "  " * (self.list_depth - 1)
            self._add_text(f"\n{indent}- ")
        
        elif tag == "div":
            self._add_newlines(1)
        
        elif tag == "span":
            pass
        
        elif tag == "table":
            self._add_text("\n")
        
        elif tag == "tr":
            self._add_text("|")
        
        elif tag in ("td", "th"):
            self._add_text(" ")
    
    def handle_endtag(self, tag: str) -> None:
        """处理结束标签。"""
        tag = tag.lower()
        
        if tag in self.SKIP_TAGS:
            self.skip_depth -= 1
            if self.skip_depth == 0:
                self.current_skip_tag = None
            return
        
        if self.skip_depth > 0:
            return
        
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._add_newlines(2)
        
        elif tag == "p":
            self._add_newlines(2)
        
        elif tag in ("strong", "b"):
            self._add_text("**")
        
        elif tag in ("em", "i"):
            self._add_text("*")
        
        elif tag == "code":
            self.in_code = False
            if not self.in_pre:
                self._add_text("`")
        
        elif tag == "pre":
            self.in_pre = False
            self._add_text("\n```\n")
        
        elif tag == "blockquote":
            self.in_blockquote = False
            self._add_newlines(1)
        
        elif tag == "a":
            if self.current_href:
                self._add_text(f"]({self.current_href})")
            else:
                self._add_text("](#)")
            self.current_href = None
        
        elif tag in ("ul", "ol"):
            self.list_depth -= 1
            self._add_newlines(1)
        
        elif tag == "li":
            pass
        
        elif tag in ("td", "th"):
            self._add_text(" |")
    
    def handle_data(self, data: str) -> None:
        """处理文本数据。"""
        if self.skip_depth > 0:
            return
        
        if self.in_pre:
            self._add_text(data)
        else:
            text = data.replace("\n", " ").replace("\r", "")
            text = re.sub(r"\s+", " ", text)
            if text.strip():
                self._flush_newlines()
                self._add_text(text)


class WebFetch(BaseNetworkTool):
    """
    网页获取工具。
    
    获取 URL 内容并将其转换为 Markdown 格式。
    自动移除脚本、样式、导航、页脚等无关内容。
    
    Attributes:
        max_content_length (int): 最大内容长度（字符数）
    
    Example:
        >>> fetcher = WebFetch()
        >>> markdown = await fetcher.fetch("https://example.com")
        >>> print(markdown[:500])
    """
    
    def __init__(
        self,
        timeout: int = 30,
        max_content_length: int = 10000,
    ) -> None:
        """
        初始化网页获取工具。
        
        Args:
            timeout (int, optional): 请求超时时间（秒）。默认为 30。
            max_content_length (int, optional): 最大内容长度（字符数）。
                默认为 10000。
        """
        super().__init__(timeout=timeout)
        self.max_content_length = max_content_length
        self._converter = HTMLToMarkdownConverter()
    
    async def fetch(
        self,
        url: str,
        max_length: Optional[int] = None,
    ) -> str:
        """
        获取 URL 内容并转换为 Markdown。
        
        Args:
            url (str): 要获取的 URL。
            max_length (Optional[int], optional): 最大内容长度。
                默认使用 max_content_length。
        
        Returns:
            str: Markdown 格式的内容。
        
        Raises:
            NetworkToolError: 当获取失败时抛出。
        
        Example:
            >>> content = await fetcher.fetch("https://example.com")
        """
        response = await self._fetch(url)
        
        if not response.success:
            raise NetworkToolError(
                f"获取网页失败: {response.error_message}",
                status_code=response.status_code,
                url=url,
            )
        
        content_type = response.headers.get("content-type", "")
        
        if "text/html" in content_type or "<!DOCTYPE" in response.content[:100].lower():
            markdown = self._converter.convert(response.content)
        else:
            markdown = response.content
        
        max_len = max_length or self.max_content_length
        if len(markdown) > max_len:
            markdown = markdown[:max_len] + "\n\n... [内容已截断]"
        
        return markdown
    
    async def fetch_raw(self, url: str) -> str:
        """
        获取 URL 原始内容（不转换）。
        
        Args:
            url (str): 要获取的 URL。
        
        Returns:
            str: 原始内容。
        """
        response = await self._fetch(url)
        
        if not response.success:
            raise NetworkToolError(
                f"获取网页失败: {response.error_message}",
                status_code=response.status_code,
                url=url,
            )
        
        return response.content


async def web_fetch(url: str) -> Dict[str, Any]:
    """
    网页获取工具函数。
    
    获取 URL 内容并转换为 Markdown 格式。
    
    Args:
        url (str): 要获取的 URL。
    
    Returns:
        Dict[str, Any]: 包含获取结果的字典。
    
    Example:
        >>> result = await web_fetch("https://example.com")
        >>> print(result["content"])
    """
    fetcher = WebFetch()
    
    try:
        content = await fetcher.fetch(url)
        
        return {
            "content": content,
            "success": True,
            "url": url,
        }
        
    except NetworkToolError as e:
        return {
            "content": f"获取网页失败: {e.message}",
            "success": False,
            "error_message": e.message,
            "url": url,
        }
    except Exception as e:
        return {
            "content": f"获取网页出错: {str(e)}",
            "success": False,
            "error_message": str(e),
            "url": url,
        }


def get_web_fetch_tool_spec() -> Dict[str, Any]:
    """
    获取网页获取工具的规范定义。
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到工具执行器。
    """
    return {
        "name": "web_fetch",
        "function": web_fetch,
        "description": "获取 URL 内容并转换为 Markdown 格式。适用于获取网页详细内容进行分析。",
        "parameters": {
            "url": {
                "type": "string",
                "required": True,
                "description": "要获取的完整 URL",
            },
        },
    }


__all__ = [
    "WebFetch",
    "HTMLToMarkdownConverter",
    "web_fetch",
    "get_web_fetch_tool_spec",
]
