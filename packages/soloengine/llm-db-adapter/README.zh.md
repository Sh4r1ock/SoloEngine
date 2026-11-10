---
description: "SoloEngine 模型路由适配器：每条启用中的模型配置暴露为一条 soloengine-<id> 路由，执行时取已解密密钥与地址。"
kind: "package-reference"
---

# @soloengine/llm-db-adapter

[English](README.md) | 中文

<a id="summary"></a>
## 概述

模型路由适配器：每条启用中的管理端模型配置变成一条 `soloengine-<id>` 路由，执行时解析已解密密钥与 base URL。秒级轮询发现变更并整体替换路由集合。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

挂在产品 profile 中；画布编译器与运行驱动按 id 引用路由，适配器让它们与管理表保持同步。

<a id="model-experience"></a>
## 模型体验

间接地，经它注册的模型路由生效；请求组装与被选中的模型拥有模型可见请求。

#### KV Cache 影响

无影响：适配器只选择 provider 与凭据，不改变提示词内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 路由可用性跟随管理端配置；行被停用或删除后路由消失，下一次请求 fail loud。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
