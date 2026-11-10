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

import type { BusinessDatabase } from '../db/port.ts'
import { isUniqueViolation } from '../db/port.ts'
import { compileCanvas, CompileError, type CanvasNodeInput } from '@soloengine/agent-compiler'
import type { CompileResult } from '@soloengine/types'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import { newId } from '../auth/index.ts'
import { SessionLedger, type EventLedgerRow, type SessionLedgerRow } from './sessions.ts'
import type { InstanceRow } from './plugins.ts'

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
  /** 实例组合净结果（profile 基线 + 画布插件差异；Plan W3）。 */
  instancePlugins: InstanceRow[]
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
  /** 冷恢复：从持久化会话日志恢复 mainagent（组合与模型路由同一次运行）。 */
  resume(input: RunStartInput): Promise<{ mainAgentId: string }>
  /** 以用户消息推进循环（排队语义：运行中进入下一 turn）。 */
  prompt(sessionKey: string, text: string): Promise<{ queued: boolean }>
  /** 取消当前运行（停止原因落日志）。 */
  cancel(sessionKey: string, reason: string): Promise<void>
  /**
   * 销毁一个活会话（画布级联删除的收尾）：等循环退出后释放会话与实例。
   *
   * 与 {@link cancel} 的差别是**不再保留可续跑的会话**：`cancel` 停在 idle，写句柄仍持着会话，
   * 收尾批次的实时写入会撞已删的日志行；销毁等持久化屏障落尽、移除会话并触发 `session/disposed`。
   * @param sessionKey - 会话键。
   */
  retire(sessionKey: string): Promise<void>
  /** 当前进程内的活会话状态。 */
  live(sessionKey: string): { live: boolean; agentId: string | null; status: string }
  /** 用量派生（从事件流折叠，不落第二副本）。 */
  usage(sessionKeys: readonly string[]): Promise<UsageRow[]>
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
  /** 只计成功装配且带 provider `usage` 的 `assistant/message`（失败尝试不计）。 */
  requests: number
  /** 请求耗时合计（毫秒，`step/start` → 同 turn/step 的 `assistant/message`）。 */
  durationMs: number
  /** 每次请求的耗时（毫秒，升序无所谓）；供按模型聚合分位数。 */
  durationsMs: number[]
}

/** 用量统计的会话窗口：最近 N 个会话（按创建时间倒序）。 */
export const USAGE_SESSION_WINDOW = 500

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
  private readonly db: BusinessDatabase
  private readonly runtime: FrameworkRuntime
  /** 会话台账（归属索引行）。 */
  readonly ledger: SessionLedger
  private driver: RunDriver | undefined
  /** 会话 → 画布节点归属解析器（由 host 注入）。 */
  private agentResolver: ((sessionKey: string) => string | undefined) | undefined
  /** 无台账行会话的归属回退（由 host 注入：按会话树根解析用户与运行项目）。 */
  private ownershipResolver: ((sessionKey: string) => Promise<{ userId: string; projectId: string } | undefined>) | undefined
  /** 会话 → 回合级恢复点 id（主干 changeLedger 产出）。 */
  private readonly restorePoints = new Map<string, string>()

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
    this.db = runtime.db
    this.ledger = new SessionLedger(this.db)
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
   * 登记无台账行会话的归属回退（由 host 在挂载时注入）。
   *
   * 分支/草稿会话没有自己的 `sessions` 行，父指向只在 dsh 会话头里；host 按会话树根解析出
   * 归属用户与运行项目后由此返回。模型路由的归属、变更台账的沙箱根都走这一份，避免各入口各写一套。
   * @param resolver - 会话键 → 归属（无归属返回 `undefined`）。
   */
  setOwnershipResolver(
    resolver: (sessionKey: string) => Promise<{ userId: string; projectId: string } | undefined>,
  ): void {
    this.ownershipResolver = resolver
  }

  /**
   * 取一次会话的归属用户：自己的台账行优先，其次沿会话树根回退。
   * @param sessionKey - 会话键。
   * @returns 归属用户 id，或 `null`（无归属）。
   */
  async ownerOf(sessionKey: string): Promise<string | null> {
    const row = await this.ledger.byKey(sessionKey)
    if (row !== undefined) return row.user_id
    const fallback = await this.ownershipResolver?.(sessionKey)
    return fallback?.userId ?? null
  }

  /**
   * 取一次会话的运行项目：自己的台账行优先，其次沿会话树根回退。
   * @param sessionKey - 会话键。
   * @returns 运行项目 id，或 `null`（无归属）。
   */
  async projectIdOf(sessionKey: string): Promise<string | null> {
    const row = await this.ledger.byKey(sessionKey)
    if (row !== undefined) return row.run_project_id
    const fallback = await this.ownershipResolver?.(sessionKey)
    return fallback?.projectId ?? null
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
  async compile(userId: string, canvasId: string, cwd: string): Promise<{ compiled: CompileResult; settings: { run_mode?: string; live_follow?: boolean }; canvasData: unknown }> {
    const canvas = await this.runtime.canvas.byId(userId, canvasId)
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
    // 节点未声明插件时回落到该用户的默认插件表（与画布编译、打包同一处规则）。
    canvasData.nodes = await this.runtime.plugins.applyNodeDefaults(userId, (canvasData.nodes ?? []) as CanvasNodeInput[])
    // 画布节点存的是技能**行 id**；运行时按技能**名**寻址（`skill` 工具与挂载守卫都用名字）。
    // 在编译边界统一翻译，未知引用保留原值，由 noticeUnavailableRefs 报出。
    const skillRows = await this.runtime.skills.listMountable(userId)
    const skillNameOf = new Map<string, string>()
    for (const row of skillRows) skillNameOf.set(row.id, row.name)
    for (const node of (canvasData.nodes ?? []) as { skills?: unknown }[]) {
      if (!Array.isArray(node.skills)) continue
      node.skills = node.skills.map(ref => skillNameOf.get(String(ref)) ?? String(ref))
    }
    // `compileCanvas` 的 `resolveModelRoute` 是同步回调，模型行必须先在此处解析完。
    const modelRoutes = new Map<string, { route: string; valid: boolean }>()
    for (const node of (canvasData.nodes ?? []) as { model_ref?: string }[]) {
      const modelRef = node.model_ref ?? ''
      if (modelRef === '' || modelRoutes.has(modelRef)) continue
      const row = await this.runtime.models.byId(userId, modelRef)
      modelRoutes.set(modelRef, row === undefined
        ? { route: '', valid: false }
        : { route: `soloengine-${row.id}`, valid: row.is_active === 1 })
    }
    // 节点没有显式模型时**不**落到默认模型：缺模型引用是编译期 fail loud（PRD-02 §2）。
    let compiled: CompileResult
    try {
      compiled = compileCanvas({
        canvas: canvasData as never,
        cwd,
        platform: this.runtime.executionPlatform,
        resolveModelRoute: (modelRef) => {
          if (modelRef === '') return { route: '', valid: false }
          return modelRoutes.get(modelRef) ?? { route: '', valid: false }
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
  private async noticeUnavailableRefs(userId: string, canvasId: string, compiled: CompileResult): Promise<void> {
    for (const spec of compiled.agents) {
      for (const name of spec.mcpServers) {
        const row = await this.runtime.mcp.byNameScoped(userId, name)
        if (row === undefined) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references MCP server "${name}" that does not exist or is not visible; its tools will not be mounted`)
        } else if (row.is_active !== 1) {
          console.log(`soloengine: canvas ${canvasId} node ${spec.agentId} references MCP server "${name}" that is disabled; its tools will not be mounted (enable it or remove the reference)`)
        }
      }
      for (const name of spec.skills) {
        const rows = await this.runtime.skills.listMountable(userId)
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
   *
   * 运行项目与 flow 解耦（需求 §9.5 ⑤）：调用方可以给已登记的 `projectId`，也可以直接给
   * `folderPath`（运行面板的原生目录选择就是这条路径）——后者按「用户 × 画布 × 目录」取得或创建
   * 项目行，因此同一个 flow 可以登记任意多个目录，不要求事先选项目。
   * @param userId - 归属用户。
   * @param input - 画布、运行项目（id 或目录）与可选的显式会话键（固定入口直达用）。
   * @returns 会话视图。
   */
  async createRun(
    userId: string,
    input: { canvasId: string; projectId?: string; folderPath?: string; sessionKey?: string },
  ): Promise<RunSessionView> {
    const driver = this.requireDriver()
    const canvasId = input.canvasId.trim()
    if (canvasId === '') {
      throw new FrameworkError(400, 'CANVAS_REQUIRED', 'canvasId is required to start a run')
    }
    const projectId = input.projectId?.trim() ?? ''
    const folderPath = input.folderPath?.trim() ?? ''
    if (projectId === '' && folderPath === '') {
      throw new FrameworkError(400, 'PROJECT_REQUIRED', 'either projectId or folderPath is required to start a run')
    }
    const project = projectId === ''
      ? await this.runtime.canvas.ensureProject(userId, canvasId, folderPath)
      : await this.runtime.canvas.projectById(userId, projectId)
    if (project === undefined) {
      throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${projectId} not found`)
    }
    if (project.agentic_flow_id !== canvasId) {
      throw new FrameworkError(422, 'PROJECT_CANVAS_MISMATCH',
        `run project ${project.id} belongs to canvas ${project.agentic_flow_id}, not ${canvasId};`
        + ' pass folderPath to run this canvas against the same directory')
    }
    const sessionKey = input.sessionKey === undefined
      ? SessionLedger.newKey()
      : requireExplicitSessionKey(input.sessionKey)
    if (await this.ledger.byKey(sessionKey) !== undefined) {
      throw new FrameworkError(409, 'SESSION_KEY_TAKEN', `session key ${sessionKey} already exists`)
    }
    const { startInput, llmConfigId } = await this.buildStartInput(userId, canvasId, project, sessionKey)
    await this.noticeUnavailableRefs(userId, canvasId, startInput.compiled)
    let ensured: SessionLedgerRow
    try {
      ensured = await this.ledger.ensure({
        session_key: sessionKey,
        user_id: userId,
        agentic_flow_id: canvasId,
        run_project_id: project.id,
        llm_config_id: llmConfigId,
      })
    } catch (error) {
      // 先查后插在异步连接下不再原子：并发同键创建的唯一约束冲突收敛为 409（04 W1）。
      if (isUniqueViolation(error)) {
        throw new FrameworkError(409, 'SESSION_KEY_TAKEN', `session key ${sessionKey} already exists`)
      }
      throw error
    }
    // `ensure` 是幂等的：并发下可能返回**别人**刚插入的同键行。必须在启动驱动前按归属判定，
    // 否则会替他人在其会话上再起一次 agent，最后才以 404 收场。
    if (ensured.user_id !== userId || ensured.agentic_flow_id !== canvasId || ensured.run_project_id !== project.id) {
      throw new FrameworkError(409, 'SESSION_KEY_TAKEN', `session key ${sessionKey} already exists`)
    }
    const row = ensured
    // per-user SkillProvider（PRD-04 FR-SKILL-007）：运行前把该用户启用中的技能同步进
    // 项目层技能根（junction 农场），使本次运行的技能发现根 = 该用户的启用集合。
    try {
      await this.runtime.skills.syncProjectSkills(userId, project.folder_path)
    } catch (error) {
      console.log(`soloengine: syncing skills into project ${project.folder_path} failed: ${String(error)}`)
    }
    try {
      await driver.start(startInput)
      await this.ledger.setStatus(row.id, 'running', { startedAt: Date.now() })
    } catch (error) {
      await this.ledger.setStatus(row.id, 'failed', { error: error instanceof Error ? error.message : String(error) })
      // 准入拒绝等已结构化（429/503）的错误原样上抛，不折叠成 500。
      if (error instanceof FrameworkError) throw error
      throw new FrameworkError(500, 'RUN_START_FAILED', `creating the main agent failed: ${String(error)}`)
    }
    await this.runtime.canvas.touchProject(userId, project.id)
    return this.view(await this.requireOwned(userId, sessionKey))
  }

  /**
   * 构建一次运行/冷恢复的驱动输入：现场编译 + 实例组合 + 入口节点模型路由解析。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param project - 运行项目行（目录与画布归属已校验）。
   * @param sessionKey - 会话键。
   * @returns 驱动输入与入口节点的模型配置 id。
   */
  private async buildStartInput(
    userId: string,
    canvasId: string,
    project: { id: string; folder_path: string },
    sessionKey: string,
  ): Promise<{ startInput: RunStartInput; llmConfigId: string }> {
    const { compiled, settings, canvasData } = await this.compile(userId, canvasId, project.folder_path)
    const mainSpec = compiled.agents.find(spec => spec.agentId === compiled.mainAgentId)
    if (mainSpec === undefined) {
      throw new FrameworkError(422, 'MAIN_AGENT_MISSING', `compiled product has no agent for entry ${compiled.mainAgentId}`)
    }
    const llmConfigId = mainSpec.modelRoute.replace(/^soloengine-/u, '')
    // 归属校验与读取是同一次查询：画布引用的模型配置必须属于本次运行的用户，
    // 别人的模型（及其密钥）在编译到执行的整条链路上都不可达。
    const configRow = await this.runtime.models.byId(userId, llmConfigId)
    if (configRow === undefined) {
      throw new FrameworkError(422, 'MODEL_CONFIG_MISSING',
        `entry node ${mainSpec.agentId} references model config ${llmConfigId}, which no longer exists for this user`)
    }
    const instancePlugins = (await this.runtime.plugins.instanceComposition(userId, canvasId)).rows
    return {
      llmConfigId,
      startInput: {
        sessionKey,
        userId,
        canvasData,
        cwd: project.folder_path,
        compiled,
        settings,
        instancePlugins,
        mainAgent: {
          agentId: mainSpec.agentId,
          provider: mainSpec.modelRoute,
          model: configRow.model_name,
          maxTokens: configRow.max_output_tokens ?? configRow.max_tokens,
        },
      },
    }
  }

  /** 按归属取会话行（越权即 404，不泄漏存在性）。 */
  private async requireOwned(userId: string, sessionKey: string): Promise<SessionLedgerRow> {
    const row = await this.ledger.byKey(sessionKey)
    if (row === undefined || row.user_id !== userId) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    return row
  }

  /**
   * 某 agenticflow 的最新**运行**会话键（运行面板 URL 的解析依据：`/run/:agenticFlowId`）。
   *
   * 台账也登记客户端直接创建的会话（分支、面板新会话、草稿）：它们没有经过运行准入，行里
   * `started_at` 为空，也没有任何已登记事件。运行面板按设计打开「该画布最近一次运行」
   * （见 `docs/soloengine/01-架构.md`），因此只认**已启动或有事件**的归属行；否则客户端启动时
   * 自动连接工作区留下的草稿会话会顶掉真正的运行会话，面板在下次深链打开成空白首屏。
   *
   * 两条判据都要：从日志重建的归属行走 `recover` 写入（`started_at` 为空）但事件已被重建，
   * 仍应作为运行入口；而草稿在归属补登前就已结束，事件表里没有任何行。
   * @param flowId - 画布（agenticflow）ID。
   * @param restrictTo - 调用方连接可见的会话键；给出时只在这些键中挑选，避免把
   *   其他账号的会话键随外壳下发给本页面。
   * @returns 最新运行会话键；该 flow 还没有可见的运行会话时 undefined。
   */
  async latestSessionKeyOfFlow(flowId: string, restrictTo?: ReadonlySet<string>): Promise<string | undefined> {
    // 先取最新 50 条再按可见集合过滤会漏掉「第 51 条才是自己的」这种情况。这里按
    // (created_at, session_key) 逐页向前翻，直到命中可见键或翻完；每页查询仍然有界。
    const ran = `started_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM events WHERE events.session_id = sessions.id)`
    const pageSize = 200
    let cursor: { createdAt: number; key: string } | undefined
    for (let page = 0; page < 50; page += 1) {
      const rows = cursor === undefined
        ? await this.db.prepare(
          `SELECT session_key, created_at FROM sessions
            WHERE agentic_flow_id = ? AND (${ran})
            ORDER BY created_at DESC, session_key DESC LIMIT ?`,
        ).all<{ session_key: string; created_at: number }>(flowId, pageSize)
        : await this.db.prepare(
          `SELECT session_key, created_at FROM sessions
            WHERE agentic_flow_id = ? AND (${ran})
              AND (created_at < ? OR (created_at = ? AND session_key < ?))
            ORDER BY created_at DESC, session_key DESC LIMIT ?`,
        ).all<{ session_key: string; created_at: number }>(flowId, cursor.createdAt, cursor.createdAt, cursor.key, pageSize)
      if (rows.length === 0) return undefined
      if (restrictTo === undefined) return rows[0]?.session_key
      const hit = rows.find(row => restrictTo.has(row.session_key))
      if (hit !== undefined) return hit.session_key
      if (rows.length < pageSize) return undefined
      const last = rows[rows.length - 1] as { session_key: string; created_at: number }
      cursor = { createdAt: last.created_at, key: last.session_key }
    }
    return undefined
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
  async listSessions(userId: string, limit = 50): Promise<RunSessionView[]> {
    return (await this.ledger.listByUser(userId, limit)).map(row => this.view(row))
  }

  /**
   * 启动对账：把本进程无法再推进的进行中会话收敛为失败。
   *
   * 上一进程退出时 `pending` / `running` 行不会再有任何写入者，画布列表与会话台账会
   * 永久显示「运行中」。同进程重载（HMR）仍存活的会话保留原状态；`prompt` 的冷恢复
   * 仍可让失败行从日志续跑。
   * @returns 收敛的归属行数。
   */
  async settleInterrupted(): Promise<number> {
    let settled = 0
    for (const row of await this.ledger.inFlight()) {
      if (this.driver?.live(row.session_key).live === true) continue
      await this.ledger.setStatus(row.id, 'failed', {
        error: 'host restarted before the run finished',
        completedAt: Date.now(),
      })
      settled += 1
    }
    return settled
  }

  /** 取单个会话。 */
  async session(userId: string, sessionKey: string): Promise<RunSessionView> {
    return this.view(await this.requireOwned(userId, sessionKey))
  }

  /** 取会话的事件归属行。 */
  async events(userId: string, sessionKey: string, limit = 200): Promise<EventLedgerRow[]> {
    const row = await this.requireOwned(userId, sessionKey)
    return await this.ledger.events(row.id, limit)
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
    const row = await this.requireOwned(userId, sessionKey)
    if (text.trim() === '') throw new FrameworkError(422, 'EMPTY_PROMPT', 'prompt text must not be empty')
    // 本进程不持有该会话（进程重启 / 另一节点接管）时先冷恢复：日志是唯一真源，
    // 恢复后照常排队推进（云形态下租约由节点运行时在恢复前取得）。
    if (!driver.live(sessionKey).live) await this.resumeRun(userId, row)
    const result = await driver.prompt(sessionKey, text)
    // 续跑同一条会话：启动对账会把上一进程留下的行收敛为 failed，恢复后的新回合必须把
    // 折叠缓存扳回 running（否则画布列表在整轮期间显示「失败/已完成」），并清掉旧错误。
    if (row.status !== 'running') {
      await this.ledger.setStatus(row.id, 'running', {
        ...(row.started_at === null ? { startedAt: Date.now() } : {}),
        error: null,
      })
    }
    return result
  }

  /**
   * 冷恢复一条已归属的会话：用与创建相同的编译/组合重建 mainagent。
   * @param userId - 归属用户。
   * @param row - 会话归属行。
   */
  private async resumeRun(userId: string, row: SessionLedgerRow): Promise<void> {
    const driver = this.requireDriver()
    const project = await this.runtime.canvas.projectById(userId, row.run_project_id)
    if (project === undefined) {
      throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${row.run_project_id} not found`)
    }
    const { startInput } = await this.buildStartInput(userId, row.agentic_flow_id, project, row.session_key)
    try {
      await driver.resume(startInput)
    } catch (error) {
      if (error instanceof FrameworkError) throw error
      throw new FrameworkError(409, 'SESSION_RESUME_FAILED',
        `resuming session ${row.session_key} failed: ${String(error)}`)
    }
  }

  /** 取消当前运行（停止原因落日志）。 */
  async cancel(userId: string, sessionKey: string, reason = 'user request'): Promise<RunSessionView> {
    const driver = this.requireDriver()
    const row = await this.requireOwned(userId, sessionKey)
    await driver.cancel(sessionKey, reason)
    await this.ledger.setStatus(row.id, 'stopped', { completedAt: Date.now() })
    return this.view(await this.requireOwned(userId, sessionKey))
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
   * 销毁一个归属行已被级联删除的活会话（画布删除的收尾第二步）。
   *
   * 停止（{@link cancelDetached}）只让循环停下；销毁才会释放会话写句柄，之后的删日志才不会
   * 与在途实时写入相撞。归属由调用方确立，不接受外部输入。
   * @param sessionKey - 会话键。
   */
  async retireDetached(sessionKey: string): Promise<void> {
    await this.requireDriver().retire(sessionKey)
  }

  /**
   * 用量派生（按模型配置聚合；数据来自事件流，不落第二副本）。
   *
   * 统计范围是**该用户最近的 {@link USAGE_SESSION_WINDOW} 个会话**（按创建时间倒序），
   * 窗口外的会话不计；`window.total` 给出该用户的会话总数，供界面与导出如实标注。
   * 历史会话由运行驱动从持久化日志折叠，进程重启后仍可统计。
   * @param userId - 归属用户。
   * @returns 按会话与按模型的聚合行 + 统计窗口。
   */
  async usage(userId: string): Promise<{
    sessions: (UsageRow & { llm_config_id: string | null; agentic_flow_id: string })[]
    byModel: {
      llm_config_id: string
      requests: number
      inputTokens: number
      outputTokens: number
      totalTokens: number
      durationMs: number
      /** 平均请求耗时（毫秒）。 */
      avgMs: number
      /** 请求耗时中位数（毫秒）。 */
      p50Ms: number
      /** 请求耗时 p95（毫秒）。 */
      p95Ms: number
    }[]
    window: { limit: number; total: number }
  }> {
    const driver = this.requireDriver()
    const rows = await this.ledger.listByUser(userId, USAGE_SESSION_WINDOW)
    const total = await this.ledger.countByUser(userId)
    const byKey = new Map(rows.map(row => [row.session_key, row]))
    const derived = await driver.usage([...byKey.keys()])
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
    const byModel = new Map<string, {
      llm_config_id: string
      requests: number
      inputTokens: number
      outputTokens: number
      totalTokens: number
      durationMs: number
      durations: number[]
    }>()
    for (const entry of sessions) {
      if (entry.llm_config_id === null) continue
      const bucket = byModel.get(entry.llm_config_id)
        ?? {
          llm_config_id: entry.llm_config_id, requests: 0, inputTokens: 0, outputTokens: 0,
          totalTokens: 0, durationMs: 0, durations: [],
        }
      bucket.requests += entry.requests
      bucket.inputTokens += entry.inputTokens
      bucket.outputTokens += entry.outputTokens
      bucket.totalTokens += entry.totalTokens
      bucket.durationMs += entry.durationMs
      bucket.durations.push(...entry.durationsMs)
      byModel.set(entry.llm_config_id, bucket)
    }
    return {
      sessions,
      byModel: [...byModel.values()].map(({ durations, ...bucket }) => {
        const sorted = [...durations].sort((left, right) => left - right)
        return {
          ...bucket,
          avgMs: bucket.requests === 0 ? 0 : Math.round(bucket.durationMs / bucket.requests),
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
        }
      }),
      window: { limit: USAGE_SESSION_WINDOW, total },
    }
  }

  /**
   * 写一条创造模式审计（每个动作一条；失败也落库，`ok=0`）。
   * @param input - 审计事实。
   * @returns 新行主键。
   */
  async recordCreatorAudit(input: {
    kind: string
    userId: string | null
    ok: boolean
    detail: string
  }): Promise<string> {
    const id = newId()
    const at = new Date().toISOString()
    await this.db.prepare(
      'INSERT INTO creator_audit (id, kind, at, user_id, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.kind, at, input.userId, input.ok ? 1 : 0, input.detail, at)
    return id
  }

  /** 列创造模式审计（超管或本人）。 */
  async listCreatorAudit(userId: string, limit = 100): Promise<Record<string, unknown>[]> {
    return await this.db.prepare(
      'SELECT id, kind, at, user_id, ok, detail, created_at FROM creator_audit WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all<Record<string, unknown>>(userId, limit)
  }

  /** 会话键 → 归属行主键。 */
  async ledgerIdOf(sessionKey: string): Promise<number | null> {
    return (await this.ledger.byKey(sessionKey))?.id ?? null
  }
}

/**
 * 最近秩分位数（nearest-rank）：升序样本里第 ceil(fraction × n) 个。
 * @param sorted - 升序样本。
 * @param fraction - 0–1 的分位（0.5 = 中位数）。
 * @returns 分位数值；空样本为 0。
 */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? 0
}
