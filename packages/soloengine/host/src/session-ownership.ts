/**
 * 会话归属解析（运行台账 + 会话树 + 运行项目目录）。
 *
 * 会话有三种来源，归属事实落在不同层：
 * - 画布运行：`runs.start` 在建会话前先写 `sessions` 台账行；
 * - 子代理子会话：运行驱动在创建窗口内写台账行；
 * - 客户端直接创建的会话（分支、面板新会话、草稿）：没有自己的台账行，父指向只在
 *   dsh 会话头（`header.parentSession`）里，归属要么沿父链落到已登记的根，要么落在
 *   会话头 cwd 命中的运行项目目录上。
 *
 * 本模块把这三条路径收敛成一次解析，供账号作用域、操作区桥与模型路由共用——同一份
 * 归属只此一处派生，避免各入口各写一套判定。
 *
 * @module @soloengine/host/session-ownership
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { FrameworkRuntime, SessionLedgerRow } from '@soloengine/framework'

/** 一次归属解析的结果：台账行与它对应的会话树根。 */
export interface SessionOwnership {
  /** 归属台账行（自己的行，或沿父链落到的那一行）。 */
  row: SessionLedgerRow
  /** 该行对应的会话树根键。 */
  rootSessionKey: string
}

/** 解析选项。 */
export interface OwnershipQuery {
  /** 请求账号：给出时只认该用户的行。 */
  userId?: string
  /** 产品实例（SoloEngine 映射为 agenticflow）：给出时只认该画布的运行项目。 */
  instance?: string
  /**
   * 无台账行时是否按 cwd 补登台账行。
   *
   * 补登只在「请求带实例」时可用：一个目录可能同时是多个画布的运行项目（实测同一测试
   * 目录被 6 个画布登记过），没有实例就没有唯一归属，宁可不认也不猜。
   */
  adopt?: boolean
}

/**
 * 取一棵会话树的根：沿会话头上溯到无父的一层。
 *
 * 读不到会话头（日志缺失）或遇到环（损坏的会话头）时停在当前节点，不陷入死循环。
 * @param ctx - 能读 `sessionPersistence` 的上下文。
 * @param sessionKey - 会话键。
 * @returns 会话树根键。
 */
export async function rootSessionKeyOf(ctx: Context, sessionKey: string): Promise<string> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return sessionKey
  let current = sessionKey
  const seen = new Set<string>([current])
  for (;;) {
    const header = (await persistence.stat(SessionId(current)))?.header
    if (header?.parentSession === undefined) return current
    const parent = String(header.parentSession)
    if (seen.has(parent)) return current
    seen.add(parent)
    current = parent
  }
}

/**
 * 解析一次会话归属（见模块注释）。
 *
 * 顺序：会话自己的台账行 → 会话树根的台账行 → （可选）cwd 命中的运行项目并补登根行。
 * @param ctx - 能读 `sessionPersistence` 的上下文。
 * @param runtime - 框架层运行时（台账与业务库）。
 * @param sessionKey - 会话键。
 * @param query - 账号/实例收窄与补登开关。
 * @returns 归属；无法确定时 `undefined`（调用方按自己的语义拒绝）。
 */
export async function resolveSessionOwnership(
  ctx: Context,
  runtime: FrameworkRuntime,
  sessionKey: string,
  query: OwnershipQuery = {},
): Promise<SessionOwnership | undefined> {
  if (sessionKey.trim() === '') return undefined
  const direct = await runtime.runs.ledger.byKey(sessionKey)
  if (direct !== undefined) {
    return matches(direct, query) ? { row: direct, rootSessionKey: sessionKey } : undefined
  }
  const rootSessionKey = await rootSessionKeyOf(ctx, sessionKey)
  if (rootSessionKey !== sessionKey) {
    const rootRow = await runtime.runs.ledger.byKey(rootSessionKey)
    if (rootRow !== undefined) {
      return matches(rootRow, query) ? { row: rootRow, rootSessionKey } : undefined
    }
  }
  if (query.adopt !== true) return undefined
  return await adopt(ctx, runtime, rootSessionKey, query)
}

/**
 * 台账行是否满足账号/实例收窄。
 * @param row - 归属行。
 * @param query - 解析选项。
 * @returns 是否匹配。
 */
function matches(row: SessionLedgerRow, query: OwnershipQuery): boolean {
  if (query.userId !== undefined && row.user_id !== query.userId) return false
  if (query.instance !== undefined && row.agentic_flow_id !== query.instance) return false
  return true
}

/**
 * 按会话头 cwd 命中运行项目并为会话树根补登台账行。
 *
 * 补登是重建入口（`POST /sessions/rebuild`）对同一事实的同一套规则：`run_projects.folder_path`
 * 是唯一可匹配的归属事实；匹配不到（或请求没有实例、无法在共享目录的多个画布间定夺）时
 * 返回 `undefined`，不捏造归属。
 * @param ctx - 能读 `sessionPersistence` 的上下文。
 * @param runtime - 框架层运行时。
 * @param rootSessionKey - 会话树根键。
 * @param query - 解析选项（必须带实例）。
 * @returns 补登后的归属；不满足条件时 `undefined`。
 */
async function adopt(
  ctx: Context,
  runtime: FrameworkRuntime,
  rootSessionKey: string,
  query: OwnershipQuery,
): Promise<SessionOwnership | undefined> {
  if (query.instance === undefined) return undefined
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return undefined
  const header = (await persistence.stat(SessionId(rootSessionKey)))?.header
  const cwd = header?.cwd
  if (cwd === undefined || cwd === '') return undefined
  const clauses = ['folder_path = ?', 'agentic_flow_id = ?']
  const params: string[] = [cwd, query.instance]
  if (query.userId !== undefined) {
    clauses.push('user_id = ?')
    params.push(query.userId)
  }
  const projects = await runtime.db.prepare(
    `SELECT id, user_id FROM run_projects WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 1`,
  ).all<{ id: string; user_id: string }>(...params)
  const project = projects[0]
  if (project === undefined) return undefined
  const createdAt = typeof header?.createdAt === 'number' ? header.createdAt : Date.now()
  let row: SessionLedgerRow | undefined
  try {
    row = await runtime.runs.ledger.recover({
      session_key: rootSessionKey,
      user_id: project.user_id,
      agentic_flow_id: query.instance,
      run_project_id: project.id,
      created_at: createdAt,
    })
  } catch (error) {
    // 并发补登会撞 (session_key) 唯一约束；重读一次即可，其他失败如实抛出。
    row = await runtime.runs.ledger.byKey(rootSessionKey)
    if (row === undefined) throw error
  }
  if (!matches(row, query)) return undefined
  console.log(`soloengine: adopted session ${rootSessionKey} into run project ${project.id} (flow ${query.instance})`)
  return { row, rootSessionKey }
}
