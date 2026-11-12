/**
 * 文件变更台账域（PRD-09 全部 FR-FC-001~011；PRD-08 FR-OPS-009 的呈现面数据源）。
 *
 * 事实源纪律：台账是**变更缓存/索引，非权威**——权威是 dsh 原生 `fs/write-intent` /
 * `fs/edit-intent`（写前意图）与 `fs/observed`（写后观测）事件。本模块只做三件事：
 * 1. **内容寻址存储**（`file_content_blobs`）：变更前后内容以 sha256 为主键落库、同内容去重，
 *    并作为**撤回的还原源**；
 * 2. **台账记录**（`file_changes`）：判定 created/modified/deleted、行级差异与逐 hunk 结构、
 *    归属（会话/回合/画布节点/用户/工具调用）与 `origin` 三值；
 * 3. **审阅与撤回**：整轮/逐文件/逐 hunk 的保留（accepted）或丢弃（rejected，只标记不动磁盘）；
 *    按轮次撤回（最小还原 + 漂移检测 + 逐文件提交），撤回自身落 `origin='revert'` 记录。
 *
 * 语义要点（逐条对齐 PRD）：
 * - **记录集合**（FR-FC-007）：该轮 `origin='agent'` 且 `status != 'rejected'` 的记录；
 *   `origin='user'|'revert'` 不入集合，`rejected` 不参与还原。
 * - **逐 hunk 丢弃后撤回**（FR-FC-005 + FR-FC-007）：被丢弃的 hunk **不被还原**（其余照常还原），
 *   因此还原目标 = 「变更前内容 + 被丢弃 hunk 的新侧」。
 * - **同一文件的多次写入**（FR-FC-004 + FR-FC-007）：按文件聚合成一次净变更，还原目标是**轮首内容**
 *   ——从该文件该轮的最终记录态起逐条回放逆 delta（`revertStep`），不把文件留在轮内某次调用的中间态。
 * - **先增后删回到原内容**（FR-FC-004）：回合视图聚合后 `before === after` 即「无净变更」，不误报；
 *   撤回时该文件以 `NO_NET_CHANGE` 跳过，不制造空写。
 * - **漂移检测**（FR-FC-008）：撤回前比对磁盘当前内容哈希与记录的**变更后**内容哈希（文件级取该轮
 *   最终记录态）；不一致即跳过该文件并提示，其余文件照常恢复（不因部分漂移整体失败）。
 * - **行号错位**（FR-FC-005 与 FR-FC-007 的组合边界）：轮内有写入被整条丢弃且改变了行数时，
 *   更早记录的回退无法按行号锚定——该文件跳过（`ANCHOR_MISMATCH`）并给出原因，绝不盲写；
 *   单条记录内的逐 hunk 丢弃仍按记录行号精确还原。
 * - **二进制文件**（PRD-09 §5）：行级差异不适用——记录字节数与哈希、`content_type='binary'`，
 *   差异视图标注「二进制文件」，不产出 hunks。
 *
 * @module @soloengine/framework/modules/changes
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { structuredPatch } from 'diff'
import type { BusinessDatabase, SqlValue } from '../db/port.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { gateWorkspacePath } from '../sandbox/workspace-gate.ts'
import { FrameworkError } from './accounts.ts'

/** 变更来源三值（PRD-12 §6.10）。 */
export type ChangeOrigin = 'agent' | 'revert' | 'user'
/** 审阅状态（PRD-12 §6.10）。 */
export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'reverted'
/** 变更判定（PRD-09 FR-FC-003）。 */
export type ChangeOperation = 'created' | 'modified' | 'deleted'

/** 差异上下文行数（与官方 `tool-fs` 的 `DIFF_CONTEXT` 同值，保证三处同源可比）。 */
const DIFF_CONTEXT = 3
/** 单条 blob 的文本上限：超过即标记大文件、只留哈希与字节数（不静默截断内容）。 */
const MAX_BLOB_BYTES = 4 * 1024 * 1024
/** 二进制判定阈值：出现 NUL 字节即按二进制处理（不做行级差异）。 */
const BINARY_PROBE_BYTES = 8000

/** 一个逐 hunk 的结构（`hunks` 列 JSON 的成员）。 */
export interface ChangeHunk {
  /** hunk 在本记录内的稳定标识（`h0`、`h1`…）。 */
  id: string
  /** unified diff 头（`@@ -a,b +c,d @@`）。 */
  header: string
  /** 规范化的 patch 行（首字符为 ` `/`-`/`+`）。 */
  lines: string[]
  /** 该 hunk 的审阅状态（未裁决为 null）。 */
  status: 'accepted' | 'rejected' | null
  /** 变更前侧的起始行（1 基）与行数。 */
  oldStart: number
  oldLines: number
  /** 变更后侧的起始行（1 基）与行数。 */
  newStart: number
  newLines: number
  /** 旧侧末行是否缺换行（来自 unified diff 的 `\ No newline at end of file` 注记）。 */
  oldNoNewline: boolean
  /** 新侧末行是否缺换行。 */
  newNoNewline: boolean
}

/** 一条变更记录的视图（逐列真实读出，不派生第二副本）。 */
export interface FileChangeView {
  id: string
  sessionId: string | null
  /** 归属回合序号（取自原生 `tool/call` 事件的 `turn`；撤回与审阅都按它分组，见模块头注释）。 */
  messageId: number | null
  agentId: string | null
  userId: string | null
  filePath: string
  operation: ChangeOperation
  origin: ChangeOrigin
  toolCallId: string | null
  contentType: string
  beforeContentHash: string | null
  afterContentHash: string | null
  diffData: string | null
  linesAdded: number | null
  linesRemoved: number | null
  hunks: ChangeHunk[] | null
  status: ChangeStatus
  createdAt: string | null
  updatedAt: string | null
}

/** 台账原始行。 */
interface FileChangeRow {
  id: string
  session_id: string | null
  message_id: number | null
  agent_id: string | null
  user_id: string | null
  file_path: string
  operation: string
  origin: ChangeOrigin
  tool_call_id: string | null
  content_type: string | null
  before_content_hash: string | null
  after_content_hash: string | null
  diff_data: string | null
  lines_added: number | null
  lines_removed: number | null
  hunks: string | null
  status: string
  created_at: string | null
  updated_at: string | null
}

/** 写入一条变更记录的入参。 */
export interface ChangeRecordInput {
  /** 归属用户（`null` 表示公共/无归属，例如无会话上下文的写入）。 */
  userId: string | null
  origin: ChangeOrigin
  /** 归属会话键。 */
  sessionKey: string | null
  /** 归属回合序号。 */
  turn: number | null
  /** 归属画布节点。 */
  agentId: string | null
  /** 文件绝对路径。 */
  filePath: string
  /** 工具调用标识。 */
  toolCallId: string | null
  /** 变更前内容（`null` = 变更前不存在）。 */
  before: string | null
  /** 变更后内容（`null` = 变更后不存在，即删除）。 */
  after: string | null
}

/** 一次审阅操作。 */
export interface ReviewInput {
  userId: string
  sessionKey: string
  /** 限定回合（整轮审阅）。 */
  turn?: number
  /** 限定文件（逐文件审阅）。 */
  filePath?: string
  /** 限定记录（逐 hunk 审阅必须给出）。 */
  changeId?: string
  /** 目标状态。 */
  status: 'accepted' | 'rejected'
  /** 逐 hunk 审阅的 hunk 标识集合（给出即只改这些 hunk）。 */
  hunkIds?: string[]
}

/** 撤回计划中的单个还原项（**文件级**：同一文件在该轮的多次写入聚合成一个还原项）。 */
export interface RevertRestore {
  /** 该文件在该轮内的记录集合（按时间升序；还原成功后一并标记 `reverted`）。 */
  changeIds: string[]
  filePath: string
  /** 该记录集合的内容类型。 */
  contentType: string
  /** 还原目标内容（该轮开始前的内容 + 被丢弃 hunk 的新侧）。 */
  targetContent: string
  /** `true` = 该文件在该轮开始前不存在，还原即删除它（PRD FR-FC-003 的 created 反向）。 */
  delete: boolean
  /** 磁盘当前内容哈希（漂移比对用）。 */
  currentHash: string
  /** 该文件在该轮的**最终**记录态哈希（漂移判据）。 */
  recordedAfterHash: string | null
}

/** 撤回计划中的跳过项（文件级：`changeId` 为该文件该轮的首条记录）。 */
export interface RevertSkip {
  changeId: string
  filePath: string
  /** 跳过原因码（见 {@link RevertSkipCode}）。 */
  code: RevertSkipCode
  /** 人类可读原因（呈现给用户）。 */
  reason: string
}

/** 跳过原因码：漂移 / 裁决丢弃 / 还原源缺失 / 无净变更 / 行位置无法锚定。 */
export type RevertSkipCode =
  | 'DRIFTED'
  | 'REJECTED'
  | 'BLOB_MISSING'
  | 'LARGE_FILE'
  | 'NO_NET_CHANGE'
  | 'ANCHOR_MISMATCH'

/** 撤回计划。 */
export interface RevertPlan {
  sessionKey: string
  turn: number | null
  restores: RevertRestore[]
  skipped: RevertSkip[]
}

/** 台账查询入参。 */
export interface ChangeQuery {
  /** 会话键（可选）。 */
  sessionKey?: string
  /** 回合序号（可选）。 */
  turn?: number
  /** 文件路径（可选）。 */
  filePath?: string
  /** 上限（默认 500）。 */
  limit?: number
}

/** 回合视图的一项（一个文件的净变更 + 过程展开）。 */
export interface TurnViewEntry {
  filePath: string
  operation: ChangeOperation
  status: ChangeStatus
  beforeContentHash: string | null
  afterContentHash: string | null
  linesAdded: number
  linesRemoved: number
  /** 是否有净变更（先增后删回到原内容即为 false，不误报）。 */
  netChange: boolean
  /** 该文件在本回合内的每一次工具调用记录（过程视图）。 */
  process: FileChangeView[]
}

/**
 * 把内容哈希化（sha256 hex）——内容寻址的主键，也是漂移比对的判据。
 * @param content - 文本内容。
 * @returns 十六进制哈希。
 */
function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * 判断内容是否二进制（出现 NUL 字节即按二进制；只探测前若干字节，避免整文件扫描）。
 * @param content - 文本内容（已按 UTF-8 解码）。
 * @returns 是否二进制。
 */
function looksBinary(content: string): boolean {
  const probe = content.slice(0, BINARY_PROBE_BYTES)
  return probe.includes('\u0000')
}

/**
 * 计算行级差异：unified patch 文本 + 增删行数 + 逐 hunk 结构（含行号区间）。
 * @param before - 变更前内容。
 * @param after - 变更后内容。
 * @returns 差异三元组。
 */
function computeDiff(before: string, after: string): {
  diffData: string
  linesAdded: number
  linesRemoved: number
  hunks: ChangeHunk[]
} {
  const patch = structuredPatch('a', 'b', before, after, undefined, undefined, { context: DIFF_CONTEXT })
  const hunks: ChangeHunk[] = []
  let linesAdded = 0
  let linesRemoved = 0
  for (const [index, hunk] of patch.hunks.entries()) {
    const lines: string[] = []
    // 末行缺换行的注记标注的是内容属性（文件最后一行没有换行符），必须记录下来：
    // 逐 hunk 贴回时靠它恢复「末行换行」的真实形态。注记行本身不进 `lines`（不泄漏进差异视图）。
    let oldNoNewline = false
    let newNoNewline = false
    let previousMarker = ''
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) {
        if (previousMarker === '-' || previousMarker === ' ' || previousMarker === '') oldNoNewline = true
        if (previousMarker === '+' || previousMarker === ' ' || previousMarker === '') newNoNewline = true
        continue
      }
      previousMarker = line.charAt(0)
      lines.push(line)
      if (line.startsWith('+')) linesAdded += 1
      else if (line.startsWith('-')) linesRemoved += 1
    }
    hunks.push({
      id: `h${String(index)}`,
      header: `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
      lines,
      status: null,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      oldNoNewline,
      newNoNewline,
    })
  }
  const diffData = hunks.map(hunk => `${hunk.header}\n${hunk.lines.join('\n')}`).join('\n')
  return { diffData, linesAdded, linesRemoved, hunks }
}

/**
 * 取一个 hunk 的某一侧行文本（context 行两侧都有）。
 * @param hunk - hunk 结构。
 * @param side - 取哪一侧。
 * @returns 该侧的行数组。
 */
function sideLines(hunk: ChangeHunk, side: 'old' | 'new'): string[] {
  const out: string[] = []
  for (const line of hunk.lines) {
    const marker = line.charAt(0)
    const text = line.slice(1)
    if (marker === ' ') out.push(text)
    else if (side === 'old' && marker === '-') out.push(text)
    else if (side === 'new' && marker === '+') out.push(text)
  }
  return out
}

/**
 * 校验一组 hunk 在给定内容上能否按行号锚定（该侧每一段的行文本必须逐行相等）。
 *
 * 撤回链从最终记录态逐条回退：只要中间有记录被整条丢弃（保留新侧）并改变了行数，
 * 更早记录的 `newStart` 就会与当前内容错位；按错位行号贴回会静默写错文件。
 * 锚定不上即由调用方跳过该文件并给出结构化原因，绝不盲写。
 * @param content - 当前内容。
 * @param hunks - 待贴回的 hunks。
 * @param side - 校验哪一侧。
 * @returns 是否全部可锚定（纯插入的 hunk 无该侧行，视为可锚定）。
 */
function hunksAnchor(content: string, hunks: readonly ChangeHunk[], side: 'old' | 'new'): boolean {
  const { lines } = splitText(content)
  for (const hunk of hunks) {
    const start = side === 'old' ? hunk.oldStart : hunk.newStart
    const count = side === 'old' ? hunk.oldLines : hunk.newLines
    if (count === 0) continue
    const expected = sideLines(hunk, side)
    const actual = lines.slice(start - 1, start - 1 + count)
    if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) return false
  }
  return true
}

/**
 * 某个 hunk 在给定侧是否「末行缺换行」（读 `computeDiff` 记录的注记标志）。
 * @param hunk - hunk 结构。
 * @param side - 问哪一侧。
 * @returns 该侧末行是否缺换行。
 */
function lacksTrailingNewline(hunk: ChangeHunk, side: 'old' | 'new'): boolean {
  return side === 'old' ? hunk.oldNoNewline : hunk.newNoNewline
}

/**
 * 以某一侧为起点，把给定 hunks 的**另一侧**贴回去（用于「逐 hunk 丢弃」的精确还原与全量重放）。
 *
 * 语义：`base` 是 `baseSide` 那一侧的内容；结果 = 逐个把 hunk 在 base 侧的区间替换为另一侧的行。
 * 逆序应用（从文件尾向文件头）以保证行号在替换过程中保持稳定；末行换行由 hunk 的
 * `oldNoNewline`/`newNoNewline` 注记推定（空文件与无尾换行两个边界由此覆盖）。
 *
 * @param base - 起点内容（变更前或变更后的整文件文本）。
 * @param hunks - 要贴回的 hunks（按文件顺序）。
 * @param baseSide - `base` 是哪一侧。
 * @returns 贴回后的内容。
 */
function overlayHunks(base: string, hunks: readonly ChangeHunk[], baseSide: 'old' | 'new'): string {
  if (hunks.length === 0) return base
  const { lines, trailing } = splitText(base)
  const baseLength = lines.length
  const opposite: 'old' | 'new' = baseSide === 'old' ? 'new' : 'old'
  const ordered = [...hunks].sort((left, right) => (baseSide === 'old' ? right.oldStart - left.oldStart : right.newStart - left.newStart))
  // 结果末行换行：先继承 base 的形态；若某个 hunk 覆盖了 base 侧的文件尾，则以另一侧的注记为准。
  let resultTrailing = trailing
  for (const hunk of ordered) {
    const start = baseSide === 'old' ? hunk.oldStart : hunk.newStart
    const count = baseSide === 'old' ? hunk.oldLines : hunk.newLines
    const replacement = sideLines(hunk, opposite)
    // unified diff 的行号是 1 基；`count === 0` 的纯插入落在 `start` 之后（即 1 基行号本身）。
    const index = count === 0 ? start : start - 1
    lines.splice(Math.max(0, index), count, ...replacement)
    const touchesEnd = count === 0 ? start >= baseLength : start - 1 + count >= baseLength
    if (touchesEnd) resultTrailing = !lacksTrailingNewline(hunk, opposite)
  }
  return joinText(lines, resultTrailing)
}

/**
 * 把文本切成行并把「末行是否有换行」单列出来（空文件为零行，不留幻影空行）。
 * @param text - 文本。
 * @returns 行数组与末行换行标志。
 */
function splitText(text: string): { lines: string[]; trailing: boolean } {
  if (text === '') return { lines: [], trailing: false }
  const trailing = text.endsWith('\n')
  const body = trailing ? text.slice(0, -1) : text
  return { lines: body.split('\n'), trailing }
}

/**
 * 行数组按「末行换行标志」拼回文本。
 * @param lines - 行数组。
 * @param trailing - 末行是否带换行。
 * @returns 文本（零行即空串）。
 */
function joinText(lines: readonly string[], trailing: boolean): string {
  if (lines.length === 0) return ''
  return lines.join('\n') + (trailing ? '\n' : '')
}

/**
 * 计算一条记录的还原目标内容：变更前内容 + 被丢弃 hunk 的新侧。
 *
 * - 无 hunk 决策 → 返回变更前内容（整文件还原）；
 * - 有 hunk 被丢弃（`status='rejected'`）→ 这些 hunk **不还原**（保留新侧），其余照常还原。
 *
 * @param before - 记录的变更前内容。
 * @param hunks - 记录的 hunk 结构。
 * @returns 还原目标内容。
 */
function restoredContent(before: string, hunks: readonly ChangeHunk[] | null): string {
  const rejected = (hunks ?? []).filter(hunk => hunk.status === 'rejected')
  if (rejected.length === 0) return before
  return overlayHunks(before, rejected, 'old')
}

/**
 * 回退一步：把「某条记录的变更**后**内容」还原为它的变更**前**内容，被丢弃的 hunk 保留新侧。
 *
 * 这是 {@link restoredContent} 的镜像式（以变更后内容为起点，回退到变更前内容），用于同一文件在
 * 一轮内被写多次时的**逆 delta 链回放**——逐条回退才不会把文件留在轮内某次调用的中间态。
 *
 * @param after - 该记录的变更后内容（= 链上此步的起点）。
 * @param hunks - 该记录的 hunk 结构；`null`（二进制/大文件）时无行级结构可用，由调用方给整文件兜底。
 * @param fallback - `hunks === null` 时的整文件还原目标（该记录的变更前内容）。
 * @returns 还原后的内容。
 */
function revertStep(after: string, hunks: readonly ChangeHunk[] | null, fallback: string): string {
  if (hunks === null) return fallback
  const revertible = hunks.filter(hunk => hunk.status !== 'rejected')
  if (revertible.length === 0) return after
  return overlayHunks(after, revertible, 'new')
}

/** 撤回执行入参（由 host 侧的写回实现接收）。 */
export interface RevertExecutionInput {
  userId: string
  sessionKey: string
  /** 回合序号（与 `changeIds` 二选一）。 */
  turn: number | null
  /** 指定记录集合（对撤回记录再撤回时使用）。 */
  changeIds?: readonly string[]
  /** 扮演写者的对象（进入观测门禁与策略判定的 actor 位）。 */
  actor: object
}

/** 撤回执行结果（host 侧真实写回后回填）。 */
export interface RevertExecutionResult {
  plan: RevertPlan
  restored: string[]
  revertedChangeIds: string[]
  failures: { filePath: string; reason: string }[]
  /**
   * 该轮在主干预设插件里的内容寻址恢复点 id（`@anionex/dsh-turn-rewind` 的回合级检查点；
   * 无（非 Git 工作树根的工作区或主干缺失）即 `null`）——写回前的交叉核对凭据，**不是**还原源。
   */
  restorePoint: string | null
}

/**
 * 可见性条件：本人写入的行，或该行所属会话属于本人。
 *
 * 历史行可能没有 `user_id`（抓拍时未解析到归属），但 `session_id` 仍在；按会话归属兜底
 * 既能读到自己的行，也不会把别人的文件差异暴露给所有人。
 */
const CHANGE_VISIBILITY = '(user_id = ? OR session_id IN (SELECT session_key FROM sessions WHERE user_id = ?))'

/** 变更台账域服务。 */
export class ChangeLedgerService {
  private readonly db: BusinessDatabase
  /** 撤回的写回实现（由 host 侧的变更记录模块注入——写回必须经原生写入路径，见模块头注释）。 */
  private revertExecutor: ((input: RevertExecutionInput) => Promise<RevertExecutionResult>) | undefined

  /**
   * @param runtime - 框架层运行时（业务库直读/直写 + 运行项目沙箱根）。
   */
  constructor(private readonly runtime: FrameworkRuntime) {
    this.db = runtime.db
  }

  /**
   * 注入撤回执行器（写回经原生 `fs` 守卫 + 补发写后观测，必须由 host 侧完成）。
   * @param executor - 执行器。
   */
  attachRevertExecutor(executor: (input: RevertExecutionInput) => Promise<RevertExecutionResult>): void {
    this.revertExecutor = executor
  }

  /**
   * 执行一次撤回（先规划、再由注入的执行器真实写回）。
   * @param input - 撤回入参。
   * @returns 执行结果（还原项、跳过项、失败项与落账的 revert 记录）。
   */
  async revert(input: RevertExecutionInput): Promise<RevertExecutionResult> {
    if (this.revertExecutor === undefined) {
      throw new FrameworkError(503, 'REVERT_EXECUTOR_ABSENT',
        'the change recorder is not mounted in this composition; per-turn revert is unavailable')
    }
    return this.revertExecutor(input)
  }

  // ── 内容寻址存储（FR-FC-002）───────────────────────────────────────────────

  /**
   * 存一份内容（内容寻址、同内容去重）；超过上限的内容只记哈希与字节数（大文件标记）。
   * @param content - 文本内容。
   * @returns 内容哈希（主键）。
   */
  async storeBlob(content: string): Promise<string> {
    const hash = hashOf(content)
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_BLOB_BYTES) {
      // 大文件：只记哈希与字节数（不静默截断内容 → 撤回时对这类记录结构化拒绝）。
      await this.db.prepare(
        'INSERT OR IGNORE INTO file_content_blobs (content_hash, content, is_large_file, file_size, created_at) VALUES (?, NULL, 1, ?, ?)',
      ).run(hash, bytes, new Date().toISOString())
      return hash
    }
    await this.db.prepare(
      'INSERT OR IGNORE INTO file_content_blobs (content_hash, content, is_large_file, file_size, created_at) VALUES (?, ?, 0, ?, ?)',
    ).run(hash, content, bytes, new Date().toISOString())
    return hash
  }

  /**
   * 取回一份内容（撤回的还原源；完整性由哈希校验保证）。
   * @param hash - 内容哈希。
   * @returns 内容；不存在或大文件未存正文时返回 `null`。
   */
  async readBlob(hash: string): Promise<string | null> {
    const row = await this.db.prepare(
      'SELECT content FROM file_content_blobs WHERE content_hash = ?',
    ).get<{ content: string | null }>(hash)
    return row?.content ?? null
  }

  // ── 记录（FR-FC-001 / FR-FC-003）───────────────────────────────────────────

  /**
   * 写入一条变更记录（写前内容已由调用方抓拍）。
   *
   * 内容相同时**不落记录**（返回 `null`）：无变更即无记录，避免「先增后删回到原内容」误报。
   *
   * @param input - 记录入参。
   * @returns 新记录的视图，或 `null`（内容相同/二进制无法行级比较时仍落记录，见下）。
   */
  async record(input: ChangeRecordInput): Promise<FileChangeView | null> {
    const before = input.before
    const after = input.after
    if (before === null && after === null) return null
    if (before !== null && after !== null && before === after) return null

    const operation: ChangeOperation = before === null ? 'created' : after === null ? 'deleted' : 'modified'
    const binary = (before !== null && looksBinary(before)) || (after !== null && looksBinary(after))
    const beforeHash = before === null ? null : await this.storeBlob(before)
    const afterHash = after === null ? null : await this.storeBlob(after)
    const diff = binary
      ? { diffData: null, linesAdded: null, linesRemoved: null, hunks: null }
      : computeDiff(before ?? '', after ?? '')
    const now = new Date().toISOString()
    const id = randomUUID()
    await this.db.prepare(
      `INSERT INTO file_changes (
         id, session_id, message_id, agent_id, user_id, file_path, operation, origin, tool_call_id,
         content_type, before_content_hash, after_content_hash, diff_data, lines_added, lines_removed,
         hunks, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      input.sessionKey,
      input.turn,
      input.agentId,
      input.userId,
      input.filePath,
      operation,
      input.origin,
      input.toolCallId,
      binary ? 'binary' : 'text',
      beforeHash,
      afterHash,
      diff.diffData,
      diff.linesAdded,
      diff.linesRemoved,
      diff.hunks === null ? null : JSON.stringify(diff.hunks),
      now,
      now,
    )
    const row = await this.db.prepare('SELECT * FROM file_changes WHERE id = ?').get<FileChangeRow>(id)
    return toView(row as FileChangeRow)
  }

  // ── 查询（FR-FC-011）──────────────────────────────────────────────────────

  /**
   * 按会话 / 回合 / 文件过滤查询（归属按当前用户过滤：记录行属于该用户，或属于该用户名下的会话）。
   * @param userId - 请求级用户。
   * @param query - 过滤条件。
   * @returns 变更记录（按创建时间与 id 稳定排序）。
   */
  async list(userId: string, query: ChangeQuery): Promise<FileChangeView[]> {
    const clauses: string[] = [CHANGE_VISIBILITY]
    const params: SqlValue[] = [userId, userId]
    if (query.sessionKey !== undefined && query.sessionKey !== '') {
      clauses.push('session_id = ?')
      params.push(query.sessionKey)
    }
    if (query.turn !== undefined && Number.isFinite(query.turn)) {
      clauses.push('message_id = ?')
      params.push(Math.floor(query.turn))
    }
    if (query.filePath !== undefined && query.filePath !== '') {
      clauses.push('file_path = ?')
      params.push(query.filePath)
    }
    const limit = Math.min(5000, Math.max(1, Math.floor(query.limit ?? 500)))
    return (await this.rowsWithin(userId, clauses, params, limit)).map(toView)
  }

  /**
   * 回合视图（FR-FC-004）：一个回合的**净变更**（同文件多次写入聚合），过程视图可展开。
   *
   * 只聚合 `origin='agent'` 的记录（`user`/`revert` 不入 agent 回合视图）。
   *
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @param turn - 回合序号。
   * @returns 按文件分组的净变更条目。
   */
  async turnView(userId: string, sessionKey: string, turn: number): Promise<TurnViewEntry[]> {
    // 回合号只在单个会话内唯一：没有会话键的回合视图会把同一用户名下多个画布的同号回合
    // 合并成一份净变更（flow 隔离破裂），因此这里明确拒绝，而不是退化成跨会话查询。
    if (sessionKey.trim() === '') {
      throw new FrameworkError(400, 'SESSION_KEY_REQUIRED',
        'the turn view needs a session key: a turn number is only unique within one session')
    }
    const rows = (await this.list(userId, { sessionKey, turn, limit: 5000 }))
      .filter(row => row.origin === 'agent')
    const byFile = new Map<string, FileChangeView[]>()
    for (const row of rows) {
      const bucket = byFile.get(row.filePath)
      if (bucket === undefined) byFile.set(row.filePath, [row])
      else bucket.push(row)
    }
    const entries: TurnViewEntry[] = []
    for (const [filePath, process] of byFile) {
      const first = process[0] as FileChangeView
      const last = process[process.length - 1] as FileChangeView
      const beforeHash = first.beforeContentHash
      const afterHash = last.afterContentHash
      const netChange = beforeHash !== afterHash
      const operation: ChangeOperation = beforeHash === null ? 'created' : afterHash === null ? 'deleted' : 'modified'
      // 净变更为空时按「无净变更」呈现，行数统计归零（不误报）。
      // 行数按「轮首 → 轮末」的净变更统计（FR-FC-004）：逐条求和会把「创建后再修改」
      // 重复计成新增+删除；正文缺失（大文件/二进制）时退回逐条求和。
      let linesAdded = 0
      let linesRemoved = 0
      if (netChange) {
        const textual = process.every(row => (row.contentType ?? 'text') === 'text')
        const beforeContent = beforeHash === null ? '' : textual ? await this.readBlob(beforeHash) : null
        const afterContent = afterHash === null ? '' : textual ? await this.readBlob(afterHash) : null
        if (beforeContent !== null && afterContent !== null) {
          const net = computeDiff(beforeContent, afterContent)
          linesAdded = net.linesAdded ?? 0
          linesRemoved = net.linesRemoved ?? 0
        } else {
          linesAdded = process.reduce((sum, row) => sum + (row.linesAdded ?? 0), 0)
          linesRemoved = process.reduce((sum, row) => sum + (row.linesRemoved ?? 0), 0)
        }
      }
      const rejected = process.some(row => row.status === 'rejected')
      const accepted = process.every(row => row.status === 'accepted')
      entries.push({
        filePath,
        operation: netChange ? operation : 'modified',
        status: rejected ? 'rejected' : accepted ? 'accepted' : 'pending',
        beforeContentHash: netChange ? beforeHash : null,
        afterContentHash: netChange ? afterHash : null,
        linesAdded,
        linesRemoved,
        netChange,
        process,
      })
    }
    entries.sort((left, right) => left.filePath.localeCompare(right.filePath))
    return entries
  }

  /**
   * 统计（按会话或按当前用户全量：操作类型与状态分布 + 增删行数合计）。
   * @param userId - 请求级用户。
   * @param query - 过滤条件。
   * @returns 统计结果。
   */
  async summary(userId: string, query: ChangeQuery): Promise<{
    total: number
    byStatus: Record<string, number>
    byOperation: Record<string, number>
    linesAdded: number
    linesRemoved: number
  }> {
    // 在 SQL 里聚合：`list` 的 5000 行上限只用于展示，统计必须覆盖全部匹配行。
    const clauses: string[] = [CHANGE_VISIBILITY]
    const params: SqlValue[] = [userId, userId]
    if (query.sessionKey !== undefined && query.sessionKey !== '') {
      clauses.push('session_id = ?')
      params.push(query.sessionKey)
    }
    if (query.turn !== undefined && Number.isFinite(query.turn)) {
      clauses.push('message_id = ?')
      params.push(Math.floor(query.turn))
    }
    if (query.filePath !== undefined && query.filePath !== '') {
      clauses.push('file_path = ?')
      params.push(query.filePath)
    }
    const rows = await this.db.prepare(
      `SELECT status, operation, COUNT(*) AS count,
              COALESCE(SUM(lines_added), 0) AS added, COALESCE(SUM(lines_removed), 0) AS removed
         FROM file_changes WHERE ${clauses.join(' AND ')}
        GROUP BY status, operation`,
    ).all<{ status: string; operation: string; count: number; added: number; removed: number }>(...params)
    const byStatus: Record<string, number> = {}
    const byOperation: Record<string, number> = {}
    let total = 0
    let linesAdded = 0
    let linesRemoved = 0
    for (const row of rows) {
      total += Number(row.count)
      byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count)
      byOperation[row.operation] = (byOperation[row.operation] ?? 0) + Number(row.count)
      linesAdded += Number(row.added)
      linesRemoved += Number(row.removed)
    }
    return { total, byStatus, byOperation, linesAdded, linesRemoved }
  }

  // ── 审阅（FR-FC-005）──────────────────────────────────────────────────────

  /**
   * 审阅（整轮 / 逐文件 / 逐 hunk）：保留（accepted）或丢弃（rejected）——**只标记，不动磁盘**。
   *
   * - 逐 hunk 审阅：只改给定 `hunkIds` 的状态；行状态在「全部 hunk 已裁决」时收敛为
   *   accepted/rejected，未全部裁决则保持 pending（未裁决记录为 pending）。
   * - 整轮 / 逐文件审阅：整行状态置为目标状态，并把该行的全部 hunk 状态一并对齐。
   *
   * @param input - 审阅入参。
   * @returns 被更新的记录 id 列表。
   */
  async review(input: ReviewInput): Promise<{ updated: string[] }> {
    if (input.changeId !== undefined && input.changeId !== '') {
      const row = await this.rowById(input.userId, input.changeId)
      if (row === undefined) {
        throw new FrameworkError(404, 'CHANGE_NOT_FOUND', `file change ${input.changeId} not found for this user`)
      }
      if (input.hunkIds === undefined || input.hunkIds.length === 0) {
        // 逐文件裁决（PRD-09 FR-FC-005 的中间粒度）：带 changeId 而不带 hunkIds 就是对**这一条
        // 变更记录整体**下裁决。此前这里直接 400 要求 hunkIds，而 L686 遇到无 hunk 结构的记录时
        // 又让用户「改为按文件审阅」——按文件的路径根本不存在，逐文件按钮 100% 失败，
        // 空文件/二进制这类无行级差异的记录更是永远无法裁决。
        const hunks = parseHunks(row)
        if (hunks !== null) for (const hunk of hunks) hunk.status = input.status
        await this.writeHunks(row.id, hunks, input.status)
        return { updated: [row.id] }
      }
      const hunks = parseHunks(row)
      if (hunks === null) {
        throw new FrameworkError(409, 'HUNKS_UNAVAILABLE',
          `file change ${input.changeId} carries no hunk structure (binary or large file) — review it per file instead`)
      }
      const target = new Set(input.hunkIds)
      const missing = [...target].filter(id => !hunks.some(hunk => hunk.id === id))
      if (missing.length > 0) {
        throw new FrameworkError(400, 'HUNK_NOT_FOUND', `hunks ${missing.join(', ')} do not exist on ${input.changeId}`)
      }
      for (const hunk of hunks) if (target.has(hunk.id)) hunk.status = input.status
      const decided = hunks.every(hunk => hunk.status !== null)
      const status: ChangeStatus = hunkStatusOf(hunks, input.status, decided)
      await this.writeHunks(row.id, hunks, status)
      return { updated: [row.id] }
    }

    const clauses: string[] = [CHANGE_VISIBILITY, 'session_id = ?']
    const params: SqlValue[] = [input.userId, input.userId, input.sessionKey]
    if (input.turn !== undefined && Number.isFinite(input.turn)) {
      clauses.push('message_id = ?')
      params.push(Math.floor(input.turn))
    }
    if (input.filePath !== undefined && input.filePath !== '') {
      clauses.push('file_path = ?')
      params.push(input.filePath)
    }
    if (input.turn === undefined && (input.filePath === undefined || input.filePath === '')) {
      throw new FrameworkError(400, 'REVIEW_SCOPE_REQUIRED',
        'a turn or a file path is required: whole-turn review names the turn, per-file review names the file')
    }
    const rows = await this.rowsWithin(input.userId, clauses, params, 5000)
    if (rows.length === 0) {
      throw new FrameworkError(404, 'CHANGE_NOT_FOUND',
        `no file change matches the review scope (session=${input.sessionKey}, turn=${String(input.turn ?? '*')}, file=${input.filePath ?? '*'})`)
    }
    for (const row of rows) {
      const hunks = parseHunks(row)
      if (hunks !== null) for (const hunk of hunks) hunk.status = input.status
      await this.writeHunks(row.id, hunks, input.status)
    }
    return { updated: rows.map(row => row.id) }
  }

  // ── 撤回（FR-FC-007 / FR-FC-008 / FR-FC-009）───────────────────────────────

  /**
   * 规划一次撤回：最小还原（只动记录内的文件）+ 漂移检测（逐文件跳过并给出原因）。
   *
   * 记录集合：给出 `changeIds` 时即这些记录（用于「对撤回记录再撤回」）；
   * 否则为该轮 `origin='agent'` 且 `status != 'rejected'` 的记录。
   *
   * **文件级聚合**（FR-FC-004 + FR-FC-007）：同一文件在该轮内的多次写入是一次净变更，还原目标是
   * **该轮开始前**的内容——因此按文件分组、从该文件该轮的**最终记录态**起逐条回放逆 delta
   * （被丢弃的 hunk 保留新侧），而不是把每条记录各自还原（后者会把文件留在轮内某次调用的中间态）。
   * 漂移判据也移到文件级：磁盘当前内容必须等于该文件该轮的最终记录态。
   *
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @param turn - 回合序号（与 `changeIds` 二选一）。
   * @param changeIds - 指定记录集合（可选）。
   * @returns 撤回计划（还原项与跳过项）。
   */
  async revertPlan(userId: string, sessionKey: string, turn: number | null, changeIds?: readonly string[]): Promise<RevertPlan> {
    const root = await this.sandboxRootOf(userId, sessionKey)
    const rows = await this.revertRows(userId, sessionKey, turn, changeIds)
    const restores: RevertRestore[] = []
    const skipped: RevertSkip[] = []

    // 按文件分组（保持 `created_at` 升序 → 组内即该文件的写入链）。
    const groups = new Map<string, FileChangeRow[]>()
    for (const row of rows) {
      const group = groups.get(row.file_path)
      if (group === undefined) groups.set(row.file_path, [row])
      else group.push(row)
    }

    for (const [filePath, group] of groups) {
      const head = group[0] as FileChangeRow
      const tail = group[group.length - 1] as FileChangeRow
      const live = group.filter(row => row.status !== 'rejected')
      if (live.length === 0) {
        // 该文件的全部变更都被丢弃（rejected）：裁决已明确保留，不还原（FR-FC-005）。
        for (const row of group) {
          skipped.push({
            changeId: row.id, filePath, code: 'REJECTED',
            reason: '该记录已被审阅丢弃（rejected），不参与还原',
          })
        }
        continue
      }

      // 漂移判据（FR-FC-008）：磁盘当前内容必须等于该文件在该轮的最终记录态。
      const current = this.diskContent(root, filePath)
      if (tail.after_content_hash === null) {
        if (current !== null) {
          skipped.push({ changeId: head.id, filePath, code: 'DRIFTED', reason: '该文件在本轮被删除后又被重新创建（与记录不一致），跳过以免覆盖' })
          continue
        }
      } else if (current === null) {
        skipped.push({ changeId: head.id, filePath, code: 'DRIFTED', reason: '文件已不在磁盘上（与记录不一致），跳过' })
        continue
      } else if (hashOf(current.content) !== tail.after_content_hash) {
        skipped.push({ changeId: head.id, filePath, code: 'DRIFTED', reason: '该文件已被后续改动（内容与记录不一致），跳过以免覆盖' })
        continue
      }

      // 还原目标：从最终记录态起，逐条回放逆 delta（组内连续写入构成 delta 链）。
      const contentType = tail.content_type ?? head.content_type ?? 'text'
      const anyHunks = live.some(row => parseHunks(row) !== null)
      let targetContent: string
      if (live.length === 1 && live.length === group.length && !anyHunks) {
        // 单条记录且无行级结构（二进制/大文件）：整文件还原，取变更前内容。
        const before = live[0]?.before_content_hash ?? null
        if (before === null) {
          targetContent = ''
        } else {
          const blob = await this.readBlob(before)
          if (blob === null) {
            skipped.push({
              changeId: head.id, filePath, code: 'LARGE_FILE',
              reason: `变更前内容（${before.slice(0, 12)}…）未存正文（大文件），无法按内容还原`,
            })
            continue
          }
          targetContent = blob
        }
      } else {
        let running = current === null ? '' : current.content
        let missing: RevertSkip | null = null
        // 逐条回退（从最后一条记录往最早一条）；被丢弃的 hunk 不在回退之列。
        for (const row of [...live].reverse()) {
          const hunks = parseHunks(row)
          // 行号错位（前面有被整条丢弃的写入改变了行数）时不能盲写：跳过并在计划里点名。
          if (hunks !== null && !hunksAnchor(running, hunks, 'new')) {
            missing = {
              changeId: row.id, filePath, code: 'ANCHOR_MISMATCH',
              reason: '该文件在轮内有被丢弃的写入且改变了行位置，按记录行号回退会写错内容；请逐 hunk 审阅后处理',
            }
            break
          }
          let fallback = running
          if (hunks === null && row.before_content_hash !== null) {
            const blob = await this.readBlob(row.before_content_hash)
            if (blob === null) {
              missing = {
                changeId: row.id, filePath, code: 'BLOB_MISSING',
                reason: `变更前内容（${row.before_content_hash.slice(0, 12)}…）未存正文（大文件或已回收），无法还原`,
              }
              break
            }
            fallback = blob
          }
          running = revertStep(running, hunks, fallback)
        }
        if (missing !== null) {
          skipped.push(missing)
          continue
        }
        targetContent = running
      }

      // 还原目标是「该轮开始前的内容」：该文件最早一条**参与还原**的记录之前不存在即删除
      // （created 的反向）。被丢弃（rejected）的首条记录不参与还原，不能用它判定「本就存在」。
      const firstLive = live[0] as FileChangeRow
      const deleteTarget = firstLive.before_content_hash === null
      if (!deleteTarget && current !== null && targetContent === current.content) {
        // 净变更为空（先增后删回到原内容）：无写入可做，如实标注而不制造一次空写（FR-FC-004）。
        skipped.push({
          changeId: firstLive.id, filePath, code: 'NO_NET_CHANGE',
          reason: '该文件在本轮结束时与轮首内容一致（无净变更），无需还原',
        })
        continue
      }
      restores.push({
        changeIds: live.map(row => row.id),
        filePath,
        contentType,
        targetContent,
        delete: deleteTarget,
        currentHash: current === null ? '' : hashOf(current.content),
        recordedAfterHash: tail.after_content_hash,
      })
    }
    return { sessionKey, turn, restores, skipped }
  }

  /**
   * 取一次撤回的记录集合（FR-FC-007 的记录集合定义）。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @param turn - 回合序号。
   * @param changeIds - 显式记录集合（给出即用它，用于「对撤回记录再撤回」）。
   * @returns 记录行（按时间升序）。
   */
  private async revertRows(
    userId: string,
    sessionKey: string,
    turn: number | null,
    changeIds?: readonly string[],
  ): Promise<FileChangeRow[]> {
    if (changeIds !== undefined && changeIds.length > 0) {
      const rows: FileChangeRow[] = []
      for (const id of changeIds) {
        const row = await this.rowById(userId, id)
        if (row !== undefined) rows.push(row)
      }
      if (rows.length !== changeIds.length) {
        throw new FrameworkError(404, 'CHANGE_NOT_FOUND', 'one or more requested file changes do not exist for this user')
      }
      // 显式记录集合只用于「对撤回记录再撤回」：记录必须属于本次撤回的会话（跨会话记录会在
      // 本会话的沙箱根按别人的文件路径回放，flow 隔离破裂），且人的手动写入
      // （`origin='user'`）不属于撤回记录集合（FR-FC-007）。
      if (rows.some(row => row.session_id !== sessionKey)) {
        throw new FrameworkError(404, 'CHANGE_NOT_FOUND',
          `one or more requested file changes do not belong to session ${sessionKey}`)
      }
      const userWrites = rows.filter(row => row.origin === 'user')
      if (userWrites.length > 0) {
        throw new FrameworkError(400, 'REVERT_SCOPE_INVALID',
          `file changes ${userWrites.map(row => row.id).join(', ')} record a person's own write (origin='user'); they never participate in a revert`)
      }
      return this.sortRows(rows)
    }
    if (turn === null || !Number.isFinite(turn)) {
      throw new FrameworkError(400, 'TURN_REQUIRED', 'a turn is required for a per-turn revert (or name explicit change ids)')
    }
    return (await this.rowsWithin(userId, [CHANGE_VISIBILITY, 'session_id = ?', 'message_id = ?'],
      [userId, userId, sessionKey, Math.floor(turn)], 5000))
      .filter(row => row.origin === 'agent')
  }

  /**
   * 记录行按「创建时间 + id」升序（显式记录集合给出的顺序不可信，链回放依赖真实先后）。
   * @param rows - 记录行。
   * @returns 排序后的记录行。
   */
  private sortRows(rows: readonly FileChangeRow[]): FileChangeRow[] {
    return [...rows].sort((left, right) => {
      const byTime = String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
    })
  }

  /**
   * 把一批记录标记为已撤回（`status='reverted'`）；撤回自身的写入由观测路径落 `origin='revert'` 新记录。
   * @param userId - 请求级用户。
   * @param changeIds - 已成功还原的记录 id。
   * @returns 被标记的记录数。
   */
  async markReverted(userId: string, changeIds: readonly string[]): Promise<number> {
    let count = 0
    for (const id of changeIds) {
      const row = await this.rowById(userId, id)
      if (row === undefined) continue
      await this.db.prepare('UPDATE file_changes SET status = ?, updated_at = ? WHERE id = ?')
        .run('reverted', new Date().toISOString(), id)
      count += 1
    }
    return count
  }

  // ── 内部 ─────────────────────────────────────────────────────────────────

  /**
   * 取会话的沙箱根（运行项目目录）——撤回的漂移比对与写回都在它之内。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @returns 沙箱根绝对路径。
   */
  private async sandboxRootOf(userId: string, sessionKey: string): Promise<string> {
    // 分支/草稿会话没有自己的台账行：运行域按会话树根回退解析归属（与模型路由同一份）。
    const owner = await this.runtime.runs.ownerOf(sessionKey)
    if (owner === null || (owner !== userId && owner !== '')) {
      throw new FrameworkError(404, 'SESSION_NOT_IN_LEDGER',
        `session ${sessionKey} has no run ledger row for this user; the change ledger serves runs of this instance only`)
    }
    const projectId = await this.runtime.runs.projectIdOf(sessionKey)
    if (projectId === null) {
      throw new FrameworkError(404, 'SESSION_NOT_IN_LEDGER',
        `session ${sessionKey} has no run ledger row for this user; the change ledger serves runs of this instance only`)
    }
    const project = await this.runtime.canvas.projectById(userId, projectId)
    if (project === undefined) {
      throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${projectId} not found for this user`)
    }
    return project.folder_path
  }

  /**
   * 读磁盘上的当前内容（经沙箱根门禁；文件不存在返回 `null`）。
   * @param root - 沙箱根。
   * @param filePath - 文件路径（绝对或相对根）。
   * @returns 内容与 mtime，或 `null`。
   */
  private diskContent(root: string, filePath: string): { content: string; mtimeMs: number } | null {
    const gated = gateWorkspacePath({ root, target: filePath })
    if (!gated.exists) return null
    if (statSync(gated.path).isDirectory()) return null
    return { content: readFileSync(gated.path, 'utf8'), mtimeMs: gated.mtimeMs ?? 0 }
  }

  /** 取一条记录（按用户可见性）。 */
  private async rowById(userId: string, id: string): Promise<FileChangeRow | undefined> {
    return await this.db.prepare(
      `SELECT * FROM file_changes WHERE id = ? AND ${CHANGE_VISIBILITY}`,
    ).get<FileChangeRow>(id, userId, userId)
  }

  /**
   * 条件查询原始行（可见性由 `clauses` 内的归属条件承担）。
   *
   * 取**最新** `limit` 行（倒序取再翻回时间正序）：按正序取前 N 会在超过上限时
   * 只返回最旧的记录，变更面板就看不到最近写入。
   */
  private async rowsWithin(_userId: string, clauses: readonly string[], params: readonly SqlValue[], limit: number): Promise<FileChangeRow[]> {
    const rows = await this.db.prepare(
      `SELECT * FROM file_changes WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all<FileChangeRow>(...params, limit)
    return rows.reverse()
  }

  /** 写回 hunks 与行状态。 */
  private async writeHunks(id: string, hunks: ChangeHunk[] | null, status: ChangeStatus): Promise<void> {
    await this.db.prepare('UPDATE file_changes SET hunks = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(hunks === null ? null : JSON.stringify(hunks), status, new Date().toISOString(), id)
  }
}

/**
 * 解析一条记录的 hunks JSON（解析失败即 fail loud，不静默当空）。
 * @param row - 台账行。
 * @returns hunk 数组，或 `null`（该记录无 hunk 结构）。
 */
function parseHunks(row: FileChangeRow): ChangeHunk[] | null {
  if (row.hunks === null || row.hunks === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(row.hunks)
  } catch (error) {
    throw new FrameworkError(500, 'HUNKS_UNREADABLE', `file_changes ${row.id} carries unparsable hunks: ${String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new FrameworkError(500, 'HUNKS_UNREADABLE', `file_changes ${row.id} hunks is not an array`)
  }
  return parsed as ChangeHunk[]
}

/**
 * 逐 hunk 审阅后行的状态：全部 hunk 已裁决时按最后一次决策收敛，否则保持 pending。
 * @param hunks - hunk 数组。
 * @param decided - 本次决策。
 * @param allDecided - 是否全部 hunk 已裁决。
 * @returns 行状态。
 */
function hunkStatusOf(hunks: readonly ChangeHunk[], decided: 'accepted' | 'rejected', allDecided: boolean): ChangeStatus {
  if (!allDecided) return 'pending'
  return hunks.every(hunk => hunk.status === decided) ? decided : 'pending'
}

/**
 * 行 → 视图。
 * @param row - 台账行。
 * @returns 视图（`hunks` 解析为 JSON，解析失败即 fail loud）。
 */
function toView(row: FileChangeRow): FileChangeView {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    agentId: row.agent_id,
    userId: row.user_id,
    filePath: row.file_path,
    operation: row.operation as ChangeOperation,
    origin: row.origin,
    toolCallId: row.tool_call_id,
    contentType: row.content_type ?? 'text',
    beforeContentHash: row.before_content_hash,
    afterContentHash: row.after_content_hash,
    diffData: row.diff_data,
    linesAdded: row.lines_added,
    linesRemoved: row.lines_removed,
    hunks: parseHunks(row),
    status: row.status as ChangeStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 供撤回路径复用的纯函数（逐 hunk 贴回的精确性由阶段 7 用例覆盖）。 */
export const changeDiffHelpers = { computeDiff, overlayHunks, restoredContent, revertStep, hashOf }
