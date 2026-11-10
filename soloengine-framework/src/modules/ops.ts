/**
 * 操作区共享操作表（PRD-08 FR-OPS-010 / FR-OPS-012；PRD-09 FR-FC-004~011）。
 *
 * 同一组操作在浏览器侧有两条入口：产品页面（`/api/solo/*`，Bearer 令牌）与运行面板
 * （`/soloengine/*`，信任门）。两条入口只差**鉴权与归属解析**，操作本体只有一份：
 * 本模块给出「入参 → `runtime.workspace.*` / `runtime.changes.*`」的处理器表，框架层
 * `router.ts` 与 host 侧 `ops-bridge.ts` 只把各自的请求归一成 {@link OpsInput} 并发送
 * {@link OpsOutcome}。
 *
 * @module @soloengine/framework/modules/ops
 */

import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'

/**
 * 一次操作请求的输入（两个适配器归一到同构字段）。
 *
 * `projectId` 与 `sessionKey` 是**已鉴权的归属**：产品页面来自令牌 + 请求字段，
 * 运行面板来自归属台账（`sessionKey → 行 → user_id + run_project_id`），都不由前端上报。
 */
export interface OpsInput {
  /** 请求级用户。 */
  userId: string
  /** 运行项目 id（沙箱根身份）。 */
  projectId: string
  /** 归属会话键（产品页面的工作区写入无会话上下文时为 `null`）。 */
  sessionKey: string | null
  /** 请求来源（回环判定）。 */
  remoteAddress: string | undefined
  /** 取请求字段：body 优先、query 次之；未给出为 `undefined`。 */
  field(name: string): unknown
}

/** 一次操作的响应。 */
export interface OpsOutcome {
  /** HTTP 状态码。 */
  status: number
  /** 响应体（已含 `ok`）。 */
  body: unknown
}

/** 操作表中的一项。 */
export interface OpsRoute {
  /** 稳定路由 id（`/routes` 取证与文档映射）。 */
  id: string
  /** HTTP 方法。 */
  method: 'get' | 'post' | 'put' | 'delete'
  /** 相对路径（不含 `/workspace`、`/changes` 前缀；台账列表为 `''`）。 */
  path: string
  /** 一句话说明。 */
  summary: string
  /**
   * 执行该操作。
   * @param runtime - 框架层运行时。
   * @param input - 归一后的请求输入。
   * @returns 状态码与响应体。
   */
  handle(runtime: FrameworkRuntime, input: OpsInput): Promise<OpsOutcome>
}

/** 取字符串字段（缺省为空串；与旧「body.x ?? ''」一致）。 */
function text(input: OpsInput, name: string): string {
  const value = input.field(name)
  return value === undefined || value === null ? '' : String(value)
}

/** 取可选字符串字段（缺省为 `undefined`）。 */
function optionalText(input: OpsInput, name: string): string | undefined {
  const value = input.field(name)
  return value === undefined || value === null ? undefined : String(value)
}

/** 取数字字段（缺省 `undefined`；非有限数即拒绝，不静默换算）。 */
function number(input: OpsInput, name: string): number | undefined {
  const raw = input.field(name)
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new FrameworkError(400, 'FIELD_INVALID', `${name} must be a finite number`)
  }
  return value
}

/** 取双确认标志（只认 JSON 布尔 `true`；字符串 "true" 不算确认）。 */
function confirmed(input: OpsInput, name: string): boolean {
  return input.field(name) === true
}

/** 取数组字段（非数组视作缺省）。 */
function array(input: OpsInput, name: string): string[] | undefined {
  const value = input.field(name)
  return Array.isArray(value) ? value.map(String) : undefined
}

/** 工作区文件域操作（`/workspace` 前缀）。 */
export const WORKSPACE_OPS: readonly OpsRoute[] = [
  {
    id: 'workspace-list',
    method: 'get',
    path: 'list',
    summary: '列举沙箱根内一层目录（懒加载）',
    handle: async (runtime, input) => ({
      status: 200,
      body: { ok: true, listing: await runtime.workspace.list(input.userId, input.projectId, text(input, 'path'), input.remoteAddress) },
    }),
  },
  {
    id: 'workspace-stat',
    method: 'get',
    path: 'stat',
    summary: '沙箱根内单条路径 stat（版本 = mtimeMs）',
    handle: async (runtime, input) => ({
      status: 200,
      body: { ok: true, stat: await runtime.workspace.stat(input.userId, input.projectId, text(input, 'path'), input.remoteAddress) },
    }),
  },
  {
    id: 'workspace-read',
    method: 'get',
    path: 'read',
    summary: '沙箱根内文件行窗口读取（分页）',
    handle: async (runtime, input) => ({
      status: 200,
      body: {
        ok: true,
        file: await runtime.workspace.read(input.userId, input.projectId, text(input, 'path'), {
          ...number(input, 'offset') === undefined ? {} : { offset: number(input, 'offset') },
          ...number(input, 'limit') === undefined ? {} : { limit: number(input, 'limit') },
          ...input.remoteAddress === undefined ? {} : { remoteAddress: input.remoteAddress },
        }),
      },
    }),
  },
  {
    id: 'workspace-search',
    method: 'get',
    path: 'search',
    summary: '沙箱根内按名称递归搜索（跳过 .git/node_modules）',
    handle: async (runtime, input) => ({
      status: 200,
      body: { ok: true, ...await runtime.workspace.search(input.userId, input.projectId, text(input, 'q'), input.remoteAddress) },
    }),
  },
  {
    id: 'workspace-write',
    method: 'put',
    path: 'file',
    summary: '写入沙箱根内文件（mtime 冲突检测；编辑器保存）',
    handle: async (runtime, input) => ({
      status: 200,
      body: {
        ok: true,
        result: await runtime.workspace.write(input.userId, input.projectId, text(input, 'path'), text(input, 'text'), {
          ...number(input, 'expectedMtimeMs') === undefined ? {} : { expectedMtimeMs: number(input, 'expectedMtimeMs') },
          ...confirmed(input, 'createOnly') ? { createOnly: true } : {},
          ...input.sessionKey === null ? {} : { sessionKey: input.sessionKey },
          ...input.remoteAddress === undefined ? {} : { remoteAddress: input.remoteAddress },
        }),
      },
    }),
  },
  {
    id: 'workspace-mkdir',
    method: 'post',
    path: 'directory',
    summary: '新建沙箱根内目录（双确认）',
    handle: async (runtime, input) => ({
      status: 201,
      body: {
        ok: true,
        ...await runtime.workspace.mkdir(input.userId, input.projectId, text(input, 'path'), confirmed(input, 'confirm'), input.remoteAddress),
      },
    }),
  },
  {
    id: 'workspace-rename',
    method: 'post',
    path: 'rename',
    summary: '重命名/移动沙箱根内条目（双确认 + mtime 冲突）',
    handle: async (runtime, input) => ({
      status: 200,
      body: {
        ok: true,
        ...await runtime.workspace.rename(
          input.userId,
          input.projectId,
          text(input, 'from'),
          text(input, 'to'),
          confirmed(input, 'confirm'),
          {
            ...number(input, 'expectedMtimeMs') === undefined ? {} : { expectedMtimeMs: number(input, 'expectedMtimeMs') },
            ...input.remoteAddress === undefined ? {} : { remoteAddress: input.remoteAddress },
          },
        ),
      },
    }),
  },
  {
    id: 'workspace-delete',
    method: 'delete',
    path: 'entry',
    summary: '删除沙箱根内文件或目录（双确认）',
    handle: async (runtime, input) => ({
      status: 200,
      body: {
        ok: true,
        ...await runtime.workspace.remove(
          input.userId,
          input.projectId,
          text(input, 'path'),
          confirmed(input, 'confirm'),
          input.remoteAddress,
          input.sessionKey ?? undefined,
        ),
      },
    }),
  },
]

/** 文件变更台账操作（`/changes` 前缀）。 */
export const CHANGES_OPS: readonly OpsRoute[] = [
  {
    id: 'changes-list',
    method: 'get',
    path: '',
    summary: '变更台账查询（按会话/回合/文件过滤；含 hunks）',
    handle: async (runtime, input) => {
      const turn = number(input, 'turn')
      const limit = number(input, 'limit')
      const filePath = optionalText(input, 'filePath')
      const query = {
        ...input.sessionKey === null || input.sessionKey === '' ? {} : { sessionKey: input.sessionKey },
        ...turn === undefined ? {} : { turn },
        ...filePath === undefined ? {} : { filePath },
        ...limit === undefined ? {} : { limit },
      }
      return {
        status: 200,
        body: {
          ok: true,
          changes: await runtime.changes.list(input.userId, query),
          summary: await runtime.changes.summary(input.userId, query),
        },
      }
    },
  },
  {
    id: 'changes-turn-view',
    method: 'get',
    path: 'turn',
    summary: '回合视图（同文件多次写入聚合为净变更，过程视图可展开）',
    handle: async (runtime, input) => {
      const turn = number(input, 'turn')
      if (turn === undefined) throw new FrameworkError(400, 'TURN_REQUIRED', 'turn is required for the turn view')
      const sessionKey = input.sessionKey ?? ''
      return {
        status: 200,
        body: { ok: true, sessionKey, turn, entries: await runtime.changes.turnView(input.userId, sessionKey, turn) },
      }
    },
  },
  {
    id: 'changes-review',
    method: 'post',
    path: 'review',
    summary: '审阅：整轮/逐文件/逐 hunk 保留或丢弃（只标记，不动磁盘）',
    handle: async (runtime, input) => {
      const status = optionalText(input, 'status')
      if (status !== 'accepted' && status !== 'rejected') {
        throw new FrameworkError(400, 'REVIEW_STATUS_INVALID', 'status must be accepted or rejected')
      }
      const changeId = optionalText(input, 'changeId')
      const filePath = optionalText(input, 'filePath')
      const turn = number(input, 'turn')
      const hunkIds = array(input, 'hunkIds')
      return {
        status: 200,
        body: {
          ok: true,
          ...await runtime.changes.review({
            userId: input.userId,
            sessionKey: input.sessionKey ?? '',
            ...turn === undefined ? {} : { turn },
            ...filePath === undefined ? {} : { filePath },
            ...changeId === undefined ? {} : { changeId },
            status,
            ...hunkIds === undefined ? {} : { hunkIds },
          }),
        },
      }
    },
  },
  {
    id: 'changes-revert-plan',
    method: 'get',
    path: 'revert/plan',
    summary: '撤回计划（还原项 + 漂移跳过项；执行前确认用）',
    handle: async (runtime, input) => {
      const changeId = optionalText(input, 'changeId')
      const plan = await runtime.changes.revertPlan(
        input.userId,
        input.sessionKey ?? '',
        number(input, 'turn') ?? null,
        changeId === undefined || changeId === '' ? undefined : [changeId],
      )
      return { status: 200, body: { ok: true, plan } }
    },
  },
  {
    id: 'changes-revert',
    method: 'post',
    path: 'revert',
    summary: '执行按轮次撤回（最小还原 + 漂移检测；经守卫写回并补发观测）',
    handle: async (runtime, input) => {
      if (!confirmed(input, 'confirm')) {
        throw new FrameworkError(400, 'CONFIRMATION_REQUIRED',
          'a revert requires an explicit confirmation (confirm: true) after reviewing the restore list')
      }
      const sessionKey = input.sessionKey ?? ''
      const changeIds = array(input, 'changeIds')
      return {
        status: 200,
        body: {
          ok: true,
          ...await runtime.changes.revert({
            userId: input.userId,
            sessionKey,
            turn: number(input, 'turn') ?? null,
            ...changeIds === undefined ? {} : { changeIds },
            actor: { kind: 'soloengine-revert', userId: input.userId, sessionKey },
          }),
        },
      }
    },
  },
]
