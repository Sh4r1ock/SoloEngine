---
description: "SoloEngine 运行面板的浏览器启动接线：读取 Host 注入的 flow/会话键，选中画布最近一次运行的原生会话。"
kind: "package-reference"
---

# @soloengine/client-bootstrap

[English](README.md) | 中文

<a id="summary"></a>
## 概述

运行面板的浏览器启动接线。它读取 Host 注入的 flow 与会话键，选中画布最近一次运行的原生会话，并在客户端连接中保持该选择。它先向工作区导航声明该会话，启动恢复因此只打开它，不会连接（并在需要时新建）草稿会话。URL 指向的 flow 还没有会话时，它经宿主桥用受管工作根发起一次运行。它还对本面板加载期间新增的工作区做一次对账：工作区一旦拥有会话，就把「画布 × 目录」登记为运行项目，宿主据此归属该会话。它不拥有插件树，也不拥有模型上下文。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

随运行面板客户端图装载；`/run/:agenticFlowId` 提供 flow，bootstrap 在面板渲染前选中对应会话。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器启动接线只选择会话，模型上下文归 Host 组合拥有。

#### KV Cache 影响

无影响：选择会话不改变请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 面板加载时已经存在的工作区不登记：它们可能属于别的画布，浏览器无法判断是哪个 flow 创建的。
- 工作区要等它拥有会话后才登记；用户加了目录但从未在其中运行，不会留下运行项目行。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
