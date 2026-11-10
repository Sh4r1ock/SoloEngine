---
description: "SoloEngine 多 harness 实例装配层：每个 agenticflow 一个派生作用域与可插拔插件树，复用 DSH scope/loader 原语。"
kind: "package-reference"
---

# @soloengine/instance-runtime

[English](README.md) | 中文

<a id="summary"></a>
## 概述

按 flow 装配 harness 实例。每个 agenticflow 得到一个派生作用域与一棵可装卸的插件树，全部由 DSH 的 scope 与 loader 原语构成：flow 级注册影子化基线，agent 作用域继承它，卸载只撤该 flow 的那一层。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

运行驱动按 flow 获取实例，在装载前隔离被替换服务，把每个 agent 作用域挂到 flow 下，并在最后一个会话结束时释放实例。

<a id="model-experience"></a>
## 模型体验

无，因为装配层只创建作用域与插件树，模型可见贡献由被装载的插件拥有。

#### KV Cache 影响

无影响：作用域装配改变注册所在层，不改变请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 要在 flow 内替换基线服务的插件，必须在装载前通过 `FlowInstance.isolate` 声明服务名；运行时无法从包名推断。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
