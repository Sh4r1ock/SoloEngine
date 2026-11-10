/**
 * 打包产物中的插件包本体（Plan W5：产物自包含、与基线解耦）。
 *
 * 平台包（`@deepseek-ai/dsh-*`、`vendor/` 下的 cordis 族）由目标机的 dsh 安装提供，
 * 不入产物；产品包（`packages/soloengine/**`）、第三方组合包与它们通过
 * `dependencies` 传递到的非平台包全部复制进产物的 `profile/node_modules`，使目标机
 * **无需安装 `@soloengine/*`** 即可装载该 profile。
 *
 * 复制按包目录进行：保留运行期文件（`lib/`、`locale/`、`skills/`、`cordis.patch.yml` 等），
 * 排除 `src/`、`tests/`、`node_modules/`、sourcemap 与 tsconfig。每个包的主入口缺失即
 * fail loud（先构建再打包）。
 *
 * @module @soloengine/framework/modules/packaging-assets
 */

import { builtinModules, createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep, basename } from 'node:path'
import { FrameworkError } from './accounts.ts'

/** 一个被复制进产物的包。 */
export interface MaterializedPackage {
  /** 包名。 */
  name: string
  /** 包版本。 */
  version: string
  /** 来源目录（便于核对；产物内不再引用它）。 */
  source: string
  /** 复制后的相对路径（`node_modules/<name>`）。 */
  path: string
}

/** 一个由目标机 dsh 安装提供的平台包（不复制进产物）。 */
export interface MaterializedPlatformPackage {
  /** 包名。 */
  name: string
  /** 包清单版本（目标机应提供的版本，预览逐行展示）。 */
  version: string
}

/** 一次依赖固化的结果。 */
export interface MaterializedDependencies {
  /** 复制进产物的包（按包名排序）。 */
  packages: MaterializedPackage[]
  /** 由目标机 dsh 安装提供的平台包（不复制，按包名排序）。 */
  platform: MaterializedPlatformPackage[]
  /** 产物内 node_modules 目录。 */
  nodeModules: string
}

/** 所有包都跳过的目录（运行期无关）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage'])

/** 仓库内包额外跳过的源码/测试目录（外部 npm 包可能把入口放在 `src/`，不跳）。 */
const SOURCE_DIRS = new Set(['src', 'tests', 'test', '__tests__'])

/**
 * `src/` 下仍需随包携带的运行期数据资产（编译产物按源码相对位置读取它们）。
 *
 * 例如框架的 `src/db/schema.sql`：`lib/types/db/index.js` 就在 `src/db/schema.sql` 处找它；
 * 只跳过源码文件、保留数据文件，产物才能在不带源码的前提下打开业务库。
 */
const SOURCE_ASSET_SUFFIXES = ['.sql', '.json', '.yaml', '.yml', '.txt']

/** 复制时跳过的文件后缀（sourcemap 与增量构建信息）。 */
const SKIP_SUFFIXES = ['.map', '.tsbuildinfo']

/** Node 内建模块名集合（`node:` 前缀另行判断）。 */
const BUILTINS = new Set(builtinModules)

/** 解析一个包名到包目录：被依赖包的自身目录优先，其次 profile 本地 node_modules，最后仓库根。 */
export interface PackageResolver {
  /**
   * @param name - 包名。
   * @param fromDir - 发起解析的包目录（pnpm 把每个包的依赖放在它自己的解析链上）。
   * @returns 包目录绝对路径，解析不到时 undefined。
   */
  (name: string, fromDir?: string): string | undefined
}

/**
 * 构造包解析器。
 *
 * pnpm 的严格布局下，一个包的依赖只从它自己的目录可解析（`node_modules/.pnpm/<pkg>/node_modules`），
 * 因此依赖闭包必须带 `fromDir` 逐层解析；bundle/组合行这类起点从 profile 与仓库根解析，
 * 最后用工作区索引兜底——平台包只链接在直接依赖方的 node_modules 里，仓库根通常看不到它。
 * @param root - 仓库/实例根目录。
 * @param profileDir - 当前实例的 profile 目录（第三方包安装在这里）。
 * @param index - 包名 → 包目录的工作区索引（可选兜底）。
 * @returns 解析器。
 */
export function packageResolver(root: string, profileDir: string, index?: ReadonlyMap<string, string>): PackageResolver {
  const anchors = [profileDir, root]
  const cache = new Map<string, string | undefined>()

  /** 从一个锚点目录解析包目录：入口解析 + 包目录回溯，最后退回手写 node_modules 上溯。 */
  const resolveFrom = (anchorDir: string, name: string): string | undefined => {
    const key = `${anchorDir}\0${name}`
    if (cache.has(key)) return cache.get(key)
    let found: string | undefined
    const require = createRequire(join(anchorDir, 'package.json'))
    for (const specifier of [`${name}/package.json`, name]) {
      let entry: string
      try {
        entry = require.resolve(specifier)
      } catch {
        continue
      }
      let dir = dirname(entry)
      for (let depth = 0; depth < 8; depth += 1) {
        if (existsSync(join(dir, 'package.json'))) {
          found = dir
          break
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      if (found !== undefined) break
    }
    if (found === undefined) {
      let dir = anchorDir
      for (;;) {
        if (basename(dir) !== 'node_modules') {
          const candidate = join(dir, 'node_modules', ...name.split('/'))
          if (existsSync(join(candidate, 'package.json'))) {
            found = candidate
            break
          }
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    }
    cache.set(key, found)
    return found
  }

  return (name: string, fromDir?: string): string | undefined => {
    if (fromDir !== undefined) {
      const direct = resolveFrom(fromDir, name)
      if (direct !== undefined) return direct
    }
    for (const anchor of anchors) {
      const found = resolveFrom(anchor, name)
      if (found !== undefined) return found
    }
    return index?.get(name)
  }
}

/**
 * 工作区包索引：`packages/<group>/<dir>`、`vendor/<dir>` 与根部的 `soloengine-framework`。
 *
 * 平台包在 pnpm 严格布局下只链接在直接依赖方的 `node_modules`，从仓库根或 profile 解析不到；
 * 打包器需要按包名找到它们的真实目录（只读，不复制平台包）。
 * @param root - 仓库根目录。
 * @returns 包名 → 包目录。
 */
export function workspacePackageIndex(root: string): Map<string, string> {
  const index = new Map<string, string>()
  const record = (dir: string): void => {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) return
    try {
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name
      if (typeof name === 'string' && !index.has(name)) index.set(name, dir)
    } catch {
      // 清单不可读的目录不参与索引；被引用时由解析失败报错。
    }
  }
  const groups = join(root, 'packages')
  if (existsSync(groups)) {
    for (const group of readdirSync(groups, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const groupDir = join(groups, group.name)
      for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
        if (entry.isDirectory()) record(join(groupDir, entry.name))
      }
    }
  }
  const vendor = join(root, 'vendor')
  if (existsSync(vendor)) {
    for (const entry of readdirSync(vendor, { withFileTypes: true })) {
      if (entry.isDirectory()) record(join(vendor, entry.name))
    }
  }
  record(join(root, 'soloengine-framework'))
  return index
}

/**
 * 包名 → 根包名（去掉子路径与 `node:` 前缀区分）。
 * @param specifier - 组合行里的包名或依赖名。
 * @returns 根包名；内建模块原样返回。
 */
export function rootPackageName(specifier: string): string {
  if (specifier.startsWith('node:') || BUILTINS.has(specifier)) return specifier
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0] as string}/${parts[1] as string}` : specifier
  return parts[0] as string
}

/**
 * `vendor/` 下固化的 cordis 族包名：无论从仓库还是 profile 的 node_modules 解析到，
 * 都由目标机的 dsh 安装提供（与基线同源，避免产物里出现第二份实例）。
 * @param root - 仓库根目录。
 * @returns 包名集合。
 */
function vendorPackageNames(root: string): Set<string> {
  const names = new Set<string>()
  const vendor = join(root, 'vendor')
  if (!existsSync(vendor)) return names
  for (const entry of readdirSync(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = join(vendor, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name
      if (typeof name === 'string') names.add(name)
    } catch {
      // 读取失败的 vendor 包不参与平台判定；它若被组合引用会在解析阶段单独报错。
    }
  }
  return names
}

/**
 * 平台包判定：目标机 dsh 安装自带、不进入产物。
 *
 * 判定依据是包名（`vendor/` 固化族）与包目录位置（`packages/` 下的 `@deepseek-ai/` 基线包），
 * 而不是包名前缀——SoloEngine 的产品包同样位于 `packages/` 下。
 * @param root - 仓库根目录。
 * @param vendorNames - `vendor/` 包名集合。
 * @param name - 包名。
 * @param dir - 解析到的包目录。
 * @returns 是否由目标机安装提供。
 */
function isPlatformPackage(root: string, vendorNames: ReadonlySet<string>, name: string, dir: string): boolean {
  if (name.startsWith('node:') || BUILTINS.has(name)) return true
  if (vendorNames.has(name)) return true
  const inside = relative(root, dir)
  if (inside.startsWith('..') || inside.startsWith(sep)) return false
  const segments = inside.split(sep)
  if (segments[0] === 'vendor') return true
  if (segments[0] === 'packages' && name.startsWith('@deepseek-ai/')) return true
  return false
}

/** 读取包的 `package.json`（解析失败即 fail loud：产物无法判定依赖）。 */
function readManifest(dir: string, name: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new FrameworkError(500, 'PACKAGING_PACKAGE_INVALID',
      `packaged dependency ${name} at ${dir} has no readable package.json: ${String(error)}`)
  }
}

/**
 * 仓库内的产品/基线包（`packages/**`、`vendor/**`、`soloengine-framework`）。
 *
 * 这些包的源码与测试不进入产物；`node_modules` 里的外部安装包可能把入口放在 `src/`，
 * 必须原样复制。
 * @param root - 仓库根目录。
 * @param dir - 包目录。
 * @returns 是否仓库内包。
 */
function isWorkspacePackage(root: string, dir: string): boolean {
  const inside = relative(root, dir)
  if (inside === '' || inside.startsWith('..') || /^[A-Za-z]:/u.test(inside)) return false
  const top = inside.split(sep)[0]
  return top === 'packages' || top === 'vendor' || top === 'soloengine-framework'
}

/** 递归复制一个包目录，跳过依赖树、仓库内源码/测试与 sourcemap。 */
function copyPackageDir(from: string, to: string, workspace: boolean): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory() && workspace && SOURCE_DIRS.has(entry.name)) {
      // 源码/测试目录只保留运行期数据资产（`node_modules` 明细另行跳过）。
      if (entry.name === 'src') copySourceAssets(source, target)
      continue
    }
    if (entry.isFile() && SKIP_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue
    if (entry.isDirectory()) copyPackageDir(source, target, workspace)
    else if (entry.isFile()) cpSync(source, target)
  }
}

/** 复制 `src/` 树里的运行期数据资产（见 {@link SOURCE_ASSET_SUFFIXES}），不复制源码与测试。 */
function copySourceAssets(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      copySourceAssets(source, target)
      continue
    }
    if (!SOURCE_ASSET_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) continue
    // 目录按需创建：没有运行期资产的包不该在产物里留下空的 `src/`。
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target)
  }
}

/** 按 Node 的扩展名规则判定入口文件存在（`main: ./index` 指向 `index.js` 也成立）。 */
function runtimeEntryExists(packageDir: string, main: string): boolean {
  const base = join(packageDir, main)
  if (existsSync(base) && !statSync(base).isDirectory()) return true
  for (const suffix of ['.js', '.json', '.node']) {
    if (existsSync(`${base}${suffix}`)) return true
  }
  for (const suffix of ['index.js', 'index.json', 'index.node']) {
    if (existsSync(join(base, suffix))) return true
  }
  return false
}

/** 校验包的主入口在复制后的目录里存在（缺构建即拒绝打包）。 */
function assertRuntimeEntry(name: string, packageDir: string): void {
  const manifest = readManifest(packageDir, name)
  const main = typeof manifest.main === 'string' ? manifest.main : undefined
  if (main !== undefined && main.trim() !== '' && !runtimeEntryExists(packageDir, main)) {
    throw new FrameworkError(500, 'PACKAGING_PACKAGE_UNBUILT',
      `packaged dependency ${name} declares main ${main} but ${packageDir} lacks it; run the build before packaging`)
  }
}

/**
 * 平台包的清单版本（平台包不复制进产物，但预览要给出目标机需提供的版本）。
 * @param name - 包名（错误定位）。
 * @param packageDir - 解析到的包目录。
 * @returns 清单版本；清单没写版本时与随包复制同一口径取 `0.0.0`。
 */
function platformPackageVersion(name: string, packageDir: string): string {
  const manifest = readManifest(packageDir, name)
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * 把组合里非平台的插件包及其依赖闭包复制进产物 profile 的 `node_modules`。
 *
 * 起点 = profile 的 bundle 包 + 实例组合行声明的包；沿每个待复制包的 `dependencies`
 * 递归收集（`peerDependencies` 属目标机运行时契约，不复制）。闭包内的平台包记录在
 * `platform` 中供核对；复制完成后重新读取产物，逐个校验非平台依赖在产物内可解析，
 * 缺失即拒绝打包（PACKAGING_DEPENDENCY_UNRESOLVED）。
 * @param options - 仓库根、产物 profile、bundle 名与组合行包名。
 * @returns 复制结果（包清单 + 平台包清单）。
 */
export function materializeDependencies(options: {
  root: string
  /** 当前实例的 profile 目录（第三方 bundle 的安装位置）。 */
  sourceProfileDir: string
  /** 产物 profile 目录。 */
  targetProfileDir: string
  /** profile 的 bundle 包名。 */
  bundles: readonly string[]
  /** 实例组合行的包名（含子路径，按根包名解析）。 */
  rowPackages: readonly string[]
  /**
   * `copy` 落盘复制（打包运行）；`plan` 只解析闭包不复制（预览，用于「产物清单=预览清单」）。
   * @default 'copy'
   */
  mode?: 'copy' | 'plan'
}): MaterializedDependencies {
  const { root, sourceProfileDir, targetProfileDir } = options
  const mode = options.mode ?? 'copy'
  const resolve = packageResolver(root, sourceProfileDir, workspacePackageIndex(root))
  const vendorNames = vendorPackageNames(root)
  const nodeModules = join(targetProfileDir, 'node_modules')
  const copied = new Map<string, MaterializedPackage>()
  const platform = new Map<string, MaterializedPlatformPackage>()
  const missing: string[] = []

  const visit = (rawName: string, fromDir?: string): void => {
    const name = rootPackageName(rawName)
    if (name.startsWith('node:') || BUILTINS.has(name)) return
    // 类型声明包只在编译期使用，运行期不解析。
    if (name.startsWith('@types/')) return
    if (copied.has(name) || platform.has(name)) return
    const dir = resolve(name, fromDir)
    if (dir === undefined) {
      missing.push(fromDir === undefined ? name : `${name} (required by ${fromDir})`)
      return
    }
    if (isPlatformPackage(root, vendorNames, name, dir)) {
      platform.set(name, { name, version: platformPackageVersion(name, dir) })
      return
    }
    const manifest = readManifest(dir, name)
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
    const target = join(nodeModules, ...name.split('/'))
    if (mode === 'copy') {
      copyPackageDir(dir, target, isWorkspacePackage(root, dir))
      assertRuntimeEntry(name, target)
    } else {
      assertRuntimeEntry(name, dir)
    }
    copied.set(name, { name, version, source: dir, path: `node_modules/${name}` })
    const dependencies = manifest.dependencies
    if (dependencies !== null && typeof dependencies === 'object') {
      for (const dependency of Object.keys(dependencies as Record<string, unknown>)) visit(dependency, dir)
    }
  }

  for (const bundle of options.bundles) visit(bundle)
  for (const row of options.rowPackages) visit(row)
  if (missing.length > 0) {
    throw new FrameworkError(500, 'PACKAGING_DEPENDENCY_UNRESOLVED',
      `packaging refused: these composition packages do not resolve on this installation: ${[...new Set(missing)].sort().join(', ')}`)
  }

  // 复制后重新读取产物：每个已复制包的非平台运行时依赖必须在产物内可解析。
  const unresolved: string[] = []
  if (mode === 'copy') {
    for (const entry of copied.values()) {
      const manifest = readManifest(join(targetProfileDir, entry.path), entry.name)
      const dependencies = manifest.dependencies
      if (dependencies === null || typeof dependencies !== 'object') continue
      for (const dependency of Object.keys(dependencies as Record<string, unknown>)) {
        const depName = rootPackageName(dependency)
        if (depName.startsWith('node:') || BUILTINS.has(depName) || depName.startsWith('@types/')) continue
        if (platform.has(depName) || copied.has(depName)) continue
        unresolved.push(`${entry.name} → ${depName}`)
      }
    }
  }
  if (unresolved.length > 0) {
    throw new FrameworkError(500, 'PACKAGING_DEPENDENCY_UNRESOLVED',
      `packaging refused: the artifact misses runtime dependencies: ${unresolved.join(', ')}`)
  }

  return {
    packages: [...copied.values()].sort((left, right) => left.name.localeCompare(right.name)),
    platform: [...platform.values()].sort((left, right) => left.name.localeCompare(right.name)),
    nodeModules,
  }
}

/** 统计产物 node_modules 的文件数与字节数（读回校验用）。 */
export function measureNodeModules(nodeModules: string): { files: number; bytes: number } {
  if (!existsSync(nodeModules)) return { files: 0, bytes: 0 }
  let files = 0
  let bytes = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        files += 1
        bytes += statSync(path).size
      }
    }
  }
  walk(nodeModules)
  return { files, bytes }
}

/** 产物闭包中的一个包：文件数、字节数与内容摘要（Plan W5 / R143）。 */
export interface ClosurePackage {
  /** 包名。 */
  name: string
  /** 包版本。 */
  version: string
  /** 文件数（符号链接计一个）。 */
  files: number
  /** 普通文件字节数（符号链接不计）。 */
  bytes: number
  /** 包内容摘要（见 {@link packageDigest}）。 */
  sha256: string
}

/**
 * 产物闭包清单（`profile/closure.json`）。
 *
 * 自包含的判据是**可核对**而不是声明：逐包文件数与内容摘要都写进清单，读回时重算比对；
 * 同时把「有意不携带」的两类依赖写清楚——平台包由目标机的 dsh 安装提供（`platformProvided`），
 * 对等契约与单机形态不引入的可选依赖（PostgreSQL 变体）分别登记。
 */
export interface ClosureManifest {
  schemaVersion: 1
  granularity: string
  packages: ClosurePackage[]
  totals: { packages: number; files: number; bytes: number; sha256: string }
  platformProvided: string[]
  /** 每个随包插件声明的对等依赖（由目标机基线提供）。 */
  peerContracts: Record<string, Record<string, string>>
  /** 有意不携带的可选依赖（`<包> -> <依赖>`）。 */
  optionalContracts: string[]
}

/** 闭包清单里不允许出现的凭据载体文件（发行闭包不该带任何包管理器凭据）。 */
const CLOSURE_CREDENTIAL_FILES = new Set(['.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '.pypirc', 'auth.json'])

/** 凭据载体文件里不允许出现的令牌键名。 */
const CLOSURE_CREDENTIAL_MARKERS = /(?:_authToken|npmAuthToken|NPM_TOKEN|:_auth\b)/u

/** 会被当作配置文本扫描的扩展名（二进制不读）。 */
const CLOSURE_TEXT_SUFFIXES = ['.json', '.yaml', '.yml', '.txt', '.toml', '.ini', '.cfg']

/**
 * 一个包目录的内容摘要：按相对路径排序，逐文件累计 `路径 + 大小 + 文件摘要`。
 * 符号链接只摘要链接目标、不跟随（产物里出现符号链接本身即被 {@link verifyClosureManifest} 拒绝）。
 * @param packageDir - 包目录。
 * @returns 文件数、字节数与摘要。
 */
function packageDigest(packageDir: string): { files: number; bytes: number; sha256: string; links: string[] } {
  const rows: string[] = []
  const links: string[] = []
  let files = 0
  let bytes = 0
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      const rel = relative(packageDir, path).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        links.push(rel)
        rows.push(`${rel}\0link:${readlinkSync(path)}`)
        files += 1
        continue
      }
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.isFile()) continue
      const body = readFileSync(path)
      rows.push(`${rel}\0${String(body.length)}\0${createHash('sha256').update(body).digest('hex')}`)
      files += 1
      bytes += body.length
    }
  }
  walk(packageDir)
  return { files, bytes, sha256: createHash('sha256').update(rows.join('\n')).digest('hex'), links }
}

/** 读取包清单；不可读即抛错（产物无法核对）。 */
function readPackageJson(packageDir: string, name: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH',
      `closure package ${name} at ${packageDir} has no readable package.json: ${String(error)}`)
  }
}

/** 一个包的 `<依赖名> -> <版本范围>` 映射（只取字符串值）。 */
function dependencyRangeMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * 计算闭包清单（不落盘）：逐包文件数/字节数/摘要 + 总量摘要，外加对等与可选依赖声明。
 * @param targetProfileDir - 产物 profile 目录（`node_modules` 已就位）。
 * @param materialized - 依赖固化结果（包集合与平台清单）。
 * @returns 清单。
 */
export function buildClosureManifest(targetProfileDir: string, materialized: MaterializedDependencies): ClosureManifest {
  const packages: ClosurePackage[] = []
  const peerContracts: Record<string, Record<string, string>> = {}
  const optionalContracts = new Set<string>()
  for (const entry of materialized.packages) {
    const dir = join(targetProfileDir, entry.path)
    if (!existsSync(join(dir, 'package.json'))) {
      throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH',
        `closure package ${entry.name} is absent at ${dir}; the artifact is not self-contained`)
    }
    const digest = packageDigest(dir)
    if (digest.links.length > 0) {
      throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH',
        `closure package ${entry.name} carries symbolic links (${digest.links.slice(0, 3).join(', ')}); `
        + 'an artifact must resolve every plugin from its own files')
    }
    packages.push({ name: entry.name, version: entry.version, files: digest.files, bytes: digest.bytes, sha256: digest.sha256 })
    const manifest = readPackageJson(dir, entry.name)
    const peers = dependencyRangeMap(manifest.peerDependencies)
    if (Object.keys(peers).length > 0) peerContracts[entry.name] = peers
    for (const optional of Object.keys(dependencyRangeMap(manifest.optionalDependencies))) {
      optionalContracts.add(`${entry.name} -> ${optional}`)
    }
  }
  packages.sort((left, right) => left.name.localeCompare(right.name))
  const totals = {
    packages: packages.length,
    files: packages.reduce((sum, entry) => sum + entry.files, 0),
    bytes: packages.reduce((sum, entry) => sum + entry.bytes, 0),
    sha256: createHash('sha256')
      .update(packages.map(entry => `${entry.name}@${entry.version}\0${entry.sha256}`).join('\n'))
      .digest('hex'),
  }
  return {
    schemaVersion: 1,
    granularity: 'artifact closure: every non-platform composition package and its runtime dependencies are copied into '
      + 'profile/node_modules; platform packages (dsh baseline) stay with the target installation; optional PostgreSQL '
      + 'variants are recorded and deliberately not carried',
    packages,
    totals,
    platformProvided: materialized.platform.map(entry => entry.name).sort(),
    peerContracts,
    optionalContracts: [...optionalContracts].sort(),
  }
}

/**
 * 写入产物闭包清单（`profile/closure.json`）。
 * @param targetProfileDir - 产物 profile 目录。
 * @param materialized - 依赖固化结果。
 * @returns 清单文件路径。
 */
export function writeClosureManifest(targetProfileDir: string, materialized: MaterializedDependencies): string {
  const manifest = buildClosureManifest(targetProfileDir, materialized)
  const path = join(targetProfileDir, 'closure.json')
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
  return path
}

/**
 * 读回校验产物闭包：重算逐包摘要与总量，并与 `closure.json` 的包清单对账。
 *
 * 闭包清单是产物自包含的**唯一**清单真源：包集合、逐包文件数/字节数/摘要、
 * 总量摘要、平台提供清单都在同一个文件里，不再维护第二份 `dependencies.json`。
 * 任一不一致（包缺失/多出/内容变化/符号链接）都拒绝产物。
 * @param targetProfileDir - 产物 profile 目录。
 * @param options - `required=false` 时允许旧产物没有清单（仅提示，不报错）。
 * @returns 核对结果。
 */
export function verifyClosureManifest(
  targetProfileDir: string,
  options: { required: boolean },
): { verified: boolean; packages: number; files: number; bytes: number; sha256: string } {
  const path = join(targetProfileDir, 'closure.json')
  if (!existsSync(path)) {
    if (options.required) {
      throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISSING',
        `the artifact has no ${path}; a self-contained artifact must list its closure`)
    }
    return { verified: false, packages: 0, files: 0, bytes: 0, sha256: '' }
  }
  let recorded: ClosureManifest
  try {
    recorded = JSON.parse(readFileSync(path, 'utf8')) as ClosureManifest
  } catch (error) {
    throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH', `${path} is not valid JSON: ${String(error)}`)
  }
  if (recorded.schemaVersion !== 1 || !Array.isArray(recorded.packages)) {
    throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH', `${path} has an unsupported schema (expected version 1)`)
  }
  const nodeModules = join(targetProfileDir, 'node_modules')
  const problems: string[] = []
  for (const entry of recorded.packages) {
    const dir = join(nodeModules, ...entry.name.split('/'))
    if (!existsSync(join(dir, 'package.json'))) {
      problems.push(`${entry.name}: package directory is missing`)
      continue
    }
    const digest = packageDigest(dir)
    if (digest.links.length > 0) problems.push(`${entry.name}: contains symbolic links (${digest.links.slice(0, 3).join(', ')})`)
    const manifest = readPackageJson(dir, entry.name)
    if (typeof manifest.version === 'string' && manifest.version !== entry.version) {
      problems.push(`${entry.name}: version ${manifest.version} != recorded ${entry.version}`)
    }
    if (digest.files !== entry.files || digest.bytes !== entry.bytes || digest.sha256 !== entry.sha256) {
      problems.push(`${entry.name}: content digest changed (${String(digest.files)}/${String(digest.bytes)}/${digest.sha256.slice(0, 12)}`
        + ` != ${String(entry.files)}/${String(entry.bytes)}/${entry.sha256.slice(0, 12)})`)
    }
  }
  const expected = new Set(recorded.packages.map(entry => entry.name))
  const actual = listPackages(nodeModules)
  for (const name of actual) if (!expected.has(name)) problems.push(`${name}: package is present but not in the closure manifest`)
  const totals = {
    packages: recorded.packages.length,
    files: recorded.packages.reduce((sum, entry) => sum + entry.files, 0),
    bytes: recorded.packages.reduce((sum, entry) => sum + entry.bytes, 0),
    sha256: createHash('sha256')
      .update(recorded.packages.map(entry => `${entry.name}@${entry.version}\0${entry.sha256}`).join('\n'))
      .digest('hex'),
  }
  if (totals.sha256 !== recorded.totals.sha256 || totals.files !== recorded.totals.files
    || totals.bytes !== recorded.totals.bytes || totals.packages !== recorded.totals.packages) {
    problems.push('totals: recorded closure digest does not match its package list')
  }
  if (problems.length > 0) {
    throw new FrameworkError(500, 'PACKAGING_CLOSURE_MISMATCH',
      `the artifact closure does not match its manifest:\n- ${problems.slice(0, 12).join('\n- ')}`)
  }
  return { verified: true, packages: totals.packages, files: totals.files, bytes: totals.bytes, sha256: totals.sha256 }
}

/** 列出一个 node_modules 里的包名（作用域目录逐个子项）。 */
function listPackages(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return []
  const names: string[] = []
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      for (const child of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
        if (child.isDirectory() && existsSync(join(nodeModules, entry.name, child.name, 'package.json'))) {
          names.push(`${entry.name}/${child.name}`)
        }
      }
      continue
    }
    if (existsSync(join(nodeModules, entry.name, 'package.json'))) names.push(entry.name)
  }
  return names.sort()
}

/**
 * 产物闭包的凭据检查：闭包只允许代码与数据，不允许包管理器/仓库凭据。
 *
 * 与产物配置层的键名扫描互补——后者按已知清单**排除** `node_modules`，这里专门检查闭包本身。
 * @param targetProfileDir - 产物 profile 目录。
 * @returns 命中项（相对路径 + 原因）。
 */
export function closureCredentialHits(targetProfileDir: string): string[] {
  const nodeModules = join(targetProfileDir, 'node_modules')
  if (!existsSync(nodeModules)) return []
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(targetProfileDir, path).split(sep).join('/')
      if (CLOSURE_CREDENTIAL_FILES.has(entry.name)) {
        hits.push(`${rel}: credential file`)
        continue
      }
      const suffix = CLOSURE_TEXT_SUFFIXES.find(value => entry.name.endsWith(value))
      if (suffix === undefined) continue
      let body: string
      try {
        body = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      const marker = CLOSURE_CREDENTIAL_MARKERS.exec(body)
      if (marker !== null) hits.push(`${rel}: ${marker[0]}`)
    }
  }
  walk(nodeModules)
  return hits
}
