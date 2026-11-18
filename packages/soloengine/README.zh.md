---
description: "SoloEngine 组的地图：框架层、harness 宿主插件、按 flow 的实例运行时、产品客户端插件，以及平台的数据库、执行与云提供方。"
kind: "package-group"
---

# packages/soloengine

[English](README.md) | 中文

## 摘要

用这一组包运行 SoloEngine。框架层（`soloengine-framework/`）拥有业务 REST 面、账号域与变更台账；[`host/`](host/README.zh.md) 把它挂进 harness 的 Web 服务并驱动画布运行；[`instance-runtime/`](instance-runtime/README.zh.md) 为每个 flow 组合一份 harness 实例；`ui-*` 系列新增产品客户端面；其余包提供数据库、会话持久化、执行与云提供方。每个提供方都在原位置替换一项上游能力，不叠加平行实现。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 领域 | 包 | 职责 |
|---|---|---|
| 运行时 | [`host/`](host/README.zh.md)、[`instance-runtime/`](instance-runtime/README.zh.md)、[`agent-compiler/`](agent-compiler/README.zh.md) | harness 挂载与运行驱动、按 flow 组合实例、画布编译 |
| 工具与模型 | [`tools/`](tools/README.zh.md)、[`llm-db-adapter/`](llm-db-adapter/README.zh.md)、[`open-preview/`](open-preview/README.zh.md)、[`types/`](types/README.zh.md) | 产品工具行、数据库模型路由、预览事件、共享类型 |
| 客户端插件 | [`ui-theme/`](ui-theme/README.zh.md)、[`ui-conversation/`](ui-conversation/README.zh.md)、[`ui-operation-area/`](ui-operation-area/README.zh.md)、[`ui-document-editor/`](ui-document-editor/README.zh.md)、[`client-bootstrap/`](client-bootstrap/README.zh.md)、[`browser-proxy/`](browser-proxy/README.zh.md) | 经原生插槽与 tab 类型挂载的产品面 |
| 持久化与云 | `business-db-postgres/`、`storage-postgres/`、`session-persistence-sqlite/`、`session-persistence-postgres/`、`session-query-sqlite/`、`session-query-postgres/` | 单机与云两种形态的业务库、会话日志与检索提供方 |
| 执行与分发 | `sandbox-container/`、`subprocess-container/`、`executor-container/`、`executor-vm/`、`egress-proxy/`、`image-distribution/`、`cloud-control/`、`cloud-control-postgres/` | 容器与全 VM 执行器、出口策略、镜像层、控制面与网关 |

<a id="related-documentation"></a>
## 相关文档

- 架构
- 组合与插件全量清单
- 数据层
- REST 与账号域

<a id="dev-note"></a>
## 开发说明

框架层是普通 TypeScript 模块，只有 `host` 跑在插件树里。新增能力意味着扩展框架模块或某个提供方包，而不是 fork 上游插件。
