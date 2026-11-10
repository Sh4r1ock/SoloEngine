#!/usr/bin/env node
/**
 * Windows 桌面产物编排（PRD-11 FR-DEP-006）：NSIS 安装包 + 免安装目录（解包即可运行）。
 *
 * 做法：只调用平台自带的打包脚本（`apps/desktop/package.json` 的 `package:win:x64` 与
 * `package:win:x64:dir`），不复制其实现、不重排其步骤。前置条件缺失时**逐项报出缺什么**并以
 * 非零退出，不静默跳过、不伪造产物（证据见 packaging/README.md）。
 *
 * 环境：`DSH_DESKTOP_APP_ID` 必填（反向 DNS）；`--unsigned` 产出本地未签名安装包；
 * 首次打包会下载 NSIS 与 winCodeSign 到 `%LOCALAPPDATA%\electron-builder`（需要一次网络）。
 *
 * 用法：node packaging/desktop/build-windows.mjs [--unsigned] [--dir-only]
 *
 * @module packaging/desktop/build-windows
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const DESKTOP = join(REPO_ROOT, 'apps', 'desktop')
const unsigned = process.argv.includes('--unsigned')

/**
 * 前置条件（逐项核实，缺一项都不继续）。
 *
 * 只列「本机真实缺就不可继续」的项：下载缓存（`%LOCALAPPDATA%\electron-builder` 的 NSIS/winCodeSign）
 * 与中间目录（`apps/desktop/.desktop-build`）由下面的步骤自己产出，不属于前置条件。
 * electron-builder 用 pnpm 布局安装，其传递依赖落在 `.pnpm/<pkg>@<ver>/node_modules`，不在
 * `apps/desktop/node_modules` 下，故按**能否解析**判定可用性，不按目录名存在性判定。
 */
function missingPrerequisites() {
  const missing = []
  const electronManifest = join(DESKTOP, 'node_modules', 'electron', 'package.json')
  if (!existsSync(electronManifest)) {
    missing.push('apps/desktop/node_modules/electron is not installed (run: pnpm install)')
  } else {
    const version = JSON.parse(readFileSync(electronManifest, 'utf8')).version
    if (!existsSync(join(DESKTOP, 'node_modules', 'electron', 'dist'))) {
      missing.push(`electron@${version} has no dist/ binary (its postinstall download did not run: node apps/desktop/node_modules/electron/install.js)`)
    }
  }
  const desktopRequire = createRequire(join(DESKTOP, 'package.json'))
  for (const dependency of ['electron-builder', 'app-builder-lib']) {
    try {
      desktopRequire.resolve(dependency)
    } catch {
      missing.push(`apps/desktop/node_modules/${dependency} does not resolve (run: pnpm install)`)
    }
  }
  // 两种模式都要 app id：electron-builder.config.mjs 的 createElectronBuilderConfig 无条件调用
  // resolveDesktopAppId（`--unsigned` 只去掉签名与自动更新，不去掉 app id）。
  if ((process.env.DSH_DESKTOP_APP_ID ?? '') === '') {
    missing.push('environment variable DSH_DESKTOP_APP_ID is required (reverse-DNS app id, e.g. com.example.app)')
  }
  return missing
}

/** pnpm 是否可用（打包步骤全靠它；Windows 上是 `pnpm.cmd`，故经 shell 调用）。 */
function pnpmAvailable() {
  const probe = spawnSync('pnpm --version', { cwd: REPO_ROOT, shell: true, encoding: 'utf8' })
  return probe.status === 0 ? String(probe.stdout).trim() : undefined
}

const missing = missingPrerequisites()
const pnpmVersion = pnpmAvailable()
if (pnpmVersion === undefined) missing.push('pnpm is not on PATH (the prepare and package steps run through pnpm)')
if (missing.length > 0) {
  process.stderr.write([
    'build-windows: prerequisites are not satisfied on this machine; nothing was built (fail loud, no partial artifact):',
    ...missing.map(item => `  - ${item}`),
    '',
    'On a production build host the sequence is:',
    '  pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime',
    '  pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages',
    '  pnpm --filter @deepseek-ai/dsh-desktop run prepare:dsh',
    `  pnpm --filter @deepseek-ai/dsh-desktop run ${unsigned ? 'package:win:x64:unsigned' : 'package:win:x64'}      # NSIS 安装包`,
    '  pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:dir   # 免安装目录（win-unpacked，解包即用）',
    '',
  ].join('\n'))
  process.exit(1)
}
process.stdout.write(`build-windows: prerequisites satisfied (pnpm ${pnpmVersion}); NSIS and winCodeSign are fetched into %LOCALAPPDATA%\\electron-builder on first use\n`)

// `--check` 只做前置核实（CI 与取证脚本用），不进入打包步骤、也不暂存载荷。
if (process.argv.includes('--check')) {
  process.stdout.write('build-windows: --check only; nothing was built\n')
  process.exit(0)
}

// 首启 profile 载荷（PRD-11 FR-DEP-006）：桌面壳在首次启动时把 `profile-seed/` 复制成
// `$DSH_HOME/profiles/desktop`。来源二选一：显式 `DSH_DESKTOP_PROFILE_SEED`（产品页一键封装
// 传的是该运行私有的 desktop profile）优先，否则取本机已暂存的桌面 profile。载荷不存在时不注入。
//
// electron-builder 的文件过滤器**从不复制根 node_modules**，故随包插件在暂存副本里改名为
// `plugins/`，由桌面壳在首次启动时换回 `node_modules/`（`seedDesktopProfile`）。显式来源同样
// 必须经过这一步——否则载荷只剩几个描述文件，插件全部丢失（首启时 bundle 无法解析）。
const dshHome = process.env.DSH_HOME ?? join(REPO_ROOT, 'data', 'dsh-home')
const desktopProfile = join(dshHome, 'profiles', 'desktop')
const stagedSeed = join(dshHome, 'profiles', 'desktop-seed')
const explicitSeed = process.env.DSH_DESKTOP_PROFILE_SEED
const seedSource = explicitSeed === undefined || explicitSeed === ''
  ? existsSync(join(desktopProfile, 'package.json')) ? desktopProfile : undefined
  : resolve(explicitSeed)
let profileSeed
if (seedSource !== undefined) {
  if (!existsSync(join(seedSource, 'package.json'))) {
    process.stderr.write(`build-windows: profile seed ${seedSource} is not a profile directory (package.json missing)\n`)
    process.exit(2)
  }
  rmSync(stagedSeed, { recursive: true, force: true })
  mkdirSync(stagedSeed, { recursive: true })
  for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'soloengine-profile-source.txt']) {
    if (existsSync(join(seedSource, file))) cpSync(join(seedSource, file), join(stagedSeed, file))
  }
  if (existsSync(join(seedSource, 'node_modules'))) {
    cpSync(join(seedSource, 'node_modules'), join(stagedSeed, 'plugins'), { recursive: true })
  }
  profileSeed = stagedSeed
}
const buildEnv = { ...process.env, ...(profileSeed === undefined ? {} : { DSH_DESKTOP_PROFILE_SEED: profileSeed }) }
if (profileSeed === undefined) {
  process.stdout.write('build-windows: no profile seed found; the packaged app starts from the platform template\n')
} else {
  process.stdout.write(`build-windows: profile seed ${profileSeed}\n`)
}

// `--check` 只做前置核实（CI 与取证脚本用），不进入打包步骤。
if (process.argv.includes('--check')) {
  process.stdout.write('build-windows: --check only; nothing was built\n')
  process.exit(0)
}

/**
 * 步骤一律委派平台命令：`apps/desktop/scripts/package-target.ts` 的 main 已实现完整流程
 * （build:official → release:pack dsh → desktop-host pack → release:pack vendor → landlock →
 * prepare:runtime → prepare:packages → prepare:dsh → electron-builder），顺序与依赖由它拥有。
 * 本脚本只做两件事：前置条件 fail loud 核实，与「安装包 + 免安装目录」两个目标的顺序调用。
 * `--dir-only` 只产出免安装目录（CI 与不需要安装包时用，避免 NSIS 下载）。
 */
const dirOnly = process.argv.includes('--dir-only')
const steps = [
  ...dirOnly ? [] : [[unsigned ? 'package:win:x64:unsigned' : 'package:win:x64', '产出 NSIS 安装包（含全部准备步骤）']],
  // 免安装目录也要走同一种签名口径：`--dir` 的默认脚本走签名路径，本地无证书时必须以 unsigned 变体调用。
  [unsigned ? 'package:win:x64:dir:unsigned' : 'package:win:x64:dir', '产出免安装目录（win-unpacked）'],
]
for (const [script, label] of steps) {
  process.stdout.write(`build-windows: ${label} (pnpm --filter @deepseek-ai/dsh-desktop run ${script})\n`)
  const result = spawnSync(`pnpm --filter @deepseek-ai/dsh-desktop run ${script}`, {
    cwd: REPO_ROOT, stdio: 'inherit', shell: true, env: buildEnv,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stderr.write(`build-windows: ${script} exited with ${String(result.status)}; stopping (no silent continue)\n`)
    process.exit(result.status ?? 1)
  }
}
const artifactRoot = (process.env.DSH_DESKTOP_ARTIFACT_ROOT ?? '').trim()
process.stdout.write(artifactRoot === ''
  ? 'build-windows: artifacts are under apps/desktop/.desktop-build/targets/win-x64/{unsigned-artifacts,artifacts}\n'
  : `build-windows: artifacts are published under ${resolve(artifactRoot)}/{unsigned-artifacts,artifacts}\n`)
