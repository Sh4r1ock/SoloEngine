# SoloEngine 打包与发行

> 依据 PRD-11（部署与一键打包）与《SoloEngine 框架设计》§五、§2.0.5。本目录是**发行侧编排**：
> 把一次打包产物（`POST /api/solo/packaging/run` 落出的 `data/packaging/<id>/`）固化为两种可分发形态，
> 并在此记录**本机可实测到什么程度**（禁止把不可实测的环节说成已验证）。

## 两种产物形态

| 形态 | 内容 | 落点 | 平台机制 |
|---|---|---|---|
| **profile 发行**（PRD-11 FR-DEP-007） | 一份可装入任意 dsh 运行面的 profile：组合清单 + 配置层 + 每节点 agent 预设 + 说明 | 产物目录内的 `profile/`（打包时已固化） | `dsh --profile <名字>` 的 bundle/patch 组合（`packages/boot/app-boot`） |
| **桌面应用**（PRD-11 FR-DEP-006） | Electron 壳 + 内置运行时 + 离线依赖 + 上面那份 profile 与预设 | `apps/desktop` 的 electron-builder 产物（NSIS 安装包 / 免安装目录 / macOS DMG） | `apps/desktop`（外壳与单实例锁）、`apps/desktop-host`（无监听端口的宿主进程） |

`profile/` 由框架层的打包域在 `POST /api/solo/packaging/run` 时写出（`soloengine-framework/src/modules/packaging.ts`
的 `materializeProfile`）：`package.json`（`dsh.profile.bundles`）、`cordis.patch.yml`（与云实例同一条组合层，
逐行照抄 + `agent-presets` 的 `default` 指向入口节点）、`.agent-presets/<节点 id>/agent.cordis.yml`（每节点一个组合）、
`README.md`（前置条件与三种原生加载方式）。**产物不含任何密钥**（`verifyArtifact` 在整棵产物树上扫描密钥键名）。

## 桌面产物编排

- `desktop/prepare-profile.mjs`：把产物 profile **合并**进桌面壳的 profile（`$DSH_HOME/profiles/desktop`）——
  保留桌面 profile 自己的依赖与 host 链接（`apps/desktop/src/profile-packages.ts` 的图校验要求），
  只替换 `dsh.profile.bundles` 与 `cordis.patch.yml`，并把预设装进 `$DSH_HOME/.agent-presets/`；随后做
  行解析与预设体检（与平台 `dsh-agent-presets` 的 discovery 同一判据）。**缺项即 fail loud**。
- `desktop/build-windows.mjs`：调平台自带的打包脚本产出 **NSIS 安装包** 与 **免安装目录**
  （`package:win:x64` / `package:win:x64:dir`，见 `apps/desktop/package.json`）；前置依赖缺失时
  **明确报出缺什么**，不静默跳过。
- `desktop/macos/`：macOS 的**构建配置与脚本**（DMG + zip、签名/公证/验证）。本产品线**只交付配置与脚本**，
  不在 Windows 机器上实测（见下「交付边界」）。

## 桌面形态复用平台机制（K4 对齐表）

| 要求（PRD-11） | 平台实现位置 | 本机取证方式 |
|---|---|---|
| 首启自检，成功才激活 | `apps/desktop/src/backend-controller.ts`（Host 子进程 `ready` 才切到应用页）、`project-manager.ts`(`applyRelease`/`assertProfileRuntime`)、`runtime-tree.ts`(`readDesktopRuntime`) | `npx vitest run apps/desktop/tests`（`main-startup`/`startup-renderer`/`project-manager`/`runtime-tree` 各 spec） |
| 自检失败不激活、报告失败项、可重试 | `apps/desktop/src/startup-document.ts` + `startup-renderer` + `ipc.ts`（backend-retry / disablePlugins / resetConfiguration） | 同上（`startup-renderer.spec.ts` 断言启动页与失败项渲染） |
| **不做任何形式的自动回滚**，失败保留半成品 | `apps/desktop/src/project-manager.ts`（直接写、`pendingPackages` 标记供下次重试、**无 staging/backup/rollback**） | `project-manager.spec.ts`（`expect(existsSync(rollback)).toBe(false)`、`keeps partial package changes ... after pnpm fails`、`resets the entire profile without backups`） |
| 单一实例锁 + 私有实例目录 | `apps/desktop/src/single-instance.ts`（`requestSingleInstanceLock`）、`paths.ts`（`$DSH_HOME/profiles/desktop`、`$DSH_HOME/desktop/pnpm/*`） | `single-instance.spec.ts`；`paths` 取值见 `apps/desktop/src/paths.ts` |
| 内置运行时 + 离线依赖 | `apps/desktop/scripts/prepare-runtime.ts`（Node 归档 + 校验 SHA256）、`prepare-package-set.ts`、`prepare-dsh.ts`（本地 tarball + `--prod --frozen-lockfile` 安装核心闭包并封 `desktop-runtime.json`） | `runtime-tree.spec.ts` / `core-package-set.spec.ts` / `prepare-package-set.spec.ts` |
| 升级 = 壳 + 运行时 + 离线依赖同一签名单元（含差分） | `apps/desktop/electron-builder.config.mjs`（`nsis.differentialPackage: true`、macOS `dmg`+`zip`）、`src/update-coordinator.ts` | `update-coordinator.spec.ts` / `desktop-auto-update-environment.spec.ts` |
| 桌面无 webServer | `apps/desktop-host/config/desktop.cordis.patch.yml` 按行 id 关闭 `webserver`/`web-runtime`/`web-startup`/`client-hmr` 等；`apps/desktop-host/src/index.ts` 以帧化字节管道承载 API 与资产 | 该 patch 文件与 `desktop-host` 的入口即证据（无监听端口代码路径） |

## 交付边界与实测结果

**Windows 产物已在本机真实产出并真实启动**（2026-09-20）：

| 产物 | 路径 | 实测 |
|---|---|---|
| NSIS 安装包 | `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/deepseek-harness-0.1.6-alpha.1-win-x64.exe`（163.31 MB） | electron-builder 26.15.3 全链跑通：`@electron/rebuild` → asar → signtool 元数据 → `nsis` 打包（首次联网取 nsis-3.0.4.1 / nsis-resources-3.4.1 / 7zip）→ 生成 `.exe.blockmap`（差分更新用） |
| 免安装目录 | 同目录 `win-unpacked/`（`DeepSeek Harness.exe` 233 MB + `resources/{app.asar, app.asar.unpacked, runtime}`） | 以隔离 `DSH_HOME` 真实启动：写出 `profiles/desktop/desktop-runtime-state.json`（runtimeId/版本/平台/架构）与 `storages/workspace.json`，窗口渲染出产品登录页（截图 `test/logs/shots/desktop-first-launch.png`，记录 `test/soloengine/records/stage8-desktop-first-launch.json`） |

本机实测到的层：**机制层**（`npx vitest run apps/desktop/tests` 197 通过）、**编排层**（`prepare-profile.mjs` 的真实副作用 + 前置条件 fail loud）、**产物层**（上表两行）。仍然只交付配置与脚本的是 **macOS DMG**：`package-target.ts` 本身拒绝非 darwin 宿主，故不在本机实测（见 `desktop/macos/README.md`）。

构建期踩到并修掉的平台缺陷（都在本仓库留下了修复）：

1. **载荷冒烟夹具的失效期望**：`apps/desktop/tests/fixtures/runtime-payload-smoke.mjs` 原先无条件 `require('fs-ext')`，而 `fs-ext` 在本仓库整棵依赖图里不存在（无清单、无锁文件条目、无源码引用；文件锁由 `native/system` 的 flock 绑定承担）——任何主机都过不了这一步，Windows 产物因此完全无法产出。现在夹具改为「可解析则验证 seek 契约；不可解析则断言没有任何载荷清单声明它」，并如实输出 `fsExt: "absent"`。
2. **免安装目录只走签名路径**：`package:win:x64:dir` 需要代码签名证书，与 `package:win:x64:unsigned` 不成对。补 `package:win:x64:dir:unsigned`（平台脚本同一口径），编排据此调用。
3. **编排自身的判定与顺序**：预检原先按 `apps/desktop/node_modules/<传递依赖>` 目录名判定（pnpm 布局下传递依赖在 `.pnpm/<pkg>@<ver>/node_modules`），会把已装好的打包器误报成缺失；且自己重列 prepare 步骤并把顺序排错（`prepare:packages` 需要先 `release:pack`）。现在只做「可解析 + app id 必填」的预检，步骤一律委派平台命令。

## 复现命令

```powershell
# 1) 云实例侧打包一次（真实落盘 profile/）
node test/soloengine/profile-release-drill.mjs

# 2) 桌面壳的 profile 与预设固化（真实副作用 + 体检）
node packaging/desktop/prepare-profile.mjs --from data/packaging/<run-id>/profile

# 3) 桌面机制层取证（平台自带 spec）
npx vitest run apps/desktop/tests

# 4) 产出 Windows 产物（安装包 + 免安装目录；需要 electron 二进制与一次联网取 NSIS）
$env:DSH_DESKTOP_APP_ID='com.soloengine.desktop'
node packaging/desktop/build-windows.mjs --unsigned

# 5) 容器形态（同一程序、同一条启动路径）
docker build -f packaging/container/Dockerfile `
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) -t soloengine:local .
docker run -d --name soloengine -p 8991:8991 -v soloengine-data:/app/data `
  -e SOLOENGINE_HOST=0.0.0.0 soloengine:local
```

