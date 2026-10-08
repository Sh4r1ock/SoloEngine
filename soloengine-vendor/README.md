# soloengine-vendor · 第三方 DSH 插件固化区

> plan 目录结构里的 `soloengine-vendor/`：第三方 DSH 插件**源码固化区（含许可清单）**。

## 这里放什么

| 内容 | 说明 |
|---|---|
| `<包名>/` | 第三方发布包的**原件快照**（不含 `@scope/` 前缀，例如 `dsh-turn-rewind/`） |
| `MANIFEST.json` | 每包的版本、许可（SPDX）、上游、档位、**SoloEngine 的消费方式**、是否改过源码、文件数/字节数/内容指纹 |
| `refresh.mjs` | 重新固化并重算指纹（版本真源＝启动器的 `PLUGIN_DEPENDENCIES`，这里不另写一份） |

当前固化的三件（与 profile bundle 层的第三方行一一对应）：

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| `@anionex/dsh-turn-rewind` | 0.3.8 | BSD-3-Clause | 回合检查点与撤回的实现主干 |
| `dsh-permission-rules` | 0.7.4 | Apache-2.0 | 审批三档的规则层（白名单缝隙之一） |
| `dsh-approve-for-me` | 0.2.4 | MIT | 审批应答器（白名单档放行判定） |

## 为什么固化（以及为什么**不**改源码）

1. **可核验**：运行时用的是 profile `node_modules` 里的发布包。机器一换、registry 一抖，装到的东西
   就可能不是当初验收的那一份。固化区记录了版本与**内容指纹**，让「装的还是不是那一份」成为可核验事实。
2. **许可合规**：每个包自带的 `LICENSE` 随快照保留，`MANIFEST.json` 里记 SPDX 标识与上游地址。
3. **不形成第二实现**：本目录是**存档**，不参与解析、不被任何 code path import。若某天需要改第三方
   源码，必须改在这里并在 `modifications` 里写清改动点——**当前三件均为「无源码改动」**，SoloEngine 只经
   组合层（bundle 行 + `cordis.patch.yml` 的 config 覆写）使用它们。

## 刷新方式

```bash
# 依赖变了（启动器 PLUGIN_DEPENDENCIES 改版本）之后
node soloengine-launch/bin.mjs install   # 先把新版本真装进 profile
node soloengine-vendor/refresh.mjs       # 再固化快照与指纹
```

`refresh.mjs` 会在「已装版本 ≠ 已钉版本」时**拒绝固化并报错**——固化一份没验收过的构建没有意义。

核验（回归里自动跑）：把 profile 里已装包重新求指纹，与 `MANIFEST.json` 比对，不一致即失败。
