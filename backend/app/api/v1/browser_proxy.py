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

import ipaddress
import logging
import re
import socket
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from app.core.auth import User
from app.api.v1.auth import get_current_user

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


def _is_forbidden_target(host: str) -> bool:
    """判断目标 host 是否属于禁止代理的内网/回环/链路本地地址（SSRF 防护）。

    支持 IPv4 / IPv6 与 host:port 携带端口的形式；域名先 DNS 解析再校验，
    解析失败一律视为禁止。禁止范围：回环（127.0.0.1 / ::1）、链路本地
    （169.254.x.x / fe80::）、私网（10.x / 172.16-31.x / 192.168.x / fc00::）、
    未指定地址（0.0.0.0 / ::）等内网可达目标。
    """
    hostname = host
    if hostname.startswith("["):
        # IPv6 字面量形式：[::1]:8080
        bracket_end = hostname.find("]")
        if bracket_end != -1:
            hostname = hostname[1:bracket_end]
    elif hostname.count(":") == 1:
        # host:port 形式（如 127.0.0.1:6379 / localhost:3000）
        hostname = hostname.partition(":")[0]

    hostname = hostname.strip().lower().rstrip(".")
    if not hostname:
        return True

    # 域名先解析；解析失败拒绝
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError:
        return True

    addresses = {info[4][0] for info in infos}
    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_unspecified
            or ip.is_multicast
            or ip.is_reserved
        ):
            return True
    return False


def rewrite_to_proxy_url(url: str, origin: str) -> str:
    """把绝对 URL 重写为同源代理 URL（用于 Location 头与 HTML 属性）。"""
    if not (url.startswith("http://") or url.startswith("https://")):
        return url
    u = urlparse(url)
    return f"{origin}{PROXY_PREFIX}{u.scheme}/{u.netloc}{u.path}{('?' + u.query) if u.query else ''}"


def rewrite_html_links(html: bytes, scheme: str, host: str, origin: str) -> bytes:
    """重写 HTML 中指向目标主机的链接（绝对 URL + 根相对路径），并注入代理桥接脚本。

    绝对 URL（https?://{host}/...）与根相对路径（/xxx）都重写为同源代理地址，
    避免 iframe 内部请求跳出代理空间；同时注入脚本拦截 fetch/XHR 的动态根相对
    路径请求（如 JS 内 fetch('/api/...')），保证动态请求同样走代理。

    - 仅重写与目标主机同源的绝对 URL；相对链接由浏览器基于 iframe 代理地址自动解析。
    - 根相对路径（/xxx）语义上指向目标主机（文档所在主机），重写为代理 URL。
    - 排除 // 协议相对 URL（指向其他源）与 # 锚点（页内跳转）。
    """
    text = html.decode("utf-8", errors="replace")

    # 1. 绝对 URL：仅重写指向目标主机的绝对链接（href/src/action）
    def _replace_abs(match: "re.Match[str]") -> str:
        attr, quote, url = match.group(1), match.group(2), match.group(3)
        u = urlparse(url)
        if u.netloc == host:
            return f"{attr}={quote}{rewrite_to_proxy_url(url, origin)}"
        return match.group(0)

    pattern_abs = re.compile(r'(href|src|action)\s*=\s*("|\')(https?://[^\s"\'<>]+)', re.IGNORECASE)
    text = re.sub(pattern_abs, _replace_abs, text)

    # 2. 根相对路径（/xxx）：重写为代理 URL（排除 // 协议相对）
    pattern_root = re.compile(r'(href|src|action)\s*=\s*("|\')(/[^/][^\s"\'<>]*)', re.IGNORECASE)

    def _replace_root(match: "re.Match[str]") -> str:
        attr, quote, path = match.group(1), match.group(2), match.group(3)
        return f'{attr}={quote}{origin}{PROXY_PREFIX}{scheme}/{host}{path}'

    text = re.sub(pattern_root, _replace_root, text)

    # 3. 注入代理桥接脚本：拦截 fetch/XHR 的根相对路径请求（JS 动态 URL 无法静态重写）。
    #    页面脚本通过 XHR/fetch 请求 '/openapi.json' 之类路径时，基于 iframe 代理地址
    #    会解析到代理服务器自身（Vite），返回 HTML 而非目标站点资源；拦截后补上代理前缀。
    bridge = (
        "<script>"
        "(function(){"
        f"var P='{origin}{PROXY_PREFIX}{scheme}/{host}';"
        "var isR=function(u){return typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf(P)!==0;};"
        "var f=window.fetch;window.fetch=function(i,o){if(isR(i)){i=P+i;}return f.call(this,i,o);};"
        "var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(isR(u)){arguments[1]=P+u;}return x.apply(this,arguments);};"
        "})();"
        "</script>"
    )
    # 插入到 <head> 之后（保证在页面脚本执行前生效）；无 head 时插到 <html> 后或文档开头
    m_head = re.search(r"<head[^>]*>", text, re.IGNORECASE)
    if m_head:
        text = text[: m_head.end()] + bridge + text[m_head.end():]
    else:
        m_html = re.search(r"<html[^>]*>", text, re.IGNORECASE)
        if m_html:
            text = text[: m_html.end()] + bridge + text[m_html.end():]
        else:
            text = bridge + text

    return text.encode("utf-8")


async def _forward(request: Request, path: str):
    """代理核心：解析目标地址 -> httpx 转发 -> 重写响应头/内容 -> 返回。"""
    parsed = parse_proxy_path(path)
    if not parsed:
        return JSONResponse(status_code=400, content={"detail": f"invalid browser-proxy path: {path}"})

    scheme, host, path_part = parsed

    # 安全校验：scheme 白名单，仅允许 http/https（拒绝 ws/wss/file 等）
    if scheme not in ("http", "https"):
        return JSONResponse(status_code=403, content={"detail": f"forbidden scheme: {scheme}"})

    # 安全校验：拒绝内网/回环/链路本地等目标（SSRF 防护）
    if _is_forbidden_target(host):
        return JSONResponse(status_code=403, content={"detail": f"forbidden target: {host}"})

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
        content = rewrite_html_links(content, scheme, host, origin)

    return Response(content=content, status_code=upstream.status_code, headers=resp_headers)


@router.api_route(
    "/browser-proxy/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def browser_proxy(
    request: Request,
    path: str,
    current_user: User = Depends(get_current_user),
):
    """浏览器面板 iframe 同源代理端点。"""
    return await _forward(request, path)
