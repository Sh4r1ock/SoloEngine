/**
 * 运行域服务（PRD-06 数据需求 + PRD-12 FR-STO-008 直写直读路径）。
 *
 * 职责：
 * - 现场编译画布（复用 `@soloengine/agent-compiler`，与打包同一份编译逻辑）；
 * - 建立会话归属行并把「建 mainagent / 发提示 / 取消 / 用量派生」交给**运行驱动**——
 *   由 `@soloengine/host` 注入（唯一同时拥有框架层与 harness 的落点，见 §6.4 注入表）；
 * - 会话与事件的读路径单表直读（按用户过滤）；
 * - 创造模式审计落 `creator_audit`（PRD-06 FR-ENG-030 / PRD-10 FR-SEC-014）。
 *
 * 本模块不复制任何会话运行时数据（消息正文/用量/工具流以事件流为唯一真源）。
 *
 * @module @soloengine/framework/modules/runs
 */

import type { DatabaseSync } from 'node:sqlite'
import { compileCanvas, CompileError } from '@soloengine/agent-compiler'
import type { CompileResult } from '@soloengine/types'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import { newId } from '../auth/index.ts'
import { SessionLedger, type EventLedgerRow, type SessionLedgerRow } from './sessions.ts'

/** 显式会话键的字符约束：会话键会成为会话日志目录名，故只允许安全字符。 */
const EXPLICIT_SESSION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/**
 * 校验调用方指定的会话键（固定入口直达用；PRD-07 测试流程「运行 API 支持指定 sessionKey」）。
 * @param value - 请求携带的会话键。
 * @returns 校验通过的会话键。
 */
function requireExplicitSessionKey(value: string): string {
  if (!EXPLICIT_SESSION_KEY.test(value)) {
    throw new FrameworkError(422, 'SESSION_KEY_INVALID',
      `sessionKey "${value}" must match ${EXPLICIT_SESSION_KEY.source} (it becomes a session-log directory name)`)
  }
  return value
}

/** 运行驱动的启动输入。 */
export interface RunStartInput {
  /** 会话归属键（与 dsh SessionId 同值）。 */
  sessionKey: string
  /** 归属用户。 */
  userId: string
  /** 画布数据（已校验归属）。 */
  canvasData: unknown
  /** 运行项目目录（沙箱根 / agent cwd）。 */
  cwd: string
  /** 编译产物（现场生成，不落文件）。 */
  compiled: CompileResult
  /** 画布全局设置（运行模式等）。 */
  settings: { run_mode?: string; live_follow?: boolean }
  /** 入口节点的模型路由目标（provider = `soloengine-<id>`，model = 该行模型名）。 */
  mainAgent: {
    agentId: string
    provider: string
    model: string
    maxTokens: number | null
  }
}

/** 运行驱动：harness 侧能力的注入面（由 host 插件实现）。 */
export interface RunDriver {
  /** 建 mainagent 并就位（不推进对话）。 */
  start(input: RunStartInput): Promise<{ mainAgentId: string }>
  /** 以用户消息推进循环（排队语义：运行中进入下一 turn）。 */
  prompt(sessionKey: string, text: string): Promise<{ queued: boolean }>
  /** 取消当前运行（停止原因落日志）。 */
  cancel(sessionKey: string, reason: string): Promise<void>
  /** 当前进程内的活会话状态。 */
  live(sessionKey: string): { live: boolean; agentId: string | null; status: string }
  /** 用量派生（从事件流折叠，不落第二副本）。 */
  usage(): Promise<UsageRow[]>
  /**
   * MCP 热同步（PRD-05 FR-MCP-005）：把活作用域同步到当前 MCP 行状态。
   *
   * 启停与单工具开关都要**免重启**生效，故由 host 周期调用本方法；返回本次同步的作用域数，
   * 供调用方观察（0 表示当前没有活作用域，属正常）。
   */
  syncMcpMounts(): Promise<number>
}

/** 用量派生行（按会话）。 */
export interface UsageRow {
  sessionKey: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
}

/** 会话视图（归属行 + 活状态）。 */
export interface RunSessionView {
  session_key: string
  user_id: string
  agentic_flow_id: string
  run_project_id: string
  llm_config_id: string | null
  status: SessionLedgerRow['status']
  error: string | null
  created_at: number
  duration_ms: number | null
  live: boolean
  main_agent_id: string | null
  /** 面板直达地址（前端路由）。 */
  panel_path: string
}

/** 运行域服务。 */
export class RunService {
  private readonly raw: DatabaseSync
  private readonly runtime: FrameworkRuntime
  /** 会话台账（归属索引行）。 */
  readonly ledger: SessionLedger
  private driver: RunDriver | undefined
  /** 会话 → 画布节点归属解析器（由 host 注入）。 */
  private agentResolver: ((sessionKey: string) => string | undefined) | undefined
  /** 会话 → 回合级恢复点 id（主干 changeLedger 产出）。 */
  private readonly restorePoints = new Map<string, string>()

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
    this.raw = runtime.db.raw
    this.ledger = new SessionLedger(this.raw)
  }

  /** 注入运行驱动（由 host 插件在挂载时调用；未注入即运行接口不可用，直接报错）。 */
  setDriver(driver: RunDriver): void {
    this.driver = driver
  }

  /**
   * 登记「会话 → 画布节点」归属解析器（由 host 运行驱动在挂载时注入）。
   *
   * 变更台账的 `agent_id` 归属、运行诊断与创造模式审计都问同一处，避免各自派生第二份。
   * @param resolver - 会话键 → 画布节点 id（无归属返回 `undefined`）。
   */
  setAgentResolver(resolver: (sessionKey: string) => string | undefined): void {
    this.agentResolver = resolver
  }

  /**
   * 取会话归属的画布节点 id。
   * @param sessionKey - 会话键。
   * @returns 画布节点 id，或 `null`（未登记/无归属）。
   */
  agentIdOf(sessionKey: string): string | null {
    return this.agentResolver?.(sessionKey) ?? null
  }

  /**
   * 登记回合级恢复点 id（由 host 的变更记录模块在主干 `changeLedger.create` 成功后调用）。
   * @param sessionKey - 会话键。
   * @param restorePointId - 主干插件返回的恢复点 id。
   */
  setRestorePoint(sessionKey: string, restorePointId: string): void {
    this.restorePoints.set(sessionKey, restorePointId)
  }

  /**
   * 取会话最近的回合级恢复点 id（撤回前的救援点与哈希校验由主干据此进行）。
   * @param sessionKey - 会话键。
   * @returns 恢复点 id，或 `null`。
   */
  restorePointOf(sessionKey: string): string | null {
    return this.restorePoints.get(sessionKey) ?? null
  }

  /** 取驱动或结构化报错（fail loud，不静默降级）。 */
  private requireDriver(): RunDriver {
    if (this.driver === undefined) {
      throw new FrameworkError(503, 'RUN_DRIVER_ABSENT', 'the harness run driver is not mounted; /runs is unavailable')
    }
    return this.driver
  }

  /**
   * 现场编译画布（fail loud）。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param cwd - 运行项目目录。
   * @returns 编译产物与画布行。
   */
  compile(userId: string, canvasId: string, cwd: string): { compiled: CompileResult; settings: { run_mode?: string; live_follow?: boolean }; canvasData: unknown } {
    const canvas = this.runtime.canvas.byId(userId, canvasId)
    if (canvas === undefined) {
      throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    }
    let parsed: unknown
    try {
      parsed = canvas.canvas_data === null ? { nodes: [], edges: [], settings: {} } : JSON.parse(canvas.canvas_data)
    } catch (error) {
      throw new FrameworkError(422, 'CANVAS_CORRUPT', `canvas ${canvasId} data is not valid JSON: ${String(error)}`)
    }
    const canvasData = parsed as { nodes?: unknown; edges?: unknown; settings?: { run_mode?: string; live_follow?: boolean } }
    let compiled: CompileResult
    try {
      compiled = compileCanvas({
        canvas: canvasData as never,
        cwd,
        resolveModelRoute: (modelRef) => {
          const row = this.runtime.models.byId(userId, modelRef)
          if (row === undefined) return { route: '', valid: false }
          if (row.is_active !== 1) return { route: `soloengine-${row.id}`, valid: false }
          return { route: `soloengine-${row.id}`, valid: true }
        },
      })
    } catch (error) {
      if (error instanceof CompileError) {
        throw new FrameworkError(422, error.code, error.message)
      }
      throw error
    }
    return { compiled, settings: canvasData.settings ?? {}, canvasData: parsed }
  }

  /**
   * 编译期提示：节点引用了「被停用或不存在」的技能 / MCP 服务器（PRD-02 §边界表）。
   *
   * 口径按 PRD 自己的标注「[待确认：提示粒度]」：这里选择**实例日志提示**（运行诊断可见、
   * 不阻断运行）——模型配置被删是另一条边界（fail loud 拒绝运行），技能/MCP 被停用只影响
   * 能力面，运行仍应可发起，挂载层自然不会把停用资产挂进作用域（见 host 的 MCP 挂载层）。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param compiled - 编译产物。
   */
  private noticeUnavailableRefs(userId: string, canvasId: string, compiled: CompileResult): void {
    for (const spec of compiled.agents) {
      for (const name of spec.mcpServers) {
        const row = this.runtime.mcp.byNameScoped(userId, name)
        if (row === undefined) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references MCP server "${name}" that does not exist or is not visible; its tools will not be mounted`)
        } else if (row.is_active !== 1) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references MCP server "${name}" that is disabled; its tools will not be mounted (enable it or remove the reference)`)
        }
      }
      for (const name of spec.skills) {
        const rows = this.runtime.skills.list(userId)
        const row = rows.find(item => item.name === name)
        if (row === undefined) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references skill "${name}" that does not exist or is not visible; it stays unavailable to this agent`)
        } else if (row.is_active !== 1) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references skill "${name}" that is disabled; it stays unavailable to this agent (enable it or remove the reference)`)
        }
      }
    }
  }

  /**
   * 发起一次运行：现场编译 → 建归属行 → 建 mainagent。
   * @param userId - 归属用户。
   * @param input - 画布、运行项目与可选的显式会话键（固定入口直达用）。
   * @returns 会话视图。
   */
  async createRun(
    userId: string,
    input: { canvasId: string; projectId: string; sessionKey?: string },
  ): Promise<RunSessionView> {
    const driver = this.requireDriver()
    const project = this.runtime.canvas.projectById(userId, input.projectId)
    if (project === undefined) {
      throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${input.projectId} not found`)
    }
    if (project.agentic_flow_id !== input.canvasId) {
      throw new FrameworkError(422, 'PROJECT_CANVAS_MISMATCH',
        `run project ${project.id} belongs to canvas ${project.agentic_flow_id}, not ${input.canvasId}`)
    }
    const { compiled, settings, canvasData } = this.compile(userId, input.canvasId, project.folder_path)
    this.noticeUnavailableRefs(userId, input.canvasId, compiled)
    const sessionKey = input.sessionKey === undefined
      ? SessionLedger.newKey()
      : requireExplicitSessionKey(input.sessionKey)
    if (this.ledger.byKey(sessionKey) !== undefined) {
      throw new FrameworkError(409, 'SESSION_KEY_TAKEN', `session key ${sessionKey} already exists`)
    }
    const mainSpec = compiled.agents.find(spec => spec.agentId === compiled.mainAgentId)
    if (mainSpec === undefined) {
      throw new FrameworkError(422, 'MAIN_AGENT_MISSING', `compiled product has no agent for entry ${compiled.mainAgentId}`)
    }
    const llmConfigId = mainSpec.modelRoute.replace(/^soloengine-/u, '')
    const configRow = this.runtime.models.byIdUnscoped(llmConfigId)
    if (configRow === undefined) {
      throw new FrameworkError(422, 'MODEL_CONFIG_MISSING',
        `entry node ${mainSpec.agentId} references model config ${llmConfigId}, which no longer exists`)
    }
    this.ledger.ensure({
      session_key: sessionKey,
      user_id: userId,
      agentic_flow_id: input.canvasId,
      run_project_id: project.id,
      llm_config_id: llmConfigId,
    })
    const row = this.ledger.byKey(sessionKey)
    if (row === undefined) throw new FrameworkError(500, 'LEDGER_INSERT_FAILED', 'session ledger row missing after insert')
    // per-user SkillProvider（PRD-04 FR-SKILL-007）：运行前把该用户启用中的技能同步进
    // 项目层技能根（junction 农场），使本次运行的技能发现根 = 该用户的启用集合。
    try {
      this.runtime.skills.syncProjectSkills(userId, project.folder_path)
    } catch (error) {
      console.log(`soloengine: syncing skills into project ${project.folder_path} failed: ${String(error)}`)
    }
    try {
      await driver.start({
        sessionKey,
        userId,
        canvasData,
        cwd: project.folder_path,
        compiled,
        settings,
        mainAgent: {
          agentId: mainSpec.agentId,
          provider: mainSpec.modelRoute,
          model: configRow.model_name,
          maxTokens: configRow.max_output_tokens ?? configRow.max_tokens,
        },
      })
      this.ledger.setStatus(row.id, 'running', { startedAt: Date.now() })
    } catch (error) {
      this.ledger.setStatus(row.id, 'failed', { error: error instanceof Error ? error.message : String(error) })
      throw new FrameworkError(500, 'RUN_START_FAILED', `creating the main agent failed: ${String(error)}`)
    }
    this.runtime.canvas.touchProject(userId, project.id)
    return this.view(this.requireOwned(userId, sessionKey))
  }

  /** 按归属取会话行（越权即 404，不泄漏存在性）。 */
  private requireOwned(userId: string, sessionKey: string): SessionLedgerRow {
    const row = this.ledger.byKey(sessionKey)
    if (row === undefined || row.user_id !== userId) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    return row
  }

  /**
   * 某 agenticflow 的最新会话键（运行面板 URL 的解析依据：`/run/:agenticFlowId`）。
   * @param flowId - 画布（agenticflow）ID。
   * @returns 最新会话键；该 flow 还没有任何会话时 undefined。
   */
  latestSessionKeyOfFlow(flowId: string): string | undefined {
    const row = this.raw.prepare(
      'SELECT session_key FROM sessions WHERE agentic_flow_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(flowId) as { session_key: string } | undefined
    return row?.session_key
  }

  /** 归属行 + 活状态 → 对外视图。 */
  view(row: SessionLedgerRow): RunSessionView {
    const live = this.driver?.live(row.session_key)
    return {
      session_key: row.session_key,
      user_id: row.user_id,
      agentic_flow_id: row.agentic_flow_id,
      run_project_id: row.run_project_id,
      llm_config_id: row.llm_config_id,
      status: row.status,
      error: row.error,
      created_at: row.created_at,
      duration_ms: row.duration_ms,
      live: live?.live ?? false,
      main_agent_id: live?.agentId ?? null,
      panel_path: `/run/${row.agentic_flow_id}`,
    }
  }

  /** 列当前用户的会话。 */
  listSessions(userId: string, limit = 50): RunSessionView[] {
    return this.ledger.listByUser(userId, limit).map(row => this.view(row))
  }

  /** 取单个会话。 */
  session(userId: string, sessionKey: string): RunSessionView {
    return this.view(this.requireOwned(userId, sessionKey))
  }

  /** 取会话的事件归属行。 */
  events(userId: string, sessionKey: string, limit = 200): EventLedgerRow[] {
    const row = this.requireOwned(userId, sessionKey)
    return this.ledger.events(row.id, limit)
  }

  /**
   * 以用户消息推进循环。
   * @param userId - 归属用户。
   * @param sessionKey - 会话键。
   * @param text - 用户消息文本。
   * @returns 排队事实。
   */
  async prompt(userId: string, sessionKey: string, text: string): Promise<{ queued: boolean }> {
    const driver = this.requireDriver()
    const row = this.requireOwned(userId, sessionKey)
    if (text.trim() === '') throw new FrameworkError(422, 'EMPTY_PROMPT', 'prompt text must not be empty')
    const result = await driver.prompt(sessionKey, text)
    if (row.status === 'pending') this.ledger.setStatus(row.id, 'running', { startedAt: Date.now() })
    return result
  }

  /** 取消当前运行（停止原因落日志）。 */
  async cancel(userId: string, sessionKey: string, reason = 'user request'): Promise<RunSessionView> {
    const driver = this.requireDriver()
    const row = this.requireOwned(userId, sessionKey)
    await driver.cancel(sessionKey, reason)
    this.ledger.setStatus(row.id, 'stopped', { completedAt: Date.now() })
    return this.view(this.requireOwned(userId, sessionKey))
  }

  /**
   * 停掉一个归属行已被级联删除的活会话（画布删除的收尾）。
   *
   * 与 `cancel` 的差别只有一处：级联已经删掉 sessions 行，无法再做归属查询与状态回写，故此路径
   * 直接调运行驱动停会话。归属由调用方确立——级联事务在画布所有者的身份下执行，键集合来自该
   * 次删除的返回值，不接受外部输入。
   * @param sessionKey - 会话键。
   * @param reason - 停止原因（落会话日志）。
   */
  async cancelDetached(sessionKey: string, reason: string): Promise<void> {
    await this.requireDriver().cancel(sessionKey, reason)
  }

  /**
   * 用量派生（按模型配置聚合；数据来自事件流，不落第二副本）。
   * @param userId - 归属用户。
   * @returns 按会话与按模型的聚合行。
   */
  async usage(userId: string): Promise<{
    sessions: (UsageRow & { llm_config_id: string | null; agentic_flow_id: string })[]
    byModel: { llm_config_id: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }[]
  }> {
    const driver = this.requireDriver()
    const rows = this.ledger.listByUser(userId, 500)
    const byKey = new Map(rows.map(row => [row.session_key, row]))
    const derived = await driver.usage()
    const sessions = derived
      .filter(entry => byKey.has(entry.sessionKey))
      .map(entry => {
        const row = byKey.get(entry.sessionKey) as SessionLedgerRow
        return {
          ...entry,
          llm_config_id: row.llm_config_id,
          agentic_flow_id: row.agentic_flow_id,
        }
      })
    const byModel = new Map<string, { llm_config_id: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number }>()
    for (const entry of sessions) {
      if (entry.llm_config_id === null) continue
      const bucket = byModel.get(entry.llm_config_id)
        ?? { llm_config_id: entry.llm_config_id, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
      bucket.requests += entry.requests
      bucket.inputTokens += entry.inputTokens
      bucket.outputTokens += entry.outputTokens
      bucket.totalTokens += entry.totalTokens
      byModel.set(entry.llm_config_id, bucket)
    }
    return { sessions, byModel: [...byModel.values()] }
  }

  /**
   * 写一条创造模式审计（每个动作一条；失败也落库，`ok=0`）。
   * @param input - 审计事实。
   * @returns 新行主键。
   */
  recordCreatorAudit(input: {
    kind: string
    userId: string | null
    ok: boolean
    detail: string
  }): string {
    const id = newId()
    const at = new Date().toISOString()
    this.raw.prepare(
      'INSERT INTO creator_audit (id, kind, at, user_id, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.kind, at, input.userId, input.ok ? 1 : 0, input.detail, at)
    return id
  }

  /** 列创造模式审计（超管或本人）。 */
  listCreatorAudit(userId: string, limit = 100): Record<string, unknown>[] {
    return this.raw.prepare(
      'SELECT id, kind, at, user_id, ok, detail, created_at FROM creator_audit WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(userId, limit) as Record<string, unknown>[]
  }

  /** 会话键 → 归属用户（供 host 侧审计归属解析）。 */
  ownerOf(sessionKey: string): string | null {
    return this.ledger.byKey(sessionKey)?.user_id ?? null
  }

  /** 会话键 → 归属行主键。 */
  ledgerIdOf(sessionKey: string): number | null {
    return this.ledger.byKey(sessionKey)?.id ?? null
  }
}
