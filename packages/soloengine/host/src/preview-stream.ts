/**
 * 画布编辑器实时预览的轻量日志（PRD-02 FR-CANVAS-017）。
 *
 * 「轻量」的含义是**刻意只承载两类内容**：助手的纯文本流与工具的执行状态，不复刻运行面板
 * 的卡片体系（无审批卡、无引用树、无投影药丸）。它服务的是「设计期随手试一下」这条短路径，
 * 完整现场仍旧是 `/run/:agenticFlowId` 那一棵原生客户端树。
 *
 * 数据源与既有归属直写同源：监听原生 `session/event` 广播就地折叠，**不另建推送通道**、
 * 不另存一份副本（PRD-12 FR-STO-008）。因此它天然只覆盖本进程存活期间发生的事件——
 * 进程重启后的历史不在预览里，那属于完整运行面板的职责。
 *
 * **与原生投影的分工**：原生 `sessionStats` 只统计回合/步骤与耗时的数值，不承载助手文本流与
 * 工具阶段；画布编辑器要的是「设计期随手试一下」的轻量日志，故本模块是原生事件广播的明确
 * 轻量消费端（读一条原生事件、折一条预览条目），既不是第二事件通道，也不与运行面板的卡片
 * 体系重复。
 *
 * @module @soloengine/host/preview-stream
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FrameworkRuntime } from '@soloengine/framework'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** 预览条目种类：文本 / 工具 / 状态 / 错误。 */
export type PreviewEntryKind = 'text' | 'tool' | 'status' | 'error'

/** 工具条目的阶段。 */
export type PreviewToolPhase = 'start' | 'result' | 'error'

/** 一条预览条目（轻量：只有呈现所需的字段）。 */
export interface PreviewEntry {
  /** 事件序号（增量读取的水位线）。 */
  seq: number
  /** 条目种类。 */
  kind: PreviewEntryKind
  /** 文本（文本条目与工具结果的输出）。 */
  text?: string
  /** 工具名（工具条目）。 */
  toolName?: string
  /** 工具阶段（工具条目）。 */
  phase?: PreviewToolPhase
  /** 回合号（便于把日志按回合分段）。 */
  turn?: number
  /** 会话事件的写入时刻（epoch 毫秒；日志视图的时间列）。 */
  at?: number
}

/** 单个会话保留的条目上限（超出丢弃最早的，预览不需要长历史）。 */
const ENTRY_LIMIT = 500
/** 工具结果文本的截断长度（轻量预览不承载超长输出）。 */
const RESULT_TEXT_LIMIT = 2000

/** 一个会话的预览缓冲。 */
interface PreviewBuffer {
  entries: PreviewEntry[]
  /** 最后一次观测到的运行状态。 */
  status: string
  /**
   * callId → 工具名。
   *
   * `tool/result` 事件**不带工具名**（实测形状：`{ turn, step, message: { source: { kind: 'tool',
   * callId }, content: [{ type: 'tool-result', isError, content }] }, meta }`），名字只在先行的
   * `tool/call` 里。故这里按 callId 记名，结果事件回来时再对上——不猜、不放占位名。
   */
  calls: Map<string, string>
}

/**
 * 预览流：按会话键折叠轻量条目。
 *
 * 只有一个方法对事件源开放（`record`），一个对读取方开放（`since`）——写入与读取都不绕过
 * 原生事件流本身。
 */
export class PreviewStream {
  private readonly buffers = new Map<string, PreviewBuffer>()

  /**
   * 折叠一条原生会话事件。
   * @param sessionKey - 会话键。
   * @param event - 原生会话事件。
   */
  record(sessionKey: string, event: SessionEvent): void {
    const buffer = this.buffers.get(sessionKey) ?? { entries: [], status: 'pending', calls: new Map<string, string>() }
    const entry = this.fold(event, buffer)
    if (entry !== undefined) {
      buffer.entries.push({ ...entry, at: event.time })
      if (buffer.entries.length > ENTRY_LIMIT) buffer.entries.splice(0, buffer.entries.length - ENTRY_LIMIT)
    }
    buffer.status = this.statusOf(event, buffer.status)
    this.buffers.set(sessionKey, buffer)
  }

  /**
   * 把一条原生事件折叠为预览条目（不关心的事件返回 undefined）。
   * @param event - 原生会话事件。
   * @param buffer - 该会话的缓冲（工具名需要跨事件按 callId 记名）。
   * @returns 预览条目或 undefined。
   */
  private fold(event: SessionEvent, buffer: PreviewBuffer): PreviewEntry | undefined {
    const seq = Number(event.seq)
    if (event.type === 'assistant/message') {
      const content = (event.data as { message?: { content?: unknown } }).message?.content
      const text = this.textsOf(content)
      if (text.trim() === '') return undefined
      return { seq, kind: 'text', text, ...this.turnOf(event) }
    }
    if (event.type === 'tool/call') {
      const data = event.data as { name?: unknown; callId?: unknown }
      const name = typeof data.name === 'string' ? data.name : ''
      if (name === '') return undefined
      const callId = typeof data.callId === 'string' ? data.callId : ''
      if (callId !== '') buffer.calls.set(callId, name)
      return { seq, kind: 'tool', toolName: name, phase: 'start', ...this.turnOf(event) }
    }
    if (event.type === 'tool/result') {
      // 结果事件的形状与原生工具卡同源：`message.content` 是内容块数组、失败位在
      // `message.isError`（不在内容块上）；`source.callId` 与此前 `tool/call` 配对。
      const message = (event.data as {
        message?: { source?: { callId?: unknown }; content?: unknown; isError?: unknown }
      }).message
      const sourceCallId = message?.source?.callId
      const callId = typeof sourceCallId === 'string' ? sourceCallId : ''
      const name = buffer.calls.get(callId)
      if (name === undefined && callId === '') return undefined
      const text = this.textsOf(message?.content)
      return {
        seq,
        kind: 'tool',
        ...name === undefined ? {} : { toolName: name },
        phase: message?.isError === true ? 'error' : 'result',
        ...text === '' ? {} : { text: text.slice(0, RESULT_TEXT_LIMIT) },
        ...this.turnOf(event),
      }
    }
    if (event.type === 'turn/start') {
      return { seq, kind: 'status', text: `turn ${String(this.turnOf(event).turn ?? '')} started`, ...this.turnOf(event) }
    }
    if (event.type === 'turn/end') {
      const reason = (event.data as { reason?: { kind?: unknown } | string }).reason
      const kind = typeof reason === 'string' ? reason : reason?.kind
      const label = typeof kind === 'string' ? kind : 'unknown'
      // 失败回合以「错误」条目呈现，把停止原因直接摆在日志里（不静默、不含糊）。
      const failed = label === 'error' || label === 'failed'
      return {
        seq,
        kind: failed ? 'error' : 'status',
        text: `turn ended (${label})`,
        ...this.turnOf(event),
      }
    }
    return undefined
  }

  /** 取事件的回合号（没有就不带该字段，不猜默认值）。 */
  private turnOf(event: SessionEvent): { turn?: number } {
    const turn = (event.data as { turn?: unknown }).turn
    return typeof turn === 'number' ? { turn } : {}
  }

  /** 把内容块数组拍平成文本（只取纯文本块，轻量预览不做结构化渲染）。 */
  private textsOf(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .filter((block): block is { type: 'text'; text: string } =>
        typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text')
      .map(block => block.text)
      .join('')
  }

  /** 从事件更新运行状态（只在明确的收尾事件上推进）。 */
  private statusOf(event: SessionEvent, current: string): string {
    if (event.type === 'turn/start') return 'running'
    if (event.type === 'turn/end') {
      const reason = (event.data as { reason?: { kind?: unknown } | string }).reason
      const kind = typeof reason === 'string' ? reason : reason?.kind
      const label = typeof kind === 'string' ? kind : 'unknown'
      // 正常完成与「还没跑过」必须分开：画布预览面板要显示「已完成」而不是「未运行」。
      if (label === 'completed') return 'completed'
      // 失败与「已停止」分开报：预览要能区分「我说停的」与「它自己挂的」。
      return label === 'error' || label === 'failed' ? 'failed' : 'stopped'
    }
    return current
  }

  /**
   * 增量读取一个会话的预览条目。
   * @param sessionKey - 会话键。
   * @param after - 只返回 seq 大于该值的条目（首次传 0）。
   * @returns 条目、水位线与运行状态。
   */
  since(sessionKey: string, after: number): { entries: PreviewEntry[]; lastSeq: number; status: string } {
    const buffer = this.buffers.get(sessionKey)
    if (buffer === undefined) return { entries: [], lastSeq: after, status: 'unknown' }
    const entries = buffer.entries.filter(entry => entry.seq > after)
    const lastSeq = buffer.entries.at(-1)?.seq ?? after
    return { entries, lastSeq, status: buffer.status }
  }

  /**
   * 丢弃一个会话的缓冲（会话结束或画布删除后不再占用内存）。
   * @param sessionKey - 要丢弃缓冲的会话键。
   */
  drop(sessionKey: string): void {
    this.buffers.delete(sessionKey)
  }
}

/**
 * 把预览流接进原生事件广播，并以前缀内 REST 暴露给画布编辑器。
 *
 * 鉴权与归属沿用既有规则：Bearer 令牌 + 运行台账归属校验（`sessionKey → ledger → user_id`），
 * 与 `/sessions/:key/*` 其它路由同一条判据；不在台账里的会话一律 404（不静默、不跨越用户）。
 *
 * @param ctx - 已注入 `sessions` 的上下文。
 * @param runtime - 框架层运行时。
 * @param stream - 预览流（由调用方持有，便于与归属直写共享同一生命周期）。
 */
export function mountPreviewStream(ctx: Context, runtime: FrameworkRuntime, stream: PreviewStream): void {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    void (async () => {
      // 只为本实例发起的会话记账：归属台账是唯一判据，避免为无关会话白攒内存。
      if (await runtime.runs.ledger.byKey(String(session.id)) === undefined) return
      stream.record(String(session.id), event)
    })()
  })
  // 会话销毁即丢弃缓冲：否则每个跑过的会话都永久留下最多 500 条文本条目（内存单调增长）。
  ctx.on('session/disposed', (session: Session) => {
    stream.drop(String(session.id))
  })

  runtime.mountAuthenticated(
    {
      id: 'preview-stream',
      method: 'get',
      path: '/sessions/:key/preview',
      summary: '画布编辑器实时预览：纯文本流与工具状态的轻量日志（增量读取）',
    },
    async (req) => {
      const key = req.params.key ?? ''
      const row = await runtime.runs.ledger.byKey(key)
      if (row === undefined) {
        return {
          status: 404,
          body: {
            ok: false,
            error: {
              code: 'SESSION_NOT_IN_LEDGER',
              message: `session ${key} has no run ledger row; the preview serves runs of this instance only`,
            },
          },
        }
      }
      if (row.user_id !== req.user.id) {
        return {
          status: 403,
          body: { ok: false, error: { code: 'FORBIDDEN', message: 'the session belongs to another user' } },
        }
      }
      const raw = req.query.after
      const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : 0
      const after = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
      const view = stream.since(key, after)
      return {
        body: {
          ok: true,
          sessionKey: key,
          status: view.status,
          lastSeq: view.lastSeq,
          entries: view.entries,
        },
      }
    },
  )
}
