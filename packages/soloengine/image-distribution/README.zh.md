---
description: "SoloEngine 工作区/镜像分发层：本地镜像缓存、标准 OCI 分层缓存（按需取层与容量淘汰）、内容寻址工作区对象存储（对象存储权威 + 本地副本），以及 builder/runtime 账号分离的环境导出"
kind: "package-reference"
---

# @soloengine/image-distribution

[English](README.md) | 中文

<a id="summary"></a>
## 概述

镜像与工作区分发层：三档本地镜像缓存、标准 OCI manifest 驱动的分层缓存（按需/批量/全量取层，含容量淘汰与命中率遥测）、内容寻址的工作区对象（对象存储为权威、本地保留副本；共享卷或 S3 兼容端点），以及分离 builder/runtime 账号并剥离构建残留的环境导出。它只搬运云会话的字节，不把内容暴露给模型。

## 目录

- [摘要](#summary)
- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

云节点运行时用它落盘会话工作区，并把最终状态提交回对象存储。分层缓存消费标准 OCI image manifest，只取缺失层：层更新只拉变更层，重复会话共享节点缓存。`S3ObjectStore` 是 AWS S3、MinIO 与 S3 兼容端点的云端权威实现（SigV4、path-style）；`FilesystemObjectStore` 对应共享卷。环境导出把会话检查点的工作区变成可复用的普通文件树与一份记录，由 `verifyEnvironmentExport` 校验。

<a id="model-experience"></a>
## 模型体验

无，因为镜像与工作区分发只搬运字节，不注册任何模型可见内容。

#### KV Cache 影响

无影响：分发流量不属于模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- 对象存储的凭据与可达性是部署输入；存储缺失会让云形态失败，而不是退回本地数据。S3 适配器按 AWS Signature V4 签名，并已在强制校验签名的网关上实测；建桶是部署引导。阿里云 OSS 原生 API 未覆盖，请使用其 S3 兼容端点。
- registry 适配器支持 HTTP Basic 凭据与平台 image manifest；多架构镜像索引必须先解析到平台清单再取层。
- Docker 会话仍由 Docker 自己的镜像存储整镜像拉取。内核态按需挂载层需要容器运行时注册外部 snapshotter（SOCI/eStargz/Nydus），当前 Docker daemon 未提供。

<a id="dev-note"></a>
### 开发备注

行为、配置或模型可见面发生变化时，同步更新本文件；包 README 是读者与 agent 依赖的契约。
