/**
 * SoloEngine 会话出口代理（W10.9 的强制点，运行在每会话的代理容器内）。
 *
 * 拓扑：会话容器只接入一个 `--internal` 网络（无默认路由，无法直连外网），唯一可达的
 * 对端是本代理容器；代理容器双宿（内部网络 + 外网网络），按每会话策略对每条出口先审计
 * 后放行。应用经 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`（HTTP CONNECT、绝对 URI 或
 * SOCKS5）以及本代理的 DNS 出口；绕过代理的直连没有路由，必然失败。
 *
 * 策略求值复用 `@soloengine/cloud-control` 的 `evaluateEgress`（只读挂载同一份实现，
 * 不在容器里复制第二套匹配规则）。DNS 只放行白名单内的主机名，其余返回 NXDOMAIN。
 *
 * 环境：
 * - `EGRESS_POLICY`：`NetworkPolicy` JSON。
 * - `EGRESS_PHASE`：`setup|run|teardown`（默认 `run`）。
 * - `EGRESS_HTTP_PORT` / `EGRESS_SOCKS_PORT` / `EGRESS_DNS_PORT`：默认 3128 / 1080 / 53。
 * - `EGRESS_DNS_UPSTREAM`：上游 DNS（默认 `127.0.0.11`，即 Docker 内嵌解析器）。
 */

import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect as netConnect, createServer as createTcpServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { evaluateEgress } from '/policy/network-policy.js'

const policy = JSON.parse(process.env.EGRESS_POLICY ?? '{"defaultAction":"deny","allow":[],"dnsServers":[]}')
const phase = process.env.EGRESS_PHASE ?? 'run'
const HTTP_PORT = Number(process.env.EGRESS_HTTP_PORT ?? 3128)
const SOCKS_PORT = Number(process.env.EGRESS_SOCKS_PORT ?? 1080)
const DNS_PORT = Number(process.env.EGRESS_DNS_PORT ?? 53)
const DNS_UPSTREAM = process.env.EGRESS_DNS_UPSTREAM ?? '127.0.0.11'

/** 先审计后强制：每条决策都落一行结构化日志，调用方据此取证。 */
function audit(attempt, decision) {
  process.stdout.write(`${JSON.stringify({
    type: 'egress',
    at: new Date().toISOString(),
    phase,
    host: attempt.host,
    port: attempt.port,
    protocol: attempt.protocol,
    allowed: decision.allowed,
    ...decision.allowed ? {} : { reason: decision.reason },
  })}\n`)
}

/**
 * 求值一次出口尝试。
 * @param {{host: string, port: number, protocol: 'tcp'|'udp'}} attempt
 * @returns {{allowed: boolean, reason?: string}}
 */
function decide(attempt) {
  const decision = evaluateEgress(policy, { ...attempt, phase })
  audit(attempt, decision)
  return decision
}

/** 白名单是否覆盖某个主机名（DNS 只按主机名判断，端口由实际连接再校验）。 */
function hostAllowed(host) {
  const name = host.toLowerCase()
  return policy.allow.some(rule => {
    const pattern = rule.host.toLowerCase()
    if (pattern.startsWith('*.')) return name === pattern.slice(2) || name.endsWith(pattern.slice(1))
    return name === pattern
  })
}

/** 解析 `host:port`（CONNECT 目标）。 */
function parseTarget(value, fallbackPort) {
  const last = value.lastIndexOf(':')
  if (last === -1) return { host: value, port: fallbackPort }
  const host = value.slice(0, last)
  const port = Number(value.slice(last + 1))
  return { host: host === '' ? value : host, port: Number.isFinite(port) ? port : fallbackPort }
}

// ── HTTP 代理：CONNECT 隧道 + 绝对 URI 转发 ────────────────────────────────────

const httpServer = createHttpServer((req, res) => {
  if (!req.url || !/^http:\/\//iu.test(req.url)) {
    res.writeHead(400, { 'content-type': 'text/plain' })
    res.end('absolute http:// URI or CONNECT required')
    return
  }
  const target = new URL(req.url)
  const attempt = { host: target.hostname, port: Number(target.port || 80), protocol: 'tcp' }
  if (!decide(attempt).allowed) {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('egress denied by session policy')
    return
  }
  const upstream = httpRequest({
    hostname: attempt.host,
    port: attempt.port,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers: { ...req.headers, host: target.host },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('upstream failed')
    } else {
      res.destroy()
    }
  })
  req.pipe(upstream)
})

httpServer.on('connect', (req, clientSocket, head) => {
  const { host, port } = parseTarget(req.url ?? '', 443)
  const attempt = { host, port, protocol: 'tcp' }
  if (!decide(attempt).allowed) {
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    return
  }
  const upstream = netConnect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

httpServer.listen(HTTP_PORT, '0.0.0.0')

// ── SOCKS5：无认证 CONNECT（域名 / IPv4 / IPv6）──────────────────────────────

createTcpServer(client => {
  let handshaken = false
  let buffer = Buffer.alloc(0)
  client.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    if (!handshaken) {
      if (buffer.length < 2) return
      const methods = buffer[1]
      if (buffer.length < 2 + methods) return
      client.write(Buffer.from([0x05, 0x00]))
      buffer = buffer.subarray(2 + methods)
      handshaken = true
    }
    if (buffer.length < 4) return
    if (buffer[0] !== 0x05 || buffer[1] !== 0x01) {
      client.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      return
    }
    const atyp = buffer[3]
    let host
    let offset
    if (atyp === 0x01) {
      if (buffer.length < 4 + 4 + 2) return
      host = [...buffer.subarray(4, 8)].join('.')
      offset = 8
    } else if (atyp === 0x03) {
      const length = buffer[4]
      if (buffer.length < 5 + length + 2) return
      host = buffer.subarray(5, 5 + length).toString('utf8')
      offset = 5 + length
    } else if (atyp === 0x04) {
      if (buffer.length < 4 + 16 + 2) return
      host = buffer.subarray(4, 20).toString('hex').match(/.{4}/gu).join(':')
      offset = 20
    } else {
      client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      return
    }
    const port = buffer.readUInt16BE(offset)
    const rest = buffer.subarray(offset + 2)
    const attempt = { host, port, protocol: 'tcp' }
    if (!decide(attempt).allowed) {
      client.end(Buffer.from([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      return
    }
    const upstream = netConnect(port, host, () => {
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      if (rest.length > 0) upstream.write(rest)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.removeAllListeners('data')
  })
}).listen(SOCKS_PORT, '0.0.0.0')

// ── DNS：独立出口面（白名单内主机名才转发，其余 NXDOMAIN）─────────────────────

/** 读取 DNS 报文里的 QNAME 与问题段结束偏移。 */
function parseQuestion(message) {
  let offset = 12
  const labels = []
  while (offset < message.length) {
    const length = message[offset]
    if (length === 0) {
      offset += 1
      break
    }
    labels.push(message.subarray(offset + 1, offset + 1 + length).toString('utf8'))
    offset += 1 + length
  }
  return { name: labels.join('.'), end: offset + 4 }
}

/** 构造 NXDOMAIN 响应（保留问题段）。 */
function nxdomain(message, questionEnd) {
  const response = Buffer.from(message.subarray(0, Math.min(questionEnd, message.length)))
  response.writeUInt16BE(0x8183, 2)
  response.writeUInt16BE(0, 6)
  response.writeUInt16BE(0, 8)
  response.writeUInt16BE(0, 10)
  return response
}

const dnsServer = createSocket('udp4')
dnsServer.on('message', (message, remote) => {
  if (message.length < 12) return
  const { name, end } = parseQuestion(message)
  const attempt = { host: name, port: 53, protocol: 'udp' }
  if (!hostAllowed(name)) {
    audit(attempt, { allowed: false, reason: 'default-deny' })
    dnsServer.send(nxdomain(message, end), remote.port, remote.address)
    return
  }
  audit(attempt, { allowed: true })
  const upstream = createSocket('udp4')
  const timer = setTimeout(() => {
    upstream.close()
    dnsServer.send(nxdomain(message, end), remote.port, remote.address)
  }, 3_000)
  upstream.on('message', answer => {
    clearTimeout(timer)
    upstream.close()
    dnsServer.send(answer, remote.port, remote.address)
  })
  upstream.on('error', () => {
    clearTimeout(timer)
    dnsServer.send(nxdomain(message, end), remote.port, remote.address)
  })
  upstream.send(message, 53, DNS_UPSTREAM)
})
dnsServer.bind(DNS_PORT, '0.0.0.0')

process.stdout.write(`${JSON.stringify({
  type: 'egress-proxy',
  at: new Date().toISOString(),
  phase,
  http: HTTP_PORT,
  socks: SOCKS_PORT,
  dns: DNS_PORT,
  allow: policy.allow,
})}\n`)
