/**
 * 会话 VM 管理（D 档）：为云端会话创建、复用、暂停与销毁每会话全 VM。
 *
 * VM 名由 {@link sessionVmName} 从会话键唯一推导，与按会话路由的子进程提供方共用同一约定；
 * 会话状态文件落在 `stateDir`，终端路由据此读 SSH 端口与宿主工作区。节点重启或跨节点接管后，
 * 同名残留 VM 先经 QMP 停止再重建：工作区与会话日志是持久面，guest 内非工作区文件不跨重建保留。
 *
 * @module @soloengine/host/cloud-vms
 */

import {
  VmExecutor,
  sessionVmName,
  type VmCommandRunner,
  type VmExecutorOptions,
} from '@soloengine/executor-vm'
import { destroySessionWorlds, pauseSessionWorld } from './session-worlds.ts'

/** 管理器依赖。 */
export interface SessionVmsOptions {
  /** 基础镜像（qcow2，节点本地已缓存；缺失时创建失败即报错）。 */
  image: string
  /** 每会话状态目录（覆盖盘、QMP/pid 状态文件）。 */
  stateDir: string
  /** 平台私钥路径（基础镜像预置对应公钥）。 */
  sshKey: string
  /** guest 登录用户；默认 `root`。 */
  sshUser?: string
  /** 内存上限（MiB）。 */
  memoryMb?: number
  /** vCPU 数。 */
  cpus?: number
  /** 加速器；省略时按宿主 `/dev/kvm` 选择。 */
  accel?: 'kvm' | 'tcg'
  /** QEMU 可执行文件。 */
  qemu?: string
  /** qemu-img 可执行文件。 */
  qemuImg?: string
  /** ssh 可执行文件。 */
  ssh?: string
  /** 是否暴露 VNC 显示面（D 档默认开启）。 */
  display?: boolean
  /** SSH 就绪等待（毫秒）。 */
  bootTimeoutMs?: number
  /** 命令执行器（测试注入；生产默认 spawn）。 */
  runner?: VmCommandRunner
  /** 诊断输出。 */
  log: (message: string) => void
}

/** 一个会话 VM 的路由事实（注入 shell 环境、供执行器路由）。 */
export interface SessionVmRoute {
  /** VM 名。 */
  name: string
  /** 宿主回环 SSH 端口。 */
  sshPort: number
  /** guest 登录用户。 */
  sshUser: string
  /** 平台私钥路径。 */
  sshKey: string
  /** 宿主机工作区绝对路径。 */
  workspace: string
}

/** 每会话 VM 管理器（进程内持有；节点退出时统一销毁）。 */
export class SessionVms {
  private readonly entries = new Map<string, { executor: VmExecutor; route: SessionVmRoute }>()

  /**
   * @param options - 镜像、状态目录、SSH 与资源参数。
   */
  constructor(private readonly options: SessionVmsOptions) {}

  /**
   * 确保会话 VM 在运行（已存在则恢复）。
   * @param sessionKey - 根会话键。
   * @param workspaceDir - 宿主机工作区绝对路径。
   * @returns 路由事实。
   */
  async ensure(sessionKey: string, workspaceDir: string): Promise<SessionVmRoute> {
    const existing = this.entries.get(sessionKey)
    if (existing !== undefined) {
      if (existing.route.workspace !== workspaceDir) {
        throw new Error(
          `soloengine: session ${sessionKey} already has a VM for workspace "${existing.route.workspace}",`
          + ` refusing "${workspaceDir}"`,
        )
      }
      await existing.executor.resume()
      this.options.log(`soloengine: session VM ${existing.route.name} resumed`)
      return existing.route
    }
    const name = sessionVmName(sessionKey)
    const executorOptions: VmExecutorOptions = {
      image: this.options.image,
      workspaceDir,
      stateDir: this.options.stateDir,
      name,
      sshKey: this.options.sshKey,
      replaceExisting: true,
      log: this.options.log,
      ...this.options.sshUser === undefined ? {} : { sshUser: this.options.sshUser },
      ...this.options.memoryMb === undefined ? {} : { memoryMb: this.options.memoryMb },
      ...this.options.cpus === undefined ? {} : { cpus: this.options.cpus },
      ...this.options.accel === undefined ? {} : { accel: this.options.accel },
      ...this.options.qemu === undefined ? {} : { qemu: this.options.qemu },
      ...this.options.qemuImg === undefined ? {} : { qemuImg: this.options.qemuImg },
      ...this.options.ssh === undefined ? {} : { ssh: this.options.ssh },
      ...this.options.display === undefined ? {} : { display: this.options.display },
      ...this.options.bootTimeoutMs === undefined ? {} : { bootTimeoutMs: this.options.bootTimeoutMs },
      ...this.options.runner === undefined ? {} : { runner: this.options.runner },
    }
    const executor = await VmExecutor.create(executorOptions)
    const view = executor.view()
    const route: SessionVmRoute = {
      name,
      sshPort: view.sshPort,
      sshUser: this.options.sshUser ?? 'root',
      sshKey: this.options.sshKey,
      workspace: workspaceDir,
    }
    this.entries.set(sessionKey, { executor, route })
    this.options.log(
      `soloengine: session VM ${name} ready in ${String(view.createMs)} ms (ssh 127.0.0.1:${String(view.sshPort)})`,
    )
    return route
  }

  /**
   * 读一个会话的 VM 路由（不创建）。
   * @param sessionKey - 根会话键。
   * @returns 路由事实；该会话没有 VM 时为 undefined。
   */
  route(sessionKey: string): SessionVmRoute | undefined {
    return this.entries.get(sessionKey)?.route
  }

  /**
   * 暂停一个会话 VM（空闲驱逐；guest 内存与执行态保留）。
   * @param sessionKey - 根会话键。
   */
  async pause(sessionKey: string): Promise<void> {
    await pauseSessionWorld(this.entries, sessionKey, 'VM', this.options.log)
  }

  /**
   * 销毁一个会话 VM（启动失败回滚；失败只记录，不阻断回滚）。
   * @param sessionKey - 根会话键。
   */
  async destroy(sessionKey: string): Promise<void> {
    const entry = this.entries.get(sessionKey)
    if (entry === undefined) return
    this.entries.delete(sessionKey)
    try {
      await entry.executor.destroy()
    } catch (error) {
      this.options.log(`soloengine: destroying session VM ${entry.route.name} failed: ${String(error)}`)
    }
  }

  /** 销毁全部会话 VM（节点退出；失败逐条报出，不阻断其余销毁）。 */
  async destroyAll(): Promise<void> {
    await destroySessionWorlds(this.entries, 'VM', this.options.log)
  }
}
