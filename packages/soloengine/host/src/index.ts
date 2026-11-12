/**
 * @soloengine/host —— 框架层挂载插件 + 运行驱动。
 *
 * 职责（PRD-01 FR-ARCH-001/050、PRD-06、《SoloEngine 框架设计》§6.1/§6.4）：
 * - 建立框架层运行时（业务库 + 主密钥 + 账号域），并把其 Express 应用以**前缀路由**
 *   挂进 dsh `ctx.webServer` 的同一条 HTTP 服务——单进程、单端口、单 Web 壳；
 *   无 HTTP 服务的形态（平台 headless）不挂 HTTP 面，只提供业务库与模型路由
 *   （产物 profile 的 headless 一次性作业走这条路）；
 * - **运行驱动**：把「框架层的运行请求」翻译为原生 harness 调用——每画布一份 harness
 *   实例（`@soloengine/instance-runtime`，agent 作用域挂在实例作用域之下，组合随实例
 *   装载/卸载），编译产物再经 agent scope 上的工具收紧与 MCP 挂载落到运行现场，
 *   最后由 `ctx.agents.create` 建 mainagent（模型路由取编译产物、cwd 取运行项目目录）；
 * - **归属直写**：会话与事件两表由本插件监听原生 `session/event` 广播直写（唯一写入方）；
 * - 创造模式审计：监听官方 `cordis/*` 事件落 `creator_audit`；
 * - 打印就绪行；启动自检 fail loud（业务库环境不满足即抛错，不带病启动）。
 *
 * 形态纪律：业务逻辑在 `@soloengine/framework`（普通 TS 模块，不进插件树）；本插件是
 * 两者唯一的接缝，且只做「翻译为原生形态 + 归属直写」，不做数据转换层、不做双写。
 *
 * @module @soloengine/host
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
// 引入模块声明，使 `ctx.webServer` / `ctx.agents` / `ctx.agentPresets` / `ctx.tools` /
// `ctx.subagents` / `ctx.sessionProjections` / `ctx.connection` / `ctx.loader`
// 在类型上可见（module augmentation）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-modules'
// 引入模块声明，使 `ctx.pluginManager` 在类型上可见；类型同时用于管理层投影。
import type { BundleInfo, ChangeResult, PluginInstallRequestId, PluginSpecInspection } from '@deepseek-ai/dsh-plugin-manager'
import { FrameworkRuntime, BUSINESS_TABLES, FRAMEWORK_VERSION } from '@soloengine/framework'
import type { ManagedBundleRow, ManagedChangeResult, ManagedInspection } from '@soloengine/framework'
import { mountOperationAreaBridge } from './ops-bridge.ts'
import { mountRunSettingsBridge } from './run-settings-bridge.ts'
import { resolveSessionOwnership, rootSessionKeyOf } from './session-ownership.ts'
import { attachFollowLayer, attachLedgerWriters, retireSessionsAfterCanvasDelete } from './ledger-writers.ts'
import { attachCreatorAudit, mountProductSettings } from './product-surfaces.ts'
import { mountFileChanges } from './file-changes.ts'
import { PreviewStream, mountPreviewStream } from './preview-stream.ts'
import { mountLedgerRebuild } from './ledger-rebuild.ts'
import { clientTreeErrorPage, clientTreeProblems, runBootstrapRows } from './client-tree.ts'
import { CloudNodeRuntime } from './cloud-node.ts'
import { SessionContainers } from './cloud-containers.ts'
import { SessionVms } from './cloud-vms.ts'
import { WorkspaceSync } from './workspace-sync.ts'
import { objectStoreFromEnv } from './object-store-config.ts'
import { WorkspaceStore } from '@soloengine/image-distribution'
import ContainerSubprocessRuntime from '@soloengine/subprocess-container'
import { RETURN_COOKIE } from './trust-bootstrap.ts'
import { PRODUCT_SURFACE_PATHS, RUN_PANEL_PREFIX, RUN_ROUTE_ROOT, TOOL_MAP } from '@soloengine/types'
import {
  DEFAULT_AGENT_PRESET,
  DEFAULT_MAX_DEPTH,
  DEFAULT_PREFIX,
  MCP_SYNC_INTERVAL_MS,
  resolveKeysDir,
  resolveProductPageIndex,
  resolveRoot,
  type Config,
} from './config.ts'
import {
  createRunDriver,
  followIntentProjectionDefinition,
  nodeAttributionProjectionDefinition,
  parseNodeLabels,
  runContextProjectionDefinition,
  type NodeAttribution,
} from './run-driver.ts'

export type { Config } from './config.ts'
export { resolveProductPageIndex } from './config.ts'
export {
  createRunDriver,
  followIntentProjectionDefinition,
  nodeAttributionProjectionDefinition,
  runContextProjectionDefinition,
} from './run-driver.ts'

/** Cordis plugin name. */
export const name = 'soloengine-host'
/**
 * 不声明必选服务：REST 与产品页面各自等 `webServer` 就绪后再挂（`ctx.inject`）。
 *
 * headless 形态按平台设计**没有** HTTP 服务（`packages/bundle/headless` 的模块头：不挂 Host、
 * HTTP 服务与 Web 运行时），而产物里的模型路由（`soloengineModelRoutes`）必须在该形态可用——
 * 否则「产物 profile 可用 headless 一次性作业加载」这条路走不通。故插件本体不依赖 webServer，
 * 只有挂在 HTTP 上的那些效果等它就绪。
 */
export const inject: string[] = []

/** 云节点参数。 */
interface CloudNodeSettings {
  controlUrl: string
  nodeId: string
  endpoint: string
  region: string
  maxSessions: number
  labels: Record<string, string>
  /** 每用户配额（W10.10；缺省 = 节点容量）。 */
  quota: { maxActiveSessions: number; burstCapacity: number; refillPerSecond: number }
  /** 空闲暂停阈值（毫秒；W10.11 缺省 15 分钟）。 */
  idlePauseMs: number
  /** 空闲驱逐阈值（毫秒；W10.11 缺省 30 分钟）。 */
  idleEvictMs: number
  /** 会话 TTL（毫秒；W10.11 缺省 7 天）。 */
  sessionTtlMs: number
}

/**
 * 读取正整数环境变量（缺省取默认值；非法即加载期报错）。
 * @param name - 环境变量名。
 * @param fallback - 缺省值。
 * @returns 解析结果。
 */
function envPositiveInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`soloengine: ${name} must be a positive integer, got "${raw}"`)
  }
  return value
}

/**
 * 读取正数环境变量（缺省取默认值；非法即加载期报错）。
 * @param name - 环境变量名。
 * @param fallback - 缺省值。
 * @returns 解析结果。
 */
function envPositiveNumber(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`soloengine: ${name} must be a positive number, got "${raw}"`)
  }
  return value
}

/**
 * 解析云节点参数：控制面地址与本节点 id 必须成对出现，且只在云数据库形态下可用。
 * @param config - 插件配置。
 * @returns 云节点参数；两者都没给时为 undefined（单机或单节点云形态）。
 */
function resolveCloudNode(config: Config): CloudNodeSettings | undefined {
  const controlUrl = (config.controlUrl ?? process.env.SOLOENGINE_CONTROL_URL ?? '').trim()
  const nodeId = (config.nodeId ?? process.env.SOLOENGINE_NODE_ID ?? '').trim()
  if (controlUrl === '' && nodeId === '') return undefined
  if (controlUrl === '' || nodeId === '') {
    throw new Error('soloengine: SOLOENGINE_CONTROL_URL and SOLOENGINE_NODE_ID must be set together')
  }
  const form = config.databaseForm ?? process.env.SOLOENGINE_DB_FORM ?? 'single'
  if (form !== 'cloud') {
    throw new Error('soloengine: a cloud node requires the cloud database form (SOLOENGINE_DB_FORM=cloud)')
  }
  const endpoint = (process.env.SOLOENGINE_NODE_ENDPOINT
    ?? `http://127.0.0.1:${process.env.SOLOENGINE_PORT ?? '8991'}`).trim()
  const region = (process.env.SOLOENGINE_REGION ?? 'local').trim()
  const maxSessions = envPositiveInt('SOLOENGINE_MAX_SESSIONS', 8)
  const quotaMax = envPositiveInt('SOLOENGINE_QUOTA_MAX_ACTIVE', maxSessions)
  return {
    controlUrl,
    nodeId,
    endpoint,
    region,
    maxSessions,
    labels: parseNodeLabels(process.env.SOLOENGINE_NODE_LABELS),
    quota: {
      maxActiveSessions: quotaMax,
      burstCapacity: envPositiveInt('SOLOENGINE_QUOTA_BURST', quotaMax),
      refillPerSecond: envPositiveNumber('SOLOENGINE_QUOTA_REFILL_PER_SECOND', 1),
    },
    idlePauseMs: envPositiveInt('SOLOENGINE_IDLE_PAUSE_MS', 900_000),
    idleEvictMs: envPositiveInt('SOLOENGINE_IDLE_EVICT_MS', 1_800_000),
    sessionTtlMs: envPositiveInt('SOLOENGINE_SESSION_TTL_MS', 604_800_000),
  }
}


/**
 * 解析出口白名单（逗号分隔的 `host[:port]`，支持 `*.example.com` 后缀通配）。
 * @param raw - 环境变量原文。
 * @returns 规则列表。
 */
function parseEgressAllow(raw: string | undefined): { host: string; port?: number }[] {
  if (raw === undefined || raw.trim() === '') return []
  return raw.split(',')
    .map(token => token.trim())
    .filter(token => token !== '')
    .map((token) => {
      const last = token.lastIndexOf(':')
      if (last === -1) return { host: token }
      const host = token.slice(0, last)
      const port = Number(token.slice(last + 1))
      if (host === '' || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`soloengine: SOLOENGINE_EGRESS_ALLOW entry "${token}" must be host[:port]`)
      }
      return { host, port }
    })
}

/**
 * 解析 DNS 服务器列表（逗号分隔的地址）。
 * @param raw - 环境变量原文。
 * @returns 地址列表。
 */
function parseDnsServers(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  return raw.split(',').map(token => token.trim()).filter(token => token !== '')
}

/**
 * 解析工作区同步器（W10.12）：对象存储根由 `SOLOENGINE_WORKSPACE_STORE` 给出。
 *
 * 未配置 = 单机/无对象存储形态，不启用（本地工作副本即全部状态）；配置了却不是云节点
 * 即加载期报错——清单要落在共享库，单机形态没有可跨节点读取的清单。
 * @param root - 实例根目录（本地缓存落 `<root>/data/workspace-cache`）。
 * @param cloud - 云节点运行时（清单读写通道）。
 * @returns 同步器；未配置时为 undefined。
 */
function resolveWorkspaceSync(root: string, cloud: CloudNodeRuntime | undefined): WorkspaceSync | undefined {
  const raw = (process.env.SOLOENGINE_WORKSPACE_STORE ?? '').trim()
  if (raw === '') return undefined
  if (cloud === undefined) {
    throw new Error('soloengine: SOLOENGINE_WORKSPACE_STORE requires a cloud node (control plane + PostgreSQL)')
  }
  return new WorkspaceSync({
    store: new WorkspaceStore({
      root: join(root, 'data', 'workspace-cache'),
      remote: objectStoreFromEnv(raw),
    }),
    saveManifest: (sessionKey, files) => cloud.saveWorkspaceManifest(sessionKey, files),
    loadManifest: sessionKey => cloud.workspaceManifest(sessionKey),
    log: (message) => { console.log(message) },
  })
}

/**
 * 解析执行形态（`local` | `container` | `microvm` | `full-vm`）：部署级事实，执行世界与画布编译共用同一取值。
 * @param config - 插件配置。
 * @returns 执行形态。
 */
function resolveExecutorMode(config: Config): 'local' | 'container' | 'microvm' | 'full-vm' {
  const mode = (config.executor ?? process.env.SOLOENGINE_EXECUTOR ?? 'local').trim()
  if (mode !== 'local' && mode !== 'container' && mode !== 'microvm' && mode !== 'full-vm') {
    throw new Error(`soloengine: SOLOENGINE_EXECUTOR must be "local", "container", "microvm", or "full-vm", got "${mode}"`)
  }
  return mode
}

/**
 * 解析执行后端：非本机形态只在云数据库形态下可用，且必须给出镜像；C 档必须给出 OCI 运行时。
 * @param config - 插件配置。
 * @returns 会话容器管理器；本机与全 VM 形态为 undefined。
 */
function resolveContainers(config: Config): SessionContainers | undefined {
  const mode = resolveExecutorMode(config)
  if (mode === 'local' || mode === 'full-vm') return undefined
  const form = config.databaseForm ?? process.env.SOLOENGINE_DB_FORM ?? 'single'
  if (form !== 'cloud') {
    throw new Error(`soloengine: the ${mode} executor requires the cloud database form (SOLOENGINE_DB_FORM=cloud)`)
  }
  const image = (config.containerImage ?? process.env.SOLOENGINE_CONTAINER_IMAGE ?? '').trim()
  if (image === '') {
    throw new Error(`soloengine: SOLOENGINE_CONTAINER_IMAGE is required when SOLOENGINE_EXECUTOR=${mode}`)
  }
  const docker = (config.containerDocker ?? process.env.SOLOENGINE_DOCKER ?? 'docker').trim()
  const runtime = (
    config.containerRuntime
    ?? process.env.SOLOENGINE_CONTAINER_RUNTIME
    ?? (mode === 'container' ? '' : 'kata-runtime')
  ).trim()
  if (mode !== 'container' && runtime === '') {
    throw new Error(`soloengine: SOLOENGINE_CONTAINER_RUNTIME is required when SOLOENGINE_EXECUTOR=${mode}`)
  }
  const allow = parseEgressAllow(process.env.SOLOENGINE_EGRESS_ALLOW)
  const dnsServers = parseDnsServers(process.env.SOLOENGINE_EGRESS_DNS)
  const proxyImage = (process.env.SOLOENGINE_EGRESS_PROXY_IMAGE ?? image).trim()
  if (proxyImage === '') {
    throw new Error('soloengine: SOLOENGINE_EGRESS_PROXY_IMAGE must not be empty')
  }
  return new SessionContainers({
    image,
    docker,
    ...runtime === '' ? {} : { runtime },
    policy: { allow, dnsServers },
    proxyImage,
    // 节点镜像缓存（W10.12）：离线节点可关按需拉取，缺镜像即显式失败。
    allowPull: (process.env.SOLOENGINE_IMAGE_PULL ?? '1') !== '0',
    log: (message) => { console.log(message) },
  })
}

/**
 * 读一个正整数部署值（未设置或空串时返回 undefined）。
 * @param value - 显式配置值或环境变量文本。
 * @param name - 诊断用的部署键名。
 * @returns 正整数或 undefined。
 */
function parsePositiveInt(value: number | string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (text === '') return undefined
  const parsed = Number.parseInt(text, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`soloengine: ${name} must be a positive integer, got "${text}"`)
  }
  return parsed
}

/**
 * 原生组合包 → 管理层视图（只投影字段，不改语义）。
 * @param bundle - 原生 `pluginManager.listBundles` 的一行。
 * @returns 管理面渲染所需的组合包行。
 */
function managedBundle(bundle: BundleInfo): ManagedBundleRow {
  return {
    name: bundle.name,
    version: bundle.version ?? null,
    description: bundle.description ?? null,
    enabled: bundle.enabled,
    installed: bundle.installed,
    removable: bundle.removable,
    official: bundle.official,
    optional: bundle.optional,
    readOnlyReason: bundle.readOnlyReason ?? null,
    error: bundle.error === undefined ? null : { code: bundle.error.code, diagnostic: bundle.error.diagnostic ?? null },
    rowCount: bundle.rows.length,
  }
}

/**
 * 原生变更结果 → 管理层视图（只投影字段，不改语义）。
 * @param result - 原生 `pluginManager` 的 `ChangeResult`。
 * @returns 管理面渲染所需的操作结果。
 */
function managedChange(result: ChangeResult): ManagedChangeResult {
  return {
    changed: result.changed,
    application: result.application,
    restartReason: result.restartReason ?? null,
    stage: result.stage,
    target: result.target,
    enabled: result.enabled ?? null,
    error: result.error === undefined
      ? null
      : {
        code: result.error.code,
        diagnostic: result.error.diagnostic ?? null,
        incompatible: (result.error.incompatible ?? []).map(item => ({
          name: item.name,
          version: item.version,
          runtimeVersion: item.runtimeVersion,
        })),
      },
    warnings: result.warnings ?? [],
    bundle: result.bundle ?? null,
    version: result.version ?? null,
    pendingBuilds: result.pendingBuilds ?? [],
    registries: result.registries ?? [],
    failedAt: result.failedAt ?? null,
  }
}

/**
 * 原生安装规格检查 → 管理层视图（只投影字段，不改语义）。
 * @param inspection - 原生 `pluginManager.inspect` 的结果。
 * @returns 管理面渲染所需的检查结果。
 */
function managedInspection(inspection: PluginSpecInspection): ManagedInspection {
  if (inspection.status === 'accepted') {
    return {
      status: 'accepted',
      kind: inspection.kind,
      name: inspection.name ?? null,
      version: inspection.version ?? null,
      description: inspection.description ?? null,
      bundle: inspection.bundle,
      registry: inspection.registry,
    }
  }
  return {
    status: 'refused',
    problem: inspection.problem,
    reason: inspection.reason,
    registries: inspection.registries ?? [],
  }
}

/**
 * 解析全 VM 执行后端（D 档）：只在云数据库形态下可用，镜像、状态目录与私钥缺一即失败。
 * @param config - 插件配置。
 * @returns 会话 VM 管理器；非 `full-vm` 形态为 undefined。
 */
function resolveVms(config: Config): SessionVms | undefined {
  const mode = resolveExecutorMode(config)
  if (mode !== 'full-vm') return undefined
  const form = config.databaseForm ?? process.env.SOLOENGINE_DB_FORM ?? 'single'
  if (form !== 'cloud') {
    throw new Error(`soloengine: the ${mode} executor requires the cloud database form (SOLOENGINE_DB_FORM=cloud)`)
  }
  const image = (config.vmImage ?? process.env.SOLOENGINE_VM_IMAGE ?? '').trim()
  if (image === '') {
    throw new Error('soloengine: SOLOENGINE_VM_IMAGE is required when SOLOENGINE_EXECUTOR=full-vm')
  }
  const stateDir = (config.vmStateDir ?? process.env.SOLOENGINE_VM_STATE_DIR ?? '').trim()
  if (stateDir === '') {
    throw new Error('soloengine: SOLOENGINE_VM_STATE_DIR is required when SOLOENGINE_EXECUTOR=full-vm')
  }
  const sshKey = (config.vmSshKey ?? process.env.SOLOENGINE_VM_SSH_KEY ?? '').trim()
  if (sshKey === '') {
    throw new Error('soloengine: SOLOENGINE_VM_SSH_KEY is required when SOLOENGINE_EXECUTOR=full-vm')
  }
  const accel = (config.vmAccel ?? process.env.SOLOENGINE_VM_ACCEL ?? '').trim()
  if (accel !== '' && accel !== 'kvm' && accel !== 'tcg') {
    throw new Error(`soloengine: SOLOENGINE_VM_ACCEL must be "kvm" or "tcg", got "${accel}"`)
  }
  const sshUser = (config.vmSshUser ?? process.env.SOLOENGINE_VM_SSH_USER ?? '').trim()
  const memoryMb = parsePositiveInt(config.vmMemoryMb ?? process.env.SOLOENGINE_VM_MEMORY_MB, 'SOLOENGINE_VM_MEMORY_MB')
  const cpus = parsePositiveInt(config.vmCpus ?? process.env.SOLOENGINE_VM_CPUS, 'SOLOENGINE_VM_CPUS')
  const bootTimeoutMs = parsePositiveInt(process.env.SOLOENGINE_VM_BOOT_TIMEOUT_MS, 'SOLOENGINE_VM_BOOT_TIMEOUT_MS')
  const qemu = (process.env.SOLOENGINE_QEMU ?? '').trim()
  const qemuImg = (process.env.SOLOENGINE_QEMU_IMG ?? '').trim()
  const ssh = (process.env.SOLOENGINE_SSH ?? '').trim()
  return new SessionVms({
    image,
    stateDir,
    sshKey,
    ...sshUser === '' ? {} : { sshUser },
    ...accel === '' ? {} : { accel },
    ...memoryMb === undefined ? {} : { memoryMb },
    ...cpus === undefined ? {} : { cpus },
    ...bootTimeoutMs === undefined ? {} : { bootTimeoutMs },
    ...qemu === '' ? {} : { qemu },
    ...qemuImg === '' ? {} : { qemuImg },
    ...ssh === '' ? {} : { ssh },
    display: (process.env.SOLOENGINE_VM_DISPLAY ?? '1') !== '0',
    log: (message) => { console.log(message) },
  })
}

/**
 * Mount the framework layer's REST surface onto the harness HTTP server.
 * @param ctx - Plugin context (must inject `webServer`).
 * @param config - Validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const root = resolveRoot(config)
  const prefix = config.prefix ?? DEFAULT_PREFIX
  const agentPreset = config.agentPreset ?? DEFAULT_AGENT_PRESET
  const maxDepth = config.maxDelegationDepth ?? DEFAULT_MAX_DEPTH
  const cloudSettings = resolveCloudNode(config)
  const cloud = cloudSettings === undefined
    ? undefined
    : new CloudNodeRuntime({
      ...cloudSettings,
      liveSessions: () => ctx.agents.list().length,
      log: (message) => { console.log(message) },
    })
  const containers = resolveContainers(config)
  if (containers !== undefined) {
    // 节点退出时销毁全部会话容器；失败逐条报出，不阻断其余销毁。
    ctx.effect(() => () => containers.destroyAll(), 'soloengine-host.sessionContainers')
  }
  const vms = resolveVms(config)
  if (vms !== undefined) {
    // 节点退出时销毁全部会话 VM；失败逐条报出，不阻断其余销毁。
    ctx.effect(() => () => vms.destroyAll(), 'soloengine-host.sessionVms')
  }
  const workspaceSync = resolveWorkspaceSync(root, cloud)
  // profile 真源由启动器决定（产物/桌面形态是 `$DSH_HOME/profiles/<名字>`，不是仓库检出的
  // `data/dsh-home/profiles/soloengine`）；拿到启动器事实时以它为准。
  const launchFacts = ctx.get('profileContext') as { dir?: unknown } | undefined
  const launchProfileDir = typeof launchFacts?.dir === 'string' ? launchFacts.dir : undefined
  const keysDir = resolveKeysDir(config)
  const runtime = await FrameworkRuntime.create({
    root,
    ...(keysDir === undefined ? {} : { keysDir }),
    ...(config.databasePath === undefined ? {} : { databasePath: config.databasePath }),
    ...(config.databaseForm === undefined ? {} : { databaseForm: config.databaseForm }),
    ...(config.databaseUrl === undefined ? {} : { databaseUrl: config.databaseUrl }),
    ...(launchProfileDir === undefined ? {} : { profileDir: launchProfileDir }),
    executor: resolveExecutorMode(config),
  })
  // 云形态：启动对账必须按控制面的租约真相收敛（台账跨节点共享，本进程的 live() 只覆盖自己）。
  if (cloud !== undefined) runtime.runs.setLeaseProbe(key => cloud.leaseLive(key))

  // 模型路由回调：harness 侧适配器只向管理层要「路由事实 + 已解密密钥」，
  // 不读业务库、不持有主密钥（《框架设计》§四）。**按用户归属收敛**（需求 §0.1.4）：
  // 事实按桶逐用户取、密钥按桶归属解析，会话归属用 `sessions.user_id` 这一份真源。
  ctx.provide('soloengineModelRoutes', {
    listActiveOwners: () => runtime.models.listActiveOwners(),
    listActive: async (userId: string) => (await runtime.models.listActive(userId)).map(row => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      provider: row.provider,
      model_name: row.model_name,
      base_url: row.base_url,
      is_full_url: row.is_full_url,
      temperature: row.temperature,
      max_tokens: row.max_tokens,
      max_input_tokens: row.max_input_tokens,
      max_output_tokens: row.max_output_tokens,
      top_p: row.top_p,
      frequency_penalty: row.frequency_penalty,
      presence_penalty: row.presence_penalty,
      extra_params: row.extra_params,
      max_tool_calls: row.max_tool_calls,
      timeout: row.timeout,
      is_active: row.is_active,
      version: row.version,
      updated_at: row.updated_at,
    })),
    resolveApiKey: (userId: string, id: string) => runtime.models.resolveApiKey(userId, id),
    ownerOfSession: async (sessionId: string) => (await runtime.runs.ownerOf(sessionId)) ?? undefined,
  })

  // 框架层的归属回退：没有自己台账行的会话（分支、子代理子会话）按会话树根解析。
  // 模型路由的「会话属于谁」、变更台账的沙箱根都问这一处，避免各自只认自己那一行。
  runtime.runs.setOwnershipResolver(async (sessionKey) => {
    const ownership = await resolveSessionOwnership(ctx, runtime, sessionKey)
    return ownership === undefined
      ? undefined
      : { userId: ownership.row.user_id, projectId: ownership.row.run_project_id }
  })

  // 跨用户会话归属（需求 §0.1.4 / 187）：原生 RPC 与事件流走的是信任门（进程令牌换签名
  // cookie），没有产品 Bearer；故登录成功时把账号写进同一 authority 的签名 cookie（见
  // `router.ts` 的 auth-login），连接层再按「cookie 账号 × sessions.user_id」判定归属。
  // 不新造第二套认证：凭据仍是 `dsh web` 那一份签名 cookie，真源仍是 `sessions` 台账。
  ctx.effect(() => {
    const fiber = ctx.inject(['connection'], (guardCtx) => {
      guardCtx.effect(() => {
        const dispose = guardCtx.connection.setAccountScope({
          authorize: async ({ userId, sessionIds, instance }) => {
            for (const sessionId of sessionIds) {
              // 真源只有一份：`sessions` 台账（归属用户 + 归属画布），会话自己的行或会话树根的行。
              // 分支/草稿会话由会话引擎直接创建，没有自己的台账行；沿父链归到已登记的
              // 画布根再判定，否则创建者刚生成的分支会话也会被 403 拒绝。
              // 带实例（`/run/:flow` 面板）且根也没有行时，按会话头 cwd 命中本画布的运行项目
              // 补登根行——面板里的「新会话」由此获得归属，否则它既不在列表里也发不出消息。
              const ownership = await resolveSessionOwnership(guardCtx, runtime, sessionId, {
                userId,
                ...(instance === undefined ? {} : { instance }),
                adopt: instance !== undefined,
              })
              if (ownership === undefined) return false
            }
            return true
          },
          // 会话列表 / 检索 / 实时投影的收窄集合：台账根 + 其全部分支/草稿后代。
          ownedSessions: async (userId, instance) => {
            const roots = await runtime.runs.ledger.sessionKeysOf(userId, instance)
            const persistence = guardCtx.get('sessionPersistence')
            if (persistence === undefined || roots.length === 0) return roots
            // 分支/草稿会话由会话引擎直接创建，没有自己的台账行；按会话头把后代并进
            // 根集合，侧栏、检索和实时投影才能看见它们。
            const children = new Map<string, string[]>()
            for (const snapshot of await persistence.list()) {
              const parent = snapshot.header.parentSession
              if (parent === undefined) continue
              const key = String(parent)
              const bucket = children.get(key)
              if (bucket === undefined) children.set(key, [String(snapshot.header.id)])
              else bucket.push(String(snapshot.header.id))
            }
            const owned = [...roots]
            const seen = new Set(roots)
            const queue = [...roots]
            while (queue.length > 0) {
              const current = queue.shift() as string
              for (const child of children.get(current) ?? []) {
                if (seen.has(child)) continue
                seen.add(child)
                owned.push(child)
                queue.push(child)
              }
            }
            return owned
          },
          // 模型目录的收窄集合：只给本人启用中的配置路由名。
          ownedModelRoutes: async userId =>
            (await runtime.models.listActive(userId)).map(row => `soloengine-${row.id}`),
        })
        return () => { dispose() }
      }, 'soloengine-host.accountScope')
      runtime.bindBrowserUser = (request, response, userId) =>
        guardCtx.connection.bindBrowserUser(request, response, userId)
      guardCtx.effect(() => () => { delete runtime.bindBrowserUser }, 'soloengine-host.bindBrowserUser')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.sessionIsolation')

  // 部署摘要的真实来源（PRD-11 FR-DEP-011）：同进程 webServer 的实际绑定值。两个 getter 转发到
  // 服务自身（监听在启动回调里落定），故就绪后 `/deployment/guide` 报出的是真实主机与端口。
  // 无 HTTP 服务的形态（headless）不提供该端点，访问即 fail loud。
  const boundWebServer = (): { host: string; port: number | undefined } => {
    const webServer = ctx.get('webServer') as { host: string; port: number | undefined } | undefined
    if (webServer === undefined) {
      throw new Error('soloengine-host: this profile has no web server; the deployment guide is only served over HTTP')
    }
    return webServer
  }
  runtime.deployment = {
    get host(): string { return boundWebServer().host },
    get port(): number {
      const port = boundWebServer().port
      if (port === undefined) {
        throw new Error('soloengine-host: the web listener has no bound port yet; the deployment guide is served after startup')
      }
      return port
    },
    // 连接层的信任域来自启动参数（web-app bundle 把 `--trusted-host` 经 webStartup 提供给
    // client-connection 的同一个数组）。组合层未装载 webStartup 时如实报空数组（只信回环）。
    get trustedHosts(): readonly string[] {
      const startup = ctx.get('webStartup') as { trustedHosts?: unknown } | undefined
      return Array.isArray(startup?.trustedHosts)
        ? startup.trustedHosts.filter((entry): entry is string => typeof entry === 'string')
        : []
    },
  }

  // 启动自检（fail loud）：业务库环境不满足即抛错，不带病启动。
  const environment = await runtime.db.environment()
  if (environment.missingTables.length > 0) {
    throw new Error(
      `soloengine-host: business database at ${environment.path} is missing tables: ${environment.missingTables.join(', ')}`,
    )
  }
  if (environment.engine === 'sqlite' && environment.journalMode.toLowerCase() !== 'wal') {
    throw new Error(`soloengine-host: business database journal_mode is ${environment.journalMode}, expected wal`)
  }

  // system 种子账号（超管）：登录名 system / 口令 system。
  const seeded = await runtime.accounts.seedSystem()
  // 演示账号（登录页「演示账号 solo / soloengine」的可点击前提）：普通用户，幂等。
  const demo = await runtime.accounts.seedDemo()
  if (demo.created) console.log('soloengine: demo account seeded (solo)')

  // 出厂技能（W11.4 / PRD-04 §2）：幂等登记 data/market/skills 的资产为系统技能，
  // 并把启用项同步进已有运行项目的项目层 junction；坏资产跳过、不阻断启动。
  const factorySkills = await runtime.skills.seedSystemSkills()
  if (factorySkills.created > 0 || factorySkills.upgraded > 0 || factorySkills.skipped > 0) {
    console.log(`soloengine: factory skills seeded (created=${String(factorySkills.created)},`
      + ` upgraded=${String(factorySkills.upgraded)}, skipped=${String(factorySkills.skipped)})`)
  }

  // 画布删除的级联到会话日志：业务行（项目/会话/事件）在框架层事务里删，正文在
  // `ctx.sessionPersistence`；由 host 在事务提交后停掉仍在跑的运行并按会话键删表行
  // （未提供扩展方法的 JSONL 后端退回目录清理）。每次动作打印一行，删掉了什么可见、不静默。
  runtime.canvas.setSessionLogRemover((_userId, keys) => {
    void retireSessionsAfterCanvasDelete(ctx, runtime, keys).catch((error: unknown) => {
      console.log(`soloengine: retiring sessions after a canvas delete failed (${String(error)})`)
    })
  })

  // 会话导出的正文读 `ctx.sessionPersistence`（SQLite/PG 形态正文在业务库，不是 JSONL 目录）；
  // 绑定失败不下线导出，退回目录扫描——但那就看不到新会话的正文（如实暴露为 bytes 0）。
  ctx.effect(() => {
    const fiber = ctx.inject(['sessionPersistence'], (persistCtx) => {
      runtime.bindSessionLogSource(persistCtx.sessionPersistence)
      persistCtx.effect(() => () => { runtime.bindSessionLogSource(undefined) }, 'soloengine-host.sessionLogSource')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.bindSessionLogSource')

  // 组合与插件清单读原生 Loader 的活条目：层合并、`!!js` 求值与「patch 未命中即跳过」
  // 都是 Loader 自己的语义，框架层不再解析组合层 YAML（一份事实，不做第二套）。
  ctx.effect(() => {
    const fiber = ctx.inject(['loader'], (loaderCtx) => {
      runtime.plugins.bindInventory({
        rows: () => [...loaderCtx.loader.entries()]
          .filter(entry => entry.options.group !== true)
          .map(entry => ({
            id: entry.options.id,
            name: entry.options.name,
            disabled: entry.disabled,
          })),
      })
      loaderCtx.effect(() => () => { runtime.plugins.bindInventory(undefined) }, 'soloengine-host.pluginInventory')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.bindPluginInventory')

  // profile 级插件管理：管理层 REST 经这条桥调用原生 `pluginManager`。
  // 安装/启停/移除只有一份实现（DSH plugin-manager）；框架层不写 profile 文件、不写第二套安装器。
  // 服务缺失（非托管 profile / headless）即保持未绑定，管理接口以结构化错误拒绝，不静默降级。
  ctx.effect(() => {
    const fiber = ctx.inject(['pluginManager'], (managerCtx) => {
      const manager = managerCtx.pluginManager
      runtime.plugins.bindManager({
        bundles: async () => (await manager.listBundles()).map(managedBundle),
        setBundleEnabled: async (name, enabled) => managedChange(await manager.setBundleEnabled(name, enabled)),
        inspect: async spec => managedInspection(await manager.inspect(spec)),
        install: async (spec, requestId, enabled, approvedBuilds) => managedChange(await manager.installBundle(spec, {
          enabled,
          requestId: requestId as PluginInstallRequestId,
          ...(approvedBuilds.length === 0 ? {} : { approvedBuilds: [...approvedBuilds] }),
        })),
        waitForInstall: async (requestId) => {
          const result = await manager.waitForInstall(requestId as PluginInstallRequestId)
          return result === null ? null : managedChange(result)
        },
        cancelInstall: async requestId => (await manager.cancelInstall(requestId as PluginInstallRequestId)).status,
        removeBundle: async name => managedChange(await manager.removeBundle(name)),
      })
      managerCtx.effect(() => () => { runtime.plugins.bindManager(undefined) }, 'soloengine-host.pluginManager')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.bindPluginManager')

  // 框架运行时随插件卸载关闭（无 HTTP 服务的形态也持有同一个运行时）。
  ctx.effect(() => () => { void runtime.close() }, 'soloengine-host.close')

  ctx.effect(() => {
    // webServer 只接受 node 请求处理器；Express 应用本身即是 (req, res) => void。
    // 前缀路由把 /api/solo 及其子路径原样交给 Express（Express 内按完整路径匹配）。
    //
    // 信任域（PRD-10 FR-SEC-011 第二款）：框架层 REST 比 harness 的 `/api` 前缀更长，按
    // 「最长前缀胜出」的匹配规则会屏蔽掉原生 `/api` 围栏——故这里显式复用同一条围栏判定的
    // **信任域**结论：Host/Origin 不在回环或部署者声明的可信域内即 403 拒绝（DNS 重绑定
    // 与域外访问一律拒绝）。401（回环但无浏览器会话 cookie）不在此拦截——框架层 REST 的
    // 入口是账号域自己的 Bearer 令牌（PRD-03「统一鉴权」），harness 的令牌门仍只守 RPC 与事件流。
    const fiber = ctx.inject(['webServer'], (mountCtx) => {
      mountCtx.effect(() => {
        const dispose = mountCtx.webServer.register({
          kind: 'prefix',
          path: prefix,
          handler: (req: IncomingMessage, res: ServerResponse) => {
            // 经 `ctx.get` 读取（本插件未声明 connection 注入，直读会抛错）；逐请求解析，
            // 组合层尚未装载连接插件时退回「不设围栏」——与原生 `/api` 的实际可用性一致。
            const connection = ctx.get('connection') as { requestRejection?: (request: unknown) => number | undefined } | undefined
            if (connection?.requestRejection?.(req) === 403) {
              res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
              res.end(`${JSON.stringify({
                ok: false,
                error: {
                  code: 'TRUST_DOMAIN_REJECTED',
                  message: 'the request Host is neither loopback nor a host declared in the deployment trust domain (PRD-10 FR-SEC-011)',
                },
              })}\n`)
              return
            }
            runtime.app(req, res)
          },
        })
        // HTTP 就绪行在服务真正就绪后打印（本插件先于 webServer 激活，不能在 apply 时读地址）。
        if (config.printReady !== false) {
          console.log(`soloengine: framework ready at http://${mountCtx.webServer.host}:${String(mountCtx.webServer.port)}${prefix}`)
        }
        return () => { dispose() }
      }, 'soloengine-host.restRoute')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.mountFramework')

  // 运行驱动 + 归属直写 + 创造模式审计：等 harness 侧服务就绪后再接线
  // （未就绪时框架层 REST 仍在，/runs 以结构化错误明确拒绝，不静默降级）。
  /** 画布编辑器实时预览的轻量日志缓冲（FR-CANVAS-017；随本插件生命周期，卸载即弃）。 */
  const previewStream = new PreviewStream()

  ctx.effect(() => {
    const fiber = ctx.inject(
      ['agents', 'sessions', 'agentPresets', 'tools', 'subagents', 'sessionProjections', 'skills', 'sessionPersistence', 'loader',
        'shellEnv', 'subprocess'],
      (driverCtx) => {
        // 远程执行形态必须真的有按会话路由的子进程提供方；否则命令会静默跑在本机（安全边界失效）。
        if ((containers !== undefined || vms !== undefined) && !(driverCtx.subprocess instanceof ContainerSubprocessRuntime)) {
          throw new Error(
            'soloengine: non-local executor requires @soloengine/subprocess-container to be composed'
            + ' in place of @deepseek-ai/dsh-subprocess-local',
          )
        }
        if (containers !== undefined) {
          console.log('soloengine: container executor wired (per-session containers; commands routed through'
            + ' @soloengine/subprocess-container)')
        }
        if (vms !== undefined) {
          console.log('soloengine: full-VM executor wired (per-session QEMU VMs; commands routed through'
            + ' @soloengine/subprocess-container over SSH)')
        }
        const attribution = new Map<string, NodeAttribution>()
        const lastAssistantSeq = new Map<string, number>()
        const ledger = runtime.runs.ledger
        const driver = createRunDriver(driverCtx, runtime, {
          agentPreset,
          maxDepth,
          attribution,
          lastAssistantSeq,
          ...cloud === undefined ? {} : { cloud },
          ...containers === undefined ? {} : { containers },
          ...vms === undefined ? {} : { vms },
          ...workspaceSync === undefined ? {} : { workspace: workspaceSync },
        })
        // 云节点：注册/心跳随驱动接线启动，插件卸载时停止心跳并释放全部租约。
        if (cloud !== undefined) {
          void cloud.start().catch((error: unknown) => {
            console.log(`soloengine: cloud node startup failed: ${String(error)}`)
          })
          driverCtx.effect(() => () => cloud.stop(), 'soloengine-host.cloudNode')
        }
        runtime.runs.setDriver(driver)
        // 启动对账：上一进程遗留的 pending/running 行不会再推进；驱动就位后按活会话
        // 判定收敛为失败，避免画布列表与会话台账永久显示「运行中」。
        void runtime.runs.settleInterrupted().then((settled) => {
          if (settled > 0) console.log(`soloengine: settled ${String(settled)} interrupted session row(s)`)
        }).catch((error: unknown) => {
          console.log(`soloengine: session ledger startup reconcile failed: ${String(error)}`)
        })
        // FR-CANVAS-014：画布编辑器的工具多选来自 harness 侧的工具集合——
        // **实时注册**（全局注册表；fs/命令类工具注册在各 agent 作用域，全局面不重复出现）
        // 与**编译器画布词汇表**（TOOL_MAP 的画布工具名 + run_command，编译契约的同一张表）
        // 的并集，经原生注入点挂进同一条 REST 前缀（机制一份，前端不另立静态清单）。
        // 编译接受同一份实时工具名：编辑器只提供它，选中后就该能编译（词汇表外按原名通过）。
        const toolVocabulary = (): readonly string[] => driverCtx.tools.schemas().map(schema => schema.name)
        runtime.toolVocabulary = toolVocabulary
        driverCtx.effect(() => () => {
          if (runtime.toolVocabulary === toolVocabulary) runtime.toolVocabulary = undefined
        }, 'soloengine-host.toolVocabulary')
        runtime.mountAuthenticated(
          { id: 'tools-list', method: 'get', path: '/tools', summary: 'harness 工具清单（实时注册 ∪ 编译器画布词汇表；FR-CANVAS-014）' },
          () => {
            const live = driverCtx.tools.schemas().map(schema => ({
              name: schema.name,
              description: (schema as { description?: string }).description ?? '',
            }))
            const byName = new Map(live.map(tool => [tool.name, tool]))
            for (const canvasName of [...Object.keys(TOOL_MAP), 'run_command']) {
              if (byName.has(canvasName)) continue
              byName.set(canvasName, { name: canvasName, description: '' })
            }
            return Promise.resolve({ body: { ok: true, tools: [...byName.values()] } })
          },
        )
        // 会话 → 画布节点归属：变更台账的 agent_id 归属与运行诊断都问同一处（单一真源）。
        runtime.runs.setAgentResolver(key => attribution.get(key)?.agentId)
        attachLedgerWriters(driverCtx, { attribution, lastAssistantSeq, ledger })
        attachCreatorAudit(driverCtx, runtime)
        attachFollowLayer(driverCtx)
        // 画布编辑器实时预览（FR-CANVAS-017）：与归属直写同源消费原生事件流，只折叠纯文本
        // 与工具状态；运转在本 fiber 内，卸载即撤销。
        mountPreviewStream(driverCtx, runtime, previewStream)
        // 归属台账重建入口（FR-ARCH-012）：sessions/events 是可重建的本地索引，
        // 官方持久化读路径为唯一事实来源；路由挂在同一 REST 前缀与鉴权之下。
        mountLedgerRebuild(driverCtx, runtime)
        // MCP 启停热生效（PRD-05 FR-MCP-005）：周期把活作用域同步到当前行状态——服务器被停用即
        // 卸载（世代回滚）、被启用即挂载、单工具开关就地更新，全程免重启。周期与模型路由热同步同量级。
        const mcpTimer = setInterval(() => {
          void driver.syncMcpMounts().catch((error: unknown) => {
            console.log(`soloengine: mcp hot sync failed: ${String(error)}`)
          })
        }, MCP_SYNC_INTERVAL_MS)
        driverCtx.effect(() => () => { clearInterval(mcpTimer) })
        // 运行上下文 / 工具呈现意图 / 节点归属三条投影（会话头、操作区与冷恢复的数据源）：
        // 注册即可逆效果，卸载即撤销。
        driverCtx.sessionProjections.register(runContextProjectionDefinition)
        driverCtx.sessionProjections.register(followIntentProjectionDefinition)
        driverCtx.sessionProjections.register(nodeAttributionProjectionDefinition)
        console.log(
          `soloengine: run driver wired (preset=${agentPreset}, maxDelegationDepth=${String(maxDepth)},`
          + ' projection=soloengine.runContext+soloengine.followIntent+soloengine.nodeAttribution)',
        )
      },
    )
    return () => { void fiber.dispose() }
  }, 'soloengine-host.runDriver()')

  // 产品设置桥接：把原生设置域（`ui-theme` / `locale`）以同一 REST 前缀与鉴权暴露给
  // 第三方与部署方读取；产品页面自身的偏好存浏览器 localStorage，不经此路由。
  ctx.effect(() => {
    const fiber = ctx.inject(['settings'], (settingsCtx) => {
      mountProductSettings(settingsCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.productSettings')

  // 文件变更记录与撤回（PRD-09）：写前后抓拍消费 dsh 原生 fs 意图/观测事件（不另埋钩子），
  // 台账落 `file_changes`/`file_content_blobs`；撤回经原生写入路径（守卫 + 补发观测）执行。
  ctx.effect(() => {
    const fiber = ctx.inject(['fs'], (changesCtx) => {
      mountFileChanges(changesCtx, runtime, {
        // 撤回写回的 fs 事件按会话所属 flow 派发：活 agent 的作用域父键即 flow 键
        // （`composeNode` 的 `flow.bind(agentCtx)`）；无活 agent 时按无归属处理。
        scopeKeyOfSession: (sessionKey) => {
          const agents = ctx.get('agents') as { get: (id: SessionId) => { ctx: Context } | undefined } | undefined
          const agent = agents?.get(SessionId(sessionKey))
          if (agent === undefined) return undefined
          const key = scopeOf(agent.ctx)
          return key === undefined ? undefined : scopeParentOf(key)
        },
      })
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.fileChanges()')

  // 操作区桥（运行面板侧）：信任门鉴权 + 归属取自运行台账（前端不上报归属），
  // 与产品页面的 `/api/solo/workspace/*`（Bearer 鉴权）共用同一份业务实现与沙箱根判据。
  ctx.effect(() => {
    // 桥接面挂在 HTTP 服务上：除 `connection`（信任门）外还必须等 `webServer`——本插件先于
    // 两者激活（headless 形态干脆没有），只注入 `connection` 会在它先就绪时读到未提供的 webServer。
    const fiber = ctx.inject(['webServer', 'connection'], (bridgeCtx) => {
      mountOperationAreaBridge(bridgeCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.operationAreaBridge()')

  // 运行设置桥（运行面板侧）：实时跟随是「这一次运行怎么跑」的开关，由面板随时调整；
  // 与操作区桥同一套信任门与归属解析，另需活会话与投影服务才能写回 run-context。
  ctx.effect(() => {
    const fiber = ctx.inject(['webServer', 'connection', 'agents', 'sessionProjections'], (bridgeCtx) => {
      mountRunSettingsBridge(bridgeCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.runSettingsBridge()')

  // 产品页面、运行面板深链与根入口：frontend-static 只服务 dist 根，深链一律 404——故以具名
  // 路由承接同一个 dist index（根路径用 exact，前缀用 prefix），并走同一条浏览器鉴权
  // （信任门：进程令牌换签名 cookie）。本机回环的未认证访问另做信任门引导——authority 别名
  // （localhost ↔ 127.0.0.1 各是一张 cookie）与「全新浏览器首访必须持令牌 URL」两个真实缺口
  // 都在那里补齐；连接面（RPC 与事件流）仍由 ctx.connection 的信任门判定，不因引导放宽。
  const launch = ctx.get('profileContext') as { installAnchor?: unknown } | undefined
  const distIndex = resolveProductPageIndex(
    typeof launch?.installAnchor === 'string' ? launch.installAnchor : undefined,
    root,
  )
  // 产品壳的版本注入：登录品牌面板脚注读 `__SOLOENGINE_VERSION__`，与 `/api/solo/health`
  // 的 `version` 同源（`FRAMEWORK_VERSION`），不在前端硬编码版本串。
  const versionInjection: IndexInjection = {
    kind: 'global',
    name: '__SOLOENGINE_VERSION__',
    value: FRAMEWORK_VERSION,
  }
  ctx.effect(() => {
    const fiber = ctx.inject(['webServer', 'connection', 'clientModules'], (routeCtx) => {
      // 本次请求的运行面板注入行：只在 `renderIndex` 的同步窗口内可见，渲染完立即清空，
      // 因此并发请求不会把 A 画布的客户端图串到 B 画布。
      let pendingRunInjections: IndexInjection[] = []
      routeCtx.on('webserver/index-inject', (table) => {
        if (pendingRunInjections.length > 0) table.push(...pendingRunInjections)
      })
      const render = async (injections: readonly IndexInjection[] = []): Promise<string> => {
        const html = await readFile(distIndex, 'utf8')
        pendingRunInjections = [...injections]
        let body: string
        try {
          body = routeCtx.webServer.renderIndex(html)
        } finally {
          pendingRunInjections = []
        }
        // 深链下相对资源 URL 会解析到请求目录，故把资源锚点钉在站点根（与 frontend-static 同法）。
        return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
      }
      const page = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        if (!routeCtx.connection.authorizeIndex(req, res, { returnCookie: RETURN_COOKIE })) {
          if (res.statusCode === 303) {
            console.log(
              `soloengine: trust bootstrap issued for http://${req.headers.host ?? 'unknown'} (the process token is exchanged for the signed browser cookie on this authority; the connection fence is unchanged)`,
            )
          }
          return
        }
        // 运行面板按 **agenticflow** 区分 URL（PRD-01 §实例隔离：`/run/:agenticFlowId`）。
        // 会话键是面板内部的数据归属，不进地址栏：这里把 flow id 解析成该 flow 最近一次运行的
        // 会话键随外壳下发，client-bootstrap 读它做原生会话选择。该画布**尚无运行会话**时
        // 仍渲染面板（无会话首屏由面板内的原生入口承担：工作区/目录选择 + 新建会话，
        // 见《框架设计》§四「目录选择由目录选择器填充」），只把 flow id 随外壳下发。
        //
        // 这是产品里唯一的 Harness 面：缺 id（`/run`、`/run/`）或带多余段一律 404，
        // 不渲染面板；不存在第二个 Harness 入口（例如 `/plugin-manager`）。
        const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname
        const isRunPath = pathname === `/${RUN_ROUTE_ROOT.segment}` || pathname.startsWith(RUN_PANEL_PREFIX)
        const runSegments = isRunPath ? pathname.split('/').filter(segment => segment !== '') : []
        let flowSegment = ''
        if (isRunPath) {
          if (runSegments.length !== 2) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(`the run panel requires /${RUN_ROUTE_ROOT.segment}/<agenticFlowId>`)
            return
          }
          try {
            flowSegment = decodeURIComponent(runSegments[1] as string)
          } catch {
            // 非法百分号编码不是 flow id：按未命中处理，不把 URIError 抛成 500。
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('the run panel path is not a valid URL segment')
            return
          }
          if (flowSegment === '') {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(`the run panel requires /${RUN_ROUTE_ROOT.segment}/<agenticFlowId>`)
            return
          }
        }
        let runInjections: IndexInjection[] = []
        if (flowSegment !== '') {
          // 该 flow 的最近会话只在**调用方连接可见**的会话里挑：面板外壳从不把其他账号的
          // 会话键写进页面（账号作用域未装载时保持原生行为）。
          const admission = routeCtx.connection.admit(req)
          const owned = 'peer' in admission
            ? await routeCtx.connection.ownedSessionIdsOf(admission.peer)
            : []
          // 实例组合的读取同样按调用方账号收窄：已绑定账号只能解析自己可见的画布（他人画布按
          // 不存在处理，与列表口径一致）。两档例外各自保持原语义：
          // - 原生/未装载账号作用域（`owned` 为 undefined）：原生行为，按 flow id 读取；
          // - 浏览器 cookie 存在但尚未登录（`owned` 是空数组、账号为 undefined）：不拥有任何
          //   画布，实例组合一律为空，绝不退化成按 flow id 读他人画布。
          const accountId = 'peer' in admission ? routeCtx.connection.accountIdOf(admission.peer) : undefined
          const unboundBrowser = 'peer' in admission && accountId === undefined && owned !== undefined
          const latest = await runtime.runs.latestSessionKeyOfFlow(
            flowSegment,
            owned === undefined ? undefined : new Set(owned),
          )
          // 一次运行 = 一棵会话树：台账也会登记子代理子会话，深链必须落在树根上，
          // 否则打开的是「父会话当前不在线」的只读子会话（子会话经派卡进入，见 PRD-06）。
          const sessionKey = latest === undefined ? undefined : await rootSessionKeyOf(routeCtx, latest)
          // 实例客户端组合（Plan W4）：该画布启用的客户端包 = 全局启动图 + 画布新增/替换的包。
          // 组合错误（未知行、包不可解析、依赖被关闭）一律整页报错（加载期报错，不静默降级）。
          let selection: { enabled: string[]; disabled: string[] }
          try {
            selection = unboundBrowser
              ? { enabled: [], disabled: [] }
              : await runtime.plugins.clientSelection(flowSegment, accountId)
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
            res.end(clientTreeErrorPage(flowSegment, [error instanceof Error ? error.message : String(error)]))
            return
          }
          const base = routeCtx.clientModules.graph()
          const extras = selection.enabled.filter(pkg => !base.entries.some(entry => entry.id === pkg))
          let instanceGraph = base
          if (extras.length > 0) {
            try {
              // 解析基准与原生扫描同源：host 与 client-modules 处同一棵 Loader 树，`ctx.baseUrl`
              // 即 profile/应用根（原生行取 `entry.parent.tree.ctx.baseUrl` 的同一值）。
              const baseUrl = routeCtx.baseUrl
              if (baseUrl === undefined) {
                throw new Error('the host context carries no base URL, so instance client packages cannot be resolved')
              }
              const extended = routeCtx.clientModules.extendGraph(extras, baseUrl)
              if (extended.missing.length > 0) {
                res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
                res.end(clientTreeErrorPage(
                  flowSegment,
                  extended.missing.map(pkg => `${pkg} is enabled by this canvas but resolves to no built client package`),
                ))
                return
              }
              instanceGraph = extended.graph
            } catch (error) {
              res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
              res.end(clientTreeErrorPage(flowSegment, [error instanceof Error ? error.message : String(error)]))
              return
            }
          }
          const problems = clientTreeProblems(instanceGraph, selection.disabled)
          if (problems.length > 0) {
            res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
            res.end(clientTreeErrorPage(flowSegment, problems))
            return
          }
          runInjections = runBootstrapRows({
            flowId: flowSegment,
            ...(sessionKey === undefined ? {} : { sessionKey }),
            disabled: selection.disabled,
            ...(instanceGraph === base ? {} : { instanceGraph }),
          })
        }
        // 入口文档引用的是带内容哈希的 bundle：缓存这份 HTML 会让重建后的页面继续加载旧
        // bundle（实测：界面停在修复前的构建）。静态资源名字随内容变化，保持默认缓存。
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(await render([versionInjection, ...runInjections]))
      }
      routeCtx.effect(() => {
        const disposers = [
          ...PRODUCT_SURFACE_PATHS.map(path => routeCtx.webServer.register({ kind: 'prefix', path, handler: page })),
          routeCtx.webServer.register({ kind: 'exact', path: '/', handler: page }),
        ]
        console.log(`soloengine: product surfaces mounted (/, ${PRODUCT_SURFACE_PATHS.join(', ')})；运行面板按 /run/:agenticFlowId 区分 URL`)
        return () => { for (const dispose of disposers) dispose() }
      }, 'soloengine-host.productRoutes')
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.productSurfaces')

  ctx.logger.info(
    `soloengine framework mounted at ${prefix} (db=${environment.path}, tables=${String(BUSINESS_TABLES.length)}, masterKey=${runtime.masterKey.created ? 'generated' : 'loaded'}, systemSeed=${seeded.created ? 'created' : 'present'})`,
  )

  if (config.printReady !== false) {
    // 与 HTTP 无关的就绪事实：业务库与模型路由已可用。HTTP 地址行由挂载效果在服务就绪后打印
    // （headless 形态没有 webServer，这条即该形态的全部就绪输出）。
    console.log(`soloengine: framework ready (db=${environment.path}, model routes available)`)
  }
}
