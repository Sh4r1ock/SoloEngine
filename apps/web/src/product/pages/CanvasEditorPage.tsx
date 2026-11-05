/** 画布编辑器：工具栏 + 画布区（网格/节点/连线）+ 右侧属性面板。 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Button, DisclosureRow, IconArchiveOutlineMedium, IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconCodeOutlineRegular,
  IconCopyOutlineRegular, IconEllipsisOutlineRegular, IconPanelLeftOutlineRegular, IconPlayOutlineRegular,
  IconPlusOutlineRegular, IconRefreshOutlineRegular, IconStopFillRegular, IconTrashOutlineRegular,
  Input, Menu, Modal, Pill, RiskConfirmation, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { BrandGlyph } from '@deepseek-ai/dsh-client-ui-brand-official/src/static.ts'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, openPage, setRouteBlocker } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Glyph } from '../components/Glyph.tsx'
import { Field } from '../components/Field.tsx'
import { IconPicker } from '../components/IconPicker.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { NumberStepper } from '../components/NumberStepper.tsx'
import { MultiSelectList } from '../components/MultiSelectList.tsx'
import type { MultiSelectStale } from '../components/MultiSelectList.tsx'
import { ThemeCycleButton } from '../components/ThemeCycleButton.tsx'
import { PackagingDrawer } from './PackagingPage.tsx'
import { NOTE_WIDTH, NODE_WIDTH, alignToPeers, snap } from '../canvas-data.ts'
import { rolePresetName, type AgentRolePreset } from '@soloengine/types'
import type {
  CanvasAvailability, CanvasData, CanvasEdge, CanvasNode, CanvasView, McpServerView, ModelView, NodePluginRowView, PluginRow,
  RunProjectView, RunSessionView, SkillView, UserView,
} from '../types.ts'
import css from '../styles/common.module.css'
import editor from '../styles/editor.module.css'

/** 网格显示偏好（视图偏好只存本机，与原型把 grid 写进本地状态一致）。 */
const GRID_KEY = 'soloengine.editorGrid'

/** 自动保存进入「保存中」后至少保持的时长（原型 04-pages.md:135：720ms 后进入保存中，360ms 后写入）。 */
const AUTO_SAVE_WRITE_MS = 360

/** 节点种类判定：只有 agent 与注释两种。 */
function isNote(node: CanvasNode): boolean {
  return node.kind === 'note'
}

/** 角色模板的显示名（内置模板按语言取，画布内新增模板用用户填写的名称）。 */
function roleLabel(node: CanvasNode, presets: readonly AgentRolePreset[], locale: string): string {
  if (isNote(node)) return t('editor', 'agentTypeNote')
  const preset = presets.find(item => item.id === node.role)
  if (preset !== undefined) return rolePresetName(preset, locale === 'en' ? 'en' : 'zh')
  return node.role ?? t('editor', 'agentTypeCustom')
}

/** 节点角色的协议代码（原型节点 role 行：角色名 · CODE）。 */
function roleCode(node: CanvasNode): string {
  if (isNote(node)) return t('editor', 'roleCodeNote')
  switch (node.role) {
    case 'coordinator': return t('editor', 'roleCodeCoordinator')
    case 'planner': return t('editor', 'roleCodePlanner')
    case 'executor': return t('editor', 'roleCodeExecutor')
    default: return t('editor', 'roleCodeCustom')
  }
}

/** 节点宽度（注释节点 190、Agent 节点 220，与 editor.module.css 一致）。 */
function nodeWidth(node: CanvasNode): number {
  return isNote(node) ? NOTE_WIDTH : NODE_WIDTH
}

/** 两份工具清单是否等价（顺序无关）。 */
function sameTools(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const a = [...(left ?? [])].sort()
  const b = [...(right ?? [])].sort()
  return a.length === b.length && a.every((item, index) => item === b[index])
}

/** 节点当前配置是否已偏离它所属的模板（偏离时切换模板会覆盖自定义内容）。 */
function roleDiffers(node: CanvasNode, presets: readonly AgentRolePreset[]): boolean {
  const current = presets.find(item => item.id === node.role)
  return (node.system_prompt ?? '') !== (current?.systemPrompt ?? '') || !sameTools(node.tools, current?.tools)
}

/** SVG 路径数据（不是用户可见文案；单独命名以区别于 locale 文案）。 */
type SvgPath = string

/** 节点布局框：连线端点按原型从节点边线出发，而不是穿过节点中心。 */
interface NodeBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 取一个节点的布局框。
 * @param node - 画布节点。
 * @returns 左上角、宽、高。
 */
function nodeBox(node: CanvasNode): NodeBox {
  return {
    left: node.position.x,
    top: node.position.y,
    width: nodeWidth(node),
    height: nodeHeight(node),
  }
}

/**
 * 委派边路径（原型 editor.js:250-290 `edgePath`）：目标在右侧时从右边缘连到左边缘；
 * 否则按上下走向从底边连到顶边 / 顶边连到底边。
 * @param from - 起点节点。
 * @param to - 终点节点。
 * @returns SVG 三次贝塞尔路径。
 */
function edgePath(from: CanvasNode, to: CanvasNode): SvgPath {
  const source = nodeBox(from)
  const target = nodeBox(to)
  const sourceCenter = { x: source.left + source.width / 2, y: source.top + source.height / 2 }
  const targetCenter = { x: target.left + target.width / 2, y: target.top + target.height / 2 }
  if (targetCenter.x > sourceCenter.x + 40) {
    const x1 = source.left + source.width
    const y1 = sourceCenter.y
    const x2 = target.left
    const y2 = targetCenter.y
    const dx = Math.max(48, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }
  if (targetCenter.y > sourceCenter.y) {
    const x1 = sourceCenter.x
    const y1 = source.top + source.height
    const x2 = targetCenter.x
    const y2 = target.top
    const dy = Math.max(40, (y2 - y1) / 2)
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
  }
  const x1 = sourceCenter.x
  const y1 = source.top
  const x2 = targetCenter.x
  const y2 = target.top + target.height
  const dy = Math.max(40, (y1 - y2) / 2)
  return `M ${x1} ${y1} C ${x1} ${y1 - dy}, ${x2} ${y2 + dy}, ${x2} ${y2}`
}

/**
 * 端口拖线的临时路径：从起点节点右边缘连到当前指针。
 * @param from - 起点节点。
 * @param x - 指针的画布 x。
 * @param y - 指针的画布 y。
 * @returns SVG 三次贝塞尔路径。
 */
function tempEdgePath(from: CanvasNode, x: number, y: number): SvgPath {
  const source = nodeBox(from)
  const x1 = source.left + source.width
  const y1 = source.top + source.height / 2
  const dx = Math.max(40, Math.abs(x - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x - dx} ${y}, ${x} ${y}`
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

/** 框选状态（画布坐标；`active` 表示位移已超过 3px 阈值，避免点击被误判成框选）。 */
interface MarqueeState {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Shift 框选：在已有选择上追加。 */
  additive: boolean
  /** 已越过阈值。 */
  active: boolean
}

/** 内部剪贴板：只存被复制节点与两端都在复制集合内的委派边（外部边不复制）。 */
interface ClipboardPayload {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** 连续粘贴的偏移倍数（每次粘贴 +16px，避免叠在同一位置）。 */
  pastes: number
}

/** 会话内稳定 id 计数（避免 `Date.now()` 同毫秒碰撞）。 */
let idSequence = 0

/**
 * 生成一个在现有集合中不重复的 id。
 * @param prefix - id 前缀（node / edge）。
 * @param taken - 现有 id 集合。
 * @returns 新 id。
 */
function freshId(prefix: string, taken: Set<string>): string {
  let candidate = ''
  do {
    idSequence += 1
    candidate = `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`
  } while (taken.has(candidate))
  return candidate
}

/**
 * 焦点是否落在可编辑控件上（输入框/文本域/下拉/可编辑区）：这些位置不拦截快捷键。
 * @param target - 键盘事件目标。
 * @returns 是否可编辑。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement || target.isContentEditable)
}

/** Agent 节点默认渲染高度（见 {@link nodeHeight} 的说明）。 */
const AGENT_NODE_HEIGHT = 149
/** 注释节点默认渲染高度。 */
const NOTE_NODE_HEIGHT = 165

/**
 * 节点框高度基准（连线端点与对齐锚线的计算用）。
 *
 * 取**默认内容下的实测渲染高度**：Agent 节点 149（1 行标题 + 30px 图标头 + 2 行摘要 +
 * 底部发丝线），注释节点 165（3 行摘要）。`.node` 无固定高度，名称换行时节点会更高；
 * 此处以默认值为基准，不冒充精确值。
 */
function nodeHeight(node: CanvasNode): number {
  return isNote(node) ? NOTE_NODE_HEIGHT : AGENT_NODE_HEIGHT
}

/** 节点类型图标（原型 editor.js `TYPES[type].icon`：compass / route / terminal / edit）。 */
function NodeGlyph({ node }: { node: CanvasNode }) {
  if (isNote(node)) {
    return <Glyph><path d="m4 16 1-3.5L13.5 4a1.8 1.8 0 0 1 2.5 2.5L7.5 15z" /></Glyph>
  }
  switch (node.role) {
    case 'coordinator':
      return <Glyph><circle cx="10" cy="10" r="6.5" /><path d="m12.6 7.4-1.6 3.6-3.6 1.6L9 9z" /></Glyph>
    case 'planner':
      return <Glyph><circle cx="5" cy="5" r="1.8" /><circle cx="15" cy="15" r="1.8" /><path d="M6.8 5H11a4 4 0 0 1 4 4v4" /></Glyph>
    case 'executor':
      return <Glyph><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="m6.5 8.5 2 2-2 2M10.5 13h3" /></Glyph>
    default:
      return <Glyph><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5v3.5l2.5 1.5" /></Glyph>
  }
}

/** 编辑器里的画布元信息（与画布 JSON 同一次 PATCH 提交）。 */
interface CanvasMeta {
  name: string
  description: string
  icon: string
  tags: string
}

/**
 * 把后端画布视图映射成编辑器元信息。
 * @param canvas - 画布视图。
 * @returns 元信息（标签以逗号串编辑，与新建对话框同一写法）。
 */
function metaOf(canvas: CanvasView): CanvasMeta {
  return {
    name: canvas.name,
    description: canvas.description ?? '',
    icon: canvas.icon ?? '',
    tags: canvas.tags.join(', '),
  }
}

/**
 * 解析标签输入（逗号分隔）。
 * @param raw - 输入文本。
 * @returns 去空白、去空项后的标签数组。
 */
function parseTags(raw: string): string[] {
  return raw.split(',').map(item => item.trim()).filter(item => item !== '')
}

/**
 * 标签的归一化键：`a, b` 与 `a,b` 视为同一组，脏判定与提交范围都用它。
 * @param raw - 输入文本。
 * @returns 归一化键。
 */
function tagsKey(raw: string): string {
  return parseTags(raw).join(',')
}

/**
 * 两份元信息是否仍等价（与脏判定同一组归一化规则）。
 * @param left - 当前输入。
 * @param right - 提交时的输入。
 * @returns 四个字段都等价时为 true。
 */
function sameMeta(left: CanvasMeta, right: CanvasMeta): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.icon.trim() === right.icon.trim()
    && tagsKey(left.tags) === tagsKey(right.tags)
}

/**
 * 渲染画布编辑器。
 * @param props.canvasId - 画布 ID。
 * @param props.user - 当前用户（用于区分「公共模板只读」与自己的画布）。
 */
export function CanvasEditorPage({ canvasId, user }: { canvasId: string; user: UserView | null }) {
  const locale = useLocale()
  const toast = useToastHost()
  const [canvas, setCanvas] = useState<CanvasView | null>(null)
  const [data, setData] = useState<CanvasData>({ nodes: [], edges: [], settings: {} })
  const [savedData, setSavedData] = useState<CanvasData | null>(null)
  // 画布元信息（名称/描述/图标/标签）与画布 JSON 同一次 PATCH 提交，脏判定必须一并参与。
  const [meta, setMeta] = useState<CanvasMeta>({ name: '', description: '', icon: '', tags: '' })
  const [savedMeta, setSavedMeta] = useState<CanvasMeta | null>(null)
  const [history, setHistory] = useState<CanvasData[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [models, setModels] = useState<ModelView[]>([])
  const [skills, setSkills] = useState<SkillView[]>([])
  const [servers, setServers] = useState<McpServerView[]>([])
  // 逐节点引用可用性（技能被删/停用、MCP 被删/停用时在顶上标出，FR-CANVAS-023/FR-SKILL-007）。
  const [availability, setAvailability] = useState<CanvasAvailability | null>(null)
  const [projects, setProjects] = useState<RunProjectView[]>([])
  /** profile 组合行（实例插件分节的数据源；只编辑客户端行）。 */
  const [pluginRows, setPluginRows] = useState<PluginRow[]>([])
  /** 用户级默认插件表投影出的节点插件行（§0.1.4：新建 agent 节点按它初始化 `plugins`）。 */
  const [defaultNodePlugins, setDefaultNodePlugins] = useState<NodePluginRowView[]>([])
  /** 节点级插件行草稿（只挂该 agent 作用域）。 */
  const [nodePluginDraft, setNodePluginDraft] = useState({ name: '', id: '', config: '' })
  const [nodePluginError, setNodePluginError] = useState<string | null>(null)
  /** 画布实例新增的宿主行草稿（随画布差异保存）。 */
  const [hostPluginDraft, setHostPluginDraft] = useState({ id: '', name: '', isolate: '', config: '' })
  const [hostPluginError, setHostPluginError] = useState<string | null>(null)
  /** 画布实例客户端替换草稿（`settings.plugins.replace`）：目标基线行 id + 替代包名。 */
  const [replaceDraft, setReplaceDraft] = useState({ id: '', name: '' })
  const [replaceError, setReplaceError] = useState<string | null>(null)
  // 角色模板（FR-CANVAS-011 预填模板）：内置模板来自后端，画布内新增模板随画布保存。
  const [builtinPresets, setBuiltinPresets] = useState<AgentRolePreset[]>([])
  const presets = useMemo(
    () => [...builtinPresets, ...(data.settings?.role_presets ?? [])],
    [builtinPresets, data.settings?.role_presets],
  )
  const [liveTools, setLiveTools] = useState<{ name: string; description: string }[]>([])
  const [toolsError, setToolsError] = useState<string | null>(null)
  // 选择模型（W11.3）：`selectedIds` 是多选集合，`primaryId` 是属性面板展示的主选中节点。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set<string>())
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [groups, setGroups] = useState<Record<string, boolean>>({
    identity: true, model: true, prompt: true, tools: false, skills: false, mcp: false, sampling: false, edges: true,
    plugins: false, nodePlugins: false, note: true,
  })
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  /** 画布左上角浮动「添加节点」菜单（原型 `.canvas-float`）。 */
  const [canvasAddOpen, setCanvasAddOpen] = useState(false)
  const [edgeTarget, setEdgeTarget] = useState('')
  /** 打包抽屉：打包不是独立页面，只在画布上下文里打开。 */
  const [packageOpen, setPackageOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  /** 「清空画布」确认对话框（原型 editor.js:1142-1160）。 */
  const [clearOpen, setClearOpen] = useState(false)
  /** 待确认删除的节点 id（原型 removeNode 的确认对话框；确认前不动任何数据）。 */
  const [deletePending, setDeletePending] = useState<string[] | null>(null)
  /** 窄视口（≤960）检查器是右侧抽屉；宽视口是内联列（原型 editor.css 断点）。 */
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 960)
  /** 检查器是否展开（窄屏时它是右侧抽屉；窄屏默认收起，选中节点再打开）。 */
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 960)
  /** 底部运行面板是否折叠到 40px。 */
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  /** 顶栏「实时预览」请求：展开面板并切到预览标签（原型 editor.js:1070-1074）。 */
  const [previewSignal, setPreviewSignal] = useState(0)
  const [showGrid, setShowGrid] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(GRID_KEY) !== '0'
    } catch {
      // 本机存储不可用：网格按默认显示，只丢失偏好记忆。
      return true
    }
  })
  /** 端口拖线：起点节点 + 当前指针的画布坐标（松手落到目标节点即建委派边）。 */
  const [portDrag, setPortDrag] = useState<{ from: string; x: number; y: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 错误/通知存「文案键 + 动态细节」，渲染时才翻译——存翻译字符串会在切换语言后残留旧语种。
  const [error, setError] = useState<{ key: 'errorLoad' | 'errorSave' | 'errorRun' | 'errorPreview' | 'errorDuplicate'; detail: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  /** 待确认的角色模板切换：模板会覆盖当前提示词与工具（与 v0.4.0 的预设切换同一保护）。 */
  const [roleSwitch, setRoleSwitch] = useState<{ nodeId: string; presetId: string } | null>(null)
  /** 「新建角色模板」对话框（模板写进画布 settings，可无限扩充）。 */
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templatePrompt, setTemplatePrompt] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const dragRef = useRef<DragState | null>(null)
  /** 画布层（框选坐标换算与 pointer capture 的锚点）。 */
  const canvasRef = useRef<HTMLDivElement | null>(null)
  /**
   * 连续输入合并键：原型在字段获得焦点时取一次快照、失焦或 `change` 时才入栈
   * （editor.js:705-765），同一字段的逐键输入只占一步撤销；这里用「同键 1s 内替换栈顶」
   * 达到同一效果，避免输入 40 个字符就把 40 步历史耗尽。
   */
  const lastCommitRef = useRef<{ key: string; at: number } | null>(null)
  /** 编辑器根（快捷键接收点：点空白后焦点回到这里，Ctrl+A/C/V/D 才有落点）。 */
  const editorRef = useRef<HTMLDivElement | null>(null)
  /** 检查器面板（窄屏抽屉的焦点容器）。 */
  const panelRef = useRef<HTMLElement | null>(null)
  /** 进行中的框选（ref 供 pointermove 读取，state 供渲染矩形）。 */
  const marqueeRef = useRef<MarqueeState | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  /** 内部剪贴板（Ctrl+C/V；不写系统剪贴板）。 */
  const clipboardRef = useRef<ClipboardPayload | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [
        canvasResult, modelResult, skillResult, mcpResult,
        projectResult, presetResult, pluginResult, defaultsResult,
      ] = await Promise.all([
        request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvasId}`),
        request<{ ok: true; models: ModelView[] }>('/models'),
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; servers: McpServerView[] }>('/mcp'),
        request<{ ok: true; projects: RunProjectView[] }>('/projects'),
        // 角色模板（FR-CANVAS-011）：唯一真源在后端，前端不另立第二份清单。
        request<{ ok: true; presets: AgentRolePreset[] }>('/canvases/meta/presets'),
        // profile 组合行：实例插件分节只列客户端行（宿主行由组合层管理）。
        request<{ ok: true; rows: PluginRow[] }>('/plugins'),
        // 用户级默认插件表（§0.1.4）：新建 agent 节点的初始 `plugins` 由后端投影，前端不复制规则。
        request<{ ok: true; plugins: NodePluginRowView[] }>('/plugins/defaults'),
      ])
      setBuiltinPresets(presetResult.presets)
      setPluginRows(pluginResult.rows)
      setDefaultNodePlugins(defaultsResult.plugins)
      const document: CanvasData = {
        nodes: canvasResult.canvas.canvas.nodes,
        edges: canvasResult.canvas.canvas.edges,
        settings: canvasResult.canvas.canvas.settings ?? {},
      }
      setCanvas(canvasResult.canvas)
      setData(document)
      setSavedData(document)
      const info = metaOf(canvasResult.canvas)
      setMeta(info)
      setSavedMeta(info)
      setHistory([document])
      setHistoryIndex(0)
      lastCommitRef.current = null
      setModels(modelResult.models)
      setSkills(skillResult.skills)
      setServers(mcpResult.servers)
      setProjects(projectResult.projects)
      request<{ ok: true } & CanvasAvailability>(`/canvases/${canvasId}/availability`)
        .then((result) => { setAvailability(result) })
        .catch(() => { setAvailability(null) })
      setConflict(false)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure) })
    } finally {
      setLoading(false)
    }
  }, [canvasId])

  useEffect(() => { void load() }, [load])

  // 断点切换时按原型语义重置：宽视口恢复内联列，窄视口收起抽屉（窄屏的收起态不带到宽屏）。
  useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)')
    const onChange = (event: MediaQueryListEvent): void => {
      setNarrow(event.matches)
      setInspectorOpen(!event.matches)
    }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])

  // 窄屏选中节点时展开抽屉（原型 selectNode(id, openPanel)）；已选中的节点不因关闭抽屉再弹开。
  const lastPrimaryRef = useRef<string | null>(null)
  useEffect(() => {
    if (narrow && primaryId !== null && lastPrimaryRef.current !== primaryId) setInspectorOpen(true)
    lastPrimaryRef.current = primaryId
  }, [narrow, primaryId])

  // 抽屉打开时把焦点限制在检查器内（Tab/Shift+Tab 循环），Escape 关闭并把焦点还给触发控件。
  useEffect(() => {
    if (!narrow || !inspectorOpen) return
    const panel = panelRef.current
    if (panel === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.getClientRects().length > 0)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setInspectorOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) { event.preventDefault(); return }
      const index = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
      const next = event.shiftKey
        ? items[index <= 0 ? items.length - 1 : index - 1]
        : items[index === -1 || index === items.length - 1 ? 0 : index + 1]
      event.preventDefault()
      next?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    focusable()[0]?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus({ preventScroll: true })
    }
  }, [narrow, inspectorOpen])

  // 浏览器标签标题跟随画布名（原型 editor.js:867/1173：`<画布名> · SoloEngine`）；
  // 卸载时还原进入本页前的标题。
  useEffect(() => {
    const previous = document.title
    return () => { document.title = previous }
  }, [])

  useEffect(() => {
    const name = meta.name.trim()
    document.title = name === '' ? t('shell', 'docTitleCanvas') : `${name} · SoloEngine`
  }, [meta.name, locale])

  // 工具清单独立拉取：harness 未就绪时该路由未挂载，失败只在工具分组内呈现原因（fail loud 不静默）。
  useEffect(() => {
    request<{ ok: true; tools: { name: string; description: string }[] }>('/tools')
      .then((result) => { setLiveTools(result.tools); setToolsError(null) })
      .catch((failure: unknown) => { setToolsError(describeError(failure)) })
  }, [])

  const dirty = savedData !== null && savedMeta !== null
    && (JSON.stringify(data) !== JSON.stringify(savedData)
      || meta.name !== savedMeta.name
      || meta.description !== savedMeta.description
      || meta.icon.trim() !== savedMeta.icon.trim()
      || tagsKey(meta.tags) !== tagsKey(savedMeta.tags))

  // 公共模板（他人持有、is_template=1）对当前账号只读：写入会在服务端被拒，
  // 因此这里不发起保存、不自动保存；要修改先「复制为我的画布」。
  const readOnly = canvas !== null && user !== null && canvas.is_template && canvas.user_id !== user.id

  /**
   * 提交一步（可撤销）。
   * @param next - 新画布数据。
   * @param coalesceKey - 连续输入合并键：同一字段 1s 内的后续提交替换栈顶，而不是新增一步。
   */
  const commit = useCallback((next: CanvasData, coalesceKey?: string): void => {
    // 模板只读：所有结构/字段修改都在此收口，不产生永不落库的本地脏数据。
    if (readOnly) return
    setData(next)
    const now = Date.now()
    const merge = coalesceKey !== undefined
      && lastCommitRef.current !== null
      && lastCommitRef.current.key === coalesceKey
      && now - lastCommitRef.current.at < 1000
      && historyIndex === history.length - 1
    if (merge) {
      const replaced = [...history]
      replaced[historyIndex] = next
      setHistory(replaced)
      lastCommitRef.current = { key: coalesceKey, at: now }
      return
    }
    const kept = history.slice(0, historyIndex + 1)
    // 40 步撤销：历史需保留「当前 + 40 个前态」，slice(-40) 只剩 39 次可撤销。
    const appended = [...kept, next].slice(-41)
    setHistory(appended)
    setHistoryIndex(appended.length - 1)
    lastCommitRef.current = coalesceKey === undefined ? null : { key: coalesceKey, at: now }
  }, [history, historyIndex, readOnly])

  const undo = (): void => {
    if (historyIndex <= 0) return
    lastCommitRef.current = null
    const index = historyIndex - 1
    setHistoryIndex(index)
    setData(history[index] ?? data)
  }

  const redo = (): void => {
    if (historyIndex >= history.length - 1) return
    lastCommitRef.current = null
    const index = historyIndex + 1
    setHistoryIndex(index)
    setData(history[index] ?? data)
  }

  /**
   * 保存画布。
   * @param silent - 自动保存传 true：原型只在手动保存时弹「已保存」。
   */
  const save = useCallback(async (silent = false): Promise<void> => {
    if (canvas === null || savedMeta === null || readOnly) return
    const startedAt = performance.now()
    setSaving(true)
    try {
      // 名称必填（新建同样要求非空）：清空后保存回落原名称，避免落库空名。
      const nextName = meta.name.trim() === '' ? savedMeta.name : meta.name.trim()
      const nextIcon = meta.icon.trim()
      const patch: Record<string, unknown> = { canvas: data, version: canvas.version }
      if (nextName !== savedMeta.name) patch.name = nextName
      if (meta.description !== savedMeta.description) patch.description = meta.description
      if (nextIcon !== savedMeta.icon.trim()) patch.icon = nextIcon
      if (tagsKey(meta.tags) !== tagsKey(savedMeta.tags)) patch.tags = parseTags(meta.tags)
      const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvas.id}`, {
        method: 'PATCH',
        body: patch,
      })
      const nextMeta = metaOf(result.canvas)
      // 保存期间用户可能继续编辑：只更新「已落库」的水位线，**不**把请求发出时的快照写回
      // 在途状态（否则这几秒内的输入会被覆盖）。元信息同理——仅当它仍等于请求里的值时
      // 才接受服务端的规范化结果。
      const sentMeta = meta
      setCanvas(result.canvas)
      setSavedData({
        nodes: result.canvas.canvas.nodes,
        edges: result.canvas.canvas.edges,
        settings: result.canvas.canvas.settings ?? {},
      })
      setMeta(current => sameMeta(current, sentMeta) ? nextMeta : current)
      setSavedMeta(nextMeta)
      // 原型 editor.js:697/862：手动保存弹「已保存到本机」；自动保存静默。
      if (!silent) toast.show(t('editor', 'toastSaved'), 'success')
      setConflict(false)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorSave', detail: describeError(failure) })
      if (failure instanceof Error && (failure as { code?: string }).code === 'VERSION_CONFLICT') setConflict(true)
    } finally {
      // 自动保存：写入已完成，但「保存中」至少呈现 360ms（原型节奏），不让状态一闪而过。
      if (silent) {
        const remaining = AUTO_SAVE_WRITE_MS - (performance.now() - startedAt)
        if (remaining > 0) await new Promise<void>((resolve) => { window.setTimeout(resolve, remaining) })
      }
      setSaving(false)
    }
  }, [canvas, data, meta, savedMeta, readOnly])

  /**
   * 复制画布：副本归当前账号（节点/边 ID 由后端重建），随后在副本上继续编辑。
   * 只读模板的「复制为我的画布」与顶栏「更多 → 复制画布」共用这一条路由。
   */
  const duplicateCanvas = useCallback(async (): Promise<void> => {
    if (canvas === null) return
    try {
      const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvas.id}/duplicate`, { method: 'POST' })
      toast.show(t('editor', 'toastDuplicated'), 'success')
      navigate(`/canvas/${result.canvas.id}`)
    } catch (failure) {
      setError({ key: 'errorDuplicate', detail: describeError(failure) })
    }
  }, [canvas, toast])

  // 自动保存：改动 720ms 防抖（只读模板不保存；需求文档 §12.3 第 4 条）。
  useEffect(() => {
    if (!dirty || saving || conflict || readOnly) return
    const timer = window.setTimeout(() => { void save(true) }, 720)
    return () => { window.clearTimeout(timer) }
  }, [dirty, saving, conflict, save, readOnly])

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

  const selectedNode = data.nodes.find(node => node.node_id === primaryId) ?? null

  // 删除确认对话框：单节点带名称、多选带数量；两种文案都说明连边一并移除且可撤销。
  const deleteTargets = deletePending === null ? [] : data.nodes.filter(node => deletePending.includes(node.node_id))
  const deleteTitle = deleteTargets.length === 1
    ? t('editor', 'deleteNodeTitle', { name: deleteTargets[0]?.name ?? '' })
    : t('editor', 'deleteNodesTitle', { count: deleteTargets.length })
  const deleteDescription = deleteTargets.length > 1
    ? t('editor', 'deleteNodesDescription')
    : t('editor', 'deleteNodeDescription')

  /** 清空节点/边选择。 */
  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set<string>())
    setPrimaryId(null)
    setSelectedEdgeId(null)
  }, [])

  /**
   * 只选中一个节点（传 null 即清空）；边选中一并清除。
   * @param nodeId - 目标节点 id。
   */
  const selectOnly = useCallback((nodeId: string | null): void => {
    setSelectedIds(nodeId === null ? new Set<string>() : new Set([nodeId]))
    setPrimaryId(nodeId)
    setSelectedEdgeId(null)
  }, [])

  /**
   * Shift 点选：切换一个节点的选中态；主选中取最后加入或剩余集合的最后一个。
   * @param nodeId - 目标节点 id。
   */
  const toggleSelected = useCallback((nodeId: string): void => {
    const next = new Set(selectedIds)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    const remaining = [...next]
    setSelectedIds(next)
    setPrimaryId(next.has(nodeId) ? nodeId : remaining[remaining.length - 1] ?? null)
    setSelectedEdgeId(null)
  }, [selectedIds])

  const updateNode = useCallback((nodeId: string, patch: Partial<CanvasNode>): void => {
    const nodes = data.nodes.map(node => (node.node_id === nodeId ? { ...node, ...patch } : node))
    // 文本字段按「节点 + 字段」合并连续输入：原型一次字段编辑只占一步撤销。
    const field = patch.name !== undefined
      ? 'name'
      : patch.summary !== undefined
        ? 'summary'
        : patch.system_prompt !== undefined
          ? 'system_prompt'
          : null
    commit({ ...data, nodes }, field === null ? undefined : `${nodeId}:${field}`)
  }, [commit, data])

  /**
   * 切换节点角色模板：模板即预填，按模板重写提示词与工具（v0.4.0 预设切换的同一语义）。
   * @param nodeId - 目标节点。
   * @param presetId - 目标模板 id。
   */
  const applyRole = (nodeId: string, presetId: string): void => {
    const preset = presets.find(item => item.id === presetId)
    if (preset === undefined) return
    const nodes = data.nodes.map(node => node.node_id === nodeId
      ? { ...node, role: preset.id, system_prompt: preset.systemPrompt, tools: [...preset.tools] }
      : node)
    commit({ ...data, nodes })
  }

  /** 新建角色模板并立即应用到选中节点：模板随画布数据保存，可继续新增。 */
  const createTemplate = (): void => {
    const name = templateName.trim()
    if (name === '' || selectedNode === null) return
    const taken = new Set(presets.map(preset => preset.id))
    let id = ''
    do {
      idSequence += 1
      id = `role-${Date.now().toString(36)}-${idSequence.toString(36)}`
    } while (taken.has(id))
    const preset: AgentRolePreset = {
      id,
      name,
      nameEn: name,
      description: templateDescription.trim(),
      systemPrompt: templatePrompt,
      tools: [],
      builtin: false,
    }
    const nodes = data.nodes.map(node => node.node_id === selectedNode.node_id
      ? {
        ...node,
        role: id,
        ...(preset.description === '' ? {} : { summary: preset.description }),
        system_prompt: preset.systemPrompt,
        tools: [],
      }
      : node)
    commit({
      ...data,
      nodes,
      settings: { ...data.settings, role_presets: [...(data.settings?.role_presets ?? []), preset] },
    })
    setTemplateOpen(false)
    setTemplateName('')
    setTemplateDescription('')
    setTemplatePrompt('')
    toast.show(t('editor', 'roleTemplateCreated', { name }), 'success')
  }

  /**
   * 添加节点：一个 agent 节点（按角色模板预填）或一个注释节点。
   * @param presetId - 角色模板 id；`note` 表示注释节点。
   */
  const addNode = (presetId: string): void => {
    const note = presetId === 'note'
    const preset = presets.find(item => item.id === presetId)
    // 新节点落在当前视口中心附近（原型 editor.js:478-493）：全出血画布没有滚动容器，
    // 按节点序号排布会把节点放到视口外。
    const viewport = canvasRef.current?.getBoundingClientRect()
    const offset = (data.nodes.length % 3) * 24
    const position = {
      x: snap(Math.max(24, (viewport?.width ?? 960) / 2 - (note ? NOTE_WIDTH : NODE_WIDTH) / 2 + offset)),
      y: snap(Math.max(24, (viewport?.height ?? 560) / 2 - 60 + offset)),
    }
    const node: CanvasNode = {
      node_id: freshId('node', new Set(data.nodes.map(item => item.node_id))),
      kind: note ? 'note' : 'agent',
      ...(note ? {} : { role: presetId }),
      name: note ? t('editor', 'agentTypeNote') : (preset === undefined ? t('editor', 'agentTypeCustom') : rolePresetName(preset, locale === 'en' ? 'en' : 'zh')),
      // 模板即预填（FR-CANVAS-011）：模板携带的摘要/提示词/工具清单在创建时就写入节点。
      ...(note || preset === undefined
        ? {}
        : {
          ...(preset.description === '' ? {} : { summary: preset.description }),
          ...(preset.systemPrompt === '' ? {} : { system_prompt: preset.systemPrompt }),
          tools: [...preset.tools],
        }),
      ...(note ? {} : preset === undefined ? { tools: [] } : {}),
      // 用户级默认插件表（§0.1.4）：新建 agent 节点默认使用这套；默认表为空时保持空。
      ...(!note && defaultNodePlugins.length > 0
        ? { plugins: defaultNodePlugins.map(row => ({ ...row })) }
        : {}),
      position,
    }
    commit({ ...data, nodes: [...data.nodes, node] })
    // 原型 editor.js:492 的 App.toast("已添加" + 类型名)。
    toast.show(t('editor', 'toastNodeAdded', { name: node.name }), 'success')
    setSelectedIds(new Set([node.node_id]))
    setPrimaryId(node.node_id)
    setSelectedEdgeId(null)
  }

  /**
   * 整理布局（原型 `#fit-btn` / editor.js:884-903）：按当前视口宽度排 2 列或 1 列，
   * 整体水平居中；只改坐标，不改任何节点/边数据，可撤销。全出血画布没有滚动容器，
   * 这是把视口外节点拉回来的恢复动作。
   */
  const arrangeNodes = (): void => {
    if (readOnly) return
    const viewport = canvasRef.current?.getBoundingClientRect()
    const width = viewport?.width ?? 960
    const height = viewport?.height ?? 560
    const columns = width >= 820 ? 2 : 1
    const gapX = 48
    const gapY = 34
    const padX = Math.max(16, (width - (columns * NODE_WIDTH + (columns - 1) * gapX)) / 2)
    const rowHeight = data.nodes.reduce((tallest, node) => Math.max(tallest, nodeHeight(node)), 0)
    const rows = Math.ceil(data.nodes.length / columns)
    const padY = Math.max(16, (height - (rows * rowHeight + (rows - 1) * gapY)) / 2)
    const placed = data.nodes.map((node, index) => ({
      ...node,
      position: {
        x: snap(Math.min(
          padX + (index % columns) * (NODE_WIDTH + gapX),
          Math.max(0, width - nodeWidth(node)),
        )),
        y: snap(padY + Math.floor(index / columns) * (rowHeight + gapY)),
      },
    }))
    commit({ ...data, nodes: placed })
    toast.show(t('editor', 'toastArranged'), 'success')
  }

  /**
   * 请求删除节点（属性面板按钮与 Delete/Backspace 共用）：先开确认对话框，
   * 确认前不改任何数据（原型 removeNode 的 `App.confirmDialog`）。
   * @param nodeIds - 待删除节点 id。
   */
  const requestRemoveNodes = (nodeIds: string[]): void => {
    if (readOnly || nodeIds.length === 0) return
    setDeletePending(nodeIds)
  }

  /** 删除单个节点（属性面板按钮）；多选删除走 {@link removeSelected}。 */
  const removeNode = (nodeId: string): void => {
    requestRemoveNodes([nodeId])
  }

  /** 删除全部选中节点及其关联边（确认后一次 commit = 一次撤销）。 */
  const removeSelected = (): void => {
    requestRemoveNodes([...selectedIds])
  }

  /** 确认删除：节点与「两端任一被删」的委派边一并移除，一条历史记录让 Ctrl+Z 整体还原。 */
  const confirmRemoveNodes = (): void => {
    if (deletePending === null) return
    const removed = new Set(deletePending)
    commit({
      ...data,
      nodes: data.nodes.filter(node => !removed.has(node.node_id)),
      edges: data.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to)),
    })
    const remaining = [...selectedIds].filter(id => !removed.has(id))
    setSelectedIds(new Set(remaining))
    setPrimaryId(primaryId !== null && removed.has(primaryId) ? remaining[remaining.length - 1] ?? null : primaryId)
    setSelectedEdgeId(null)
    setDeletePending(null)
    // 被删节点就是对话框的焦点归还目标：触发元素消失后焦点会落到 body，
    // 编辑器级快捷键（Ctrl/Cmd+Z）随之失效。焦点交还编辑器根，删除后仍能直接撤销。
    editorRef.current?.focus()
    // 原型 editor.js:513 的 App.toast("已删除节点")。
    toast.show(t('editor', 'toastNodeDeleted'), 'success')
  }

  /** 键盘等价移动（R11 / WCAG 2.5.7：拖拽交互必须提供非拖拽等价操作）——多选整体移动，一次 commit。 */
  const moveSelected = (dx: number, dy: number): void => {
    if (selectedIds.size === 0) return
    commit({
      ...data,
      nodes: data.nodes.map(node => selectedIds.has(node.node_id)
        ? { ...node, position: { x: Math.max(0, snap(node.position.x + dx)), y: Math.max(0, snap(node.position.y + dy)) } }
        : node),
    })
  }

  /** 复制选中节点与「两端都在选中集合内」的委派边到内部剪贴板（外部边不复制）。 */
  const copySelection = useCallback((): void => {
    const nodes = data.nodes.filter(node => selectedIds.has(node.node_id))
    if (nodes.length === 0) return
    clipboardRef.current = {
      nodes: nodes.map(node => structuredClone(node)),
      edges: data.edges
        .filter(edge => selectedIds.has(edge.from) && selectedIds.has(edge.to))
        .map(edge => ({ ...edge })),
      pastes: 0,
    }
  }, [data, selectedIds])

  /**
   * 把一段节点/边写入画布：重建 node_id、按映射重建内部边、偏移并吸附网格。
   * 整段写入只走一次 `commit`（一次撤销）。
   *
   * @param payload - 剪贴板内容。
   * @param offset - 偏移像素（16 的倍数）。
   */
  const insertPayload = useCallback((payload: ClipboardPayload, offset: number): void => {
    const nodeIds = new Set(data.nodes.map(node => node.node_id))
    const edgeIds = new Set(data.edges.map(edge => edge.edge_id))
    const idMap = new Map<string, string>()
    const nodes = payload.nodes.map((node) => {
      const id = freshId('node', nodeIds)
      nodeIds.add(id)
      idMap.set(node.node_id, id)
      return {
        ...structuredClone(node),
        node_id: id,
        position: { x: snap(node.position.x + offset), y: snap(node.position.y + offset) },
      }
    })
    const edges = payload.edges.map((edge) => {
      const edgeId = freshId('edge', edgeIds)
      edgeIds.add(edgeId)
      return { edge_id: edgeId, from: idMap.get(edge.from) as string, to: idMap.get(edge.to) as string }
    })
    commit({ ...data, nodes: [...data.nodes, ...nodes], edges: [...data.edges, ...edges] })
    setSelectedIds(new Set(nodes.map(node => node.node_id)))
    setPrimaryId(nodes[nodes.length - 1]?.node_id ?? null)
    setSelectedEdgeId(null)
  }, [commit, data])

  /** 粘贴内部剪贴板：每次 +16px（连续粘贴逐次递增），吸附网格。 */
  const pasteClipboard = useCallback((): void => {
    const payload = clipboardRef.current
    if (payload === null || payload.nodes.length === 0) return
    payload.pastes += 1
    insertPayload(payload, 16 * payload.pastes)
  }, [insertPayload])

  /** Ctrl+D：当前选中的原地副本（+16px），副本成为新的选中集合。 */
  const duplicateSelection = useCallback((): void => {
    const nodes = data.nodes.filter(node => selectedIds.has(node.node_id))
    if (nodes.length === 0) return
    insertPayload({
      nodes: nodes.map(node => structuredClone(node)),
      edges: data.edges
        .filter(edge => selectedIds.has(edge.from) && selectedIds.has(edge.to))
        .map(edge => ({ ...edge })),
      pastes: 0,
    }, 16)
  }, [data, selectedIds, insertPayload])

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // 输入框/可编辑区不拦截快捷键（Delete/Backspace 要留给文本编辑）。
    if (isEditableTarget(event.target)) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const step = 16
    if (mod && key === 'a') {
      setSelectedIds(new Set(data.nodes.map(node => node.node_id)))
      setPrimaryId(data.nodes[data.nodes.length - 1]?.node_id ?? null)
      setSelectedEdgeId(null)
      event.preventDefault()
      return
    }
    if (mod && key === 'c') { copySelection(); event.preventDefault(); return }
    if (mod && key === 'v') { pasteClipboard(); event.preventDefault(); return }
    if (mod && key === 'd') { duplicateSelection(); event.preventDefault(); return }
    // 撤销/重做 40 步：Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z / Ctrl+Y 同一实现。
    if (mod && key === 'z' && !event.shiftKey) { undo(); event.preventDefault(); return }
    if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) { redo(); event.preventDefault(); return }
    if (mod && key === 's') { void save(); event.preventDefault(); return }
    if (event.key === 'Escape') {
      // 原型 editor.js:668-679：拖线中按 Esc 取消连线，再取消选择。
      setPortDrag(null)
      clearSelection()
      event.preventDefault()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedEdgeId !== null) { removeEdge(selectedEdgeId); event.preventDefault(); return }
      if (selectedIds.size > 0) { removeSelected(); event.preventDefault() }
      return
    }
    if (selectedIds.size === 0) return
    if (event.key === 'ArrowLeft') { moveSelected(-step, 0); event.preventDefault() }
    else if (event.key === 'ArrowRight') { moveSelected(step, 0); event.preventDefault() }
    else if (event.key === 'ArrowUp') { moveSelected(0, -step); event.preventDefault() }
    else if (event.key === 'ArrowDown') { moveSelected(0, step); event.preventDefault() }
  }

  const addEdge = (from: string, to: string): void => {
    if (from === to) return
    // 注释节点不是 agent，不能成为委派边的端点（需求 §12.3 第 4 条、原型 editor.js:648-660）。
    const target = data.nodes.find(node => node.node_id === to)
    if (target === undefined || isNote(target)) return
    if (data.edges.some(edge => edge.from === from && edge.to === to)) {
      // 重复委派边不静默丢弃（原型 addEdge 的 toast）：显式告知这条边已存在。
      toast.show(t('editor', 'edgeDuplicate'), 'error')
      return
    }
    const edge: CanvasEdge = {
      edge_id: freshId('edge', new Set(data.edges.map(item => item.edge_id))),
      from,
      to,
    }
    commit({ ...data, edges: [...data.edges, edge] })
    // 原型 editor.js:529 的 App.toast("已建立委派边")。
    toast.show(t('editor', 'toastEdgeAdded'), 'success')
  }

  const removeEdge = (edgeId: string): void => {
    commit({ ...data, edges: data.edges.filter(edge => edge.edge_id !== edgeId) })
    setSelectedEdgeId(null)
  }

  // FR-LLM-007：按提供方排序分组；原型 editor.js:355-357/391-393 用原生 select，
  // 分组由 `<optgroup>` 承担，缺必填参数的配置以 disabled + 原因后缀表达。
  const modelGroups = useMemo(() => {
    const sorted = [...models].sort((a, b) => a.provider === b.provider
      ? a.name.localeCompare(b.name)
      : a.provider.localeCompare(b.provider))
    const grouped = new Map<string, { id: string; label: string; disabled: boolean }[]>()
    for (const model of sorted) {
      const missing = missingModelFields(model)
      const disabledReason = !model.is_active
        ? t('common', 'stateInactive')
        : missing.length > 0 ? t('editor', 'modelMissing', { fields: missing.join(', ') }) : null
      const list = grouped.get(model.provider) ?? []
      list.push({
        id: model.id,
        label: disabledReason === null
          ? `${model.name} · ${model.model_name}`
          : `${model.name} · ${model.model_name} — ${disabledReason}`,
        disabled: disabledReason !== null,
      })
      grouped.set(model.provider, list)
    }
    return [...grouped.entries()]
  }, [models])

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
  // 画布上「已勾选但已不可用」的引用：技能按 id 存、MCP 按名存，后端逐节点解析后在此列出。
  const staleRefs = (availability?.nodes ?? []).flatMap(node => [
    ...node.skills.filter(ref => ref.state !== 'ok').map(ref =>
      `${node.node_name}: ${ref.name ?? ref.ref} (${t('editor', ref.state === 'missing' ? 'refMissing' : 'refDisabled')})`),
    ...node.mcp_servers.filter(ref => ref.state !== 'ok').map(ref =>
      `${node.node_name}: ${ref.ref} (${t('editor', ref.state === 'missing' ? 'refMissing' : 'refDisabled')})`),
  ])
  const edgeTargets = selectedNode === null
    ? []
    : data.nodes.filter(node => node.node_id !== selectedNode.node_id && !isNote(node))

  // 节点级失效标记：被删资产已不在可选集合里，必须作为「已勾选但失效」的行补进对应分组，
  // 否则勾选项凭空消失、用户既看不到原因也无法移除悬空引用（PRD-02 FR-CANVAS-041）。
  const staleByNode = useMemo(() => {
    const knownSkills = new Set(skillOptions.map(option => option.id))
    const knownServers = new Set(mcpOptions.map(option => option.id))
    const map = new Map<string, { skills: MultiSelectStale[]; servers: MultiSelectStale[] }>()
    for (const node of availability?.nodes ?? []) {
      // 只补「已不存在」的行：停用的资产仍在选项集合里，由选项自身的 disabledReason 呈现。
      map.set(node.node_id, {
        skills: node.skills
          .filter(ref => ref.state === 'missing' && !knownSkills.has(ref.ref))
          .map(ref => ({ id: ref.ref, label: ref.name ?? ref.ref, reason: t('editor', 'refMissing') })),
        servers: node.mcp_servers
          .filter(ref => ref.state === 'missing' && !knownServers.has(ref.ref))
          .map(ref => ({ id: ref.ref, label: ref.ref, reason: t('editor', 'refMissing') })),
      })
    }
    return map
  }, [availability, skillOptions, mcpOptions])

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // 框选优先：空白处按下后移动超过 3px 才进入框选，实时选中与矩形相交的节点。
    const marqueeState = marqueeRef.current
    if (marqueeState !== null) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect !== undefined) {
        const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
        const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height)
        if (!marqueeState.active && Math.abs(x - marqueeState.x0) + Math.abs(y - marqueeState.y0) > 3) {
          marqueeState.active = true
        }
        if (marqueeState.active) {
          marqueeState.x1 = x
          marqueeState.y1 = y
          setMarquee({ ...marqueeState })
          const left = Math.min(marqueeState.x0, x)
          const right = Math.max(marqueeState.x0, x)
          const top = Math.min(marqueeState.y0, y)
          const bottom = Math.max(marqueeState.y0, y)
          const hits = data.nodes.filter(node => node.position.x < right && node.position.x + nodeWidth(node) > left
            && node.position.y < bottom && node.position.y + nodeHeight(node) > top)
          const next = new Set(marqueeState.additive ? selectedIds : [])
          for (const hit of hits) next.add(hit.node_id)
          setSelectedIds(next)
          setPrimaryId(hits[hits.length - 1]?.node_id ?? null)
          setSelectedEdgeId(null)
        }
      }
      return
    }
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
        { id: dragged.node_id, x: rawX, y: rawY, height: nodeHeight(dragged), width: nodeWidth(dragged) },
        data.nodes.map(node => ({
          id: node.node_id,
          x: node.position.x,
          y: node.position.y,
          height: nodeHeight(node),
          width: nodeWidth(node),
        })),
      )
    // 全出血画布没有滚动容器：拖拽必须落在可见画布内（原型 editor.js:608-611 同样夹取）。
    const bounds = canvasRef.current?.getBoundingClientRect()
    const maxX = bounds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, bounds.width - (dragged === undefined ? NODE_WIDTH : nodeWidth(dragged)))
    const maxY = bounds === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, bounds.height - (dragged === undefined ? AGENT_NODE_HEIGHT : nodeHeight(dragged)))
    const x = Math.min(aligned.vertical.length > 0 ? Math.max(0, aligned.x) : Math.max(0, snap(rawX)), maxX)
    const y = Math.min(aligned.horizontal.length > 0 ? Math.max(0, aligned.y) : Math.max(0, snap(rawY)), maxY)
    setGuides({ vertical: aligned.vertical, horizontal: aligned.horizontal })
    setData(previous => ({
      ...previous,
      nodes: previous.nodes.map(node => (node.node_id === drag.id ? { ...node, position: { x, y } } : node)),
    }))
  }

  const onPointerUp = (): void => {
    const marqueeState = marqueeRef.current
    if (marqueeState !== null) {
      marqueeRef.current = null
      setMarquee(null)
      // 空白点击（未越过阈值）清空选择；Shift 点击保留已有选择。
      if (!marqueeState.active && !marqueeState.additive) clearSelection()
      return
    }
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    setGuides({ vertical: [], horizontal: [] })
    if (drag === null) return
    // 松手落到网格：PRD-02 FR-CANVAS-011 的验收是「出现对齐辅助线**且**松手后位置吸附网格」
    // ——辅助线只负责拖动中的引导（对齐到同伴边线可能落在网格之外，例如右边线 = 左 + 220），
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
    const appended = [...kept, settled].slice(-41)
    setHistory(appended)
    setHistoryIndex(appended.length - 1)
    lastCommitRef.current = null
  }

  const toggleGroup = (key: string): void => {
    setGroups(previous => ({ ...previous, [key]: !(previous[key] === true) }))
  }

  /** 切换网格：浮动工具条与「更多 → 切换网格」共用，偏好只写本机。 */
  const toggleGrid = (): void => {
    const next = !showGrid
    setShowGrid(next)
    try {
      window.localStorage.setItem(GRID_KEY, next ? '1' : '0')
    } catch {
      // 本机存储不可用：本次会话内仍按切换后的值渲染，只丢失下次进入的记忆。
    }
  }

  /** 清空画布（原型 editor.js:1142-1160）：移除全部节点与委派边，一步可撤销。 */
  const clearCanvas = (): void => {
    commit({ ...data, nodes: [], edges: [] })
    clearSelection()
    setClearOpen(false)
    toast.show(t('editor', 'toastCleared'), 'success')
  }

  /** 本画布关闭的客户端插件行 id（`settings.plugins.disable`）。 */
  const disabledPlugins = new Set(data.settings?.plugins?.disable ?? [])

  /**
   * 启用/关闭一条客户端插件行（只改该画布的实例差异；随画布保存一起提交）。
   * @param id - profile 组合行 id。
   * @param enabled - 该画布是否启用。
   */
  const togglePlugin = (id: string, enabled: boolean): void => {
    const plugins = { ...data.settings?.plugins }
    const next = new Set(disabledPlugins)
    if (enabled) next.delete(id)
    else next.add(id)
    if (next.size === 0) delete plugins.disable
    else plugins.disable = [...next].sort()
    commit({ ...data, settings: { ...data.settings, plugins } })
  }

  /** 解析插件配置 JSON：空串表示无配置；非法 JSON 不再写进画布。 */
  const parsePluginConfig = (raw: string): { config?: unknown; invalid: boolean } => {
    if (raw.trim() === '') return { invalid: false }
    try {
      return { config: JSON.parse(raw) as Record<string, unknown>, invalid: false }
    } catch {
      return { invalid: true }
    }
  }

  /** 画布实例新增的宿主行（`settings.plugins.add`）。 */
  const hostAdds = data.settings?.plugins?.add ?? []

  /** 新增一条宿主行：id 唯一、包名必填、配置必须是合法 JSON。 */
  const addHostPlugin = (): void => {
    const id = hostPluginDraft.id.trim()
    const name = hostPluginDraft.name.trim()
    if (id === '' || name === '') {
      setHostPluginError(t('editor', 'pluginRowRequired'))
      return
    }
    if (hostAdds.some(row => row.id === id) || pluginRows.some(row => row.id === id)) {
      setHostPluginError(t('editor', 'pluginRowDuplicate'))
      return
    }
    const parsed = parsePluginConfig(hostPluginDraft.config)
    if (parsed.invalid) {
      setHostPluginError(t('editor', 'pluginConfigInvalid'))
      return
    }
    const isolate = hostPluginDraft.isolate.split(',').map(item => item.trim()).filter(item => item !== '')
    const plugins = { ...data.settings?.plugins }
    plugins.add = [
      ...hostAdds,
      {
        id,
        name,
        ...(parsed.config === undefined ? {} : { config: parsed.config }),
        ...(isolate.length === 0 ? {} : { isolate }),
      },
    ]
    commit({ ...data, settings: { ...data.settings, plugins } })
    setHostPluginDraft({ id: '', name: '', isolate: '', config: '' })
    setHostPluginError(null)
  }

  /**
   * 移除一条宿主新增行。
   * @param id - 该行的实例内 id。
   */
  const removeHostPlugin = (id: string): void => {
    const plugins = { ...data.settings?.plugins }
    const next = hostAdds.filter(row => row.id !== id)
    if (next.length === 0) delete plugins.add
    else plugins.add = next
    commit({ ...data, settings: { ...data.settings, plugins } })
  }

  /** profile 组合里的宿主基线行（只读呈现：装载由组合层决定，画布不写这些行）。 */
  const hostBaselineRows = pluginRows.filter(row => row.kind === 'host')

  /** profile 组合里已禁用的客户端行：其包不在启动图中，可按实例新增回本画布。 */
  const addableClientRows = pluginRows.filter(row => row.kind === 'client' && row.disabled)

  /** 本画布替换的客户端行（`settings.plugins.replace`）。 */
  const clientReplaces = data.settings?.plugins?.replace ?? []

  /**
   * 启用/停用一条「实例新增客户端行」（写 `settings.plugins.add`，行 id 自动分配）。
   * @param base - profile 组合里被禁用的客户端行。
   * @param next - 是否新增。
   */
  const toggleClientAdd = (base: PluginRow, next: boolean): void => {
    const plugins = { ...data.settings?.plugins }
    const rest = hostAdds.filter(row => row.name !== base.name)
    if (next) {
      const taken = new Set([...pluginRows.map(row => row.id), ...hostAdds.map(row => row.id)])
      plugins.add = [...rest, { id: freshId('plugin', taken), name: base.name }]
    } else if (rest.length === 0) delete plugins.add
    else plugins.add = rest
    commit({ ...data, settings: { ...data.settings, plugins } })
  }

  /** 把一条基线客户端行替换为另一个客户端包（写 `settings.plugins.replace`）。 */
  const replaceClientPlugin = (): void => {
    if (replaceDraft.id === '' || replaceDraft.name === '') {
      setReplaceError(t('editor', 'pluginRowRequired'))
      return
    }
    const target = pluginRows.find(row => row.id === replaceDraft.id && row.kind === 'client')
    if (target === undefined) {
      setReplaceError(t('editor', 'pluginReplaceTarget'))
      return
    }
    if (clientReplaces.some(row => row.id === replaceDraft.id)) {
      setReplaceError(t('editor', 'pluginRowDuplicate'))
      return
    }
    if (target.name === replaceDraft.name) {
      setReplaceError(t('editor', 'pluginReplaceSame'))
      return
    }
    const plugins = { ...data.settings?.plugins }
    plugins.replace = [...clientReplaces, { id: replaceDraft.id, name: replaceDraft.name }]
    commit({ ...data, settings: { ...data.settings, plugins } })
    setReplaceDraft({ id: '', name: '' })
    setReplaceError(null)
  }

  /**
   * 移除一条客户端替换（恢复该基线行）。
   * @param id - 被替换的基线行 id。
   */
  const removeClientReplace = (id: string): void => {
    const plugins = { ...data.settings?.plugins }
    const next = clientReplaces.filter(row => row.id !== id)
    if (next.length === 0) delete plugins.replace
    else plugins.replace = next
    commit({ ...data, settings: { ...data.settings, plugins } })
  }

  /** 所选节点的节点级插件行。 */
  const nodePlugins = selectedNode?.plugins ?? []

  /** 新增一条节点级插件行：只挂该 agent 作用域。 */
  const addNodePlugin = (): void => {
    if (selectedNode === null) return
    const name = nodePluginDraft.name.trim()
    const id = nodePluginDraft.id.trim()
    if (name === '') {
      setNodePluginError(t('editor', 'pluginNameRequired'))
      return
    }
    if (id !== '' && nodePlugins.some(row => row.id === id)) {
      setNodePluginError(t('editor', 'pluginRowDuplicate'))
      return
    }
    const parsed = parsePluginConfig(nodePluginDraft.config)
    if (parsed.invalid) {
      setNodePluginError(t('editor', 'pluginConfigInvalid'))
      return
    }
    updateNode(selectedNode.node_id, {
      plugins: [
        ...nodePlugins,
        {
          ...(id === '' ? {} : { id }),
          name,
          ...(parsed.config === undefined ? {} : { config: parsed.config }),
        },
      ],
    })
    setNodePluginDraft({ name: '', id: '', config: '' })
    setNodePluginError(null)
  }

  /**
   * 移除一条节点级插件行。
   * @param index - 该行在节点插件清单中的位置。
   */
  const removeNodePlugin = (index: number): void => {
    if (selectedNode === null) return
    updateNode(selectedNode.node_id, { plugins: nodePlugins.filter((_row, at) => at !== index) })
  }

  /** 「添加节点」菜单（原型 editor.html:100-107）：角色模板分组 + 注释单列一组。 */
  const addNodeItems: MenuEntry[] = [
    { type: 'label', id: 'add-node-role', text: t('editor', 'addMenuRoleLabel') },
    ...presets.map(preset => ({ id: preset.id, label: rolePresetName(preset, locale === 'en' ? 'en' : 'zh') })),
    { type: 'separator', id: 'add-node-separator' },
    { id: 'note', label: t('editor', 'agentTypeNote') },
  ]

  /** 顶栏「更多」菜单（原型 editor.html:67-73）：复制画布 / 切换网格 / 清空画布 / 返回画布列表。 */
  const moreMenuItems: MenuEntry[] = [
    {
      id: 'package',
      label: t('editor', 'packaging'),
      icon: <IconArchiveOutlineMedium size={14} />,
      disabled: readOnly,
    },
    { id: 'duplicate', label: t('editor', 'menuDuplicateCanvas'), icon: <IconCopyOutlineRegular size={14} /> },
    {
      id: 'grid',
      label: t('editor', 'menuToggleGrid'),
      icon: <Glyph><path d="M3 7h14M3 13h14M7 3v14M13 3v14" /></Glyph>,
    },
    {
      id: 'clear',
      label: t('editor', 'menuClearCanvas'),
      icon: <IconRefreshOutlineRegular size={14} />,
      // 只读模板的结构修改会在后端被拒：与所有写入口一致，直接置灰。
      disabled: readOnly,
    },
    { type: 'separator', id: 'more-separator' },
    { id: 'back', label: t('canvases', 'menuBack'), icon: <IconChevronLeftOutlineRegular size={14} /> },
  ]

  return (
    <div className={editor.editor} onKeyDown={onEditorKeyDown} ref={editorRef} tabIndex={-1}>
      <a className={editor.skipLink} href="#canvas">{t('editor', 'skipToCanvas')}</a>
      {/* 56px 图标轨：品牌、返回、添加节点、撤销/重做、检查器、运行面板、主题。 */}
      <aside className={editor.rail} aria-label={t('editor', 'toolbar')}>
        <button
          type="button"
          className={editor.railBrand}
          aria-label={t('shell', 'brandHome')}
          title={t('shell', 'brand')}
          onClick={() => { navigate('/') }}
        >
          <BrandGlyph size={22} />
        </button>
        <button
          type="button"
          className={editor.railButton}
          aria-label={t('common', 'actionBack')}
          title={t('common', 'actionBack')}
          onClick={() => { navigate('/canvas') }}
        >
          <IconChevronLeftOutlineRegular size={16} />
        </button>
        <span className={editor.railDivider} />
        <Menu
          open={addMenuOpen}
          autoFocus
          align="start"
          items={addNodeItems}
          onSelect={(id) => {
            const presetId = presets.find(item => item.id === id)
            if (presetId !== undefined) addNode(presetId.id)
            if (id === 'note') addNode('note')
            setAddMenuOpen(false)
          }}
          onClose={() => { setAddMenuOpen(false) }}
          anchor={(
            <button
              type="button"
              className={editor.railButton}
              aria-label={t('editor', 'toolbarAddNode')}
              title={t('editor', 'toolbarAddNode')}
              onClick={() => { setAddMenuOpen(!addMenuOpen) }}
            >
              <IconPlusOutlineRegular size={16} />
            </button>
          )}
        />
        <button
          type="button"
          className={editor.railButton}
          aria-label={t('editor', 'undo')}
          title={t('editor', 'undoHint')}
          disabled={historyIndex <= 0}
          onClick={undo}
        >
          <Glyph><path d="M4 9h7a4 4 0 0 1 0 8H8M4 9l4-4M4 9l4 4" /></Glyph>
        </button>
        <button
          type="button"
          className={editor.railButton}
          aria-label={t('editor', 'redo')}
          title={t('editor', 'redoHint')}
          disabled={historyIndex >= history.length - 1}
          onClick={redo}
        >
          <Glyph><path d="M16 9H9a4 4 0 0 0 0 8h3M16 9l-4-4M16 9l-4 4" /></Glyph>
        </button>
        <span className={editor.railSpacer} />
        <button
          type="button"
          className={editor.railButton}
          aria-label={t('editor', 'inspectorToggle')}
          title={t('editor', 'inspectorToggle')}
          aria-pressed={inspectorOpen}
          onClick={() => { setInspectorOpen(!inspectorOpen) }}
        >
          <IconPanelLeftOutlineRegular size={16} />
        </button>
        <button
          type="button"
          className={editor.railButton}
          aria-label={t('editor', panelCollapsed ? 'expandPanel' : 'collapsePanel')}
          title={t('editor', panelCollapsed ? 'expandPanel' : 'collapsePanel')}
          aria-pressed={!panelCollapsed}
          onClick={() => { setPanelCollapsed(!panelCollapsed) }}
        >
          <IconCodeOutlineRegular size={16} />
        </button>
        <ThemeCycleButton
          authenticated
          onError={(message) => { setError({ key: 'errorSave', detail: message }) }}
        />
      </aside>
      <div className={editor.workspace}>
        <div className={editor.toolbar}>
          <div className={editor.toolbarLeft}>
            <button
              type="button"
              className={editor.topbarIcon}
              aria-label={t('common', 'actionBack')}
              title={t('common', 'actionBack')}
              onClick={() => { navigate('/canvas') }}
            >
              <IconChevronLeftOutlineRegular size={16} />
            </button>
            <span className={editor.topbarDivider} aria-hidden="true" />
            <input
              type="text"
              className={editor.canvasName}
              value={meta.name}
              aria-label={t('editor', 'canvasName')}
              onChange={(event) => { setMeta({ ...meta, name: event.currentTarget.value }) }}
            />
            <span className={editor.saveState} data-state={saving ? 'saving' : dirty ? 'dirty' : 'saved'}>
              <span className={editor.saveDot} />
              {saving ? t('editor', 'saving') : dirty ? t('common', 'stateUnsaved') : t('common', 'stateSaved')}
            </span>
          </div>
          <div className={editor.toolbarRight}>
            <button
              type="button"
              className={editor.topbarIcon}
              aria-label={t('editor', 'undo')}
              title={t('editor', 'undo')}
              disabled={historyIndex <= 0}
              onClick={undo}
            >
              <Glyph><path d="M4 9h7a4 4 0 0 1 0 8H8M4 9l4-4M4 9l4 4" /></Glyph>
            </button>
            <button
              type="button"
              className={editor.topbarIcon}
              aria-label={t('editor', 'redo')}
              title={t('editor', 'redo')}
              disabled={historyIndex >= history.length - 1}
              onClick={redo}
            >
              <Glyph><path d="M16 9H9a4 4 0 0 0 0 8h3M16 9l-4-4M16 9l-4 4" /></Glyph>
            </button>
            <button
              type="button"
              className={editor.topbarIcon}
              aria-label={t('editor', 'save')}
              title={t('editor', 'save')}
              disabled={!dirty || saving || readOnly}
              onClick={() => { void save() }}
            >
              <Glyph><path d="M4 4h9l3 3v9H4V4Zm2 0v5h6V4M7 16v-4h6v4" /></Glyph>
            </button>
            <span className={editor.topbarDivider} aria-hidden="true" />
            <Button
              size="sm"
              className={editor.previewButton}
              icon={<Glyph><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" /><circle cx="10" cy="10" r="2.4" /></Glyph>}
              onClick={() => { setPanelCollapsed(false); setPreviewSignal(value => value + 1) }}
            >
              {t('editor', 'previewAction')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<IconPlayOutlineRegular size={14} />}
              onClick={() => { openPage(`/run/${canvasId}`) }}
            >
              {t('editor', 'run')}
            </Button>
            <Button
              size="sm"
              className={editor.packageButton}
              icon={<IconArchiveOutlineMedium size={14} />}
              onClick={() => { setPackageOpen(true) }}
            >
              {t('editor', 'packaging')}
            </Button>
            {/* 顶栏 overflow:hidden（防控件被压扁）：菜单必须 portal 到 body，否则被裁掉。 */}
            <Menu
              open={moreMenuOpen}
              align="end"
              portal
              items={moreMenuItems}
              onSelect={(id) => {
                setMoreMenuOpen(false)
                if (id === 'duplicate') void duplicateCanvas()
                if (id === 'package') setPackageOpen(true)
                if (id === 'grid') toggleGrid()
                if (id === 'clear') setClearOpen(true)
                if (id === 'back') navigate('/canvas')
              }}
              onClose={() => { setMoreMenuOpen(false) }}
              anchor={(
                <Button
                  size="sm"
                  variant="ghost"
                  className={editor.topbarIcon}
                  icon={<IconEllipsisOutlineRegular size={14} />}
                  aria-label={t('editor', 'moreActions')}
                  title={t('editor', 'moreActions')}
                  onClick={() => { setMoreMenuOpen(!moreMenuOpen) }}
                />
              )}
            />
          </div>
        </div>

        <div className={editor.body} data-inspector={inspectorOpen ? 'open' : 'closed'}>
          <div className={editor.stage} id="canvas" role="region" aria-label={t('editor', 'canvasRegion')}>
            <div className={editor.canvasPane}>
              <div className={editor.canvasFloat}>
                <Menu
                  open={canvasAddOpen}
                  autoFocus
                  align="start"
                  items={addNodeItems}
                  onSelect={(id) => {
                    if (presets.some(preset => preset.id === id)) addNode(id)
                    if (id === 'note') addNode('note')
                    setCanvasAddOpen(false)
                  }}
                  onClose={() => { setCanvasAddOpen(false) }}
                  anchor={(
                    <Button
                      size="sm"
                      icon={<IconPlusOutlineRegular size={14} />}
                      onClick={() => { setCanvasAddOpen(!canvasAddOpen) }}
                    >
                      {t('editor', 'toolbarAddNode')}
                      <IconChevronDownOutlineRegular size={12} />
                    </Button>
                  )}
                />
                <span className={editor.canvasFloatDivider} aria-hidden="true" />
                <button
                  type="button"
                  className={editor.canvasFloatIcon}
                  aria-label={t('editor', 'toggleGrid')}
                  title={t('editor', 'toggleGrid')}
                  aria-pressed={showGrid}
                  onClick={toggleGrid}
                >
                  <Glyph><path d="M3 7h14M3 13h14M7 3v14M13 3v14" /></Glyph>
                </button>
                <button
                  type="button"
                  className={editor.canvasFloatIcon}
                  aria-label={t('editor', 'arrangeNodes')}
                  title={t('editor', 'arrangeNodes')}
                  onClick={arrangeNodes}
                >
                  <Glyph><circle cx="10" cy="10" r="6" /><circle cx="10" cy="10" r="2" /></Glyph>
                </button>
              </div>
              <div
                className={editor.canvasSurface}
                data-grid={showGrid ? '' : undefined}
                ref={canvasRef}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onPointerDown={(event) => {
                  // 只有空白画布（target 就是画布面本身）才开始框选；节点/边命中线各自处理。
                  if (event.target !== event.currentTarget) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  const x = event.clientX - rect.left
                  const y = event.clientY - rect.top
                  marqueeRef.current = { x0: x, y0: y, x1: x, y1: y, additive: event.shiftKey, active: false }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  // 空白点击会把焦点交给 body；拉回编辑器根，保证随后的 Ctrl+A/C/V/D 仍被接收。
                  editorRef.current?.focus({ preventScroll: true })
                }}
              >
                {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
                {/* 框选矩形（W11.3）：超过 3px 阈值才渲染，松手即撤。 */}
                {marquee !== null && (
                  <span
                    className={editor.marquee}
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                    }}
                  />
                )}
                {/* 对齐辅助线（拖拽中才出现；松手即撤，PRD-02 FR-CANVAS-010/011）。 */}
                {guides.vertical.map(x => (
                  <span key={`guide-v-${String(x)}`} className={editor.alignGuideVertical} style={{ left: x }} />
                ))}
                {guides.horizontal.map(y => (
                  <span key={`guide-h-${String(y)}`} className={editor.alignGuideHorizontal} style={{ top: y }} />
                ))}
                <svg className={editor.edgeLayer}>
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
                    const path = edgePath(from, to)
                    return (
                      <>
                        {/* 命中线：可见线 1.2px 无法命中（edgeLayer pointer-events:none +
                          命中区过窄，elementFromPoint 落在画布面上），选中/删除委派边的
                          交互因此完全不可达。透明 12px 命中线只承载点击，不影响视觉。 */}
                        <path
                          key={`hit-${edge.edge_id}`}
                          className={editor.edgeHit}
                          d={path}
                          onClick={() => {
                          // 边选中与节点选择互斥：清节点集合，只留这条边。
                            setSelectedIds(new Set<string>())
                            setPrimaryId(null)
                            setSelectedEdgeId(edge.edge_id)
                          }}
                        />
                        <path
                          key={edge.edge_id}
                          className={edge.edge_id === selectedEdgeId ? editor.edgeSelected : editor.edge}
                          d={path}
                          markerEnd="url(#se-edge-arrow)"
                        />
                      </>
                    )
                  })}
                  {portDrag !== null && (() => {
                    const from = data.nodes.find(node => node.node_id === portDrag.from)
                    if (from === undefined) return null
                    return (
                      <path
                        className={editor.edgeTemp}
                        d={tempEdgePath(from, portDrag.x, portDrag.y)}
                      />
                    )
                  })()}
                </svg>
                {data.nodes.map(node => (
                  <div
                    key={node.node_id}
                    tabIndex={0}
                    aria-label={`${node.name} · ${roleLabel(node, presets, locale)}`}
                    data-node-id={node.node_id}
                    className={[
                      editor.node,
                      isNote(node) ? editor.nodeNoteNode : '',
                      selectedIds.has(node.node_id) ? editor.nodeSelected : '',
                      node.node_id === draggingId ? editor.nodeDragging : '',
                    ].filter(part => part !== '').join(' ')}
                    style={{ left: node.position.x, top: node.position.y }}
                    onPointerDown={(event) => {
                    // Shift 点选只切换选中态，不进入拖拽（避免误移动）。
                      if (event.shiftKey) {
                        event.preventDefault()
                        toggleSelected(node.node_id)
                        event.currentTarget.focus({ preventScroll: true })
                        return
                      }
                      if (!selectedIds.has(node.node_id)) selectOnly(node.node_id)
                      else {
                      // 已选中的节点被拖动：保留多选集合，只把主选中切到它。
                        setPrimaryId(node.node_id)
                        setSelectedEdgeId(null)
                      }
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
                    <div className={editor.nodeHead}>
                      <span className={editor.nodeGlyph}><NodeGlyph node={node} /></span>
                      <div className={editor.nodeTitles}>
                        <div className={editor.nodeTitle}>{node.name}</div>
                        <div className={editor.nodeRole}>
                          {`${roleLabel(node, presets, locale)} · ${roleCode(node)}`}
                        </div>
                      </div>
                      <span className={editor.nodeStatus} aria-hidden="true" />
                    </div>
                    {isNote(node)
                      ? <p className={editor.nodeNote}>{node.system_prompt ?? node.summary ?? ''}</p>
                      : <p className={editor.nodeSummary}>{node.summary ?? ''}</p>}
                    <div className={editor.nodeFoot}>
                      <span className={editor.nodeFootDot} />
                      <span className={editor.nodeFootText}>
                        {isNote(node)
                          ? t('editor', 'agentTypeNote')
                          : `${node.model_ref === undefined || node.model_ref === ''
                            ? t('editor', 'modelNone')
                            : models.find(model => model.id === node.model_ref)?.name ?? node.model_ref} · ${t('editor', 'nodeTools', { count: (node.tools ?? []).length })}`}
                      </span>
                    </div>
                    {!isNote(node) && (
                      <span
                        className={editor.nodePort}
                        title={t('editor', 'edgesAdd')}
                        onPointerDown={(event) => {
                        // 端口拖线：捕获指针，松手落到另一个节点上即建委派边（注释无端口）。
                          event.stopPropagation()
                          const rect = canvasRef.current?.getBoundingClientRect()
                          if (rect === undefined) return
                          setPortDrag({ from: node.node_id, x: event.clientX - rect.left, y: event.clientY - rect.top })
                          event.currentTarget.setPointerCapture(event.pointerId)
                        }}
                        onPointerMove={(event) => {
                          if (portDrag === null || portDrag.from !== node.node_id) return
                          const rect = canvasRef.current?.getBoundingClientRect()
                          if (rect === undefined) return
                          setPortDrag({ from: node.node_id, x: event.clientX - rect.left, y: event.clientY - rect.top })
                        }}
                        onPointerUp={(event) => {
                          if (portDrag === null || portDrag.from !== node.node_id) return
                          const target = document.elementFromPoint(event.clientX, event.clientY)
                          const targetId = target instanceof Element
                            ? target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
                            : null
                          if (targetId !== null && targetId !== node.node_id) addEdge(node.node_id, targetId)
                          setPortDrag(null)
                          event.stopPropagation()
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className={editor.canvasHint}>{t('editor', 'canvasHint')}</div>
              {!loading && data.nodes.length === 0 && (
                <div className={editor.canvasEmpty}>
                  <span className={editor.canvasEmptyIcon}>
                    <Glyph size={20}><path d="M3 7h14M3 13h14M7 3v14M13 3v14" /></Glyph>
                  </span>
                  <p className={editor.canvasEmptyTitle}>{t('editor', 'emptyTitle')}</p>
                  <p className={editor.canvasEmptyDesc}>{t('editor', 'emptyDesc')}</p>
                  <Button size="sm" variant="primary" onClick={() => { addNode('coordinator') }}>
                    {t('editor', 'emptyAdd')}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <aside className={editor.panel} ref={panelRef} aria-label={t('editor', 'inspectorRegion')} onBlur={() => { if (dirty && !saving) void save() }}>
            <div className={editor.panelHead}>
              <div className={editor.panelHeading}>
                <h2 className={editor.panelTitle}>
                  {selectedNode === null ? t('editor', 'panelGlobal') : t('editor', 'panelNode')}
                </h2>
                <p className={editor.panelHint}>
                  {selectedNode === null
                    ? t('editor', 'panelNoSelection')
                    : selectedIds.size > 1
                      ? `${t('editor', 'multiSelected', { count: selectedIds.size })} · ${roleLabel(selectedNode, presets, locale)} · ${selectedNode.name}`
                      : `${roleLabel(selectedNode, presets, locale)} · ${selectedNode.name}`}
                </p>
              </div>
              {(selectedNode !== null || narrow) && (
                <button
                  type="button"
                  className={editor.panelClose}
                  aria-label={t('editor', narrow ? 'closeInspector' : 'deselect')}
                  title={t('editor', narrow ? 'closeInspector' : 'deselect')}
                  onClick={() => {
                    clearSelection()
                    if (narrow) setInspectorOpen(false)
                  }}
                >
                  <IconCloseOutlineRegular size={14} />
                </button>
              )}
            </div>
            <div className={editor.panelBody}>
              <NoticeLine tone="error" text={error === null ? null : `${t('editor', error.key)} — ${error.detail}`} />
              <NoticeLine
                tone="info"
                text={staleRefs.length === 0 ? null : `${t('editor', 'refsUnavailable')} ${staleRefs.join('; ')}`}
              />
              <NoticeLine
                tone="error"
                text={conflict ? t('editor', 'conflictHint') : null}
                action={{ label: t('editor', 'conflictReload'), onClick: () => { void load() } }}
              />

              <NoticeLine
                tone="info"
                text={readOnly ? t('editor', 'readOnlyTemplate') : null}
                {...readOnly
                  ? { action: { label: t('canvases', 'duplicate'), onClick: () => { void duplicateCanvas() } } }
                  : {}}
              />

              {selectedNode === null && (
                <div className={editor.panelSection}>
                  <div className={editor.panelGroup}>
                    <Field label={t('editor', 'canvasName')} hint={t('editor', 'canvasNameHint')}>
                      <Input
                        value={meta.name}
                        onChange={(event) => { setMeta({ ...meta, name: event.currentTarget.value }) }}
                      />
                    </Field>
                    <Field label={t('editor', 'canvasDescription')}>
                      <textarea
                        className={`${css.textarea} ${editor.descriptionArea ?? ''}`}
                        rows={3}
                        value={meta.description}
                        placeholder={t('editor', 'canvasDescriptionPlaceholder')}
                        onChange={(event) => { setMeta({ ...meta, description: event.currentTarget.value }) }}
                      />
                    </Field>
                    {/* 图标与标签和列表卡片同源（`canvases.iconLabel`/`common.labelTags`），
                  保存走同一次 PATCH；卡片首字回落基于 `icon` 为空。 */}
                    <Field label={t('canvases', 'iconLabel')}>
                      <IconPicker value={meta.icon} onChange={(next) => { setMeta({ ...meta, icon: next }) }} />
                    </Field>
                    <Field label={t('common', 'labelTags')}>
                      <Input
                        value={meta.tags}
                        placeholder={t('canvases', 'tagsPlaceholder')}
                        onChange={(event) => { setMeta({ ...meta, tags: event.currentTarget.value }) }}
                      />
                    </Field>
                    <div className={editor.field}>
                      <span className={editor.fieldLabel}>{t('editor', 'runMode')}</span>
                      <select
                        className={editor.select}
                        aria-label={t('editor', 'runMode')}
                        value={data.settings?.run_mode ?? 'workspace-write'}
                        onChange={(event) => {
                          const runMode = event.currentTarget.value
                          if (runMode !== 'workspace-write' && runMode !== 'approve-for-me' && runMode !== 'danger-full-access') return
                          commit({ ...data, settings: { ...data.settings, run_mode: runMode } })
                        }}
                      >
                        <option value="workspace-write">{t('editor', 'runModeWorkspaceWrite')}</option>
                        <option value="approve-for-me">{t('editor', 'runModeApproveForMe')}</option>
                        <option value="danger-full-access">{t('editor', 'runModeFullAccess')}</option>
                      </select>
                    </div>
                    <div className={editor.field}>
                      <span className={editor.fieldLabel}>{t('editor', 'liveFollow')}</span>
                      {/* 原型 `state.liveFollow == null → true`：画布没有显式取值时默认开启，只有用户切换才写入。 */}
                      <Switch
                        checked={data.settings?.live_follow !== false}
                        label={t('editor', 'liveFollow')}
                        onChange={(next) => { commit({ ...data, settings: { ...data.settings, live_follow: next } }) }}
                      />
                      <span className={editor.fieldHint}>{t('editor', 'liveFollowHint')}</span>
                    </div>
                    <div className={editor.field}>
                      <DisclosureRow
                        icon={<IconPlusOutlineRegular size={14} />}
                        title={t('editor', 'pluginsTitle')}
                        open={groups.plugins === true}
                        expandable
                        expandOnRowClick
                        onToggle={() => { toggleGroup('plugins') }}
                      >
                        <div className={editor.groupBody}>
                          <span className={editor.fieldHint}>{t('editor', 'pluginsHint')}</span>
                          {/* 宿主基线行（原型 editor.js:330-335 列出全部基线行）：只读呈现，装载由 profile 组合决定。 */}
                          <span className={editor.fieldLabel}>{t('editor', 'hostBaselineTitle')}</span>
                          <span className={editor.fieldHint}>{t('editor', 'hostBaselineHint')}</span>
                          {hostBaselineRows.length === 0
                            ? <span className={editor.fieldHint}>{t('common', 'stateEmpty')}</span>
                            : (
                              <>
                                <span className={editor.fieldHint}>{t('editor', 'hostBaselineCount', { count: hostBaselineRows.length })}</span>
                                {hostBaselineRows.map(row => (
                                  <div key={row.id} className={editor.edgeRow}>
                                    <span className={css.mono}>{row.id} · {row.name}</span>
                                    <span className={editor.fieldHint}>
                                      {row.disabled ? t('editor', 'pluginsBaselineOff') : t('editor', 'pluginBaselineOn')}
                                    </span>
                                  </div>
                                ))}
                              </>
                            )}
                          {/* 客户端插件行 = 该画布运行面板的装载集合（Plan W4）；宿主基线行只读列在上面。 */}
                          <MultiSelectList
                            options={pluginRows
                              .filter(row => row.kind === 'client')
                              .map(row => ({
                                id: row.id,
                                label: `${row.id} · ${row.name}`,
                                disabledReason: row.disabled ? t('editor', 'pluginsBaselineOff') : null,
                              }))}
                            selected={pluginRows
                              .filter(row => row.kind === 'client' && !row.disabled && !disabledPlugins.has(row.id))
                              .map(row => row.id)}
                            emptyText={t('editor', 'pluginsEmpty')}
                            onToggle={togglePlugin}
                          />
                          {/* 新增/替换客户端行与后端 `settings.plugins.add/replace` 同一写入口径：
                        包名取自 `GET /plugins` 的客户端行清单，行 id 只在本画布实例内生效。 */}
                          <span className={editor.fieldLabel}>{t('editor', 'clientAddTitle')}</span>
                          <span className={editor.fieldHint}>{t('editor', 'clientAddHint')}</span>
                          <MultiSelectList
                            options={addableClientRows.map(row => ({
                              id: row.id,
                              label: `${row.id} · ${row.name}`,
                              disabledReason: null,
                            }))}
                            selected={addableClientRows
                              .filter(base => hostAdds.some(row => row.name === base.name))
                              .map(row => row.id)}
                            emptyText={t('editor', 'clientAddEmpty')}
                            onToggle={(id, next) => {
                              const base = addableClientRows.find(row => row.id === id)
                              if (base !== undefined) toggleClientAdd(base, next)
                            }}
                          />
                          <span className={editor.fieldLabel}>{t('editor', 'clientReplaceTitle')}</span>
                          <span className={editor.fieldHint}>{t('editor', 'clientReplaceHint')}</span>
                          {clientReplaces.map(row => (
                            <div key={row.id} className={editor.edgeRow}>
                              <span className={css.mono}>{row.id} → {row.name}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<IconTrashOutlineRegular size={14} />}
                                aria-label={t('editor', 'pluginRemove')}
                                onClick={() => { removeClientReplace(row.id) }}
                              />
                            </div>
                          ))}
                          <MultiSelectList
                            options={pluginRows
                              .filter(row => row.kind === 'client' && !clientReplaces.some(item => item.id === row.id))
                              .map(row => ({ id: row.id, label: `${row.id} · ${row.name}`, disabledReason: null }))}
                            selected={replaceDraft.id === '' ? [] : [replaceDraft.id]}
                            emptyText={t('editor', 'clientReplaceEmpty')}
                            onToggle={(id, next) => {
                              setReplaceDraft({ ...replaceDraft, id: next ? id : '' })
                              setReplaceError(null)
                            }}
                          />
                          <MultiSelectList
                            options={[...new Set(pluginRows.filter(row => row.kind === 'client').map(row => row.name))]
                              .map(name => ({ id: name, label: name, disabledReason: null }))}
                            selected={replaceDraft.name === '' ? [] : [replaceDraft.name]}
                            emptyText={t('editor', 'clientReplaceEmpty')}
                            onToggle={(name, next) => {
                              setReplaceDraft({ ...replaceDraft, name: next ? name : '' })
                              setReplaceError(null)
                            }}
                          />
                          {replaceError !== null && <NoticeLine tone="error" text={replaceError} />}
                          <Button size="sm" onClick={replaceClientPlugin}>{t('editor', 'pluginReplace')}</Button>
                          <span className={editor.fieldLabel}>{t('editor', 'hostPluginsTitle')}</span>
                          <span className={editor.fieldHint}>{t('editor', 'hostPluginsHint')}</span>
                          {hostAdds.length === 0
                            ? <span className={editor.fieldHint}>{t('common', 'stateEmpty')}</span>
                            : hostAdds.map(row => (
                              <div key={row.id} className={editor.edgeRow}>
                                <span className={css.mono}>
                                  {row.id} · {row.name}
                                  {row.isolate === undefined ? '' : t('editor', 'pluginIsolateSuffix', { list: row.isolate.join(', ') })}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<IconTrashOutlineRegular size={14} />}
                                  aria-label={t('editor', 'pluginRemove')}
                                  onClick={() => { removeHostPlugin(row.id) }}
                                />
                              </div>
                            ))}
                          <Field label={t('editor', 'pluginRowId')}>
                            <Input
                              value={hostPluginDraft.id}
                              onChange={(event) => {
                                setHostPluginDraft({ ...hostPluginDraft, id: event.currentTarget.value })
                                setHostPluginError(null)
                              }}
                            />
                          </Field>
                          <Field label={t('editor', 'pluginPackage')}>
                            <Input
                              value={hostPluginDraft.name}
                              onChange={(event) => {
                                setHostPluginDraft({ ...hostPluginDraft, name: event.currentTarget.value })
                                setHostPluginError(null)
                              }}
                            />
                          </Field>
                          <Field label={t('editor', 'pluginIsolate')}>
                            <Input
                              value={hostPluginDraft.isolate}
                              onChange={(event) => { setHostPluginDraft({ ...hostPluginDraft, isolate: event.currentTarget.value }) }}
                            />
                          </Field>
                          <Field label={t('editor', 'pluginConfig')}>
                            <textarea
                              className={`${css.textarea} ${css.textareaMono}`}
                              value={hostPluginDraft.config}
                              onChange={(event) => {
                                setHostPluginDraft({ ...hostPluginDraft, config: event.currentTarget.value })
                                setHostPluginError(null)
                              }}
                            />
                          </Field>
                          {hostPluginError !== null && <NoticeLine tone="error" text={hostPluginError} />}
                          <Button size="sm" onClick={addHostPlugin}>{t('editor', 'pluginAdd')}</Button>
                        </div>
                      </DisclosureRow>
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
                    {/* 统计（原型 editor.js:336-340「统计」节）：节点 / 委派边计数 + 保存位置。 */}
                    <div className={editor.panelSection}>
                      <div className={editor.panelGroup}>
                        <span className={editor.fieldLabel}>{t('editor', 'groupStats')}</span>
                        <div className={editor.statRow}>
                          <span>{t('editor', 'statsNodes')}</span>
                          <span className={css.mono}>{String(data.nodes.length)}</span>
                        </div>
                        <div className={editor.statRow}>
                          <span>{t('editor', 'statsEdges')}</span>
                          <span className={css.mono}>{String(data.edges.length)}</span>
                        </div>
                        <div className={editor.statRow}>
                          <span>{t('editor', 'statsSaveLocation')}</span>
                          <span className={css.mono}>{t('editor', 'statsSaveLocationValue')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedNode !== null && (
                <>
                  <DisclosureRow
                    className={editor.panelSection}
                    icon={<IconPlusOutlineRegular size={14} />}
                    title={t('editor', 'groupIdentity')}
                    open={groups.identity === true}
                    expandable
                    expandOnRowClick
                    onToggle={() => { toggleGroup('identity') }}
                  >
                    <div className={editor.groupBody}>
                      {/* 身份徽标（原型 editor.js:376-379 身份节首行）：角色模板名 · 协议代码。 */}
                      <span className={editor.panelTypeBadge}>
                        <NodeGlyph node={selectedNode} />
                        {`${roleLabel(selectedNode, presets, locale)} · ${roleCode(selectedNode)}`}
                      </span>
                      {!isNote(selectedNode) && (
                        <div className={editor.field}>
                          <span className={editor.fieldLabel}>{t('editor', 'roleTemplate')}</span>
                          <div className={css.chipRow}>
                            {presets.map(preset => (
                              <Pill
                                key={preset.id}
                                active={selectedNode.role === preset.id}
                                aria-pressed={selectedNode.role === preset.id}
                                onClick={() => {
                                  if (selectedNode.role === preset.id) return
                                  // 已偏离当前模板时，切换会用模板内容覆盖提示词与工具（v0.4.0 同一保护）。
                                  if (roleDiffers(selectedNode, presets)) {
                                    setAcknowledged(false)
                                    setRoleSwitch({ nodeId: selectedNode.node_id, presetId: preset.id })
                                    return
                                  }
                                  applyRole(selectedNode.node_id, preset.id)
                                }}
                              >
                                {rolePresetName(preset, locale === 'en' ? 'en' : 'zh')}
                              </Pill>
                            ))}
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<IconPlusOutlineRegular size={12} />}
                              onClick={() => { setTemplateOpen(true) }}
                            >
                              {t('editor', 'roleTemplateNew')}
                            </Button>
                          </div>
                          <span className={editor.fieldHint}>{t('editor', 'roleTemplateHint')}</span>
                        </div>
                      )}
                      <Field label={t('editor', 'nodeName')}>
                        <Input
                          value={selectedNode.name}
                          onChange={(event) => { updateNode(selectedNode.node_id, { name: event.currentTarget.value }) }}
                        />
                      </Field>
                      {!isNote(selectedNode) && (
                        <Field label={t('editor', 'nodeSummary')}>
                          <Input
                            value={selectedNode.summary ?? ''}
                            onChange={(event) => { updateNode(selectedNode.node_id, { summary: event.currentTarget.value }) }}
                          />
                        </Field>
                      )}
                      <span className={editor.fieldHint}>
                        {t('editor', 'positionLabel')} {selectedNode.position.x}, {selectedNode.position.y}
                      </span>
                    </div>
                  </DisclosureRow>

                  {/* 注释（原型 editor.js:381-386）：注释节点有独立的注释节，正文不写进身份节。 */}
                  {isNote(selectedNode) && (
                    <DisclosureRow
                      className={editor.panelSection}
                      icon={<IconPlusOutlineRegular size={14} />}
                      title={t('editor', 'groupNote')}
                      open={groups.note === true}
                      expandable
                      expandOnRowClick
                      onToggle={() => { toggleGroup('note') }}
                    >
                      <div className={editor.groupBody}>
                        {/* 与节点卡片同一正文来源（`system_prompt ?? summary`）：旧注释只存 summary 时也能继续编辑。 */}
                        <textarea
                          className={css.textarea}
                          value={selectedNode.system_prompt ?? selectedNode.summary ?? ''}
                          placeholder={t('editor', 'notePlaceholder')}
                          aria-label={t('editor', 'notePlaceholder')}
                          onChange={(event) => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
                        />
                      </div>
                    </DisclosureRow>
                  )}

                  {!isNote(selectedNode) && (
                    <>
                      <DisclosureRow
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
                        title={t('editor', 'groupModel')}
                        open={groups.model === true}
                        expandable
                        expandOnRowClick
                        onToggle={() => { toggleGroup('model') }}
                      >
                        <div className={editor.groupBody}>
                          <div className={editor.field}>
                            <span className={editor.fieldLabel}>{t('editor', 'nodeModel')}</span>
                            <select
                              className={editor.select}
                              value={selectedNode.model_ref ?? ''}
                              aria-label={t('editor', 'nodeModel')}
                              onChange={(event) => { updateNode(selectedNode.node_id, { model_ref: event.currentTarget.value }) }}
                            >
                              <option value="">{t('editor', 'modelNone')}</option>
                              {modelGroups.map(([provider, items]) => (
                                <optgroup key={provider} label={provider}>
                                  {items.map(item => (
                                    <option key={item.id} value={item.id} disabled={item.disabled}>{item.label}</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <span className={editor.fieldHint}>{t('editor', 'modelRequired')}</span>
                          </div>
                        </div>
                      </DisclosureRow>

                      <DisclosureRow
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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
                            aria-label={t('editor', 'groupPrompt')}
                            onChange={(event) => { updateNode(selectedNode.node_id, { system_prompt: event.currentTarget.value }) }}
                          />
                        </div>
                      </DisclosureRow>

                      <DisclosureRow
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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
                            stale={staleByNode.get(selectedNode.node_id)?.skills ?? []}
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
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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
                            stale={staleByNode.get(selectedNode.node_id)?.servers ?? []}
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
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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

                  {!isNote(selectedNode) && (
                    <>
                      <DisclosureRow
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
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
                                icon={<IconCloseOutlineRegular size={12} />}
                                onClick={() => { removeEdge(edge.edge_id) }}
                              >
                                {t('editor', 'edgesRemove')}
                              </Button>
                            </div>
                          ))}
                          {edgeTargets.length === 0
                            ? <span className={editor.fieldHint}>{t('editor', 'edgesNoTargets')}</span>
                            : (
                              <div className={editor.field}>
                                <span className={editor.fieldLabel}>{t('editor', 'edgesAdd')}</span>
                                <div className={editor.edgeAddRow}>
                                  <select
                                    className={editor.select}
                                    value={edgeTargets.some(node => node.node_id === edgeTarget) ? edgeTarget : edgeTargets[0]?.node_id ?? ''}
                                    aria-label={t('editor', 'edgesAdd')}
                                    onChange={(event) => { setEdgeTarget(event.currentTarget.value) }}
                                  >
                                    {edgeTargets.map(node => (
                                      <option key={node.node_id} value={node.node_id}>
                                        {`${node.name} · ${roleLabel(node, presets, locale)}`}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const target = edgeTargets.some(node => node.node_id === edgeTarget)
                                        ? edgeTarget
                                        : edgeTargets[0]?.node_id ?? ''
                                      if (target !== '') addEdge(selectedNode.node_id, target)
                                    }}
                                  >
                                    {t('editor', 'edgesAddAction')}
                                  </Button>
                                </div>
                              </div>
                            )}
                        </div>
                      </DisclosureRow>

                      {/* 节点插件：原型没有这一节，保留在委派边之后（不在采样参数与委派边之间截断顺序）。 */}
                      <DisclosureRow
                        className={editor.panelSection}
                        icon={<IconPlusOutlineRegular size={14} />}
                        title={t('editor', 'groupNodePlugins')}
                        open={groups.nodePlugins === true}
                        expandable
                        expandOnRowClick
                        onToggle={() => { toggleGroup('nodePlugins') }}
                      >
                        <div className={editor.groupBody}>
                          <span className={editor.fieldHint}>{t('editor', 'nodePluginsHint')}</span>
                          {nodePlugins.length === 0
                            ? <span className={editor.fieldHint}>{t('common', 'stateEmpty')}</span>
                            : nodePlugins.map((row, index) => (
                              <div key={`${row.id ?? row.name}-${String(index)}`} className={editor.edgeRow}>
                                <span className={css.mono}>{row.id === undefined ? row.name : `${row.id} · ${row.name}`}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<IconTrashOutlineRegular size={14} />}
                                  aria-label={t('editor', 'pluginRemove')}
                                  onClick={() => { removeNodePlugin(index) }}
                                />
                              </div>
                            ))}
                          <Field label={t('editor', 'pluginPackage')}>
                            <Input
                              value={nodePluginDraft.name}
                              onChange={(event) => {
                                setNodePluginDraft({ ...nodePluginDraft, name: event.currentTarget.value })
                                setNodePluginError(null)
                              }}
                            />
                          </Field>
                          <Field label={t('editor', 'pluginRowIdOptional')}>
                            <Input
                              value={nodePluginDraft.id}
                              onChange={(event) => {
                                setNodePluginDraft({ ...nodePluginDraft, id: event.currentTarget.value })
                                setNodePluginError(null)
                              }}
                            />
                          </Field>
                          <Field label={t('editor', 'pluginConfig')}>
                            <textarea
                              className={`${css.textarea} ${css.textareaMono}`}
                              value={nodePluginDraft.config}
                              onChange={(event) => {
                                setNodePluginDraft({ ...nodePluginDraft, config: event.currentTarget.value })
                                setNodePluginError(null)
                              }}
                            />
                          </Field>
                          {nodePluginError !== null && <NoticeLine tone="error" text={nodePluginError} />}
                          <Button size="sm" onClick={addNodePlugin}>{t('editor', 'pluginAdd')}</Button>
                        </div>
                      </DisclosureRow>
                    </>
                  )}

                  {/* 删除节点（原型 editor.js:413 .inspector-danger）：检查器末尾的独立危险操作区。 */}
                  <div className={editor.panelDanger}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={css.dangerButton}
                      icon={<IconTrashOutlineRegular size={14} />}
                      onClick={() => { removeNode(selectedNode.node_id) }}
                    >
                      {t('editor', 'deleteNode')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>

        {/* 运行面板是画布与检查器之下的整行（原型 editor.html:136-173：底部面板全宽）。 */}
        <CanvasPreview
          canvasId={canvasId}
          projects={projects}
          onError={(detail) => { setError({ key: 'errorPreview', detail }) }}
          collapsed={panelCollapsed}
          onToggleCollapsed={() => { setPanelCollapsed(!panelCollapsed) }}
          focusSignal={previewSignal}
        />

        <RiskConfirmation
          open={roleSwitch !== null}
          title={t('editor', 'roleSwitchTitle')}
          description={t('editor', 'roleSwitchDescription')}
          acknowledgeLabel={t('editor', 'roleSwitchAcknowledge')}
          cancelLabel={t('editor', 'roleSwitchCancel')}
          closeLabel={t('common', 'actionClose')}
          confirmLabel={t('editor', 'roleSwitchConfirm')}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => { setRoleSwitch(null) }}
          onConfirm={() => {
            if (roleSwitch === null) return
            applyRole(roleSwitch.nodeId, roleSwitch.presetId)
            setRoleSwitch(null)
          }}
        />

        {/* 新建角色模板：模板写进画布 settings，保存后对其他节点同样可选。 */}
        <Modal
          open={templateOpen}
          onClose={() => { setTemplateOpen(false) }}
          title={t('editor', 'roleTemplateNewTitle')}
          closeLabel={t('common', 'actionClose')}
          footer={(
            <>
              <Button variant="outline" onClick={() => { setTemplateOpen(false) }}>{t('common', 'actionCancel')}</Button>
              <Button variant="primary" disabled={templateName.trim() === ''} onClick={createTemplate}>
                {t('editor', 'roleTemplateCreate')}
              </Button>
            </>
          )}
        >
          <div className={editor.groupBody}>
            <Field label={t('editor', 'roleTemplateName')}>
              <Input
                value={templateName}
                onChange={(event) => { setTemplateName(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('editor', 'roleTemplateDescription')}>
              <Input
                value={templateDescription}
                onChange={(event) => { setTemplateDescription(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('editor', 'roleTemplatePrompt')}>
              <textarea
                className={css.textarea}
                value={templatePrompt}
                onChange={(event) => { setTemplatePrompt(event.currentTarget.value) }}
              />
            </Field>
          </div>
        </Modal>

        {/* 「更多 → 清空画布」的确认对话框（原型 editor.js:1142-1160：确认后一步清空，可撤销）。 */}
        <Modal
          open={clearOpen}
          onClose={() => { setClearOpen(false) }}
          title={t('editor', 'clearCanvasTitle')}
          description={t('editor', 'clearCanvasDescription')}
          closeLabel={t('common', 'actionClose')}
          footer={(
            <>
              <Button variant="outline" onClick={() => { setClearOpen(false) }}>{t('common', 'actionCancel')}</Button>
              <Button variant="primary" onClick={clearCanvas}>{t('editor', 'clearCanvasConfirm')}</Button>
            </>
          )}
        />

        <PackagingDrawer
          canvas={canvas === null ? null : { id: canvas.id, name: meta.name.trim() === '' ? canvas.name : meta.name }}
          open={packageOpen}
          onClose={() => { setPackageOpen(false) }}
        />

        {/* 节点删除确认（原型 removeNode）：确认才删除节点与相连委派边，取消不改动任何数据。 */}
        <Modal
          open={deletePending !== null && deleteTargets.length > 0}
          onClose={() => { setDeletePending(null) }}
          title={deleteTitle}
          description={deleteDescription}
          closeLabel={t('common', 'actionClose')}
          footer={(
            <>
              <Button variant="outline" onClick={() => { setDeletePending(null) }}>{t('common', 'actionCancel')}</Button>
              <Button variant="ghost" className={css.dangerButton} onClick={confirmRemoveNodes}>
                {t('common', 'actionDelete')}
              </Button>
            </>
          )}
        />

      </div>
    </div>
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
 * Host 侧状态词（preview-stream.ts `statusOf`：pending/running/completed/idle/failed/stopped）是英文
 * 原文，直接摆上界面会在中文语境里混出机器词（R7）——这里统一过一遍字典；未知值原样呈现
 * （不猜、不静默吞）。状态在 state 里存原文、渲染时才翻译，切语言也不会残留旧语种。
 */
function previewStatusLabel(status: string): string {
  if (status === 'pending') return t('editor', 'previewPending')
  if (status === 'running') return t('editor', 'previewRunning')
  if (status === 'completed') return t('editor', 'previewCompleted')
  if (status === 'idle') return t('editor', 'previewIdle')
  if (status === 'failed') return t('editor', 'previewFailed')
  if (status === 'stopped') return t('editor', 'previewStopped')
  if (status === 'starting') return t('editor', 'previewStarting')
  return status
}

function CanvasPreview({ canvasId, projects, onError, collapsed, onToggleCollapsed, focusSignal }: {
  canvasId: string
  projects: RunProjectView[]
  onError: (detail: string) => void
  /** 折叠到 40px（只留标题栏与状态）。 */
  collapsed: boolean
  /** 折叠/展开切换（底部栏与工具栏图标轨共用同一状态）。 */
  onToggleCollapsed: () => void
  /** 顶栏「实时预览」的递增信号：切到预览标签并把焦点交给输入框。 */
  focusSignal: number
}) {
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'console' | 'preview'>('console')
  const [entries, setEntries] = useState<PreviewEntry[]>([])
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  // 状态存 Host 原文（pending/running/…/starting），渲染时经 previewStatusLabel 翻译。
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const cursorRef = useRef(0)
  /** 「清空日志」的丢弃水位线：已读到的 seq 在清空后不再回放（在途拉取的响应也按它过滤）。 */
  const clearedRef = useRef(0)
  /** 在途拉取是否仍可采纳：停止/清空后置 false，旧响应不再把状态改回「运行中」。 */
  const activeRef = useRef(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const inputWrapRef = useRef<HTMLSpanElement | null>(null)
  /** 已处理的顶栏预览信号：输入框只在预览标签内挂载，切标签后补一次聚焦。 */
  const focusedSignalRef = useRef(0)

  // 顶栏「实时预览」：切到预览标签（原型 editor.js:1070-1074）。
  useEffect(() => {
    if (focusSignal === 0) return
    setTab('preview')
  }, [focusSignal])

  // 输入框随预览标签挂载：切到预览后再聚焦，避免对未挂载的输入框调用 focus。
  useEffect(() => {
    if (tab !== 'preview' || focusSignal === 0 || focusedSignalRef.current === focusSignal) return
    focusedSignalRef.current = focusSignal
    inputWrapRef.current?.querySelector('input')?.focus()
  }, [tab, focusSignal])

  const candidates = projects.filter(project => project.agentic_flow_id === canvasId)

  /** 增量拉取一次预览日志（水位线只前进，重复条目不会重放）。 */
  const pull = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return
    try {
      const result = await request<PreviewResponse>(
        `/sessions/${encodeURIComponent(sessionKey)}/preview?after=${String(cursorRef.current)}`,
      )
      if (!activeRef.current) return
      if (result.entries.length > 0) {
        cursorRef.current = result.lastSeq
        // 清空之前已呈现过的条目不再回放：在途响应同样丢弃，旧日志不会因为一次拉取而复活。
        const fresh = result.entries.filter(entry => entry.seq > clearedRef.current)
        if (fresh.length > 0) setEntries(previous => [...previous, ...fresh])
      }
      if (result.status !== 'unknown') setStatus(result.status)
      if (result.status === 'completed' || result.status === 'idle' || result.status === 'stopped' || result.status === 'failed') {
        activeRef.current = false
        setRunning(false)
      }
    } catch (failure) {
      onError(describeError(failure))
      activeRef.current = false
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
      activeRef.current = true
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
      activeRef.current = false
      setRunning(false)
      setStatus('stopped')
    } catch (failure) {
      onError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 清空日志（原型 clear-btn：先停掉在跑的试运行，再把状态复位为「未运行」）。
   * 水位线保持——否则下一次轮询会把已读过的旧日志当成新条目重新追加。
   */
  const clearLog = (): void => {
    clearedRef.current = cursorRef.current
    setEntries([])
    activeRef.current = false
    if (running && sessionKey !== null) {
      void request(`/sessions/${encodeURIComponent(sessionKey)}/cancel`, {
        method: 'POST',
        body: { reason: 'stopped from the canvas preview' },
      }).catch((failure: unknown) => { onError(describeError(failure)) })
    }
    setRunning(false)
    setStatus('idle')
  }

  return (
    <div className={editor.preview} data-collapsed={collapsed ? '' : undefined} role="region" aria-label={t('editor', 'previewRegion')}>
      <div className={editor.previewBar}>
        <div className={editor.consoleTabs} role="tablist" aria-label={t('editor', 'consoleTabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'console'}
            className={tab === 'console' ? `${editor.consoleTab} ${editor.consoleTabActive}` : editor.consoleTab}
            onClick={() => {
              // 折叠状态下先展开面板再切换（原型 setTab 的 is-collapsed 处理）。
              if (collapsed) onToggleCollapsed()
              setTab('console')
            }}
          >
            {t('editor', 'consoleTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            className={tab === 'preview' ? `${editor.consoleTab} ${editor.consoleTabActive}` : editor.consoleTab}
            onClick={() => {
              if (collapsed) onToggleCollapsed()
              setTab('preview')
            }}
          >
            {t('editor', 'previewTab')}
          </button>
        </div>
        <span className={editor.consoleStatus}>
          <span className={editor.consoleDot} data-live={running ? '' : undefined} />
          {previewStatusLabel(status)}
        </span>
        <span className={editor.toolbarSpacer} />
        {/* 面板 meta（原型 .console__meta）：一行陈述本次试运行的真实来源。 */}
        <span className={editor.consoleMeta}>{t('editor', 'consoleMeta')}</span>
        {running && (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconStopFillRegular size={12} />}
            disabled={busy}
            onClick={() => { void stop() }}
          >
            {t('editor', 'previewStop')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={clearLog}>
          {t('editor', 'previewClear')}
        </Button>
        <button
          type="button"
          className={editor.consoleCollapse}
          aria-label={t('editor', collapsed ? 'expandPanel' : 'collapsePanel')}
          title={t('editor', collapsed ? 'expandPanel' : 'collapsePanel')}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className={editor.previewLog} ref={logRef}>
            {tab === 'console'
              ? (
                <>
                  {entries.length === 0 && (
                    <div className={editor.consoleEmpty}>
                      <span className={editor.consoleEmptyTitle}>{t('editor', 'consoleEmptyTitle')}</span>
                      <p className={editor.consoleEmptyDesc}>{t('editor', 'consoleEmptyDesc')}</p>
                    </div>
                  )}
                  {entries.map(entry => <PreviewLine key={entry.seq} entry={entry} />)}
                </>
              )
              : (
                <>
                  {entries.length === 0 && (
                    <div className={editor.consoleEmpty}>
                      <span className={editor.consoleEmptyTitle}>{t('editor', 'previewEmptyTitle')}</span>
                      <p className={editor.consoleEmptyDesc}>{t('editor', 'previewEmptyDesc')}</p>
                    </div>
                  )}
                  {/* 轻量预览同时呈现文本流与工具状态：连续工具条目合成一行紧凑 chip。 */}
                  {groupPreviewEntries(entries).map(row => (row.tools
                    ? (
                      <div key={`tools-${String(row.key)}`} className={editor.previewToolChips}>
                        {row.entries.map(entry => <PreviewLine key={entry.seq} entry={entry} chips />)}
                      </div>
                    )
                    : row.entries.map(entry => <PreviewLine key={entry.seq} entry={entry} />)))}
                </>
              )}
          </div>

          {/* 测试输入只在「实时预览」标签内（原型 editor.html:160-171）：运行日志标签不提供发送口。 */}
          {tab === 'preview' && (
            <div className={editor.previewInput}>
              <span className={editor.previewInputField} ref={inputWrapRef}>
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
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 预览行分组：连续工具条目合成一行 chip，其余条目各自成行。 */
interface PreviewRow {
  key: number
  entries: PreviewEntry[]
  tools: boolean
}

/**
 * 把预览条目按「连续工具条目」分组。
 * @param entries - 预览条目（seq 递增）。
 * @returns 预览行。
 */
function groupPreviewEntries(entries: PreviewEntry[]): PreviewRow[] {
  const rows: PreviewRow[] = []
  for (const entry of entries) {
    const last = rows[rows.length - 1]
    const tools = entry.kind === 'tool'
    if (tools && last !== undefined && last.tools) last.entries.push(entry)
    else rows.push({ key: entry.seq, entries: [entry], tools })
  }
  return rows
}

/**
 * 把 Host 原文的轮次条目翻成当前语言（`turn N started` / `turn ended (reason)`；流协议不变）。
 * @param entry - 状态或错误条目。
 * @param failed - 该条目是否表示回合失败。
 * @returns 本地化文案；不是轮次条目时保留原文。
 */
function turnLine(entry: PreviewEntry, failed: boolean): string {
  const raw = entry.text ?? ''
  if (entry.turn === undefined || !raw.startsWith('turn ')) return raw
  if (raw.startsWith('turn ended')) return t('editor', failed ? 'turnFailed' : 'turnEnded', { turn: entry.turn })
  return t('editor', 'turnStarted', { turn: entry.turn })
}

/**
 * 工具阶段的状态文案键。
 * @param phase - 工具阶段。
 * @returns 文案键。
 */
function toolStateKey(phase: PreviewEntry['phase']): string {
  if (phase === 'start') return 'previewToolRunning'
  if (phase === 'error') return 'previewToolFailed'
  return 'previewToolDone'
}

/**
 * 工具状态 chip 的语气。
 * @param phase - 工具阶段。
 * @returns Tag 语气（执行中=信息、完成=成功、失败=危险）。
 */
function toolTone(phase: PreviewEntry['phase']): 'info' | 'success' | 'danger' {
  if (phase === 'start') return 'info'
  if (phase === 'error') return 'danger'
  return 'success'
}

/**
 * 渲染一条预览条目（纯文本与工具状态两态，绝不在此复刻卡片）。
 * @param entry - 预览条目。
 * @param chips - 工具条目是否用紧凑状态 chip 呈现（实时预览标签用它）。
 */
function PreviewLine({ entry, chips = false }: { entry: PreviewEntry; chips?: boolean }): ReactElement {
  if (entry.kind === 'text') return <p className={editor.previewText}>{entry.text}</p>
  if (entry.kind === 'error') return <p className={editor.previewError}>{turnLine(entry, true)}</p>
  if (entry.kind === 'status') return <p className={editor.previewStatusLine}>{turnLine(entry, false)}</p>
  // 工具名缺失时只呈现状态词，不拼出 "undefined"（结果事件理论上能按 callId 对上名字）。
  const state = t('editor', toolStateKey(entry.phase))
  const label = entry.toolName === undefined ? state : `${entry.toolName} — ${state}`
  if (chips) return <Tag tone={toolTone(entry.phase)}>{label}</Tag>
  return (
    <p className={editor.previewTool}>
      <span className={editor.previewToolName}>{label}</span>
      {entry.text === undefined || entry.text === '' ? '' : `\n${entry.text}`}
    </p>
  )
}
