---
description: "SoloEngine 容器沙箱提供方：把会话执行边界声明为每会话容器，无会话作用域的调用直接拒绝。"
kind: "package-reference"
---

# @soloengine/sandbox-container

[English](README.md) | 中文

<a id="summary"></a>
## 概述

容器沙箱提供方：把会话执行边界声明为每会话容器，并拒绝没有会话作用域的调用。它与容器子进程提供方配对，使 shell 命令无法逃出会话容器。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由云容器形态组合；沙箱 seam 对每个会话作用域的执行选择它。

<a id="model-experience"></a>
## 模型体验

无，因为沙箱提供方只声明执行边界，不注册任何模型可见内容。

#### KV Cache 影响

无影响：围栏不改变请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 该提供方假定同一 profile 已组合容器子进程行；混合组合会在加载期失败。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
