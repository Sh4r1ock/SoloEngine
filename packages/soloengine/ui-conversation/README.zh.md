---
description: "SoloEngine 运行面板的浏览器呈现：会话头座位、对话节点与预览卡片，经原生 conversation 槽位注册。"
kind: "package-reference"
---

# @soloengine/ui-conversation

[English](README.md) | 中文

<a id="summary"></a>
## 概述

运行面板的浏览器呈现：会话头座位、对话节点与预览卡片，全部经原生 conversation 槽位注册。它只渲染已记录状态，不贡献模型输入。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

随运行面板客户端图装载；会话头座位与键控对话节点注册进原生 conversation 槽位。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器端对话呈现不注册任何模型可见内容。

#### KV Cache 影响

无影响：渲染出的历史不是请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 它依赖原生 conversation 槽位契约；槽位版本不兼容时贡献不注册，而不是降级为第二套渲染器。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
