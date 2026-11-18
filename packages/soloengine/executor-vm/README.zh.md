---
description: "SoloEngine 全 VM 执行后端：每会话一台 QEMU 全 VM、qcow2 覆盖盘、工作区共享到 /workspace、SSH 命令路由、QMP 暂停/恢复/销毁。"
kind: "package-reference"
---

# @soloengine/executor-vm

[English](README.md) | 中文

<a id="summary"></a>
## 概述

云会话的全 VM 执行后端：每个会话一台 QEMU 全 VM，会话盘是只读基础镜像上的 qcow2 覆盖盘，宿主工作区共享到 `/workspace`，命令经 SSH 执行，暂停/恢复/销毁经 QMP。在选中 `full-vm` 执行形态时，它替换宿主子进程执行。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

由 `SOLOENGINE_EXECUTOR=full-vm` 与云数据库形态共同选择；需要可引导的 qcow2 基础镜像（`SOLOENGINE_VM_IMAGE`）、每会话状态目录（`SOLOENGINE_VM_STATE_DIR`）、平台私钥（`SOLOENGINE_VM_SSH_KEY`），以及节点上的 QEMU。基础镜像必须启用 sshd 并预置对应公钥，且把 virtio-9p 的 `workspace` 标签挂到 `/workspace`。

<a id="model-experience"></a>
## 模型体验

无，因为全 VM 执行器只运行 shell 命令，模型呈现由消费方工具拥有。

#### KV Cache 影响

无影响：VM 生命周期不是模型输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 需要 QEMU、可引导基础镜像与平台私钥；本机与容器形态不会加载它。
- guest 默认拒绝出口（`restrict=on`）：guest 只能到达显式转发的 SSH 端口。
- 不随产品提供 `browser-use` 与 `computer-use` 提供方（D16）；VM 暴露 VNC 显示面，供部署方在 guest 内自行安装。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
