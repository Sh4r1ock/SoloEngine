/** MCP 服务器页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, CodeBlock, IconPlusOutlineRegular, IconTrashOutlineRegular, Input, Menu, Modal, Switch,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { setRouteBlocker } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { FilePicker } from '../components/FilePicker.tsx'
import { PathValue } from '../components/PathValue.tsx'
import { codeLabels, terminalLabels } from '../components/labels.ts'
import type { McpCallResult, McpServerView, McpTestResult, McpToolInfo } from '../types.ts'
import css from '../styles/common.module.css'

/** 四类创建入口。 */
type CreateVariant = 'stdio' | 'http' | 'code' | 'package'

/** JSON schema 派生出的一个表单字段。 */
interface SchemaField {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'json'
  required: boolean
  options: string[]
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
      fields.push({ name, kind: 'string', required: required.includes(name), options: [] })
      continue
    }
    const property = value as { type?: unknown; enum?: unknown }
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
    fields.push({ name, kind, required: required.includes(name), options: enumValues })
  }
  return fields
}

/**
 * 渲染 MCP 页。
 */
export function McpPage() {
  useLocale()
  const [servers, setServers] = useState<McpServerView[]>([])
  const [loading, setLoading] = useState(true)
  // 页面级文案存「键 + 动态细节」，渲染时翻译（S5-F9 / S7-F29 / S8-F37 同一规则）：
  // 本页在 AppShell 内，语言 Pill 恒可达，存已翻译字符串会在切语言后残留旧语种。
  const [error, setError] = useState<{ key: string; detail: string } | null>(null)
  const [notice, setNotice] = useState<{ key: string; name: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<Record<string, McpTestResult>>({})
  const [createVariant, setCreateVariant] = useState<CreateVariant | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServerView | null>(null)
  const [callTarget, setCallTarget] = useState<{ server: McpServerView; tool: McpToolInfo } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await request<{ ok: true; servers: McpServerView[] }>('/mcp')
      setServers(result.servers)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = (id: string, action: () => Promise<void>, failureKey: string): void => {
    setBusyId(id)
    setError(null)
    // 成功提示只描述上一次动作：任何新动作起手即作废它（O-S10-1 生命周期归持有消息的页面）。
    setNotice(null)
    void (async () => {
      try {
        await action()
      } catch (failure) {
        setError({ key: failureKey, detail: describeError(failure) })
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

  return (
    <div className={css.page}>
      <PageHeader
        title={t('mcp', 'title')}
        subtitle={t('mcp', 'subtitle')}
        actions={(
          <>
            <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateVariant('stdio') }}>
              {t('mcp', 'createStdio')}
            </Button>
            <Button onClick={() => { setCreateVariant('http') }}>{t('mcp', 'createHttp')}</Button>
            <Button onClick={() => { setCreateVariant('code') }}>{t('mcp', 'createCode')}</Button>
            <Button onClick={() => { setCreateVariant('package') }}>{t('mcp', 'createPackage')}</Button>
            <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <NoticeLine
        tone="error"
        text={error === null ? null : `${t('mcp', error.key)} — ${error.detail}`}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }}
      />
      <NoticeLine tone="success" text={notice === null ? null : `${t('mcp', notice.key)}: ${notice.name}`} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && servers.length === 0 && <div className={css.empty}>{t('mcp', 'empty')}</div>}

      <div className={css.cardGrid}>
        {servers.map((server) => {
          const capability = capabilities[server.id]
          const transport = server.transport_type === 'stdio' || server.transport_type === 'http'
            ? server.transport_type
            : t('mcp', 'transportUnknown')
          return (
            <article key={server.id} className={css.card}>
              <div className={css.cardHeader}>
                <span className={css.iconBlock}>{server.name.slice(0, 1)}</span>
                <div className={css.cardTitleBlock}>
                  <h2 className={css.cardTitle}>{server.name}</h2>
                  <span className={css.cardMeta}>
                    <span className={css.nowrap}>{t('common', 'labelType')} {transport}</span>
                    {' · '}
                    {/* 来源类型可能是长 URL（实测 231px 值落在 189px 盒内被 ellipsis 裁切）：
                        截断值必须给出完整读取途径，与名称列/PathValue 同一规则。 */}
                    <span className={css.nowrap} title={server.source_type ?? ''}>{t('mcp', 'sourceType')} {server.source_type ?? t('common', 'labelNone')}</span>
                  </span>
                </div>
                <Switch
                  className={css.switchTarget}
                  checked={server.is_active}
                  label={`${server.name} ${t('common', 'stateActive')}`}
                  disabled={busyOn(server.id)}
                  onChange={(next) => {
                    act(`${server.id}:active`, async () => {
                      await request(`/mcp/${server.id}/active`, { method: 'POST', body: { active: next } })
                      await load()
                    }, 'errorActive')
                  }}
                />
              </div>
              {/* 描述为空时整行省略：孤行「无」在卡片网格里形似渲染残缺（手册 §三.7）。 */}
              {server.description !== null && server.description !== ''
                ? <div className={css.cardBody}>{server.description}</div>
                : null}
              <div className={css.definition}>
                {/* 手册 §三.2：标签短、值独立成列。原写法把「命令 / 地址」嵌进值里
                    （实测渲染为「能力概要 | 命令 echo」），标签列因此失去意义；
                    长值按 §三.8 走 PathValue，断行只发生在分隔符处。 */}
                {server.stdio !== null && server.stdio.command !== null ? (
                  <>
                    <span className={css.definitionLabel}>{t('mcp', 'commandLabel')}</span>
                    <span className={`${css.definitionValue} ${css.mono}`}><PathValue value={server.stdio.command} /></span>
                  </>
                ) : server.http !== null && server.http.url !== null ? (
                  <>
                    <span className={css.definitionLabel}>{t('mcp', 'urlLabel')}</span>
                    <span className={`${css.definitionValue} ${css.mono}`}><PathValue value={server.http.url} /></span>
                  </>
                ) : (
                  <>
                    <span className={css.definitionLabel}>{t('mcp', 'capabilitySummary')}</span>
                    <span className={css.definitionValue}>{t('common', 'labelNone')}</span>
                  </>
                )}
                <span className={css.definitionLabel}>{t('common', 'labelStatus')}</span>
                <span className={css.definitionValue}>
                  {capability === undefined
                    ? t('common', 'labelNone')
                    : capability.ok
                      ? `${t('common', 'stateOk')} · ${t('mcp', 'tools')} ${countLabel(capability.tools?.length ?? 0)}`
                      : `${t('common', 'stateFailed')} · ${t('mcp', kindKey(capability.kind))} · ${capability.message ?? ''}`}
                </span>
              </div>
              <div className={css.cardActions}>
                <Button
                  size="sm"
                  disabled={busyOn(server.id)}
                  onClick={() => {
                    setBusyId(`${server.id}:test`)
                    setError(null)
                    void (async () => {
                      try {
                        const result = await request<{ ok: true; result: McpTestResult }>(
                          `/mcp/${server.id}/test`,
                          { method: 'POST' },
                        )
                        setCapabilities(previous => ({ ...previous, [server.id]: result.result }))
                      } catch (failure) {
                        setError({ key: 'errorTest', detail: describeError(failure) })
                      } finally {
                        setBusyId(null)
                      }
                    })()
                  }}
                >
                  {busyAction(server.id) === 'test' ? t('mcp', 'testing') : t('mcp', 'test')}
                </Button>
                <Button
                  size="sm"
                  disabled={busyOn(server.id)}
                  onClick={() => {
                    setBusyId(`${server.id}:enumerate`)
                    setError(null)
                    void (async () => {
                      try {
                        const result = await request<{ ok: true; result: McpTestResult }>(
                          `/mcp/${server.id}/enumerate`,
                          { method: 'POST' },
                        )
                        setCapabilities(previous => ({ ...previous, [server.id]: result.result }))
                      } catch (failure) {
                        setError({ key: 'errorEnumerate', detail: describeError(failure) })
                      } finally {
                        setBusyId(null)
                      }
                    })()
                  }}
                >
                  {busyAction(server.id) === 'enumerate' ? t('mcp', 'enumerating') : t('mcp', 'enumerate')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconTrashOutlineRegular size={14} />}
                  disabled={busyOn(server.id)}
                  onClick={() => { setDeleteTarget(server) }}
                >
                  {t('common', 'actionDelete')}
                </Button>
              </div>
              {/* 上传建服务的代码文件（PRD-05 FR-MCP-007）：在线查看与编辑。 */}
              {(server.source_type === 'code' || server.source_type === 'package') && (
                <UploadedServerFiles server={server} onError={(next) => { setError(next) }} />
              )}
              {capability !== undefined && capability.ok && (
                <div className={css.section}>
                  <CapabilityGroup title={t('mcp', 'tools')} items={capability.tools ?? []} emptyText={t('mcp', 'noCapabilities')} />
                  <CapabilityGroup
                    title={t('mcp', 'resources')}
                    items={(capability.resources ?? []).map(item => ({ name: item.name ?? item.uri, description: item.description }))}
                    emptyText={t('mcp', 'noCapabilities')}
                  />
                  <CapabilityGroup
                    title={t('mcp', 'prompts')}
                    items={(capability.prompts ?? []).map(item => ({ name: item.name ?? item.uri, description: item.description }))}
                    emptyText={t('mcp', 'noCapabilities')}
                  />
                  {(capability.tools ?? []).length > 0 && (
                    <div className={css.toolbar}>
                      {(capability.tools ?? []).map(tool => (
                        <Button key={tool.name} size="sm" onClick={() => { setCallTarget({ server, tool }) }}>
                          {t('mcp', 'callTool')} · {tool.name}
                        </Button>
                      ))}
                    </div>
                  )}
                  {/* 单工具启停（PRD-05 FR-MCP-008）：停用的工具在挂载进 agent 作用域时被收紧。 */}
                  {(capability.tools ?? []).length > 0 && (
                    <div className={css.section}>
                      <div className={css.fieldLabel}>{t('mcp', 'toolSwitches')}</div>
                      {(capability.tools ?? []).map((tool) => {
                        const disabled = (server.disabledTools ?? []).includes(tool.name)
                        return (
                          // 开关名与状态必须可见：`Switch` 的 label 只进 aria-label，一列无文字
                          // 开关无法对应是哪个工具（WCAG 2.4.6 / 3.3.2）。用只读行 `.listRow`
                          // （无 hover、无手型），避免整行看起来可点。
                          <div key={`toggle-${tool.name}`} className={css.listRow}>
                            <Switch
                              className={css.switchTarget}
                              checked={!disabled}
                              label={`${tool.name} ${disabled ? t('mcp', 'toolDisabled') : t('mcp', 'toolEnabled')}`}
                              disabled={busyOn(server.id)}
                              onChange={(next) => {
                                setBusyId(`${server.id}:tool`)
                                setError(null)
                                void (async () => {
                                  try {
                                    const result = await request<{ ok: true; server: McpServerView }>(
                                      `/mcp/${server.id}/tools/${encodeURIComponent(tool.name)}/active`,
                                      { method: 'POST', body: { active: next } },
                                    )
                                    setServers(previous => previous.map(item => (item.id === result.server.id ? result.server : item)))
                                  } catch (failure) {
                                    setError({ key: 'errorToolToggle', detail: describeError(failure) })
                                  } finally {
                                    setBusyId(null)
                                  }
                                })()
                              }}
                            />
                            <span className={css.nowrap}>{tool.name}</span>
                            <span className={css.fieldHint}>
                              {disabled ? t('mcp', 'toolDisabled') : t('mcp', 'toolEnabled')}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <CreateServerDialog
        variant={createVariant}
        onClose={() => { setCreateVariant(null) }}
        onCreated={(server) => {
          setCreateVariant(null)
          setNotice({ key: 'createdNotice', name: server.name })
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
                }, 'errorDelete')
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
function kindKey(kind: McpTestResult['kind']): string {
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
  const [timeout, setTimeoutValue] = useState('')
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
    setTimeoutValue('')
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

  return (
    <Modal
      open={variant !== null}
      onClose={onClose}
      title={title}
      closeLabel={t('common', 'actionClose')}
      className={css.modalDialog ?? ''}
      contentClassName={css.modalScroll ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (name.trim() === '') {
                setError(t('mcp', 'errorNameRequired'))
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
                      body: { name: name.trim(), kind: 'code', code, ...(description.trim() === '' ? {} : { description: description.trim() }) },
                    })
                    onCreated(result.server)
                  } catch (failure) {
                    // 错误就近呈现在对话框内（带本地化前缀）；不再向页面级重复投递（会被 Modal 遮挡）。
                    setError(`${t('mcp', 'errorCreate')} — ${describeError(failure)}`)
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
                      body: { name: name.trim(), kind: 'package', archiveBase64: uploadBase64, ...(description.trim() === '' ? {} : { description: description.trim() }) },
                    })
                    onCreated(result.server)
                  } catch (failure) {
                    setError(`${t('mcp', 'errorCreate')} — ${describeError(failure)}`)
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
              if (effectiveTransport === 'http' && url.trim() === '') {
                setError(t('mcp', 'errorConfigRequired'))
                return
              }
              // 超时字段是文本框，`Number('abc')` 会得到 NaN，JSON 序列化后变成 null
              // ——值被静默丢弃（违反「不静默」）。与模型页数值字段同一前置校验。
              if (effectiveTransport === 'http' && timeout.trim() !== '' && !Number.isFinite(Number(timeout.trim()))) {
                setError(t('mcp', 'errorNumeric'))
                return
              }
              setBusy(true)
              setError(null)
              const body: Record<string, unknown> = {
                name: name.trim(),
                transport_type: effectiveTransport,
                ...(description.trim() === '' ? {} : { description: description.trim() }),
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
                    ...(timeout.trim() === '' ? {} : { timeout: Number(timeout.trim()) }),
                  }),
              }
              void (async () => {
                try {
                  const result = await request<{ ok: true; server: McpServerView }>('/mcp', { method: 'POST', body })
                  onCreated(result.server)
                } catch (failure) {
                  setError(`${t('mcp', 'errorCreate')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('mcp', 'creating') : t('mcp', 'create')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <Field label={t('mcp', 'nameLabel')}>
          <Input value={name} onChange={(event) => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('mcp', 'descriptionLabel')}>
          <textarea className={css.textarea} value={description} onChange={(event) => { setDescription(event.currentTarget.value) }} />
        </Field>
        {variant === 'code' || variant === 'package' ? (
          <div className={css.fieldHint}>
            {t('mcp', 'uploadStdioNote')}
          </div>
        ) : null}
        {variant === 'code' && (
          <Field label={t('mcp', 'codeLabel')} hint={t('mcp', 'codeHint')}>
            <textarea
              className={`${css.textarea} ${css.textareaMono}`}
              value={code}
              onChange={(event) => { setCode(event.currentTarget.value) }}
            />
          </Field>
        )}
        {variant === 'package' && (
          <Field label={t('mcp', 'packageLabel')} hint={t('mcp', 'packageHint')}>
            <FilePicker
              showName={false}
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
        )}
        {uploadName !== '' && (
          <div className={css.fieldHint}>{uploadName} · {bytesLabel(uploadBytes)}</div>
        )}
        {(variant === 'stdio' || variant === 'http') && effectiveTransport === 'stdio' ? (
          <div className={css.formGrid}>
            <Field label={t('mcp', 'commandLabel')}>
              <Input value={command} onChange={(event) => { setCommand(event.currentTarget.value) }} />
            </Field>
            {/* 后端把 args/env 当 JSON 数组/对象解析（mcp.ts `assertJson`），不写格式就会
                拿到一句英文实现错误——格式提示前置到字段说明。 */}
            <Field label={t('mcp', 'argsLabel')} hint={t('mcp', 'argsHint')}>
              <textarea className={css.textarea} value={args} onChange={(event) => { setArgs(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'envLabel')} hint={t('mcp', 'envHint')}>
              <textarea className={`${css.textarea} ${css.textareaMono}`} value={env} onChange={(event) => { setEnv(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'workingDirLabel')}>
              <Input value={workingDir} onChange={(event) => { setWorkingDir(event.currentTarget.value) }} />
            </Field>
          </div>
        ) : variant === 'http' ? (
          <div className={css.formGrid}>
            <Field label={t('mcp', 'urlLabel')}>
              <Input value={url} onChange={(event) => { setUrl(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'headersLabel')}>
              <textarea className={`${css.textarea} ${css.textareaMono}`} value={headers} onChange={(event) => { setHeaders(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'timeoutLabel')}>
              <Input value={timeout} onChange={(event) => { setTimeoutValue(event.currentTarget.value) }} />
            </Field>
          </div>
        ) : null}
      </div>
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

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={`${t('mcp', 'callTitle')} · ${target?.tool.name ?? ''}`}
      closeLabel={t('common', 'actionClose')}
      description={t('mcp', 'callDescription')}
      className={css.modalDialog ?? ''}
      contentClassName={css.modalScroll ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || target === null}
            onClick={() => {
              if (target === null) return
              const args: Record<string, unknown> = {}
              try {
                for (const field of fields) {
                  const value = values[field.name]
                  if (value === undefined || value === '') continue
                  if (field.kind === 'number') {
                    const parsed = Number(value)
                    // 直出 `x is not a number` / JS SyntaxError 是实现细节（R8）：给字段名 + 产品语句。
                    if (!Number.isFinite(parsed)) throw new Error(t('mcp', 'errorFieldNumber', { name: field.name }))
                    args[field.name] = parsed
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
            }}
          >
            {busy ? t('mcp', 'calling') : t('mcp', 'callRun')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
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
          </div>
        ))}
        {result !== null && (
          <>
            <div className={css.fieldLabel}>{t('mcp', 'callResult')}</div>
            {result.ok
              ? <CodeBlock code={JSON.stringify(result.result ?? null, null, 2)} lang="json" {...codeLabels()} />
              : (
                <TerminalBlock
                  command={target?.tool.name ?? ''}
                  output={result.error ?? t('mcp', 'resultEmpty')}
                  exitCode={1}
                  labels={terminalLabels()}
                />
              )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** 单个 schema 字段的控件：string→Input、number→数字输入、boolean→Switch、enum→Menu、array/object→JSON 文本域。 */
function JsonSchemaControl({ field, value, onChange }: {
  field: SchemaField
  value: string | boolean | undefined
  onChange: (next: string | boolean) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
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
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => { onChange(event.currentTarget.value) }}
      />
    )
  }
  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => { onChange(event.currentTarget.value) }}
    />
  )
}

/**
 * 上传建服务器的代码文件区（PRD-05 FR-MCP-007）：在线查看与编辑。
 *
 * 只对 `source_type` 为 code/package 的服务器渲染；文件清单按需加载，
 * 点文件名读取内容进编辑框，保存经 `PUT /mcp/:id/file` 落盘（越界由后端拒绝）。
 */
function UploadedServerFiles({ server, onError }: {
  server: McpServerView
  onError: (error: { key: string; detail: string } | null) => void
}) {
  const [files, setFiles] = useState<{ path: string; bytes: number }[] | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string; saved: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // 手改未保存的拦截（R33/R39，与技能文件页同一机制）：这里的保存是手动的，
  // 换文件或离开页面都会静默丢掉改动，必须先问一句。
  const dirty = editing !== null && editing.content !== editing.saved

  useEffect(() => {
    setRouteBlocker(() => (dirty ? t('mcp', 'dirtyLeave') : null))
    return () => { setRouteBlocker(null) }
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler) }
  }, [dirty])

  const loadFiles = (): void => {
    setBusy(true)
    onError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; files: { path: string; bytes: number }[] }>(
          `/mcp/${server.id}/files`,
        )
        setFiles(result.files)
      } catch (failure) {
        onError({ key: 'errorFiles', detail: describeError(failure) })
      } finally {
        setBusy(false)
      }
    })()
  }

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
      } catch (failure) {
        onError({ key: 'errorFiles', detail: describeError(failure) })
      } finally {
        setBusy(false)
      }
    })()
  }

  const saveFile = (): void => {
    if (editing === null) return
    setBusy(true)
    onError(null)
    void (async () => {
      try {
        await request(`/mcp/${server.id}/file`, {
          method: 'PUT',
          body: { path: editing.path, content: editing.content },
        })
        setEditing(null)
        setFiles(null)
      } catch (failure) {
        onError({ key: 'errorFileSave', detail: describeError(failure) })
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className={css.section}>
      <div className={css.fieldLabel}>{t('mcp', 'filesTitle')}</div>
      {files === null && (
        <Button size="sm" disabled={busy} onClick={loadFiles}>{t('mcp', 'filesLoad')}</Button>
      )}
      {files !== null && (
        <div className={css.tree}>
          {files.map(file => (
            <button key={file.path} type="button" className={css.treeItem} onClick={() => { openFile(file.path) }}>
              <span>{file.path}</span>
              <span className={css.fieldHint}>{bytesLabel(file.bytes)}</span>
            </button>
          ))}
        </div>
      )}
      {editing !== null && (
        <div className={css.field}>
          <span className={css.fieldLabel}><PathValue value={editing.path} /></span>
          <textarea
            className={`${css.textarea} ${css.textareaMono}`}
            value={editing.content}
            onChange={(event) => { setEditing({ ...editing, content: event.currentTarget.value }) }}
          />
          <div className={css.toolbar}>
            <Button size="sm" variant="primary" disabled={busy} onClick={saveFile}>{t('mcp', 'fileSave')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null) }}>{t('common', 'actionCancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
