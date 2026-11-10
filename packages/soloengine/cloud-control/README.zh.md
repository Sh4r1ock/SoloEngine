---
description: "SoloEngine 云 Agent 控制面：节点注册与健康采集、p2c 会话放置、会话租约与 epoch 写围栏。"
kind: "package-reference"
---

# @soloengine/cloud-control

[English](README.md) | 中文

<a id="summary"></a>
## 概述

云 Agent 控制面：节点注册与健康采集、p2c 会话放置、会话租约与 epoch 写围栏。它是「会话路由到哪个节点」与「旧写者何时停止」的共享权威。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

网关与云节点运行时调用它；租约决定之后由节点的会话持久化写围栏执行。

同时设置 `SOLOENGINE_KEYS_DIR` 与 `SOLOENGINE_DATABASE_URL` 时，网关还承担会话归属校验：用部署主密钥校验账号访问令牌，并从共享业务库读 `sessions.user_id`。只设置其中一项会阻断启动，不进入半开状态。

设置 `SOLOENGINE_QUOTA_MAX_ACTIVE` 时，每用户并发会话上限在放置与租约获取两处都执行；节点直连收到运行请求也不能绕过共享配额。

<a id="model-experience"></a>
## 模型体验

无，因为控制面只管理节点、放置、租约与配额，不注册任何模型可见内容。

#### KV Cache 影响

无影响：放置与租约状态不会进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 多节点部署要求共享仓库（PostgreSQL）；内存实现只支持单节点。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
