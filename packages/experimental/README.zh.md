---
description: "会话检索与持久终端工具的预发布原型。"
kind: "package-group"
---

# experimental/：预发布原型

[English](README.md) | 中文

## 概述

本组的包提供仍处于评估中的完整公开契约：行为或 API 可能变化，能力也可能被撤回。工程、安全、文档、测试与已发布数据方面的义务仍然适用。本组之外的发布包与应用不得依赖这些包（[策略](../../scripts/experimental-package-policy.ts)）。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`tool-session-query`](tool-session-query/README.zh.md) | 受工作区授权的模型会话搜索、追踪与事件读取 | — |
| [`tool-terminal`](tool-terminal/README.zh.md) | 持久终端工具 | — |

<a id="related-documentation"></a>
## 相关文档

- [会话查询子系统](../../docs/subsystems/session-query.zh.md)——这些工具投影的检索服务。
- [终端子系统](../../docs/subsystems/terminal.zh.md)——按所有者隔离的持久 PTY 会话。
- [实验包策略](../../scripts/experimental-package-policy.ts)——发布默认值与私有例外。

<a id="dev-note"></a>
## 开发备注

无。
