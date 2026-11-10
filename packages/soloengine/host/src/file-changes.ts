/**
 * 文件变更记录与撤回（Host 面接线；PRD-09 FR-FC-001~011）。
 *
 * **四类档位（PRD-01 纪律）**：本能力以第三方 DSH 插件 `@anionex/dsh-turn-rewind`（BSD-3-Clause）
 * 为**实现主干**——它提供内容寻址恢复点清单、恢复前救援点、post-restore 哈希校验、stale-plan 失效
 * 检查与公开的 `ctx.changeLedger` 服务；SoloEngine 在主干上**补齐缺口**：
 *
 * | 缺口（PRD-09 要求） | 本模块的补齐方式 |
 * |---|---|
 * | 写前后**逐次抓拍**（FR-FC-001） | prepend 原生 `fs/write-intent`/`fs/edit-intent` 抓拍写前内容，`fs/observed` 抓拍写后内容——**不另埋钩子**（正常 next() 透传，不抢决策槽） |
 * | 逐文件/逐 hunk 审阅（FR-FC-005） | 落 `file_changes`（含逐 hunk 结构与状态），审阅只标记不动磁盘 |
 * | `origin` 三值归属（FR-FC-001/003） | `agent`（工具写入）/`user`（人写入接口）/`revert`（撤回写回自身） |
 * | 按轮次撤回的最小还原（FR-FC-007） | 还原目标 = 记录内文件的「变更前内容 + 被丢弃 hunk 的新侧」；**只动记录内的文件** |
 * | 漂移检测（FR-FC-008） | 撤回前比对磁盘内容与记录的变更后内容哈希；不一致跳过并在计划中提示 |
 * | 撤回记录链（FR-FC-009） | 撤回写回经同一条原生写入路径（intent → 守卫 → observed）落 `origin='revert'` 新记录，因此可再撤回 |
 * | 会话轴正交（FR-FC-010） | 会话分支由 dsh 原生 `SessionStore.fork` 承担（本模块不碰）；文件轴只动记录内文件 |
 *
 * 写回原语：dsh 原生 `ctx.fs` 的写入守卫只有 `createIfAbsent`/`replaceIfVersion`，**无删除原语**；
 * 本模块补齐「按记录还原」与「删除」两条写入路径（`restoreTo`），并经原生 `fs/observed` 补发写后观测。
 *
 * 事件承载（Plan W2/R140）：`fs/write-intent` 与 `fs/observed` 是 dsh 原生的**全局文件观测总线**
 * ——全局订阅者（观测门禁、变更面板）按 `target` + actor 过滤，未标 scope，必须收到全部写回；
 * 原生 fs 工具也按同一约定裸发。因此本模块的**写回**改经 `scopeTarget(base, flowKey)` 载体派发：
 * 全局订阅者行为不变，flow/agent 作用域的订阅者只收到本 flow 的写回，不串其他 flow 与其他用户。
 * 原生工具发射端的全局语义属于完全复用基线，不在本模块改写。
 *
 * @module @soloengine/host/file-changes
 */

import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { rm } from 'node:fs/promises'
import { scopeTarget, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { FsTarget, FsWriteIntent, FsVersion } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import type { FrameworkRuntime } from '@soloengine/framework'
import { FrameworkError } from '@soloengine/framework'
import type { ChangeLedgerService, RevertExecutionResult } from '@soloengine/framework'

/** 每个会话内 `callId → 归属` 的派生表（来源：原生 `tool/call` 事件，含 turn/step）。 */
interface CallAttribution {
  turn: number
  step: number
}

/** 一次待落账的抓拍（写前抓拍 → 写后观测之间）。 */
interface PendingCapture {
  /** 目标键（`FsTarget.targetKey`）。 */
  targetKey: string
  filePath: string
  before: string | null
  sessionKey: string | null
  agentId: string | null
  userId: string | null
  turn: number | null
  callId: string | null
  origin: 'agent' | 'revert' | 'user'
  /** 撤回写回的上下文（`origin='revert'` 时用于归属与再撤回）。 */
  revertOf?: readonly string[]
}

/** `ctx.changeLedger` 的最小可用面（主干插件提供；宿主侧只用这些面）。 */
interface ChangeLedgerFace {
  /** 取某一回合的检查点（提示词锚定）。 */
  findTurnCheckpoint: (
    options: { cwd: string; sessionId: string; turn: number; signal?: AbortSignal },
  ) => Promise<{ id: string } | undefined>
  /** 把一个恢复点与当前工作树比对（内容寻址清单 + 漂移结论）。 */
  inspect: (options: { cwd: string; restorePointId: string; signal?: AbortSignal }) => Promise<TrunkInspection>
  /** 运行期可调配置（存储根除外）：本层用它在越界风险的工作区活跃时关掉自动回合检查点。 */
  updateConfig?: (config: { turnCheckpointMode: 'off' | 'auto' | 'git-native' | 'legacy' }) => void
}

/** 主干 `inspect` 的结论面（只取宿主侧用到的字段）。 */
interface TrunkInspection {
  changes?: readonly unknown[]
  restorePoint?: { skippedCount?: number }
  headChanged?: boolean
  operationChanged?: boolean
}

/** `ctx.sessions` 的最小可用面（原生会话仓库；撤回写回经它把归属钉在真实会话上）。 */
interface SessionStoreFace {
  get: (id: string) => object | undefined
}

/** 原生会话的事件面与工作区面（主干预设插件的边界判定与提示词锚点都要读会话）。 */
interface SessionEventsFace {
  header?: { cwd?: unknown }
  snapshotEvents?: () => readonly { type: string; seq: number; data?: unknown }[]
}

/** 挂载文件变更记录时的宿主接线项。 */
export interface FileChangesOptions {
  /**
   * 会话所属 flow 的作用域键（撤回写回派发 fs 事件时使用）。
   *
   * 文件观测总线的全局订阅者（观测门禁、变更面板）未标 scope，照旧收到全部写回；
   * flow/agent 作用域的订阅者只收到本 flow 的写回——不串其他 flow、也不串其他用户。
   * 缺省或返回 undefined 时按「无归属」派发：只有全局订阅者收到（fail-closed）。
   */
  readonly scopeKeyOfSession?: (sessionKey: string) => ScopeKey | undefined
}

/**
 * 挂载文件变更记录与撤回。
 *
 * @param ctx - 已注入 `fs` 的上下文。
 * @param runtime - 框架层运行时（台账域与归属解析）。
 * @param options - 宿主接线项（flow 作用域解析等）。
 */
export function mountFileChanges(ctx: Context, runtime: FrameworkRuntime, options: FileChangesOptions = {}): void {
  const ledger: ChangeLedgerService = runtime.changes
  /** 会话 → (callId → 归属)。 */
  const calls = new Map<string, Map<string, CallAttribution>>()
  /** 目标键 → 待落账抓拍（同一目标串行覆盖，写入是单写者）。 */
  const pending = new Map<string, PendingCapture>()
  /** 撤回写回的目标键 → 撤回上下文（让写回落 `origin='revert'`）。 */
  const revertTargets = new Map<string, { sessionKey: string; userId: string; agentId: string | null; of: readonly string[] }>()
  /**
   * 会话 → 正在跑的回合的工作区。
   *
   * 边界档位是**全局**运行时配置，而主干的自动检查点只在回合起点（`agent/pre-step`）发生：
   * 因此「越界」的判定必须按**回合在飞**而不是按会话存活——否则一个越界工作区的会话（其 agent
   * 常驻到进程结束）会把整个进程的自动检查点永久按在 `off`，其它健康工作区再也拿不到会话轴。
   */
  const runningTurns = new Map<string, string>()
  /** 最近一次同步给主干的自动检查点模式（避免每次工具调用都写配置）。 */
  let lastTrunkMode: 'off' | 'auto' | null = null

  /** 原生 `tool/call` → callId 归属表（turn/step 来自事件本身）。 */
  ctx.on('session/event', (session, event) => {
    // 本监听器**同步**运行在 `Session.append` 的广播路径内：任何抛出都会打断 agent 的工具调用，
    // 因此整段包在守卫内——记录是观测能力，绝不拖垮会话。
    try {
      const key = String(session.id)
      if (event.type === 'turn/start') {
        // 回合起点先于主干的 `agent/pre-step` 抓拍分派：此刻按本回合作业的工作区判边界。
        enterWorkspace(session, key)
        return
      }
      if (event.type === 'turn/end') {
        // 回合收尾：本回合不再需要检查点，释放边界占用（其它工作区立刻恢复 auto）。
        if (runningTurns.delete(key)) syncTrunkCheckpointMode()
        return
      }
      if (event.type !== 'tool/call') return
      const table = calls.get(key) ?? new Map<string, CallAttribution>()
      calls.set(key, table)
      table.set(String(event.data.callId), { turn: event.data.turn, step: event.data.step })
      // 自愈：本回合在越界工作区里跑期间逐次重申关闭（防止设置层把模式改回自动）。
      syncTrunkCheckpointMode()
    } catch (error) {
      console.log(`soloengine: tool-call attribution for ${String(session.id)} failed (${String(error)}); the turn view may miss this call's turn binding`)
    }
  })

  /** 会话销毁：释放在飞回合的边界状态。 */
  ctx.on('session/disposed', (session: SessionEventsFace & { id: unknown }) => {
    try {
      const key = String(session.id)
      runningTurns.delete(key)
      syncTrunkCheckpointMode()
    } catch (error) {
      console.log(`soloengine: releasing the change-ledger boundary state for ${String(session.id)} failed (${String(error)})`)
    }
  })

  /** 已打印过边界说明的工作区（每种归属只说明一次，避免刷屏）。 */
  const announcedBoundaries = new Set<string>()

  /**
   * 登记一个会话的工作区，并把**本回合**的边界归属写入在飞表后同步档位。
   *
   * @param session - 原生会话（`header.cwd` 即运行项目目录）。
   * @param sessionKey - 会话键。
   */
  const enterWorkspace = (session: SessionEventsFace, sessionKey: string): void => {
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return
    runningTurns.set(sessionKey, cwd)
    const boundary = workspaceBoundary(cwd)
    if (boundary !== 'worktree-root' && !announcedBoundaries.has(`${boundary}:${cwd}`)) {
      announcedBoundaries.add(`${boundary}:${cwd}`)
      console.log(
        boundary === 'escaping'
          ? `soloengine: change-ledger automatic turn checkpoints are off while ${cwd} runs a turn: the run project directory sits inside an enclosing Git repository but is not its worktree root, so the trunk would resolve that repository outside the run sandbox (PRD-10 FR-SEC-001); the file_changes ledger alone carries the revert`
          : `soloengine: change-ledger automatic turn checkpoints use the trunk's ordinary-directory snapshot mode for ${cwd} (no enclosing repository, nothing outside the sandbox can be captured)`,
      )
    }
    syncTrunkCheckpointMode()
  }

  /**
   * 同步主干的自动回合检查点模式：有**在飞回合**落在越界工作区时一律 `off`，否则 `auto`
   * （`auto` 对 Git 工作树根选 git-native、对普通目录选 legacy——两种安全情形各自归位；
   * 升级/降级都发生在同一处：运行时配置切换，不动存储根）。
   */
  const syncTrunkCheckpointMode = (): void => {
    const face = ledgerFace(ctx)
    if (face?.updateConfig === undefined) return
    const workspaces = [...new Set(runningTurns.values())]
    const boundaries = workspaces.map(workspace => workspaceBoundary(workspace))
    const escaping = boundaries.filter(boundary => boundary === 'escaping').length
    const mode: 'off' | 'auto' = escaping === 0 ? 'auto' : 'off'
    if (mode === lastTrunkMode) return
    try {
      face.updateConfig({ turnCheckpointMode: mode })
    } catch (error) {
      console.log(`soloengine: switching the change-ledger turn-checkpoint mode to ${mode} failed (${String(error)}); the file_changes ledger alone carries the revert`)
      return
    }
    lastTrunkMode = mode
    console.log(
      `soloengine: change-ledger automatic turn checkpoints → ${mode} (turns in flight: ${String(runningTurns.size)}; workspaces: git-worktree-root=${String(boundaries.filter(item => item === 'worktree-root').length)}, ordinary=${String(boundaries.filter(item => item === 'ordinary').length)}, outside-boundary=${String(escaping)}; auto resolves git-native for worktree roots and legacy for ordinary directories)`,
    )
  }

  /**
   * 写前抓拍：prepend 到原生意图瀑布，抓拍后 `next()` 透传（不抢占用单一决策槽的策略）。
   */
  const captureIntent = async (
    target: FsTarget,
    actor: object | undefined,
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    try {
      const attribution = await attributeOf(actor, runtime, calls)
      const before = await readTarget(ctx, target)
      pending.set(target.targetKey, {
        targetKey: target.targetKey,
        filePath: fileUrlPath(ctx, target),
        before,
        sessionKey: attribution.sessionKey,
        agentId: attribution.agentId,
        userId: attribution.userId,
        turn: attribution.turn,
        callId: attribution.callId,
        origin: attribution.origin,
        ...attribution.revertOf === undefined ? {} : { revertOf: attribution.revertOf },
      })
    } catch (error) {
      // 抓拍失败不得影响写入路径（记录是观测能力，非门禁）：结构化告警 + 放行。
      console.log(`soloengine: file-change capture failed for ${target.displayPath} (${String(error)}); the write proceeds unrecorded`)
    }
    return next()
  }

  ctx.on('fs/write-intent', (target, actor, next) => captureIntent(target, actor, next as () => Promise<unknown>) as Promise<FsWriteIntent | undefined>, true)
  ctx.on('fs/edit-intent', (target, actor, next) => captureIntent(target, actor, next as () => Promise<unknown>) as Promise<{ version: FsVersion } | undefined>, true)

  /**
   * 写后观测：`fs/observed` 是同步记录器（返回的 promise 不被等待）——落账读盘必须异步进行，
   * 且同一目标的多次写入按调用顺序串行（避免后一次观测读到前一次的内容）。
   */
  ctx.on('fs/observed', (target, observation, actor) => {
    const capture = pending.get(target.targetKey)
    if (capture === undefined) return
    pending.delete(target.targetKey)
    const revertContext = revertTargets.get(target.targetKey)
    if (revertContext !== undefined) revertTargets.delete(target.targetKey)
    void (async () => {
      try {
        const after = observation.kind === 'present' ? await readTarget(ctx, target) : null
        const origin = revertContext === undefined ? capture.origin : 'revert'
        const recorded = await ledger.record({
          userId: revertContext?.userId ?? capture.userId,
          origin,
          sessionKey: revertContext?.sessionKey ?? capture.sessionKey,
          turn: capture.turn,
          agentId: revertContext?.agentId ?? capture.agentId,
          filePath: capture.filePath,
          toolCallId: capture.callId,
          before: capture.before,
          after,
        })
        if (recorded !== null) {
          console.log(
            `soloengine: file-change recorded (${recorded.operation}, origin=${origin}, file=${recorded.filePath}, +${String(recorded.linesAdded ?? 0)}/-${String(recorded.linesRemoved ?? 0)}, hunks=${String(recorded.hunks?.length ?? 0)})`,
          )
        }
      } catch (error) {
        console.log(`soloengine: file-change ledger write failed for ${target.displayPath} (${String(error)})`)
      }
    })()
    void actor
  })

  /**
   * 撤回执行（框架层只做计划，写回在本模块完成；这是「经文件系统守卫写入 + 补发写后观测」的落地）。
   *
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @param turn - 回合序号（与 `changeIds` 二选一）。
   * @param changeIds - 指定记录集合（对撤回记录再撤回时使用）。
   * @param actor - 扮演写者的对象（进入观测门禁与策略判定的 actor 位）。
   * @returns 执行结果（还原项、跳过项、落账的 revert 记录 id）。
   */
  const executeRevert = async (
    userId: string,
    sessionKey: string,
    turn: number | null,
    changeIds: readonly string[] | undefined,
    actor: object,
  ): Promise<RevertExecutionResult> => {
    const plan = await ledger.revertPlan(userId, sessionKey, turn, changeIds)
    const restored: string[] = []
    const revertedChangeIds: string[] = []
    const failures: { filePath: string; reason: string }[] = []
    // 分支/草稿会话没有自己的台账行：运行项目按会话树根解析（与撤回计划的沙箱根同一处），
    // 否则「计划算得出来、执行找不到项目」会在同一入口给出两种结果。
    const projectId = await runtime.runs.projectIdOf(sessionKey)
    const project = projectId === null ? undefined : await runtime.canvas.projectById(userId, projectId)
    if (project === undefined) {
      throw new Error(`session ${sessionKey} has no run project; cannot resolve the sandbox root for the revert`)
    }
    // 写回必须**经原生观测门禁**（PRD-09 FR-FC-007 / PRD-10）：门禁按 actor 的会话归属记录观测，
    // 因此 actor 必须携带真实会话对象；无活会话时无法满足「先读后写」，如实 fail-closed 而不盲写。
    const store = ctx.get('sessions') as SessionStoreFace | undefined
    const session = store?.get(sessionKey)
    if (session === undefined) {
      throw new FrameworkError(409, 'SESSION_NOT_LIVE',
        `session ${sessionKey} has no live session in this process: the read-before-write gate cannot be satisfied, so the revert fails closed (reopen the run and retry)`)
    }
    const writeActor: object = { ...actor, agent: { session } }
    // 写回事件一律经 flow 载体派发（Plan W2/R140）：全局观测者未标 scope 照旧收到，
    // flow/agent 作用域的监听者只收到本 flow 的写回，不串其他 flow 与其他用户。
    const carrier = scopeTarget(ctx, options.scopeKeyOfSession?.(sessionKey))
    // 主干预设插件的交叉核对（改造复用的取证面）：只在该工作区**是 Git 工作树根**时进行——
    // 否则主干会按 cwd 向上解析到沙箱**之外**的外层仓库并整树遍历（PRD-10 FR-SEC-001），
    // 与自动检查点用同一条边界判据；这种工作区的撤回完全由本层台账承担。
    const boundary = workspaceBoundary(project.folder_path)
    const restorePoint = boundary === 'worktree-root'
      ? await trunkCrossCheck(ctx, project.folder_path, sessionKey, turn)
      : null
    if (restorePoint === null && turn !== null) {
      // 如实区分三种「没有恢复点」的成因：越界工作区、普通目录、以及**工作树根上读取失败**
      // （后者曾有误报——一律说成「普通目录」，把平台守卫拒绝等真实原因盖掉了）。
      const where = boundary === 'escaping'
        ? 'inside an enclosing repository but is not its worktree root'
        : boundary === 'worktree-root'
          ? 'a Git worktree root whose turn restore point could not be read (see the preceding line for the refusal)'
          : 'an ordinary directory'
      console.log(
        `soloengine: revert cross-check skipped for ${sessionKey} turn ${String(turn)}: ${project.folder_path} is ${where}; the file_changes ledger alone carries the revert`,
      )
    }
    for (const item of plan.restores) {
      try {
        const target = await ctx.fs.resolve(absoluteOf(project.folder_path, item.filePath), {})
        // 撤回写回也走「先读后写」门禁：先读一次并把观测记到会话归属上，再申请写入意图（CAS）。
        await readTarget(ctx, target)
        const stat = await ctx.fs.stat(target)
        if (stat !== undefined) ctx.emit(carrier, 'fs/observed', target, { kind: 'present', version: stat.version }, writeActor)
        else ctx.emit(carrier, 'fs/observed', target, { kind: 'absent' }, writeActor)
        revertTargets.set(target.targetKey, { sessionKey, userId, agentId: null, of: item.changeIds })
        // 触发一次意图瀑布（本模块的 prepend 抓拍器因此拿到撤回写前的真实内容）。
        const intent = await ctx.waterfall(carrier, 'fs/write-intent', target, writeActor, () => undefined)
        if (item.delete) {
          // 还原到一个「该轮开始前不存在」的记录点 = 删除该文件（补齐 dsh 缺失的删除写入原语）。
          await deleteTarget(ctx, target)
        } else {
          await ctx.fs.writeText(target, item.targetContent, intent, undefined)
          // 写后校验（与主干的 post-restore hash verification 同法）：回读内容必须逐字等于还原目标。
          const written = await readTarget(ctx, target)
          if (written !== item.targetContent) {
            throw new Error(
              `the restored content of ${item.filePath} does not match the ledger target (${String(written?.length ?? 0)} vs ${String(item.targetContent.length)} chars)`,
            )
          }
        }
        const after = await ctx.fs.stat(target)
        if (after !== undefined) ctx.emit(carrier, 'fs/observed', target, { kind: 'present', version: after.version }, writeActor)
        else ctx.emit(carrier, 'fs/observed', target, { kind: 'absent' }, writeActor)
        restored.push(item.filePath)
        revertedChangeIds.push(...item.changeIds)
      } catch (error) {
        // 逐文件提交：失败的文件保持原状并记入失败清单（其余文件照常），不整体回滚。
        failures.push({ filePath: item.filePath, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    await ledger.markReverted(userId, revertedChangeIds)
    return { plan, restored, revertedChangeIds, failures, restorePoint }
  }

  runtime.changes.attachRevertExecutor(async input => executeRevert(
    input.userId, input.sessionKey, input.turn, input.changeIds, input.actor,
  ))

  // 人写入（产品写路由 / 操作区桥）：只观测落账 `origin='user'`，归属用户、无 agent 归属、无工具调用；
  // 因此天然不入 agent 回合视图、不参与按轮次撤回（PRD-09 FR-FC-001 边界）。
  // 会话键随观察带上：台账查询按 session_id 过滤，不带就会记了也无人可见。
  runtime.workspace.attachWriteObserver((observation) => {
    void (async () => {
      try {
        const recorded = await ledger.record({
          userId: observation.userId,
          origin: 'user',
          sessionKey: observation.sessionKey,
          turn: null,
          agentId: null,
          filePath: observation.filePath,
          toolCallId: null,
          before: observation.before,
          after: observation.after,
        })
        if (recorded !== null) {
          console.log(
            `soloengine: file-change recorded (${recorded.operation}, origin=user, file=${recorded.filePath}, +${String(recorded.linesAdded ?? 0)}/-${String(recorded.linesRemoved ?? 0)})`,
          )
        }
      } catch (error) {
        console.log(`soloengine: file-change ledger write failed for ${observation.filePath} (${String(error)})`)
      }
    })()
  })

  console.log(
    'soloengine: file changes wired (capture via fs/write-intent+fs/edit-intent+fs/observed, ledger=file_changes, revert via guarded writes with drift checks)',
  )
}

/**
 * 取主干插件提供的 `ctx.changeLedger`（未装载时返回 `undefined`——调用方决定是否降级为纯台账路径）。
 *
 * 经 `ctx.get(..., true)` 读取：这是 cordis 的**不带 inject 声明**的服务读取面（`ctx.changeLedger`
 * 的直读会在未声明注入时抛 `cannot get property "changeLedger" without inject`，而该抛错发生在
 * `Session.append` 的广播路径内、会打断 agent 的工具调用）；`strict=true` 保证只在提供方
 * 插件处于活跃态时取用。
 *
 * @param ctx - 插件上下文。
 * @returns 主干服务面，或 `undefined`。
 */
function ledgerFace(ctx: Context): ChangeLedgerFace | undefined {
  const service = ctx.get('changeLedger') as ChangeLedgerFace | undefined
  return service === undefined ? undefined : service
}

/**
 * 撤回前的**交叉核对**：读该轮的回合级恢复点（主干的内容寻址清单）并与当前工作树比对。
 *
 * 只读、只记：失败不影响撤回本身（台账才是还原源），故此处吞掉读取异常并留下结构化告警。
 *
 * @param ctx - 插件上下文。
 * @param cwd - 运行项目目录（沙箱根）。
 * @param sessionKey - 会话键。
 * @param turn - 回合序号（按记录集合撤回时为 `null`，此时不做交叉核对）。
 * @returns 恢复点 id（无则 `null`）。
 */
async function trunkCrossCheck(
  ctx: Context,
  cwd: string,
  sessionKey: string,
  turn: number | null,
): Promise<string | null> {
  if (turn === null || !Number.isFinite(turn)) return null
  const face = ledgerFace(ctx)
  if (face === undefined) return null
  let restorePointId: string | undefined
  try {
    restorePointId = (await face.findTurnCheckpoint({ cwd, sessionId: sessionKey, turn }))?.id
  } catch (error) {
    console.log(`soloengine: revert cross-check: reading the change-ledger restore point for ${sessionKey} turn ${String(turn)} failed (${String(error)})`)
    return null
  }
  if (restorePointId === undefined) {
    console.log(`soloengine: revert cross-check: no change-ledger restore point for ${sessionKey} turn ${String(turn)} (the ledger alone carries the revert)`)
    return null
  }
  try {
    const inspection = await face.inspect({ cwd, restorePointId })
    console.log(
      `soloengine: revert cross-check: restore point ${restorePointId} (${sessionKey} turn ${String(turn)}) lists ${String(inspection.changes?.length ?? 0)} paths, skipped=${String(inspection.restorePoint?.skippedCount ?? 0)}, headChanged=${String(inspection.headChanged ?? false)}, operationChanged=${String(inspection.operationChanged ?? false)}`,
    )
  } catch (error) {
    console.log(`soloengine: revert cross-check: inspecting ${restorePointId} failed (${String(error)}); the ledger alone carries the revert`)
  }
  return restorePointId
}

/**
 * 判定一个运行项目目录对主干能力（自动回合检查点、恢复点交叉核对）是否安全（PRD-10 FR-SEC-001）。
 *
 * 主干的实现按 cwd 向上解析「所属 Git 仓库」：当运行项目目录**不是** Git 工作树根时
 * （例如位于某个仓库内的普通目录），它会解析到沙箱**之外**的外层仓库并遍历/快照那棵树
 * （含读取沙箱外文件）——这与「沙箱根 = 运行项目目录」的唯一归属冲突，故这类工作区必须
 * 让主干能力停用；而**完全没有外层仓库**的普通目录走主干的 legacy 快照档（`auto` 自动选择），
 * 不越界。
 *
 * @param cwd - 运行项目目录（会话 header.cwd 或运行项目 folder_path）。
 * @returns 该目录归属的安全档。
 */
function workspaceBoundary(cwd: string): 'worktree-root' | 'ordinary' | 'escaping' {
  if (existsSync(join(cwd, '.git'))) return 'worktree-root'
  // 逐级向上找封闭仓库（有界遍历：到盘根为止），命中即为「仓库内的普通目录」。
  let current = resolve(cwd)
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return 'ordinary'
    if (existsSync(join(parent, '.git'))) return 'escaping'
    current = parent
  }
}

/**
 * 读目标的文本内容（不存在返回 `null`）。
 * @param ctx - 插件上下文。
 * @param target - 已解析目标。
 * @returns 文本内容或 `null`。
 */
async function readTarget(ctx: Context, target: FsTarget): Promise<string | null> {
  const info = await ctx.fs.stat(target)
  if (info === undefined || info.type !== 'file') return null
  return ctx.fs.readText(target)
}

/**
 * 删除目标（补齐 dsh 写入守卫缺失的删除原语；失败即抛，由调用方按文件记录）。
 * @param ctx - 插件上下文。
 * @param target - 已解析目标。
 */
async function deleteTarget(ctx: Context, target: FsTarget): Promise<void> {
  await rm(fileURLToPath(ctx.fs.fileUrl(target)))
}

/**
 * 目标 → 绝对路径。
 * @param ctx - 插件上下文。
 * @param target - 已解析目标。
 * @returns 绝对路径。
 */
function fileUrlPath(ctx: Context, target: FsTarget): string {
  return fileURLToPath(ctx.fs.fileUrl(target))
}

/**
 * 把相对路径锚定到沙箱根。
 * @param root - 沙箱根。
 * @param path - 记录里的文件路径（绝对或相对根）。
 * @returns 绝对路径。
 */
function absoluteOf(root: string, path: string): string {
  if (/^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('/')) return path
  return `${root.replace(/[\\/]+$/u, '')}/${path}`
}

/** 归属派生：actor（工具执行对象）→ 会话/回合/画布节点/用户/来源。 */
async function attributeOf(
  actor: object | undefined,
  runtime: FrameworkRuntime,
  calls: Map<string, Map<string, CallAttribution>>,
): Promise<{
  sessionKey: string | null
  agentId: string | null
  userId: string | null
  turn: number | null
  callId: string | null
  origin: 'agent' | 'revert' | 'user'
  revertOf?: readonly string[]
}> {
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- `object` has no properties; the cast supplies them
  const exec = actor as { callId?: string; agent?: { session?: { id?: unknown }; ctx?: unknown } } | undefined
  const sessionId = exec?.agent?.session?.id
  const sessionKey = typeof sessionId === 'string' ? sessionId : null
  if (sessionKey === null) {
    // 无会话上下文（例如人经产品写路由直接写盘）：归属用户、来源 user。
    return { sessionKey: null, agentId: null, userId: null, turn: null, callId: null, origin: 'user' }
  }
  const callId = exec?.callId === undefined ? null : exec.callId
  const turn = callId === null ? null : calls.get(sessionKey)?.get(callId)?.turn ?? null
  // 归属用户走运行域的同一份解析：分支/草稿会话与子代理子会话没有自己的台账行，
  // 只认 `ledger.byKey` 会让它们的 agent 写入落成 `user_id=null`——台账可见性按用户过滤，
  // 这些记录随后既不出现在变更面板里，也不能按轮次撤回。
  const owner = await runtime.runs.ownerOf(sessionKey)
  const nodeId = runtime.runs.agentIdOf(sessionKey)
  const isToolWrite = callId !== null
  return {
    sessionKey,
    agentId: nodeId,
    userId: owner,
    turn,
    callId,
    origin: isToolWrite ? 'agent' : 'user',
  }
}
