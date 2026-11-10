---
description: "SoloEngine 编译产物与运行契约类型包：画布数据、编译后的 agent 规格、运行输入、路由、投影与画布工具词汇表。"
kind: "package-reference"
---

# @soloengine/types

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 的编译与运行契约类型：画布数据、编译后的 agent 规格、运行输入、路由、投影与画布工具词汇表。该包没有运行时行为，是这些类型的唯一来源。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由框架、Host、编译器与产品页面导入；`TOOL_MAP` 词汇表与画布编辑器共用。

<a id="model-experience"></a>
## 模型体验

无，因为该包只声明编译与运行契约，所有模型可见用途由消费方拥有。

#### KV Cache 影响

无影响：类型声明不会进入请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 类型是 pre-stable 的，随消费方一起变化；不提供旧编译产物的兼容层。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
