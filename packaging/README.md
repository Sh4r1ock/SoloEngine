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
逐行照抄 + 该实例的插件差异净结果 + 每节点一条平台原生 agent 预设行 `@deepseek-ai/dsh-agent-preset`，
`agent-preset-registry` 的 `default` 指向入口节点）、`node_modules/`（随产物携带的非平台插件包本体）与
`dependencies.json`（随包清单 + 由目标机 dsh 提供的平台包清单）、`closure.json`（逐包文件数/字节数/SHA-256
与总量摘要；读回时重算比对）、`README.md`（前置条件与三种原生加载方式）。
**产物不含任何密钥**（`verifyArtifact` 在整棵产物树上扫描密钥键名；闭包另行检查包管理器凭据载体）。
**自包含**：闭包按解析结果逐包复制（不依赖目标机安装 `@soloengine/*`），平台包由目标机运行器提供；
空 `DSH_HOME` + 断网可直接启动——`pnpm run verify-artifact-offline`（记录
`test/soloengine/records/stage9-artifact-offline.json`，3/3）。
**互载**：产物的插件都是标准 cordis 插件，可被任意 dsh 实例装载——`pnpm run verify-interop` 在空 `DSH_HOME` 里由
桌面内置运行时启动产物，跑八类契约 + 任意实例加载 + 第三方插件装入并 boot（`test/soloengine/records/stage9-interop-matrix.json`，10/10）。

产物形态由 `POST /packaging/run` 的 `form` 选择：`profile`（缺省，仅 profile 发行）与 `desktop`
（同一份产物再走发行侧暂存：先过发行流水线的前置检查，再调用 `desktop/prepare-profile.mjs`
把组合与随包插件合并进**该运行私有**的桌面壳 profile；打包请求不跑 exe 封装本身）。
暂存后由产品页「桌面应用」区的按钮以 `POST /packaging/runs/<id>/desktop-build` 一键触发真实封装，
进度写在 `data/packaging/.desktop-builds/<id>.json`（产物目录之外，不进产物、不参与密钥扫描），
页面轮询 `GET /packaging/runs/<id>` 读取；失败原样显示，再次点击即重试。

## 桌面产物编排

- `desktop/prepare-profile.mjs`：把产物 profile **合并**进桌面壳的 profile——桌面 profile 落在
  `data/packaging/.desktop/<run-id>/profiles/desktop`（每个运行一份，两个画布不会互相覆盖；
  `--home` 可显式指定，默认仍是 `$DSH_HOME`）——保留桌面 profile 自己的依赖与既有 node_modules
  （`apps/desktop/src/profile-packages.ts` 的图校验要求），只替换 `dsh.profile.bundles` 与
  `cordis.patch.yml`，并把产物 `dependencies.json` 列出的随包插件补进桌面 profile 的 node_modules；
  随后做行解析（随包插件在桌面 profile 内、平台包在桌面运行时锚点上可解析）与回读一致性检查。
  **缺项即 fail loud**。桌面载荷不读环境变量：产物配置层里的 `SOLOENGINE_ROOT`/`SOLOENGINE_DB`/
  `SOLOENGINE_KEYS_DIR`/`SOLOENGINE_SKILLS_DIR` 改绑到 `dshHomePath(...)`，`databaseForm` 固定为
  `single`，云形态连接串整行移除。
- `desktop/build-windows.mjs`：调平台自带的打包脚本产出 **NSIS 安装包** 与 **免安装目录**
  （`package:win:x64` / `package:win:x64:dir`，见 `apps/desktop/package.json`）；前置依赖缺失时
  **明确报出缺什么**，不静默跳过。GitHub/npmjs 不可达的打包主机可设
  `ELECTRON_MIRROR`（如 `https://npmmirror.com/mirrors/electron/`）、
  `ELECTRON_BUILDER_BINARIES_MIRROR`（如 `https://npmmirror.com/mirrors/electron-builder-binaries/`）
  与 `DSH_DESKTOP_NPM_REGISTRY`（如 `https://registry.npmmirror.com/`，内置运行时安装用；
  缺省 `https://registry.npmjs.org/`）。
  **产物落点**：`DSH_DESKTOP_ARTIFACT_ROOT` 指定发布根（页面一键触发时是该运行的私有 home，
  产物在 `data/packaging/.desktop/<run-id>/unsigned-artifacts/`：安装包 `*.exe` + `win-unpacked/`）；
  缺省仍发布到 `apps/desktop/.desktop-build/targets/win-x64/{unsigned-artifacts,artifacts}`。
  固定目录会被上一次的产物占住（目标机上正开着免安装目录时 Windows 拒绝替换被占用的文件），
  所以运行私有落点让「重新生成」总是可行。发行物身份（反向 DNS app id）默认
  `com.soloengine.desktop`，`DSH_DESKTOP_APP_ID` 仅在换品牌时覆盖。
- **首启 profile 载荷**：`build-windows.mjs` 把默认 profile 与显式 `DSH_DESKTOP_PROFILE_SEED`
  （页面一键触发时由该运行的私有 home 给出）都先暂存到 `$DSH_HOME/profiles/desktop-seed`——
  electron-builder 从不复制根 `node_modules`，所以随包插件在这一步改名为 `plugins/`，
  再由桌面壳首启时换回 `node_modules/`（`seedDesktopProfile`）。显式 seed 不经过这一步时，
  载荷只剩几个描述文件、bundle 的 patch 层全部缺失（首启表现为 `ctx.connection` 不存在）。
  载荷不存在时不注入（产物退回平台默认模板）。
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
| 桌面壳加载同一份 Web 应用 | `apps/desktop/src/host-process.ts` 以子进程启动 Web 应用并等待其 `ready` 的 `url`，`main.ts` 随后 `loadURL` 该回环地址 | `host-process.ts` / `main.ts` 即证据；桌面与 Web 共用同一 HTTP 服务与路由（无第二套承载层） |

## 交付边界与实测结果

**Windows 产物已在本机真实产出并真实启动**：

| 产物 | 路径 | 实测 |
|---|---|---|
| NSIS 安装包 | `data/packaging/.desktop/<run-id>/unsigned-artifacts/deepseek-harness-0.2.1-rc.2-win-x64-unsigned.exe`（296,932,733 B ≈ 283 MiB） | 产品页一键：`POST /packaging/runs/<id>/desktop-build` → `build-windows.mjs` → 平台 `package:win:x64:unsigned` 全链（`@electron/rebuild` → asar → 原生件 → `nsis` → `.exe.blockmap` 309,390 B） |
| 免安装目录 | 同一运行目录的 `win-unpacked/`（`DeepSeek Harness.exe` 246,329,856 B ≈ 235 MiB + `resources/{app.asar, app.asar.unpacked, runtime, profile-seed}`） | 以隔离 `DSH_HOME` 真实启动：首启载荷装成 `profiles/desktop/`（随包插件在 `profile-seed/plugins/`，首启换回 `node_modules/`），框架层在该 home 建业务库 `soloengine/data/database/soloengine.db` 与主密钥，窗口标题 `DeepSeek Harness`。记录 `test/soloengine/records/stage8-desktop-build.json`（E1–E4 4/4）与 `stage8-desktop-first-launch.json`（L1–L3 3/3） |

本机实测到的层：**机制层**（`npx vitest run apps/desktop/tests` 197 通过）、**编排层**（`prepare-profile.mjs` 的真实副作用 + 前置条件 fail loud）、**产物层**（上表两行）。仍然只交付配置与脚本的是 **macOS DMG**：`package-target.ts` 本身拒绝非 darwin 宿主，故不在本机实测（见 `desktop/macos/README.md`）。

构建期踩到并修掉的平台缺陷（都在本仓库留下了修复）：

1. **载荷冒烟夹具的失效期望**：`apps/desktop/tests/fixtures/runtime-payload-smoke.mjs` 原先无条件 `require('fs-ext')`，而 `fs-ext` 在本仓库整棵依赖图里不存在（无清单、无锁文件条目、无源码引用；文件锁由 `native/system` 的 flock 绑定承担）——任何主机都过不了这一步，Windows 产物因此完全无法产出。现在夹具改为「可解析则验证 seek 契约；不可解析则断言没有任何载荷清单声明它」，并如实输出 `fsExt: "absent"`。
2. **免安装目录只走签名路径**：`package:win:x64:dir` 需要代码签名证书，与 `package:win:x64:unsigned` 不成对。补 `package:win:x64:dir:unsigned`（平台脚本同一口径），编排据此调用。
3. **编排自身的判定与顺序**：预检原先按 `apps/desktop/node_modules/<传递依赖>` 目录名判定（pnpm 布局下传递依赖在 `.pnpm/<pkg>@<ver>/node_modules`），会把已装好的打包器误报成缺失；且自己重列 prepare 步骤并把顺序排错（`prepare:packages` 需要先 `release:pack`）。现在只做「可解析 + app id 必填」的预检，步骤一律委派平台命令。

## 复现命令

```powershell
# 1) 云实例侧打包一次（真实落盘 profile/）
node test/soloengine/profile-release-drill.mjs

# 1b) 产物自包含 + 离线目标机取证（闭包独立重算 / 无符号链接 / 空 home 断网首启）
pnpm run verify-artifact-offline

# 1c) 产物互载矩阵（八类契约 + 任意实例加载 + 第三方插件装入并 boot）
pnpm run verify-interop

# 2) 桌面壳的 profile 与预设固化（真实副作用 + 体检；home 用该运行的私有目录）
node packaging/desktop/prepare-profile.mjs --from data/packaging/<run-id>/profile `
  --home data/packaging/.desktop/<run-id>

# 3) 桌面机制层取证（平台自带 spec）
npx vitest run apps/desktop/tests

# 4) 产出 Windows 产物（安装包 + 免安装目录；需要 electron 二进制与一次联网取 NSIS）
$env:DSH_DESKTOP_APP_ID='com.soloengine.desktop'
$env:DSH_DESKTOP_PROFILE_SEED='data/packaging/.desktop/<run-id>/profiles/desktop'
node packaging/desktop/build-windows.mjs --unsigned

# 5) 容器形态（同一程序、同一条启动路径）
docker build -f packaging/container/Dockerfile `
  --build-arg DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD) -t soloengine:local .
docker run -d --name soloengine -p 8991:8991 -v soloengine-data:/app/data `
  -e SOLOENGINE_HOST=0.0.0.0 soloengine:local
```

