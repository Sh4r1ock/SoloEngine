---
description: "SoloEngine 预览记录：声明 soloengine/preview 会话事件族、去重置顶且上限 50 条的投影，以及 open_preview 工具。"
kind: "package-reference"
---

# @soloengine/open-preview

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 的 Host 面预览记录。该包声明 `soloengine/preview` 会话事件族，注册一个去重置顶并保留最近五十条记录的投影，并暴露 `open_preview` 工具，让 agent 为当前会话记录一个可预览的产物。记录只进日志、供客户端读取，不会进入后续模型请求。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由产品 profile 挂载；投影经 `ctx.sessionProjections.register` 注册，工具经原生工具运行时注册。运行面板读取投影，而不是原始事件日志。

<a id="model-experience"></a>
## 模型体验

### 预览工具

#### 模型看到什么

`open_preview` 为当前会话记录一个可预览产物并返回存储后的记录；它不会把产物读回对话。

#### Token 影响

一份工具 schema 与每次调用一个结果；预览记录本身留在会话日志中。

#### KV Cache 影响

对给定组合，schema 稳定；结果追加在请求前缀之后，不会使其失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 投影只保留最近五十条记录；更早的预览仍在会话日志中，但不会显示在面板里。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
