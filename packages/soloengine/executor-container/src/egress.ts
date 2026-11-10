/**
 * 每会话出口代理边车（W10.9 的强制拓扑）。
 *
 * 拓扑与不变量：
 * - 会话容器只接入一个 `--internal` 网络：没有默认路由，无法直连任何外部地址；
 * - 代理容器双宿（内部网络 + 外部网络），是会话容器唯一可达的对端；
 * - 代理按共享的 `evaluateEgress` 对每条出口先审计后放行（HTTP CONNECT / SOCKS5 / DNS）。
 *
 * 因此「默认拒绝 + 白名单 + DNS 独立出口面」是网络拓扑强制的，而不是协作式的环境变量约定：
 * 绕过代理的直连没有路由，必然失败。
 *
 * 代理容器使用部署提供的镜像（必须含 `node`）；代理脚本与策略求值器以只读文件挂载进
 * 代理容器，不在镜像内复制第二份实现。
 *
 * @module @soloengine/executor-container/egress
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { EGRESS_PROXY_ASSET } from '@soloengine/egress-proxy'
import { sessionContainerName } from './naming.ts'

const require = createRequire(import.meta.url)

/** 与 `@soloengine/cloud-control` 的 `EgressRule` 同形。 */
export interface EgressRule {
  host: string
  port?: number
  protocol?: 'tcp' | 'udp'
}

/** 与 `@soloengine/cloud-control` 的 `NetworkPolicy` 同形。 */
export interface EgressPolicy {
  defaultAction: 'deny'
  allow: readonly EgressRule[]
  dnsServers: readonly string[]
}

/** 边车参数。 */
export interface EgressSidecarOptions {
  /** 会话键（网络、容器名由它推导）。 */
  sessionKey: string
  /** 每会话策略（写入代理的环境）。 */
  policy: EgressPolicy
  /** 代理容器镜像（必须含 `node`）。 */
  proxyImage: string
  /** 代理的上游 DNS（默认 `127.0.0.11`，Docker 内嵌解析器）。 */
  dnsUpstream?: string
  /** Docker 可执行文件；默认 `docker`。 */
  docker?: string
  /** 诊断输出。 */
  log?: (message: string) => void
}

/** 一条子进程结果。 */
interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 运行一条命令并收集输出。
 * @param command - 可执行文件。
 * @param args - 参数。
 * @param timeoutMs - 超时。
 * @returns 退出码与输出。
 */
function run(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`docker ${args.join(' ')} timed out after ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** 一个已启动的出口代理边车。 */
export class EgressSidecar {
  /** 内部网络名（会话容器只接它）。 */
  readonly networkName: string
  /** 代理容器名。 */
  readonly proxyName: string
  /** 代理在内部网络上的地址（会话容器用它作 DNS 与代理主机）。 */
  readonly proxyAddress: string
  /** 外部网络名（代理与目标服务所在网络）。 */
  readonly externalNetwork: string

  private constructor(
    private readonly docker: string,
    private readonly log: (message: string) => void,
    networkName: string,
    proxyName: string,
    proxyAddress: string,
    externalNetwork: string,
  ) {
    this.networkName = networkName
    this.proxyName = proxyName
    this.proxyAddress = proxyAddress
    this.externalNetwork = externalNetwork
  }

  /**
   * 创建内部网络、外部网络与双宿代理容器，并等待代理就绪。
   * @param options - 会话键、策略、镜像与 Docker 命令。
   * @returns 已就绪的边车。
   */
  static async start(options: EgressSidecarOptions): Promise<EgressSidecar> {
    if (options.policy.allow.length === 0) {
      throw new Error('egress sidecar requires a non-empty allowlist; the default-deny baseline uses --network none instead')
    }
    const docker = options.docker ?? 'docker'
    const log = options.log ?? (() => {})
    const networkName = sessionContainerName(options.sessionKey, 'soloengine-egress-')
    const externalNetwork = `${networkName}-out`
    const proxyName = sessionContainerName(options.sessionKey, 'soloengine-egress-proxy-')

    const createNetwork = async (name: string, internal: boolean): Promise<void> => {
      const args = ['network', 'create', ...internal ? ['--internal'] : [], name]
      const result = await run(docker, args, 20_000)
      if (result.code !== 0 && !result.stderr.includes('already exists')) {
        throw new Error(`docker network create ${name} failed: ${result.stderr.trim()}`)
      }
    }
    await createNetwork(networkName, true)
    await createNetwork(externalNetwork, false)

    // 节点崩溃/被强杀后同名代理容器可能仍在（`destroyAll` 没跑到）：先强制移除再创建，
    // 否则 docker run 会因「container name is already in use」让该节点所有会话都起不来。
    const removed = await run(docker, ['rm', '-f', proxyName], 20_000)
    if (removed.code !== 0 && !removed.stderr.includes('No such container')) {
      throw new Error(`removing the stale egress proxy ${proxyName} failed: ${removed.stderr.trim()}`)
    }

    try {
      const script = EGRESS_PROXY_ASSET
      const policyFile = require.resolve('@soloengine/cloud-control').replace(/index\.js$/u, 'network-policy.js')
      const created = await run(docker, [
        'run', '-d',
        '--name', proxyName,
        '--network', networkName,
        '--volume', `${script}:/proxy/server.mjs:ro`,
        '--volume', `${policyFile}:/policy/network-policy.js:ro`,
        '--env', `EGRESS_POLICY=${JSON.stringify(options.policy)}`,
        '--env', 'EGRESS_PHASE=run',
        ...options.dnsUpstream === undefined ? [] : ['--env', `EGRESS_DNS_UPSTREAM=${options.dnsUpstream}`],
        options.proxyImage,
        'node', '/proxy/server.mjs',
      ], 60_000)
      if (created.code !== 0) throw new Error(`starting the egress proxy failed: ${created.stderr.trim()}`)
      const connected = await run(docker, ['network', 'connect', externalNetwork, proxyName], 20_000)
      if (connected.code !== 0 && !connected.stderr.includes('already exists')) {
        throw new Error(`attaching the egress proxy to ${externalNetwork} failed: ${connected.stderr.trim()}`)
      }
      const inspected = await run(docker, [
        'inspect', '-f', `{{(index .NetworkSettings.Networks "${networkName}").IPAddress}}`, proxyName,
      ], 20_000)
      if (inspected.code !== 0) throw new Error(`inspecting the egress proxy failed: ${inspected.stderr.trim()}`)
      const proxyAddress = inspected.stdout.trim()
      if (proxyAddress === '') throw new Error('the egress proxy has no address on the internal network')

      // 就绪：代理进程已在内部网络监听 HTTP 代理端口。
      const deadline = Date.now() + 30_000
      for (;;) {
        const probe = await run(docker, [
          'exec', proxyName, 'node', '-e',
          "const n=require('net');const s=n.connect(3128,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1))",
        ], 20_000)
        if (probe.code === 0) break
        if (Date.now() > deadline) throw new Error('the egress proxy did not become ready within 30 s')
        await new Promise(done => setTimeout(done, 500))
      }
      log(`soloengine: egress sidecar ${proxyName} ready (${proxyAddress} on ${networkName})`)
      return new EgressSidecar(docker, log, networkName, proxyName, proxyAddress, externalNetwork)
    } catch (error) {
      await run(docker, ['rm', '-f', proxyName], 20_000).catch(() => undefined)
      await run(docker, ['network', 'rm', networkName], 20_000).catch(() => undefined)
      await run(docker, ['network', 'rm', externalNetwork], 20_000).catch(() => undefined)
      throw error
    }
  }

  /**
   * 停止代理容器并删除两张网络（幂等；失败逐条记录，不掩盖第一条错误）。
   * @returns 全部清理完成。
   */
  async stop(): Promise<boolean> {
    let ok = true
    for (const args of [
      ['rm', '-f', this.proxyName],
      ['network', 'rm', this.networkName],
      ['network', 'rm', this.externalNetwork],
    ] as const) {
      const result = await run(this.docker, args, 20_000).catch((error: unknown) => ({
        code: -1, stdout: '', stderr: String(error),
      }))
      if (result.code !== 0) {
        ok = false
        this.log(`soloengine: egress sidecar cleanup \`docker ${args.join(' ')}\` failed: ${result.stderr.trim()}`)
      }
    }
    return ok
  }
}
