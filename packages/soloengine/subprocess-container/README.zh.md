---
description: "SoloEngine 的按会话执行世界子进程提供方：shell 命令在该会话的容器（docker exec）或全 VM（ssh）里执行，工作区映射到 /workspace。"
kind: "package-reference"
---

# @soloengine/subprocess-container

[English](README.md) | 中文

<a id="summary"></a>
## 概述

按会话的执行世界子进程提供方。shell 命令在会话容器（`docker exec`）或全 VM（`ssh`）中执行，工作区映射到 `/workspace`；没有会话路由的命令继续在宿主执行，以保留诊断能力。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

云容器形态（`SOLOENGINE_EXECUTOR=container|microvm`）或全 VM 形态（`full-vm`）用它替换 `@deepseek-ai/dsh-subprocess-local`；shell 工具仍经 subprocess seam，不需改动。全 VM 形态下，`vmStateDir` / `vmSshKey` / `vmSshUser` 让终端请求从节点状态文件读取每会话的 SSH 路由。

<a id="model-experience"></a>
## 模型体验

无，因为按会话子进程提供方只路由命令，模型呈现由 shell 工具拥有。

#### KV Cache 影响

无影响：命令路由不是请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 未开启 `requireSessionRoute` 时，缺少会话路由会静默退回宿主进程；容器与全 VM 形态在启动时开启该守卫。
- 容器与全 VM 执行世界互斥：配置了 `vmStateDir` 时不再启用容器终端兜底。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
