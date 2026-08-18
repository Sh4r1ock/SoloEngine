# -*- coding: utf-8 -*-
"""
SoloEngine : 浏览器预览代理模块

@file browser_proxy.py
@description 浏览器面板 iframe 同源代理 - 将 iframe 请求转发到目标站点
@author Sh4rlock
@date 2026-08-11

功能描述：
浏览器面板的 iframe 直接加载跨源站点时（如父页面 localhost:8991、预览站点
localhost:3000），父页面受浏览器同源策略限制，无法读取 iframe 内部的 URL 与
history，导致地址栏不更新、前进/后退按钮无效。

本模块提供 /browser-proxy/{path} 代理端点：前端将 iframe 的 src 改为同源代理
地址（/browser-proxy/{scheme}/{host}/{path}），后端用 httpx 把请求转发到目标
站点并原样返回响应，使 iframe 全程处于父页面同源地址空间，父页面即可：
  - 读取 iframe 的 contentWindow.location（同步地址栏）
  - 调用 iframe 的 contentWindow.history.back()/forward()（真实前进/后退）
  - 监听 iframe 内部 popstate/hashchange（内部导航实时同步）

依赖:
    - httpx: 异步 HTTP 客户端
    - fastapi: FastAPI 框架
"""

import logging
import re
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["browser_proxy"])

# 代理路径前缀（前端 BrowserPanel 与后端共用约定）：
# /browser-proxy/{scheme}/{host}{path}（如 /browser-proxy/http/localhost:3000/_db_read.py）
PROXY_PREFIX = "/browser-proxy/"

# 转发时需剔除的 hop-by-hop 头（不得透传）
_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "content-encoding",
}


def parse_proxy_path(path: str) -> Optional[Tuple[str, str, str]]:
    """解析代理路径。

    路径格式: {scheme}/{host}{path}（如 http/localhost:3000/_db_read.py）
    返回 (scheme, host, path)。
    """
    scheme, sep, rest = path.partition("/")
    if not sep or not scheme:
        return None
    host, _, path_part = rest.partition("/")
    if not host:
        return None
    return scheme, host, path_part


def rewrite_to_proxy_url(url: str, origin: str) -> str:
    """把绝对 URL 重写为同源代理 URL（用于 Location 头与 HTML 属性）。"""
    if not (url.startswith("http://") or url.startswith("https://")):
        return url
    u = urlparse(url)
    return f"{origin}{PROXY_PREFIX}{u.scheme}/{u.netloc}{u.path}{('?' + u.query) if u.query else ''}"


def rewrite_html_absolute_links(html: bytes, target_host: str, origin: str) -> bytes:
    """重写 HTML 中指向目标主机的绝对链接（href/src/action），避免 iframe 跳出代理。

    仅重写与目标主机同源的绝对 URL；相对链接由浏览器基于 iframe 代理地址自动解析，
    无需处理。JS 内部字符串不受影响（只匹配属性值）。
    """
    text = html.decode("utf-8", errors="replace")

    def _replace(match: "re.Match[str]") -> str:
        attr, quote, url = match.group(1), match.group(2), match.group(3)
        u = urlparse(url)
        if u.netloc == target_host:
            return f"{attr}={quote}{rewrite_to_proxy_url(url, origin)}"
        return match.group(0)

    pattern = re.compile(r'(href|src|action)\s*=\s*("|\')(https?://[^\s"\'<>]+)', re.IGNORECASE)
    rewritten = re.sub(pattern, _replace, text)
    if rewritten != text:
        return rewritten.encode("utf-8")
    return html


async def _forward(request: Request, path: str):
    """代理核心：解析目标地址 -> httpx 转发 -> 重写响应头/内容 -> 返回。"""
    parsed = parse_proxy_path(path)
    if not parsed:
        return JSONResponse(status_code=400, content={"detail": f"invalid browser-proxy path: {path}"})

    scheme, host, path_part = parsed
    target = f"{scheme}://{host}/{path_part}"
    if request.url.query:
        target += "?" + request.url.query

    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }
    # 请求解压内容，避免转发后 content-encoding 与实际内容不一致
    headers.pop("accept-encoding", None)
    headers["Accept-Encoding"] = "identity"

    body = await request.body() if request.method in ("POST", "PUT", "PATCH", "DELETE") else None

    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
            upstream = await client.request(request.method, target, headers=headers, content=body)
    except httpx.HTTPError as exc:
        logger.warning("[browser-proxy] upstream request failed: %s -> %s", target, exc)
        return JSONResponse(status_code=502, content={"detail": f"browser-proxy upstream error: {exc}"})

    resp_headers = {
        k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }

    location = upstream.headers.get("location")
    if location:
        origin = str(request.base_url).rstrip("/")
        resp_headers["location"] = rewrite_to_proxy_url(location, origin)

    content = upstream.content
    content_type = upstream.headers.get("content-type", "")
    if "text/html" in content_type:
        origin = str(request.base_url).rstrip("/")
        content = rewrite_html_absolute_links(content, host, origin)

    return Response(content=content, status_code=upstream.status_code, headers=resp_headers)


@router.api_route(
    "/browser-proxy/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def browser_proxy(request: Request, path: str):
    """浏览器面板 iframe 同源代理端点。"""
    return await _forward(request, path)
