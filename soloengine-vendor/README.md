# soloengine-vendor · 第三方 DSH 插件固化区

> plan 目录结构里的 `soloengine-vendor/`：第三方 DSH 插件**源码固化区（含许可清单）**。

## 这里放什么

| 内容 | 说明 |
|---|---|
| `<包名>/` | 第三方发布包的**原件快照**（不含 `@scope/` 前缀，例如 `dsh-turn-rewind/`） |
| `MANIFEST.json` | 每包的版本、许可（SPDX）、上游、档位、**SoloEngine 的消费方式**、是否改过源码、文件数/字节数/内容指纹 |
| `refresh.mjs` | 重新固化并重算指纹（版本真源＝启动器的 `PLUGIN_DEPENDENCIES`，这里不另写一份） |

当前固化的两件（与 profile bundle 层的第三方行一一对应）：

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| `@anionex/dsh-turn-rewind` | 0.3.10 | BSD-3-Clause | 回合检查点与撤回的实现主干（清单声明兼容 0.2.1-rc.2） |
| `dsh-free-search` | 0.9.13 | MIT | 免密钥多引擎搜索 + `fs-quality-fetch` 抓取提供方（经官方 `ctx.web` seam） |

> 审批不再有第三方包：`dsh-approve-for-me` 与 `dsh-permission-rules` 的规则前缀/高风险检查/可选模型复核逻辑已并入原生 `permission` 实现体（第四档预设 `approve-for-me`，R186），两者已删除。

## 为什么固化（以及为什么**不**改源码）

1. **可核验**：运行时用的是 profile `node_modules` 里的发布包。机器一换、registry 一抖，装到的东西
   就可能不是当初验收的那一份。固化区记录了版本与**内容指纹**，让「装的还是不是那一份」成为可核验事实。
2. **许可合规**：每个包自带的 `LICENSE` 随快照保留，`MANIFEST.json` 里记 SPDX 标识与上游地址。
3. **不形成第二实现**：本目录是**存档**，不参与解析、不被任何 code path import。若某天需要改第三方
   源码，必须改在这里并在 `modifications` 里写清改动点——**当前两件均为「无源码改动」**，SoloEngine 只经
   组合层（bundle 行 + `cordis.patch.yml` 的 config 覆写）使用它们。

## 刷新方式（仅开发期一次性固化；不作为自动升级通道）

**升级策略**：源码拿进来就是我们的；默认不运行 refresh、不自动跟上游升级。只有明确需要跟进上游时，才手动重放一次并更新台账（来源/版本/许可/哈希/改动点）；不得把 refresh 当作运行时或 CI 的常规步骤。

```bash
# 依赖变了（启动器 PLUGIN_DEPENDENCIES 改版本）之后
node soloengine-launch/bin.mjs install   # 先把新版本真装进 profile
node soloengine-vendor/refresh.mjs       # 再固化快照与指纹
```

`refresh.mjs` 会在「已装版本 ≠ 已钉版本」时**拒绝固化并报错**——固化一份没验收过的构建没有意义。

核验（回归里自动跑）：把 profile 里已装包重新求指纹，与 `MANIFEST.json` 比对，不一致即失败。
