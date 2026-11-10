#!/usr/bin/env node
/**
 * 扩容执行器（W14）：读取控制面的扩容决策，按决策创建/回收 Docker 节点容器。
 *
 * 只处理自动创建的节点（`SOLOENGINE_NODE_PREFIX` 前缀），基线节点（node-a/node-b）永不删除；
 * 缩容先 `POST /v1/nodes/drain` 迁移会话，再移除容器与数据卷。
 *
 * 用法（策略必须显式给出）：
 *   SOLOENGINE_SCALE_MIN=1 SOLOENGINE_SCALE_MAX=4 SOLOENGINE_SCALE_TARGET=0.8 \
 *   SOLOENGINE_SCALE_THRESHOLD=0.5 SOLOENGINE_SCALE_STEP=1 \
 *   node deploy/cloud/autoscale.mjs --execute
 *
 * 不带 `--execute` 时只打印决策（预检）。
 *
 * @module deploy/cloud/autoscale
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'

const CONTROL_URL = process.env.SOLOENGINE_CONTROL_URL ?? 'http://127.0.0.1:8992'
const IMAGE = process.env.SOLOENGINE_CONTAINER_IMAGE ?? 'soloengine:l2'
const PREFIX = process.env.SOLOENGINE_NODE_PREFIX ?? 'soloengine-cloud-auto-'
const PORT_BASE = Number(process.env.SOLOENGINE_NODE_PORT_BASE ?? 9000)
const REGION = process.env.SOLOENGINE_NODE_REGION ?? 'docker-vm'
const MAX_SESSIONS = Number(process.env.SOLOENGINE_NODE_MAX_SESSIONS ?? 8)
const EXECUTE = process.argv.includes('--execute')

/** 从环境读取扩容策略；缺一即失败（不猜默认）。 */
function policyFromEnv() {
  const read = name => {
    const raw = process.env[name]
    if (raw === undefined || raw.trim() === '') throw new Error(`${name} is required`)
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`)
    return value
  }
  return {
    minNodes: read('SOLOENGINE_SCALE_MIN'),
    maxNodes: read('SOLOENGINE_SCALE_MAX'),
    targetUtilization: read('SOLOENGINE_SCALE_TARGET'),
    scaleInThreshold: read('SOLOENGINE_SCALE_THRESHOLD'),
    maxStep: read('SOLOENGINE_SCALE_STEP'),
  }
}

const sleep = ms => new Promise(done => setTimeout(done, ms))

/**
 * 跑一条命令并取输出（不抛）。
 * @param command - 可执行文件。
 * @param args - 参数。
 * @returns 退出码与输出。
 */
function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += String(chunk) })
    child.stderr.on('data', chunk => { out += String(chunk) })
    child.on('error', error => { resolve({ code: 1, out: String(error) }) })
    child.on('exit', code => { resolve({ code: code ?? 1, out }) })
  })
}

const docker = args => run('docker', args)

/**
 * 调控制面 JSON 接口。
 * @param path - 路径。
 * @param body - JSON 体；省略时发 GET。
 * @returns 状态码与响应体。
 */
async function control(path, body) {
  const response = await fetch(`${CONTROL_URL}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/**
 * 等容器日志出现就绪模式。
 * @param container - 容器名。
 * @param pattern - 就绪正则。
 * @param timeoutMs - 超时。
 * @returns 是否就绪。
 */
async function waitLog(container, pattern, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const logs = await docker(['logs', '--tail', '80', container])
    if (pattern.test(logs.out)) return true
    await sleep(500)
  }
  return false
}

/**
 * 探测 127.0.0.1 上的空闲端口。
 * @param used - 已被占用的端口集合。
 * @returns 空闲端口。
 */
async function freePort(used) {
  for (let port = PORT_BASE; port < PORT_BASE + 100; port += 1) {
    if (used.has(port)) continue
    const available = await new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => { resolve(false) })
      server.listen(port, '127.0.0.1', () => { server.close(() => { resolve(true) }) })
    })
    if (available) return port
  }
  throw new Error(`no free port in [${String(PORT_BASE)}, ${String(PORT_BASE + 100)})`)
}

/**
 * 创建并注册一个自动节点。
 * @param nodeId - 节点 id。
 * @param port - 监听端口。
 * @param usedPorts - 已占用端口。
 * @returns 创建的节点 id。
 */
async function createNode(nodeId, port, usedPorts) {
  const volume = `${nodeId}-data`
  const started = await docker(['run', '-d', '--name', nodeId, '--network', 'host',
    '-v', `${volume}:/data`,
    '-e', 'SOLOENGINE_DB_FORM=cloud',
    '-e', 'SOLOENGINE_DATABASE_URL=postgres://postgres:soloengine@127.0.0.1:55432/cloud',
    '-e', 'SOLOENGINE_HOST=127.0.0.1',
    '-e', `SOLOENGINE_PORT=${String(port)}`,
    '-e', 'SOLOENGINE_NO_OPEN=1',
    '-e', `SOLOENGINE_CONTROL_URL=${CONTROL_URL}`,
    '-e', `SOLOENGINE_NODE_ID=${nodeId}`,
    '-e', 'SOLOENGINE_ROOT=/app',
    '-e', 'SOLOENGINE_DB=/data/soloengine.db',
    '-e', 'DSH_HOME=/data/dsh-home',
    '-e', 'SOLOENGINE_KEYS_DIR=/data/home/keys',
    '-e', 'SOLOENGINE_SKILLS_DIR=/data/skills',
    IMAGE, 'sh', '-c',
    '[ -d /data/dsh-home ] || cp -a /app/data/. /data/;'
    + ' cd /app && exec node --import tsx/esm apps/cli/src/bin.ts'
    + ' --profile soloengine'
    + ' --patch packages/soloengine/host/cordis.form-cloud.patch.yml'
    + ` --host 127.0.0.1 --port ${String(port)} --no-open`])
  if (started.code !== 0) throw new Error(`docker run ${nodeId} failed: ${started.out.slice(-400)}`)
  const ready = await waitLog(nodeId, /dsh web: http:\/\/\S+/u)
  if (!ready) {
    await docker(['rm', '-f', nodeId])
    throw new Error(`node ${nodeId} did not become ready`)
  }
  const registered = await control('/v1/nodes/register', {
    nodeId, endpoint: `http://127.0.0.1:${String(port)}`, region: REGION, maxSessions: MAX_SESSIONS,
  })
  if (registered.status !== 201) throw new Error(`register ${nodeId} failed: ${JSON.stringify(registered.body)}`)
  await control('/v1/nodes/heartbeat', { nodeId, activeSessions: 0 })
  usedPorts.add(port)
  process.stdout.write(`created ${nodeId} on 127.0.0.1:${String(port)}\n`)
  return nodeId
}

/**
 * 排空并移除一个自动节点。
 * @param nodeId - 节点 id。
 */
async function removeNode(nodeId) {
  const drained = await control('/v1/nodes/drain', { nodeId })
  if (drained.status !== 200 && drained.status !== 409) {
    throw new Error(`drain ${nodeId} failed: ${JSON.stringify(drained.body)}`)
  }
  const removed = await docker(['rm', '-f', nodeId])
  if (removed.code !== 0) throw new Error(`docker rm ${nodeId} failed: ${removed.out.slice(-300)}`)
  await docker(['volume', 'rm', '-f', `${nodeId}-data`])
  process.stdout.write(`removed ${nodeId} (drain ${String(drained.status)})\n`)
}

async function main() {
  const policy = policyFromEnv()
  const decision = await control('/v1/nodes/scale-plan', policy)
  if (decision.status !== 200) throw new Error(`scale-plan failed: ${JSON.stringify(decision.body)}`)
  const plan = decision.body.decision
  process.stdout.write(`${JSON.stringify(plan)}\n`)
  if (!EXECUTE || plan.action === 'hold') return

  const nodes = (await control('/v1/nodes')).body.nodes
  if (plan.action === 'scale-out') {
    const usedPorts = new Set()
    for (let index = 0; index < plan.delta; index += 1) {
      const nodeId = `${PREFIX}${randomUUID().slice(0, 8)}`
      const port = await freePort(usedPorts)
      await createNode(nodeId, port, usedPorts)
    }
    return
  }

  // 缩容：只回收自动创建且零负载的节点；基线节点永不删除。
  const idle = nodes.filter(node => node.nodeId.startsWith(PREFIX)
    && node.state === 'active' && !node.stale
    && node.load.activeSessions === 0 && (node.load.queueDepth ?? 0) === 0)
  const targets = idle.slice(0, -plan.delta)
  if (targets.length === 0) {
    process.stdout.write('no idle auto nodes to remove; run drain first\n')
    return
  }
  for (const node of targets) await removeNode(node.nodeId)
}

main().catch(error => {
  process.stderr.write(`autoscale: ${String(error)}\n`)
  process.exitCode = 1
})
