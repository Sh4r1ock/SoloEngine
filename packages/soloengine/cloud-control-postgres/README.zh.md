---
description: "SoloEngine 云控制面的 PostgreSQL 仓库：在共享归属库上实现 ControlRepository，让多个网关副本看到同一批节点、租约与放置决定。"
kind: "package-reference"
---

# @soloengine/cloud-control-postgres

[English](README.md) | 中文

<a id="summary"></a>
## 概述

云控制面的 PostgreSQL 仓库。它在共享归属库上实现控制面的 `ControlRepository`，让多个网关副本看到同一批节点、租约与放置决定。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由云控制面组合；云形态使用 PostgreSQL 时由框架动态解析。

<a id="model-experience"></a>
## 模型体验

无，因为控制面仓库只持久化放置状态，不注册任何模型可见内容。

#### KV Cache 影响

无影响：持久化的放置状态不是模型输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- schema 变更必须在启动期待新列的 control plane 之前应用。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
