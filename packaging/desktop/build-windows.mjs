#!/usr/bin/env node
/**
 * Windows 桌面产物编排（PRD-11 FR-DEP-006）：NSIS 安装包 + 免安装目录（解包即可运行）。
 *
 * 做法：直接调用平台自带的打包脚本（`apps/desktop/package.json` 的 `package:win:x64` 与
 * `package:win:x64:dir`），不复制其实现。前置依赖缺失时**逐项报出缺什么**并以非零退出，
 * 不静默跳过、不伪造产物（本机缺 Electron 二进制与 electron-builder 运行时依赖，属交付边界，
 * 见 packaging/README.md）。
 *
 * 用法：node packaging/desktop/build-windows.mjs [--unsigned]
 *
 * @module packaging/desktop/build-windows
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const DESKTOP = join(REPO_ROOT, 'apps', 'desktop')
const unsigned = process.argv.includes('--unsigned')

/** 前置条件（逐项核实，缺一项都不继续）。 */
function missingPrerequisites() {
  const missing = []
  const electronManifest = join(DESKTOP, 'node_modules', 'electron', 'package.json')
  if (!existsSync(electronManifest)) {
    missing.push('apps/desktop/node_modules/electron is not installed (run: pnpm install)')
  } else {
    const version = JSON.parse(readFileSync(electronManifest, 'utf8')).version
    if (!existsSync(join(DESKTOP, 'node_modules', 'electron', 'dist'))) {
      missing.push(`electron@${version} has no dist/ binary (its postinstall download did not run; the Windows cache must hold electron-v${version}-win32-x64.zip)`)
    }
  }
  for (const dependency of ['electron-builder', 'app-builder-lib', 'builder-util', 'yargs', 'chalk']) {
    if (!existsSync(join(DESKTOP, 'node_modules', dependency, 'package.json'))) {
      missing.push(`apps/desktop/node_modules/${dependency} is not installed (electron-builder's runtime deps are incomplete)`)
    }
  }
  const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder')
  if (!existsSync(cache)) {
    missing.push(`%LOCALAPPDATA%\\electron-builder is absent: NSIS and winCodeSign are downloaded on first use (needs network once)`)
  }
  if (!existsSync(join(DESKTOP, '.desktop-build'))) {
    missing.push('apps/desktop/.desktop-build is absent: run the prepare steps first (they fetch the Node archive and pack the core tarballs)')
  }
  for (const variable of unsigned ? [] : ['DSH_DESKTOP_APP_ID']) {
    if ((process.env[variable] ?? '') === '') missing.push(`environment variable ${variable} is required (reverse-DNS app id)`)
  }
  return missing
}

const missing = missingPrerequisites()
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

const steps = [
  ['prepare:runtime', '准备内置运行时（Node 归档 + 校验和）'],
  ['prepare:packages', '登记核心包集合（本地 tarball + 摘要）'],
  ['prepare:dsh', '离线安装核心依赖树并封 desktop-runtime.json'],
  [unsigned ? 'package:win:x64:unsigned' : 'package:win:x64', '产出 NSIS 安装包'],
  ['package:win:x64:dir', '产出免安装目录（win-unpacked）'],
]
for (const [script, label] of steps) {
  process.stdout.write(`build-windows: ${label} (pnpm --filter @deepseek-ai/dsh-desktop run ${script})\n`)
  const result = spawnSync('pnpm', ['--filter', '@deepseek-ai/dsh-desktop', 'run', script], {
    cwd: REPO_ROOT, stdio: 'inherit', shell: false,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stderr.write(`build-windows: ${script} exited with ${String(result.status)}; stopping (no silent continue)\n`)
    process.exit(result.status ?? 1)
  }
}
process.stdout.write('build-windows: artifacts are under apps/desktop/.desktop-build/artifacts (installer) and win-unpacked (portable directory)\n')
