---
description: "SoloEngine 业务库端口的可选 PostgreSQL 实现：同一批 14 张管理表、共享 schema_versions，框架核心不依赖 pg。"
kind: "package-reference"
---

# @soloengine/business-db-postgres

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 业务库端口的可选 PostgreSQL 实现。它在一个 PG schema 里创建同样的十四张管理表，把版本写入共享 `schema_versions`，并让框架核心不依赖 `pg`。单机形态使用 SQLite 实现。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由 `SOLOENGINE_DB_FORM=cloud` 选择；框架动态导入它，因此单机形态永不加载 `pg`。

<a id="model-experience"></a>
## 模型体验

无，因为业务库适配器只存管理行，不注册任何模型可见内容。

#### KV Cache 影响

无影响：管理行不属于模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- PostgreSQL DDL 是 SQLite schema 的手工副本；改列或约束时必须同时更新两边。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
