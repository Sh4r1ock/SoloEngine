---
description: "SoloEngine 的 PostgreSQL 会话日志后端：把事件日志与头信息写进同一个 PG 库的 log schema。"
kind: "package-reference"
---

# @soloengine/session-persistence-postgres

[English](README.md) | 中文

<a id="summary"></a>
## 概述

PostgreSQL 会话日志后端：把事件追加到共享 PG 库的 `log.sessions`/`log.session_events`，头信息单独一行，并实现原生 `sessionPersistence` 契约。它是 SQLite 与 JSONL 后端的云形态兄弟。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

云形态用共享 `SOLOENGINE_DATABASE_URL` 插入它，并在同一覆盖层停用 JSONL 行。

配置了 `controlUrl` 与 `nodeId` 时，每个写句柄在打开时记下控制面的写者纪元，每次追加都校验 `(nodeId, epoch)`；会话已被接管（纪元更高）的旧句柄以 `SessionWriteFencedError` 围栏出局，不会写出第二份日志。

<a id="model-experience"></a>
## 模型体验

无，因为会话日志后端只存储调用方提供的事件，不注册任何模型可见内容。

#### KV Cache 影响

无影响：存储的事件由会话层重放，不由该后端进入请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 云形态要求 `SOLOENGINE_DATABASE_URL`；缺失即启动失败，不会退回本地文件。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
