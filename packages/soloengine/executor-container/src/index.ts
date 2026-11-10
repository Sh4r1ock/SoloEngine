/**
 * 容器执行后端（W10.7，B 档）。
 *
 * 每会话一个容器；harness 进程不在该容器内（helper 契约与远端样板同构：容器只承载
 * 命令执行与工作区，不承载模型路由/权限判定）。加固基线固定写在创建参数里，调用方
 * 无法放宽：默认拒绝网络、只读根、丢弃全部 capability、禁止提权、pids/内存/CPU 限额、
 * 非 root 用户、独立工作区挂载。
 *
 * 本模块只 shell 出 Docker CLI（不引入 Docker SDK 依赖），错误按退出码与 stderr 显式抛出，
 * 不做静默降级。暂停 = 停容器；恢复 = 启动同一容器（工作区与容器内文件保留）。
 *
 * @module @soloengine/executor-container
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { assertNetworkPolicy, type ContainerNetworkPolicy } from './policy.ts'

/** 容器执行后端创建参数。 */
export interface ContainerExecutorOptions {
  /** 镜像（必须已在节点本地缓存，云端由镜像分发层预热）。 */
  image: string
  /** 宿主机工作区目录（绝对路径；挂载到容器 `/workspace`）。 */
  workspaceDir: string
  /** 容器名（省略时由 Docker 生成随机名）；会话容器用具名便于按会话路由与回收。 */
  name?: string
  /** 同名残留容器先删除再建（节点重启/跨节点接管后重建；默认 false）。 */
  replaceExisting?: boolean
  /** 内存上限（MiB），默认 512。 */
  memoryMb?: number
  /** pids 上限，默认 256。 */
  pidsLimit?: number
  /** CPU 限额（核数），默认 1。 */
  cpus?: number
  /** Docker 可执行文件，默认 `docker`。 */
  docker?: string
  /**
   * OCI 运行时（例如 `kata-runtime` / `runsc`）；省略时用 Docker 默认运行时。
   * C 档（microVM）由该运行时提供独立内核隔离，容器装配本身保持不变。
   */
  runtime?: string
  /** 每会话网络策略（W10.9）；B 档只接受默认拒绝基线，其余显式报错。 */
  networkPolicy?: ContainerNetworkPolicy
  /**
   * 接入的内部网络（与出口代理边车配合）：容器只在该内部网络，没有外部路由；
   * 省略时使用 `--network none`。
   */
  internalNetwork?: string
  /** 容器 DNS 服务器（出口代理地址；仅内部网络拓扑使用）。 */
  dns?: string
  /** 额外容器环境（代理地址等，例如 `HTTP_PROXY` / `ALL_PROXY`）。 */
  env?: Record<string, string>
}

/** 会话容器命名与环境约定（执行器、出口边车、会话路由执行器共用）。 */
export {
  CONTAINER_ENV_KEY,
  CONTAINER_WORKSPACE,
  CONTAINER_WORKSPACE_ENV_KEY,
  DEFAULT_SESSION_CONTAINER_PREFIX,
  sessionContainerName,
} from './naming.ts'

/** 每会话出口代理边车（W10.9）。 */
export {
  EgressSidecar,
  type EgressPolicy,
  type EgressRule,
  type EgressSidecarOptions,
} from './egress.ts'

/** 执行器接受的网络策略面（W10.9）。 */
export {
  assertNetworkPolicy,
  type ContainerEgressRule,
  type ContainerNetworkPolicy,
} from './policy.ts'

/** 一次命令执行结果。 */
export interface ExecResult {
  /** 退出码。 */
  code: number
  /** 标准输出。 */
  stdout: string
  /** 标准错误。 */
  stderr: string
  /** 耗时（毫秒）。 */
  durationMs: number
}

/** 执行参数。 */
export interface ExecOptions {
  /** 超时（毫秒），默认 30 秒。 */
  timeoutMs?: number
}

/** 容器状态（对外只读视图）。 */
export interface ContainerView {
  /** 容器 id。 */
  containerId: string
  /** 镜像。 */
  image: string
  /** 状态。 */
  status: 'running' | 'paused' | 'destroyed'
  /** 创建耗时（毫秒）。 */
  createMs: number
}

/** 创建失败（fail loud）。 */
export class ContainerExecutorError extends Error {
  /**
   * @param message - 原因。
   * @param stderr - Docker 的标准错误（保留原文便于定位）。
   */
  constructor(message: string, readonly stderr = '') {
    super(stderr === '' ? message : `${message}: ${stderr.trim()}`)
    this.name = 'ContainerExecutorError'
  }
}

/* jscpd:ignore-start */
// Each host provider keeps its own private subprocess runner so the two packages stay independent;
// a shared runner package would couple image distribution to the executor for 25 lines.
/** 一条已完成的子进程结果。 */
interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 运行一个子进程并收集输出。
 * @param bin - 可执行文件。
 * @param args - 参数。
 * @param timeoutMs - 超时。
 * @returns 退出码与输出。
 */
async function run(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new ContainerExecutorError(`${bin} ${args[0] ?? ''} timed out after ${String(timeoutMs)}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); reject(new ContainerExecutorError(String(error))) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
/* jscpd:ignore-end */

/** 容器执行后端。 */
export class ContainerExecutor {
  private readonly docker: string
  private readonly containerId: string
  private readonly image: string
  private readonly createMs: number
  private status: ContainerView['status'] = 'running'

  private constructor(docker: string, containerId: string, image: string, createMs: number) {
    this.docker = docker
    this.containerId = containerId
    this.image = image
    this.createMs = createMs
  }

  /**
   * 创建一个会话容器（加固参数固定，不可放宽）。
   * @param options - 镜像与工作区。
   * @returns 已启动的容器执行后端。
   */
  static async create(options: ContainerExecutorOptions): Promise<ContainerExecutor> {
    if (!isAbsolute(options.workspaceDir)) throw new ContainerExecutorError('workspaceDir must be an absolute path')
    assertNetworkPolicy(options.networkPolicy)
    if (options.internalNetwork !== undefined && options.internalNetwork.trim() === '') {
      throw new ContainerExecutorError('internalNetwork must be a non-empty network name')
    }
    const docker = options.docker ?? 'docker'
    if (options.runtime !== undefined && options.runtime.trim() === '') {
      throw new ContainerExecutorError('runtime must be a non-empty OCI runtime name')
    }
    if (options.replaceExisting === true && options.name !== undefined) {
      // 同名残留容器（上次进程/被接管节点）必须先清掉，否则 create 会因名称冲突失败。
      await run(docker, ['rm', '-f', options.name], 15_000)
    }
    const startedAt = Date.now()
    const created = await run(docker, [
      'create',
      '--label', 'soloengine.executor=container',
      ...options.name === undefined ? [] : ['--name', options.name],
      ...options.runtime === undefined ? [] : ['--runtime', options.runtime],
      '--init',
      // 默认全拒；内部网络拓扑下容器只接内部网络（无外部路由，出口只能经代理边车）。
      '--network', options.internalNetwork ?? 'none',
      ...options.dns === undefined ? [] : ['--dns', options.dns],
      ...Object.entries(options.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', String(options.pidsLimit ?? 256),
      '--memory', `${String(options.memoryMb ?? 512)}m`,
      '--cpus', String(options.cpus ?? 1),
      '--user', '65534:65534',
      '--workdir', '/workspace',
      '--volume', `${options.workspaceDir}:/workspace:rw`,
      '--entrypoint', 'sleep',
      options.image,
      'infinity',
    ], 10_000)
    if (created.code !== 0) throw new ContainerExecutorError('docker create failed', created.stderr)
    const containerId = created.stdout.trim()
    if (containerId === '') throw new ContainerExecutorError('docker create returned no container id')
    const started = await run(docker, ['start', containerId], 10_000)
    if (started.code !== 0) {
      await run(docker, ['rm', '-f', containerId], 10_000)
      throw new ContainerExecutorError('docker start failed', started.stderr)
    }
    return new ContainerExecutor(docker, containerId, options.image, Date.now() - startedAt)
  }

  /** Docker 容器 id（会话路由执行器按它执行命令）。 */
  get id(): string {
    return this.containerId
  }

  /**
   * 在容器内执行一条命令。
   * @param argv - 命令与参数（不经过 shell）。
   * @param options - 超时。
   * @returns 退出码与输出。
   */
  async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    if (this.status !== 'running') throw new ContainerExecutorError(`container is ${this.status}`)
    if (argv.length === 0) throw new ContainerExecutorError('exec requires a command')
    const startedAt = Date.now()
    const result = await run(this.docker, ['exec', this.containerId, ...argv], options.timeoutMs ?? 30_000)
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - startedAt }
  }

  /** 暂停（停容器；容器内文件与工作区保留）。 */
  async pause(): Promise<void> {
    if (this.status !== 'running') return
    const result = await run(this.docker, ['stop', '--time', '5', this.containerId], 15_000)
    if (result.code !== 0) throw new ContainerExecutorError('docker stop failed', result.stderr)
    this.status = 'paused'
  }

  /** 恢复（启动同一容器）。 */
  async resume(): Promise<void> {
    if (this.status !== 'paused') return
    const result = await run(this.docker, ['start', this.containerId], 10_000)
    if (result.code !== 0) throw new ContainerExecutorError('docker start failed', result.stderr)
    this.status = 'running'
  }

  /** 销毁（幂等）。 */
  async destroy(): Promise<void> {
    if (this.status === 'destroyed') return
    const result = await run(this.docker, ['rm', '-f', this.containerId], 15_000)
    this.status = 'destroyed'
    if (result.code !== 0 && !result.stderr.includes('No such container')) {
      throw new ContainerExecutorError('docker rm failed', result.stderr)
    }
  }

  /**
   * 当前视图。
   * @returns 容器 id、镜像、状态与创建耗时。
   */
  view(): ContainerView {
    return { containerId: this.containerId, image: this.image, status: this.status, createMs: this.createMs }
  }
}
