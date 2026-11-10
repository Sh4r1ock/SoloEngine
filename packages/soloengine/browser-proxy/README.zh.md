---
description: "SoloEngine 运行面板的 Host 面同源浏览器代理：catch-all 转发 HTTP/WebSocket、重写 Location 与 HTML、剔除逐跳头、五条 SSRF 防线。"
kind: "package-reference"
---

# @soloengine/browser-proxy

[English](README.md) | 中文

<a id="summary"></a>
## 概述

运行面板的 Host 面同源浏览器代理：catch-all 路由转发 HTTP 与 WebSocket 流量，重写 `Location` 与 HTML，剔除逐跳头，并通过五条检查阻断 SSRF。浏览器页签只看到一个源；代理是唯一的网络边缘。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由 `@soloengine/host` 挂在同一条 Web 服务上；运行面板页签使用 `/soloengine/proxy` 与 `/soloengine/proxy-ws`。

<a id="model-experience"></a>
## 模型体验

无，因为 Host 代理只转发浏览器流量，不注册任何模型可见内容。

#### KV Cache 影响

无影响：被代理的页面不会进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 代理是运维面而非沙箱：它执行同源与 SSRF 规则，但不隔离浏览器里的任意页面脚本。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
