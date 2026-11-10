---
description: "SoloEngine 的 PostgreSQL 键值后端：注册为 storage 后端 postgres，与 SQLite 后端同契约、可单独替换。"
kind: "package-reference"
---

# @soloengine/storage-postgres

[English](README.md) | 中文

<a id="summary"></a>
## 概述

原生 storage 服务的 PostgreSQL 键值后端，注册名为 `postgres`。它把调用方提供的单元存进共享 `kv` schema，可在不改消费方的情况下换成 SQLite 或 JSON 后端。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由云形态插入，并通过 `storage-domain` 的 `backend: postgres` 选择。

<a id="model-experience"></a>
## 模型体验

无，因为键值后端只存储调用方提供的单元，不注册任何模型可见内容。

#### KV Cache 影响

无影响：存储的单元本身不是请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 一个后端写入的单元不会迁移到另一个后端；替换后端从空命名空间开始。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
