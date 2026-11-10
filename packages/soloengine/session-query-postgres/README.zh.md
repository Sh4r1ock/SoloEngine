---
description: "SoloEngine 的 PostgreSQL 会话检索后端：在同一个 PG 库的 search schema 里维护可丢弃派生索引。"
kind: "package-reference"
---

# @soloengine/session-query-postgres

[English](README.md) | 中文

<a id="summary"></a>
## 概述

PostgreSQL 会话检索后端：在共享 `search` schema 中维护可丢弃的 FTS 索引，并实现原生 `sessionQuery` 契约。替换组合行即可换回 SQLite 或原版后端。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由云形态插入，并在同一覆盖层停用原生 SQLite 检索行。

<a id="model-experience"></a>
## 模型体验

无，因为检索后端只索引已记录的事件，并把命中返回给调用方。

#### KV Cache 影响

无影响：被索引的文本早已属于此前请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 索引是派生物且可丢弃；切换后端会重建索引，不迁移旧索引。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
