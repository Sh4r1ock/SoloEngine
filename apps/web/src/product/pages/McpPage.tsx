/** MCP 服务器页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, CodeBlock, IconArchiveOutlineRegular, IconChecklistOutlineRegular, IconCodeOutlineRegular,
  IconDatabaseOutlineRegular, IconEllipsisOutlineRegular, IconFolderOpenOutlineRegular, IconGlobeOutlineRegular,
  IconInfoOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  IconSearchOutlineRegular, IconStopFillRegular, Input, Menu, Modal, Switch, Tag, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { addRouteBlocker } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Glyph } from '../components/Glyph.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { FilePicker } from '../components/FilePicker.tsx'
import { PathValue } from '../components/PathValue.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import { codeLabels, terminalLabels } from '../components/labels.ts'
import type { McpCallResult, McpServerFilesView, McpServerView, McpTestResult, McpToolInfo } from '../types.ts'
import css from '../styles/common.module.css'
import mcpCss from '../styles/mcp.module.css'
import { Drawer } from '../components/Drawer.tsx'

/** 四类创建入口。 */
type CreateVariant = 'stdio' | 'http' | 'code' | 'package'

/** 后端创建时写入的默认超时（秒）；历史行缺该值时也按它展示。 */
const DEFAULT_TIMEOUT_SECONDS = 30

/** MCP 包上限；与服务端 `MAX_UPLOAD_BYTES` 同值，前端只做前置拒绝，服务端仍为最终权威。 */
const MAX_MCP_PACKAGE_BYTES = 64 * 1024 * 1024

/** 页面级错误行：`retry` 只重跑刚失败的那一个动作，不冒充「重新加载列表」。 */
interface PageError {
  key: string
  detail?: string
  kind?: string
  retry?: () => void
}

/** 后端 MCP 名称约束（与 `mcp.ts` 的 `MCP_NAME_PATTERN` 同一条正则：它是模型可见的工具名前缀）。 */
const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u

/**
 * 前置校验 JSON 文本字段的顶层形态与取值类型。
 *
 * 后端 `assertJson` 只校验顶层是数组/对象；值不是字符串时会在传输层被
 * `String(value)` 拼进命令行或请求头，故在表单侧先把这一层挡住。
 * @param text - 表单文本。
 * @param expect - 期望的顶层类型。
 * @returns 是否可提交（空串视为未填写）。
 */
function isValidJsonField(text: string, expect: 'array' | 'object'): boolean {
  if (text.trim() === '') return true
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (expect === 'array') {
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string')
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    && Object.values(parsed as Record<string, unknown>).every(value => typeof value === 'string')
}

/**
 * 创建失败的文案按后端错误码本地化（错误码是稳定契约，文案随语言切换）。
 * @param failure - 捕获的失败。
 * @returns 展示文案。
 */
function createFailureText(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.code) {
      case 'NAME_REQUIRED': return t('mcp', 'errorNameRequired')
      case 'INVALID_MCP_NAME': return t('mcp', 'errorNameInvalid')
      case 'MCP_NAME_TAKEN': return t('mcp', 'errorNameTaken')
      case 'COMMAND_REQUIRED': return t('mcp', 'errorCommandRequired')
      case 'URL_REQUIRED': return t('mcp', 'errorUrlRequired')
      case 'INVALID_JSON': return t('mcp', 'errorJsonField')
      case 'INVALID_TIMEOUT': return t('mcp', 'errorTimeoutRange')
      case 'CODE_REQUIRED': return t('mcp', 'errorConfigRequired')
      case 'RUNTIME_REQUIRED': return t('mcp', 'errorRuntimeRequired')
      case 'INVALID_RUNTIME': return t('mcp', 'errorRuntimeInvalid')
      case 'ARCHIVE_PATH_REJECTED': return t('mcp', 'errorArchivePath')
      case 'ARCHIVE_TOO_LARGE': return t('mcp', 'errorArchiveTooLarge')
      case 'ENTRY_NOT_FOUND': return t('mcp', 'errorEntryNotFound')
      default: break
    }
  }
  return `${t('mcp', 'errorCreate')} — ${describeError(failure)}`
}

/** JSON schema 派生出的一个表单字段。 */
interface SchemaField {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'json'
  required: boolean
  options: string[]
  /** 字段 schema 上声明的输入提示（`placeholder` 注解）；没有时为 null。 */
  placeholder: string | null
  /** 多行文本控件（`format: textarea` 或 `ui:widget: textarea`）。 */
  multiline: boolean
}

/**
 * 拆分 MCP `CallToolResult`：文本块单独成段，图片/资源等结构化块与 `structuredContent` 走 JSON。
 * @param result - 工具返回的原始结果。
 * @returns 文本、非文本块与结构化内容。
 */
function splitCallResult(result: unknown): { text: string[]; other: unknown[]; structured: unknown } {
  if (result === null || typeof result !== 'object') return { text: [], other: [], structured: undefined }
  const record = result as { content?: unknown; structuredContent?: unknown }
  const text: string[] = []
  const other: unknown[] = []
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (block !== null
        && typeof block === 'object'
        && (block as { type?: unknown }).type === 'text'
        && typeof (block as { text?: unknown }).text === 'string') {
        text.push((block as { text: string }).text)
      } else {
        other.push(block)
      }
    }
  }
  return { text, other, structured: record.structuredContent }
}

/** 从工具的 inputSchema 派生表单字段（object 的 properties / required）。 */
function schemaFields(schema: unknown): SchemaField[] {
  if (schema === null || typeof schema !== 'object') return []
  const raw = schema as { properties?: unknown; required?: unknown }
  if (raw.properties === null || typeof raw.properties !== 'object') return []
  const required = Array.isArray(raw.required) ? raw.required.filter((item): item is string => typeof item === 'string') : []
  const fields: SchemaField[] = []
  for (const [name, value] of Object.entries(raw.properties as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') {
      fields.push({ name, kind: 'string', required: required.includes(name), options: [], placeholder: null, multiline: false })
      continue
    }
    const property = value as { type?: unknown; enum?: unknown; format?: unknown; placeholder?: unknown; 'ui:widget'?: unknown }
    const enumValues = Array.isArray(property.enum) ? property.enum.filter((item): item is string => typeof item === 'string') : []
    const kind: SchemaField['kind'] = enumValues.length > 0
      ? 'enum'
      : property.type === 'number' || property.type === 'integer'
        ? 'number'
        : property.type === 'boolean'
          ? 'boolean'
          : property.type === 'array' || property.type === 'object'
            ? 'json'
            : 'string'
    // 多行控件按 schema 的显式声明走：`format: textarea`（MCP 扩展注解）与常见的 `ui:widget`。
    const multiline = kind === 'string'
      && (property.format === 'textarea' || property['ui:widget'] === 'textarea')
    const placeholder = typeof property.placeholder === 'string' && property.placeholder !== ''
      ? property.placeholder
      : null
    fields.push({ name, kind, required: required.includes(name), options: enumValues, placeholder, multiline })
  }
  return fields
}

/**
 * 渲染 MCP 页。
 */
export function McpPage() {
  const locale = useLocale()
  const [servers, setServers] = useState<McpServerView[]>([])
  const [loading, setLoading] = useState(true)
  // 页面级文案存「键 + 动态细节」，渲染时翻译（S5-F9 / S7-F29 / S8-F37 同一规则）：
  // 本页在 AppShell 内，语言 Pill 恒可达，存已翻译字符串会在切语言后残留旧语种。
  const [error, setError] = useState<PageError | null>(null)
  // 成功反馈走 Toast（原型 mcp.js:202/217/435/477/490/503/529 的 App.toast）。
  const toast = useToastHost()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<Record<string, McpTestResult>>({})
  const [createVariant, setCreateVariant] = useState<CreateVariant | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServerView | null>(null)
  const [callTarget, setCallTarget] = useState<{ server: McpServerView; tool: McpToolInfo } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'tools' | 'files'>('overview')
  const [search, setSearch] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ctrl/Cmd+K 聚焦搜索（原型 app.js:650-659 的全局快捷键）。
  useSearchShortcut(searchRef)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await request<{ ok: true; servers: McpServerView[] }>('/mcp')
      setServers(result.servers)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure), retry: () => { void load() } })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = (id: string, action: () => Promise<void>, failureKey: string, successText?: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
        if (successText !== undefined) toast.show(successText, 'success')
      } catch (failure) {
        setError({ key: failureKey, detail: describeError(failure), retry: () => { act(id, action, failureKey) } })
      } finally {
        setBusyId(null)
      }
    })()
  }

  // busyId 形如 `<服务器 id>:<动作>`：单一 id 会让同一服务器的两个按钮同时显示「进行中」
  // （实测只点「连接测试」时，「能力枚举」也变成「枚举中…」）。禁用可按服务器收敛，
  // 文案必须按动作区分，否则界面在说谎。
  const busyOn = (id: string): boolean => busyId !== null && busyId.startsWith(`${id}:`)
  const busyAction = (id: string): string | null => (busyId !== null && busyId.startsWith(`${id}:`)
    ? busyId.slice(id.length + 1)
    : null)

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword === '') return servers
    return servers.filter(server => `${server.name} ${server.description ?? ''}`.toLowerCase().includes(keyword))
  }, [servers, search])

  // 搜索无命中时不能回退到 `servers[0]`：那会让列表为空、详情却展示一台被过滤掉的服务器
  // （原型空态四类：没有数据 / 没有匹配必须分开）。
  const selected = (selectedId === null ? undefined : visible.find(server => server.id === selectedId))
    ?? visible[0]
    ?? null

  useEffect(() => {
    if (selectedId === null && visible.length > 0) setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  /** 连接测试（详情页与列表共用一处实现）。 */
  const runTest = (server: McpServerView): void => {
    setBusyId(`${server.id}:test`)
    setError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; result: McpTestResult }>(`/mcp/${server.id}/test`, { method: 'POST' })
        // 连接测试只回握手结论；不能把上一轮枚举到的工具/资源/提示词覆盖成空
        // （否则一次测试就让「能力概要」与工具开关整片清零）。
        setCapabilities((previous) => {
          const prior = previous[server.id]
          const next = result.result
          return {
            ...previous,
            [server.id]: prior !== undefined && next.tools === undefined
              ? {
                ...next,
                ...(prior.tools === undefined ? {} : { tools: prior.tools }),
                ...(prior.resources === undefined ? {} : { resources: prior.resources }),
                ...(prior.resourceTemplates === undefined ? {} : { resourceTemplates: prior.resourceTemplates }),
                ...(prior.prompts === undefined ? {} : { prompts: prior.prompts }),
              }
              : next,
          }
        })
        // 后端 recordTest 已把结论写入 last_test_*；本地同步这一行，列表与详情不必整页重载即可反映。
        setServers(previous => previous.map(item => (item.id === server.id
          ? {
            ...item,
            last_test_ok: result.result.ok,
            last_test_kind: result.result.kind ?? null,
            last_test_ms: result.result.latency_ms ?? null,
            last_tested_at: new Date().toISOString(),
          }
          : item)))
        if (result.result.ok) {
          toast.show(t('mcp', 'toastTestOk', { name: server.name }), 'success')
        } else {
          setError({ key: 'errorTest', kind: result.result.kind ?? 'unknown', retry: () => { runTest(server) } })
        }
      } catch (failure) {
        setError({ key: 'errorTest', detail: describeError(failure), retry: () => { runTest(server) } })
      } finally {
        setBusyId(null)
      }
    })()
  }

  /** 能力枚举（同上）。 */
  const runEnumerate = (server: McpServerView): void => {
    setBusyId(`${server.id}:enumerate`)
    setError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; result: McpTestResult }>(`/mcp/${server.id}/enumerate`, { method: 'POST' })
        setCapabilities(previous => ({ ...previous, [server.id]: result.result }))
        if (result.result.ok) {
          // 后端 cacheCapabilities 已把三类能力写回缓存列；本地同步同一份数据，
          // 概览的计数在页内立即更新，刷新后也从缓存列读回同一个数。
          setServers(previous => previous.map(item => (item.id === server.id
            ? {
              ...item,
              tools: JSON.stringify(result.result.tools ?? []),
              resources: JSON.stringify(result.result.resources ?? []),
              prompts: JSON.stringify(result.result.prompts ?? []),
            }
            : item)))
          toast.show(t('mcp', 'toastEnumerated', {
            count: result.result.tools === undefined ? 0 : result.result.tools.length,
          }), 'success')
        } else {
          setError({ key: 'errorEnumerate', kind: result.result.kind ?? 'unknown', retry: () => { runEnumerate(server) } })
        }
      } catch (failure) {
        setError({ key: 'errorEnumerate', detail: describeError(failure), retry: () => { runEnumerate(server) } })
      } finally {
        setBusyId(null)
      }
    })()
  }

  // 错误行的「重试」只重跑失败的那一个动作（列表加载 / 连接测试 / 能力枚举 / 文件保存…），
  // 一律重新拉列表会把用户引向一个与失败无关的动作。
  const retry = error === null ? undefined : error.retry

  return (
    <div className={css.page}>
      <PageHeader
        title={t('mcp', 'title')}
        subtitle={t('mcp', 'subtitle')}
        actions={(
          <>
            <Menu
              open={createMenuOpen}
              align="end"
              items={[
                { type: 'label' as const, id: 'label', text: t('mcp', 'createLabel') },
                { id: 'stdio', label: t('mcp', 'createStdio'), icon: <IconCodeOutlineRegular size={14} /> },
                { id: 'http', label: t('mcp', 'createHttp'), icon: <IconGlobeOutlineRegular size={14} /> },
                { type: 'separator' as const, id: 'sep' },
                { id: 'code', label: t('mcp', 'createCode'), icon: <IconCodeOutlineRegular size={14} /> },
                { id: 'package', label: t('mcp', 'createPackage'), icon: <IconArchiveOutlineRegular size={14} /> },
              ]}
              onSelect={(id) => {
                setCreateMenuOpen(false)
                if (id === 'stdio' || id === 'http' || id === 'code' || id === 'package') setCreateVariant(id)
              }}
              onClose={() => { setCreateMenuOpen(false) }}
              anchor={(
                <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateMenuOpen(!createMenuOpen) }}>
                  {t('mcp', 'newServer')}
                </Button>
              )}
            />
          </>
        )}
      />

      <NoticeLine
        tone="error"
        text={error === null ? null : [
          t('mcp', error.key),
          error.kind === undefined ? null : t('mcp', kindKey(error.kind)),
          error.detail ?? null,
        ].filter((part): part is string => part !== null).join(' — ')}
        {...(retry === undefined ? {} : { action: { label: t('common', 'actionRetry'), onClick: retry } })}
      />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}

      {!loading && (
        <div className={mcpCss.layout}>
          <aside className={mcpCss.sidebar} aria-label={t('mcp', 'listAria')}>
            <div className={mcpCss.sidebarHead}>
              <Input
                ref={searchRef}
                className={mcpCss.search ?? ''}
                icon={<IconSearchOutlineRegular size={16} />}
                value={search}
                placeholder={t('mcp', 'searchPlaceholder')}
                aria-label={t('mcp', 'searchAria')}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              <span className={mcpCss.count}>{visible.length}</span>
            </div>
            <div className={mcpCss.rows}>
              {servers.length === 0
                ? null
                : visible.length === 0
                  ? <p className={mcpCss.noMatch}>{t('mcp', 'noMatch')}</p>
                  : visible.map((server) => {
                    const capability = capabilities[server.id]
                    const transport = server.transport_type === 'stdio' || server.transport_type === 'http'
                      ? server.transport_type
                      : t('mcp', 'transportUnknown')
                    const liveTools = capability?.ok === true && capability.tools !== undefined ? capability.tools : null
                    const tools = liveTools !== null ? liveTools.length : storedToolCount(server)
                    return (
                      <button
                        key={server.id}
                        type="button"
                        className={selected?.id === server.id ? `${mcpCss.row} ${mcpCss.rowActive}` : mcpCss.row}
                        aria-current={selected?.id === server.id ? 'true' : undefined}
                        onClick={() => { setSelectedId(server.id); setTab('overview') }}
                      >
                        <span className={mcpCss.rowTop}>
                          <span className={mcpCss.glyph} aria-hidden="true">{serverInitials(server.name)}</span>
                          <span className={mcpCss.rowName}>{server.name}</span>
                          <span className={server.is_active ? mcpCss.dotOk : mcpCss.dot} aria-hidden="true" />
                        </span>
                        <span className={mcpCss.rowMeta}>
                          <Tag tone="neutral" className={mcpCss.transportTag}>{transport}</Tag>
                          <span>{toolCountLabel(tools)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{lastTestText(server)}</span>
                        </span>
                      </button>
                    )
                  })}
            </div>
            <div className={mcpCss.sidebarFoot}>
              <span className={mcpCss.footDot} aria-hidden="true" />
              {t('mcp', 'sidebarFoot')}
            </div>
          </aside>

          <section className={mcpCss.detail} aria-live="polite">
            {selected === null ? (
              <div className={`${css.emptyState} ${mcpCss.detailEmpty}`}>
                <span className={css.emptyIcon} aria-hidden="true"><IconDatabaseOutlineRegular size={22} /></span>
                <p className={css.emptyTitle}>{t('mcp', servers.length === 0 ? 'empty' : 'noMatch')}</p>
                <p className={css.emptyDesc}>{t('mcp', servers.length === 0 ? 'emptyDesc' : 'noMatchHint')}</p>
                {servers.length === 0
                  ? (
                    <Button variant="primary" size="sm" onClick={() => { setCreateVariant('stdio') }}>
                      {t('mcp', 'formTitleStdio')}
                    </Button>
                  )
                  : <Button size="sm" variant="outline" onClick={() => { setSearch('') }}>{t('mcp', 'clearSearch')}</Button>}
              </div>
            ) : (() => {
              const capability = capabilities[selected.id]
              const transport = selected.transport_type === 'stdio' || selected.transport_type === 'http'
                ? selected.transport_type
                : t('mcp', 'transportUnknown')
              const liveTools = capability?.ok === true && capability.tools !== undefined ? capability.tools : null
              const tools = liveTools ?? storedTools(selected)
              const toolCount = liveTools !== null ? liveTools.length : storedToolCount(selected)
              const timeoutSeconds = selected.stdio?.timeout ?? selected.http?.timeout ?? DEFAULT_TIMEOUT_SECONDS
              // 头部版本取后端能解析出的包版本；解析不出才退回乐观锁 revision，且明确标注「修订」。
              const versionLabel = selected.package_version === null
                ? t('mcp', 'revisionLabel', { version: selected.version })
                : t('mcp', 'packageVersionLabel', { version: selected.package_version })
              const subLine = [
                selected.author ?? '',
                versionLabel,
                `${t('mcp', 'lastTest')} ${lastTestText(selected)}`,
              ].filter(part => part !== '').join(' · ')
              return (
                <>
                  <header className={mcpCss.detailHead}>
                    <span className={mcpCss.hero} aria-hidden="true">
                      <Glyph size={20}><path d="M7 3v4M13 3v4M6 7h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4V7ZM10 13v4" /></Glyph>
                    </span>
                    <div className={mcpCss.detailTitles}>
                      <div className={mcpCss.detailName}>
                        <h2 className={mcpCss.detailTitle}>{selected.name}</h2>
                        <Tag tone="neutral">{transport}</Tag>
                        {/* 原型 `mcp.js:70`：启用 → `badge--accent`（蓝点），停用 → `badge--disabled`。 */}
                        <Tag
                          tone={selected.is_active ? 'info' : 'quiet'}
                          className={selected.is_active ? `${css.accentTag} ${css.statusTag}` : undefined}
                        >
                          {selected.is_active && <span className={mcpCss.badgeDot} aria-hidden="true" />}
                          {selected.is_active ? t('mcp', 'serverEnabled') : t('mcp', 'serverDisabled')}
                        </Tag>
                      </div>
                      <p className={mcpCss.detailSub}>{subLine}</p>
                    </div>
                    <div className={mcpCss.detailActions}>
                      <Button
                        size="sm"
                        icon={busyAction(selected.id) === 'test'
                          ? <span className={css.spinner} aria-hidden="true" />
                          : <IconRefreshOutlineRegular size={14} />}
                        disabled={busyOn(selected.id)}
                        aria-busy={busyAction(selected.id) === 'test'}
                        onClick={() => { runTest(selected) }}
                      >
                        {busyAction(selected.id) === 'test' ? t('mcp', 'testing') : t('mcp', 'test')}
                      </Button>
                      <Button
                        size="sm"
                        icon={busyAction(selected.id) === 'enumerate'
                          ? <span className={css.spinner} aria-hidden="true" />
                          : <IconChecklistOutlineRegular size={14} />}
                        disabled={busyOn(selected.id)}
                        aria-busy={busyAction(selected.id) === 'enumerate'}
                        onClick={() => { runEnumerate(selected) }}
                      >
                        {busyAction(selected.id) === 'enumerate' ? t('mcp', 'enumerating') : t('mcp', 'enumerate')}
                      </Button>
                      <Menu
                        open={menuId === selected.id}
                        align="end"
                        items={[
                          {
                            id: 'toggle',
                            label: selected.is_active ? t('mcp', 'disableServer') : t('mcp', 'enableServer'),
                            icon: selected.is_active ? <IconStopFillRegular size={14} /> : <IconPlayOutlineRegular size={14} />,
                            disabled: busyOn(selected.id),
                          },
                          { id: 'test', label: t('mcp', 'test'), icon: <IconRefreshOutlineRegular size={14} />, disabled: busyOn(selected.id) },
                          { type: 'separator' as const, id: 'sep' },
                          { id: 'delete', label: t('common', 'actionDelete'), danger: true, disabled: busyOn(selected.id) },
                        ]}
                        onSelect={(id) => {
                          setMenuId(null)
                          if (id === 'toggle') {
                            act(`${selected.id}:active`, async () => {
                              await request(`/mcp/${selected.id}/active`, { method: 'POST', body: { active: !selected.is_active } })
                              await load()
                            }, 'errorActive', selected.is_active ? t('mcp', 'toastDisabled') : t('mcp', 'toastEnabled'))
                          }
                          if (id === 'test') runTest(selected)
                          if (id === 'delete') setDeleteTarget(selected)
                        }}
                        onClose={() => { setMenuId(null) }}
                        anchor={(
                          <Button
                            size="sm"
                            variant="ghost"
                            className={mcpCss.iconButton}
                            icon={<IconEllipsisOutlineRegular size={14} />}
                            aria-label={t('mcp', 'more')}
                            title={t('mcp', 'more')}
                            disabled={busyOn(selected.id)}
                            onClick={() => { setMenuId(menuId === selected.id ? null : selected.id) }}
                          />
                        )}
                      />
                    </div>
                  </header>

                  <div className={mcpCss.tabs} role="tablist" aria-label={t('mcp', 'detailTabs')}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'overview'}
                      className={tab === 'overview' ? `${mcpCss.tab} ${mcpCss.tabActive}` : mcpCss.tab}
                      onClick={() => { setTab('overview') }}
                    >
                      {t('mcp', 'tabOverview')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'tools'}
                      className={tab === 'tools' ? `${mcpCss.tab} ${mcpCss.tabActive}` : mcpCss.tab}
                      onClick={() => { setTab('tools') }}
                    >
                      {t('mcp', 'tabTools')}
                      <Tag tone="neutral" className={mcpCss.tabCount}>{toolCount}</Tag>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'files'}
                      className={tab === 'files' ? `${mcpCss.tab} ${mcpCss.tabActive}` : mcpCss.tab}
                      onClick={() => { setTab('files') }}
                    >
                      {t('mcp', 'tabFiles')}
                    </button>
                  </div>

                  <div className={mcpCss.detailBody}>
                    {tab === 'overview' && (
                      <div className={mcpCss.overview}>
                        <div className={mcpCss.overviewMain}>
                          <section className={mcpCss.block}>
                            <h3 className={mcpCss.blockTitle}>{t('mcp', 'connectionInfo')}</h3>
                            <dl className={mcpCss.metaList}>
                              <div className={mcpCss.metaRow}>
                                <dt>{t('mcp', 'sourceType')}</dt>
                                <dd className={mcpCss.mono}>{transport}</dd>
                              </div>
                              {selected.stdio !== null && selected.stdio.command !== null ? (
                                <div className={mcpCss.metaRow}>
                                  <dt>{t('mcp', 'commandLabel')}</dt>
                                  <dd className={mcpCss.mono}><PathValue value={selected.stdio.command} /></dd>
                                </div>
                              ) : selected.http !== null && selected.http.url !== null ? (
                                <div className={mcpCss.metaRow}>
                                  <dt>{t('mcp', 'urlLabel')}</dt>
                                  <dd className={mcpCss.mono}><PathValue value={selected.http.url} /></dd>
                                </div>
                              ) : null}
                              <div className={mcpCss.metaRow}>
                                <dt>{t('mcp', 'timeoutTitle')}</dt>
                                <dd className={mcpCss.mono}>{t('mcp', 'timeoutSeconds', { count: timeoutSeconds })}</dd>
                              </div>
                              <div className={mcpCss.metaRow}>
                                <dt>{t('mcp', 'lastTest')}</dt>
                                <dd>
                                  {selected.last_test_ok === null
                                    ? t('mcp', 'neverTested')
                                    : [
                                      selected.last_test_ok
                                        ? t('common', 'stateOk')
                                        : `${t('common', 'stateFailed')} · ${t('mcp', kindKey(selected.last_test_kind ?? undefined))}`,
                                      selected.last_tested_at === null
                                        ? null
                                        : new Date(selected.last_tested_at).toLocaleString(locale),
                                      selected.last_test_ms === null
                                        ? null
                                        : t('mcp', 'latency', { ms: selected.last_test_ms }),
                                    ].filter(part => part !== null).join(' · ')}
                                </dd>
                              </div>
                            </dl>
                          </section>
                          <section className={mcpCss.block}>
                            <h3 className={mcpCss.blockTitle}>{t('mcp', 'descriptionTitle')}</h3>
                            <p className={mcpCss.note}>
                              {selected.description === null || selected.description === ''
                                ? t('common', 'labelNone')
                                : selected.description}
                            </p>
                          </section>
                          <div className={mcpCss.notice}>
                            <span className={mcpCss.noticeIcon} aria-hidden="true"><IconInfoOutlineRegular size={14} /></span>
                            <span>{t('mcp', 'testNotice')}</span>
                          </div>
                        </div>
                        <aside className={mcpCss.caps}>
                          <section>
                            <h3 className={mcpCss.blockTitle}>{t('mcp', 'capabilitySummary')}</h3>
                            <div className={mcpCss.capabilityGrid}>
                              <div className={mcpCss.capability}>
                                <span className={mcpCss.capabilityValue}>{toolCount}</span>
                                <span className={mcpCss.capabilityLabel}>{t('mcp', 'tools')}</span>
                              </div>
                              <div className={mcpCss.capability}>
                                <span className={mcpCss.capabilityValue}>
                                  {capability?.ok === true && capability.resources !== undefined
                                    ? capability.resources.length
                                    : storedCount(selected.resources)}
                                </span>
                                <span className={mcpCss.capabilityLabel}>{t('mcp', 'resources')}</span>
                              </div>
                              <div className={mcpCss.capability}>
                                <span className={mcpCss.capabilityValue}>
                                  {capability?.ok === true && capability.prompts !== undefined
                                    ? capability.prompts.length
                                    : storedCount(selected.prompts)}
                                </span>
                                <span className={mcpCss.capabilityLabel}>{t('mcp', 'prompts')}</span>
                              </div>
                              <div className={mcpCss.capability}>
                                <span className={mcpCss.capabilityValue}>
                                  {selected.is_active ? t('common', 'stateYes') : t('common', 'stateNo')}
                                </span>
                                <span className={mcpCss.capabilityLabel}>{t('mcp', 'capabilityActive')}</span>
                              </div>
                            </div>
                          </section>
                          <section className={mcpCss.block}>
                            <h3 className={mcpCss.blockTitle}>{t('mcp', 'quickActions')}</h3>
                            <div className={mcpCss.quickActions}>
                              <Button
                                size="sm"
                                variant="outline"
                                className={mcpCss.blockButton}
                                icon={busyAction(selected.id) === 'test'
                                  ? <span className={css.spinner} aria-hidden="true" />
                                  : <IconRefreshOutlineRegular size={14} />}
                                disabled={busyOn(selected.id)}
                                aria-busy={busyAction(selected.id) === 'test'}
                                onClick={() => { runTest(selected) }}
                              >
                                {t('mcp', 'retest')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className={mcpCss.blockButton}
                                icon={busyAction(selected.id) === 'enumerate'
                                  ? <span className={css.spinner} aria-hidden="true" />
                                  : <IconChecklistOutlineRegular size={14} />}
                                disabled={busyOn(selected.id)}
                                aria-busy={busyAction(selected.id) === 'enumerate'}
                                onClick={() => { runEnumerate(selected) }}
                              >
                                {t('mcp', 'reenumerate')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className={mcpCss.blockButton}
                                icon={<IconFolderOpenOutlineRegular size={14} />}
                                onClick={() => { setTab('files') }}
                              >
                                {t('mcp', 'viewFiles')}
                              </Button>
                            </div>
                          </section>
                        </aside>
                      </div>
                    )}

                    {tab === 'tools' && (
                      <div className={mcpCss.tabBody}>
                        {capability !== undefined && !capability.ok && (
                          <div className={mcpCss.failure}>
                            <p>{`${t('common', 'stateFailed')} · ${t('mcp', kindKey(capability.kind))} · ${t('mcp', 'errorTest')}`}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyOn(selected.id)}
                              aria-busy={busyAction(selected.id) === 'test'}
                              onClick={() => { runTest(selected) }}
                            >
                              {busyAction(selected.id) === 'test' && <span className={css.spinner} aria-hidden="true" />}
                              {t('mcp', 'test')}
                            </Button>
                          </div>
                        )}
                        {tools.length === 0 ? (
                          <div className={css.emptyState}>
                            <span className={css.emptyIcon} aria-hidden="true"><IconChecklistOutlineRegular size={22} /></span>
                            <p className={css.emptyTitle}>{t('mcp', 'toolsEmptyTitle')}</p>
                            <p className={css.emptyDesc}>{t('mcp', 'toolsEmptyDesc')}</p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyOn(selected.id)}
                              aria-busy={busyAction(selected.id) === 'enumerate'}
                              onClick={() => { runEnumerate(selected) }}
                            >
                              {busyAction(selected.id) === 'enumerate' && <span className={css.spinner} aria-hidden="true" />}
                              {t('mcp', 'enumerate')}
                            </Button>
                          </div>
                        ) : (
                          <div className={mcpCss.tools}>
                            <div className={mcpCss.toolsHead}>
                              <div>
                                <h3 className={mcpCss.toolsTitle}>{t('mcp', 'toolSwitches')}</h3>
                                <p className={mcpCss.toolsHint}>{t('mcp', 'toolSwitchesHint')}</p>
                              </div>
                              <span className={mcpCss.count}>
                                {toolCountLabel(toolCount)}
                              </span>
                            </div>
                            {tools.map((tool) => {
                              const disabled = (selected.disabledTools ?? []).includes(tool.name)
                              return (
                                <div key={tool.name} className={disabled ? `${mcpCss.toolRow} ${mcpCss.toolRowDisabled}` : mcpCss.toolRow}>
                                  <div className={mcpCss.toolMain}>
                                    <div className={mcpCss.toolName}>{tool.name}</div>
                                    {tool.description !== undefined && tool.description !== '' && (
                                      <p className={mcpCss.toolDesc}>{tool.description}</p>
                                    )}
                                  </div>
                                  <span className={mcpCss.toolToggle}>
                                    <Switch
                                      checked={!disabled}
                                      label={`${tool.name} ${disabled ? t('mcp', 'toolDisabled') : t('mcp', 'toolEnabled')}`}
                                      disabled={busyOn(selected.id)}
                                      onChange={(next) => {
                                        setBusyId(`${selected.id}:tool`)
                                        setError(null)
                                        void (async () => {
                                          try {
                                            const result = await request<{ ok: true; server: McpServerView }>(
                                              `/mcp/${selected.id}/tools/${encodeURIComponent(tool.name)}/active`,
                                              { method: 'POST', body: { active: next } },
                                            )
                                            setServers(previous => previous.map(item =>
                                              item.id === result.server.id ? result.server : item,
                                            ))
                                            toast.show(
                                              t('mcp', next ? 'toastToolEnabled' : 'toastToolDisabled', { name: tool.name }),
                                              'success',
                                            )
                                          } catch (failure) {
                                            setError({ key: 'errorToolToggle', detail: describeError(failure) })
                                          } finally {
                                            setBusyId(null)
                                          }
                                        })()
                                      }}
                                    />
                                    <span className={mcpCss.toolState}>
                                      {disabled ? t('mcp', 'toolDisabled') : t('mcp', 'toolEnabled')}
                                    </span>
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={disabled || busyOn(selected.id)}
                                    onClick={() => { setCallTarget({ server: selected, tool }) }}
                                  >
                                    {t('mcp', 'callTool')}
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {capability?.ok === true && (capability.resources ?? []).length > 0 && (
                          <CapabilityGroup
                            title={t('mcp', 'resources')}
                            items={(capability.resources ?? []).map(item => ({
                              name: item.name ?? item.uri,
                              description: item.description,
                            }))}
                            emptyText={t('mcp', 'noCapabilities')}
                          />
                        )}
                        {capability?.ok === true && (capability.resourceTemplates ?? []).length > 0 && (
                          <CapabilityGroup
                            title={t('mcp', 'resourceTemplates')}
                            items={(capability.resourceTemplates ?? []).map(item => ({
                              name: item.name ?? item.uriTemplate,
                              description: item.description,
                            }))}
                            emptyText={t('mcp', 'noCapabilities')}
                          />
                        )}
                        {capability?.ok === true && (capability.prompts ?? []).length > 0 && (
                          <CapabilityGroup
                            title={t('mcp', 'prompts')}
                            items={(capability.prompts ?? []).map(item => ({ name: item.name, description: item.description }))}
                            emptyText={t('mcp', 'noCapabilities')}
                          />
                        )}
                      </div>
                    )}

                    {tab === 'files' && (
                      <div className={mcpCss.tabBody}>
                        <ServerFiles
                          key={selected.id}
                          server={selected}
                          onError={(next) => { setError(next) }}
                          onSaved={() => { toast.show(t('mcp', 'toastFileSaved'), 'success') }}
                        />
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </section>
        </div>
      )}

      <CreateServerDialog
        variant={createVariant}
        onClose={() => { setCreateVariant(null) }}
        onCreated={(server) => {
          setCreateVariant(null)
          toast.show(t('mcp', 'toastCreated', { name: server.name }), 'success')
          // 创建成功后直接落到新服务器的概览页签，而不是让用户自己在列表里再找一遍。
          setSelectedId(server.id)
          setTab('overview')
          void load()
        }}
      />

      <CallToolDialog
        target={callTarget}
        onClose={() => { setCallTarget(null) }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null) }}
        title={t('common', 'confirmDeleteTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('common', 'confirmDeleteDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={css.dangerButton}
              disabled={deleteTarget === null || busyOn(deleteTarget.id)}
              onClick={() => {
                const target = deleteTarget
                if (target === null) return
                act(`${target.id}:delete`, async () => {
                  await request(`/mcp/${target.id}`, { method: 'DELETE' })
                  setDeleteTarget(null)
                  await load()
                }, 'errorDelete', t('mcp', 'toastDeleted'))
              }}
            >
              {t('common', 'actionDelete')}
            </Button>
          </>
        )}
      >
        {deleteTarget !== null && (
          <p className={css.cardBody}>
            {deleteTarget.name}
            {' — '}
            {t('mcp', 'deleteNote')}
          </p>
        )}
      </Modal>
    </div>
  )
}

/** 能力分组（工具 / 资源 / 提示词）。 */
function CapabilityGroup({ title, items, emptyText }: {
  title: string
  items: { name: string; description?: string | undefined }[]
  emptyText: string
}) {
  return (
    <div>
      <div className={css.fieldLabel}>{title} · {countLabel(items.length)}</div>
      {items.length === 0
        ? <div className={css.fieldHint}>{emptyText}</div>
        : (
          <div className={css.tree}>
            {items.map(item => (
              <div key={item.name} className={css.treeItem}>
                <span>{item.name}</span>
                {item.description !== undefined && <span className={css.fieldHint}>{item.description}</span>}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/** 六类失败归因键（真实六类，来自 mcp.ts 的 McpFailureKind）。 */
function kindKey(kind: string | undefined): string {
  switch (kind) {
    case 'command_missing': return t('mcp', 'kindCommandMissing')
    case 'spawn_failed': return t('mcp', 'kindSpawnFailed')
    case 'handshake_failed': return t('mcp', 'kindHandshakeFailed')
    case 'address_unreachable': return t('mcp', 'kindAddressUnreachable')
    case 'auth_failed': return t('mcp', 'kindAuthFailed')
    case 'timeout': return t('mcp', 'kindTimeout')
    default: return t('mcp', 'kindUnknown')
  }
}

/** 计数/字节数文案：单数走 One 键（en 侧「1 items」「1 bytes」是语法错误，与画布/模型页同一键族规则）。 */
function countLabel(count: number): string {
  return t('mcp', count === 1 ? 'capabilityCountOne' : 'capabilityCount', { count })
}

/**
 * 工具数文案（列表行、页签与枚举提示共用同一键族）。
 * @param count - 工具数。
 * @returns 本地化文案；从未枚举时为 0 个工具。
 */
function toolCountLabel(count: number): string {
  return t('mcp', count === 1 ? 'toolCountOne' : 'toolCount', { count })
}

/**
 * 缓存的能力条数（`tools` / `resources` / `prompts` 三列同形态：JSON 数组文本）。
 * @param text - 缓存列文本。
 * @returns 条数；null/空串为 0；旧数据的逗号串按非空段计数。
 */
function storedCount(text: string | null): number {
  if (text === null || text.trim() === '') return 0
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    // 旧数据可能是逗号串：按非空段计数，避免整页显示为「未知」。
    return text.split(',').map(item => item.trim()).filter(item => item !== '').length
  }
}

/**
 * 服务器行上保存的工具数（上次枚举写入 `tools` 列；从未枚举时为 0）。
 * @param server - 服务器视图。
 * @returns 工具数；从未枚举或列值不可解析时为 0（界面如实显示 0，不写「未知」）。
 */
function storedToolCount(server: McpServerView): number {
  return storedCount(server.tools)
}

/**
 * 上次枚举写入的工具清单（用于未重新枚举时也能展示工具与启停开关）。
 * @param server - 服务器视图。
 * @returns 工具清单；`tools` 不是 JSON 数组时为空数组。
 */
function storedTools(server: McpServerView): McpToolInfo[] {
  if (server.tools === null || server.tools.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(server.tools)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is McpToolInfo => (
        item !== null && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
      ))
      : []
  } catch {
    return []
  }
}

/** 纯中文/符号名没有 ASCII 首字母时的回落字形（产品缩写，不是可翻译文案）。 */
const FALLBACK_GLYPH = 'MC'

/**
 * 列表行字形：名称里的 ASCII 字母数字前两位大写（与原型一致；纯中文名回落 `MC`）。
 * @param name - 服务器名。
 * @returns 两个字符以内的字形文本。
 */
function serverInitials(name: string): string {
  const letters = name.replace(/[^a-z0-9]/giu, '').slice(0, 2).toUpperCase()
  return letters === '' ? FALLBACK_GLYPH : letters
}

/**
 * 相对时间文案（列表行只给「多久以前」，精确时间留在概览的连接信息里）。
 * @param value - 后端返回的 ISO 时间。
 * @returns 刚刚 / N 分钟前 / N 小时前 / N 天前；不可解析时 null。
 */
function relativeTimeText(value: string | null): string | null {
  if (value === null || value === '') return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return t('mcp', 'relativeNow')
  if (minutes < 60) return t('mcp', 'relativeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? t('mcp', 'relativeHours', { count: hours }) : t('mcp', 'relativeDays', { count: Math.floor(hours / 24) })
}

/**
 * 列表行与详情副标题共用的最近测试结论。
 *
 * 原型把「相对时间 · N ms」作为最近测试的展示形态（data.js:338）：有耗时时一并给出，
 * 没有耗时（旧记录）时只给相对时间，结论本身（成功/失败）始终保留。
 * @param server - 服务器视图。
 * @returns 本地化结论（从未测试 / 成功或失败 + 相对时间 + 可选耗时）。
 */
function lastTestText(server: McpServerView): string {
  if (server.last_test_ok === null) return t('mcp', 'neverTested')
  const status = server.last_test_ok ? t('common', 'stateOk') : t('common', 'stateFailed')
  const when = relativeTimeText(server.last_tested_at)
  const measured = server.last_test_ms === null ? null : t('mcp', 'latency', { ms: server.last_test_ms })
  const detail = when === null
    ? null
    : measured === null ? when : `${when} · ${measured}`
  return detail === null ? status : `${status} · ${detail}`
}

function bytesLabel(bytes: number): string {
  return t('mcp', bytes === 1 ? 'fileBytesOne' : 'fileBytes', { count: bytes })
}

/** 四类创建入口的表单对话框。 */
function CreateServerDialog({ variant, onClose, onCreated }: {
  variant: CreateVariant | null
  onClose: () => void
  onCreated: (server: McpServerView) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [workingDir, setWorkingDir] = useState('')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState('')
  const [timeout, setTimeoutValue] = useState(String(DEFAULT_TIMEOUT_SECONDS))
  const [runtime, setRuntime] = useState('')
  const [code, setCode] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadBytes, setUploadBytes] = useState(0)
  const [uploadBase64, setUploadBase64] = useState<string | null>(null)
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName('')
    setDescription('')
    setCommand('')
    setArgs('')
    setEnv('')
    setWorkingDir('')
    setUrl('')
    setHeaders('')
    setTimeoutValue(String(DEFAULT_TIMEOUT_SECONDS))
    setRuntime('')
    setCode('')
    setUploadName('')
    setUploadBytes(0)
    setUploadBase64(null)
    setTransport(variant === 'http' ? 'http' : 'stdio')
    setError(null)
  }, [variant])

  const effectiveTransport: 'stdio' | 'http' = variant === 'stdio'
    ? 'stdio'
    : variant === 'http' ? 'http' : transport

  const title = variant === 'http'
    ? t('mcp', 'formTitleHttp')
    : variant === 'code'
      ? t('mcp', 'formTitleCode')
      : variant === 'package' ? t('mcp', 'formTitlePackage') : t('mcp', 'formTitleStdio')

  /**
   * 上传管线只物化 stdio 配置（超时固定为默认值），请求体里没有超时字段；
   * 用户显式选择的超时经更新端点写回，避免输入被静默丢弃。
   * @param server - 上传返回的服务器。
   * @param seconds - 用户选择的秒数；null 表示沿用默认值。
   * @returns 应用超时后的服务器视图。
   */
  const applyTimeout = async (server: McpServerView, seconds: number | null): Promise<McpServerView> => {
    if (seconds === null || seconds === DEFAULT_TIMEOUT_SECONDS) return server
    const updated = await request<{ ok: true; server: McpServerView }>(`/mcp/${server.id}`, {
      method: 'PATCH',
      body: { version: server.version, timeout: seconds },
    })
    return updated.server
  }

  const submit = (): void => {
    if (busy) return
    if (name.trim() === '') {
      setError(t('mcp', 'errorNameRequired'))
      return
    }
    // 名称会成为模型可见的工具名前缀，后端按同一条正则拒绝；这里提前给出可读原因。
    if (!MCP_NAME_PATTERN.test(name.trim())) {
      setError(t('mcp', 'errorNameInvalid'))
      return
    }
    // 超时字段是文本框，`Number('abc')` 会得到 NaN，JSON 序列化后变成 null
    // ——值被静默丢弃（违反「不静默」）。四类创建入口共用同一前置校验。
    const seconds = timeout.trim() === '' ? null : Number(timeout.trim())
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 600)) {
      setError(t('mcp', 'errorTimeoutRange'))
      return
    }
    // 运行命令是可选字段；只要填了就不能是空白（与后端 RUNTIME_REQUIRED 同一语义）。
    if ((variant === 'code' || variant === 'package') && runtime !== '' && runtime.trim() === '') {
      setError(t('mcp', 'errorRuntimeRequired'))
      return
    }
    // FR-MCP-007：code/package 走 /mcp/upload 专用管线（落用户隔离目录并物化为 stdio）。
    if (variant === 'code') {
      if (code.trim() === '') {
        setError(t('mcp', 'errorConfigRequired'))
        return
      }
      setBusy(true)
      setError(null)
      void (async () => {
        try {
          const result = await request<{ ok: true; server: McpServerView }>('/mcp/upload', {
            method: 'POST',
            body: {
              name: name.trim(),
              kind: 'code',
              code,
              ...(description.trim() === '' ? {} : { description: description.trim() }),
              ...(runtime.trim() === '' ? {} : { runtime: runtime.trim() }),
            },
          })
          onCreated(await applyTimeout(result.server, seconds))
        } catch (failure) {
          // 错误就近呈现在对话框内（带本地化前缀）；不再向页面级重复投递（会被 Modal 遮挡）。
          setError(createFailureText(failure))
        } finally {
          setBusy(false)
        }
      })()
      return
    }
    if (variant === 'package') {
      if (uploadBase64 === null) {
        setError(t('mcp', 'errorConfigRequired'))
        return
      }
      setBusy(true)
      setError(null)
      void (async () => {
        try {
          const result = await request<{ ok: true; server: McpServerView }>('/mcp/upload', {
            method: 'POST',
            body: {
              name: name.trim(),
              kind: 'package',
              archiveBase64: uploadBase64,
              ...(description.trim() === '' ? {} : { description: description.trim() }),
              ...(runtime.trim() === '' ? {} : { runtime: runtime.trim() }),
            },
          })
          onCreated(await applyTimeout(result.server, seconds))
        } catch (failure) {
          setError(createFailureText(failure))
        } finally {
          setBusy(false)
        }
      })()
      return
    }
    if (effectiveTransport === 'stdio' && command.trim() === '') {
      setError(t('mcp', 'errorConfigRequired'))
      return
    }
    if (effectiveTransport === 'stdio' && !isValidJsonField(args, 'array')) {
      setError(t('mcp', 'errorArgsJson'))
      return
    }
    if (effectiveTransport === 'stdio' && !isValidJsonField(env, 'object')) {
      setError(t('mcp', 'errorEnvJson'))
      return
    }
    if (effectiveTransport === 'http' && url.trim() === '') {
      setError(t('mcp', 'errorConfigRequired'))
      return
    }
    if (effectiveTransport === 'http' && !isValidJsonField(headers, 'object')) {
      setError(t('mcp', 'errorHeadersJson'))
      return
    }
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = {
      name: name.trim(),
      transport_type: effectiveTransport,
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      ...(seconds === null ? {} : { timeout: seconds }),
      ...(effectiveTransport === 'stdio'
        ? {
          command: command.trim(),
          ...(args.trim() === '' ? {} : { args: args.trim() }),
          ...(env.trim() === '' ? {} : { env: env.trim() }),
          ...(workingDir.trim() === '' ? {} : { working_dir: workingDir.trim() }),
        }
        : {
          url: url.trim(),
          ...(headers.trim() === '' ? {} : { headers: headers.trim() }),
        }),
    }
    void (async () => {
      try {
        const result = await request<{ ok: true; server: McpServerView }>('/mcp', { method: 'POST', body })
        onCreated(result.server)
      } catch (failure) {
        setError(createFailureText(failure))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open={variant !== null}
      onClose={onClose}
      title={title}
      closeLabel={t('common', 'actionClose')}
      className={`${css.modalDialog ?? ''} ${mcpCss.formDialog}`}
      contentClassName={css.modalScroll ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            type="submit"
            form="mcp-create-form"
            variant="primary"
            disabled={busy}
          >
            {busy ? t('mcp', 'creating') : t('mcp', 'create')}
          </Button>
        </>
      )}
    >
      <form
        id="mcp-create-form"
        className={css.form}
        noValidate
        onSubmit={(event) => { event.preventDefault(); submit() }}
        onKeyDown={submitFormOnEnter}
      >
        <NoticeLine tone="error" text={error} />
        <div className={css.formGrid}>
          <div>
            <Field label={t('mcp', 'nameLabel')} hint={t('mcp', 'nameHint')}>
              <Input
                data-modal-autofocus
                placeholder={t('mcp', 'namePlaceholder')}
                value={name}
                onChange={(event) => { setName(event.currentTarget.value) }}
              />
            </Field>
          </div>
          {/* 四类入口共用同一超时列：stdio 与 HTTP 各写自己的传输子表，缺省 30 秒。 */}
          <Field label={t('mcp', 'timeoutLabel')}>
            <Input
              type="number"
              min={1}
              max={600}
              value={timeout}
              onChange={(event) => { setTimeoutValue(event.currentTarget.value) }}
            />
          </Field>
          <div className={mcpCss.fieldFull}>
            <Field label={t('mcp', 'descriptionLabel')} meta={t('common', 'labelOptional')}>
              <Input
                placeholder={t('mcp', 'descriptionPlaceholder')}
                value={description}
                onChange={(event) => { setDescription(event.currentTarget.value) }}
              />
            </Field>
          </div>
          {(variant === 'code' || variant === 'package') && (
            <div className={mcpCss.fieldFull}>
              <Field label={t('mcp', 'runtimeLabel')} hint={t('mcp', 'runtimeHint')}>
                <Input
                  placeholder={t('mcp', 'runtimePlaceholder')}
                  value={runtime}
                  onChange={(event) => { setRuntime(event.currentTarget.value) }}
                />
              </Field>
            </div>
          )}
          {variant === 'code' && (
            <div className={mcpCss.fieldFull}>
              <Field label={t('mcp', 'codeLabel')} hint={t('mcp', 'codeHint')}>
                <textarea
                  className={`${css.textarea} ${css.textareaMono}`}
                  value={code}
                  onChange={(event) => { setCode(event.currentTarget.value) }}
                />
              </Field>
            </div>
          )}
          {variant === 'package' && (
            <div className={mcpCss.fieldFull}>
              <Field label={t('mcp', 'packageLabel')} hint={t('mcp', 'packageHint')}>
                <FilePicker
                  showName={false}
                  maxBytes={MAX_MCP_PACKAGE_BYTES}
                  onFile={(file) => {
                    setUploadName(file.name)
                    setUploadBytes(file.size)
                    const reader = new FileReader()
                    reader.onload = () => {
                      const text = typeof reader.result === 'string' ? reader.result : ''
                      const comma = text.indexOf(',')
                      setUploadBase64(comma < 0 ? text : text.slice(comma + 1))
                    }
                    reader.onerror = () => { setError(`${t('mcp', 'errorCreate')} — ${reader.error?.message ?? 'failed'}`) }
                    reader.readAsDataURL(file)
                  }}
                />
              </Field>
            </div>
          )}
          {uploadName !== '' && (
            <div className={`${css.fieldHint} ${mcpCss.fieldFull}`}>{uploadName} · {bytesLabel(uploadBytes)}</div>
          )}
          {(variant === 'stdio' || variant === 'http') && effectiveTransport === 'stdio' ? (
            <>
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'commandLabel')}>
                  <Input value={command} onChange={(event) => { setCommand(event.currentTarget.value) }} />
                </Field>
              </div>
              {/* 后端把 args/env 当 JSON 数组/对象解析（mcp.ts `assertJson`），不写格式就会
                  拿到一句英文实现错误——格式提示前置到字段说明。 */}
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'argsLabel')} hint={t('mcp', 'argsHint')}>
                  <textarea className={css.textarea} value={args} onChange={(event) => { setArgs(event.currentTarget.value) }} />
                </Field>
              </div>
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'envLabel')} hint={t('mcp', 'envHint')}>
                  <textarea className={`${css.textarea} ${css.textareaMono}`} value={env} onChange={(event) => { setEnv(event.currentTarget.value) }} />
                </Field>
              </div>
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'workingDirLabel')}>
                  <Input value={workingDir} onChange={(event) => { setWorkingDir(event.currentTarget.value) }} />
                </Field>
              </div>
            </>
          ) : variant === 'http' ? (
            <>
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'urlLabel')}>
                  <Input value={url} onChange={(event) => { setUrl(event.currentTarget.value) }} />
                </Field>
              </div>
              <div className={mcpCss.fieldFull}>
                <Field label={t('mcp', 'headersLabel')}>
                  <textarea className={`${css.textarea} ${css.textareaMono}`} value={headers} onChange={(event) => { setHeaders(event.currentTarget.value) }} />
                </Field>
              </div>
            </>
          ) : null}
        </div>
        {variant === 'code' || variant === 'package' ? (
          <div className={css.fieldHint}>
            {t('mcp', 'uploadStdioNote')}
          </div>
        ) : null}
      </form>
    </Modal>
  )
}

/** 单工具试运行对话框：参数表单由工具 JSON schema 生成。 */
function CallToolDialog({ target, onClose }: {
  target: { server: McpServerView; tool: McpToolInfo } | null
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<McpCallResult | null>(null)
  const fields = useMemo(() => schemaFields(target?.tool.inputSchema), [target])

  useEffect(() => {
    setValues({})
    setResult(null)
    setError(null)
  }, [target])

  const setValue = (name: string, value: string | boolean): void => {
    setValues(previous => ({ ...previous, [name]: value }))
  }

  // 字段级违规：后端按 inputSchema 校验后给出 path/kind，文案在前端本地化（不直出英文实现串）。
  const violations = result?.violations ?? []
  const violationOf = (name: string): string | null => {
    const hit = violations.find(item => item.path === name || item.path.startsWith(`${name}.`) || item.path.startsWith(`${name}[`))
    if (hit === undefined) return null
    return hit.kind === 'required'
      ? t('mcp', 'violationRequired', { name })
      : hit.kind === 'type'
        ? t('mcp', 'violationType', { name })
        : t('mcp', 'violationOther', { name })
  }
  const parsed = splitCallResult(result?.result)

  /** 关闭前拦下未执行的参数（与文件页的未保存拦截同一语义）。 */
  const requestClose = (): void => {
    const dirty = result === null && Object.values(values).some(value => value !== '')
    if (dirty && !window.confirm(t('mcp', 'dirtyLeave'))) return
    onClose()
  }

  const run = (): void => {
    if (target === null || busy) return
    const args: Record<string, unknown> = {}
    try {
      for (const field of fields) {
        const value = values[field.name]
        if (value === undefined || value === '') continue
        if (field.kind === 'number') {
          const numericValue = Number(value)
          // 直出 `x is not a number` / JS SyntaxError 是实现细节（R8）：给字段名 + 产品语句。
          if (!Number.isFinite(numericValue)) throw new Error(t('mcp', 'errorFieldNumber', { name: field.name }))
          args[field.name] = numericValue
        } else if (field.kind === 'json') {
          try {
            args[field.name] = JSON.parse(String(value)) as unknown
          } catch {
            throw new Error(t('mcp', 'errorFieldJson', { name: field.name }))
          }
        } else if (field.kind === 'boolean') {
          args[field.name] = value === true
        } else {
          args[field.name] = value
        }
      }
    } catch (parseFailure) {
      setError(parseFailure instanceof Error ? parseFailure.message : String(parseFailure))
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const response = await request<{ ok: true; result: McpCallResult }>(
          `/mcp/${target.server.id}/call`,
          { method: 'POST', body: { tool: target.tool.name, args } },
        )
        setResult(response.result)
      } catch (failure) {
        setError(`${t('mcp', 'errorCall')} — ${describeError(failure)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Drawer
      open={target !== null}
      onClose={requestClose}
      title={`${t('mcp', 'callTitle')} · ${target?.tool.name ?? ''}`}
      closeLabel={t('common', 'actionClose')}
      description={t('mcp', 'callDescription')}
      footer={(
        <>
          <Button variant="outline" onClick={requestClose}>{t('common', 'actionCancel')}</Button>
          <Button
            type="submit"
            form="tool-form"
            variant="primary"
            disabled={busy || target === null}
            aria-busy={busy}
            icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
          >
            {busy ? t('mcp', 'calling') : t('mcp', 'callRun')}
          </Button>
        </>
      )}
    >
      <form
        id="tool-form"
        className={css.form}
        onSubmit={(event) => { event.preventDefault(); run() }}
        onKeyDown={submitFormOnEnter}
      >
        <NoticeLine tone="error" text={error} />
        <div className={css.fieldLabel}>{t('mcp', 'callArgs')}</div>
        {/* 空参数表单不能说「没有枚举到能力」——那是能力枚举的语义，此处是该工具无需入参。 */}
        {fields.length === 0 && <div className={css.fieldHint}>{t('mcp', 'noParams')}</div>}
        {fields.map(field => (
          <div key={field.name} className={css.field}>
            <span className={css.fieldLabel}>
              {field.name}
              {' · '}
              {field.kind === 'string'
                ? t('mcp', 'schemaString')
                : field.kind === 'number'
                  ? t('mcp', 'schemaNumber')
                  : field.kind === 'boolean'
                    ? t('mcp', 'schemaBoolean')
                    : field.kind === 'enum' ? t('mcp', 'schemaEnum') : t('mcp', 'schemaJson')}
              {field.required && ` · ${t('mcp', 'paramRequired')}`}
            </span>
            <JsonSchemaControl
              field={field}
              value={values[field.name]}
              onChange={(next) => { setValue(field.name, next) }}
            />
            {violationOf(field.name) !== null && (
              <span className={css.fieldError}>{violationOf(field.name)}</span>
            )}
          </div>
        ))}
        {result !== null && (
          <>
            <div className={css.fieldLabel}>{t('mcp', 'callResult')}</div>
            {result.ok ? (
              <>
                {parsed.text.length > 0 && <CodeBlock code={parsed.text.join('\n')} lang="text" {...codeLabels()} />}
                {parsed.other.length > 0 && <CodeBlock code={JSON.stringify(parsed.other, null, 2)} lang="json" {...codeLabels()} />}
                {parsed.structured !== undefined && (
                  <>
                    <div className={css.fieldHint}>{t('mcp', 'callStructured')}</div>
                    <CodeBlock code={JSON.stringify(parsed.structured, null, 2)} lang="json" {...codeLabels()} />
                  </>
                )}
                {parsed.text.length === 0 && parsed.other.length === 0 && parsed.structured === undefined && (
                  <div className={css.fieldHint}>{t('mcp', 'resultEmpty')}</div>
                )}
              </>
            ) : result.errorCode === 'INVALID_ARGUMENTS' ? (
              <div className={css.fieldError}>{t('mcp', 'callInvalidArgs')}</div>
            ) : (
              <TerminalBlock
                command={target?.tool.name ?? ''}
                output={result.errorCode === 'TOOLS_NOT_ENUMERATED'
                  ? t('mcp', 'toolsNotEnumerated')
                  : result.error ?? t('mcp', 'resultEmpty')}
                exitCode={1}
                labels={terminalLabels()}
                className={css.terminal}
              />
            )}
          </>
        )}
      </form>
    </Drawer>
  )
}

/** 单个 schema 字段的控件：string→Input/多行文本、number→数字输入、boolean→Switch、enum→菜单、array/object→JSON 文本域。 */
function JsonSchemaControl({ field, value, onChange }: {
  field: SchemaField
  value: string | boolean | undefined
  onChange: (next: string | boolean) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const text = typeof value === 'string' ? value : ''
  if (field.kind === 'boolean') {
    return (
      <Switch
        className={css.switchTarget}
        checked={value === true}
        label={field.name}
        onChange={(next) => { onChange(next) }}
      />
    )
  }
  if (field.kind === 'enum') {
    const current = typeof value === 'string' ? value : ''
    return (
      <Menu
        open={menuOpen}
        items={field.options.map(option => ({ id: option, label: option }))}
        selectedId={current === '' ? undefined : current}
        onSelect={(id) => { onChange(id); setMenuOpen(false) }}
        onClose={() => { setMenuOpen(false) }}
        anchor={(
          <Button size="sm" onClick={() => { setMenuOpen(!menuOpen) }}>
            {current === '' ? t('common', 'actionSelect') : current}
          </Button>
        )}
      />
    )
  }
  if (field.kind === 'json') {
    return (
      <textarea
        className={`${css.textarea} ${css.textareaMono}`}
        value={text}
        onChange={(event) => { onChange(event.currentTarget.value) }}
      />
    )
  }
  // schema 声明了多行输入（`format: textarea` / `ui:widget: textarea`）时用文本域；
  // 单行字段与数字字段仍用 Input，占位提示取 schema 上的 `placeholder` 注解。
  if (field.kind === 'string' && field.multiline) {
    return (
      <textarea
        className={`${css.textarea} ${css.textareaMono}`}
        rows={4}
        value={text}
        {...(field.placeholder === null ? {} : { placeholder: field.placeholder })}
        onChange={(event) => { onChange(event.currentTarget.value) }}
      />
    )
  }
  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      value={text}
      {...(field.placeholder === null ? {} : { placeholder: field.placeholder })}
      onChange={(event) => { onChange(event.currentTarget.value) }}
    />
  )
}

/**
 * 服务器文件区（PRD-05 FR-MCP-007）：三种呈现方式与后端 `McpServerFilesView.mode` 一一对应。
 *
 * - `editable`：上传隔离目录，点文件名读取内容进编辑框，保存经 `PUT /mcp/:id/file` 落盘；
 * - `readonly`：普通 stdio 的 `working_dir` / 绝对命令目录，只列清单，不读取也不写入内容；
 * - `none`：HTTP 没有本地文件、stdio 没有可用目录，按后端给的原因说明。
 */
function ServerFiles({ server, onError, onSaved }: {
  server: McpServerView
  onError: (error: PageError | null) => void
  onSaved: () => void
}) {
  const [listing, setListing] = useState<McpServerFilesView | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string; saved: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  // 文件页首次加载后自动打开首个可编辑文件（原型 mcp.js:153-155）；openFile 定义在
  // loadFiles 之后，经 ref 调用以避免把 dirty 等状态塞进 loadFiles 的依赖。
  const openFileRef = useRef<(path: string) => void>(() => {})
  // 手改未保存的拦截（R33/R39，与技能文件页同一机制）：自动保存有 700ms 窗口，
  // 换文件或离开页面会静默丢掉窗口内的改动，必须先问一句。
  const dirty = editing !== null && editing.content !== editing.saved
  const files = listing === null ? [] : listing.files
  const editable = listing !== null && listing.mode === 'editable'

  const persist = useCallback(async (path: string, content: string, silent = false): Promise<void> => {
    setSaveState('saving')
    try {
      await request(`/mcp/${server.id}/file`, { method: 'PUT', body: { path, content } })
      setEditing(current => current !== null && current.path === path && current.content === content
        ? { ...current, saved: content }
        : current)
      const bytes = new TextEncoder().encode(content).length
      setListing(current => current === null
        ? current
        : {
          ...current,
          files: current.files.map(file => (file.path === path ? { ...file, bytes, text: true } : file)),
        })
      setSaveState('saved')
      // 原型 mcp.js:533-552：自动保存只更新「已保存」状态，只有手动保存才弹 Toast。
      if (!silent) onSavedRef.current()
    } catch (failure) {
      setSaveState('idle')
      onErrorRef.current({
        key: 'errorFileSave',
        detail: describeError(failure),
        retry: () => {
          onErrorRef.current(null)
          void persist(path, content, silent)
        },
      })
    }
  }, [server.id])

  // 自动保存：停手 700ms 落盘（需求文档 §12.3 第 8 条）。保存成功只把 saved 推到当前内容，
  // 因此继续输入会重新计时；失败保留未保存态并走页面级错误。
  useEffect(() => {
    if (editing === null || editing.content === editing.saved) return
    const path = editing.path
    const content = editing.content
    const timer = window.setTimeout(() => { void persist(path, content, true) }, 700)
    return () => { window.clearTimeout(timer) }
  }, [editing, persist])

  useEffect(() => {
    // 多卡片页各注册各的（引用计数式集合）：最后一张卡片的清理不会顶掉别的卡片的拦截。
    if (!dirty) return
    return addRouteBlocker(() => t('mcp', 'dirtyLeave'))
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler) }
  }, [dirty])

  const loadFiles = useCallback((): void => {
    setBusy(true)
    onErrorRef.current(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; listing: McpServerFilesView }>(
          `/mcp/${server.id}/files`,
        )
        setListing(result.listing)
        // 只读/无文件时清掉编辑态：切换入口后旧编辑框不能继续持有另一个目录的内容。
        if (result.listing.mode !== 'editable') {
          setEditing(null)
        } else {
          // 原型 mcp.js:153-155：进入文件页即打开第一个可编辑文件。
          const first = result.listing.files.find(file => file.text)
          if (first !== undefined) openFileRef.current(first.path)
        }
      } catch (failure) {
        onErrorRef.current({ key: 'errorFiles', detail: describeError(failure), retry: loadFiles })
      } finally {
        setBusy(false)
      }
    })()
  }, [server.id])

  // 文件页签一激活就自动读取清单（用户不必先点一次按钮）；手动刷新走同一入口。
  useEffect(() => { loadFiles() }, [loadFiles])

  const openFile = (path: string): void => {
    if (dirty && !window.confirm(t('mcp', 'dirtyLeave'))) return
    setBusy(true)
    onError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; file: { path: string; content: string } }>(
          `/mcp/${server.id}/file?path=${encodeURIComponent(path)}`,
        )
        setEditing({ path: result.file.path, content: result.file.content, saved: result.file.content })
        setSaveState('idle')
      } catch (failure) {
        onError({ key: 'errorFiles', detail: describeError(failure) })
      } finally {
        setBusy(false)
      }
    })()
  }
  openFileRef.current = openFile

  /** 取消编辑：有未保存改动先问（与换文件/离开页面同一判据）。 */
  const cancelEdit = (): void => {
    if (dirty && !window.confirm(t('mcp', 'dirtyLeave'))) return
    setEditing(null)
    setSaveState('idle')
  }

  const saveLabel = editing === null || !dirty
    ? t('common', 'stateSaved')
    : saveState === 'saving' ? t('mcp', 'autoSaving') : t('common', 'stateUnsaved')

  if (listing === null) {
    return (
      <div className={css.emptyState}>
        <span className={css.emptyIcon} aria-hidden="true"><IconFolderOpenOutlineRegular size={22} /></span>
        <p className={css.emptyTitle}>{t('mcp', 'filesLoadTitle')}</p>
        <p className={css.emptyDesc}>{busy ? t('common', 'stateLoading') : t('mcp', 'filesLoadHint')}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={loadFiles}>{t('mcp', 'filesLoad')}</Button>
      </div>
    )
  }

  if (listing.mode === 'none') {
    return (
      <div className={css.emptyState}>
        <span className={css.emptyIcon} aria-hidden="true"><IconFolderOpenOutlineRegular size={22} /></span>
        <p className={css.emptyTitle}>{t('mcp', 'filesNoLocalTitle')}</p>
        <p className={css.emptyDesc}>
          {listing.reason === 'http_transport'
            ? t('mcp', 'filesNoLocalHttp')
            : t('mcp', 'filesNoLocalDirectory')}
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={loadFiles}>{t('common', 'actionRefresh')}</Button>
      </div>
    )
  }

  if (listing.mode === 'readonly') {
    return (
      <div className={mcpCss.files}>
        <aside className={mcpCss.fileList} aria-label={t('mcp', 'filesHead')}>
          <div className={mcpCss.fileListHead}>
            <span>{t('mcp', 'filesHead')}</span>
            <span className={mcpCss.fileListActions}>
              <span className={mcpCss.count}>{files.length}</span>
              <Button
                size="sm"
                variant="ghost"
                className={mcpCss.iconButton}
                icon={<IconRefreshOutlineRegular size={13} />}
                aria-label={t('mcp', 'filesRefresh')}
                title={t('mcp', 'filesRefresh')}
                disabled={busy}
                onClick={loadFiles}
              />
            </span>
          </div>
          {files.map(file => (
            <span key={file.path} className={mcpCss.fileItem} title={file.path}>
              <IconFolderOpenOutlineRegular size={14} />
              <span className={mcpCss.fileName}>{file.path}</span>
            </span>
          ))}
        </aside>
        <section className={mcpCss.fileEditor}>
          <div className={mcpCss.fileEditorHead}>
            <span className={mcpCss.filePath}><PathValue value={listing.directory ?? ''} /></span>
            <span className={mcpCss.spacer} />
            <Tag tone="neutral">{t('mcp', 'filesReadonlyBadge')}</Tag>
          </div>
          <p className={mcpCss.filePlaceholder}>
            {listing.truncated
              ? t('mcp', 'filesReadonlyTruncated', { count: files.length })
              : files.length === 0
                ? t('mcp', 'filesReadonlyEmpty')
                : t('mcp', 'filesReadonlyHint')}
          </p>
        </section>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className={css.emptyState}>
        <span className={css.emptyIcon} aria-hidden="true"><IconFolderOpenOutlineRegular size={22} /></span>
        <p className={css.emptyTitle}>{t('mcp', 'filesEmptyTitle')}</p>
        <p className={css.emptyDesc}>{t('mcp', 'filesEmptyDesc')}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={loadFiles}>{t('common', 'actionRefresh')}</Button>
      </div>
    )
  }

  return (
    <div className={mcpCss.files}>
      <aside className={mcpCss.fileList} aria-label={t('mcp', 'filesHead')}>
        <div className={mcpCss.fileListHead}>
          <span>{t('mcp', 'filesHead')}</span>
          <span className={mcpCss.fileListActions}>
            <span className={mcpCss.count}>{files.length}</span>
            <Button
              size="sm"
              variant="ghost"
              className={mcpCss.iconButton}
              icon={<IconRefreshOutlineRegular size={13} />}
              aria-label={t('mcp', 'filesRefresh')}
              title={t('mcp', 'filesRefresh')}
              disabled={busy}
              onClick={loadFiles}
            />
          </span>
        </div>
        {files.map(file => (
          <button
            key={file.path}
            type="button"
            className={editing?.path === file.path ? `${mcpCss.fileItem} ${mcpCss.fileItemActive}` : mcpCss.fileItem}
            disabled={!file.text || !editable}
            title={file.text ? file.path : t('mcp', 'binaryNotEditable')}
            onClick={() => { openFile(file.path) }}
          >
            <IconFolderOpenOutlineRegular size={14} />
            <span className={mcpCss.fileName}>{file.path}</span>
          </button>
        ))}
      </aside>
      <section className={mcpCss.fileEditor}>
        {editing === null ? (
          <p className={mcpCss.filePlaceholder}>{t('mcp', 'filesPick')}</p>
        ) : (
          <>
            <div className={mcpCss.fileEditorHead}>
              <span className={mcpCss.filePath}><PathValue value={editing.path} /></span>
              <span className={dirty || saveState === 'saving' ? mcpCss.saveStateDirty : mcpCss.saveState}>
                <span className={mcpCss.saveDot} aria-hidden="true" />
                {saveLabel}
              </span>
              <span className={mcpCss.spacer} />
              <span className={mcpCss.count}>{bytesLabel(new TextEncoder().encode(editing.content).length)}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || saveState === 'saving'}
                onClick={() => { void persist(editing.path, editing.content) }}
              >
                {t('mcp', 'fileSave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>{t('common', 'actionCancel')}</Button>
            </div>
            <textarea
              className={mcpCss.codeArea}
              value={editing.content}
              spellCheck={false}
              aria-label={t('mcp', 'fileAria')}
              onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
            />
          </>
        )}
      </section>
    </div>
  )
}
