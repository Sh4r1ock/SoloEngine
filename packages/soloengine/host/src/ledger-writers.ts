/**
 * 会话归属直写与会话收尾（PRD-06 归属台账；PRD-09 文件变更台账）。
 *
 * 这里是 harness 原生广播与业务库之间的唯一写入面：
 * - `session/event` → `events` 表（唯一写入方；非本实例发起的会话不写）；
 * - 工具呈现意图派生（`soloengine/follow` log-only 事件）；
 * - 画布删除后的会话收尾（停止 → 销毁 → 删日志）。
 *
 * @module @soloengine/host/ledger-writers
 */

import type { Context } from '@deepseek-ai/cordis'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// 模块声明：`ctx.on('session/event' | 'tool/call')`、`ctx.agents`、`ctx.tools` 在类型上可见。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type { FrameworkRuntime, SessionLedger } from '@soloengine/framework'
import type { FollowIntentRecord, FollowLocation } from '@soloengine/types'
import type { NodeAttribution } from './run-driver.ts'

/**
 * 归属直写：会话事件 → `events` 表（唯一写入方；非本实例发起的会话不写）。
 * @param ctx - 插件上下文（事件广播与日志）。
 * @param shared - 归属映射、最近 assistant 序号与归属台账。
 */
export function attachLedgerWriters(
  ctx: Context,
  shared: {
    attribution: Map<string, NodeAttribution>
    lastAssistantSeq: Map<string, number>
    ledger: SessionLedger
  },
): void {
  const { attribution, lastAssistantSeq, ledger } = shared
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    void (async () => {
      const key = String(session.id)
      // 归属台账查找也在守卫之内：库在收尾期关闭/抖动时，这个后台任务不能以未处理的
      // rejection 拖垮整个进程（事件广播是同步的，调用方不会等这个 Promise）。
      try {
        const ledgerRow = await ledger.byKey(key)
        if (ledgerRow === undefined) return
        if (event.type === 'assistant/message') lastAssistantSeq.set(key, Number(event.seq))
        const node = attribution.get(key) ?? {
          agentId: session.header.parentSession === undefined ? key : String(session.header.parentSession),
          parentAgentId: session.header.parentSession === undefined ? null : String(session.header.parentSession),
        }
        const parentSeq = lastAssistantSeq.get(key)
        await ledger.appendEvent(ledgerRow.id, Number(event.seq), {
          agent_id: node.agentId,
          ...node.parentAgentId === null ? {} : { parent_agent_id: node.parentAgentId },
          ...event.type !== 'tool/result' || parentSeq === undefined ? {} : { parent_message_id: parentSeq },
        })
        if (event.type === 'turn/end') {
          const reason = event.data.reason.kind
          await ledger.setStatus(ledgerRow.id, reason === 'completed' ? 'completed' : 'stopped', {
            completedAt: Date.now(),
          })
        }
      } catch (error) {
        ctx.logger.error(`soloengine: writing the event ledger row for ${key}#${String(event.seq)} failed`)
        ctx.logger.error(error)
      }
    })()
  })
  ctx.on('session/disposed', (session: Session) => {
    void (async () => {
      const key = String(session.id)
      try {
        const row = await ledger.byKey(key)
        if (row === undefined) return
        if (row.status === 'running' || row.status === 'pending') {
          await ledger.setStatus(row.id, 'completed', { completedAt: Date.now() })
        }
      } catch (error) {
        ctx.logger.error(`soloengine: closing the event ledger row for ${key} failed`)
        ctx.logger.error(error)
      }
    })()
  })
}

/**
 * 工具呈现意图派生（PRD-08 FR-OPS-004 / FR-OPS-011）。
 *
 * 官方契约把 `presentCall` / `presentResult` 定位为 **Host-local consumers** 的纯函数
 * （内置 Web Client 不消费它们），故本层在 Host 侧消费工具自己的呈现意图：
 * 监听 `tool/call` → `ctx.tools.get(name)` 取定义 → `presentCall(args)` 得卡片判别联合 →
 * 把「需要跟随到哪里」写成一条 log-only 的 `soloengine/follow` 持久事件。
 *
 * 写入放在事件广播之后（`setImmediate`），避免在广播内重入追加；
 * 分派不依赖任何「工具名 → 面板」映射表，新工具（含第三方 MCP 工具）自带定位元数据即生效。
 *
 * @param ctx - 已注入 `tools` 的上下文。
 */
export function attachFollowLayer(ctx: Context): void {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'tool/call') return
    // 工具定义按**调用方作用域**解析（内置工具注册在 agent 作用域，全局视图看不到）；
    // 作用域键取自该会话的活 agent——与执行时 `resolveExecution(name, scope)` 同源，
    // 因此呈现意图与真实执行的是同一份定义。
    const agent = ctx.agents.get(session.id)
    const definition = ctx.tools.get(event.data.name, agent === undefined ? undefined : scopeOf(agent.ctx))
    if (definition?.presentCall === undefined) return
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data.arguments)
    } catch {
      return
    }
    let view: ReturnType<NonNullable<typeof definition.presentCall>>
    try {
      view = definition.presentCall(parsed)
    } catch (error) {
      ctx.logger.error(`soloengine: presentCall for ${event.data.name} threw`)
      ctx.logger.error(error)
      return
    }
    if (view === undefined) return
    const locations: FollowLocation[] = []
    if ('locations' in view && Array.isArray(view.locations)) {
      for (const location of view.locations) {
        locations.push({ path: location.path, ...location.line === undefined ? {} : { line: location.line } })
      }
    }
    if (view.card === 'diff') {
      for (const diff of view.diffs) locations.push({ path: diff.path })
    }
    const record: FollowIntentRecord = {
      callId: String(event.data.callId),
      toolName: event.data.name,
      card: view.card,
      locations,
      turn: event.data.turn,
      step: event.data.step,
    }
    setImmediate(() => {
      try {
        session.append('soloengine/follow', record)
      } catch (error) {
        ctx.logger.error(`soloengine: writing the follow intent for ${record.callId} failed`)
        ctx.logger.error(error)
      }
    })
  })
}

/**
 * 画布被删除后的会话收尾：先停掉仍在跑的运行，再清理会话日志目录（画布删除的一部分）。
 *
 * 顺序与理由：会话日志由 harness 持有写句柄——活会话必须先停（停止原因落日志），句柄释放后再删
 * 目录；释放是异步的，故按小步重试。每次动作打印一行，删掉了什么在日志里可见。
 *
 * 停止走 `runs.cancelDetached` 而非 `runs.cancel`：这一步发生在业务行（项目/会话/事件）级联删除
 * **之后**，会话行已不存在，`cancel` 的归属查询必然失败且停不掉活会话。归属由级联自身确立
 * （键集合取自该次删除的返回值，不接受外部输入）。
 *
 * 停掉之后还要**销毁会话**（`runs.retireDetached`）：只 `cancel` 会让 agent 停在 idle，写句柄仍持着
 * 会话，收尾批次的实时写入与下面的删行并发时会撞外键（实测 `append failed ... FOREIGN KEY constraint`）。
 * 销毁等停止循环、冲掉持久化屏障、移除会话并触发原生 `session/disposed`，此后才轮到删日志。
 *
 * @param ctx - 插件上下文（读 `sessions` 判断活跃）。
 * @param runtime - 框架层运行时（`runs.cancelDetached` / `runs.retireDetached` 提供停止与销毁语义）。
 * @param sessionKeys - 被删除的会话键。
 */
export async function retireSessionsAfterCanvasDelete(
  ctx: Context,
  runtime: FrameworkRuntime,
  sessionKeys: readonly string[],
): Promise<void> {
  const live = ctx.get('sessions') as { get?: (id: string) => unknown } | undefined
  const sleep = async (ms: number): Promise<void> => { await new Promise(done => setTimeout(done, ms)) }
  for (const key of sessionKeys) {
    if (live?.get?.(key) === undefined) continue
    try {
      await runtime.runs.cancelDetached(key, 'the canvas was deleted')
      console.log(`soloengine: run stopped because its canvas was deleted (${key})`)
    } catch (error) {
      console.log(`soloengine: stopping the run for ${key} after its canvas was deleted failed (${String(error)})`)
    }
    try {
      await runtime.runs.retireDetached(key)
      console.log(`soloengine: live session disposed after its canvas was deleted (${key})`)
    } catch (error) {
      console.log(`soloengine: disposing the live session ${key} after its canvas was deleted failed (${String(error)})`)
    }
  }
  // 日志权威在 ctx.sessionPersistence：SQLite/PG 形态把正文写在业务库，必须先按会话键删表行。
  // JSONL 形态（上游原件）没有该扩展方法，退回目录扫描。
  const persistence = ctx.get('sessionPersistence') as
    | { deleteSessions?: (keys: readonly string[]) => Promise<void> }
    | undefined
  if (persistence?.deleteSessions !== undefined) {
    await persistence.deleteSessions(sessionKeys)
    for (const key of sessionKeys) console.log(`soloengine: session log removed with its canvas (${key})`)
    return
  }
  const home = process.env.DSH_HOME ?? join(process.env.SOLOENGINE_ROOT ?? process.cwd(), 'data', 'dsh-home')
  const root = join(home, 'sessions')
  for (const key of sessionKeys) {
    const dir = findSessionDir(root, key)
    if (dir === undefined) {
      console.log(`soloengine: no session log directory for ${key} (nothing to remove)`)
      continue
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true })
        console.log(`soloengine: session log removed with its canvas (${key})`)
        break
      } catch (error) {
        // Windows 下句柄释放滞后：小步重试；仍失败即如实报出（不静默）。
        if (attempt === 9) console.log(`soloengine: removing the session log for ${key} failed (${String(error)})`)
        else await sleep(300)
      }
    }
  }
}

/**
 * 在会话日志根下按目录名查找一个会话的日志目录（harness 的目录形态是
 * `<root>/<cwd 摘要>/<sessionKey>/session.*`）。
 *
 * @param root - 会话日志根（`<DSH_HOME>/sessions`）。
 * @param sessionKey - 会话键。
 * @returns 目录绝对路径，或 `undefined`。
 */
function findSessionDir(root: string, sessionKey: string): string | undefined {
  const stack = [root]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const dir = stack.pop() as string
    if (visited.has(dir)) continue
    visited.add(dir)
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      let stat: ReturnType<typeof lstatSync>
      try {
        stat = lstatSync(path)
      } catch {
        continue
      }
      // 会话日志目录是真实目录；不跟随符号链接，避免链接环与越界扫描。
      if (!stat.isDirectory()) continue
      if (entry === sessionKey) return path
      stack.push(path)
    }
  }
  return undefined
}
