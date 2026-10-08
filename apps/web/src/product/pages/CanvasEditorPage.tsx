/** 画布编辑器：工具栏 + 画布区（网格/节点/连线）+ 右侧属性面板。 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Button, DisclosureRow, IconCloseOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, Menu, Modal, Pill, RiskConfirmation, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, openPage, setRouteBlocker } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { NumberStepper } from '../components/NumberStepper.tsx'
import { MultiSelectList } from '../components/MultiSelectList.tsx'
import { AGENT_TYPES, NODE_WIDTH, alignToPeers, snap } from '../canvas-data.ts'
import type {
  CanvasData, CanvasEdge, CanvasNode, CanvasView, McpServerView, ModelView, RunProjectView,
  RunSessionView, SkillView,
} from '../types.ts'
import css from '../styles/common.module.css'
import editor from '../styles/editor.module.css'

/** 节点类型的强调色类。 */
function accentClass(type: CanvasNode['agent_type']): string {
  switch (type) {
    case 'coordinator': return editor.accentCoordinator ?? ''
    case 'planner': return editor.accentPlanner ?? ''
    case 'executor': return editor.accentExecutor ?? ''
    default: return editor.accentNote ?? ''
  }
}

/** 节点类型文案键。 */
function typeKey(type: CanvasNode['agent_type']): string {
  switch (type) {
    case 'coordinator': return 'agentTypeCoordinator'
    case 'planner': return 'agentTypePlanner'
    case 'executor': return 'agentTypeExecutor'
    default: return 'agentTypeNote'
  }
}

/** 节点中心点（连线端点）。 */
function centerOf(node: CanvasNode): { x: number; y: number } {
  const height = nodeHeight(node.agent_type)
  return { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + height / 2 }
}

/** 模型配置缺失的必填项。 */
function missingModelFields(model: ModelView): string[] {
  const missing: string[] = []
  if (model.name.trim() === '') missing.push('name')
  if (model.provider.trim() === '') missing.push('provider')
  if (model.model_name.trim() === '') missing.push('model_name')
  if (!model.has_api_key) missing.push('api_key')
  if (model.base_url === null || model.base_url.trim() === '') missing.push('base_url')
  return missing
}

/** 拖动状态。 */
interface DragState {
  id: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

/**
 * 节点框高度基准（连线端点与对齐锚线的计算用）。
 *
 * 取**默认内容下的实测渲染高度**：注释节点 74、Agent 节点 93（`.node` 无固定高度，
 * 名称换行或内容字号档位变化时节点会更高；此处以默认值为基准，不冒充精确值）。
 */
function nodeHeight(type: CanvasNode['agent_type']): number {
  return type === 'note' ? 74 : 93
}

/**
 * 渲染画布编辑器。
 * @param props.canvasId - 画布 ID。
 */
export function CanvasEditorPage({ canvasId }: { canvasId: string }) {
  useLocale()
  const [canvas, setCanvas] = useState<CanvasView | null>(null)
  const [data, setData] = useState<CanvasData>({ nodes: [], edges: [], settings: {} })
  const [savedData, setSavedData] = useState<CanvasData | null>(null)
  const [history, setHistory] = useState<CanvasData[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [models, setModels] = useState<ModelView[]>([])
  const [skills, setSkills] = useState<SkillView[]>([])
  const [servers, setServers] = useState<McpServerView[]>([])
  const [projects, setProjects] = useState<RunProjectView[]>([])
  // 三类节点预设（FR-CANVAS-011 预填模板）与 harness 实时注册的工具清单（FR-CANVAS-014）。
  const [presets, setPresets] = useState<Partial<Record<string, { summary?: string; system_prompt?: string; tools?: string[] }>>>({})
  const [liveTools, setLiveTools] = useState<{ name: string; description: string }[]>([])
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [groups, setGroups] = useState<Record<string, boolean>>({
    identity: true, model: true, prompt: false, tools: false, skills: false, mcp: false, sampling: false, edges: true,
  })
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [edgeMenuOpen, setEdgeMenuOpen] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 错误/通知存「文案键 + 动态细节」，渲染时才翻译——存翻译字符串会在切换语言后残留旧语种。
  const [error, setError] = useState<{ key: 'errorLoad' | 'errorSave' | 'errorRun' | 'errorPreview'; detail: string } | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [pendingType, setPendingType] = useState<{ nodeId: string; next: CanvasNode['agent_type'] } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const dragRef = useRef<DragState | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [canvasResult, modelResult, skillResult, mcpResult, projectResult, presetResult] = await Promise.all([
        request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvasId}`),
        request<{ ok: true; models: ModelView[] }>('/models'),
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; servers: McpServerView[] }>('/mcp'),
        request<{ ok: true; projects: RunProjectView[] }>('/projects'),
        // 三类节点预设（FR-CANVAS-011）：唯一真源在后端，前端不另立第二份清单。
        request<{ ok: true; presets: Partial<Record<string, { summary?: string; system_prompt?: string; tools?: string[] }>> }>('/canvases/meta/presets'),
      ])
      setPresets(presetResult.presets)
      const document: CanvasData = {
        nodes: canvasResult.canvas.canvas.nodes,
        edges: canvasResult.canvas.canvas.edges,
        settings: canvasResult.canvas.canvas.settings ?? {},
      }
      setCanvas(canvasResult.canvas)
      setData(document)
      setSavedData(document)
      setHistory([document])
      setHistoryIndex(0)
      setModels(modelResult.models)
      setSkills(skillResult.skills)
      setServers(mcpResult.servers)
      setProjects(projectResult.projects)
      setConflict(false)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure) })
    } finally {
      setLoading(false)
    }
  }, [canvasId])

  useEffect(() => { void load() }, [load])

  // 工具清单独立拉取：harness 未就绪时该路由未挂载，失败只在工具分组内呈现原因（fail loud 不静默）。
  useEffect(() => {
    request<{ ok: true; tools: { name: string; description: string }[] }>('/tools')
      .then((result) => { setLiveTools(result.tools); setToolsError(null) })
      .catch((failure: unknown) => { setToolsError(describeError(failure)) })
  }, [])

  const dirty = savedData !== null && JSON.stringify(data) !== JSON.stringify(savedData)

  /** 提交一步（可撤销）。 */
  const commit = useCallback((next: CanvasData): void => {
    setData(next)
    const kept = history.slice(0, historyIndex + 1)
    const appended = [...kept, next].slice(-100)
    setHistory(appended)
    setHistoryIndex(appended.length - 1)
  }, [history, historyIndex])

  const undo = (): void => {
    if (historyIndex <= 0) return
    const index = historyIndex - 1
    setHistoryIndex(index)
    setData(history[index] ?? data)
  }

  const redo = (): void => {
    if (historyIndex >= history.length - 1) return
    const index = historyIndex + 1
    setHistoryIndex(index)
    setData(history[index] ?? data)
  }

  const save = useCallback(async (): Promise<void> => {
    if (canvas === null) return
    setSaving(true)
    try {
      const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvas.id}`, {
        method: 'PATCH',
        body: { canvas: data, version: canvas.version },
      })
      setCanvas(result.canvas)
      setSavedData(data)
      setSavedNotice(true)
      setConflict(false)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorSave', detail: describeError(failure) })
      if (failure instanceof Error && (failure as { code?: string }).code === 'VERSION_CONFLICT') setConflict(true)
    } finally {
      setSaving(false)
    }
  }, [canvas, data])

  // 自动保存：改动 2 秒防抖。
  useEffect(() => {
    if (!dirty || saving || conflict) return
    const timer = window.setTimeout(() => { void save() }, 2000)
    return () => { window.clearTimeout(timer) }
  }, [dirty, saving, conflict, save])

  // R33：SPA 内导航拦截——dirty 时经 router 阻塞器确认（外壳导航/任意 navigate 调用统一经过）。
  useEffect(() => {
    setRouteBlocker(() => (dirty ? t('editor', 'dirtyLeave') : null))
    return () => { setRouteBlocker(null) }
  }, [dirty])

  // R39：dirty 时刷新/关闭警告（conflict 阻断自动保存后 dirty 无限存续，此护栏必须独立于自动保存）。
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler) }
  }, [dirty])

  const selectedNode = data.nodes.find(node => node.node_id === selectedNodeId) ?? null

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>): void => {
    const nodes = data.nodes.map(node => (node.node_id === nodeId ? { ...node, ...patch } : node))
    commit({ ...data, nodes })
  }, [commit, data])

  const addNode = (type: CanvasNode['agent_type']): void => {
    const index = data.nodes.length
    const suffix = type === 'note' ? 'Note' : `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`
    const preset = presets[type]
    const node: CanvasNode = {
      node_id: `node-${String(Date.now())}-${String(index)}`,
      agent_type: type,
      name: t('editor', `agentType${suffix}`),
      // 预设即预填（FR-CANVAS-011）：预设携带的摘要/提示词/工具清单在创建时就写入节点。
      ...(type !== 'note' && preset !== undefined
        ? {
          ...(preset.summary === undefined ? {} : { summary: preset.summary }),
          ...(preset.system_prompt === undefined ? {} : { system_prompt: preset.system_prompt }),
          tools: [...(preset.tools ?? [])],
        }
        : {}),
      ...(type === 'note' ? {} : preset === undefined ? { tools: [] } : {}),
      position: { x: snap(32 + (index % 6) * 224), y: snap(32 + Math.floor(index / 6) * 160) },
    }
    commit({ ...data, nodes: [...data.nodes, node] })
    setSelectedNodeId(node.node_id)
    setSelectedEdgeId(null)
  }

  const removeNode = (nodeId: string): void => {
    commit({
      ...data,
      nodes: data.nodes.filter(node => node.node_id !== nodeId),
      edges: data.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId),
    })
    setSelectedNodeId(null)
  }

  /** 键盘等价移动（R11 / WCAG 2.5.7：拖拽交互必须提供非拖拽等价操作）——与拖拽同一 commit 落盘路径。 */
  const moveSelected = (dx: number, dy: number): void => {
    if (selectedNode === null) return
    commit({
      ...data,
      nodes: data.nodes.map(node => node.node_id === selectedNode.node_id
        ? { ...node, position: { x: Math.max(0, snap(node.position.x + dx)), y: Math.max(0, snap(node.position.y + dy)) } }
        : node),
    })
  }

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (selectedNode === null) return
    const target = event.target
    if (target instanceof HTMLElement && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement || target.isContentEditable)) return
    const step = 16
    if (event.key === 'ArrowLeft') { moveSelected(-step, 0); event.preventDefault() }
    else if (event.key === 'ArrowRight') { moveSelected(step, 0); event.preventDefault() }
    else if (event.key === 'ArrowUp') { moveSelected(0, -step); event.preventDefault() }
    else if (event.key === 'ArrowDown') { moveSelected(0, step); event.preventDefault() }
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to) return
    if (data.edges.some(edge => edge.from === from && edge.to === to)) return
    const edge: CanvasEdge = { edge_id: `edge-${String(Date.now())}-${String(data.edges.length)}`, from, to }
    commit({ ...data, edges: [...data.edges, edge] })
  }

  const removeEdge = (edgeId: string): void => {
    commit({ ...data, edges: data.edges.filter(edge => edge.edge_id !== edgeId) })
    setSelectedEdgeId(null)
  }

  // FR-LLM-007 选择器分组：按提供方排序分组呈现（原生 Menu 无分组 API，差异经 label ReactNode 提升）。
  const modelOptions = useMemo(() => [...models]
    .sort((a, b) => a.provider === b.provider
      ? a.name.localeCompare(b.name)
      : a.provider.localeCompare(b.provider))
    .map((model) => {
      const missing = missingModelFields(model)
      const disabledReason = !model.is_active
        ? t('common', 'stateInactive')
        : missing.length > 0 ? t('editor', 'modelMissing', { fields: missing.join(', ') }) : null
      return {
        id: model.id,
        label: (
          <>
            <strong className={css.modelOptionProvider}>{model.provider}</strong>
            {' · '}
            {disabledReason === null
              ? `${model.name} · ${model.model_name}`
              : `${model.name} · ${model.model_name} — ${disabledReason}`}
          </>
        ),
        disabled: disabledReason !== null,
      }
    }), [models])

  // 工具多选来自 harness 实时注册集合（FR-CANVAS-014），未就绪时为空并呈现原因。
  const toolOptions = useMemo(
    () => liveTools.map(tool => ({ id: tool.name, label: tool.description === '' ? tool.name : `${tool.name} — ${tool.description}`, disabledReason: null })),
    [liveTools],
  )
  const skillOptions = useMemo(
    () => skills.map(skill => ({
      id: skill.id,
      label: `${skill.name} · ${skill.pkg_version}`,
      disabledReason: skill.is_active ? null : t('common', 'stateInactive'),
    })),
    [skills],
  )
  const mcpOptions = useMemo(
    // 选项 id 用**服务器名**而不是行 id：编译产物的 `mcpServers` 是「服务器名」列表，运行期挂载时
    // 名字直接做模型可见名的前缀（`mcp__<服务名>__<工具名>`，PRD-05 FR-MCP-005 的验收口径）。
    () => servers.map(server => ({
      id: server.name,
      label: server.name,
      disabledReason: server.is_active ? null : t('common', 'stateInactive'),
    })),
    [servers],
  )

  const outgoing = selectedNode === null ? [] : data.edges.filter(edge => edge.from === selectedNode.node_id)
  const edgeTargets = selectedNode === null ? [] : data.nodes.filter(node => node.node_id !== selectedNode.node_id)

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const rawX = Math.max(0, drag.startX + (event.clientX - drag.startClientX))
    const rawY = Math.max(0, drag.startY + (event.clientY - drag.startClientY))
    const dragged = data.nodes.find(node => node.node_id === drag.id)
    // 先按同伴边线对齐（PRD-02 FR-CANVAS-010：靠近同伴边线时出现辅助线并吸附），
    // 未命中对齐的轴再落回 16px 网格（松手位置必须吸附网格）。
    const aligned = dragged === undefined
      ? { x: rawX, y: rawY, vertical: [], horizontal: [] }
      : alignToPeers(
        { id: dragged.node_id, x: rawX, y: rawY, height: nodeHeight(dragged.agent_type) },
        data.nodes.map(node => ({
          id: node.node_id,
          x: node.position.x,
          y: node.position.y,
          height: nodeHeight(node.agent_type),
        })),
      )
    const x = aligned.vertical.length > 0 ? Math.max(0, aligned.x) : Math.max(0, snap(rawX))
    const y = aligned.horizontal.length > 0 ? Math.max(0, aligned.y) : Math.max(0, snap(rawY))
    setGuides({ vertical: aligned.vertical, horizontal: aligned.horizontal })
    setData(previous => ({
      ...previous,
      nodes: previous.nodes.map(node => (node.node_id === drag.id ? { ...node, position: { x, y } } : node)),
    }))
  }

  const onPointerUp = (): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    setGuides({ vertical: [], horizontal: [] })
    if (drag === null) return
    // 松手落到网格：PRD-02 FR-CANVAS-011 的验收是「出现对齐辅助线**且**松手后位置吸附网格」
    // ——辅助线只负责拖动中的引导（对齐到同伴边线可能落在网格之外，例如右边线 = 左 + 184），
    // 落盘位置仍必须是 16 的整数倍。
    const settled: CanvasData = {
      ...data,
      nodes: data.nodes.map(node => node.node_id === drag.id
        ? { ...node, position: { x: snap(node.position.x), y: snap(node.position.y) } }
        : node),
    }
    setData(settled)
    // 拖动结束落一条历史（拖动前的状态已在历史里）。
    const kept = history.slice(0, historyIndex + 1)
    const appended = [...kept, settled].slice(-100)
    setHistory(appended)
    setHistoryIndex(appended.length - 1)
  }

  const toggleGroup = (key: string): void => {
    setGroups(previous => ({ ...previous, [key]: !(previous[key] === true) }))
  }

  return (
    <div className={editor.editor} onKeyDown={onEditorKeyDown}>
      <div className={editor.toolbar}>
        <Menu
          open={addMenuOpen}
          autoFocus
          items={AGENT_TYPES.map(type => ({ id: type, label: t('editor', typeKey(type)) }))}
          onSelect={(id) => {
            const type = AGENT_TYPES.find(item => item === id)
            if (type !== undefined) addNode(type)
            setAddMenuOpen(false)
          }}
          onClose={() => { setAddMenuOpen(false) }}
          anchor={(
            <Button icon={<IconPlusOutline16 size={14} />} onClick={() => { setAddMenuOpen(!addMenuOpen) }}>
              {t('editor', 'toolbarAddNode')}
            </Button>
          )}
        />
        <Button disabled={historyIndex <= 0} onClick={undo}>{t('editor', 'undo')}</Button>
        <Button disabled={historyIndex >= history.length - 1} onClick={redo}>{t('editor', 'redo')}</Button>
        <Button disabled={!dirty || saving} onClick={() => { void save() }}>
          {saving ? t('editor', 'saving') : t('editor', 'save')}
        </Button>
        {/* 主操作=运行（手册 §三.4：每区块一个 primary；保存随 dirty 自动触发，不作主按钮）。 */}
        <Button variant="primary" onClick={() => { setRunOpen(true) }}>{t('editor', 'run')}</Button>
        <Button onClick={() => { navigate(`/packaging?canvasId=${canvasId}`) }}>{t('editor', 'packaging')}</Button>
        <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
        <span className={editor.toolbarSpacer} />
        <span className={editor.toolbarMeta}>
          {canvas === null ? '' : canvas.name}
          {' · '}
          {data.nodes.length === 1 ? t('editor', 'nodeCountOne') : t('editor', 'nodeCount', { count: data.nodes.length })}
          {' · '}
          {data.edges.length === 1 ? t('editor', 'edgeCountOne') : t('editor', 'edgeCount', { count: data.edges.length })}
          {' · '}
          {dirty ? t('common', 'stateUnsaved') : t('common', 'stateSaved')}
        </span>
        <span className={editor.legend}>
          <span className={editor.legendItem}>
            <span className={`${editor.legendDot} ${editor.accentCoordinator ?? ''}`} />
            {t('editor', 'agentTypeCoordinator')}
          </span>
          <span className={editor.legendItem}>
            <span className={`${editor.legendDot} ${editor.accentPlanner ?? ''}`} />
            {t('editor', 'agentTypePlanner')}
          </span>
          <span className={editor.legendItem}>
            <span className={`${editor.legendDot} ${editor.accentExecutor ?? ''}`} />
            {t('editor', 'agentTypeExecutor')}
          </span>
          <span className={editor.legendItem}>
            <span className={`${editor.legendDot} ${editor.accentNote ?? ''}`} />
            {t('editor', 'agentTypeNote')}
          </span>
        </span>
      </div>

      <div className={editor.body}>
        <div className={editor.stage}>
          <div
            className={editor.canvasWrap}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
            {!loading && data.nodes.length === 0 && <div className={css.empty}>{t('editor', 'emptyCanvas')}</div>}
            <div className={editor.canvas}>
              {/* 对齐辅助线（拖拽中才出现；松手即撤，PRD-02 FR-CANVAS-010/011）。 */}
              {guides.vertical.map(x => (
                <span key={`guide-v-${String(x)}`} className={editor.alignGuideVertical} style={{ left: x }} />
              ))}
              {guides.horizontal.map(y => (
                <span key={`guide-h-${String(y)}`} className={editor.alignGuideHorizontal} style={{ top: y }} />
              ))}
              <svg className={editor.edgeLayer} viewBox="0 0 2400 1600" width={2400} height={1600}>
                <defs>
                  <marker
                    id="se-edge-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" className={editor.edgeArrow} />
                  </marker>
                </defs>
                {data.edges.map((edge) => {
                  const from = data.nodes.find(node => node.node_id === edge.from)
                  const to = data.nodes.find(node => node.node_id === edge.to)
                  if (from === undefined || to === undefined) return null
                  const a = centerOf(from)
                  const b = centerOf(to)
                  return (
                    <>
                      {/* 命中线：可见线 1.5px 实测无法命中（edgeLayer pointer-events:none +
                          命中区过窄，elementFromPoint 落在 .canvas 上），选中/删除委派边的
                          交互因此完全不可达。透明 12px 命中线只承载点击，不影响视觉。 */}
                      <line
                        key={`hit-${edge.edge_id}`}
                        className={editor.edgeHit}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        onClick={() => {
                          setSelectedEdgeId(edge.edge_id)
                          setSelectedNodeId(null)
                        }}
                      />
                      <line
                        key={edge.edge_id}
                        className={edge.edge_id === selectedEdgeId ? editor.edgeSelected : editor.edge}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        markerEnd="url(#se-edge-arrow)"
                      />
                    </>
                  )
                })}
              </svg>
              {data.nodes.map(node => (
                <div
                  key={node.node_id}
                  tabIndex={0}
                  className={[
                    editor.node,
                    node.node_id === selectedNodeId ? editor.nodeSelected : '',
                    node.node_id === draggingId ? editor.nodeDragging : '',
                  ].filter(part => part !== '').join(' ')}
                  style={{ left: node.position.x, top: node.position.y }}
                  onPointerDown={(event) => {
                    setSelectedNodeId(node.node_id)
                    setSelectedEdgeId(null)
                    setDraggingId(node.node_id)
                    dragRef.current = {
                      id: node.node_id,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      startX: node.position.x,
                      startY: node.position.y,
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                    // 焦点跟手：节点不可聚焦时方向键等价移动永远到不了 onKeyDown
                    // （焦点落在 body 上，事件不经过编辑器根节点，R11 失效）。
                    event.currentTarget.focus({ preventScroll: true })
                  }}
                >
                  <span className={`${editor.nodeAccent} ${accentClass(node.agent_type)}`} />
                  <span className={editor.nodeTitle}>{node.name}</span>
                  <span className={editor.nodeMeta}>{t('editor', typeKey(node.agent_type))}</span>
                  {node.agent_type === 'note'
                    ? <span className={editor.nodeNote}>{node.system_prompt ?? ''}</span>
                    : (
                      <span className={editor.nodeTagRow}>
                        <Tag tone={node.model_ref === undefined || node.model_ref === '' ? 'warning' : 'neutral'}>
                          {node.model_ref === undefined || node.model_ref === ''
                            ? t('editor', 'modelNone')
                            : models.find(model => model.id === node.model_ref)?.name ?? node.model_ref}
                        </Tag>
                      </span>
                    )}
                </div>
              ))}
            </div>
          </div>

          <CanvasPreview canvasId={canvasId} projects={projects} onError={(detail) => { setError({ key: 'errorPreview', detail }) }} />
        </div>

        <aside className={editor.panel} onBlur={() => { if (dirty && !saving) void save() }}>
          <div className={editor.panelTitle}>
            {selectedNode === null ? t('editor', 'panelGlobal') : t('editor', 'panelNode')}
          </div>
          <div className={editor.panelHint}>
            {selectedNode === null ? t('editor', 'panelNoSelection') : t('editor', 'autosaveHint')}
          </div>
          <NoticeLine tone="error" text={error === null ? null : `${t('editor', error.key)} — ${error.detail}`} />
          <NoticeLine
            tone="error"
            text={conflict ? t('editor', 'conflictHint') : null}
            action={{ label: t('editor', 'conflictReload'), onClick: () => { void load() } }}
          />
          <NoticeLine tone="success" text={savedNotice ? t('editor', 'saved') : null} />

          {selectedNode === null && (
            <div className={editor.panelGroup}>
              <div className={editor.field}>
                <span className={editor.fieldLabel}>{t('editor', 'runMode')}</span>
                <div className={css.chipRow}>
                  {/* 原生 Pill 只把选中态写成 class，辅助技术读不到（WCAG 4.1.2）；与设置/市场/
                      打包/技能各页同一惯例，产品层透传 aria-pressed。 */}
                  <Pill
                    active={(data.settings?.run_mode ?? 'ask') === 'ask'}
                    aria-pressed={(data.settings?.run_mode ?? 'ask') === 'ask'}
                    onClick={() => { commit({ ...data, settings: { ...data.settings, run_mode: 'ask' } }) }}
                  >
                    {t('editor', 'runModeAsk')}
                  </Pill>
                  <Pill
                    active={data.settings?.run_mode === 'allowlist'}
                    aria-pressed={data.settings?.run_mode === 'allowlist'}
                    onClick={() => { commit({ ...data, settings: { ...data.settings, run_mode: 'allowlist' } }) }}
                  >
                    {t('editor', 'runModeAllowlist')}
                  </Pill>
                  <Pill
                    active={data.settings?.run_mode === 'auto'}
                    aria-pressed={data.settings?.run_mode === 'auto'}
                    onClick={() => { commit({ ...data, settings: { ...data.settings, run_mode: 'auto' } }) }}
                  >
                    {t('editor', 'runModeAuto')}
                  </Pill>
                </div>
              </div>
              <div className={editor.field}>
                <span className={editor.fieldLabel}>{t('editor', 'liveFollow')}</span>
                <Switch
                  checked={data.settings?.live_follow === true}
                  label={t('editor', 'liveFollow')}
                  onChange={(next) => { commit({ ...data, settings: { ...data.settings, live_follow: next } }) }}
                />
                <span className={editor.fieldHint}>{t('editor', 'liveFollowHint')}</span>
              </div>
              {selectedEdgeId !== null && (
                <div className={editor.field}>
                  <span className={editor.fieldLabel}>{t('editor', 'groupEdges')}</span>
                  <div className={editor.edgeRow}>
                    <span className={css.mono}>{selectedEdgeId}</span>
                    <Button size="sm" variant="ghost" onClick={() => { removeEdge(selectedEdgeId) }}>
                      {t('editor', 'edgesRemove')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedNode !== null && (
            <>
              <DisclosureRow
                icon={<IconPlusOutline16 size={14} />}
                title={t('editor', 'groupIdentity')}
                open={groups.identity === true}
                expandable
                expandOnRowClick
                onToggle={() => { toggleGroup('identity') }}
              >
                <div className={editor.groupBody}>
                  <div className={editor.field}>
                    <span className={editor.fieldLabel}>{t('editor', 'agentType')}</span>
                    <div className={css.chipRow}>
                      {AGENT_TYPES.filter(type => type !== 'note').map(type => (
                        <Pill
                          key={type}
                          active={selectedNode.agent_type === type}
                          aria-pressed={selectedNode.agent_type === type}
                          onClick={() => {
                            if (selectedNode.agent_type === type) return
                            setAcknowledged(false)
                            setPendingType({ nodeId: selectedNode.node_id, next: type })
                          }}
                        >
                          {t('editor', typeKey(type))}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <Field label={t('editor', 'nodeName')}>
                    <Input
                      value={selectedNode.name}
                      onChange={(event) => { updateNode(selectedNode.node_id, { name: event.currentTarget.value }) }}
                    />
                  </Field>
                  <Field label={t('editor', 'nodeSummary')}>
                    <Input
                      value={selectedNode.summary ?? ''}
                      onChange={(event) => { updateNode(selectedNode.node_id, { summary: event.currentTarget.value }) }}
                    />
                  </Field>
                  {selectedNode.agent_type === 'note' && (
                    <Field label={t('editor', 'notePlaceholder')}>
                      <textarea
                        className={css.textarea}
                        value={selectedNode.system_prompt ?? ''}
                        placeholder={t('editor', 'notePlaceholder')}
                        onChange={(event) => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
                      />
                    </Field>
                  )}
                  <div className={css.toolbar}>
                    <span className={editor.fieldHint}>
                      {t('editor', 'positionLabel')} {selectedNode.position.x}, {selectedNode.position.y}
                    </span>
                    <span className={editor.toolbarSpacer} />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconTrashOutline16 size={14} />}
                      onClick={() => { removeNode(selectedNode.node_id) }}
                    >
                      {t('editor', 'deleteNode')}
                    </Button>
                  </div>
                </div>
              </DisclosureRow>

              {selectedNode.agent_type !== 'note' && (
                <>
                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupModel')}
                    open={groups.model === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('model') }}
                  >
                    <div className={editor.groupBody}>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'nodeModel')}</span>
                        <Menu
                          open={modelMenuOpen}
                          autoFocus
                          items={modelOptions}
                          selectedId={selectedNode.model_ref ?? undefined}
                          onSelect={(id) => { updateNode(selectedNode.node_id, { model_ref: id }); setModelMenuOpen(false) }}
                          onClose={() => { setModelMenuOpen(false) }}
                          anchor={(
                            <Button size="sm" onClick={() => { setModelMenuOpen(!modelMenuOpen) }}>
                              {selectedNode.model_ref === undefined || selectedNode.model_ref === ''
                                ? t('editor', 'modelNone')
                                : models.find(model => model.id === selectedNode.model_ref)?.name ?? selectedNode.model_ref}
                            </Button>
                          )}
                        />
                        <span className={editor.fieldHint}>{t('editor', 'modelRequired')}</span>
                      </div>
                    </div>
                  </DisclosureRow>

                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupPrompt')}
                    open={groups.prompt === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('prompt') }}
                  >
                    <div className={editor.groupBody}>
                      <textarea
                        className={`${css.textarea} ${css.textareaMono}`}
                        value={selectedNode.system_prompt ?? ''}
                        placeholder={t('editor', 'promptPlaceholder')}
                        onChange={(event) => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
                      />
                    </div>
                  </DisclosureRow>

                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupTools')}
                    open={groups.tools === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('tools') }}
                  >
                    <div className={editor.groupBody}>
                      {toolsError !== null && <NoticeLine tone="error" text={toolsError} />}
                      <MultiSelectList
                        options={toolOptions}
                        selected={selectedNode.tools ?? []}
                        emptyText={t('common', 'stateEmpty')}
                        onToggle={(id, next) => {
                          const current = selectedNode.tools ?? []
                          updateNode(selectedNode.node_id, {
                            tools: next ? [...current, id] : current.filter(item => item !== id),
                          })
                        }}
                      />
                    </div>
                  </DisclosureRow>

                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupSkills')}
                    open={groups.skills === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('skills') }}
                  >
                    <div className={editor.groupBody}>
                      <MultiSelectList
                        options={skillOptions}
                        selected={selectedNode.skills ?? []}
                        emptyText={t('common', 'stateEmpty')}
                        onToggle={(id, next) => {
                          const current = selectedNode.skills ?? []
                          updateNode(selectedNode.node_id, {
                            skills: next ? [...current, id] : current.filter(item => item !== id),
                          })
                        }}
                      />
                    </div>
                  </DisclosureRow>

                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupMcp')}
                    open={groups.mcp === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('mcp') }}
                  >
                    <div className={editor.groupBody}>
                      <MultiSelectList
                        options={mcpOptions}
                        selected={selectedNode.mcp_servers ?? []}
                        emptyText={t('common', 'stateEmpty')}
                        onToggle={(id, next) => {
                          const current = selectedNode.mcp_servers ?? []
                          updateNode(selectedNode.node_id, {
                            mcp_servers: next ? [...current, id] : current.filter(item => item !== id),
                          })
                        }}
                      />
                    </div>
                  </DisclosureRow>

                  <DisclosureRow
                    icon={<IconPlusOutline16 size={14} />}
                    title={t('editor', 'groupSampling')}
                    open={groups.sampling === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('sampling') }}
                  >
                    <div className={editor.groupBody}>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingTemperature')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingTemperature')}
                          value={selectedNode.sampling?.temperature ?? null}
                          step={0.1}
                          min={0}
                          max={2}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            // null = 清空：必须把键从 sampling 里删掉，只摊旧对象会把
                            // 已设的值原样带回（用户永远清不掉）。
                            const sampling = { ...selectedNode.sampling }
                            const rounded = next === null ? undefined : Math.round(next * 10) / 10
                            if (rounded === undefined) delete sampling.temperature
                            else sampling.temperature = rounded
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingMaxTokens')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingMaxTokens')}
                          value={selectedNode.sampling?.max_tokens ?? null}
                          step={256}
                          min={1}
                          max={128000}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            if (next === null) delete sampling.max_tokens
                            else sampling.max_tokens = next
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingMaxToolCalls')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingMaxToolCalls')}
                          value={selectedNode.sampling?.max_tool_calls ?? null}
                          step={1}
                          min={1}
                          max={100}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            if (next === null) delete sampling.max_tool_calls
                            else sampling.max_tool_calls = next
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingMaxInputTokens')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingMaxInputTokens')}
                          value={selectedNode.sampling?.max_input_tokens ?? null}
                          step={1024}
                          min={1}
                          max={1000000}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            if (next === null) delete sampling.max_input_tokens
                            else sampling.max_input_tokens = next
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingMaxOutputTokens')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingMaxOutputTokens')}
                          value={selectedNode.sampling?.max_output_tokens ?? null}
                          step={1024}
                          min={1}
                          max={1000000}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            if (next === null) delete sampling.max_output_tokens
                            else sampling.max_output_tokens = next
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingFrequencyPenalty')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingFrequencyPenalty')}
                          value={selectedNode.sampling?.frequency_penalty ?? null}
                          step={0.1}
                          min={-2}
                          max={2}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            const rounded = next === null ? undefined : Math.round(next * 10) / 10
                            if (rounded === undefined) delete sampling.frequency_penalty
                            else sampling.frequency_penalty = rounded
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                      <div className={editor.field}>
                        <span className={editor.fieldLabel}>{t('editor', 'samplingPresencePenalty')}</span>
                        <NumberStepper
                          label={t('editor', 'samplingPresencePenalty')}
                          value={selectedNode.sampling?.presence_penalty ?? null}
                          step={0.1}
                          min={-2}
                          max={2}
                          placeholder={t('common', 'labelNone')}
                          onChange={(next) => {
                            const sampling = { ...selectedNode.sampling }
                            const rounded = next === null ? undefined : Math.round(next * 10) / 10
                            if (rounded === undefined) delete sampling.presence_penalty
                            else sampling.presence_penalty = rounded
                            updateNode(selectedNode.node_id, { sampling })
                          }}
                        />
                      </div>
                    </div>
                  </DisclosureRow>
                </>
              )}

              <DisclosureRow
                icon={<IconPlusOutline16 size={14} />}
                title={t('editor', 'groupEdges')}
                open={groups.edges === true}
                expandable
                expandOnRowClick
                onToggle={() => { toggleGroup('edges') }}
              >
                <div className={editor.groupBody}>
                  {outgoing.length === 0 && <span className={editor.fieldHint}>{t('editor', 'edgesNone')}</span>}
                  {outgoing.map(edge => (
                    <div key={edge.edge_id} className={editor.edgeRow}>
                      <span className={css.mono}>
                        {data.nodes.find(node => node.node_id === edge.to)?.name ?? edge.to}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<IconCloseOutline16 size={12} />}
                        onClick={() => { removeEdge(edge.edge_id) }}
                      >
                        {t('editor', 'edgesRemove')}
                      </Button>
                    </div>
                  ))}
                  <Menu
                    open={edgeMenuOpen}
                    items={edgeTargets.map(node => ({
                      id: node.node_id,
                      label: `${node.name} · ${t('editor', typeKey(node.agent_type))}`,
                    }))}
                    onSelect={(id) => { addEdge(selectedNode.node_id, id); setEdgeMenuOpen(false) }}
                    onClose={() => { setEdgeMenuOpen(false) }}
                    anchor={(
                      <Button size="sm" onClick={() => { setEdgeMenuOpen(!edgeMenuOpen) }}>
                        {t('editor', 'edgesAdd')}
                      </Button>
                    )}
                  />
                </div>
              </DisclosureRow>
            </>
          )}
        </aside>
      </div>

      <RiskConfirmation
        open={pendingType !== null}
        title={t('editor', 'agentTypeChangeTitle')}
        description={t('editor', 'agentTypeChangeDescription')}
        acknowledgeLabel={t('editor', 'agentTypeAcknowledge')}
        cancelLabel={t('editor', 'agentTypeCancel')}
        closeLabel={t('common', 'actionClose')}
        confirmLabel={t('editor', 'agentTypeConfirm')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setPendingType(null) }}
        onConfirm={() => {
          if (pendingType === null) return
          updateNode(pendingType.nodeId, { agent_type: pendingType.next })
          setPendingType(null)
        }}
      />

      <RunFromEditorDialog
        open={runOpen}
        canvasId={canvasId}
        projects={projects}
        onClose={() => { setRunOpen(false) }}
        onError={(detail) => { setError({ key: 'errorRun', detail }) }}
        onRan={() => { setRunOpen(false) }}
      />
    </div>
  )
}

/** 编辑器内的运行对话框。 */
function RunFromEditorDialog({ open, canvasId, projects, onClose, onError, onRan }: {
  open: boolean
  canvasId: string
  projects: RunProjectView[]
  onClose: () => void
  onError: (detail: string) => void
  onRan: () => void
}) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(
    () => projects.filter(project => project.agentic_flow_id === canvasId),
    [projects, canvasId],
  )

  useEffect(() => {
    setProjectId(candidates[0]?.id ?? null)
    setFolder('')
    setName('')
  }, [open, candidates])

  const selected = candidates.find(project => project.id === projectId) ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('editor', 'runTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('editor', 'runDescription')}
      className={`${css.modalDialog ?? ''} ${css.modalWide ?? ''}`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void (async () => {
                try {
                  let targetId = projectId
                  if (targetId === null) {
                    const created = await request<{ ok: true; project: RunProjectView }>('/projects', {
                      method: 'POST',
                      body: {
                        canvasId,
                        folderPath: folder.trim(),
                        ...(name.trim() === '' ? {} : { name: name.trim() }),
                      },
                    })
                    targetId = created.project.id
                  }
                  const session = await request<{ ok: true; session: RunSessionView }>('/runs', {
                    method: 'POST',
                    body: { canvasId, projectId: targetId },
                  })
                  onRan()
                  openPage(session.session.panel_path)
                } catch (failure) {
                  onError(describeError(failure))
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('editor', 'runStarting') : t('editor', 'runConfirm')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('canvases', 'projectLabel')}</span>
          <div className={css.fieldControl}>
            <Menu
              open={menuOpen}
              autoFocus
              items={candidates.map(project => ({ id: project.id, label: `${project.name} — ${project.folder_path}` }))}
              selectedId={projectId ?? undefined}
              onSelect={(id) => { setProjectId(id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              anchor={(
                <Button size="sm" disabled={candidates.length === 0} onClick={() => { setMenuOpen(!menuOpen) }}>
                  {selected === null ? t('common', 'actionSelect') : selected.name}
                </Button>
              )}
            />
            {candidates.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setProjectId(null) }}>
                {t('common', 'actionCreate')}
              </Button>
            )}
          </div>
          {/* 与画布列表页的运行对话框同形：没有可选项时给出下一步指引，
              否则点「选择」只会展开一个空浮层，用户看不出为什么没有内容。 */}
          {candidates.length === 0 && <span className={css.fieldHint}>{t('canvases', 'projectEmpty')}</span>}
        </div>
        {projectId === null && (
          <>
            <Field label={t('editor', 'projectFolderLabel')}>
              <Input
                value={folder}
                placeholder={t('editor', 'projectFolderPlaceholder')}
                onChange={(event) => { setFolder(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('editor', 'projectNameLabel')}>
              <Input
                value={name}
                placeholder={t('editor', 'projectNamePlaceholder')}
                onChange={(event) => { setName(event.currentTarget.value) }}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}

/** 预览条目（与 Host 侧 `PreviewStream` 的折叠结果同形；轻量，只承载呈现所需字段）。 */
interface PreviewEntry {
  seq: number
  kind: 'text' | 'tool' | 'status' | 'error'
  text?: string
  toolName?: string
  phase?: 'start' | 'result' | 'error'
  turn?: number
}

/** 预览读取响应。 */
interface PreviewResponse {
  ok: true
  sessionKey: string
  status: string
  lastSeq: number
  entries: PreviewEntry[]
}

/** 轮询间隔（轻量路径：不另建推送通道，按短周期增量读取即可呈现流式效果）。 */
const PREVIEW_POLL_MS = 700

/**
 * 画布编辑器内的实时预览（PRD-02 FR-CANVAS-017）。
 *
 * 与「运行」按钮的关系：运行进完整运行面板（原生客户端插件树），预览留在编辑器内，
 * 只呈现**纯文本流与工具状态**——不复刻卡片体系。停止与清空是预览自己的两个动作，
 * 分别落到既有的取消路由与本地缓冲。
 */
/**
 * 预览运行状态的呈现文案。
 *
 * Host 侧状态词（preview-stream.ts `statusOf`：pending/running/idle/failed/stopped）是英文
 * 原文，直接摆上界面会在中文语境里混出机器词（R7）——这里统一过一遍字典；未知值原样呈现
 * （不猜、不静默吞）。状态在 state 里存原文、渲染时才翻译，切语言也不会残留旧语种。
 */
function previewStatusLabel(status: string): string {
  if (status === 'pending') return t('editor', 'previewPending')
  if (status === 'running') return t('editor', 'previewRunning')
  if (status === 'idle') return t('editor', 'previewIdle')
  if (status === 'failed') return t('editor', 'previewFailed')
  if (status === 'stopped') return t('editor', 'previewStopped')
  if (status === 'starting') return t('editor', 'previewStarting')
  return status
}

function CanvasPreview({ canvasId, projects, onError }: {
  canvasId: string
  projects: RunProjectView[]
  onError: (detail: string) => void
}) {
  const [message, setMessage] = useState('')
  const [entries, setEntries] = useState<PreviewEntry[]>([])
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  // 状态存 Host 原文（pending/running/…/starting），渲染时经 previewStatusLabel 翻译。
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const cursorRef = useRef(0)
  const logRef = useRef<HTMLDivElement | null>(null)

  const candidates = projects.filter(project => project.agentic_flow_id === canvasId)

  /** 增量拉取一次预览日志（水位线只前进，重复条目不会重放）。 */
  const pull = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return
    try {
      const result = await request<PreviewResponse>(
        `/sessions/${encodeURIComponent(sessionKey)}/preview?after=${String(cursorRef.current)}`,
      )
      if (result.entries.length > 0) {
        cursorRef.current = result.lastSeq
        setEntries(previous => [...previous, ...result.entries])
      }
      if (result.status !== 'unknown') setStatus(result.status)
      if (result.status === 'idle' || result.status === 'stopped' || result.status === 'failed') {
        setRunning(false)
      }
    } catch (failure) {
      onError(describeError(failure))
      setRunning(false)
    }
  }, [sessionKey, onError])

  // 运行期间按短周期增量读取；停止后自然退出轮询（不另建推送通道）。
  useEffect(() => {
    if (!running || sessionKey === null) return
    const timer = window.setInterval(() => { void pull() }, PREVIEW_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [running, sessionKey, pull])

  // 日志追加后贴底（预览是「看最新」的视图）。
  useEffect(() => {
    const node = logRef.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
  }, [entries])

  /** 发起一次试运行：复用运行域既有路由（编译 → mainagent 就位 → 投递消息）。 */
  const send = async (): Promise<void> => {
    const text = message.trim()
    if (text === '' || busy) return
    setBusy(true)
    try {
      let key = sessionKey
      if (key === null) {
        const projectId = candidates[0]?.id ?? null
        if (projectId === null) {
          // 运行项目必须有沙箱目录（FR-CANVAS-040/041）：没有项目时明确要求先建项目，
          // 不再以空目录发起注定被 FOLDER_REQUIRED 拒绝的请求。
          onError(t('editor', 'previewProjectRequired'))
          setBusy(false)
          return
        }
        const session = await request<{ ok: true; session: RunSessionView }>('/runs', {
          method: 'POST',
          body: { canvasId, projectId },
        })
        key = session.session.session_key
        setSessionKey(key)
        cursorRef.current = 0
        setEntries([])
      }
      await request(`/sessions/${encodeURIComponent(key)}/prompt`, { method: 'POST', body: { text } })
      setMessage('')
      setRunning(true)
      setStatus('starting')
    } catch (failure) {
      onError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }

  /** 停止当前试运行。 */
  const stop = async (): Promise<void> => {
    if (sessionKey === null) return
    setBusy(true)
    try {
      await request(`/sessions/${encodeURIComponent(sessionKey)}/cancel`, {
        method: 'POST',
        body: { reason: 'stopped from the canvas preview' },
      })
      setRunning(false)
      setStatus('stopped')
    } catch (failure) {
      onError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={editor.preview}>
      <div className={editor.previewBar}>
        <span className={editor.previewTitle}>{t('editor', 'previewTitle')}</span>
        <span className={editor.previewStatus}>{previewStatusLabel(status)}</span>
        <span className={editor.toolbarSpacer} />
        <span className={editor.previewStatus}>{t('editor', 'previewHint')}</span>
      </div>

      <div className={editor.previewLog} ref={logRef}>
        {entries.length === 0 && <span className={editor.previewEmpty}>{t('editor', 'previewEmpty')}</span>}
        {entries.map(entry => <PreviewLine key={entry.seq} entry={entry} />)}
      </div>

      <div className={editor.previewInput}>
        <span className={editor.previewInputField}>
          <Input
            value={message}
            placeholder={t('editor', 'previewPlaceholder')}
            onChange={(event) => { setMessage(event.currentTarget.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') void send() }}
          />
        </span>
        <Button size="sm" variant="primary" disabled={busy || message.trim() === ''} onClick={() => { void send() }}>
          {busy ? t('editor', 'previewSending') : t('editor', 'previewSend')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !running} onClick={() => { void stop() }}>
          {t('editor', 'previewStop')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setEntries([]); cursorRef.current = 0 }}>
          {t('editor', 'previewClear')}
        </Button>
      </div>
    </div>
  )
}

/** 渲染一条预览条目（纯文本与工具状态两态，绝不在此复刻卡片）。 */
function PreviewLine({ entry }: { entry: PreviewEntry }): ReactElement {
  if (entry.kind === 'text') return <p className={editor.previewText}>{entry.text}</p>
  if (entry.kind === 'error') return <p className={editor.previewError}>{entry.text}</p>
  if (entry.kind === 'status') return <p className={editor.previewStatusLine}>{entry.text}</p>
  const stateKey = entry.phase === 'start'
    ? 'previewToolRunning'
    : entry.phase === 'error'
      ? 'previewToolFailed'
      : 'previewToolDone'
  // 工具名缺失时只呈现状态词，不拼出 "undefined"（结果事件理论上能按 callId 对上名字）。
  const label = entry.toolName === undefined
    ? t('editor', stateKey)
    : `${entry.toolName} — ${t('editor', stateKey)}`
  return (
    <p className={editor.previewTool}>
      <span className={editor.previewToolName}>{label}</span>
      {entry.text === undefined || entry.text === '' ? '' : `\n${entry.text}`}
    </p>
  )
}
