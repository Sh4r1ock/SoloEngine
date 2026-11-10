---
description: "SoloEngine 容器执行后端：每会话一容器、加固基线、默认拒绝网络、暂停/恢复/销毁生命周期。"
kind: "package-reference"
---

# @soloengine/executor-container

[English](README.md) | 中文

<a id="summary"></a>
## 概述

云会话的容器执行后端：每个会话一个加固容器，默认拒绝网络，并提供暂停、恢复与销毁生命周期操作。在选中云执行形态时，它替换宿主子进程执行。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由 `SOLOENGINE_EXECUTOR=container` 与云数据库形态共同选择；需要容器镜像与运行中的 Docker 守护进程。`SOLOENGINE_EXECUTOR=microvm` 选择同一套装配，由 OCI 运行时（`SOLOENGINE_CONTAINER_RUNTIME`，缺省 `kata-runtime`）提供 guest 内核，而不是宿主内核。

<a id="model-experience"></a>
## 模型体验

无，因为容器执行器只运行 shell 命令，模型呈现由消费方工具拥有。

#### KV Cache 影响

无影响：容器生命周期不是模型输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 需要容器镜像与运行中的 Docker 守护进程；本机形态不会加载它。
- `microvm` 要求所选 OCI 运行时已注册到 Docker；运行时缺失时在创建阶段失败，不会回落到 `runc`。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
