/**
 * 用量折叠：从会话事件流派生按会话的请求数、token 与每次请求耗时（不落第二副本）。
 *
 * 口径（框架设计 §6.2、需求 §9 用量统计）：
 * - `requests` 只计**成功装配且带 provider 上报 `usage`** 的 `assistant/message`；
 *   失败/取消的模型尝试（`assistant/attempt`）与无 `usage` 的消息不计；
 * - 每次请求的耗时 = 同 turn/step 的 `step/start` → `assistant/message` 时间差（只对计入
 *   `requests` 的消息取值）；`durationMs` 是该分布的求和，不单独记第二份；
 * - `inputTokens`/`outputTokens` 取 provider 上报值，`totalTokens` 优先用上报的
 *   `totalTokens`（含缓存命中），缺省时回落 input + output。
 *
 * **与原生 `session-stats` 的分工**：原生的 `sessionStats` 是运行面板会话统计条用的实时投影
 * （turns/steps/llmMs/toolMs/ttft/decode，无 token 总量、无逐请求分布，且只覆盖活的投影注册表）。
 * 管理面用量统计要的是「最近 N 个历史会话」的 token 总量与请求耗时分布（p50/p95），两者维度
 * 不同；历史会话只能从持久化日志折出，且投影缓存也没有 token 字段。故这里保留唯一一份折叠，
 * 只产出原生单元没有的维度，不另建事件通道。
 *
 * 历史会话从 `ctx.sessionPersistence` 的只读句柄读取：事件流是唯一真源，进程重启后
 * 仍可统计（不再依赖 `ctx.sessions.list()` 的活会话集合）。日志按窗口分页读、逐页折叠，
 * 不一次性持有整份日志。
 *
 * @module @soloengine/host/usage
 */

import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type { UsageRow } from '@soloengine/framework'

/** 单次读取的事件窗口（与归属台账重建同一分页口径）。 */
const READ_WINDOW = 1000

/** 一个 step 的起始时刻（按 turn/step 配对，`assistant/message` 关闭）。 */
interface OpenStep {
  turn: number
  step: number
  time: number
}

/** 折叠累加器（逐块推进，避免一次性持有整份日志）。 */
interface UsageFold {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
  durationsMs: number[]
  open: OpenStep | null
}

/** 空累加器。 */
function createFold(): UsageFold {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, durationsMs: [], open: null }
}

/**
 * 把一块事件推进累加器（跨块保留未关闭的 step）。
 * @param fold - 累加器。
 * @param events - 下一块事件（seq 升序）。
 */
function consume(fold: UsageFold, events: readonly SessionEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'step/start':
        fold.open = { turn: event.data.turn, step: event.data.step, time: event.time }
        break
      case 'assistant/message': {
        const usage = event.data.usage
        const step = fold.open !== null && fold.open.turn === event.data.turn && fold.open.step === event.data.step
          ? fold.open
          : null
        if (usage !== undefined) {
          fold.requests += 1
          fold.inputTokens += usage.inputTokens
          fold.outputTokens += usage.outputTokens
          fold.totalTokens += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
          if (step !== null) {
            fold.durationsMs.push(Math.max(0, event.time - step.time))
          }
        }
        fold.open = null
        break
      }
      case 'step/end':
        fold.open = null
        break
      default:
        break
    }
  }
}

/**
 * 把累加器落成一行用量。
 * @param sessionKey - 会话键。
 * @param fold - 累加器。
 * @returns 派生用量行。
 */
function rowOf(sessionKey: string, fold: UsageFold): UsageRow {
  return {
    sessionKey,
    inputTokens: fold.inputTokens,
    outputTokens: fold.outputTokens,
    totalTokens: fold.totalTokens,
    requests: fold.requests,
    durationMs: fold.durationsMs.reduce((total, value) => total + value, 0),
    durationsMs: fold.durationsMs,
  }
}

/**
 * 把一段会话事件折成一行用量。
 * @param sessionKey - 会话键（台账里的 `session_key`）。
 * @param events - 该会话的完整事件日志（seq 升序）。
 * @returns 派生用量行；无任何带 usage 的请求时各计数为 0。
 */
export function foldUsage(sessionKey: string, events: readonly SessionEvent[]): UsageRow {
  const fold = createFold()
  consume(fold, events)
  return rowOf(sessionKey, fold)
}

/**
 * 从持久化会话日志读取并折叠一行用量（只读句柄，不取写所有权、不改变存储）。
 * @param persistence - 已挂载的持久化服务。
 * @param sessionKey - 会话键（与存储里的 session id 同值）。
 * @returns 派生用量行。
 */
export async function readStoredUsage(persistence: SessionPersistence, sessionKey: string): Promise<UsageRow> {
  const handle = await persistence.open(SessionId(sessionKey), 'read')
  try {
    const fold = createFold()
    for (let offset = 0; ;) {
      const slice = await handle.read(offset, READ_WINDOW)
      consume(fold, slice.events)
      if (slice.events.length < READ_WINDOW) break
      offset += slice.events.length
    }
    return rowOf(sessionKey, fold)
  } finally {
    await handle.close()
  }
}
