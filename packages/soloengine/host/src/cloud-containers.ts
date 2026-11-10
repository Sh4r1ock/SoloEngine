/**
 * 会话容器管理（W10.7）：为云端会话创建、复用、暂停与销毁每会话容器。
 *
 * 容器名由 {@link sessionContainerName} 从会话键唯一推导，与按会话路由的子进程提供方
 * （`@soloengine/subprocess-container`）共用同一约定；容器内工作区固定挂载 `/workspace`。
 * 节点重启或跨节点接管后，同名残留容器先删除再建：工作区与会话日志是持久面，容器内
 * 非工作区文件不跨重建保留。
 *
 * @module @soloengine/host/cloud-containers
 */

import {
  ContainerExecutor,
  DEFAULT_SESSION_CONTAINER_PREFIX,
  EgressSidecar,
  sessionContainerName,
  type EgressRule,
} from '@soloengine/executor-container'
import { ImageCache } from '@soloengine/image-distribution'
import { destroySessionWorlds, pauseSessionWorld } from './session-worlds.ts'

/** 管理器依赖。 */
export interface SessionContainersOptions {
  /** 容器镜像（节点本地已缓存；缺失时创建失败即报错）。 */
  image: string
  /** Docker 可执行文件；默认 `docker`。 */
  docker?: string
  /** OCI 运行时（microVM / 全 VM 档，例如 `kata-runtime` / `runsc`）；省略时用 Docker 默认运行时。 */
  runtime?: string
  /** 容器名前缀；默认与执行器包同一常量。 */
  namePrefix?: string
  /**
   * 部署的每会话出口策略（W10.9）。`allow` 为空 = 默认拒绝（`--network none`）；
   * 非空时启动出口代理边车，会话容器只接内部网络，出口只能经代理。
   */
  policy?: { allow: readonly EgressRule[]; dnsServers: readonly string[] }
  /** 代理容器镜像（必须含 `node`）；默认与容器镜像相同。 */
  proxyImage?: string
  /** 镜像缺失时是否允许按需拉取（默认允许；离线节点可关，关后缺镜像即显式报错）。 */
  allowPull?: boolean
  /** 诊断输出。 */
  log: (message: string) => void
}

/** 一个会话容器的路由事实（注入 shell 环境、供执行器路由）。 */
export interface SessionContainerRoute {
  /** 容器名（docker 可直接用）。 */
  name: string
  /** 宿主机工作区绝对路径。 */
  workspace: string
}

/** 每会话容器管理器（进程内持有；节点退出时统一销毁）。 */
export class SessionContainers {
  private readonly entries = new Map<string, { executor: ContainerExecutor; route: SessionContainerRoute }>()
  private readonly sidecars = new Map<string, EgressSidecar>()
  /** 节点镜像缓存（W10.12）：本地命中优先，缺失时按部署策略拉取。 */
  private readonly images: ImageCache

  /**
   * @param options - 镜像、Docker 命令、出口策略与诊断输出。
   */
  constructor(private readonly options: SessionContainersOptions) {
    this.images = new ImageCache({
      ...options.docker === undefined ? {} : { docker: options.docker },
      ...options.allowPull === undefined ? {} : { allowPull: options.allowPull },
    })
  }

  /**
   * 确保会话容器在运行（已存在则恢复）。
   * @param sessionKey - 根会话键。
   * @param workspaceDir - 宿主机工作区绝对路径。
   * @returns 容器路由事实。
   */
  async ensure(sessionKey: string, workspaceDir: string): Promise<SessionContainerRoute> {
    const existing = this.entries.get(sessionKey)
    if (existing !== undefined) {
      if (existing.route.workspace !== workspaceDir) {
        throw new Error(
          `soloengine: session ${sessionKey} already has a container for workspace "${existing.route.workspace}",`
          + ` refusing "${workspaceDir}"`,
        )
      }
      await existing.executor.resume()
      this.options.log(`soloengine: session container ${existing.route.name} resumed`)
      return existing.route
    }
    const name = sessionContainerName(sessionKey, this.options.namePrefix ?? DEFAULT_SESSION_CONTAINER_PREFIX)
    // 节点镜像缓存（W10.12）：先确保会话镜像与代理镜像在位；缺失且禁止拉取即显式失败。
    const warmed = await this.images.ensure(this.options.image)
    if (warmed.tier === 'pulled') {
      this.options.log(`soloengine: pulled session image ${warmed.image} in ${String(warmed.durationMs)} ms (W10.12)`)
    }
    const proxyImage = this.options.proxyImage ?? this.options.image
    if (proxyImage !== this.options.image) {
      const proxyWarmed = await this.images.ensure(proxyImage)
      if (proxyWarmed.tier === 'pulled') {
        this.options.log(`soloengine: pulled proxy image ${proxyWarmed.image} in ${String(proxyWarmed.durationMs)} ms (W10.12)`)
      }
    }
    const allow = this.options.policy?.allow ?? []
    const sidecar = allow.length > 0
      ? await EgressSidecar.start({
        sessionKey,
        policy: {
          defaultAction: 'deny',
          allow,
          dnsServers: this.options.policy?.dnsServers ?? [],
        },
        proxyImage,
        ...this.options.policy?.dnsServers[0] === undefined
          ? {}
          : { dnsUpstream: this.options.policy.dnsServers[0] },
        ...this.options.docker === undefined ? {} : { docker: this.options.docker },
        log: this.options.log,
      })
      : undefined
    let executor: ContainerExecutor
    try {
      executor = await ContainerExecutor.create({
        image: this.options.image,
        workspaceDir,
        name,
        replaceExisting: true,
        // B 档只强制默认拒绝；放行只发生在代理边车里（先审计后放行），容器本身没有外部路由。
        networkPolicy: { defaultAction: 'deny', allow: [], dnsServers: [] },
        ...this.options.docker === undefined ? {} : { docker: this.options.docker },
        ...this.options.runtime === undefined ? {} : { runtime: this.options.runtime },
        ...sidecar === undefined
          ? {}
          : {
            internalNetwork: sidecar.networkName,
            dns: sidecar.proxyAddress,
            env: {
              HTTP_PROXY: `http://${sidecar.proxyAddress}:3128`,
              HTTPS_PROXY: `http://${sidecar.proxyAddress}:3128`,
              ALL_PROXY: `socks5h://${sidecar.proxyAddress}:1080`,
              NO_PROXY: 'localhost,127.0.0.1',
            },
          },
      })
    } catch (error) {
      await sidecar?.stop()
      throw error
    }
    if (sidecar !== undefined) this.sidecars.set(sessionKey, sidecar)
    const route: SessionContainerRoute = { name, workspace: workspaceDir }
    this.entries.set(sessionKey, { executor, route })
    this.options.log(
      `soloengine: session container ${name} ready in ${String(executor.view().createMs)} ms (workspace ${workspaceDir})`,
    )
    return route
  }

  /**
   * 读一个会话的容器路由（不创建）。
   * @param sessionKey - 根会话键。
   * @returns 路由事实；该会话没有容器时为 undefined。
   */
  route(sessionKey: string): SessionContainerRoute | undefined {
    return this.entries.get(sessionKey)?.route
  }

  /**
   * 暂停一个会话容器（空闲驱逐；工作区与容器内文件保留）。
   * @param sessionKey - 根会话键。
   */
  async pause(sessionKey: string): Promise<void> {
    await pauseSessionWorld(this.entries, sessionKey, 'container', this.options.log)
  }

  /**
   * 销毁一个会话容器与出口代理边车（启动失败回滚）。
   *
   * 工作区是宿主机上的绑定挂载，销毁容器不丢文件；失败只记录，不阻断回滚。
   * @param sessionKey - 根会话键。
   */
  async destroy(sessionKey: string): Promise<void> {
    const entry = this.entries.get(sessionKey)
    if (entry !== undefined) {
      this.entries.delete(sessionKey)
      try {
        await entry.executor.destroy()
      } catch (error) {
        this.options.log(`soloengine: destroying session container ${entry.route.name} failed: ${String(error)}`)
      }
    }
    const sidecar = this.sidecars.get(sessionKey)
    if (sidecar !== undefined) {
      this.sidecars.delete(sessionKey)
      if (!await sidecar.stop()) {
        this.options.log(`soloengine: stopping the egress sidecar for session ${sessionKey} reported cleanup failures`)
      }
    }
  }

  /** 销毁全部会话容器与出口代理边车（节点退出；失败逐条报出，不阻断其余销毁）。 */
  async destroyAll(): Promise<void> {
    await destroySessionWorlds(this.entries, 'container', this.options.log)
    for (const [sessionKey, sidecar] of [...this.sidecars]) {
      this.sidecars.delete(sessionKey)
      if (!await sidecar.stop()) {
        this.options.log(`soloengine: stopping the egress sidecar for session ${sessionKey} reported cleanup failures`)
      }
    }
  }
}
