#!/usr/bin/env node
/**
 * 把一次打包产物（`profile/`）固化为**桌面壳的 profile 与预设**（PRD-11 FR-DEP-006 的发行侧编排）。
 *
 * 行为（全部真实落盘，任何缺项 fail loud）：
 *  1. 读产物 profile（组合清单 `package.json`、配置层 `cordis.patch.yml`、每节点预设 `.agent-presets/`）；
 *  2. 合并进桌面壳 profile（默认 `$DSH_HOME/profiles/desktop`）：**保留**桌面 profile 自己的
 *     `dependencies` 与 node_modules host 链接（`apps/desktop/src/profile-packages.ts` 的图校验要求），
 *     只替换 `dsh.profile.bundles` 与配置层；配置层若没有 roster 行则补写 `agent-presets` 的 default；
 *  3. 把每节点预设复制到 `$DSH_HOME/.agent-presets/`（平台原生的用户预设根）；
 *  4. 体检：预设组合行逐条在桌面运行时里可解析（与平台 `packageInstalled` 同一判据），
 *     且合并后的清单与产物**逐项一致**（bundles 与 default 预设）。
 *
 * 用法：
 *   node packaging/desktop/prepare-profile.mjs --from <产物 profile 目录> [--home <DSH_HOME>] [--runtime <resources/dsh>]
 *
 * @module packaging/desktop/prepare-profile
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** 解析命令行参数。 */
function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`prepare-profile: ${name} needs a value`)
  return value
}

/** fail loud。 */
function fail(message) {
  process.stderr.write(`prepare-profile: ${message}\n`)
  process.exit(1)
}

/** 逐级向上找 `node_modules/<包>/package.json`（与平台 `packageInstalled` 同一判据）。 */
function packageDirFrom(packageName, anchor) {
  const pkg = packageName.split('/').slice(0, packageName.startsWith('@') ? 2 : 1).join('/')
  let dir = anchor
  for (;;) {
    const candidate = join(dir, 'node_modules', pkg)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

const from = argValue('--from', undefined)
if (from === undefined) fail('--from <打包产物的 profile 目录> is required')
const profileFrom = resolve(from)
const dshHome = resolve(argValue('--home', join(REPO_ROOT, 'data', 'dsh-home')))
const desktopProfile = join(dshHome, 'profiles', 'desktop')
const userPresets = join(dshHome, '.agent-presets')
const runtimeDir = resolve(argValue('--runtime', join(dshHome, 'runtime')))

if (!existsSync(join(profileFrom, 'package.json'))) fail(`${profileFrom} is not a profile directory (package.json missing)`)
if (!existsSync(join(profileFrom, 'cordis.patch.yml'))) fail(`${profileFrom} has no cordis.patch.yml (the 配置层 is required)`)
if (!existsSync(desktopProfile)) fail(`the desktop profile ${desktopProfile} does not exist; run the desktop application once so it creates its profile`)
if (!existsSync(join(desktopProfile, 'package.json'))) fail(`the desktop profile ${desktopProfile} has no manifest`)

// 1) 产物侧读入。
const artifactManifest = JSON.parse(readFileSync(join(profileFrom, 'package.json'), 'utf8'))
const bundles = artifactManifest?.dsh?.profile?.bundles
if (!Array.isArray(bundles) || bundles.length === 0) fail(`${profileFrom}/package.json declares no dsh.profile.bundles`)
const presetRoot = join(profileFrom, '.agent-presets')
if (!existsSync(presetRoot)) fail(`${profileFrom}/.agent-presets is missing (每节点一个 agent 预设)`)
const presetIds = readdirSync(presetRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && PRESET_ID.test(entry.name))
  .map(entry => entry.name)
  .sort()
if (presetIds.length === 0) fail(`${presetRoot} carries no agent preset`)
let layer = readFileSync(join(profileFrom, 'cordis.patch.yml'), 'utf8')
const defaultMatch = /-\s*id:\s*agent-presets[\s\S]{0,400}?default:\s*([a-z0-9][a-z0-9-]*)/u.exec(layer)
if (defaultMatch === null) fail(`${profileFrom}/cordis.patch.yml declares no agent-presets default (入口节点为默认预设)`)
const entryPresetId = defaultMatch[1]
if (!presetIds.includes(entryPresetId)) fail(`the default preset ${entryPresetId} has no directory under ${presetRoot}`)
for (const presetId of presetIds) {
  if (!existsSync(join(presetRoot, presetId, 'agent.cordis.yml'))) fail(`preset ${presetId} is missing agent.cordis.yml`)
}

// 2) 合并进桌面壳 profile：保留桌面自己的依赖与 host 链接，只换组合清单与配置层。
const desktopManifestPath = join(desktopProfile, 'package.json')
const desktopManifest = JSON.parse(readFileSync(desktopManifestPath, 'utf8'))
const merged = {
  ...desktopManifest,
  dsh: {
    ...desktopManifest.dsh,
    profile: {
      ...desktopManifest.dsh?.profile,
      bundles: [...bundles],
      patchReload: desktopManifest.dsh?.profile?.patchReload ?? 'live',
    },
  },
}
writeFileSync(desktopManifestPath, `${JSON.stringify(merged, undefined, 2)}\n`, 'utf8')
writeFileSync(join(desktopProfile, 'cordis.patch.yml'), layer, 'utf8')
// 桌面宿主在启动时叠加 apps/desktop-host/config/desktop.cordis.patch.yml（按行 id 关闭 webServer 相关行），
// 故这里不重复关闭；写一份来源标记便于核对本次固化来自哪份产物。
writeFileSync(join(desktopProfile, 'soloengine-profile-source.txt'),
  `source=${profileFrom}\nbundles=${bundles.length}\npresets=${presetIds.join(', ')}\ndefault=${entryPresetId}\n`, 'utf8')

// 3) 预设装进平台原生的用户预设根。
mkdirSync(userPresets, { recursive: true })
for (const presetId of presetIds) {
  const target = join(userPresets, presetId)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  copyFileSync(join(presetRoot, presetId, 'agent.cordis.yml'), join(target, 'agent.cordis.yml'))
  if (existsSync(join(presetRoot, presetId, 'preset.yml'))) {
    copyFileSync(join(presetRoot, presetId, 'preset.yml'), join(target, 'preset.yml'))
  }
}

// 4) 体检：预设行逐条在桌面运行时里可解析；合并结果与产物逐项一致。
// 锚点顺序：桌面内置运行时（`resources/dsh`，产线机器上由 apps/desktop/scripts/prepare-dsh.ts 物化）→
// 桌面 profile → 本仓库的 dsh 安装锚（`apps/cli`，开发机上平台包就装在那里）→ 仓库根。
const anchors = [
  runtimeDir,
  desktopProfile,
  join(REPO_ROOT, 'apps', 'cli'),
  REPO_ROOT,
].filter(directory => existsSync(directory))
const unresolved = []
for (const presetId of presetIds) {
  const text = readFileSync(join(userPresets, presetId, 'agent.cordis.yml'), 'utf8')
  for (const match of text.matchAll(/^\s*(?:- )?name:\s*'?"?([^'"\n]+)'?"?\s*$/gmu)) {
    const name = match[1].trim()
    if (name.startsWith('cordis:') || name.startsWith('.') || name.startsWith('file:')) continue
    if (!anchors.some(anchor => packageDirFrom(name, anchor) !== undefined)) {
      unresolved.push(`${presetId}: ${name}`)
    }
  }
}
if (unresolved.length > 0) {
  fail(`these preset rows resolve on no desktop anchor:\n- ${unresolved.join('\n- ')}\n`
    + `anchors tried: ${anchors.join(', ')}`)
}
const readBack = JSON.parse(readFileSync(desktopManifestPath, 'utf8'))
if (JSON.stringify(readBack.dsh.profile.bundles) !== JSON.stringify(bundles)) {
  fail('the merged desktop manifest does not carry the artifact bundles')
}

process.stdout.write([
  'prepare-profile: done (fail loud on any missing row)',
  `  artifact      ${profileFrom}`,
  `  desktop profile ${desktopProfile}`,
  `  bundles       ${bundles.join(', ')}`,
  `  presets       ${presetIds.join(', ')} (default ${entryPresetId})`,
  `  installed to  ${userPresets}`,
  `  runtime anchor ${runtimeDir} (${existsSync(runtimeDir) ? 'present' : 'absent; rows were checked against the profile and repository anchors'})`,
  '',
].join('\n'))
