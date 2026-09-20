/** 画布编辑器：工具栏 + 画布区（网格/节点/连线）+ 右侧属性面板。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  Button, DisclosureRow, IconCloseOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, Menu, Modal, Pill, RiskConfirmation, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, openPage } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { NumberStepper } from '../components/NumberStepper.tsx'
import { MultiSelectList } from '../components/MultiSelectList.tsx'
import { AGENT_TYPES, NODE_WIDTH, TOOL_OPTIONS, snap } from '../canvas-data.ts'
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
  const height = node.agent_type === 'note' ? 64 : 96
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
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [pendingType, setPendingType] = useState<{ nodeId: string; next: CanvasNode['agent_type'] } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [canvasResult, modelResult, skillResult, mcpResult, projectResult] = await Promise.all([
        request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvasId}`),
        request<{ ok: true; models: ModelView[] }>('/models'),
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; servers: McpServerView[] }>('/mcp'),
        request<{ ok: true; projects: RunProjectView[] }>('/projects'),
      ])
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
      setError(`${t('editor', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [canvasId])

  useEffect(() => { void load() }, [load])

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
      setNotice(t('editor', 'saved'))
      setConflict(false)
      setError(null)
    } catch (failure) {
      setError(`${t('editor', 'errorSave')} — ${describeError(failure)}`)
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

  const selectedNode = data.nodes.find(node => node.node_id === selectedNodeId) ?? null

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>): void => {
    const nodes = data.nodes.map(node => (node.node_id === nodeId ? { ...node, ...patch } : node))
    commit({ ...data, nodes })
  }, [commit, data])

  const addNode = (type: CanvasNode['agent_type']): void => {
    const index = data.nodes.length
    const suffix = type === 'note' ? 'Note' : `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`
    const node: CanvasNode = {
      node_id: `node-${String(Date.now())}-${String(index)}`,
      agent_type: type,
      name: t('editor', `agentType${suffix}`),
      position: { x: snap(32 + (index % 6) * 224), y: snap(32 + Math.floor(index / 6) * 160) },
      ...(type === 'note' ? {} : { tools: [] }),
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

  const modelOptions = useMemo(() => models.map(model => {
    const missing = missingModelFields(model)
    const disabledReason = !model.is_active
      ? t('common', 'stateInactive')
      : missing.length > 0 ? t('editor', 'modelMissing', { fields: missing.join(', ') }) : null
    return {
      id: model.id,
      label: disabledReason === null
        ? `${model.name} · ${model.model_name}`
        : `${model.name} · ${model.model_name} — ${disabledReason}`,
      disabled: disabledReason !== null,
    }
  }), [models])

  const toolOptions = useMemo(
    () => TOOL_OPTIONS.map(id => ({ id, label: id, disabledReason: null })),
    [],
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
    () => servers.map(server => ({
      id: server.id,
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
    const x = Math.max(0, snap(drag.startX + (event.clientX - drag.startClientX)))
    const y = Math.max(0, snap(drag.startY + (event.clientY - drag.startClientY)))
    setData(previous => ({
      ...previous,
      nodes: previous.nodes.map(node => (node.node_id === drag.id ? { ...node, position: { x, y } } : node)),
    }))
  }

  const onPointerUp = (): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    if (drag === null) return
    // 拖动结束落一条历史（拖动前的状态已在历史里）。
    const kept = history.slice(0, historyIndex + 1)
    const appended = [...kept, data].slice(-100)
    setHistory(appended)
    setHistoryIndex(appended.length - 1)
  }

  const toggleGroup = (key: string): void => {
    setGroups(previous => ({ ...previous, [key]: !(previous[key] === true) }))
  }

  return (
    <div className={editor.editor}>
      <div className={editor.toolbar}>
        <Menu
          open={addMenuOpen}
          autoFocus
          items={AGENT_TYPES.map(type => ({ id: type, label: t('editor', typeKey(type)) }))}
          onSelect={id => {
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
        <Button variant="primary" disabled={!dirty || saving} onClick={() => { void save() }}>
          {saving ? t('editor', 'saving') : t('editor', 'save')}
        </Button>
        <Button onClick={() => { setRunOpen(true) }}>{t('editor', 'run')}</Button>
        <Button onClick={() => { navigate(`/packaging?canvasId=${canvasId}`) }}>{t('editor', 'packaging')}</Button>
        <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
        <span className={editor.toolbarSpacer} />
        <span className={editor.toolbarMeta}>
          {canvas === null ? '' : canvas.name}
          {' · '}
          {t('editor', 'nodeCount', { count: data.nodes.length })}
          {' · '}
          {t('editor', 'edgeCount', { count: data.edges.length })}
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
        <div
          className={editor.canvasWrap}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
          {!loading && data.nodes.length === 0 && <div className={css.empty}>{t('editor', 'emptyCanvas')}</div>}
          <div className={editor.canvas}>
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
              {data.edges.map(edge => {
                const from = data.nodes.find(node => node.node_id === edge.from)
                const to = data.nodes.find(node => node.node_id === edge.to)
                if (from === undefined || to === undefined) return null
                const a = centerOf(from)
                const b = centerOf(to)
                return (
                  <line
                    key={edge.edge_id}
                    className={edge.edge_id === selectedEdgeId ? editor.edgeSelected : editor.edge}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    markerEnd="url(#se-edge-arrow)"
                    onClick={() => {
                      setSelectedEdgeId(edge.edge_id)
                      setSelectedNodeId(null)
                    }}
                  />
                )
              })}
            </svg>
            {data.nodes.map(node => (
              <div
                key={node.node_id}
                className={[
                  editor.node,
                  node.node_id === selectedNodeId ? editor.nodeSelected : '',
                  node.node_id === draggingId ? editor.nodeDragging : '',
                ].filter(part => part !== '').join(' ')}
                style={{ left: node.position.x, top: node.position.y }}
                onPointerDown={event => {
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

        <aside className={editor.panel} onBlur={() => { if (dirty && !saving) void save() }}>
          <div className={editor.panelTitle}>
            {selectedNode === null ? t('editor', 'panelGlobal') : t('editor', 'panelNode')}
          </div>
          <div className={editor.panelHint}>
            {selectedNode === null ? t('editor', 'panelNoSelection') : t('editor', 'autosaveHint')}
          </div>
          <NoticeLine tone="error" text={error} />
          <NoticeLine
            tone="error"
            text={conflict ? t('editor', 'conflictHint') : null}
            action={{ label: t('editor', 'conflictReload'), onClick: () => { void load() } }}
          />
          <NoticeLine tone="success" text={notice} />

          {selectedNode === null && (
            <div className={editor.panelGroup}>
              <div className={editor.field}>
                <span className={editor.fieldLabel}>{t('editor', 'runMode')}</span>
                <div className={css.chipRow}>
                  <Pill
                    active={(data.settings?.run_mode ?? 'ask') === 'ask'}
                    onClick={() => { commit({ ...data, settings: { ...data.settings, run_mode: 'ask' } }) }}
                  >
                    {t('editor', 'runModeAsk')}
                  </Pill>
                  <Pill
                    active={data.settings?.run_mode === 'allowlist'}
                    onClick={() => { commit({ ...data, settings: { ...data.settings, run_mode: 'allowlist' } }) }}
                  >
                    {t('editor', 'runModeAllowlist')}
                  </Pill>
                  <Pill
                    active={data.settings?.run_mode === 'auto'}
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
                  onChange={next => { commit({ ...data, settings: { ...data.settings, live_follow: next } }) }}
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
                      onChange={event => { updateNode(selectedNode.node_id, { name: event.currentTarget.value }) }}
                    />
                  </Field>
                  <Field label={t('editor', 'nodeSummary')}>
                    <Input
                      value={selectedNode.summary ?? ''}
                      onChange={event => { updateNode(selectedNode.node_id, { summary: event.currentTarget.value }) }}
                    />
                  </Field>
                  {selectedNode.agent_type === 'note' && (
                    <Field label={t('editor', 'notePlaceholder')}>
                      <textarea
                        className={css.textarea}
                        value={selectedNode.system_prompt ?? ''}
                        placeholder={t('editor', 'notePlaceholder')}
                        onChange={event => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
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
                          onSelect={id => { updateNode(selectedNode.node_id, { model_ref: id }); setModelMenuOpen(false) }}
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
                        onChange={event => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
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
                      <MultiSelectList
                        options={toolOptions}
                        selected={selectedNode.tools ?? []}
                        emptyText={t('common', 'labelNone')}
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
                          onChange={next => {
                            const rounded = next === null ? undefined : Math.round(next * 10) / 10
                            updateNode(selectedNode.node_id, {
                              sampling: {
                                ...selectedNode.sampling,
                                ...(rounded === undefined ? {} : { temperature: rounded }),
                              },
                            })
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
                          onChange={next => {
                            updateNode(selectedNode.node_id, {
                              sampling: {
                                ...selectedNode.sampling,
                                ...(next === null ? {} : { max_tokens: next }),
                              },
                            })
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
                          onChange={next => {
                            updateNode(selectedNode.node_id, {
                              sampling: {
                                ...selectedNode.sampling,
                                ...(next === null ? {} : { max_tool_calls: next }),
                              },
                            })
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
                    onSelect={id => { addEdge(selectedNode.node_id, id); setEdgeMenuOpen(false) }}
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
        onError={message => { setError(message) }}
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
  onError: (message: string) => void
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
                  onError(`${t('editor', 'errorRun')} — ${describeError(failure)}`)
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
              onSelect={id => { setProjectId(id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              anchor={(
                <Button size="sm" onClick={() => { setMenuOpen(!menuOpen) }}>
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
        </div>
        {projectId === null && (
          <>
            <Field label={t('editor', 'projectFolderLabel')}>
              <Input
                value={folder}
                placeholder={t('editor', 'projectFolderPlaceholder')}
                onChange={event => { setFolder(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('editor', 'projectNameLabel')}>
              <Input
                value={name}
                placeholder={t('editor', 'projectNamePlaceholder')}
                onChange={event => { setName(event.currentTarget.value) }}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
