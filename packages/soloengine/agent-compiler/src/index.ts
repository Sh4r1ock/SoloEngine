/**
 * 画布编译器（PRD-02 FR-CANVAS-020~025、《SoloEngine 框架设计》§3.13）。
 *
 * - 把画布（nodes / edges / settings）编译为一次运行的 Agent 团队（CompileResult）；
 * - **fail loud**：缺模型、缺必填、无入口、多入口歧义、未知工具、循环委派一律拒绝，
 *   指明节点与原因（问题暴露在设计期）；
 * - 唯一入口判定：零/多协调者（coordinator）歧义；多协调者取最后创建的节点并提示；
 * - 每条委派边 = 父节点工具表里的一个 Task 工具；子节点提示词作 persona 注入；
 * - 工具名经 tool-map 映射为 dsh 真实工具名（未映射项编译期报错）。
 *
 * 编译是运行时即时行为，不产生中间产物文件。
 *
 * @module @soloengine/agent-compiler
 */

import { createHash } from 'node:crypto'
import { mapRunCommand, type AgentSpec, type CompileFailure, type CompileResult, type DelegationEdge, type SamplingParams } from '@soloengine/types'
import { TOOL_MAP } from '@soloengine/types'

/** 画布节点（编译输入，由框架层画布域提供）。 */
export interface CanvasNodeInput {
  node_id: string
  agent_type: 'coordinator' | 'planner' | 'executor' | 'note'
  name: string
  summary?: string
  model_ref?: string
  system_prompt?: string
  tools?: string[]
  skills?: string[]
  mcp_servers?: string[]
  sampling?: SamplingParams
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
  settings?: { run_mode?: 'ask' | 'allowlist' | 'auto'; live_follow?: boolean }
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

  const realNodes = canvas.nodes.filter(node => node.agent_type !== 'note')
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
    if (String(node.name ?? '').trim() === '') {
      throw new CompileError({ code: 'NODE_NAME_REQUIRED', nodeId: node.node_id, message: `node ${node.node_id} has no name` })
    }
  }

  // 入口判定：coordinator 节点（FR-CANVAS-022：多节点无协调者拒绝；单节点画布以唯一节点为入口）。
  const coordinators = realNodes.filter(node => node.agent_type === 'coordinator')
  const notices: string[] = []
  let mainId: string
  if (coordinators.length === 0) {
    if (realNodes.length > 1) {
      throw new CompileError({
        code: 'NO_ENTRY',
        message: 'canvas has multiple agent nodes but no coordinator; an entry node is required',
      })
    }
    const single = realNodes[0] as CanvasNodeInput
    mainId = single.node_id
    notices.push(`single agent node "${single.name}" (${single.node_id}) without a coordinator; using it as the entry`)
  }
  if (coordinators.length > 1) {
    const last = coordinators[coordinators.length - 1] as CanvasNodeInput
    mainId = last.node_id
    notices.push(`multiple coordinators found; using the last-created node "${last.name}" (${last.node_id}) as the entry`)
  } else {
    mainId = (coordinators[0] as CanvasNodeInput).node_id
  }

  // 工具映射进每个节点（未映射项 fail loud）。
  const resolved = realNodes.map(node => {
    const rawTools = node.tools ?? []
    const resolvedTools: string[] = []
    const missing: string[] = []
    for (const raw of rawTools) {
      if (raw === 'run_command') {
        resolvedTools.push(canonical)
        continue
      }
      const mapped = (TOOL_MAP as Record<string, string>)[raw]
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
      agentType: node.agent_type,
      modelRoute: model.route,
      ...(node.system_prompt === undefined ? {} : { persona: node.system_prompt }),
      cwd: params.cwd,
      tools: [...node.resolvedTools, ...outgoing],
      skills: [...(node.skills ?? [])],
      mcpServers: [...(node.mcp_servers ?? [])],
      ...(node.sampling === undefined ? {} : { sampling: node.sampling }),
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
    type: agent.agentType,
    model: agent.modelRoute,
    tools: agent.tools,
    skills: agent.skills,
    mcp: agent.mcpServers,
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