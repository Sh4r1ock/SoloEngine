---
description: "SoloEngine 编辑器/文档面板：在官方 documentpreviews 注册表上补文本编辑与保存，Office/表格交给官方渲染器。"
kind: "package-reference"
---

# @soloengine/ui-document-editor

[English](README.md) | 中文

<a id="summary"></a>
## 概述

浏览器文档面板：在官方 document-preview 注册表上补文本编辑与保存，Office 与表格文件继续由官方渲染器处理。它不引入第二套解析器。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

向原生 `documentPreviews` 注册表注册文本提供方；保存经工作区文件 API 写回。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器端文档编辑不注册任何模型可见内容；文件内容只经 Host 工具进入模型。

#### KV Cache 影响

无影响：编辑不改变请求内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 编辑仅限工作区文件 API 可写的文本文件；二进制或 Office 文档保持只读。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
