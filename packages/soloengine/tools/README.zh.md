---
description: "SoloEngine 的 Host 面专用工具：get_diagnostics 报告调用 agent 的身份、模型路由、会话规模与可见工具。"
kind: "package-reference"
---

# @soloengine/tools

[English](README.md) | 中文

<a id="summary"></a>
## 概述

运行 Host 的 SoloEngine 专用工具。它注册 `get_diagnostics`，一个只读工具，报告调用 agent 的身份、模型路由、会话规模以及它当前能看到的工具。该工具让 agent 在假定某项能力可用之前先检查自己的执行环境。所有注册都是 effect-based，随 agent 作用域消失。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由产品 profile 的工具行挂载；工具经 `ctx.tools.register` 注册进 agent 作用域，因此遵循常规工具生命周期与权限管线。

<a id="model-experience"></a>
## 模型体验

### 诊断工具

#### 模型看到什么

`get_diagnostics` 返回所属 agent 身份、它运行所用的模型路由、会话规模以及当前对该 agent 可见的工具名。工具只读且不接受参数。

#### Token 影响

一份工具 schema 与每次调用一个小的结构化结果；结果大小受该 agent 可见工具名数量约束。

#### KV Cache 影响

对给定组合，schema 稳定；结果追加在请求前缀之后，不会使其失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 结果只描述单个 agent 的视角；它不是全运行时清单，并刻意省略其他 agent 的路由与工具。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
