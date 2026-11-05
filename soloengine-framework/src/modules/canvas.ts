/**
 * 画布（agenticflow）与运行项目域（PRD-02 FR-CANVAS-001~004、010~017、040~041）。
 *
 * - 画布定义存 `agentic_flows.canvas_data`（JSON：nodes / edges / settings）；
 * - 乐观锁（version）并发写拒绝后写者；
 * - 运行项目 = 用户 × 画布 × 目录去重（事务内先查后插），目录即沙箱工作区根；
 * - 项目内文件操作限定在沙箱根内（workspace gate：realpath + 前缀 + loopback）。
 *
 * @module @soloengine/framework/modules/canvas
 */

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import type { BusinessDatabase } from '../db/port.ts'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import type { CompileResult, NodePluginRow } from '@soloengine/types'
import { BUILTIN_ROLE_PRESETS } from '@soloengine/types'
import type { AgentRolePreset, CanvasNodeKind } from '@soloengine/types'
import { compileCanvas, CompileError } from '@soloengine/agent-compiler'
import { FrameworkError } from './accounts.ts'

/** 画布节点（PRD-02 §9 数据契约）：只有 agent 与 note 两种，角色是模板引用。 */
export interface CanvasNode {
  node_id: string
  kind: CanvasNodeKind
  /** 角色模板 id（agent 节点必填；注释节点为空）。 */
  role?: string
  name: string
  summary?: string
  model_ref?: string
  system_prompt?: string
  tools?: string[]
  skills?: string[]
  mcp_servers?: string[]
  /** 节点级插件：只挂进该节点对应的 agent 作用域（流程级插件不在这里）。 */
  plugins?: NodePluginRow[]
  sampling?: {
    temperature?: number
    max_tokens?: number
    max_input_tokens?: number
    max_output_tokens?: number
    frequency_penalty?: number
    presence_penalty?: number
    max_tool_calls?: number
  }
  position: { x: number; y: number }
}

/** 画布委派边（上级 → 下级）。 */
export interface CanvasEdge {
  edge_id: string
  from: string
  to: string
}

/** 画布全局设置（运行行为）。 */
export interface CanvasSettings {
  /**
   * 运行档位 = **原生权限预设名**（工作区可写 / 白名单自动 / 完全访问）。
   *
   * 不另立一套档位名：预设表与三档语义由平台的 `permission-presets` 拥有，这一格只是
   * 「这次运行默认选哪一档」，运行发起时按原样写入会话的权限预设。
   */
  run_mode?: 'workspace-write' | 'approve-for-me' | 'danger-full-access'
  /** 实时跟随（工具跟随开关）。 */
  live_follow?: boolean
  /** 画布内自定义角色模板（内置模板在 `@soloengine/types`；这里只存用户新增的，可无限扩充）。 */
  role_presets?: AgentRolePreset[]
  /** 实例插件差异（画布定制 → 当前 flow 的 harness 实例；不动基线）。 */
  plugins?: InstancePluginDiff
}

/** 一条实例内新增或替换的插件行。 */
export interface InstancePluginRowInput {
  /** 实例内唯一行 id（替换行沿用被替换行的 id）。 */
  id: string
  /** 插件包名（可带子路径）。 */
  name: string
  /** 插件配置。 */
  config?: unknown
  /**
   * 该行要替换的基线服务名（仅 `add` 行；装配层在装载前按 flow 隔离）。
   * 缺省表示该行不替换任何基线服务。
   */
  isolate?: string[]
}

/**
 * 实例插件差异：只作用于当前 agenticflow 的 harness 实例。
 *
 * 语义（Plan W3）：
 * - `disable`：该 flow 不启用这些组合行（客户端树按 W4 消费；宿主核心行拒绝按 flow 禁用）；
 * - `replace`：实例内以另一插件包影子化替换同 id 行；
 * - `add`：实例内新增插件行；
 * - `configure`：修改实例内新增/替换行的配置（基线行配置属全局组合，须先 replace）。
 */
export interface InstancePluginDiff {
  disable?: string[]
  replace?: InstancePluginRowInput[]
  add?: InstancePluginRowInput[]
  configure?: { id: string; config: unknown }[]
}

/** 画布数据（agenticflow 的完整定义）。 */
export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  settings?: CanvasSettings
}

/** 旧画布节点（`agent_type` 时代）：读入时归一为 kind + role，写回时只写新形状。 */
type LegacyCanvasNode = Omit<CanvasNode, 'kind' | 'role'> & {
  /** 运行时可能来自任意 JSON，故按 string 读；未知取值交给 `validateCanvas` 拒绝。 */
  kind?: string
  role?: string
  agent_type?: string
}

/** agentic_flows 行。 */
export interface CanvasRow {
  id: string
  user_id: string
  name: string
  description: string | null
  icon: string | null
  tags: string | null
  folder_path: string | null
  canvas_data: string | null
  is_template: number
  is_active: number
  created_at: string | null
  updated_at: string | null
  version: number
}

/** run_projects 行。 */
export interface RunProjectRow {
  id: string
  user_id: string
  agentic_flow_id: string
  name: string
  folder_path: string
  description: string | null
  is_active: number
  last_accessed_at: string | null
  created_at: string | null
  updated_at: string | null
  version: number
}

/** 画布对外视图。 */
export interface CanvasView extends Omit<CanvasRow, 'canvas_data' | 'is_template' | 'is_active' | 'tags'> {
  tags: string[]
  canvas: CanvasData
  is_template: boolean
  is_active: boolean
}

/** 画布与运行项目服务。 */
export class CanvasService {
  private readonly db: BusinessDatabase
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.db = runtime.db
    this.runtime = runtime
  }

  /** 空画布数据。 */
  static emptyCanvas(): CanvasData {
    return { nodes: [], edges: [], settings: { run_mode: 'workspace-write', live_follow: true } }
  }

  /**
   * 旧画布的档位取值 → 原生预设名（三档自命名时代的数据仍能打开；只读一次，不写回）。
   * @param raw - 画布里存的档位值。
   * @returns 原生预设名。
   */
  private static normalizeRunMode(raw: unknown): CanvasSettings['run_mode'] {
    if (raw === 'allowlist') return 'approve-for-me'
    if (raw === 'auto') return 'danger-full-access'
    if (raw === 'ask' || raw === 'workspace-write') return 'workspace-write'
    if (raw === 'approve-for-me' || raw === 'danger-full-access') return raw
    return undefined
  }

  /**
   * 旧节点 → 新形状：`agent_type` 时代的数据读入时归一为 kind + role（写回只写新形状）。
   * @param raw - 画布里存的节点。
   * @returns 归一后的节点。
   */
  private static normalizeNode(raw: LegacyCanvasNode): CanvasNode {
    if (raw.kind === 'agent') {
      const { agent_type: _legacy, ...rest } = raw
      return { ...rest, kind: 'agent', role: raw.role ?? 'custom' }
    }
    if (raw.kind === 'note') {
      const { agent_type: _legacy, role: _role, ...rest } = raw
      return { ...rest, kind: 'note' }
    }
    // 未知 kind 不猜：原样交给 validateCanvas 拒绝（不静默改写成 agent）。
    if (raw.kind !== undefined) {
      const { agent_type: _legacy, ...rest } = raw
      return { ...rest, kind: raw.kind as CanvasNodeKind }
    }
    const { agent_type: legacy, role, ...rest } = raw
    if (legacy === 'note') return { ...rest, kind: 'note' }
    return { ...rest, kind: 'agent', role: role ?? legacy ?? 'custom' }
  }

  /**
   * 写入前的归一：旧 `agent_type` 形状按读入规则转成 kind/role，写回只写新形状。
   * @param canvas - 调用方提交的画布数据。
   * @returns 归一后的画布数据。
   */
  private static normalizeCanvas(canvas: CanvasData): CanvasData {
    return {
      ...canvas,
      nodes: canvas.nodes.map(node => CanvasService.normalizeNode(node as LegacyCanvasNode)),
    }
  }

  /** 解析画布 JSON（损坏即明确报错，禁止静默清空）。 */
  static parseCanvas(text: string | null, id: string): CanvasData {
    if (text === null || text === '') return CanvasService.emptyCanvas()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new FrameworkError(422, 'CANVAS_DATA_CORRUPT', `canvas ${id} canvas_data is not valid JSON: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(422, 'CANVAS_DATA_CORRUPT', `canvas ${id} canvas_data must be a JSON object`)
    }
    const data = parsed as Partial<CanvasData>
    const settings = data.settings ?? {}
    const runMode = CanvasService.normalizeRunMode(settings.run_mode)
    const nodes = Array.isArray(data.nodes)
      ? data.nodes.map(node => CanvasService.normalizeNode(node as LegacyCanvasNode))
      : []
    const canvas: CanvasData = {
      nodes,
      edges: Array.isArray(data.edges) ? data.edges : [],
      settings: { ...settings, run_mode: runMode ?? 'workspace-write', live_follow: settings.live_follow ?? true },
    }
    // 打开即校验（PRD-02 边界表「画布数据损坏 → 明确报错」）：损坏数据不进入编辑器。
    try {
      CanvasService.validateCanvas(canvas)
    } catch (error) {
      throw new FrameworkError(422, 'CANVAS_DATA_CORRUPT',
        `canvas ${id} canvas_data is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    return canvas
  }

  /**
   * 写入前的节点校验：种类只有 agent/note；agent 必须有角色模板 id；注释节点不挂角色。
   * @param canvas - 待写入的画布数据。
   */
  static validateCanvas(canvas: CanvasData): void {
    // 画布内自定义模板（可无限扩充）：字段与 id 必须完整、唯一，且不得覆盖内置模板。
    const presets: unknown = canvas.settings?.role_presets ?? []
    if (!Array.isArray(presets)) {
      throw new FrameworkError(422, 'CANVAS_NODE_INVALID', 'settings.role_presets must be an array')
    }
    const presetIds = new Set(BUILTIN_ROLE_PRESETS.map(preset => preset.id))
    for (const preset of presets as Partial<AgentRolePreset>[]) {
      const id = typeof preset.id === 'string' ? preset.id.trim() : ''
      if (id === '') {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID', 'every custom role preset needs an id')
      }
      if (presetIds.has(id)) {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID',
          `role preset id ${id} is duplicated or reserved by a built-in preset`)
      }
      presetIds.add(id)
      if (typeof preset.name !== 'string' || preset.name.trim() === ''
        || typeof preset.nameEn !== 'string' || typeof preset.description !== 'string'
        || typeof preset.systemPrompt !== 'string' || !Array.isArray(preset.tools)
        || preset.tools.some(tool => typeof tool !== 'string')) {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID', `role preset ${id} is incomplete`)
      }
    }
    for (const node of canvas.nodes) {
      if (node.node_id.trim() === '') {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID', 'every node needs a node_id')
      }
      if (node.kind !== 'agent' && node.kind !== 'note') {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID',
          `node ${node.node_id} has kind ${String(node.kind)}; only "agent" and "note" exist`)
      }
      if (node.kind === 'agent' && (node.role === undefined || node.role.trim() === '')) {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID', `agent node ${node.node_id} needs a role preset id`)
      }
      if (node.kind === 'note' && node.role !== undefined) {
        throw new FrameworkError(422, 'CANVAS_NODE_INVALID', `note node ${node.node_id} cannot carry a role`)
      }
    }
  }

  /** 行 → 视图。 */
  view(row: CanvasRow): CanvasView {
    const { canvas_data, is_template, is_active, tags, ...rest } = row
    let parsedTags: string[] = []
    if (tags !== null && tags !== '') {
      try {
        const value = JSON.parse(tags)
        parsedTags = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
      } catch {
        parsedTags = []
      }
    }
    return {
      ...rest,
      tags: parsedTags,
      canvas: CanvasService.parseCanvas(canvas_data, row.id),
      is_template: is_template === 1,
      is_active: is_active === 1,
    }
  }

  /** 列某用户画布（含公共模板）。 */
  async list(userId: string): Promise<CanvasRow[]> {
    return await this.db.prepare(
      'SELECT * FROM agentic_flows WHERE user_id = ? OR is_template = 1 ORDER BY created_at ASC',
    ).all<CanvasRow>(userId)
  }

  /** 按 ID 取（归属或模板）。 */
  async byId(userId: string, id: string): Promise<CanvasRow | undefined> {
    return await this.db.prepare('SELECT * FROM agentic_flows WHERE id = ? AND (user_id = ? OR is_template = 1)')
      .get<CanvasRow>(id, userId)
  }

  /**
   * 按 ID 取（不做归属过滤）。
   *
   * 只用于运行面板按 `/run/:agenticFlowId` 渲染外壳时的实例组合解析：该 URL 的访问控制
   * 由连接的信任门与运行台账归属承担，解析画布数据本身不需要再按用户过滤。
   * @param id - 画布 ID。
   * @returns 画布行，不存在时 undefined。
   */
  async byIdUnscoped(id: string): Promise<CanvasRow | undefined> {
    return await this.db.prepare('SELECT * FROM agentic_flows WHERE id = ?').get<CanvasRow>(id)
  }

  /**
   * 新建画布。
   * @param userId - 归属用户。
   * @param input - 名称/描述/图标/标签/画布数据。
   */
  async create(userId: string, input: { name?: string; description?: string; icon?: string; tags?: string[]; canvas?: CanvasData; is_template?: boolean }): Promise<CanvasView> {
    const name = String(input.name ?? '').trim()
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'canvas name is required')
    const canvas = CanvasService.normalizeCanvas(input.canvas ?? CanvasService.emptyCanvas())
    CanvasService.validateCanvas(canvas)
    const now = new Date().toISOString()
    const id = newId()
    await this.db.prepare(
      `INSERT INTO agentic_flows
        (id, user_id, name, description, icon, tags, folder_path, canvas_data, is_template, is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, 1)`,
    ).run(id, userId, name, input.description ?? null, input.icon ?? null,
      input.tags === undefined ? null : JSON.stringify(input.tags),
      JSON.stringify(canvas),
      input.is_template === true ? 1 : 0, now, now)
    return this.view(await this.byId(userId, id) as CanvasRow)
  }

  /**
   * 复制画布（副本 ID 重建，画布数据完整复制）。
   * @param userId - 归属用户。
   * @param id - 源画布 ID。
   */
  async duplicate(userId: string, id: string): Promise<CanvasView> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${id} not found`)
    const source = CanvasService.parseCanvas(row.canvas_data, id)
    // 副本重建节点/边 ID，避免与原画布冲突。
    const idMap = new Map<string, string>()
    const nodes = source.nodes.map(node => {
      const next = newId()
      idMap.set(node.node_id, next)
      return { ...node, node_id: next }
    })
    const edges = source.edges.map(edge => ({
      edge_id: newId(),
      from: idMap.get(edge.from) ?? edge.from,
      to: idMap.get(edge.to) ?? edge.to,
    }))
    let tags: string[] | undefined
    if (row.tags !== null && row.tags !== '') {
      try {
        const parsed = JSON.parse(row.tags)
        tags = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined
      } catch { tags = undefined }
    }
    // 副本名去重：固定 `X（副本）` 会让重复复制得到同名卡片，列表只能靠时间戳区分（实测两张
    // `canvas-mu8r6m8m（副本）` 并存）。同名时依次取 `（副本2）`、`（副本3）`……
    const taken = async (name: string): Promise<boolean> => {
      const count = await this.db.prepare('SELECT COUNT(*) AS c FROM agentic_flows WHERE user_id = ? AND name = ?').get<{ c: number }>(userId, name)
      return (count?.c ?? 0) > 0
    }
    let copyName = `${row.name}（副本）`
    for (let suffix = 2; await taken(copyName); suffix += 1) copyName = `${row.name}（副本${String(suffix)}）`
    return await this.create(userId, {
      name: copyName,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.icon === null ? {} : { icon: row.icon }),
      ...(tags === undefined ? {} : { tags }),
      canvas: {
        nodes,
        edges,
        ...(source.settings === undefined ? {} : { settings: source.settings }),
      },
    })
  }

  /**
   * 更新画布（乐观锁；画布 JSON 与元信息）。
   * @param userId - 归属用户。
   * @param id - 画布 ID。
   * @param patch - 待更新字段。
   */
  async update(userId: string, id: string, patch: {
    name?: string
    description?: string
    icon?: string
    tags?: string[]
    canvas?: CanvasData
    is_active?: boolean
    version?: number
  }): Promise<CanvasView> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${id} not found`)
    if (row.user_id !== userId) throw new FrameworkError(403, 'CANVAS_READONLY', 'templates owned by others are read-only')
    if (patch.version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required for update')
    if (Number(patch.version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `canvas ${id} was modified (expected ${String(row.version)}, got ${String(patch.version)}); refresh and retry`)
    }
    const now = new Date().toISOString()
    const assignments: string[] = []
    const values: (string | number | null)[] = []
    const set = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name !== undefined) set('name', patch.name)
    if (patch.description !== undefined) set('description', patch.description)
    if (patch.icon !== undefined) set('icon', patch.icon)
    if (patch.tags !== undefined) set('tags', JSON.stringify(patch.tags))
    if (patch.canvas !== undefined) {
      const canvas = CanvasService.normalizeCanvas(patch.canvas)
      CanvasService.validateCanvas(canvas)
      set('canvas_data', JSON.stringify(canvas))
    }
    if (patch.is_active !== undefined) set('is_active', patch.is_active ? 1 : 0)
    set('updated_at', now)
    assignments.push('version = version + 1')
    values.push(id, userId)
    await this.db.prepare(`UPDATE agentic_flows SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
    return this.view(await this.byId(userId, id) as CanvasRow)
  }

  /**
   * 删除画布：级联删除其运行项目、这些项目下的会话（`sessions.run_project_id` 非空引用，
   * PRD-12 FR-STO-004）与事件归属行；会话日志的清理交给注入的钩子（host 侧执行，本层不碰文件系统）。
   *
   * @param userId - 归属用户。
   * @param id - 画布 ID。
   * @returns 删除的运行项目数与会话数。
   */
  async remove(userId: string, id: string): Promise<{ removedProjects: number; removedSessions: number }> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${id} not found`)
    if (row.user_id !== userId) throw new FrameworkError(403, 'CANVAS_READONLY', 'templates owned by others are read-only')
    const result = await this.runtime.db.transaction(async tx => {
      // 只级联删除**当前用户**的运行项目：模板画布可能被其他用户用作运行项目，
      // 删除模板不能连带删除别人的项目、会话与变更台账。
      const projects = await tx.prepare('SELECT id FROM run_projects WHERE agentic_flow_id = ? AND user_id = ?')
        .all<{ id: string }>(id, userId)
      const sessionKeys: string[] = []
      for (const project of projects) {
        for (const session of await tx.prepare('SELECT session_key FROM sessions WHERE run_project_id = ?').all<{ session_key: string }>(project.id)) {
          sessionKeys.push(session.session_key)
        }
      }
      // 级联顺序：事件（引用会话）→ 变更台账（按 `session_key` 引用会话）→ 会话（引用项目，NOT NULL）→ 项目 → 画布。
      // 台账行以会话键为归属，会话删了就没有任何入口能再读到它们（面板按会话键查询），
      // 残留只会成为不可达的孤儿行，故与事件同批删除。
      for (const project of projects) {
        await tx.prepare('DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE run_project_id = ?)').run(project.id)
        await tx.prepare('DELETE FROM file_changes WHERE session_id IN (SELECT session_key FROM sessions WHERE run_project_id = ?)').run(project.id)
        await tx.prepare('DELETE FROM sessions WHERE run_project_id = ?').run(project.id)
      }
      await tx.prepare('DELETE FROM run_projects WHERE agentic_flow_id = ?').run(id)
      await tx.prepare('DELETE FROM agentic_flows WHERE id = ? AND user_id = ?').run(id, userId)
      return { removedProjects: projects.length, removedSessions: sessionKeys.length, sessionKeys }
    })
    // 日志清理在事务提交之后（文件系统不是事务的一部分），且由 host 提供实现。
    if (result.sessionKeys.length > 0) this.sessionLogRemover?.(userId, result.sessionKeys)
    return { removedProjects: result.removedProjects, removedSessions: result.removedSessions }
  }

  /** 会话日志清理钩子（host 接线时注入；未注入时只删业务行并由 host 侧说明）。 */
  private sessionLogRemover: ((userId: string, sessionKeys: readonly string[]) => void) | undefined

  /**
   * 注入会话日志清理钩子。
   * @param remover - 接收归属用户与被删除的会话键，负责停止其运行并清理会话日志目录。
   */
  setSessionLogRemover(remover: (userId: string, sessionKeys: readonly string[]) => void): void {
    this.sessionLogRemover = remover
  }

  // ── 运行项目（FR-CANVAS-040/041）────────────────────────────────────────────

  /** 列某用户运行项目（按最后访问排序）。 */
  async listProjects(userId: string): Promise<RunProjectRow[]> {
    return await this.db.prepare(
      'SELECT * FROM run_projects WHERE user_id = ? ORDER BY COALESCE(last_accessed_at, created_at) DESC',
    ).all<RunProjectRow>(userId)
  }

  /** 按 ID 取项目（限归属）。 */
  async projectById(userId: string, id: string): Promise<RunProjectRow | undefined> {
    return await this.db.prepare('SELECT * FROM run_projects WHERE id = ? AND user_id = ?').get<RunProjectRow>(id, userId)
  }

  /**
   * 取得或创建运行项目（用户 × 画布 × 目录去重，事务内先查后插）。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param folderPath - 绝对目录（非空，即沙箱工作区根）。
   * @param name - 项目名（默认取目录名）。
   */
  async ensureProject(userId: string, canvasId: string, folderPath: string, name?: string): Promise<RunProjectRow> {
    if (String(folderPath ?? '').trim() === '') {
      throw new FrameworkError(400, 'FOLDER_REQUIRED', 'folder_path is required (it becomes the sandbox workspace root)')
    }
    const normalizedFolder = await this.assertProjectFolderAllowed(userId, folderPath)
    const canvas = await this.byId(userId, canvasId)
    if (canvas === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    return await this.runtime.db.transaction(async tx => {
      const existing = await tx.prepare(
        'SELECT * FROM run_projects WHERE user_id = ? AND agentic_flow_id = ? AND folder_path = ?',
      ).get<RunProjectRow>(userId, canvasId, normalizedFolder)
      const now = new Date().toISOString()
      if (existing !== undefined) {
        await tx.prepare('UPDATE run_projects SET last_accessed_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id)
        return await tx.prepare('SELECT * FROM run_projects WHERE id = ? AND user_id = ?').get<RunProjectRow>(existing.id, userId) as RunProjectRow
      }
      const id = newId()
      const fallbackName = normalizedFolder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? normalizedFolder
      await tx.prepare(
        `INSERT INTO run_projects
          (id, user_id, agentic_flow_id, name, folder_path, description, is_active, last_accessed_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, 1)`,
      ).run(id, userId, canvasId, name ?? fallbackName, normalizedFolder, now, now, now)
      return await tx.prepare('SELECT * FROM run_projects WHERE id = ? AND user_id = ?').get<RunProjectRow>(id, userId) as RunProjectRow
    })
  }

  /**
   * 校验运行项目目录：必须是已有的绝对目录；云形态限定在当前用户的隔离项目根内，
   * 单机形态允许用户选择任意本机目录，但不允许指向其他用户的隔离目录。
   * @param userId - 归属用户。
   * @param folderPath - 请求给出的目录。
   * @returns 规范化并解析符号链接后的绝对目录。
   */
  private async assertProjectFolderAllowed(userId: string, folderPath: string): Promise<string> {
    const raw = String(folderPath ?? '').trim()
    if (!isAbsolute(raw)) {
      throw new FrameworkError(400, 'FOLDER_NOT_ABSOLUTE', `folder_path must be absolute, got ${JSON.stringify(raw)}`)
    }
    const candidate = normalize(resolve(raw))
    if (existsSync(candidate)) {
      if (!statSync(candidate).isDirectory()) {
        throw new FrameworkError(400, 'FOLDER_NOT_DIRECTORY', `folder_path ${candidate} is not a directory`)
      }
    } else {
      // 沙箱根在首次使用时创建（与「先选目录再运行」同一结果；路径归属仍按下面同一套判据）。
      mkdirSync(candidate, { recursive: true })
    }
    const real = normalize(realpathSync(candidate))
    const user = await this.runtime.accounts.byId(userId)
    if (user === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${userId} not found`)
    const contains = (root: string, target: string): boolean => {
      const normalized = normalize(resolve(root))
      const prefix = normalized.endsWith(sep) ? normalized : `${normalized}${sep}`
      return target === normalized || target.startsWith(prefix)
    }
    if (this.runtime.databaseForm === 'cloud') {
      const projectRoot = this.runtime.userDirs.sub(user.username, 'projects')
      if (!contains(projectRoot, real)) {
        throw new FrameworkError(403, 'FOLDER_OUTSIDE_USER_ROOT',
          `folder_path ${real} is outside the user project root ${normalize(resolve(projectRoot))}`)
      }
      return real
    }
    const usersRoot = this.runtime.userDirs.dir
    const ownRoot = this.runtime.userDirs.sub(user.username, 'projects').replace(/[\\/]projects$/u, '')
    if (contains(usersRoot, real) && !contains(ownRoot, real)) {
      throw new FrameworkError(403, 'FOLDER_OUTSIDE_USER_ROOT',
        `folder_path ${real} belongs to another user's isolated directory`)
    }
    return real
  }

  /** 切换当前项目（更新最后访问）。 */
  async touchProject(userId: string, id: string): Promise<RunProjectRow> {
    const row = await this.projectById(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${id} not found`)
    const now = new Date().toISOString()
    await this.db.prepare('UPDATE run_projects SET last_accessed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?')
      .run(now, now, id, userId)
    return await this.projectById(userId, id) as RunProjectRow
  }

  /** 删除运行项目。 */
  async removeProject(userId: string, id: string): Promise<void> {
    const row = await this.projectById(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${id} not found`)
    await this.db.prepare('DELETE FROM run_projects WHERE id = ? AND user_id = ?').run(id, userId)
  }

  // ── 编译（FR-CANVAS-020~025）───────────────────────────────────────────────

  /**
   * 画布引用的资产可用性（技能按行 id 存、MCP 按服务器名存）。
   *
   * 供编辑器标记「已勾选但已不可用」的引用：不存在（被删/不可见）与已停用分开报出。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @returns 逐节点的引用状态。
   */
  async availability(userId: string, canvasId: string): Promise<{
    nodes: {
      node_id: string
      node_name: string
      skills: { ref: string; name: string | null; state: 'ok' | 'missing' | 'disabled' }[]
      mcp_servers: { ref: string; state: 'ok' | 'missing' | 'disabled' }[]
    }[]
  }> {
    const row = await this.byId(userId, canvasId)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    const canvas = CanvasService.parseCanvas(row.canvas_data, canvasId)
    const skills = await this.runtime.skills.list(userId)
    const byId = new Map(skills.map(skill => [skill.id, skill]))
    const byName = new Map(skills.map(skill => [skill.name, skill]))
    const servers = new Map((await this.runtime.mcp.list(userId)).map(server => [server.name, server]))
    return {
      nodes: canvas.nodes.map(node => ({
        node_id: node.node_id,
        node_name: node.name,
        skills: (node.skills ?? []).map((ref) => {
          const skill = byId.get(ref) ?? byName.get(ref)
          if (skill === undefined) return { ref, name: null, state: 'missing' as const }
          return { ref, name: skill.name, state: skill.is_active === 1 ? 'ok' as const : 'disabled' as const }
        }),
        mcp_servers: (node.mcp_servers ?? []).map((ref) => {
          const server = servers.get(ref)
          if (server === undefined) return { ref, state: 'missing' as const }
          return { ref, state: server.is_active === 1 ? 'ok' as const : 'disabled' as const }
        }),
      })),
    }
  }

  /**
   * 编译画布为 Agent 团队（fail loud）。
   *
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param projectId - 运行项目 ID（提供 cwd = 沙箱根）。
   * @returns 编译产物。
   */
  async compile(userId: string, canvasId: string, projectId: string): Promise<CompileResult> {
    const row = await this.byId(userId, canvasId)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    const project = await this.projectById(userId, projectId)
    if (project === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${projectId} not found`)
    const canvas = CanvasService.parseCanvas(row.canvas_data, canvasId)
    // 节点未声明插件时回落到该用户的默认插件表（与运行编译、打包同一处规则）。
    canvas.nodes = await this.runtime.plugins.applyNodeDefaults(userId, canvas.nodes)
    // 画布节点存的是技能**行 id**；编译产物按技能**名**寻址（`skill` 工具与挂载守卫都用名字）。
    const skillRows = await this.runtime.skills.list(userId)
    const skillNameOf = new Map<string, string>()
    for (const skill of skillRows) skillNameOf.set(skill.id, skill.name)
    for (const node of canvas.nodes) {
      if (!Array.isArray(node.skills)) continue
      node.skills = node.skills.map(ref => skillNameOf.get(ref) ?? ref)
    }
    // `compileCanvas` 的 `resolveModelRoute` 是同步回调，模型行必须先在此处解析完。
    const modelRoutes = new Map<string, { route: string; valid: boolean }>()
    for (const node of canvas.nodes) {
      const modelRef = node.model_ref ?? ''
      if (modelRef === '' || modelRoutes.has(modelRef)) continue
      const config = await this.runtime.models.byId(userId, modelRef)
      modelRoutes.set(modelRef, config === undefined || config.is_active !== 1
        ? { route: `soloengine-${modelRef}`, valid: false }
        : { route: `soloengine-${config.id}`, valid: true })
    }
    try {
      return compileCanvas({
        canvas: canvas as never,
        cwd: project.folder_path,
        revision: Number(row.version),
        platform: this.runtime.executionPlatform,
        resolveModelRoute: (modelRef) => {
          // 缺模型引用 = 编译期 fail loud（PRD-02 §2：不带入运行期，也不静默用默认模型代替）。
          if (modelRef === '') return { route: '', valid: false }
          return modelRoutes.get(modelRef) ?? { route: `soloengine-${modelRef}`, valid: false }
        },
      })
    } catch (error) {
      if (error instanceof CompileError) {
        throw new FrameworkError(422, `COMPILE_${error.code}`, error.message)
      }
      throw error
    }
  }
}
