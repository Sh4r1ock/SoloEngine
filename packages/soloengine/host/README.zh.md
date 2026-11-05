---
description: "SoloEngine 的 Host 插件：把框架 REST 面挂进原生 Web 服务，编译并运行画布，直写会话/事件归属，并接线文件变更、预览、MCP、权限与云运行时。"
kind: "package-bundle"
---

# @soloengine/host

[English](README.md) | 中文

<a id="summary"></a>
## 概述

SoloEngine 的 Host 插件。它把框架层的 Express REST 面挂进原生 `ctx.webServer` 的单一产品端口，在运行时编译画布、按 agenticflow 装配一份 harness 实例，并创建主 agent。它还直写会话与事件归属，挂载文件变更抓拍与撤回、产品设置、预览记录、MCP 监督、权限预设、运行面板深链，以及可选的容器或云运行时。原生 profile 插件管理器经本插件投影进框架层的管理 REST 面，因此实例插件管理留在管理层，只有 `/run/:agenticFlowId` 进入 Harness 壳。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

挂在产品 profile 中（启动器的 `cordis.patch.yml` 已如此）。Host 是管理框架与 harness 之间的唯一接缝：每个运行请求都被翻译为原生 agent 调用；它新增的模型可见贡献——节点 persona 系统提示词或委派工具——都注册在 agent 作用域，从不注册到全局。配置在启动时校验；缺失服务与未知运行档位一律 fail loud，不做降级。

<a id="model-experience"></a>
## 模型体验

### 节点 persona 系统提示词

#### 模型看到什么

当编译后的画布节点声明了 persona 时，Host 把它逐字写成名为 `soloengine:node-persona` 的系统提示词段，段序为 1。其余提示词归组合预设所有。

##### 节点 persona 段

```markdown
<the canvas node persona text, inserted verbatim at order 1>
```

#### Token 影响

该段把 persona 文本加入该节点的每一次请求；长度等于画布编写的文本。

#### KV Cache 影响

对同一画布节点，该段跨回合稳定，因此保留请求前缀；编辑 persona 会改变前缀，并从该点起使缓存失效。

### 委派工具

#### 模型看到什么

每条委派边注册一个以画布边命名的工具（`edge.toolName`），其描述点名子 agent，并要求传入自包含的任务。

##### 委派工具描述

```markdown
Delegate a self-contained task to the "<child name>" agent (canvas node <id>) and return its final answer. The child works in its own session with its own model, prompt and tools; it does not see this conversation, so state everything it needs in the task text.
```

#### Token 影响

每条出边一份工具 schema 与其描述；任务参数与子 agent 输出按调用追加 token。

#### KV Cache 影响

工具 schema 属于请求前缀；增加或删除一条边会改变前缀，并使该节点的缓存失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- Host 是单一大协调模块，覆盖 REST 挂载、运行驱动、归属、预览、MCP、权限、云与页面路由；按关注点拆分暂缓，因为这些面目前共享同一套启动接线。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
