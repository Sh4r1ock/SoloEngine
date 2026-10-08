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

import type { DatabaseSync } from 'node:sqlite'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import type { CompileResult } from '@soloengine/types'
import { FrameworkError } from './accounts.ts'

/** 节点类型（内置三类预设 + 注释）。 */
export type CanvasAgentType = 'coordinator' | 'planner' | 'executor' | 'note'

/** 画布节点（PRD-02 §9 数据契约）。 */
export interface CanvasNode {
  node_id: string
  agent_type: CanvasAgentType
  name: string
  summary?: string
  model_ref?: string
  system_prompt?: string
  tools?: string[]
  skills?: string[]
  mcp_servers?: string[]
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
  /** 运行模式 = 权限三档（ask / allowlist / auto）。 */
  run_mode?: 'ask' | 'allowlist' | 'auto'
  /** 实时跟随（工具跟随开关）。 */
  live_follow?: boolean
}

/** 画布数据（agenticflow 的完整定义）。 */
export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  settings?: CanvasSettings
}

/** 三类节点预设（预填模板）。 */
export const NODE_PRESETS: Record<Exclude<CanvasAgentType, 'note'>, Omit<CanvasNode, 'node_id' | 'position'>> = {
  coordinator: {
    agent_type: 'coordinator',
    name: '协调者',
    summary: '理解目标、拆分任务、委派给下级 agent 并汇总结果',
    tools: ['read', 'glob', 'grep', 'todo_write'],
    system_prompt: 'You coordinate the team. Break the goal into delegated tasks and summarize results.',
  },
  planner: {
    agent_type: 'planner',
    name: '规划者',
    summary: '勘察现状并产出可执行计划，交由下级执行',
    tools: ['read', 'glob', 'grep', 'todo_write'],
    system_prompt: 'You plan before acting. Inspect the workspace and produce an actionable plan.',
  },
  executor: {
    agent_type: 'executor',
    name: '执行者',
    summary: '按收到的任务执行具体动作并回报结果',
    tools: ['read', 'write', 'edit', 'glob', 'grep', 'pwsh'],
    system_prompt: 'You execute the assigned task and report the concrete result.',
  },
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
  private readonly raw: DatabaseSync
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.raw = runtime.db.raw
    this.runtime = runtime
  }

  /** 空画布数据。 */
  static emptyCanvas(): CanvasData {
    return { nodes: [], edges: [], settings: { run_mode: 'ask', live_follow: true } }
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
    return {
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
      settings: data.settings ?? { run_mode: 'ask', live_follow: true },
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
  list(userId: string): CanvasRow[] {
    return this.raw.prepare(
      'SELECT * FROM agentic_flows WHERE user_id = ? OR is_template = 1 ORDER BY created_at ASC',
    ).all(userId) as unknown as CanvasRow[]
  }

  /** 按 ID 取（归属或模板）。 */
  byId(userId: string, id: string): CanvasRow | undefined {
    return this.raw.prepare('SELECT * FROM agentic_flows WHERE id = ? AND (user_id = ? OR is_template = 1)')
      .get(id, userId) as CanvasRow | undefined
  }

  /**
   * 新建画布。
   * @param userId - 归属用户。
   * @param input - 名称/描述/图标/标签/画布数据。
   */
  create(userId: string, input: { name?: string; description?: string; icon?: string; tags?: string[]; canvas?: CanvasData; is_template?: boolean }): CanvasView {
    const name = String(input.name ?? '').trim()
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'canvas name is required')
    const now = new Date().toISOString()
    const id = newId()
    this.raw.prepare(
      `INSERT INTO agentic_flows
        (id, user_id, name, description, icon, tags, folder_path, canvas_data, is_template, is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, 1)`,
    ).run(id, userId, name, input.description ?? null, input.icon ?? null,
      input.tags === undefined ? null : JSON.stringify(input.tags),
      JSON.stringify(input.canvas ?? CanvasService.emptyCanvas()),
      input.is_template === true ? 1 : 0, now, now)
    return this.view(this.byId(userId, id) as CanvasRow)
  }

  /**
   * 复制画布（副本 ID 重建，画布数据完整复制）。
   * @param userId - 归属用户。
   * @param id - 源画布 ID。
   */
  duplicate(userId: string, id: string): CanvasView {
    const row = this.byId(userId, id)
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
    const taken = (name: string): boolean =>
      (this.raw.prepare('SELECT COUNT(*) AS c FROM agentic_flows WHERE user_id = ? AND name = ?').get(userId, name) as { c: number }).c > 0
    let copyName = `${row.name}（副本）`
    for (let suffix = 2; taken(copyName); suffix += 1) copyName = `${row.name}（副本${String(suffix)}）`
    return this.create(userId, {
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
  update(userId: string, id: string, patch: {
    name?: string
    description?: string
    icon?: string
    tags?: string[]
    canvas?: CanvasData
    is_active?: boolean
    version?: number
  }): CanvasView {
    const row = this.byId(userId, id)
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
    if (patch.canvas !== undefined) set('canvas_data', JSON.stringify(patch.canvas))
    if (patch.is_active !== undefined) set('is_active', patch.is_active ? 1 : 0)
    set('updated_at', now)
    assignments.push('version = version + 1')
    values.push(id, userId)
    this.raw.prepare(`UPDATE agentic_flows SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
    return this.view(this.byId(userId, id) as CanvasRow)
  }

  /**
   * 删除画布：级联删除其运行项目、这些项目下的会话（`sessions.run_project_id` 非空引用，
   * PRD-12 FR-STO-004）与事件归属行；会话日志的清理交给注入的钩子（host 侧执行，本层不碰文件系统）。
   *
   * @param userId - 归属用户。
   * @param id - 画布 ID。
   * @returns 删除的运行项目数与会话数。
   */
  remove(userId: string, id: string): { removedProjects: number; removedSessions: number } {
    const row = this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${id} not found`)
    if (row.user_id !== userId) throw new FrameworkError(403, 'CANVAS_READONLY', 'templates owned by others are read-only')
    const result = this.runtime.db.transaction(() => {
      const projects = this.raw.prepare('SELECT id FROM run_projects WHERE agentic_flow_id = ?').all(id) as { id: string }[]
      const sessionKeys: string[] = []
      for (const project of projects) {
        for (const session of this.raw.prepare('SELECT session_key FROM sessions WHERE run_project_id = ?').all(project.id) as { session_key: string }[]) {
          sessionKeys.push(session.session_key)
        }
      }
      // 级联顺序：事件（引用会话）→ 变更台账（按 `session_key` 引用会话）→ 会话（引用项目，NOT NULL）→ 项目 → 画布。
      // 台账行以会话键为归属，会话删了就没有任何入口能再读到它们（面板按会话键查询），
      // 残留只会成为不可达的孤儿行，故与事件同批删除。
      for (const project of projects) {
        this.raw.prepare('DELETE FROM events WHERE session_id IN (SELECT id FROM sessions WHERE run_project_id = ?)').run(project.id)
        this.raw.prepare('DELETE FROM file_changes WHERE session_id IN (SELECT session_key FROM sessions WHERE run_project_id = ?)').run(project.id)
        this.raw.prepare('DELETE FROM sessions WHERE run_project_id = ?').run(project.id)
      }
      this.raw.prepare('DELETE FROM run_projects WHERE agentic_flow_id = ?').run(id)
      this.raw.prepare('DELETE FROM agentic_flows WHERE id = ? AND user_id = ?').run(id, userId)
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
  listProjects(userId: string): RunProjectRow[] {
    return this.raw.prepare(
      'SELECT * FROM run_projects WHERE user_id = ? ORDER BY COALESCE(last_accessed_at, created_at) DESC',
    ).all(userId) as unknown as RunProjectRow[]
  }

  /** 按 ID 取项目（限归属）。 */
  projectById(userId: string, id: string): RunProjectRow | undefined {
    return this.raw.prepare('SELECT * FROM run_projects WHERE id = ? AND user_id = ?').get(id, userId) as RunProjectRow | undefined
  }

  /**
   * 取得或创建运行项目（用户 × 画布 × 目录去重，事务内先查后插）。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param folderPath - 绝对目录（非空，即沙箱工作区根）。
   * @param name - 项目名（默认取目录名）。
   */
  ensureProject(userId: string, canvasId: string, folderPath: string, name?: string): RunProjectRow {
    if (String(folderPath ?? '').trim() === '') {
      throw new FrameworkError(400, 'FOLDER_REQUIRED', 'folder_path is required (it becomes the sandbox workspace root)')
    }
    const canvas = this.byId(userId, canvasId)
    if (canvas === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    return this.runtime.db.transaction(() => {
      const existing = this.raw.prepare(
        'SELECT * FROM run_projects WHERE user_id = ? AND agentic_flow_id = ? AND folder_path = ?',
      ).get(userId, canvasId, folderPath) as RunProjectRow | undefined
      const now = new Date().toISOString()
      if (existing !== undefined) {
        this.raw.prepare('UPDATE run_projects SET last_accessed_at = ?, updated_at = ? WHERE id = ?').run(now, now, existing.id)
        return this.projectById(userId, existing.id) as RunProjectRow
      }
      const id = newId()
      const fallbackName = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folderPath
      this.raw.prepare(
        `INSERT INTO run_projects
          (id, user_id, agentic_flow_id, name, folder_path, description, is_active, last_accessed_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, 1)`,
      ).run(id, userId, canvasId, name ?? fallbackName, folderPath, now, now, now)
      return this.projectById(userId, id) as RunProjectRow
    })
  }

  /** 切换当前项目（更新最后访问）。 */
  touchProject(userId: string, id: string): RunProjectRow {
    const row = this.projectById(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${id} not found`)
    const now = new Date().toISOString()
    this.raw.prepare('UPDATE run_projects SET last_accessed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?')
      .run(now, now, id, userId)
    return this.projectById(userId, id) as RunProjectRow
  }

  /** 删除运行项目。 */
  removeProject(userId: string, id: string): void {
    const row = this.projectById(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${id} not found`)
    this.raw.prepare('DELETE FROM run_projects WHERE id = ? AND user_id = ?').run(id, userId)
  }

  // ── 编译（FR-CANVAS-020~025）───────────────────────────────────────────────

  /**
   * 现场编译画布为 Agent 团队（fail loud）。
   *
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param projectId - 运行项目 ID（提供 cwd = 沙箱根）。
   * @returns 编译产物。
   */
  async compile(userId: string, canvasId: string, projectId: string): Promise<CompileResult> {
    const row = this.byId(userId, canvasId)
    if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} not found`)
    const project = this.projectById(userId, projectId)
    if (project === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${projectId} not found`)
    const canvas = CanvasService.parseCanvas(row.canvas_data, canvasId)
    const { compileCanvas, CompileError } = await import('@soloengine/agent-compiler')
    try {
      return compileCanvas({
        canvas: canvas as never,
        cwd: project.folder_path,
        revision: Number(row.version),
        resolveModelRoute: (modelRef) => {
          if (modelRef === '') return { route: '', valid: false }
          const config = this.runtime.models.byId(userId, modelRef)
          if (config === undefined || config.is_active !== 1) return { route: `soloengine-${modelRef}`, valid: false }
          return { route: `soloengine-${config.id}`, valid: true }
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
