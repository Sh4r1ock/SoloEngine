#!/usr/bin/env node
/**
 * 把一次打包产物（`profile/`）固化为**桌面壳的 profile**（PRD-11 FR-DEP-006 的发行侧编排）。
 *
 * 行为（全部真实落盘，任何缺项 fail loud）：
 *  1. 读产物 profile：组合清单 `package.json`、配置层 `cordis.patch.yml`、闭包清单 `closure.json`；
 *     预设是配置层里的平台原生行（`@deepseek-ai/dsh-agent-preset`），没有独立的预设目录。
 *  2. 桌面 profile（默认 `$DSH_HOME/profiles/desktop`）不存在时以平台自身的 `initProfile` 建立
 *     （web 模板的 bundle 层，随后被产物组合覆盖）——不手写平台清单格式。
 *  3. 合并：**保留**桌面 profile 自己的 `dependencies`、`name`、`version` 与既有 node_modules
 *     （桌面壳的 host 链接与平台包），只替换 `dsh.profile.bundles` 与配置层；产物携带的
 *     非平台插件包（`closure.json` 的 `packages`）逐个补进桌面 profile 的 node_modules，
 *     已存在的包不覆盖（桌面自己的包管理器状态优先）。
 *  4. 体检：`packages` 每一个都落在桌面 profile 内；`platformProvided` 每一个都能在桌面运行时
 *     锚点上解析（内置运行时 → 桌面 profile → 本仓库 dsh 安装锚）；bundle 与默认预设置回读一致。
 *
 * 用法：
 *   node packaging/desktop/prepare-profile.mjs --from <产物 profile 目录> [--home <DSH_HOME>] [--profile <名字>] [--runtime <resources/dsh>]
 *
 * @module packaging/desktop/prepare-profile
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'
const PRESET_REGISTRY_ID = 'agent-preset-registry'

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

/** 根包名（去掉子路径）。 */
function rootPackageName(specifier) {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  return parts[0]
}

/**
 * 工作区包索引（`packages/<group>/<dir>` 与 `vendor/<dir>`）：平台包在 pnpm 严格布局下只链接
 * 在直接依赖方，从运行时/仓库根解析不到；索引只用于判定「它是平台包」，不参与落盘。
 */
function workspacePackageIndex(root) {
  const index = new Set()
  const record = (dir) => {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) return
    try {
      const name = JSON.parse(readFileSync(manifest, 'utf8')).name
      if (typeof name === 'string') index.add(name)
    } catch {
      // 清单不可读的目录不参与索引；被引用时由解析失败报错。
    }
  }
  const groups = join(root, 'packages')
  if (existsSync(groups)) {
    for (const group of readdirSync(groups, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      for (const entry of readdirSync(join(groups, group.name), { withFileTypes: true })) {
        if (entry.isDirectory()) record(join(groups, group.name, entry.name))
      }
    }
  }
  const vendor = join(root, 'vendor')
  if (existsSync(vendor)) {
    for (const entry of readdirSync(vendor, { withFileTypes: true })) {
      if (entry.isDirectory()) record(join(vendor, entry.name))
    }
  }
  return index
}

/** 平台 app-boot 的公共入口（`initProfile` / `PROFILE_TEMPLATES` 来自 dsh 安装，不复制其实现）。 */
async function platformBoot() {
  const requireFromCli = createRequire(join(REPO_ROOT, 'apps', 'cli', 'package.json'))
  const entry = requireFromCli.resolve('@deepseek-ai/dsh-app-boot')
  const loaded = await import(pathToFileURL(entry).href)
  if (typeof loaded.initProfile !== 'function' || loaded.PROFILE_TEMPLATES === undefined) {
    fail(`${entry} does not export initProfile/PROFILE_TEMPLATES; the installed dsh platform is incompatible`)
  }
  return loaded
}

/** 解析产物配置层里的预设声明（顶层 insert 与覆盖行；`!!js` 不在本脚本求值）。 */
function presetDeclarations(patchText, patchPath) {
  // 只读结构事实：每行以 `- id:` / `- name:` 开头（平台的组合行是扁平的 id/name/config 映射）。
  // 预设的 config.plugins 内层行缩进更深，不会被顶层行正则命中。
  const rows = []
  let current
  for (const line of patchText.split(/\r?\n/u)) {
    const idMatch = /^\s*-\s+id:\s*'?"?([^'"\s]+)'?"?\s*$/u.exec(line)
    if (idMatch !== null) {
      current = { id: idMatch[1], name: undefined, configLines: [] }
      rows.push(current)
      continue
    }
    const nameMatch = /^\s+name:\s*'?"?([^'"\s]+)'?"?\s*$/u.exec(line)
    if (nameMatch !== null && current !== undefined && current.name === undefined) {
      current.name = nameMatch[1]
      continue
    }
    if (current !== undefined) current.configLines.push(line)
  }
  const presets = []
  for (const row of rows) {
    if (row.name !== AGENT_PRESET_PACKAGE) continue
    const config = row.configLines.join('\n')
    const id = /^\s+id:\s*'?"?([a-z0-9][a-z0-9-]*)'?"?\s*$/mu.exec(config)?.[1]
    if (id === undefined) fail(`${patchPath}: row ${row.id} declares an agent preset without config.id`)
    presets.push({ rowId: row.id, id })
  }
  const registry = rows.find(row => row.id === PRESET_REGISTRY_ID)
  if (registry === undefined) fail(`${patchPath} declares no ${PRESET_REGISTRY_ID} row`)
  const entryPresetId = /^\s+default:\s*'?"?([a-z0-9][a-z0-9-]*)'?"?\s*$/mu.exec(registry.configLines.join('\n'))?.[1]
  if (entryPresetId === undefined) fail(`${patchPath} declares no ${PRESET_REGISTRY_ID} default`)
  return { presets, entryPresetId }
}

const from = argValue('--from', undefined)
if (from === undefined) fail('--from <打包产物的 profile 目录> is required')
const profileFrom = resolve(from)
const dshHome = resolve(argValue('--home', join(REPO_ROOT, 'data', 'dsh-home')))
const profileName = argValue('--profile', 'desktop')
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(profileName) || profileName.includes('..')) {
  fail(`--profile ${JSON.stringify(profileName)} must be a single path segment (letters, digits, dot, dash, underscore)`)
}
const desktopProfile = join(dshHome, 'profiles', profileName)
const runtimeDir = resolve(argValue('--runtime', join(dshHome, 'runtime')))

if (!existsSync(join(profileFrom, 'package.json'))) fail(`${profileFrom} is not a profile directory (package.json missing)`)
if (!existsSync(join(profileFrom, 'cordis.patch.yml'))) fail(`${profileFrom} has no cordis.patch.yml (the 配置层 is required)`)
if (!existsSync(join(profileFrom, 'closure.json'))) {
  fail(`${profileFrom} has no closure.json (产物必须列明随包插件与平台提供的包)`)
}

// 1) 产物侧读入。
const artifactManifest = JSON.parse(readFileSync(join(profileFrom, 'package.json'), 'utf8'))
const bundles = artifactManifest?.dsh?.profile?.bundles
if (!Array.isArray(bundles) || bundles.length === 0) fail(`${profileFrom}/package.json declares no dsh.profile.bundles`)
const layer = readFileSync(join(profileFrom, 'cordis.patch.yml'), 'utf8')
const { presets, entryPresetId } = presetDeclarations(layer, join(profileFrom, 'cordis.patch.yml'))
if (presets.length === 0) fail(`${profileFrom}/cordis.patch.yml declares no ${AGENT_PRESET_PACKAGE} row`)
if (!presets.some(preset => preset.id === entryPresetId)) {
  fail(`the default preset ${entryPresetId} is not declared by any ${AGENT_PRESET_PACKAGE} row`)
}
const closure = JSON.parse(readFileSync(join(profileFrom, 'closure.json'), 'utf8'))
const bundled = (closure?.packages ?? []).map(entry => String(entry.name))
const platformProvided = (closure?.platformProvided ?? []).map(name => String(name))
if (bundled.length === 0) fail(`${profileFrom}/closure.json lists no bundled package`)

// 2) 桌面 profile：不存在则由平台 `initProfile` 建立（web 模板的 bundle 层随后被产物覆盖）。
const boot = await platformBoot()
if (!existsSync(join(desktopProfile, 'package.json'))) {
  mkdirSync(dirname(desktopProfile), { recursive: true })
  boot.initProfile(desktopProfile, boot.PROFILE_TEMPLATES.web.bundles)
  // 平台在首次启动时写根配置；发行侧固化必须在应用启动前给出同一个空入口根（组合全在 patch 层）。
  writeFileSync(join(desktopProfile, 'cordis.yml'), '# dsh profile root — an empty entry list.\n[]\n', 'utf8')
}

// 3) 合并：保留桌面自己的依赖与 node_modules，只换组合清单与配置层。
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

/**
 * 桌面形态的数据根（PRD-11 FR-DEP-006）：产品数据落在用户 harness home 下的私有实例目录，
 * 不依赖启动环境变量（exe 用户不配置环境）。云实例保持产物原样：其组合层由启动器给出 env。
 * `dshHomePath` 是平台 Loader 在 `!!js` 里提供的同一函数（`$DSH_HOME` 优先）。
 *
 * 数据库形态同理：产物恒为单机（其配置层已把三个 PostgreSQL 流程级插件整组换成 SQLite），
 * 宿主行的 `databaseForm` 固定为 `single`，云形态连接串整行移除——桌面载荷不读也不该读它。
 * 执行世界同理：桌面只有宿主执行器，shell 行的 `SOLOENGINE_EXECUTOR` 判断按宿主平台定值。
 */
const DESKTOP_ENGINE_PATHS = [
  [/(\broot:\s*)!!js\s+process\.env\.SOLOENGINE_ROOT\b/gu, "$1!!js dshHomePath('soloengine')"],
  [/(\bdatabasePath:\s*)!!js\s+process\.env\.SOLOENGINE_DB\b/gu, "$1!!js dshHomePath('soloengine', 'data', 'database', 'soloengine.db')"],
  [/(\bpath:\s*)!!js\s+process\.env\.SOLOENGINE_DB\b/gu, "$1!!js dshHomePath('soloengine', 'data', 'database', 'soloengine.db')"],
  [/(\bdbPath:\s*)!!js\s+process\.env\.SOLOENGINE_DB\b/gu, "$1!!js dshHomePath('soloengine', 'data', 'database', 'soloengine.db')"],
  [/(\bkeysDir:\s*)!!js\s+process\.env\.SOLOENGINE_KEYS_DIR\b/gu, "$1!!js dshHomePath('soloengine', 'data', 'home', 'keys')"],
  [/(-\s*)!!js\s+process\.env\.SOLOENGINE_SKILLS_DIR\b/gu, "$1!!js dshHomePath('soloengine', 'data', 'skills')"],
  [/^(\s*)databaseForm:\s*!!js\s+process\.env\.SOLOENGINE_DB_FORM\s*$/gmu, '$1databaseForm: single'],
  [/^\s*databaseUrl:\s*!!js\s+process\.env\.SOLOENGINE_DATABASE_URL\s*\r?\n/gmu, ''],
  // 桌面的执行世界就是宿主进程（没有容器执行器可装配）：`SOLOENGINE_EXECUTOR` 的三元表达式
  // 在桌面恒取宿主平台，等价于按 `local` 求值。
  [/\(process\.env\.SOLOENGINE_EXECUTOR \?\? 'local'\) !== 'local' \? 'linux' : process\.platform/gu, 'process.platform'],
  // 会话日志介质在桌面上与「未设置 SOLOENGINE_SESSION_MEDIA」同义：SQLite 行启用、JSONL 行停用。
  [/^(\s*)disabled:\s*!!js\s+process\.env\.SOLOENGINE_SESSION_MEDIA === 'jsonl'\s*$/gmu, '$1disabled: false'],
  [/^(\s*)disabled:\s*!!js\s+process\.env\.SOLOENGINE_SESSION_MEDIA !== 'jsonl'\s*$/gmu, '$1disabled: true'],
]
let desktopLayer = layer
for (const [pattern, replacement] of DESKTOP_ENGINE_PATHS) desktopLayer = desktopLayer.replace(pattern, replacement)
if (desktopLayer.includes('process.env.SOLOENGINE_')) {
  fail(`${profileFrom}/cordis.patch.yml still binds SOLOENGINE_* environment variables the desktop payload cannot provide`)
}
writeFileSync(join(desktopProfile, 'cordis.patch.yml'), desktopLayer, 'utf8')

/**
 * 把产物携带的包补进桌面 profile 的 node_modules：只补缺失项，已存在（桌面自己装的）不覆盖。
 * 作用域目录（`@scope`）逐个子项判断，避免整目录存在就跳过整族包。
 */
const copied = []
const artifactsModules = join(profileFrom, 'node_modules')
const desktopModules = join(desktopProfile, 'node_modules')
mkdirSync(desktopModules, { recursive: true })
for (const name of bundled) {
  const segments = name.split('/')
  const source = join(artifactsModules, ...segments)
  const target = join(desktopModules, ...segments)
  if (!existsSync(join(source, 'package.json'))) {
    fail(`the artifact does not carry ${name} under ${artifactsModules} (closure.json and node_modules disagree)`)
  }
  if (existsSync(join(target, 'package.json'))) continue
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, force: true })
  copied.push(name)
}
writeFileSync(join(desktopProfile, 'soloengine-profile-source.txt'), [
  `source=${profileFrom}`,
  `bundles=${bundles.length}`,
  `presets=${presets.map(preset => preset.id).join(', ')}`,
  `default=${entryPresetId}`,
  `copied=${copied.length}`,
  '',
].join('\n'), 'utf8')

// 4) 体检：随包插件在桌面 profile 内；平台包在桌面运行时锚点上可解析；回读一致。
const anchors = [runtimeDir, desktopProfile, join(REPO_ROOT, 'apps', 'cli'), REPO_ROOT]
  .filter(directory => existsSync(directory))
const missingBundled = bundled.filter(name => !existsSync(join(desktopModules, ...name.split('/'), 'package.json')))
if (missingBundled.length > 0) {
  fail(`these bundled packages are absent from ${desktopModules}:\n- ${missingBundled.join('\n- ')}`)
}
const workspaceIndex = workspacePackageIndex(REPO_ROOT)
const unresolvedPlatform = platformProvided.filter(name => !anchors.some(anchor => packageDirFrom(name, anchor) !== undefined)
  && !workspaceIndex.has(rootPackageName(name)))
if (unresolvedPlatform.length > 0) {
  fail(`these platform packages resolve on no desktop anchor:\n- ${unresolvedPlatform.join('\n- ')}\n`
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
  `  presets       ${presets.map(preset => preset.id).join(', ')} (default ${entryPresetId})`,
  `  bundled       ${bundled.length} packages (${copied.length} copied into the desktop profile)`,
  `  platform      ${platformProvided.length} packages provided by the desktop runtime`,
  `  runtime anchor ${runtimeDir} (${existsSync(runtimeDir) ? 'present' : 'absent; platform packages were checked against the profile and repository anchors'})`,
  '',
].join('\n'))
