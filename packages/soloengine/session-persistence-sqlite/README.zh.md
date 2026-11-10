---
description: "SoloEngine 单机会话日志后端：把原生 sessionPersistence 契约存进业务库的 session_logs/session_log_events 两表。"
kind: "package-reference"
---

# @soloengine/session-persistence-sqlite

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 单机形态的 SQLite 会话日志后端。它实现原生 `ctx.sessionPersistence` 契约（追加、连续 seq、单写者、惰性物化与持久化屏障），把日志写进业务库的 `session_logs` 与 `session_log_events` 两表，并把版本记入共享 `schema_versions`。原版 JSONL 插件仍随包安装，换回组合行即可恢复。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

用它替换 `@deepseek-ai/dsh-session-persistence-jsonl`，把 `path` 指向 `SOLOENGINE_DB`。单机覆盖层停用 JSONL 行并插入本插件；云形态改用 `@soloengine/session-persistence-postgres`。事件按 `(session_id, seq)` 追加、永不改写；创建但未写入的会话在本进程可见，关闭即消失，与上游后端一致。

<a id="model-experience"></a>
## 模型体验

无，因为该后端只存储调用方提供的会话事件，不注册任何提示词、工具、schema 或模型可见事件。

#### KV Cache 影响

无影响：该后端只改变已组装日志的存放位置，不改变请求内容或顺序。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 该后端把表放在业务 SQLite 文件里；切换到 JSONL 或 PostgreSQL 不会迁移已有日志，因为两种介质按设计彼此独立且需求禁止迁移工具。
- 表名使用 `session_logs` 与 `session_log_events` 而不是 `sessions`/`events`，因为 SQLite 没有 schema 分区，业务归属表已经占用了那两个名字。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
