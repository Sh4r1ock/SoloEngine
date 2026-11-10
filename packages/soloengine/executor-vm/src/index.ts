/**
 * 全 VM 执行后端（D 档，W9）。
 *
 * 每会话一台 QEMU 全 VM：基础镜像只读，会话盘是 qcow2 覆盖盘（backing file = 基础镜像）；
 * 宿主工作区经 virtio-9p 共享到 guest 的 `/workspace`；命令经 SSH 进入 guest；
 * 暂停/恢复/销毁经 QMP（`stop` / `cont` / `quit`）。
 *
 * 与容器后端的分工：容器（B/C 档）复用 OCI 运行时；本包只在需要完整 OS 环境与图形能力
 * （D 档）时装载。两者对外是同一套执行面（`exec` / `pause` / `resume` / `destroy` / `view`），
 * 上层子进程、沙箱、终端与工具栈不因档位分叉。
 *
 * 基础镜像的部署契约：sshd 已启用、预置平台私钥对应的公钥、把 virtio-9p 的 `workspace`
 * 标签挂到 `/workspace`。平台不在启动时注入 cloud-init；缺任何一项都在 SSH 就绪等待处
 * 显式失败，不静默降级到宿主执行。
 *
 * @module @soloengine/executor-vm
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import { VmExecutorError } from './error.ts'
import { DEFAULT_VM_PREFIX } from './naming.ts'
import { qmpCommand } from './qmp.ts'
import { spawnRunner, type VmCommandResult, type VmCommandRunner } from './runner.ts'
import { remoteCommand, sshArgv, type VmSshRoute } from './ssh.ts'

export { VmExecutorError } from './error.ts'
export { DEFAULT_VM_PREFIX, sessionVmName } from './naming.ts'
export { qmpCommand } from './qmp.ts'
export { spawnRunner, type VmCommandResult, type VmCommandRunner } from './runner.ts'
export {
  remoteCommand,
  shellQuote,
  sshArgv,
  vmRouteFromEnv,
  VM_SSH_KEY_ENV_KEY,
  VM_SSH_PORT_ENV_KEY,
  VM_SSH_USER_ENV_KEY,
  VM_WORKSPACE,
  VM_WORKSPACE_ENV_KEY,
  type VmSshRoute,
} from './ssh.ts'

/** 缺省 guest 登录用户（基础镜像的运维账号）。 */
export const DEFAULT_VM_SSH_USER = 'root'
/** 缺省 QEMU 可执行文件。 */
export const DEFAULT_QEMU = 'qemu-system-x86_64'
/** 缺省 qemu-img 可执行文件。 */
export const DEFAULT_QEMU_IMG = 'qemu-img'
/** 缺省 ssh 可执行文件。 */
export const DEFAULT_SSH = 'ssh'
/** 缺省内存（MiB）。 */
export const DEFAULT_VM_MEMORY_MB = 2048
/** 缺省 vCPU 数。 */
export const DEFAULT_VM_CPUS = 2
/** 缺省 SSH 就绪等待（毫秒）。 */
export const DEFAULT_VM_BOOT_TIMEOUT_MS = 60_000
/** 缺省 SSH 就绪轮询间隔（毫秒）。 */
export const DEFAULT_VM_BOOT_POLL_MS = 500
/** VNC 显示号的端口下界（QEMU `-vnc host:display` 监听 5900+display）。 */
export const VNC_PORT_MIN = 5900
/** VNC 显示号的端口上界。 */
export const VNC_PORT_MAX = 5999

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
  /** guest 内工作目录；默认 `/workspace`。 */
  cwd?: string
}

/** VM 状态（对外只读视图）。 */
export type VmStatus = 'running' | 'paused' | 'destroyed'

/** 全 VM 后端创建参数。 */
export interface VmExecutorOptions {
  /** 基础镜像（qcow2，只读；每会话在其上建覆盖盘）。 */
  image: string
  /** 宿主机工作区目录（绝对路径；共享到 guest 的 `/workspace`）。 */
  workspaceDir: string
  /** 每会话状态目录（绝对路径）：覆盖盘、QMP/pid 状态文件都落在这里。 */
  stateDir: string
  /** VM 名（省略时生成 `soloengine-vm-<uuid>`）。 */
  name?: string
  /** 内存上限（MiB），默认 2048。 */
  memoryMb?: number
  /** vCPU 数，默认 2。 */
  cpus?: number
  /** 加速器；省略时按 `/dev/kvm` 是否存在选 `kvm` 或 `tcg`。 */
  accel?: 'kvm' | 'tcg'
  /** 平台私钥路径（基础镜像预置对应公钥）。 */
  sshKey: string
  /** guest 登录用户，默认 `root`。 */
  sshUser?: string
  /** 宿主机回环 SSH 转发端口（省略时分配空闲端口）。 */
  sshPort?: number
  /** 宿主机回环 QMP 端口（省略时分配空闲端口）。 */
  qmpPort?: number
  /** VNC 端口（5900-5999；省略时扫描空闲端口）。`display: false` 时忽略。 */
  vncPort?: number
  /** 是否暴露 VNC 显示面（D 档默认 true；纯命令行节点可关）。 */
  display?: boolean
  /** QEMU 可执行文件，默认 `qemu-system-x86_64`。 */
  qemu?: string
  /** qemu-img 可执行文件，默认 `qemu-img`。 */
  qemuImg?: string
  /** ssh 可执行文件，默认 `ssh`。 */
  ssh?: string
  /** SSH 就绪等待（毫秒），默认 60 秒。 */
  bootTimeoutMs?: number
  /** SSH 就绪轮询间隔（毫秒），默认 500。 */
  bootPollMs?: number
  /** 同名残留 VM 先经 QMP 停止并清理（节点重启/跨节点接管后重建；默认 false）。 */
  replaceExisting?: boolean
  /** 诊断输出。 */
  log?: (message: string) => void
  /** 命令执行器（测试注入；生产默认 spawn）。 */
  runner?: VmCommandRunner
}

/** 全 VM 后端视图。 */
export interface VmView {
  /** VM 名。 */
  vmId: string
  /** 基础镜像。 */
  image: string
  /** 状态。 */
  status: VmStatus
  /** 创建耗时（毫秒）。 */
  createMs: number
  /** 宿主回环 SSH 端口。 */
  sshPort: number
  /** 宿主回环 QMP 端口。 */
  qmpPort: number
  /** VNC 端口（未暴露显示面时省略）。 */
  vncPort?: number
  /** 加速器。 */
  accel: 'kvm' | 'tcg'
}

/** 落盘的会话状态（同名残留重建与终端路由共用）。 */
interface VmStateRecord {
  name: string
  sshPort: number
  qmpPort: number
  vncPort?: number
  accel: 'kvm' | 'tcg'
  overlay: string
  /** 宿主机工作区（子进程提供方据此映射 guest 工作目录）。 */
  workspace: string
}

/** 已创建后端所需的全部事实。 */
interface VmExecutorState {
  runner: VmCommandRunner
  ssh: string
  name: string
  image: string
  route: VmSshRoute
  qmpPort: number
  vncPort?: number
  accel: 'kvm' | 'tcg'
  overlay: string
  statePath: string
  pidPath: string
  createMs: number
  log: (message: string) => void
}

/** 校验创建参数（fail loud，不做静默兜底）。 */
function assertOptions(options: VmExecutorOptions): void {
  if (!isAbsolute(options.workspaceDir)) throw new VmExecutorError('workspaceDir must be an absolute path')
  if (!isAbsolute(options.stateDir)) throw new VmExecutorError('stateDir must be an absolute path')
  if (options.image.trim() === '') throw new VmExecutorError('image must be a non-empty qcow2 path')
  if (options.sshKey.trim() === '') throw new VmExecutorError('sshKey must be a non-empty private key path')
  if (options.memoryMb !== undefined && (!Number.isInteger(options.memoryMb) || options.memoryMb <= 0)) {
    throw new VmExecutorError(`memoryMb must be a positive integer, got ${String(options.memoryMb)}`)
  }
  if (options.cpus !== undefined && (!Number.isInteger(options.cpus) || options.cpus <= 0)) {
    throw new VmExecutorError(`cpus must be a positive integer, got ${String(options.cpus)}`)
  }
  if (options.bootTimeoutMs !== undefined && options.bootTimeoutMs <= 0) {
    throw new VmExecutorError(`bootTimeoutMs must be positive, got ${String(options.bootTimeoutMs)}`)
  }
  if (options.bootPollMs !== undefined && options.bootPollMs <= 0) {
    throw new VmExecutorError(`bootPollMs must be positive, got ${String(options.bootPollMs)}`)
  }
  if (options.sshPort !== undefined && (!Number.isInteger(options.sshPort) || options.sshPort <= 0)) {
    throw new VmExecutorError(`sshPort must be a positive integer, got ${String(options.sshPort)}`)
  }
  if (options.qmpPort !== undefined && (!Number.isInteger(options.qmpPort) || options.qmpPort <= 0)) {
    throw new VmExecutorError(`qmpPort must be a positive integer, got ${String(options.qmpPort)}`)
  }
}

/**
 * 一个回环端口当前是否可绑定。
 * @param port - 端口号。
 * @returns 可绑定时为 true。
 */
export async function isLoopbackPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveFree) => {
    const server = createServer()
    server.once('error', () => { resolveFree(false) })
    server.listen(port, '127.0.0.1', () => { server.close(() => { resolveFree(true) }) })
  })
}

/** 分配一个空闲回环端口（先绑定 0，读回端口后释放）。 */
async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    /* v8 ignore next 3 -- binding port 0 on loopback cannot fail in the unit lane; real bind errors are reported by doctor */
    server.once('error', (error: Error) => {
      reject(new VmExecutorError(`allocating a loopback port failed: ${error.message}`))
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => { resolvePort(port) })
    })
  })
}

/** 扫描 VNC 端口区间。 */
async function allocateDisplayPort(): Promise<number> {
  for (let port = VNC_PORT_MIN; port <= VNC_PORT_MAX; port += 1) {
    if (await isLoopbackPortFree(port)) return port
  }
  /* v8 ignore next -- exhausting 100 loopback display ports is an operator error that cannot be constructed in-process */
  throw new VmExecutorError(`no free VNC display port in ${String(VNC_PORT_MIN)}-${String(VNC_PORT_MAX)}`)
}

/** 宿主加速器：有 `/dev/kvm` 用 KVM，否则退回 TCG（全软件模拟，功能一致、性能不同）。 */
function defaultAccel(): 'kvm' | 'tcg' {
  /* v8 ignore next -- /dev/kvm is a host fact; the L3 VM conformance run covers the KVM branch on a KVM node */
  return existsSync('/dev/kvm') ? 'kvm' : 'tcg'
}

/** QEMU 选项值里的逗号必须写成两个（否则会被当成下一个选项）。 */
function optionValue(value: string): string {
  return value.replaceAll(',', ',,')
}

/** 等待一个间隔。 */
async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => { setTimeout(resolveDelay, ms) })
}

/** 删除会话状态文件与覆盖盘（幂等）。 */
function cleanupFiles(overlay: string, statePath: string, pidPath: string): void {
  for (const path of [overlay, statePath, pidPath]) rmSync(path, { force: true })
}

/**
 * QMP 不可达时按 `-pidfile` 结束已拉起的 QEMU。
 * @param pidPath - QEMU 写出的 pid 文件路径。
 */
function killRecordedPid(pidPath: string): void {
  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, 'SIGKILL')
  } catch {
    // 进程已退出或 pid 文件缺失：后续文件清理照常进行。
  }
}

/** 同名残留 VM：先 QMP 停止，再清掉覆盖盘与状态文件（节点重启后的重建路径）。 */
async function stopStale(statePath: string, overlay: string, pidPath: string, log: (message: string) => void): Promise<void> {
  if (!existsSync(statePath)) return
  const raw = readFileSync(statePath, 'utf8')
  let state: Partial<VmStateRecord>
  try {
    state = JSON.parse(raw) as Partial<VmStateRecord>
  } catch {
    throw new VmExecutorError(`VM state file ${statePath} is not valid JSON`)
  }
  if (typeof state.qmpPort === 'number') {
    try {
      await qmpCommand(state.qmpPort, 'quit')
    } catch (error: unknown) {
      log(`soloengine: stopping the stale VM at ${statePath} reported ${String(error)}`)
    }
  } else {
    log(`soloengine: VM state file ${statePath} has no QMP port; removing its files`)
  }
  cleanupFiles(overlay, statePath, pidPath)
}

/** SSH 就绪等待的输入。 */
interface SshProbeOptions {
  runner: VmCommandRunner
  ssh: string
  route: VmSshRoute
  timeoutMs: number
  pollMs: number
  log: (message: string) => void
}

/** 轮询 `ssh true` 直到 guest 就绪；超时即失败（不静默放行）。 */
async function waitForSsh(options: SshProbeOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs
  let attempts = 0
  let lastStderr = ''
  for (;;) {
    attempts += 1
    let probe: VmCommandResult
    try {
      probe = await options.runner(
        options.ssh,
        sshArgv(options.route, 'true'),
        Math.max(1_000, Math.min(5_000, deadline - Date.now())),
      )
    } catch (error: unknown) {
      // 单次探测超时（慢启动的 guest、TCG 或高负载宿主）只是一次「尚未就绪」，
      // 继续轮询到 bootTimeoutMs；把最后一次原因留作最终失败的 stderr。
      lastStderr = error instanceof Error ? error.message : String(error)
      probe = { code: -1, stdout: '', stderr: lastStderr }
    }
    if (probe.code === 0) {
      options.log(`soloengine: VM at 127.0.0.1:${String(options.route.sshPort)} accepted SSH after ${String(attempts)} probe(s)`)
      return
    }
    if (probe.stderr !== '') lastStderr = probe.stderr
    if (Date.now() >= deadline) {
      throw new VmExecutorError(
        `VM did not become SSH-reachable within ${String(options.timeoutMs)}ms`,
        lastStderr,
      )
    }
    await delay(options.pollMs)
  }
}

/** 全 VM 执行后端。 */
export class VmExecutor {
  private status: VmStatus = 'running'

  private constructor(private readonly state: VmExecutorState) {}

  /**
   * 创建并启动一台会话 VM。
   * @param options - 基础镜像、工作区、状态目录与 SSH/QEMU 参数。
   * @returns 已就绪的全 VM 后端。
   */
  static async create(options: VmExecutorOptions): Promise<VmExecutor> {
    assertOptions(options)
    const runner = options.runner ?? spawnRunner
    const log = options.log ?? (() => {})
    const name = (options.name ?? `${DEFAULT_VM_PREFIX}${randomUUID()}`).trim()
    if (name === '') throw new VmExecutorError('name must be a non-empty VM name')
    if (name.includes('/') || name.includes('\\')) {
      throw new VmExecutorError(`name must not contain path separators, got "${name}"`)
    }
    const stateDir = resolve(options.stateDir)
    const overlay = join(stateDir, `${name}.qcow2`)
    const statePath = join(stateDir, `${name}.json`)
    const pidPath = join(stateDir, `${name}.pid`)
    mkdirSync(stateDir, { recursive: true })
    if (options.replaceExisting === true) await stopStale(statePath, overlay, pidPath, log)
    const accel = options.accel ?? defaultAccel()
    const sshPort = options.sshPort ?? await allocatePort()
    const qmpPort = options.qmpPort ?? await allocatePort()
    const vncPort = options.display === false ? undefined : options.vncPort ?? await allocateDisplayPort()
    const vncOutOfRange = vncPort !== undefined && (vncPort < VNC_PORT_MIN || vncPort > VNC_PORT_MAX)
    if (vncOutOfRange)
      throw new VmExecutorError(`vncPort must be within ${String(VNC_PORT_MIN)}-${String(VNC_PORT_MAX)}, got ${String(vncPort)}`)
    const startedAt = Date.now()
    const image = resolve(options.image)
    const created = await runner(options.qemuImg ?? DEFAULT_QEMU_IMG, [
      'create', '-f', 'qcow2', '-F', 'qcow2', '-b', image, overlay,
    ], 30_000)
    if (created.code !== 0) throw new VmExecutorError('qemu-img create failed', created.stderr)
    const workspace = resolve(options.workspaceDir)
    const route: VmSshRoute = {
      sshPort,
      sshKey: options.sshKey,
      sshUser: options.sshUser ?? DEFAULT_VM_SSH_USER,
      workspace,
    }
    const qemuArgs = [
      '-name', optionValue(name),
      '-machine', `q35,accel=${accel}`,
      '-cpu', accel === 'kvm' ? 'host' : 'max',
      '-smp', String(options.cpus ?? DEFAULT_VM_CPUS),
      '-m', String(options.memoryMb ?? DEFAULT_VM_MEMORY_MB),
      '-drive', `file=${optionValue(overlay)},if=virtio,format=qcow2`,
      '-virtfs', `local,path=${optionValue(workspace)},mount_tag=workspace,security_model=none,id=workspace`,
      '-netdev', `user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:${String(sshPort)}-:22`,
      '-device', 'virtio-net-pci,netdev=net0',
      '-display', 'none',
      ...vncPort === undefined ? [] : ['-vnc', `127.0.0.1:${String(vncPort - VNC_PORT_MIN)}`],
      '-qmp', `tcp:127.0.0.1:${String(qmpPort)},server=on,wait=off`,
      '-daemonize',
      '-pidfile', optionValue(pidPath),
    ]
    try {
      const started = await runner(options.qemu ?? DEFAULT_QEMU, qemuArgs, 30_000)
      if (started.code !== 0) throw new VmExecutorError('qemu start failed', started.stderr)
      await waitForSsh({
        runner,
        ssh: options.ssh ?? DEFAULT_SSH,
        route,
        timeoutMs: options.bootTimeoutMs ?? DEFAULT_VM_BOOT_TIMEOUT_MS,
        pollMs: options.bootPollMs ?? DEFAULT_VM_BOOT_POLL_MS,
        log,
      })
      const record: VmStateRecord = {
        name,
        sshPort,
        qmpPort,
        ...vncPort === undefined ? {} : { vncPort },
        accel,
        overlay,
        workspace,
      }
      writeFileSync(statePath, `${JSON.stringify(record)}\n`, 'utf8')
      const createMs = Date.now() - startedAt
      log(`soloengine: VM ${name} ready in ${String(createMs)} ms (ssh 127.0.0.1:${String(sshPort)}, accel ${accel})`)
      return new VmExecutor({
        runner,
        ssh: options.ssh ?? DEFAULT_SSH,
        name,
        image,
        route,
        qmpPort,
        ...vncPort === undefined ? {} : { vncPort },
        accel,
        overlay,
        statePath,
        pidPath,
        createMs,
        log,
      })
    } catch (error: unknown) {
      // 就绪等待失败时 QEMU 已经拉起：必须先结束它，否则进程、端口与覆盖盘一起泄漏。
      let stopped = false
      try {
        await qmpCommand(qmpPort, 'quit', 1_000)
        stopped = true
      } catch {
        // QMP 不可达（握手失败/超时）：退回 pidfile 强制结束。
      }
      if (!stopped) {
        killRecordedPid(pidPath)
        // 等进程真正退出后再删覆盖盘，避免文件仍被占用时清理抛错。
        await delay(200)
      }
      cleanupFiles(overlay, statePath, pidPath)
      throw error
    }
  }

  /**
   * 在 guest 内执行一条命令。
   * @param argv - 命令与参数（逐项转义后交给 guest shell）。
   * @param options - 超时与 guest 工作目录。
   * @returns 退出码与输出。
   */
  async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    if (this.status !== 'running') throw new VmExecutorError(`vm is ${this.status}`)
    if (argv.length === 0) throw new VmExecutorError('exec requires a command')
    const startedAt = Date.now()
    const result = await this.state.runner(
      this.state.ssh,
      sshArgv(this.state.route, remoteCommand(argv, options.cwd === undefined ? {} : { cwd: options.cwd })),
      options.timeoutMs ?? 30_000,
    )
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - startedAt }
  }

  /** 暂停（QMP `stop`；guest 内存与执行态保留）。 */
  async pause(): Promise<void> {
    if (this.status !== 'running') return
    await qmpCommand(this.state.qmpPort, 'stop')
    this.status = 'paused'
  }

  /** 恢复（QMP `cont`）。 */
  async resume(): Promise<void> {
    if (this.status !== 'paused') return
    await qmpCommand(this.state.qmpPort, 'cont')
    this.status = 'running'
  }

  /**
   * 销毁（QMP `quit` + 删除覆盖盘与状态文件；幂等）。
   *
   * QMP 不可达时先看 pid 文件：进程仍存活即显式失败，避免在运行中的 VM 下删除磁盘。
   */
  async destroy(): Promise<void> {
    if (this.status === 'destroyed') return
    let quitError: unknown
    try {
      await qmpCommand(this.state.qmpPort, 'quit')
    } catch (error: unknown) {
      quitError = error
    }
    if (quitError !== undefined && this.isAlive()) {
      /* v8 ignore next -- QMP rejects only with VmExecutorError; a non-Error rejection cannot originate here */
      const reason = quitError instanceof Error ? quitError.message : 'non-Error rejection'
      throw new VmExecutorError(`QMP quit failed and the VM process is still alive: ${reason}`)
    }
    this.status = 'destroyed'
    cleanupFiles(this.state.overlay, this.state.statePath, this.state.pidPath)
  }

  /**
   * 当前视图。
   * @returns VM 名、镜像、状态、创建耗时、端口与加速器。
   */
  view(): VmView {
    return {
      vmId: this.state.name,
      image: this.state.image,
      status: this.status,
      createMs: this.state.createMs,
      sshPort: this.state.route.sshPort,
      qmpPort: this.state.qmpPort,
      ...this.state.vncPort === undefined ? {} : { vncPort: this.state.vncPort },
      accel: this.state.accel,
    }
  }

  /** pid 文件指向的 QEMU 进程是否仍存活（读不到或解析失败即视为已退出）。 */
  private isAlive(): boolean {
    let pid: number
    try {
      pid = Number.parseInt(readFileSync(this.state.pidPath, 'utf8').trim(), 10)
    } catch {
      return false
    }
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
