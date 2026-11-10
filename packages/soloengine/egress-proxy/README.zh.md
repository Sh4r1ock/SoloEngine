---
description: "SoloEngine 每会话出口代理资产：在会话网络命名空间内运行的 HTTP CONNECT/SOCKS5/DNS 脚本与资产定位入口。"
kind: "package-reference"
---

# @soloengine/egress-proxy

[English](README.md) | 中文

<a id="summary"></a>
## 概述

每会话出口代理资产：运行在会话网络命名空间内的 HTTP CONNECT、SOCKS5 与 DNS 脚本，以及容器执行器挂载用的资产定位入口。它把出站流量限制在会话策略内。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

容器执行器把这些资产挂进会话网络命名空间；本机执行器不使用它们。

<a id="model-experience"></a>
## 模型体验

无，因为出口代理只限制网络流量，不注册任何模型可见内容。

#### KV Cache 影响

无影响：被代理的字节不会进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 脚本假定 Linux 网络命名空间，本机单机执行器不验证它们。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
