---
description: "SoloEngine 画布编译器：校验画布、排列节点，把每个节点物化为一份完整的标准 agent 预设与委派绑定。"
kind: "package-reference"
---

# @soloengine/agent-compiler

[English](README.md) | 中文

<a id="summary"></a>
## 概述

校验画布、排列节点，并把每个节点物化为一份完整的标准 agent 预设与委派绑定。它运行在运行与打包两条路径上，遇到未知工具、缺失模型或矛盾预设立即 fail loud，不产生中间产物文件。编译器是「画布 → agent」契约的唯一实现。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

运行驱动与打包服务调用编译器；编译产物 `AgentSpec` 列表同时喂给 `createRunDriver` 与 profile 写入器。画布编辑不会在磁盘上产生第二份编译产物。

<a id="model-experience"></a>
## 模型体验

间接地，经编译出的 agent 预设生效；该预设里的插件行拥有全部模型可见的提示词、schema 与结果。

#### KV Cache 影响

无直接影响：编译只选择既有插件行，请求形状与缓存稳定性由这些行拥有。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 编译在每次运行与打包请求时发生；画布改动不会投影到已经运行中的会话。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
