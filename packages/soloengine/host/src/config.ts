/**
 * 插件配置与部署路径解析（R210：从 `index.ts` 拆出）。
 *
 * 配置是**部署级事实**：实例根、业务库形态、执行后端、云节点参数都在这里定值；
 * 运行驱动、归属直写、产品面只读这些值，不各自回读环境变量。
 *
 * @module @soloengine/host/config
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RunMode } from '@soloengine/types'

/** Plugin configuration. */
export interface Config {
  /** 实例根目录（data/ 的父级）；默认取 `SOLOENGINE_ROOT` 或进程工作目录。 */
  root?: string
  /** 业务库文件路径；默认 `<root>/data/database/soloengine.db`（云形态不使用）。 */
  databasePath?: string
  /** 数据库形态；省略时读 `SOLOENGINE_DB_FORM`（缺省 single）。 */
  databaseForm?: 'single' | 'cloud'
  /** PostgreSQL 连接串；云形态省略时读 `SOLOENGINE_DATABASE_URL`。 */
  databaseUrl?: string
  /** 主密钥目录；省略时读 `SOLOENGINE_KEYS_DIR`，再缺省为 `<root>/data/home/keys`。多节点必须指向同一份密钥。 */
  keysDir?: string
  /** REST 挂载前缀；默认 `/api/solo`。 */
  prefix?: string
  /** 是否打印就绪行。 */
  printReady?: boolean
  /** 云控制面地址；省略时读 `SOLOENGINE_CONTROL_URL`。与 `nodeId` 成对出现。 */
  controlUrl?: string
  /** 本节点标识；省略时读 `SOLOENGINE_NODE_ID`。 */
  nodeId?: string
  /** 执行后端形态；省略时读 `SOLOENGINE_EXECUTOR`（缺省 `local`）。`microvm` 用 OCI 运行时提供独立内核隔离；`full-vm` 用每会话 QEMU 全 VM。 */
  executor?: 'local' | 'container' | 'microvm' | 'full-vm'
  /** 会话容器镜像；`container`/`microvm` 形态省略时读 `SOLOENGINE_CONTAINER_IMAGE`。 */
  containerImage?: string
  /** Docker 可执行文件；省略时读 `SOLOENGINE_DOCKER`（缺省 `docker`）。 */
  containerDocker?: string
  /** OCI 运行时；`microvm` 省略时读 `SOLOENGINE_CONTAINER_RUNTIME`（缺省 `kata-runtime`）。 */
  containerRuntime?: string
  /** 全 VM 基础镜像（qcow2）；`full-vm` 形态省略时读 `SOLOENGINE_VM_IMAGE`。 */
  vmImage?: string
  /** 全 VM 每会话状态目录；`full-vm` 形态省略时读 `SOLOENGINE_VM_STATE_DIR`。 */
  vmStateDir?: string
  /** 全 VM 平台私钥路径；`full-vm` 形态省略时读 `SOLOENGINE_VM_SSH_KEY`。 */
  vmSshKey?: string
  /** 全 VM 登录用户；省略时读 `SOLOENGINE_VM_SSH_USER`（缺省 `root`）。 */
  vmSshUser?: string
  /** 全 VM 加速器；省略时读 `SOLOENGINE_VM_ACCEL`，再缺省按宿主 `/dev/kvm` 选择。 */
  vmAccel?: 'kvm' | 'tcg'
  /** 全 VM 内存上限（MiB）；省略时读 `SOLOENGINE_VM_MEMORY_MB`（缺省 2048）。 */
  vmMemoryMb?: number
  /** 全 VM vCPU 数；省略时读 `SOLOENGINE_VM_CPUS`（缺省 2）。 */
  vmCpus?: number
  /** 编译产物挂载所用的基线 agent 预设 id；默认 `standard`。 */
  agentPreset?: string
  /** 委派深度上限（PRD-06 FR-ENG-024）；默认 3。 */
  maxDelegationDepth?: number
}

/** 挂载前缀（dsh webServer 的 prefix 路由不匹配带尾斜杠的根路径）。 */
export const DEFAULT_PREFIX = '/api/solo'
/** 基线预设：编译产物在此之上经 restrict 收紧为该节点的可见集合。 */
export const DEFAULT_AGENT_PRESET = 'standard'
/** 委派深度上限。 */
export const DEFAULT_MAX_DEPTH = 3
/** 节点 persona 在系统提示词中的段序（紧随部署 persona 前缀）。 */
export const PERSONA_SECTION_ORDER = 1
/** 画布全局运行档位的合法值域：**原生权限预设名**（与 `CanvasSettings.run_mode` 同值域）。 */
export const RUN_MODES: readonly RunMode[] = ['workspace-write', 'approve-for-me', 'danger-full-access']
/** R186 之前的画布档位名 → 当前原生预设名（持久化画布数据的等价迁移）。 */
export const LEGACY_RUN_MODES: Readonly<Record<string, RunMode>> = {
  ask: 'workspace-write',
  allowlist: 'approve-for-me',
  auto: 'danger-full-access',
}
/** 画布全局运行档位缺省：原生「工作区内修改」预设（写操作前按原生审批询问）。 */
export const DEFAULT_RUN_MODE: RunMode = 'workspace-write'
/** 画布全局「实时跟随」缺省（画布 schema 默认值）。 */
export const DEFAULT_LIVE_FOLLOW = true

/**
 * 产品设置桥接的命名空间白名单。
 *
 * 主题与本地化的偏好本身存浏览器 localStorage（用户/浏览器隔离）；本桥接仍保留为
 * 产品 REST 面的一部分：第三方与部署方读取原生设置域（`ui-theme` / `locale`）的当前值。
 */
export type ProductSettingsNamespace = 'ui-theme' | 'locale'

/** 允许桥接的命名空间（其余一律结构化拒绝）。 */
export const PRODUCT_SETTINGS_NAMESPACES: readonly ProductSettingsNamespace[] = ['ui-theme', 'locale']

/**
 * 判断一个路径参数是否是允许桥接的产品设置命名空间。
 * @param value - 路径参数。
 * @returns 是否在白名单内。
 */
export function isProductSettingsNamespace(value: string): value is ProductSettingsNamespace {
  return (PRODUCT_SETTINGS_NAMESPACES as readonly string[]).includes(value)
}

/** MCP 启停热同步周期（PRD-05 FR-MCP-005）：与模型路由热同步同量级（1 秒），一次 SELECT 且无连接开销。 */
export const MCP_SYNC_INTERVAL_MS = 1000

/**
 * 解析实例根目录：显式配置 > `SOLOENGINE_ROOT` > 进程工作目录。
 * @param config - 插件配置。
 * @returns 绝对根目录。
 */
export function resolveRoot(config: Config): string {
  if (config.root !== undefined && config.root !== '') return config.root
  const fromEnv = process.env.SOLOENGINE_ROOT
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return process.cwd()
}

/**
 * 解析主密钥目录：显式配置 > `SOLOENGINE_KEYS_DIR` > 缺省（框架按 `<root>/data/home/keys`）。
 *
 * 多节点部署必须让所有节点指向同一份密钥：令牌与加密密钥都由它派生，节点各生成一份会导致
 * 会话改投另一节点后鉴权失败。
 * @param config - 插件配置。
 * @returns 绝对目录；两者都未给出时为 undefined。
 */
export function resolveKeysDir(config: Config): string | undefined {
  if (config.keysDir !== undefined && config.keysDir.trim() !== '') return config.keysDir.trim()
  const fromEnv = process.env.SOLOENGINE_KEYS_DIR
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  return undefined
}

/**
 * 解析产品页面外壳（`dist/index.html`）。
 *
 * 页面就是 harness 的同一个前端：仓库检出里在 `apps/web/dist`，发布产物里随运行时提供
 * （`@deepseek-ai/dsh-web-frontend`，与 `dsh-web-app` 自身的解析规则一致——锚在包清单上，
 * 不把部署路径写死）。产物因此**自包含**：目标机没有仓库目录也能渲染产品页面，
 * 不需要另装 `@soloengine/*`。
 * @param installAnchor - 启动器给出的运行时安装锚（`<runtime>/node_modules/@deepseek-ai/dsh/package.json`）；非 profile 启动时缺省。
 * @param root - 实例根目录（仓库检出）。
 * @returns 存在的 index.html 绝对路径。
 */
export function resolveProductPageIndex(installAnchor: string | undefined, root: string): string {
  const candidates: string[] = []
  if (installAnchor !== undefined && installAnchor !== '') {
    candidates.push(join(dirname(installAnchor), '..', '..', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'))
  }
  candidates.push(join(root, 'apps', 'web', 'dist', 'index.html'))
  const found = candidates.find(candidate => existsSync(candidate))
  if (found === undefined) {
    throw new Error(
      `soloengine-host: product page dist is missing; looked for ${candidates.join(' and ')} — `
      + 'build the web application first (pnpm run build:web) or ship a runtime that carries @deepseek-ai/dsh-web-frontend',
    )
  }
  return found
}
