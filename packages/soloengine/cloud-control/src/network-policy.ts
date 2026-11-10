/**
 * 每会话网络策略求值（W10.9）。
 *
 * 策略的**执行点**在执行后端（容器/microVM 的网络命名空间）；本模块只做求值与审计记录，
 * 不碰进程与网络——这样同一份策略语义可被容器、microVM 与测试共用，且「先审计后强制」
 * 有唯一实现：调用方先记录 {@link PolicyDecision.audit}，再按 `allowed` 放行/拒绝。
 *
 * 语义（Plan W10.9）：默认拒绝、白名单、DNS 独立出口面、随阶段收紧。
 * - `setup`：只允许 DNS（拉取依赖/解析域名），业务出口仍拒绝；
 * - `run`：允许白名单内的出口 + DNS；
 * - `teardown`：全部拒绝。
 *
 * @module @soloengine/cloud-control/network-policy
 */

/** 会话阶段（随阶段收紧的唯一输入）。 */
export type SessionPhase = 'setup' | 'run' | 'teardown'

/** 一条白名单出口规则。 */
export interface EgressRule {
  /** 目标主机：精确域名/IP，或 `*.example.com` 后缀通配。 */
  host: string
  /** 目标端口；省略表示该主机任意端口。 */
  port?: number
  /** 传输层协议；省略表示 tcp。 */
  protocol?: 'tcp' | 'udp'
}

/** 每会话网络策略。 */
export interface NetworkPolicy {
  /** 默认动作；当前只支持 deny（默认拒绝是唯一合法基线）。 */
  defaultAction: 'deny'
  /** 白名单出口。 */
  allow: readonly EgressRule[]
  /** DNS 独立出口面：只允许发往这些服务器的 53 端口。 */
  dnsServers: readonly string[]
}

/** 一次出口尝试。 */
export interface EgressAttempt {
  /** 目标主机（域名或 IP 字面量）。 */
  host: string
  /** 目标端口。 */
  port: number
  /** 传输层协议。 */
  protocol: 'tcp' | 'udp'
  /** 当前会话阶段。 */
  phase: SessionPhase
}

/** 拒绝原因。 */
export type EgressDenyReason =
  /** 阶段已关闭（teardown，或 setup 阶段的非 DNS 出口）。 */
  | 'phase-closed'
  /** 非 DNS 服务器却发往 53 端口（DNS 必须走独立出口面）。 */
  | 'dns-egress'
  /** 默认拒绝：不在白名单内。 */
  | 'default-deny'

/** 求值结果（含审计记录，调用方先落审计再强制）。 */
export interface PolicyDecision {
  /** 是否放行。 */
  allowed: boolean
  /** 放行时命中的规则；DNS 放行为 undefined。 */
  matched?: EgressRule
  /** 拒绝原因（放行时为 undefined）。 */
  reason?: EgressDenyReason
  /** 审计记录（执行后端原样落库/打点）。 */
  audit: {
    phase: SessionPhase
    host: string
    port: number
    protocol: 'tcp' | 'udp'
    decision: 'allow' | 'deny'
    reason?: EgressDenyReason
  }
}

/** 主机是否命中规则（精确或 `*.` 后缀通配）。 */
function hostMatches(rule: string, host: string): boolean {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return rule === host
}

/**
 * 求值一次出口尝试。
 * @param policy - 会话网络策略。
 * @param attempt - 出口尝试。
 * @returns 放行/拒绝与审计记录。
 */
export function evaluateEgress(policy: NetworkPolicy, attempt: EgressAttempt): PolicyDecision {
  const audit = {
    phase: attempt.phase,
    host: attempt.host,
    port: attempt.port,
    protocol: attempt.protocol,
  }
  const deny = (reason: EgressDenyReason): PolicyDecision => ({
    allowed: false,
    reason,
    audit: { ...audit, decision: 'deny', reason },
  })

  if (attempt.phase === 'teardown') return deny('phase-closed')

  // DNS 独立出口面：53 端口只能发往策略声明的解析服务器。
  const isDns = attempt.port === 53
  if (isDns) {
    if (!policy.dnsServers.includes(attempt.host)) return deny('dns-egress')
    return { allowed: true, audit: { ...audit, decision: 'allow' } }
  }
  if (attempt.phase === 'setup') return deny('phase-closed')

  const protocol = attempt.protocol
  const matched = policy.allow.find(rule => hostMatches(rule.host, attempt.host)
    && (rule.port === undefined || rule.port === attempt.port)
    && (rule.protocol ?? 'tcp') === protocol)
  if (matched === undefined) return deny('default-deny')
  return { allowed: true, matched, audit: { ...audit, decision: 'allow' } }
}
