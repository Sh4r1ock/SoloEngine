/**
 * 组合与插件清单域：把**原生 Loader 的活条目**投影成可核对的插件行清单。
 *
 * - profile 真源：`data/dsh-home/profiles/soloengine/package.json`（`dsh.profile.bundles`）；
 * - 行真源：`ctx.loader.entries()`（host 在挂载时绑定为 `runtime.plugins` 的 inventory 源）——
 *   组合层的合并、`!!js` 求值与「patch 匹配不到条目即跳过」都是 Loader 自己的语义，
 *   框架层不解析组合层 YAML、不重新求值表达式；
 * - `kind` 判定：该行 `name` 解析到的包 `package.json` 里若有 `dsh.client` 则为 `client`，
 *   否则为 `host`；解析不到一律记 `host` 并计入 `unresolved`。
 *
 * @module @soloengine/framework/modules/plugins
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { NodePluginRow } from '@soloengine/types'
import type { FrameworkRuntime } from '../runtime.ts'
import { isUniqueViolation } from '../db/port.ts'
import { parsePatchDocument, type PatchRow } from '../cordis-patch.ts'
import { FrameworkError } from './accounts.ts'
import { CanvasService, type CanvasView, type InstancePluginDiff } from './canvas.ts'

/** 一条活条目（原生 Loader 已解析的最终事实）。 */
export interface LivePluginRow {
  /** 条目在组合层里的 id（不含父组前缀；画布差异用同一套 id）。 */
  id: string
  /** 插件包名（可带子路径）。 */
  name: string
  /** 生效的禁用态（条目自身或任一祖先禁用即 true）。 */
  disabled: boolean
}

/** 活条目来源（由 host 从 `ctx.loader` 绑定；框架层不直连 cordis 容器）。 */
export interface PluginInventorySource {
  /** 当前 Loader 的非分组条目（加载顺序）。 */
  rows(): readonly LivePluginRow[]
}

/** 插件清单行。 */
export interface PluginRow {
  id: string
  name: string
  kind: 'host' | 'client'
  disabled: boolean
  /** 包清单里的 `version`；包未解析时为 null。 */
  version: string | null
}

/** 未解析的活条目：名字 + 具体原因（不是只回一个包名）。 */
export interface UnresolvedPluginRow {
  name: string
  /** 该条目为何解析不到包（可定位到解析过的位置类别）。 */
  reason: string
}

/** 一个 profile bundle 的组合行计数（按被引包的面别）。 */
export interface PluginBundleCount {
  /** bundle 包名（与 `profile.bundles` 同序同名）。 */
  name: string
  /** bundle 包清单里的 `description`；清单没写时为 null。 */
  description: string | null
  /** 该 bundle 的 patch 行里解析为 host 面的行数。 */
  hostCount: number
  /** 该 bundle 的 patch 行里解析为 client 面的行数。 */
  clientCount: number
}

/** bundle 包清单里本模块读取的字段。 */
interface BundleManifest {
  /** 包描述（插件行的第二行）。 */
  description?: unknown
  dsh?: { bundle?: { patch?: unknown } }
}

/**
 * Loader 内部虚拟模块（如 `cordis:include`）：由加载器自身提供，不对应可打包的插件包。
 * 它们出现在活条目里（原生事实），但不参与实例组合与产物依赖闭包，也不计入 `unresolved`。
 * @param name - 条目声明的模块名。
 * @returns 是否为虚拟模块说明符。
 */
function isLoaderInternal(name: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(name)
}

/**
 * 未解析条目的原因：列出实际尝试过的包目录来源（不是猜测）。
 * @param name - 活条目声明的包名。
 * @returns 可直接展示的原因文本。
 */
function unresolvedReason(name: string): string {
  const packageName = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
  return `package ${packageName} was not found in the profile node_modules, the workspace node_modules, packages/ or vendor/`
}

/** 一条实例组合行（profile 基线 + 画布差异的净结果）。 */
export interface InstanceRow extends PluginRow {
  /** 该行来自基线继承、实例新增，还是实例替换。 */
  origin: 'baseline' | 'add' | 'replace'
  /** 实例新增/替换/改配置后的配置（基线行不带，配置属全局组合）。 */
  config?: unknown
  /**
   * 该行要替换的基线服务名（仅 `add` 行可声明）。
   *
   * 实例装配层在装载该行**之前**按 flow 隔离这些服务名：同一服务在多个 flow
   * 各有一份实现时互不撞「重复注册」，也不影响基线；未列出的服务照旧继承基线。
   */
  isolate?: string[]
}

/** `user_default_plugins` 行。 */
export interface UserDefaultPluginsRow {
  user_id: string
  /** 默认插件差异的 JSON 文本（与画布实例差异同格式）。 */
  plugins: string
  version: number
  created_at: string | null
  updated_at: string | null
}

/** 用户默认插件表视图（`GET/PUT /plugins/defaults` 的响应内容）。 */
export interface UserDefaultsView {
  /** 默认插件差异；没有行时为空对象。 */
  diff: InstancePluginDiff
  /** 乐观锁版本；没有行时为 0。 */
  version: number
  /** 新建 agent 节点使用的节点级插件行（原生插件行格式）。 */
  plugins: NodePluginRow[]
}

/** 一条 profile 组合包的托管视图（原生 `pluginManager.listBundles` 的投影）。 */
export interface ManagedBundleRow {
  /** 包名。 */
  name: string
  /** 包清单版本；读不到时为 null。 */
  version: string | null
  /** 包清单描述（未翻译）。 */
  description: string | null
  /** 该组合包当前是否被 profile 选中。 */
  enabled: boolean
  /** profile 是否声明了该依赖。 */
  installed: boolean
  /** 是否可移除（管理包与安装自带的可选包不可移除）。 */
  removable: boolean
  /** 是否随安装自带的官方包。 */
  official: boolean
  /** 是否为安装自带、默认关闭的可选包。 */
  optional: boolean
  /** 不能经管理器改写的原因；可改写时为 null。 */
  readOnlyReason: string | null
  /** 该包加载失败的结构化原因；正常时为 null。 */
  error: { code: string; diagnostic: string | null } | null
  /** 该包 patch 声明的行数（详情展示用）。 */
  rowCount: number
}

/** 一次管理操作的结果（原生 `ChangeResult` 的投影）。 */
export interface ManagedChangeResult {
  /** 是否改写了 profile。 */
  changed: boolean
  /** 落地结果：已应用 / 需重启 / 被更高层覆盖 / 失败 / 已取消。 */
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  /** 需要重启时的原因（`no-hmr`、`package-moved` 等）；否则为 null。 */
  restartReason: string | null
  /** 最后执行的阶段。 */
  stage: 'install' | 'enable' | 'remove'
  /** 操作目标（包名或行 id）。 */
  target: string
  /** 目标的最新启用态；不适用时为 null。 */
  enabled: boolean | null
  /** 结构化失败原因；成功时为 null。 */
  error: { code: string; diagnostic: string | null; incompatible: { name: string; version: string; runtimeVersion: string }[] } | null
  /** 操作未处理、但已存在的失效条目。 */
  warnings: string[]
  /** 安装成功后新增的组合包名。 */
  bundle: string | null
  /** 安装成功后的包版本。 */
  version: string | null
  /** 等待脚本批准的依赖包名（pnpm 阻止了构建脚本）。 */
  pendingBuilds: string[]
  /** 安装依次询问的 registry。 */
  registries: (string | null)[]
  /** 失败发生在 registry 还是 spec 所在主机。 */
  failedAt: 'registry' | 'spec-host' | null
}

/** 安装规格的检查结果（原生 `PluginSpecInspection` 的投影）。 */
export type ManagedInspection =
  | {
    status: 'accepted'
    kind: 'registry' | 'path' | 'git' | 'tarball'
    name: string | null
    version: string | null
    description: string | null
    /** 包是否声明了 bundle patch；规格形态无法判断时为 null。 */
    bundle: boolean | null
    /** 安装会先询问的 registry。 */
    registry: string | null
  }
  | {
    status: 'refused'
    problem: 'invalid-spec' | 'already-installed' | 'not-found' | 'not-a-package' | 'not-a-bundle' | 'network' | 'unknown'
    reason: string
    registries: (string | null)[]
  }

/**
 * 原生 profile 插件管理器（host 绑定；框架层不直连 cordis 容器）。
 *
 * 这是管理层唯一一条写入 profile 组合的通道：安装/移除/启停都复用 DSH
 * `plugin-manager` 的实现，框架层不新增第二套安装器。
 */
export interface PluginManagerSource {
  /** 列出 profile 的组合包（含安装自带的可选包）。 */
  bundles(): Promise<ManagedBundleRow[]>
  /** 启用/停用一个组合包。 */
  setBundleEnabled(name: string, enabled: boolean): Promise<ManagedChangeResult>
  /** 在安装前读取一个规格（包名、路径、Git、tarball）。 */
  inspect(spec: string): Promise<ManagedInspection>
  /** 安装并选中一个组合包；`requestId` 供取消与结果恢复使用。 */
  install(spec: string, requestId: string, enabled: boolean, approvedBuilds: readonly string[]): Promise<ManagedChangeResult>
  /** 恢复一次丢失响应的安装结果；请求不在进行中时为 null。 */
  waitForInstall(requestId: string): Promise<ManagedChangeResult | null>
  /** 停止一次安装（文件回滚完成后才返回）。 */
  cancelInstall(requestId: string): Promise<'cancelled' | 'too-late' | 'not-running'>
  /** 移除一个组合包。 */
  removeBundle(name: string): Promise<ManagedChangeResult>
}

/** 组合与插件清单服务。 */
export class PluginService {
  private readonly runtime: FrameworkRuntime
  /** 包名 → 包目录（`packages/<group>/<dir>`），首次使用时建立。 */
  private packageIndex: Map<string, string> | undefined
  /** 活条目来源（host 挂载时绑定；未绑定时清单类接口以结构化错误拒绝）。 */
  private inventory: PluginInventorySource | undefined
  /** profile 插件管理器来源（host 挂载时绑定；未绑定时管理类接口以结构化错误拒绝）。 */
  private managerSource: PluginManagerSource | undefined

  /**
   * @param runtime - 框架层运行时（根目录与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
  }

  /**
   * 绑定/解绑活条目来源（host 把 `ctx.loader` 的条目投影接进来）。
   * @param source - 活条目来源；`undefined` 表示卸载。
   */
  bindInventory(source: PluginInventorySource | undefined): void {
    this.inventory = source
  }

  /** 当前 Loader 的非分组条目；未绑定时 fail loud（不退回第二套组合解析）。 */
  private liveRows(): readonly LivePluginRow[] {
    const source = this.inventory
    if (source === undefined) {
      throw new FrameworkError(503, 'PLUGIN_INVENTORY_UNAVAILABLE',
        'the plugin inventory is not bound: the host plugin must mount before the composition is queried')
    }
    return source.rows()
  }

  /**
   * 绑定/解绑原生 profile 插件管理器（host 把 `ctx.pluginManager` 投影接进来）。
   * @param source - 管理器来源；`undefined` 表示卸载。
   */
  bindManager(source: PluginManagerSource | undefined): void {
    this.managerSource = source
  }

  /** 原生 profile 插件管理器；未绑定时 fail loud（不退回第二套安装器）。 */
  private manager(): PluginManagerSource {
    const source = this.managerSource
    if (source === undefined) {
      throw new FrameworkError(503, 'PLUGIN_MANAGER_UNAVAILABLE',
        'the profile plugin manager is not bound: the host plugin must mount on a managed profile before plugins are changed')
    }
    return source
  }

  /**
   * profile 级插件管理视图（组合包清单）。
   * @returns 组合包行（含启用态、可移除性、坏包原因）。
   */
  async managedBundles(): Promise<{ bundles: ManagedBundleRow[] }> {
    return { bundles: await this.manager().bundles() }
  }

  /**
   * 启用/停用一个组合包。
   * @param name - 组合包包名。
   * @param enabled - 目标启用态。
   * @returns 原生操作结果。
   */
  async setBundleEnabled(name: string, enabled: boolean): Promise<ManagedChangeResult> {
    if (name.trim() === '') throw new FrameworkError(400, 'PLUGIN_TARGET_REQUIRED', 'a bundle name is required')
    return await this.manager().setBundleEnabled(name, enabled)
  }

  /**
   * 在安装前读取一个规格。
   * @param spec - 包名、Git 地址、tarball 或本地目录。
   * @returns 接受（含包信息）或拒绝（含原因）。
   */
  async inspectSpec(spec: string): Promise<ManagedInspection> {
    if (spec.trim() === '') throw new FrameworkError(400, 'PLUGIN_SPEC_REQUIRED', 'an install spec is required')
    return await this.manager().inspect(spec)
  }

  /**
   * 安装一个组合包并选中它。
   * @param spec - 安装规格。
   * @param requestId - 调用方生成的请求 id（取消与结果恢复）。
   * @param enabled - 安装后是否立即选中。
   * @param approvedBuilds - 用户已批准的依赖脚本包名（空数组表示不批准任何脚本）。
   * @returns 原生操作结果。
   */
  async installBundle(spec: string, requestId: string, enabled: boolean, approvedBuilds: readonly string[] = []): Promise<ManagedChangeResult> {
    if (spec.trim() === '') throw new FrameworkError(400, 'PLUGIN_SPEC_REQUIRED', 'an install spec is required')
    if (requestId.trim() === '') throw new FrameworkError(400, 'PLUGIN_REQUEST_REQUIRED', 'a request id is required')
    return await this.manager().install(spec, requestId, enabled, approvedBuilds)
  }

  /**
   * 恢复一次丢失响应的安装结果。
   * @param requestId - 原安装请求 id。
   * @returns 结果；请求不在进行中时为 null。
   */
  async waitInstall(requestId: string): Promise<ManagedChangeResult | null> {
    if (requestId.trim() === '') throw new FrameworkError(400, 'PLUGIN_REQUEST_REQUIRED', 'a request id is required')
    return await this.manager().waitForInstall(requestId)
  }

  /**
   * 停止一次安装。
   * @param requestId - 原安装请求 id。
   * @returns 取消结果（已取消 / 已进入不可取消阶段 / 不在进行中）。
   */
  async cancelInstall(requestId: string): Promise<'cancelled' | 'too-late' | 'not-running'> {
    if (requestId.trim() === '') throw new FrameworkError(400, 'PLUGIN_REQUEST_REQUIRED', 'a request id is required')
    return await this.manager().cancelInstall(requestId)
  }

  /**
   * 移除一个组合包。
   * @param name - 组合包包名。
   * @returns 原生操作结果。
   */
  async removeBundle(name: string): Promise<ManagedChangeResult> {
    if (name.trim() === '') throw new FrameworkError(400, 'PLUGIN_TARGET_REQUIRED', 'a bundle name is required')
    return await this.manager().removeBundle(name)
  }

  /** profile 目录绝对路径（启动器给出的运行面 profile）。 */
  private profileDir(): string {
    return this.runtime.profileDir
  }

  /** profile 清单绝对路径。 */
  private profilePath(): string {
    return join(this.profileDir(), 'package.json')
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
    // 目标机安装布局会把 bundle 提升到 profile 的上级 node_modules（产物 = `<install>/profile`
    // + `<install>/node_modules`）。手工候选只覆盖 profile 自身与仓库根，会漏掉这种布局；
    // 按 Node 解析规则从 profile 清单再查一次，解析不到才落到仓库包索引。
    try {
      const manifest = createRequire(join(this.profileDir(), 'package.json')).resolve(`${packageName}/package.json`)
      return dirname(manifest)
    } catch {
      // 包未导出 ./package.json 或确实不存在：继续走包索引。
    }
    return this.packageIndexMap().get(packageName)
  }

  /**
   * 组合与插件清单（行来自原生 Loader 的活条目）。
   * @returns profile（bundle 清单与逐 bundle 行计数）、行清单、客户端入口与未解析条目。
   */
  list(): {
    profile: { name: string; bundles: string[]; bundleCounts: PluginBundleCount[] }
    rows: PluginRow[]
    clientEntries: string[]
    unresolved: UnresolvedPluginRow[]
    /** 覆盖本组合未装载的行：Loader 已在装载时跳过它们，活条目视角下恒为空。 */
    skipped: string[]
  } {
    const profile = this.readProfile()
    const out: PluginRow[] = []
    const clientEntries: string[] = []
    const unresolved: UnresolvedPluginRow[] = []
    for (const row of this.liveRows()) {
      const internal = isLoaderInternal(row.name)
      const info = internal ? undefined : this.packageInfo(row.name)
      if (!internal && info === undefined && !unresolved.some(entry => entry.name === row.name)) {
        unresolved.push({ name: row.name, reason: unresolvedReason(row.name) })
      }
      const resolved: 'host' | 'client' = info?.kind ?? 'host'
      if (resolved === 'client' && !clientEntries.includes(row.name)) clientEntries.push(row.name)
      out.push({
        id: row.id,
        name: row.name,
        kind: resolved,
        disabled: row.disabled,
        version: info?.version ?? null,
      })
    }
    return {
      profile: {
        name: profile.name,
        bundles: profile.bundles,
        bundleCounts: this.bundleCounts(profile.bundles),
      },
      rows: out,
      clientEntries,
      unresolved,
      skipped: [],
    }
  }

  /**
   * 逐个 profile bundle 统计其 patch 行数（按被引包的宿主/客户端面别）。
   *
   * 只统计声明了 `name` 的行：纯覆盖行（`- id: …` + config）不携带包名，无法归面别。
   * @param bundles - profile 声明的 bundle 包名（顺序即装载顺序）。
   * @returns 与 `bundles` 同序的计数行。
   */
  private bundleCounts(bundles: readonly string[]): PluginBundleCount[] {
    return bundles.map(bundle => {
      const { dir, manifest } = this.bundleManifest(bundle)
      const counts: PluginBundleCount = {
        name: bundle,
        description: typeof manifest.description === 'string' && manifest.description !== '' ? manifest.description : null,
        hostCount: 0,
        clientCount: 0,
      }
      for (const row of this.bundlePatchRows(bundle, dir, manifest)) {
        if (row.name === undefined || isLoaderInternal(row.name)) continue
        if (this.packageInfo(row.name)?.kind === 'client') counts.clientCount += 1
        else counts.hostCount += 1
      }
      return counts
    })
  }

  /**
   * 读一个 bundle 的包目录与清单（解析不到或清单不可读即 fail loud）。
   * @param bundle - bundle 包名。
   * @returns 包目录与清单。
   */
  private bundleManifest(bundle: string): { dir: string; manifest: BundleManifest } {
    const dir = this.resolvePackageDir(bundle)
    if (dir === undefined) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING',
        `bundle ${bundle} declared by the profile cannot be resolved on this installation`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING',
        `bundle ${bundle} package.json is unreadable: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING',
        `bundle ${bundle} package.json must be a JSON object`)
    }
    return { dir, manifest: parsed as BundleManifest }
  }

  /**
   * 读一个 bundle 声明的 patch 行（`dsh.bundle.patch`，单文件字符串或多文件数组）。
   * @param bundle - bundle 包名。
   * @param dir - 该 bundle 的包目录。
   * @param manifest - 该 bundle 的包清单。
   * @returns patch 行（保持文件内顺序）。
   */
  private bundlePatchRows(bundle: string, dir: string, manifest: BundleManifest): PatchRow[] {
    const patches = manifest.dsh?.bundle?.patch
    const declared = typeof patches === 'string' ? [patches] : patches
    if (!Array.isArray(declared) || declared.length === 0) {
      throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `bundle ${bundle} declares no dsh.bundle.patch files`)
    }
    const rows: PatchRow[] = []
    for (const item of declared) {
      if (typeof item !== 'string' || item === '') {
        throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `bundle ${bundle} has a non-string dsh.bundle.patch entry`)
      }
      const file = resolve(dir, item)
      if (!existsSync(file)) {
        throw new FrameworkError(500, 'PLUGIN_PROFILE_MISSING', `bundle ${bundle} patch file ${file} does not exist`)
      }
      rows.push(...parsePatchDocument(readFileSync(file, 'utf8'), file))
    }
    return rows
  }

  /**
   * 包名 → 面别与版本；包目录解析不到即 undefined（调用方决定是否 fail loud）。
   * @param name - 条目声明的包名（可带子路径）。
   * @returns 面别与清单版本（清单缺 `version` 时为 null）。
   */
  private packageInfo(name: string): { kind: 'host' | 'client'; version: string | null } | undefined {
    const packageDir = this.resolvePackageDir(PluginService.packageNameOf(name))
    if (packageDir === undefined) return undefined
    let manifest: unknown
    try {
      manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PLUGIN_PACKAGE_INVALID',
        `plugin package ${name} at ${packageDir} is not valid JSON: ${String(error)}`)
    }
    const record = manifest as { version?: unknown; dsh?: { client?: unknown } } | null
    return {
      kind: record?.dsh !== undefined && record.dsh.client !== undefined ? 'client' : 'host',
      version: typeof record?.version === 'string' && record.version !== '' ? record.version : null,
    }
  }

  /**
   * 计算某画布的实例组合：profile 基线行 + 该画布的实例差异（Plan W3）。
   *
   * 校验在读取时完成，错误一律 fail loud（组合错误在加载期报错，不静默降级）：
   * 行 id 必须在基线里存在（disable/replace）、新增行 id 不得冲突、包名必须解析到实际包；
   * 宿主基线行由进程基线装载，不能按 flow 禁用或替换（须以 add 迁入实例）；
   * configure 只作用于实例内新增/替换行（基线行配置属全局组合）。
   * @param userId - 归属用户（越权即 404）。
   * @param canvasId - 画布 id。
   * @returns 净组合行与画布声明的原始差异。
   */
  async instanceComposition(userId: string, canvasId: string): Promise<{ rows: InstanceRow[]; diff: InstancePluginDiff }> {
    const canvasRow = await this.runtime.canvas.byId(userId, canvasId)
    if (canvasRow === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    const canvas = CanvasService.parseCanvas(canvasRow.canvas_data, canvasId)
    const diff = canvas.settings?.plugins ?? {}
    return { rows: this.composeInstance(diff, canvasId), diff }
  }

  /**
   * 该 flow 的客户端激活集合：运行面板只装载这些客户端包（Plan W4）。
   *
   * 解析基于实例净组合（profile 基线 + 画布差异）；`disable` 生效于客户端行，
   * 同一包被多行声明时只要还有启用行就保留。被 `replace` 换掉包名的基线行会把它原来的包
   * 计入关闭集合（否则运行面板会同时装载旧包与替代包）。画布不存在时返回空集合（面板仍渲染）。
   * 组合错误（未知行、包不可解析）抛 422——加载期报错，不静默降级。
   * @param canvasId - 画布 id（`/run/:agenticFlowId` 的 flow 段）。
   * @returns 启用的客户端包名与关闭的客户端包名（均去重排序）。
   */
  async clientSelection(canvasId: string): Promise<{ enabled: string[]; disabled: string[] }> {
    const row = await this.runtime.canvas.byIdUnscoped(canvasId)
    if (row === undefined) return { enabled: [], disabled: [] }
    const canvas = CanvasService.parseCanvas(row.canvas_data, canvasId)
    const diff = canvas.settings?.plugins ?? {}
    const rows = this.composeInstance(diff, canvasId)
    const enabled = new Set<string>()
    const disabled = new Set<string>()
    for (const entry of rows) {
      if (entry.kind !== 'client') continue
      const pkg = PluginService.packageNameOf(entry.name)
      if (entry.disabled) disabled.add(pkg)
      else enabled.add(pkg)
    }
    for (const pkg of enabled) disabled.delete(pkg)
    const replaces = diff.replace ?? []
    if (replaces.length > 0) {
      // 替换只改行上的包名：旧包不会出现在净组合里，必须按**未应用差异的基线行**找回它。
      const baseline = new Map(this.composeInstance({}, canvasId).map(entry => [entry.id, entry]))
      for (const item of replaces) {
        const original = baseline.get(item.id)
        if (original === undefined || original.kind !== 'client') continue
        const pkg = PluginService.packageNameOf(original.name)
        if (!enabled.has(pkg)) disabled.add(pkg)
      }
    }
    return { enabled: [...enabled].sort(), disabled: [...disabled].sort() }
  }

  /**
   * 校验一份实例差异（不落盘）：组合错误在保存画布时即报错，不等运行期。
   * @param canvasId - 画布 id（错误定位）。
   * @param diff - 待校验的差异。
   * @returns 净组合行。
   */
  validateInstanceDiff(canvasId: string, diff: InstancePluginDiff): { rows: InstanceRow[] } {
    return { rows: this.composeInstance(diff, canvasId) }
  }

  /**
   * 保存某画布的实例插件差异（先校验净组合，再写回 canvas_data.settings.plugins）。
   *
   * 校验失败即拒绝写入（组合错误在加载期报错）；空差异移除该键，避免在画布数据里留下空壳。
   * @param userId - 归属用户。
   * @param canvasId - 画布 id。
   * @param diff - 待写入的差异（未校验的 JSON）。
   * @param version - 乐观锁版本（必填，复用画布更新的并发语义）。
   * @returns 保存后的净组合行与画布视图（含新版本）。
   */
  async saveInstanceDiff(userId: string, canvasId: string, diff: InstancePluginDiff, version: number): Promise<{ rows: InstanceRow[]; canvas: CanvasView }> {
    const rows = this.composeInstance(diff, canvasId)
    const canvasRow = await this.runtime.canvas.byId(userId, canvasId)
    if (canvasRow === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    const canvas = CanvasService.parseCanvas(canvasRow.canvas_data, canvasId)
    const empty = Object.values(diff).every(value => value === undefined || (Array.isArray(value) && value.length === 0))
    const settings = { ...canvas.settings }
    if (empty) delete settings.plugins
    else settings.plugins = diff
    return {
      rows,
      canvas: await this.runtime.canvas.update(userId, canvasId, {
        canvas: { nodes: canvas.nodes, edges: canvas.edges, settings },
        version,
      }),
    }
  }

  // ── 用户级默认插件表（需求 §0.1.4）────────────────────────────────────────

  /**
   * 读取该用户的默认插件表。
   *
   * 没有行时返回空差异与版本 0：新用户不需要预热行，首次保存即插入。
   * @param userId - 归属用户。
   * @returns 默认插件差异与乐观锁版本。
   */
  async readUserDefaults(userId: string): Promise<{ diff: InstancePluginDiff; version: number }> {
    const row = await this.runtime.db.prepare('SELECT * FROM user_default_plugins WHERE user_id = ?')
      .get<UserDefaultPluginsRow>(userId)
    if (row === undefined) return { diff: {}, version: 0 }
    return { diff: PluginService.parseUserDefaults(row, userId), version: Number(row.version) }
  }

  /**
   * 该用户的默认插件表视图（差异 + 版本 + 新建节点用的插件行）。
   * @param userId - 归属用户。
   * @returns 默认插件表视图。
   */
  async userDefaults(userId: string): Promise<UserDefaultsView> {
    const { diff, version } = await this.readUserDefaults(userId)
    return { diff, version, plugins: this.nodeRowsOf(diff) }
  }

  /**
   * 保存该用户的默认插件表（组合校验 → 归属过滤 + 乐观锁）。
   *
   * 差异先经与画布实例差异同一份组合校验（非法即 422）；版本不匹配即 409，
   * 与画布更新的并发语义一致（没有行时版本为 0，首次保存即插入）。
   * @param userId - 归属用户。
   * @param diff - 待写入的默认插件差异。
   * @param version - 乐观锁版本（必填）。
   * @returns 保存后的默认插件表视图（含新版本与节点级插件行）。
   */
  async saveUserDefaults(userId: string, diff: InstancePluginDiff, version: number): Promise<UserDefaultsView> {
    // 校验先于写：与新建节点、编译回落共用同一份投影（非法即 422），不写进读不出来的行。
    this.nodeRowsOf(diff)
    const current = await this.readUserDefaults(userId)
    if (version !== current.version) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `user ${userId} default plugin table was modified (expected ${String(current.version)}, got ${String(version)}); refresh and retry`)
    }
    const now = new Date().toISOString()
    const text = JSON.stringify(diff)
    if (current.version === 0) {
      try {
        await this.runtime.db.prepare(
          'INSERT INTO user_default_plugins (user_id, plugins, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        ).run(userId, text, now, now)
      } catch (error) {
        // 并发首存只有一个能插入：唯一约束冲突收敛为 409（与画布更新同一语义）。
        if (!isUniqueViolation(error)) throw error
        throw new FrameworkError(409, 'VERSION_CONFLICT',
          `user ${userId} default plugin table was created concurrently; refresh and retry`)
      }
    } else {
      const result = await this.runtime.db.prepare(
        'UPDATE user_default_plugins SET plugins = ?, updated_at = ?, version = version + 1 WHERE user_id = ? AND version = ?',
      ).run(text, now, userId, version)
      if (result.changes === 0) {
        throw new FrameworkError(409, 'VERSION_CONFLICT',
          `user ${userId} default plugin table was modified concurrently (expected ${String(version)}); refresh and retry`)
      }
    }
    return await this.userDefaults(userId)
  }

  /**
   * 该用户默认插件表投影出的节点级插件行（新建节点初始化与编译/打包回落的同一来源）。
   * @param userId - 归属用户。
   * @returns 原生插件行；默认表为空时为空数组。
   */
  async defaultNodePlugins(userId: string): Promise<NodePluginRow[]> {
    const { diff } = await this.readUserDefaults(userId)
    return this.nodeRowsOf(diff)
  }

  /**
   * 给「未声明 plugins」的 agent 节点补上该用户的默认插件行。
   *
   * 运行编译与打包（经画布编译）都调用这一处：回落规则只有这一份。
   * 显式声明过 `plugins` 的节点（含空数组）保持原样；注释节点不是 agent，不参与回落。
   * @param userId - 归属用户。
   * @param nodes - 画布节点。
   * @returns 补过默认行的新节点数组（未命中回落时原样返回副本）。
   */
  async applyNodeDefaults<T extends { kind: string; plugins?: NodePluginRow[] }>(userId: string, nodes: readonly T[]): Promise<T[]> {
    const pending = nodes.some(node => node.kind !== 'note' && node.plugins === undefined)
    if (!pending) return [...nodes]
    const defaults = await this.defaultNodePlugins(userId)
    if (defaults.length === 0) return [...nodes]
    return nodes.map(node => node.kind !== 'note' && node.plugins === undefined
      ? { ...node, plugins: defaults.map(row => ({ ...row })) }
      : node)
  }

  /**
   * 一份默认插件差异 → 节点级插件行（原生插件行格式）。
   *
   * 用**空基线**执行与画布实例差异同一份组合校验：默认表只声明实例新增行，
   * `disable`/`replace`/`configure` 因无从指向基线行而按 422 拒绝，
   * 因此节点行 = 校验后的 `add` 行（按声明顺序）。
   * @param diff - 默认插件差异。
   * @returns 节点级插件行。
   */
  private nodeRowsOf(diff: InstancePluginDiff): NodePluginRow[] {
    return this.applyDiff(diff, new Map(), 'the user default plugin table')
      .filter(row => row.origin === 'add')
      .map(row => ({
        id: row.id,
        name: row.name,
        ...(row.config === undefined ? {} : { config: row.config }),
      }))
  }

  /**
   * 解析默认插件表的 JSON 文本（损坏即 500，不静默当空表）。
   * @param row - `user_default_plugins` 行。
   * @param userId - 归属用户（错误定位）。
   * @returns 默认插件差异。
   */
  private static parseUserDefaults(row: UserDefaultPluginsRow, userId: string): InstancePluginDiff {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.plugins)
    } catch (error) {
      throw new FrameworkError(500, 'USER_DEFAULTS_CORRUPT',
        `user ${userId} default plugin table is not valid JSON: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(500, 'USER_DEFAULTS_CORRUPT',
        `user ${userId} default plugin table must be a JSON object`)
    }
    return parsed as InstancePluginDiff
  }

  /**
   * 把一份实例差异应用到 profile 组合上，得到净组合行。
   * @param diff - 画布声明的实例差异（未校验的 JSON）。
   * @param canvasId - 画布 id（错误定位）。
   * @returns 基线行（按层序）+ 实例替换/新增行（按声明顺序）。
   */
  private composeInstance(diff: InstancePluginDiff, canvasId: string): InstanceRow[] {
    const rows = new Map<string, InstanceRow>()
    for (const row of this.liveRows()) {
      // 加载器内部虚拟模块不是可打包的插件行：它们不进入实例组合与产物依赖闭包。
      if (isLoaderInternal(row.name)) continue
      const info = this.packageInfo(row.name)
      if (info === undefined) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `canvas ${canvasId} cannot compose: row ${row.id} names ${row.name}, which does not resolve to a package`)
      }
      rows.set(row.id, {
        id: row.id,
        name: row.name,
        kind: info.kind,
        disabled: row.disabled,
        version: info.version,
        origin: 'baseline',
      })
    }
    return this.applyDiff(diff, rows, `canvas ${canvasId}`)
  }

  /**
   * 把一份实例差异应用到给定行集上（画布实例差异与用户默认插件表共用同一份规则）。
   * @param diff - 待应用的差异（未校验的 JSON）。
   * @param rows - 起始行集（行 id → 行；用户默认插件表传空表）。
   * @param scope - 错误定位前缀（`canvas <id>` 或默认插件表的说明）。
   * @returns 应用后的净组合行。
   */
  private applyDiff(diff: InstancePluginDiff, rows: Map<string, InstanceRow>, scope: string): InstanceRow[] {
    const requireList = <T>(value: unknown, field: string): T[] => {
      if (value === undefined) return []
      if (!Array.isArray(value)) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', `${scope} plugin ${field} must be an array`)
      }
      return value as T[]
    }
    const requireId = (value: unknown, field: string): string => {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', `${scope} plugin ${field} needs a non-empty string id`)
      }
      return value
    }
    const requireName = (value: unknown, field: string, id: string): string => {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', `${scope} plugin ${field} row ${id} needs a non-empty package name`)
      }
      return value
    }
    /** 实例新增行声明的「本行替换的基线服务名」：去空、去重，非法即 422。 */
    const optionalIsolate = (value: unknown, id: string): string[] | undefined => {
      if (value === undefined) return undefined
      if (!Array.isArray(value)) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin add row ${id} isolate must be an array of service names`)
      }
      const names: string[] = []
      for (const item of value) {
        if (typeof item !== 'string' || item.trim() === '') {
          throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
            `${scope} plugin add row ${id} isolate entries must be non-empty service names`)
        }
        if (names.includes(item)) {
          throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
            `${scope} plugin add row ${id} isolate names ${item} more than once`)
        }
        names.push(item)
      }
      return names
    }
    /** 同一份差异里的行 id 必须唯一（重复项会让「后者静默覆盖前者」）。 */
    const assertUniqueIds = (field: string, ids: readonly string[]): void => {
      const seen = new Set<string>()
      for (const id of ids) {
        if (seen.has(id)) {
          throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
            `${scope} plugin ${field} names row ${id} more than once`)
        }
        seen.add(id)
      }
    }
    /** 实例差异里可被 replace/disable 的行：只有客户端行（宿主行由进程基线装载）。 */
    const requireClientRow = (id: string, field: string): InstanceRow => {
      const row = rows.get(id)
      if (row === undefined) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin ${field} names row ${id}, which the profile composition does not declare`)
      }
      if (row.kind !== 'client') {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin ${field} targets host row ${id}; host rows are mounted by the process baseline and can only be added (not disabled or replaced) per flow`)
      }
      return row
    }

    const disableIds = requireList<unknown>(diff.disable, 'disable').map(raw => requireId(raw, 'disable'))
    assertUniqueIds('disable', disableIds)
    for (const id of disableIds) {
      requireClientRow(id, 'disable').disabled = true
    }
    const replaceItems = requireList<Record<string, unknown>>(diff.replace, 'replace')
    assertUniqueIds('replace', replaceItems.map(raw => requireId(raw?.id, 'replace')))
    for (const raw of replaceItems) {
      const id = requireId(raw?.id, 'replace')
      const row = requireClientRow(id, 'replace')
      const name = requireName(raw?.name, 'replace', id)
      const info = this.packageInfo(name)
      if (info === undefined) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin replace row ${id} names ${name}, which does not resolve to a package`)
      }
      if (info.kind !== 'client') {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin replace row ${id} names host package ${name}; a client row can only be replaced by a client package`)
      }
      row.name = name
      row.kind = info.kind
      row.version = info.version
      row.origin = 'replace'
      if (raw?.config !== undefined) row.config = raw.config
    }
    const configureItems = requireList<Record<string, unknown>>(diff.configure, 'configure')
    assertUniqueIds('configure', configureItems.map(raw => requireId(raw?.id, 'configure')))
    for (const raw of configureItems) {
      const id = requireId(raw?.id, 'configure')
      const row = rows.get(id)
      if (row === undefined || row.origin === 'baseline') {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin configure row ${id} is not an instance row; baseline configuration belongs to the profile composition`)
      }
      row.config = raw?.config
    }
    for (const raw of requireList<Record<string, unknown>>(diff.add, 'add')) {
      const id = requireId(raw?.id, 'add')
      if (rows.has(id)) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin add row ${id} collides with a declared composition row`)
      }
      const name = requireName(raw?.name, 'add', id)
      const info = this.packageInfo(name)
      if (info === undefined) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID',
          `${scope} plugin add row ${id} names ${name}, which does not resolve to a package`)
      }
      const isolate = optionalIsolate(raw?.isolate, id)
      rows.set(id, {
        id,
        name,
        kind: info.kind,
        disabled: false,
        version: info.version,
        origin: 'add',
        ...(raw?.config === undefined ? {} : { config: raw.config }),
        ...(isolate === undefined ? {} : { isolate }),
      })
    }
    return [...rows.values()]
  }
}
