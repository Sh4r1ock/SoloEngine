/**
 * 按会话路由的远程子进程提供方（W10.7 的执行面；B/C 档容器与 D 档全 VM 共用）。
 *
 * 继承本机提供方（{@link LocalSubprocessRuntime}）：普通命令仍走本机进程；当一次 shell 调用
 * 携带会话执行世界事实时，把命令改写进该世界：
 *
 * - 容器（B/C 档）：`DSH_CONTAINER` + `DSH_CONTAINER_WORKSPACE` → `docker exec`；
 * - 全 VM（D 档）：`DSH_VM_SSH_*` + `DSH_VM_WORKSPACE` → `ssh`，命令在 guest 内执行。
 *
 * 两种世界共用同一工作区映射（宿主工作区 → guest 的 `/workspace`）与同一拒绝语义：
 * 工作目录不在会话工作区内时**同步拒绝**（不把宿主路径带进远程命令）；带会话标识却没有
 * 路由事实的调用直接拒绝，绝不落回宿主机。
 *
 * 终端请求只注入 `DSH_SESSION_ID`（不经过 shell 环境贡献者）：容器按会话树根推出容器名；
 * 全 VM 从节点的会话状态文件读端口与工作区（`vmStateDir` 由组合层给出）。
 *
 * @module @soloengine/subprocess-container
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  CONTAINER_ENV_KEY,
  CONTAINER_WORKSPACE,
  CONTAINER_WORKSPACE_ENV_KEY,
  sessionContainerName,
} from '@soloengine/executor-container'
import {
  remoteCommand,
  sessionVmName,
  sshArgv,
  vmRouteFromEnv,
  VM_SSH_KEY_ENV_KEY,
  VM_SSH_PORT_ENV_KEY,
  VM_SSH_USER_ENV_KEY,
  VM_WORKSPACE,
  VM_WORKSPACE_ENV_KEY,
  type VmSshRoute,
} from '@soloengine/executor-vm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Cordis 插件名。 */
export const name = 'soloengine-subprocess-container'

/** 插件配置。 */
export interface Config {
  /** Docker 可执行文件；默认 `docker`。 */
  docker?: string
  /** SSH 可执行文件（全 VM 档）；默认 `ssh`。 */
  ssh?: string
  /**
   * 会话命令必须有执行世界（容器或全 VM）：为 `true` 时，带会话标识却没有路由事实的调用
   * 直接拒绝（远程形态下不允许把会话命令落回宿主机）。默认 `false`（单机/本机形态）。
   */
  requireSessionRoute?: boolean
  /** 全 VM 档的会话状态目录（终端请求据此读端口与工作区）；容器档留空。 */
  vmStateDir?: string
  /** 全 VM 档的私钥路径（终端请求用）。 */
  vmSshKey?: string
  /** 全 VM 档的登录用户；默认 `root`。 */
  vmSshUser?: string
}

/** Loader 校验。 */
export const Config: z<Config> = z.object({
  docker: z.string().default('docker'),
  ssh: z.string().default('ssh'),
  requireSessionRoute: z.boolean().default(false),
  vmStateDir: z.string().default(''),
  vmSshKey: z.string().default(''),
  vmSshUser: z.string().default('root'),
})

/** 一次会话容器路由。 */
interface ContainerRoute {
  /** 容器名或 id。 */
  container: string
  /** 宿主机工作区绝对路径。 */
  workspace: string
}

/** 会话状态文件里终端路由需要的字段。 */
interface VmStateFile {
  sshPort?: unknown
  workspace?: unknown
}

/**
 * 从一次调用的显式环境里读会话容器事实。
 * @param env - 子进程请求的显式环境。
 * @returns 路由；未携带会话容器事实时为 undefined（走本机）。
 */
function containerRouteOf(env: NodeJS.ProcessEnv | undefined): ContainerRoute | undefined {
  const container = env?.[CONTAINER_ENV_KEY]
  const workspace = env?.[CONTAINER_WORKSPACE_ENV_KEY]
  if (typeof container !== 'string' || container === '') return undefined
  if (typeof workspace !== 'string' || workspace === '') return undefined
  return { container, workspace }
}

/**
 * 把宿主机工作目录映射为远程执行世界内的路径。
 * @param workspace - 宿主机工作区绝对路径。
 * @param cwd - 请求的工作目录（宿主机绝对路径）。
 * @param guestRoot - 远程世界里的工作区挂载点。
 * @returns 远程世界内的绝对路径。
 */
function guestCwdOf(workspace: string, cwd: string, guestRoot: string): string {
  const root = resolve(workspace)
  const target = resolve(cwd)
  const rel = relative(root, target)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(
      `soloengine-subprocess-container: working directory "${cwd}" is outside the session workspace "${workspace}"`,
    )
  }
  if (rel === '') return guestRoot
  return [guestRoot, ...rel.split(sep)].join('/')
}

/**
 * 宿主机侧的 VM 路由事实：只用于选择执行世界，不属于 guest 环境。
 *
 * 把它们原样拼进远端命令会把平台端口/私钥路径/宿主工作区暴露给 guest，
 * 且让每条命令多出四个与任务无关的变量。
 */
const VM_ROUTE_ENV_KEYS: ReadonlySet<string> = new Set([
  VM_SSH_PORT_ENV_KEY,
  VM_SSH_KEY_ENV_KEY,
  VM_SSH_USER_ENV_KEY,
  VM_WORKSPACE_ENV_KEY,
])

/**
 * 去掉 VM 路由事实后的 guest 环境。
 * @param env - 请求携带的显式环境。
 * @returns 不含路由键的环境。
 */
function guestEnvOf(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !VM_ROUTE_ENV_KEYS.has(key)))
}

/**
 * 把同步失败归一为拒绝（终端接缝返回 Promise，调用方不应看到同步抛出）。
 * @param error - 捕获到的失败。
 * @returns 拒绝的 Promise。
 */
function rejection(error: unknown): Promise<never> {
  return Promise.reject(error instanceof Error ? error : new Error(String(error)))
}

/**
 * 按会话执行世界路由命令的提供方。
 *
 * 只改写“在哪个执行世界里跑”，不改进程预算与输出语义：这些仍由父类按 spec 执行。
 */
export default class ContainerSubprocessRuntime extends LocalSubprocessRuntime {
  private readonly docker: string
  private readonly ssh: string
  private readonly requireSessionRoute: boolean
  private readonly vmStateDir: string
  private readonly vmSshKey: string
  private readonly vmSshUser: string

  /**
   * @param ctx - 插件上下文。
   * @param config - Docker/SSH 命令、会话路由要求与全 VM 状态目录。
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.docker = config.docker ?? 'docker'
    this.ssh = config.ssh ?? 'ssh'
    this.requireSessionRoute = config.requireSessionRoute ?? false
    this.vmStateDir = config.vmStateDir ?? ''
    this.vmSshKey = config.vmSshKey ?? ''
    this.vmSshUser = config.vmSshUser ?? 'root'
  }

  /**
   * 启动一个子进程；会话执行世界存在时改写为该世界内的一条命令。
   * @param spec - 完全指定的子进程请求。
   * @returns 子进程句柄。
   */
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const env = spec.env ?? {}
    const vmRoute = vmRouteFromEnv(env)
    if (vmRoute !== undefined) return super.spawn(this.rewriteVm(spec, env, vmRoute))
    const containerRoute = containerRouteOf(env)
    if (containerRoute === undefined) {
      this.assertSessionRoute(env)
      return super.spawn(spec)
    }
    return super.spawn(this.rewrite(spec, env, containerRoute))
  }

  /**
   * 启动一个终端进程；会话执行世界存在时改写为该世界内的交互终端。
   * @param spec - 完全指定的终端请求。
   * @returns 终端句柄。
   */
  override spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    const env = spec.env ?? {}
    const vmRoute = vmRouteFromEnv(env) ?? this.vmTerminalRouteBySession(env)
    if (vmRoute !== undefined) {
      try {
        return super.spawnTerminal(this.rewriteVmTerminal(spec, env, vmRoute))
      } catch (error: unknown) {
        return rejection(error)
      }
    }
    const containerRoute = containerRouteOf(env)
    if (containerRoute === undefined) {
      const bySession = this.containerTerminalBySession(spec, env)
      if (bySession !== undefined) {
        try {
          return super.spawnTerminal(bySession)
        } catch (error: unknown) {
          return rejection(error)
        }
      }
      try {
        this.assertSessionRoute(env)
      } catch (error: unknown) {
        return rejection(error)
      }
      return super.spawnTerminal(spec)
    }
    let rewritten: SubprocessTerminalSpawnSpec
    try {
      rewritten = this.rewriteTerminal(spec, env, containerRoute)
    } catch (error: unknown) {
      return rejection(error)
    }
    return super.spawnTerminal(rewritten)
  }

  /** 远程形态下，带会话标识却没有执行世界的调用不得落回宿主机。 */
  private assertSessionRoute(env: NodeJS.ProcessEnv): void {
    if (!this.requireSessionRoute) return
    const sessionId = env['DSH_SESSION_ID']
    if (typeof sessionId !== 'string' || sessionId === '') return
    throw new Error(
      `soloengine-subprocess-container: session ${sessionId} has no execution world; refusing to execute its command on the host`,
    )
  }

  /**
   * 终端请求缺少容器事实时的兜底：终端后端只注入 `DSH_SESSION_ID`（不经过 shell 环境贡献者），
   * 这里按会话树根推出容器名，工作目录固定为容器工作区根。
   */
  private containerTerminalBySession(
    spec: SubprocessTerminalSpawnSpec,
    env: NodeJS.ProcessEnv,
  ): SubprocessTerminalSpawnSpec | undefined {
    // 全 VM 形态（配置了状态目录）不启用容器兜底：两种执行世界互斥。
    if (this.vmStateDir !== '') return undefined
    if (!this.requireSessionRoute) return undefined
    const sessionId = env['DSH_SESSION_ID']
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
    return {
      ...spec,
      argv: [
        this.docker,
        'exec', '-i', '-t',
        '-w', CONTAINER_WORKSPACE,
        ...envArgs,
        sessionContainerName(this.rootSessionIdOf(sessionId)),
        basename(spec.argv[0] ?? ''),
        ...spec.argv.slice(1),
      ],
      env: {},
    }
  }

  /**
   * 全 VM 的终端路由：终端后端不经过 shell 环境贡献者，改从节点的会话状态文件读
   * SSH 端口与宿主工作区（文件名由同一会话命名约定推导）。
   */
  private vmTerminalRouteBySession(env: NodeJS.ProcessEnv): VmSshRoute | undefined {
    if (this.vmStateDir === '' || this.vmSshKey === '') return undefined
    const sessionId = env['DSH_SESSION_ID']
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const statePath = join(this.vmStateDir, `${sessionVmName(this.rootSessionIdOf(sessionId))}.json`)
    if (!existsSync(statePath)) return undefined
    let record: VmStateFile
    try {
      record = JSON.parse(readFileSync(statePath, 'utf8')) as VmStateFile
    } catch {
      return undefined
    }
    if (typeof record.sshPort !== 'number' || typeof record.workspace !== 'string') return undefined
    return {
      sshPort: record.sshPort,
      sshKey: this.vmSshKey,
      sshUser: this.vmSshUser,
      workspace: record.workspace,
    }
  }

  /** 沿父会话链找到执行世界所属的根会话（与节点的命名约定一致）。 */
  private rootSessionIdOf(sessionId: string): string {
    const sessions = this.ctx.get('sessions')
    let current = SessionId(sessionId)
    for (let depth = 0; depth < 64; depth += 1) {
      const parent = sessions?.get(current)?.header.parentSession
      if (parent === undefined) return String(current)
      current = parent
    }
    return String(current)
  }

  /** 把一次本机 spawn 改写成 `docker exec`（工作目录映射 + 显式环境逐个 -e 传入）。 */
  private rewrite(spec: SubprocessSpawnSpec, env: NodeJS.ProcessEnv, route: ContainerRoute): SubprocessSpawnSpec {
    const containerCwd = guestCwdOf(route.workspace, spec.cwd, CONTAINER_WORKSPACE)
    const envArgs = Object.entries(env).flatMap(([key, value]) =>
      value === undefined ? [] : ['-e', `${key}=${value}`])
    const argv = [
      'exec',
      ...spec.stdio.stdin !== 'ignore' ? ['-i'] : [],
      '-w', containerCwd,
      ...envArgs,
      route.container,
      basename(spec.argv[0] ?? ''),
      ...spec.argv.slice(1),
    ]
    return {
      ...spec,
      argv: [this.docker, ...argv],
      // docker CLI 自身在宿主机上运行，cwd 必须是真实存在的宿主机工作区。
      cwd: resolve(route.workspace),
      // 子进程的显式环境已全部经 -e 传入容器；不再注入 docker 客户端环境。
      env: {},
    }
  }

  /** 把一次本机 spawn 改写成 SSH（工作目录映射 + 显式环境经 `env` 传入 guest）。 */
  private rewriteVm(spec: SubprocessSpawnSpec, env: NodeJS.ProcessEnv, route: VmSshRoute): SubprocessSpawnSpec {
    const guestCwd = guestCwdOf(route.workspace, spec.cwd, VM_WORKSPACE)
    const remote = remoteCommand([basename(spec.argv[0] ?? ''), ...spec.argv.slice(1)], { cwd: guestCwd, env: guestEnvOf(env) })
    return {
      ...spec,
      argv: [this.ssh, ...sshArgv(route, remote)],
      cwd: resolve(route.workspace),
      env: {},
    }
  }

  /** 终端请求的改写（与 {@link rewrite} 同一套映射与校验）。 */
  private rewriteTerminal(
    spec: SubprocessTerminalSpawnSpec,
    env: NodeJS.ProcessEnv,
    route: ContainerRoute,
  ): SubprocessTerminalSpawnSpec {
    const containerCwd = guestCwdOf(route.workspace, spec.cwd, CONTAINER_WORKSPACE)
    const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
    return {
      ...spec,
      argv: [
        this.docker,
        'exec', '-i', '-t',
        '-w', containerCwd,
        ...envArgs,
        route.container,
        basename(spec.argv[0] ?? ''),
        ...spec.argv.slice(1),
      ],
      cwd: resolve(route.workspace),
      env: {},
    }
  }

  /** 全 VM 终端的改写（与 {@link rewriteVm} 同一套映射与校验，另加 TTY）。 */
  private rewriteVmTerminal(
    spec: SubprocessTerminalSpawnSpec,
    env: NodeJS.ProcessEnv,
    route: VmSshRoute,
  ): SubprocessTerminalSpawnSpec {
    const guestCwd = guestCwdOf(route.workspace, spec.cwd, VM_WORKSPACE)
    const remote = remoteCommand([basename(spec.argv[0] ?? ''), ...spec.argv.slice(1)], { cwd: guestCwd, env: guestEnvOf(env) })
    return {
      ...spec,
      argv: [this.ssh, ...sshArgv(route, remote, true)],
      cwd: resolve(route.workspace),
      env: {},
    }
  }
}
