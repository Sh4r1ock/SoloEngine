---
description: "SoloEngine 操作区联动层与变更面板：呈现意图 → openResource/openTab 自动跟随，变更台账面板。"
kind: "package-reference"
---

# @soloengine/ui-operation-area

[English](README.md) | 中文

<a id="summary"></a>
## 概述

浏览器操作区层：渲染跟随意图并打开对应资源或页签，同时提供文件变更台账面板。它只呈现 Host 记录，不注册模型可见内容。浏览器页签归随附的 Sidebar Browser 包（页面经 `@soloengine/browser-proxy` 加载），本包不再注册第二个浏览器面板。

## 目录

- [概述](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

注册进运行面板操作区；跟随意图与文件变更记录来自 Host 投影。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器端操作区面板不注册任何模型可见内容。

#### KV Cache 影响

无影响：面板只渲染 Host 记录，不改变请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 自动跟随依赖 Host 持久化的意图记录；没有记录的会话不会自动打开面板。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
