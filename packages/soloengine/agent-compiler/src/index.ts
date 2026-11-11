/**
 * 画布编译器（PRD-02 FR-CANVAS-020~025、《SoloEngine 框架设计》§3.13）。
 *
 * - 把画布（nodes / edges / settings）编译为一次运行的 Agent 团队（CompileResult）；
 * - **fail loud**：缺模型、缺必填、无入口、多入口歧义、未知工具、循环委派一律拒绝，
 *   指明节点与原因（问题暴露在设计期）；
 * - 唯一入口判定：零/多协调者（coordinator）歧义；多协调者取最后创建的节点并提示；
 * - 每条委派边 = 父节点工具表里的一个 Task 工具；子节点提示词作 persona 注入；
 * - 工具名经 tool-map 映射为 dsh 真实工具名；实时注册里的名字按原名通过，两处都没有的编译期报错。
 *
 * 编译是运行时即时行为，不产生中间产物文件。
 *
 * @module @soloengine/agent-compiler
 */

import { createHash } from 'node:crypto'
import {
  mapRunCommand,
  type AgentSpec,
  type CompileFailure,
  type CompileResult,
  type DelegationEdge,
  type NodePluginRow,
} from '@soloengine/types'
import { TOOL_MAP } from '@soloengine/types'

/** 节点级采样参数（只保留有真实请求消费者的字段）。 */
export interface NodeSamplingInput {
  temperature?: number
  max_tokens?: number
  /** 该节点每个回合允许的工具调用次数上限（与模型配置的工具轮次上限同一口径）。 */
  max_tool_calls?: number
}

/** 画布节点（编译输入，由框架层画布域提供）。 */
export interface CanvasNodeInput {
  node_id: string
  /** 节点种类：agent 或注释（注释不参与编译）。 */
  kind: 'agent' | 'note'
  /** 角色模板 id（只用于呈现与预填；不参与入口判定）。 */
  role?: string
  name: string
  summary?: string
  model_ref?: string
  system_prompt?: string
  tools?: string[]
  skills?: string[]
  mcp_servers?: string[]
  /** 节点级插件行：只挂进该节点对应的 agent 作用域。 */
  plugins?: NodePluginRow[]
  /** 节点级采样参数（只接受有请求消费者的子集）。 */
  sampling?: NodeSamplingInput
  position: { x: number; y: number }
}

/** 画布边。 */
export interface CanvasEdgeInput {
  edge_id: string
  from: string
  to: string
}

/** 画布数据。 */
export interface CanvasDataInput {
  nodes: CanvasNodeInput[]
  edges: CanvasEdgeInput[]
  /** 运行档位 = 原生权限预设名（画布只选默认档，语义归平台预设表）。 */
  settings?: { run_mode?: 'workspace-write' | 'approve-for-me' | 'danger-full-access'; live_follow?: boolean }
}

/** 编译参数。 */
export interface CompileParams {
  /** 画布数据。 */
  canvas: CanvasDataInput
  /** 运行项目目录（每个 agent 的 cwd / 沙箱根）。 */
  cwd: string
  /** 解析节点 model_ref → 模型路由名（框架层模型域返回 `soloengine-<id>`）。 */
  resolveModelRoute: (modelRef: string, nodeId: string) => { route: string; valid: boolean }
  /** 当前平台（决定 run_command → pwsh/bash）。 */
  platform?: NodeJS.Platform
  /** 代际（递增的不可变版本）。 */
  revision?: number
  /**
   * harness 实时注册的工具名（画布工具多选的同一份数据源，FR-CANVAS-014）。
   *
   * 画布词汇表之外的工具名按原名通过：编辑器只提供实时注册里的名字，选中后必须能编译；
   * 缺省时只接受词汇表（无 host 的形态），未映射项照旧 fail loud。
   */
  knownTools?: readonly string[]
}

/** 编译失败（fail loud）。 */
export class CompileError extends Error {
  /** 失败码。 */
  readonly code: CompileFailure['code']
  /** 相关节点。 */
  readonly nodeId?: string
  /** 缺失项清单。 */
  readonly missing?: string[]
  /**
   * @param failure - 失败结构化信息。
   */
  constructor(failure: CompileFailure) {
    super(failure.message)
    this.name = 'CompileError'
    this.code = failure.code
    if (failure.nodeId !== undefined) this.nodeId = failure.nodeId
    if (failure.missing !== undefined) this.missing = failure.missing
  }
}

/**
 * 编译画布为 Agent 团队。
 * @param params - 编译参数。
 * @returns 编译产物。
 * @throws CompileError —— fail loud 拒绝不合规画布。
 */
export function compileCanvas(params: CompileParams): CompileResult {
  const canvas = params.canvas
  const platform = params.platform ?? process.platform
  const canonical = mapRunCommand(platform)

  const realNodes = canvas.nodes.filter(node => node.kind !== 'note')
  if (realNodes.length === 0) {
    throw new CompileError({ code: 'EMPTY_CANVAS', message: 'canvas has no agent nodes to compile' })
  }

  // 节点 ID 唯一性与必填项（FR-CANVAS-022 缺必填 fail loud：节点名）。
  const seen = new Set<string>()
  for (const node of realNodes) {
    if (seen.has(node.node_id)) {
      throw new CompileError({ code: 'DUPLICATE_NODE', nodeId: node.node_id, message: `node ${node.node_id} appears more than once` })
    }
    seen.add(node.node_id)
    if (node.name.trim() === '') {
      throw new CompileError({ code: 'NODE_NAME_REQUIRED', nodeId: node.node_id, message: `node ${node.node_id} has no name` })
    }
  }

  // 委派边必须连接两个真实 agent 节点：指向注释节点或不存在节点的边既不会生成 Task 工具，
  // 还会把目标节点从入口候选里错误排除（`incoming` 直接按原始边计算）。画布保存不拦这类
  // 残留边，编译期必须 fail loud，不能让「团队与画布不一致」静默通过。
  const noteIds = new Set(canvas.nodes.filter(node => node.kind === 'note').map(node => node.node_id))
  for (const edge of canvas.edges) {
    if (edge.from === edge.to) {
      throw new CompileError({
        code: 'EDGE_INVALID',
        nodeId: edge.from,
        message: `delegation edge ${edge.edge_id} points at itself (${edge.from}); an agent cannot delegate to itself`,
      })
    }
    if (noteIds.has(edge.from) || noteIds.has(edge.to)) {
      throw new CompileError({
        code: 'EDGE_INVALID',
        nodeId: noteIds.has(edge.from) ? edge.from : edge.to,
        message: `delegation edge ${edge.edge_id} (${edge.from} -> ${edge.to}) touches a note node; notes cannot delegate or be delegated to`,
      })
    }
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      const missing = seen.has(edge.from) ? edge.to : edge.from
      throw new CompileError({
        code: 'EDGE_INVALID',
        nodeId: missing,
        message: `delegation edge ${edge.edge_id} (${edge.from} -> ${edge.to}) references node ${missing}, which is not an agent node on this canvas`,
      })
    }
  }

  // 入口判定：委派树的根（没有入边的 agent 节点），与角色模板无关。
  // 多个根取最后创建并提示；没有根（每个节点都有入边，即成环）直接拒绝。
  const incoming = new Set(canvas.edges.map(edge => edge.to))
  const roots = realNodes.filter(node => !incoming.has(node.node_id))
  const notices: string[] = []
  let mainId: string
  if (roots.length === 0) {
    throw new CompileError({
      code: 'NO_ENTRY',
      message: 'canvas has no entry: every agent node has an incoming delegation edge (delegation cycle)',
    })
  }
  if (roots.length > 1) {
    const last = roots[roots.length - 1] as CanvasNodeInput
    mainId = last.node_id
    notices.push(`multiple entry candidates found; using the last-created node "${last.name}" (${last.node_id}) as the entry`)
  } else {
    mainId = (roots[0] as CanvasNodeInput).node_id
  }

  // 工具映射进每个节点：词汇表别名换成真实工具名；实时注册里的名字按原名通过；
  // 两处都没有的 fail loud（编辑器只提供实时注册，编制外的名字是调用方错误）。
  const knownTools = new Set(params.knownTools ?? [])
  const resolved = realNodes.map((node) => {
    const rawTools = node.tools ?? []
    const resolvedTools: string[] = []
    const missing: string[] = []
    for (const raw of rawTools) {
      if (raw === 'run_command') {
        resolvedTools.push(canonical)
        continue
      }
      const mapped = TOOL_MAP[raw] ?? (knownTools.has(raw) ? raw : undefined)
      if (mapped === undefined) {
        missing.push(raw)
        continue
      }
      resolvedTools.push(mapped)
    }
    if (missing.length > 0) {
      throw new CompileError({
        code: 'UNKNOWN_TOOL',
        nodeId: node.node_id,
        message: `node "${node.name}" references tools not in the registry: ${missing.join(', ')}`,
        missing,
      })
    }
    return { ...node, resolvedTools: [...new Set(resolvedTools)] }
  })

  // 节点级插件：节点内行 id 与包名唯一；同一插件在所有节点只能一个版本。
  const pluginVersions = new Map<string, string>()
  for (const node of realNodes) {
    const rowIds = new Set<string>()
    const rowNames = new Set<string>()
    for (const row of node.plugins ?? []) {
      const id = row.id.trim()
      const name = row.name.trim()
      if (id === '' || name === '') {
        throw new CompileError({
          code: 'NODE_PLUGIN_INVALID',
          nodeId: node.node_id,
          message: `node "${node.name}" declares a plugin row without an id or package name`,
        })
      }
      if (rowIds.has(id)) {
        throw new CompileError({
          code: 'NODE_PLUGIN_INVALID',
          nodeId: node.node_id,
          message: `node "${node.name}" declares plugin row "${id}" more than once`,
        })
      }
      if (rowNames.has(name)) {
        throw new CompileError({
          code: 'NODE_PLUGIN_INVALID',
          nodeId: node.node_id,
          message: `node "${node.name}" declares plugin package "${name}" more than once`,
        })
      }
      rowIds.add(id)
      rowNames.add(name)
      if (row.version === undefined) continue
      const seenVersion = pluginVersions.get(name)
      if (seenVersion !== undefined && seenVersion !== row.version) {
        throw new CompileError({
          code: 'CONFLICTING_PLUGIN_VERSION',
          nodeId: node.node_id,
          message: `plugin "${name}" is declared as ${seenVersion} and ${row.version} by different canvas nodes; `
            + 'one harness instance can mount only one version of a plugin',
        })
      }
      pluginVersions.set(name, row.version)
    }
  }

  // 委派拓扑与循环检测（DFS 三色标记）。
  const edges = canvas.edges.map<DelegationEdge>(edge => ({
    edgeId: edge.edge_id,
    from: edge.from,
    to: edge.to,
    toolName: `Task_${edge.to}`,
  }))
  const graph = new Map<string, string[]>()
  for (const node of resolved) graph.set(node.node_id, [])
  for (const edge of edges) {
    const list = graph.get(edge.from)
    if (list !== undefined) list.push(edge.to)
  }
  detectCycle(resolved, graph)

  // 组装 AgentSpec（每条边 = 父节点的 Task 委派工具；子节点 persona 作为运行时注入）。
  const agentMap = new Map<string, AgentSpec>()
  for (const node of resolved) {
    const model = params.resolveModelRoute(node.model_ref ?? '', node.node_id)
    if (!model.valid) {
      throw new CompileError({
        code: 'MISSING_MODEL',
        nodeId: node.node_id,
        message: `node "${node.name}" has no valid model reference (${node.model_ref ?? '<none>'})`,
      })
    }
    const outgoing = edges.filter(edge => edge.from === node.node_id).map(edge => edge.toolName)
    agentMap.set(node.node_id, {
      agentId: node.node_id,
      name: node.name,
      role: node.role ?? 'custom',
      modelRoute: model.route,
      ...(node.system_prompt === undefined ? {} : { persona: node.system_prompt }),
      ...(node.sampling === undefined ? {} : { sampling: { ...node.sampling } }),
      cwd: params.cwd,
      tools: [...node.resolvedTools, ...outgoing],
      skills: [...(node.skills ?? [])],
      mcpServers: [...(node.mcp_servers ?? [])],
      plugins: (node.plugins ?? []).map(row => ({
        id: row.id,
        name: row.name,
        ...(row.config === undefined ? {} : { config: row.config }),
        ...(row.version === undefined ? {} : { version: row.version }),
      })),
    })
  }
  // FR-CANVAS-023 自下而上物化（《框架设计》§3.13）：委派子树按后序 DFS 自叶子向根排序——
  // 被委派者先于委派者物化，运行期挂载委派边时目标 agent 已就绪；
  // 不在委派树上的节点按输入顺序追加（循环已在 detectCycle 排除，递归必终止）。
  const emitted = new Set<string>()
  const ordered: string[] = []
  const emit = (id: string): void => {
    if (emitted.has(id)) return
    emitted.add(id)
    for (const child of graph.get(id) ?? []) emit(child)
    ordered.push(id)
  }
  emit(mainId)
  for (const node of resolved) emit(node.node_id)
  const agents = ordered.map(id => agentMap.get(id) as AgentSpec)

  // 语义哈希：布局（position）不参与。
  const semantic = agents.map(agent => ({
    id: agent.agentId,
    role: agent.role,
    model: agent.modelRoute,
    tools: agent.tools,
    skills: agent.skills,
    mcp: agent.mcpServers,
    plugins: agent.plugins,
    persona: agent.persona,
  }))
  const canvasHash = createHash('sha256').update(JSON.stringify({ agents: semantic, mainAgentId: mainId })).digest('hex').slice(0, 16)

  return {
    canvasHash,
    revision: params.revision ?? 1,
    mainAgentId: mainId,
    agents,
    edges,
    notices,
  }
}

/** DFS 三色循环检测（白/灰/黑）。 */
function detectCycle(nodes: { node_id: string }[], graph: Map<string, string[]>): void {
  const color = new Map<string, 'gray' | 'black'>()
  const visit = (id: string, stack: string[]): void => {
    color.set(id, 'gray')
    for (const next of graph.get(id) ?? []) {
      const c = color.get(next)
      if (c === 'gray') {
        const cycleFrom = stack.indexOf(next) >= 0 ? stack.slice(stack.indexOf(next)).join(' -> ') + ` -> ${next}` : `${next} -> ... -> ${id}`
        throw new CompileError({ code: 'CYCLIC_DELEGATION', nodeId: next, message: `delegation cycle detected: ${cycleFrom}` })
      }
      if (c === undefined) visit(next, [...stack, next])
    }
    color.set(id, 'black')
  }
  for (const node of nodes) {
    if (color.get(node.node_id) === undefined) visit(node.node_id, [node.node_id])
  }
}
