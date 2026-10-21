/**
 * 组合与插件清单域：把 profile 的真实组合层解析成可核对的插件行清单。
 *
 * - profile 真源：`data/dsh-home/profiles/soloengine/package.json`（`dsh.profile.bundles`）；
 * - 行真源：profile 的 `cordis.patch.yml` + `packages/bundle/web-app/cordis.patch.yml`
 *   + `packages/bundle/base/cordis.patch.yml`（层序即合并序，后层覆盖前层）；
 * - `kind` 判定：该行 `name` 解析到的包 `package.json` 里若有 `dsh.client` 则为 `client`，
 *   否则为 `host`；解析不到一律记 `host` 并计入 `unresolved`；
 * - `!!js` 表达式按 cordis 组合层的真实语义求值（仅用于 `disabled`），求值失败即报错。
 *
 * @module @soloengine/framework/modules/plugins
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'

/** 组合层里的一行（`insert` 插入行或顶层 `- id:` 覆盖行）。 */
export interface PatchRow {
  id: string
  /** 该行声明的插件包名（覆盖行可能缺省，由更早的层提供）。 */
  name?: string
  /** 是否为 `insert` 插入行（false 表示顶层 `- id:` 覆盖行）。 */
  inserted: boolean
  /** 除 id 外的键名（用于摘要，保持文件内出现顺序）。 */
  keys: string[]
  /** 原始 disabled 值（布尔或 `!!js` 表达式标记）。 */
  disabled?: unknown
}

/** 插件清单行。 */
export interface PluginRow {
  id: string
  name: string
  kind: 'host' | 'client'
  disabled: boolean
}

/** `!!js` 表达式标记（组合层允许 `!!js` 标量，求值语义与 cordis loader 一致）。 */
interface JsExpression {
  __js: string
}

/** `!!js` 自定义标签（js-yaml 默认 schema 不认该标签）。 */
const jsExpressionType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: unknown) => typeof data === 'string',
  construct: (data: unknown) => ({ __js: String(data) }),
})

/** 组合层解析 schema。 */
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend([jsExpressionType])

/** 判定是否为 `!!js` 表达式标记。 */
function isJsExpression(value: unknown): value is JsExpression {
  return value !== null && typeof value === 'object' && '__js' in (value as Record<string, unknown>)
}

/**
 * 解析一份 cordis patch 文档为行清单（保持文件内顺序）。
 * @param text - YAML 全文。
 * @param label - 用于错误定位的文件标识。
 * @returns 行清单。
 */
export function parsePatchDocument(text: string, label: string): PatchRow[] {
  let doc: unknown
  try {
    doc = yaml.load(text, { schema: PATCH_SCHEMA })
  } catch (error) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} is not valid YAML: ${String(error)}`)
  }
  if (doc === null) return []
  if (!Array.isArray(doc)) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} must be a YAML array of patch entries`)
  }
  const rows: PatchRow[] = []
  for (const element of doc) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a non-object patch entry`)
    }
    const entry = element as Record<string, unknown>
    const insert = entry.insert
    if (insert !== undefined) {
      if (!Array.isArray(insert)) {
        throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} has an insert that is not an array`)
      }
      for (const item of insert) {
        rows.push(assertRow(item, label, true))
      }
      continue
    }
    rows.push(assertRow(element, label, false))
  }
  return rows
}

/** 校验并归一化一行。 */
function assertRow(raw: unknown, label: string, inserted: boolean): PatchRow {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a row that is not an object`)
  }
  const row = raw as Record<string, unknown>
  const id = row.id
  if (typeof id !== 'string' || id === '') {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a row without a non-empty id`)
  }
  const keys = Object.keys(row).filter(key => key !== 'id')
  const parsed: PatchRow = { id, inserted, keys }
  if (typeof row.name === 'string') parsed.name = row.name
  if (row.disabled !== undefined) parsed.disabled = row.disabled
  return parsed
}

/** `!!js` 求值用的最小 `ctx` 桩事实（框架层按清单可确定的键）。 */
export interface DisabledEvalContext {
  /** profile 名（读自 profile 清单）。 */
  readonly profileName: string
  /** profile 目录绝对路径。 */
  readonly profileDir: string
  /** profile 自己的 patch 层路径。 */
  readonly patchPath: string
}

/**
 * 按 cordis 组合层的语义求值 `disabled`（布尔直接取用；`!!js` 表达式真实求值）。
 *
 * loader 的 `ctx` 是服务访问器：`ctx.get(name)` 取服务、没有则 undefined。框架层不在
 * 该 cordis 容器内，但组合层表达式的实际用量只有 `ctx.get('profileContext')`——它的事实
 * （name/dir/patchPath）框架层已从 profile 清单与原位路径确定，故以最小桩回答该键；
 * 未列出的服务返回 undefined（与「容器里没有该服务」同义）。此前桩为 `{}`，任何
 * `ctx.get(...)` 表达式都必然 TypeError（实测 `plugin-manager` 行 422 PLUGIN_PATCH_INVALID）。
 * @param value - 原始值。
 * @param label - 错误定位标识。
 * @param id - 行 id（错误定位）。
 * @param profile - profile 清单事实（`ctx.get('profileContext')` 的回答）。
 * @returns 是否禁用。
 */
export function evaluateDisabled(value: unknown, label: string, id: string, profile: DisabledEvalContext): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  if (isJsExpression(value)) {
    let result: unknown
    try {
      // 与 cordis loader 相同的求值语义：`!!js <expression>` 在进程内求值。
      const profileContext = { name: profile.profileName, dir: profile.profileDir, patchPath: profile.patchPath }
      const ctx = { get: (name: string): unknown => (name === 'profileContext' ? profileContext : undefined) }
      const evaluate = new Function('process', 'dshHomePath', 'ctx', `return (${value.__js})`)
      result = evaluate(process, () => '', ctx)
    } catch (error) {
      throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID',
        `${label} row ${id} disabled expression ${JSON.stringify(value.__js)} could not be evaluated: ${String(error)}`)
    }
    if (typeof result === 'boolean') return result
    if (typeof result === 'string') return result !== '' && result !== '0' && result !== 'false'
    if (result === undefined || result === null) return false
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID',
      `${label} row ${id} disabled expression evaluated to ${JSON.stringify(result)}`)
  }
  if (typeof value === 'string') return value !== '' && value !== '0' && value !== 'false'
  throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} row ${id} disabled must be a boolean or an expression`)
}

/** 组合与插件清单服务。 */
export class PluginService {
  private readonly runtime: FrameworkRuntime
  /** 包名 → 包目录（`packages/<group>/<dir>`），首次使用时建立。 */
  private packageIndex: Map<string, string> | undefined

  /**
   * @param runtime - 框架层运行时（根目录与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
  }

  /** profile 目录绝对路径（`<data>/dsh-home/profiles/soloengine`）。 */
  private profileDir(): string {
    return join(this.runtime.dataDir, 'dsh-home', 'profiles', 'soloengine')
  }

  /** profile 清单绝对路径。 */
  private profilePath(): string {
    return join(this.profileDir(), 'package.json')
  }

  /** profile 自己的 patch 层绝对路径（层序的最后一位）。 */
  private profilePatchPath(): string {
    return join(this.profileDir(), 'cordis.patch.yml')
  }

  /** 读取 profile 清单（缺失/缺键即报错，不兜底）。 */
  private readProfile(): { name: string; bundles: string[] } {
    const path = this.profilePath()
    if (!existsSync(path)) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `dsh profile manifest ${path} does not exist`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `dsh profile manifest ${path} is not valid JSON: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `dsh profile manifest ${path} must be a JSON object`)
    }
    const manifest = parsed as { name?: unknown; dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || bundles.length === 0) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `dsh profile manifest ${path} declares no dsh.profile.bundles`)
    }
    return {
      name: typeof manifest.name === 'string' ? manifest.name : 'unknown-profile',
      bundles: bundles.map(item => {
        if (typeof item !== 'string') {
          throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `dsh profile manifest ${path} has a non-string bundle entry`)
        }
        return item
      }),
    }
  }

  /**
   * 按 `dsh.profile.bundles` 的层序逐层解析组合层（层序即合并序），最后叠加 profile 自己的 patch。
   *
   * - 每个 bundle 名经 `resolvePackageDir` 解析出包目录，读其 `cordis.patch.yml`；
   *   该 bundle 无 patch 文件即跳过该层（bundle 可以不携带组合层）；
   * - bundle 包目录解析不到 → 计入 `unresolved`（不静默）；
   * - 后层覆盖前层的 `name` / `disabled`，`inserted` 保留首次插入层的来源。
   *
   * @param bundles - profile 声明的 bundle 层清单（顺序即层序）。
   * @returns 合并后的行、参与合并的层文件、未解析到的 bundle 名。
   */
  private mergedRows(bundles: string[]): { rows: Map<string, PatchRow>; layers: string[]; unresolved: string[] } {
    const merged = new Map<string, PatchRow>()
    const layers: string[] = []
    const unresolved: string[] = []
    /** 把一层 patch 文件的行并入合并结果。 */
    const applyLayer = (path: string): void => {
      layers.push(path)
      for (const row of parsePatchDocument(readFileSync(path, 'utf8'), path)) {
        const current = merged.get(row.id)
        if (current === undefined) {
          merged.set(row.id, { ...row })
          continue
        }
        const next: PatchRow = { id: row.id, inserted: current.inserted, keys: row.keys }
        const name = row.name ?? current.name
        if (name !== undefined) next.name = name
        const disabled = row.disabled ?? current.disabled
        if (disabled !== undefined) next.disabled = disabled
        merged.set(row.id, next)
      }
    }
    for (const bundle of bundles) {
      const dir = this.resolvePackageDir(bundle)
      if (dir === undefined) {
        if (!unresolved.includes(bundle)) unresolved.push(bundle)
        continue
      }
      const patchPath = join(dir, 'cordis.patch.yml')
      if (!existsSync(patchPath)) continue
      applyLayer(patchPath)
    }
    const profilePatch = this.profilePatchPath()
    if (!existsSync(profilePatch)) {
      throw new FrameworkError(500, 'PLUGIN_PATCH_MISSING', `profile cordis patch layer ${profilePatch} does not exist`)
    }
    applyLayer(profilePatch)
    return { rows: merged, layers, unresolved }
  }

  /** `packages/<group>/<dir>` 与 `vendor/<dir>` 的包名索引（一次建立，进程内复用）。 */
  private packageIndexMap(): Map<string, string> {
    if (this.packageIndex !== undefined) return this.packageIndex
    const index = new Map<string, string>()
    const record = (dirPath: string): void => {
      const manifestPath = join(dirPath, 'package.json')
      if (!existsSync(manifestPath)) return
      let manifest: unknown
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        return
      }
      const name = (manifest as { name?: unknown } | null)?.name
      if (typeof name === 'string' && name !== '') index.set(name, dirPath)
    }
    // `packages/<group>/<dir>`：DSH 原生包与 @soloengine/* 包。
    const root = join(this.runtime.root, 'packages')
    if (existsSync(root)) {
      for (const group of readdirSync(root)) {
        const groupDir = join(root, group)
        if (!statSync(groupDir).isDirectory()) continue
        for (const dir of readdirSync(groupDir)) {
          const dirPath = join(groupDir, dir)
          if (statSync(dirPath).isDirectory()) record(dirPath)
        }
      }
    }
    // `vendor/<dir>`：随仓库固化的框架族（cordis 插件族），组合层同样会引用它们的包名。
    const vendor = join(this.runtime.root, 'vendor')
    if (existsSync(vendor)) {
      for (const dir of readdirSync(vendor)) {
        const dirPath = join(vendor, dir)
        if (statSync(dirPath).isDirectory()) record(dirPath)
      }
    }
    this.packageIndex = index
    return index
  }

  /** 行 name（可能带子路径）→ 包名。 */
  private static packageNameOf(name: string): string {
    const parts = name.split('/')
    if (name.startsWith('@')) return parts.length >= 2 ? `${parts[0] as string}/${parts[1] as string}` : name
    return parts[0] as string
  }

  /**
   * 解析包名到包目录。
   *
   * 解析顺序：**profile 的 node_modules**（`dsh plugin add` 把第三方 bundle 与插件装在这里）→
   * 仓库根的 node_modules（workspace 包）→ `packages/**` 与 `vendor/**` 索引。
   *
   * @param packageName - 包名。
   * @returns 包目录绝对路径；解析不到返回 undefined。
   */
  private resolvePackageDir(packageName: string): string | undefined {
    const candidates = [
      join(this.profileDir(), 'node_modules', packageName),
      join(this.runtime.root, 'node_modules', packageName),
    ]
    for (const dir of candidates) {
      if (existsSync(join(dir, 'package.json'))) return dir
    }
    return this.packageIndexMap().get(packageName)
  }

  /**
   * 组合与插件清单。
   * @returns profile、行清单、客户端入口与未解析包名。
   */
  list(): {
    profile: { name: string; bundles: string[] }
    rows: PluginRow[]
    clientEntries: string[]
    unresolved: string[]
  } {
    const profile = this.readProfile()
    const { rows, unresolved: unresolvedBundles } = this.mergedRows(profile.bundles)
    const out: PluginRow[] = []
    const clientEntries: string[] = []
    const unresolved: string[] = [...unresolvedBundles]
    for (const row of rows.values()) {
      if (row.name === undefined) {
        throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID',
          `cordis row ${row.id} has no name in any layer (cannot be attributed to a plugin package)`)
      }
      const name = row.name
      const packageDir = this.resolvePackageDir(PluginService.packageNameOf(name))
      let kind: 'host' | 'client' = 'host'
      if (packageDir === undefined) {
        if (!unresolved.includes(name)) unresolved.push(name)
      } else {
        let manifest: unknown
        try {
          manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
        } catch (error) {
          throw new FrameworkError(500, 'PLUGIN_PACKAGE_INVALID',
            `plugin package ${name} at ${packageDir} is not valid JSON: ${String(error)}`)
        }
        const dsh = (manifest as { dsh?: { client?: unknown } } | null)?.dsh
        if (dsh !== undefined && dsh.client !== undefined) kind = 'client'
      }
      if (kind === 'client' && !clientEntries.includes(name)) clientEntries.push(name)
      out.push({
        id: row.id,
        name,
        kind,
        disabled: evaluateDisabled(row.disabled, 'cordis patch', row.id, {
          profileName: profile.name,
          profileDir: this.profileDir(),
          patchPath: this.profilePatchPath(),
        }),
      })
    }
    return { profile, rows: out, clientEntries, unresolved }
  }
}
