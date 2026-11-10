/**
 * 容器后端的网络策略面（W10.9）。
 *
 * 容器执行器自身**不实现**策略求值：白名单与 DNS 独立出口面由出口代理边车按
 * `@soloengine/cloud-control` 的 `evaluateEgress` 强制执行。执行器只接受两种拓扑：
 *
 * - 默认拒绝基线（`allow`/`dnsServers` 皆空）：容器 `--network none`，没有任何网络；
 * - 内部网络 + 代理边车（`allow` 非空）：容器只接 `--internal` 网络，出口只能经代理。
 *
 * 其余组合（声明白名单却仍直连外网、把 DNS 直接交给容器）会让策略成为「协作式约定」，
 * 因此显式报错而不是静默忽略。
 *
 * @module @soloengine/executor-container/policy
 */

/** 一条白名单出口规则（与 `@soloengine/cloud-control` 的 `EgressRule` 同形）。 */
export interface ContainerEgressRule {
  /** 目标主机：精确域名/IP，或 `*.example.com` 后缀通配。 */
  host: string
  /** 目标端口；省略表示该主机任意端口。 */
  port?: number
  /** 传输层协议；省略表示 tcp。 */
  protocol?: 'tcp' | 'udp'
}

/** 每会话网络策略（与 `@soloengine/cloud-control` 的 `NetworkPolicy` 同形）。 */
export interface ContainerNetworkPolicy {
  /** 默认动作；默认拒绝是唯一合法基线。 */
  defaultAction: 'deny'
  /** 白名单出口。 */
  allow: readonly ContainerEgressRule[]
  /** DNS 解析服务器；非空表示 DNS 必须走独立出口面（代理），不能交给容器直连。 */
  dnsServers: readonly string[]
}

/**
 * 校验执行器收到的策略是否落在它支持的拓扑内。
 * @param policy - 调用方声明的策略；省略表示纯默认拒绝基线。
 * @throws Error 当策略要求执行器无法强制的出口（白名单或容器直连 DNS）。
 */
export function assertNetworkPolicy(policy: ContainerNetworkPolicy | undefined): void {
  if (policy === undefined) return
  const defaultAction: string = policy.defaultAction
  if (defaultAction !== 'deny') {
    throw new Error(`container network policy is default-deny only; got ${defaultAction}`)
  }
  if (policy.allow.length > 0) {
    throw new Error(
      'container network policy declares an allowlist; the container backend enforces egress through the '
      + 'proxy sidecar (`internalNetwork`), never by allowing the container direct egress',
    )
  }
  if (policy.dnsServers.length > 0) {
    throw new Error(
      'container network policy declares DNS servers; DNS is an independent egress face served by the proxy '
      + 'sidecar, never by handing resolvers to the container',
    )
  }
}
