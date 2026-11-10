#!/usr/bin/env node
/**
 * 云控制面 / 网关进程入口（独立进程，不进 cordis 树）。
 *
 * 环境变量：
 *   SOLOENGINE_CLOUD_ROLE          `control`（默认）、`gateway`、`nodes`、`drain` 或 `upgrade-plan`
 *   SOLOENGINE_CLOUD_DATABASE_URL  PostgreSQL 连接串（多节点共享归属库）；设置即按需加载
 *                                  可选后端包 `@soloengine/cloud-control-postgres`，
 *                                  未设置则落到 `SOLOENGINE_CLOUD_DB` 指定的 SQLite 文件
 *   SOLOENGINE_CLOUD_DB            SQLite 路径（单机形态），默认 `data/cloud/control.db`
 *   SOLOENGINE_CLOUD_PORT          控制面监听端口（默认 8993）
 *   SOLOENGINE_CLOUD_HOST          监听地址（默认 127.0.0.1）
 *   SOLOENGINE_QUOTA_MAX_ACTIVE    每用户并发会话硬上限（控制面放置闸门，W10.10）；
 *                                  省略时放置不做用户维度过滤
 *   SOLOENGINE_CONTROL_URL         网关/运维命令访问控制面的地址（默认 `http://127.0.0.1:8993`）
 *   SOLOENGINE_GATEWAY_PORT        网关监听端口（默认 8994）
 *   SOLOENGINE_GATEWAY_SECRET      网关共享签名密钥（设置即要求 `x-soloengine-timestamp` +
 *                                  `x-soloengine-signature`；未设置只放行回环对端）
 *   SOLOENGINE_STATIC_OBJECTS_DIR  网关静态对象根目录（`/objects/<key>`，不可变首帧资源）
 *   SOLOENGINE_KEYS_DIR            主密钥目录（网关与节点共用同一份；设置即启用会话归属校验）
 *   SOLOENGINE_DATABASE_URL        共享业务库连接串（归属真源 `sessions.user_id`；与
 *                                  `SOLOENGINE_KEYS_DIR` 必须同时设置或同时留空）
 *   SOLOENGINE_DRAIN_NODE          `drain` 的目标节点 id，或 `all`（全部 active 节点）
 *   SOLOENGINE_DRAIN_TARGET        单个节点排空时的迁移目标；省略则由控制面按放置策略选
 *                                  （`all` 只标记排空态：整池同时迁移没有池外目标）
 *
 * @module @soloengine/cloud-control/cli
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import type { Server } from 'node:http'
import { RemoteControl } from './client.ts'
import type { NodeView } from './contracts.ts'
import { planRollingUpgrade } from './elasticity.ts'
import { CloudGateway, createGatewayServer, sharedKeyAuthorizer, type StaticObjectSource } from './gateway.ts'
import { openGatewaySessionOwnership } from './gateway-ownership.ts'
import { createControlServer } from './http.ts'
import type { ControlRepository } from './repository.ts'
import { ControlPlane } from './service.ts'
import { ControlStore } from './store.ts'

/** 默认监听地址。 */
const DEFAULT_HOST = '127.0.0.1'

const role = process.env.SOLOENGINE_CLOUD_ROLE ?? 'control'
const host = process.env.SOLOENGINE_CLOUD_HOST ?? DEFAULT_HOST

if (role === 'gateway') {
  const port = Number(process.env.SOLOENGINE_GATEWAY_PORT ?? 8994)
  const control = new RemoteControl(process.env.SOLOENGINE_CONTROL_URL ?? 'http://127.0.0.1:8993')
  const secret = (process.env.SOLOENGINE_GATEWAY_SECRET ?? '').trim()
  const objectsDir = (process.env.SOLOENGINE_STATIC_OBJECTS_DIR ?? '').trim()
  // 会话归属校验需要两个部署事实（共享主密钥 + 共享业务库）；只给其一是半开状态，
  // 会让网关在没有归属判定的情况下继续转发，因此按配置错误阻断启动。
  const keysDir = (process.env.SOLOENGINE_KEYS_DIR ?? '').trim()
  const databaseUrl = (process.env.SOLOENGINE_DATABASE_URL ?? '').trim()
  if ((keysDir === '') !== (databaseUrl === '')) {
    throw new Error(
      'SOLOENGINE_KEYS_DIR and SOLOENGINE_DATABASE_URL must be set together: the gateway can only '
      + 'verify session owners when it shares the deployment master key and the shared business database',
    )
  }
  const ownership = keysDir === ''
    ? undefined
    : await openGatewaySessionOwnership({ keysDir, databaseUrl })
  const gateway = new CloudGateway({
    control,
    ...(secret === '' ? {} : { authorize: sharedKeyAuthorizer({ secret }) }),
    ...(ownership === undefined ? {} : { sessionOwnership: ownership.ownership }),
  })
  const server = createGatewayServer(gateway, objectsDir === '' ? {} : { objects: directoryObjects(objectsDir) })
  server.listen(port, host, () => {
    process.stdout.write(
      `soloengine-cloud-gateway: http://${host}:${String(port)}`
      + ` (auth=${secret === '' ? 'loopback' : 'shared-key'}`
      + `, users=${ownership === undefined ? 'unchecked' : 'verified'}`
      + `, objects=${objectsDir === '' ? 'off' : objectsDir})\n`,
    )
  })
  shutdownOnSignals(server, () => ownership?.close())
} else if (role === 'nodes' || role === 'drain' || role === 'upgrade-plan') {
  await runOps(role)
} else if (role !== 'control') {
  throw new Error(`SOLOENGINE_CLOUD_ROLE must be control|gateway|nodes|drain|upgrade-plan, got "${role}"`)
} else {
  const port = Number(process.env.SOLOENGINE_CLOUD_PORT ?? 8993)
  const databaseUrl = process.env.SOLOENGINE_CLOUD_DATABASE_URL
  // PostgreSQL 只在显式配置共享库时加载（动态 import）：单机形态与产品进程都不引入 `pg`。
  const opened = databaseUrl === undefined || databaseUrl === ''
    ? openSqlite()
    : await loadPostgres(databaseUrl)
  // 跨节点配额闸门（W10.10）：配置了硬上限才启用；节点本地准入仍是最终裁决。
  const quotaMax = positiveIntEnv('SOLOENGINE_QUOTA_MAX_ACTIVE')
  const control = new ControlPlane(opened.store, quotaMax === undefined
    ? {}
    : { quota: { maxActiveSessions: quotaMax } })
  const server = createControlServer(control)
  server.listen(port, host, () => {
    process.stdout.write(`soloengine-cloud-control: http://${host}:${String(port)} (${opened.label})\n`)
  })
  /** 控制面退出：先停监听再关库。 */
  shutdownOnSignals(server, () => { opened.store.close() })
}

/**
 * 运维命令：读节点池、排空节点、生成滚动升级批次（全部经控制面 HTTP，不直连共享库）。
 * @param role - `nodes` | `drain` | `upgrade-plan`。
 */
async function runOps(role: 'nodes' | 'drain' | 'upgrade-plan'): Promise<void> {
  const base = (process.env.SOLOENGINE_CONTROL_URL ?? 'http://127.0.0.1:8993').replace(/\/$/u, '')
  const nodes = await fetchNodes(base)
  if (role === 'nodes') {
    process.stdout.write(`${JSON.stringify(nodes, null, 2)}\n`)
    return
  }
  if (role === 'upgrade-plan') {
    process.stdout.write(`${JSON.stringify(planRollingUpgrade(nodes), null, 2)}\n`)
    return
  }
  const target = (process.env.SOLOENGINE_DRAIN_NODE ?? '').trim()
  if (target === '') {
    throw new Error('SOLOENGINE_CLOUD_ROLE=drain requires SOLOENGINE_DRAIN_NODE=<node id|all>')
  }
  if (target !== 'all') {
    const drainTarget = (process.env.SOLOENGINE_DRAIN_TARGET ?? '').trim()
    const response = await fetch(`${base}/v1/nodes/drain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: target, ...drainTarget === '' ? {} : { targetNodeId: drainTarget } }),
    })
    const body = await response.json() as {
      ok?: boolean
      code?: string
      message?: string
      targetNodeId?: string
      moved?: string[]
      skipped?: string[]
      remaining?: number
      state?: string
    }
    if (response.status >= 300 || body.ok !== true) {
      throw new Error(`draining node ${target} failed: ${String(response.status)} ${body.code ?? ''} ${body.message ?? ''}`.trim())
    }
    process.stdout.write(
      `drained ${target} -> ${body.targetNodeId ?? '?'} (moved ${String(body.moved?.length ?? 0)}, `
      + `skipped ${String(body.skipped?.length ?? 0)}, remaining ${String(body.remaining ?? 0)}, state ${body.state ?? '?'})\n`,
    )
    return
  }
  // 整池排空只标记状态：池内互迁会互相抢占，运维应先扩容池外节点再逐台 drain。
  const targets = nodes.filter(node => node.state === 'active').map(node => node.nodeId)
  for (const nodeId of targets) {
    const response = await fetch(`${base}/v1/nodes/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, state: 'draining' }),
    })
    const body = await response.json() as { ok?: boolean }
    if (response.status >= 300 || body.ok !== true) {
      throw new Error(`draining node ${nodeId} failed: ${String(response.status)}`)
    }
  }
  process.stdout.write(`drained ${targets.length === 0 ? '(none)' : targets.join(', ')}\n`)
}

/**
 * 读控制面节点池（线协议边界：校验信封后再使用）。
 * @param base - 控制面地址。
 * @returns 节点视图。
 */
async function fetchNodes(base: string): Promise<NodeView[]> {
  const response = await fetch(`${base}/v1/nodes`)
  if (response.status !== 200) throw new Error(`listing nodes failed: ${String(response.status)}`)
  const body = await response.json() as { ok?: boolean; nodes?: NodeView[] }
  if (body.ok !== true || !Array.isArray(body.nodes)) throw new Error('control plane did not return a node list')
  return body.nodes
}

/**
 * 读可选的正整数环境变量；非法值阻断启动（不猜默认）。
 * @param name - 环境变量名。
 * @returns 未设置时为 undefined，否则为 ≥1 的安全整数。
 */
function positiveIntEnv(name: string): number | undefined {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`soloengine: ${name} must be a positive integer, got "${raw}"`)
  }
  return value
}

/** 打开 SQLite 仓储（单机形态）。 */
function openSqlite(): { store: ControlRepository & { close(): void }; label: string } {
  const dbPath = resolve(process.env.SOLOENGINE_CLOUD_DB ?? 'data/cloud/control.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  return { store: new ControlStore(dbPath), label: `sqlite ${dbPath}` }
}

/**
 * 可选 PostgreSQL 后端包的最小契约：在模块边界校验，避免控制面核心在编译期依赖它。
 */
interface PostgresBackend {
  PgControlStore: { open(url: string): Promise<ControlRepository & { close(): Promise<void> }> }
}

/**
 * 判定动态加载的模块是否提供 `PgControlStore.open`。
 * @param value - 动态 import 的结果。
 * @returns 是否满足可选后端契约。
 */
function isPostgresBackend(value: unknown): value is PostgresBackend {
  if (typeof value !== 'object' || value === null) return false
  const store: unknown = Reflect.get(value, 'PgControlStore')
  if (typeof store !== 'function') return false
  return typeof Reflect.get(store, 'open') === 'function'
}

/**
 * 按需加载可选 PostgreSQL 后端包（多节点共享归属库）。
 *
 * 控制面核心不依赖 `pg`；未安装该可选包时给出安装指引而不是笼统的模块解析错误。
 *
 * @param url - 共享归属库连接串。
 * @returns 已打开的仓储与后端标签。
 */
async function loadPostgres(
  url: string,
): Promise<{ store: ControlRepository & { close(): Promise<void> }; label: string }> {
  const specifier = '@soloengine/cloud-control-postgres'
  let loaded: unknown
  try {
    loaded = await import(specifier)
  } catch (error) {
    throw new Error(
      'SOLOENGINE_CLOUD_DATABASE_URL is set but @soloengine/cloud-control-postgres is not installed; '
      + 'install that optional package (it owns the `pg` dependency) to use the shared control store',
      { cause: error },
    )
  }
  if (!isPostgresBackend(loaded)) {
    throw new Error(`${specifier} does not export PgControlStore.open`)
  }
  return { store: await loaded.PgControlStore.open(url), label: 'postgres' }
}

/**
 * 目录形态的静态对象面（内容不可变；越界键在网关层已拒绝，这里再按解析后的路径收口一次）。
 * @param root - 对象根目录。
 * @returns 读取面。
 */
function directoryObjects(root: string): StaticObjectSource {
  const base = resolve(root)
  const types: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
  }
  return {
    read(key) {
      const target = resolve(base, key)
      if (target !== base && !target.startsWith(`${base}${sep}`)) return Promise.resolve(undefined)
      try {
        if (!statSync(target).isFile()) return Promise.resolve(undefined)
        return Promise.resolve({
          body: readFileSync(target),
          contentType: types[extname(target).toLowerCase()] ?? 'application/octet-stream',
        })
      } catch {
        return Promise.resolve(undefined)
      }
    },
  }
}

/**
 * 挂 SIGINT/SIGTERM 优雅退出。
 * @param server - 监听中的服务。
 * @param after - 关闭监听后的清理；返回 Promise 时以其结算结果决定退出码。
 */
function shutdownOnSignals(server: Server, after?: () => void | Promise<void>): void {
  const shutdown = (): void => {
    server.close(() => {
      // 清理失败必须可见：报告后以非零码退出，避免把未关闭的库当成正常退出。
      void Promise.resolve(after?.()).then(
        () => { process.exitCode = 0 },
        (error: unknown) => {
          process.stderr.write(`soloengine-cloud-control: shutdown cleanup failed: ${String(error)}\n`)
          process.exitCode = 1
        },
      )
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
