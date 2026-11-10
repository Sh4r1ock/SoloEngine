---
description: "SoloEngine 设计语言阶梯 token（--se-space/radius/z）——运行面板与产品页面共用的单一真源。"
kind: "package-reference"
---

# @soloengine/ui-theme

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 的间距、圆角与 z-index 设计 token，运行面板与产品页面共用。圆角委托原生 `--dsw-radius-*` 阶梯，因此不存在第二套几何。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由运行面板注入，产品页面直接导入；颜色与排版仍归原生主题包。

Node 半注入一段 body 脚本，把浏览器偏好（`localStorage['soloengine.preferences']` 的主题与内容字号）应用到运行面板文档——管理面与运行面板共用同一份浏览器级偏好，不写服务端设置命名空间。浏览器半按该偏好的 scheme 重新取三处对比度校正 token，因为原生 presenter 是按服务端主题把它们内联写下的。内容字号在落到文档前夹取到产品区间 12~20，被篡改或过期的存储值不能把面板排出版面契约。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器端设计 token 不注册任何模型可见内容。

#### KV Cache 影响

无影响：样式不会改变请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 这里只定义原生主题未抽象的 token；颜色与排版仍归原生主题包。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
