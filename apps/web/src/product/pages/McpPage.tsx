/** MCP 服务器页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, CodeBlock, IconPlusOutline16, IconTrashOutline16, Input, Menu, Modal, Switch,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
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
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
      setError(`${t('mcp', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = (id: string, action: () => Promise<void>, failureKey: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
      } catch (failure) {
        setError(`${t('mcp', failureKey)} — ${describeError(failure)}`)
      } finally {
        setBusyId(null)
      }
    })()
  }

  return (
    <div className={css.page}>
      <PageHeader
        title={t('mcp', 'title')}
        subtitle={t('mcp', 'subtitle')}
        actions={(
          <>
            <Button variant="primary" icon={<IconPlusOutline16 size={14} />} onClick={() => { setCreateVariant('stdio') }}>
              {t('mcp', 'createStdio')}
            </Button>
            <Button onClick={() => { setCreateVariant('http') }}>{t('mcp', 'createHttp')}</Button>
            <Button onClick={() => { setCreateVariant('code') }}>{t('mcp', 'createCode')}</Button>
            <Button onClick={() => { setCreateVariant('package') }}>{t('mcp', 'createPackage')}</Button>
            <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
      <NoticeLine tone="success" text={notice} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && servers.length === 0 && <div className={css.empty}>{t('mcp', 'empty')}</div>}

      <div className={css.cardGrid}>
        {servers.map(server => {
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
                    {t('common', 'labelType')} {transport}
                    {' · '}
                    {t('mcp', 'sourceType')} {server.source_type ?? t('common', 'labelNone')}
                  </span>
                </div>
                <Switch
                  checked={server.is_active}
                  label={`${server.name} ${t('common', 'stateActive')}`}
                  disabled={busyId === server.id}
                  onChange={next => {
                    act(server.id, async () => {
                      await request(`/mcp/${server.id}/active`, { method: 'POST', body: { active: next } })
                      await load()
                    }, 'errorActive')
                  }}
                />
              </div>
              <div className={css.cardBody}>{server.description ?? t('common', 'labelNone')}</div>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('mcp', 'capabilitySummary')}</span>
                <span className={css.definitionValue}>
                  {server.stdio !== null && server.stdio.command !== null
                    ? t('mcp', 'stdioCommand', { command: server.stdio.command })
                    : server.http !== null && server.http.url !== null
                      ? t('mcp', 'httpUrl', { url: server.http.url })
                      : t('common', 'labelNone')}
                </span>
                <span className={css.definitionLabel}>{t('common', 'labelStatus')}</span>
                <span className={css.definitionValue}>
                  {capability === undefined
                    ? t('common', 'labelNone')
                    : capability.ok
                      ? `${t('common', 'stateOk')} · ${t('mcp', 'tools')} ${t('mcp', 'capabilityCount', { count: capability.tools?.length ?? 0 })}`
                      : `${t('common', 'stateFailed')} · ${t('mcp', kindKey(capability.kind))} · ${capability.message ?? ''}`}
                </span>
              </div>
              <div className={css.cardActions}>
                <Button
                  size="sm"
                  disabled={busyId === server.id}
                  onClick={() => {
                    setBusyId(server.id)
                    setError(null)
                    void (async () => {
                      try {
                        const result = await request<{ ok: true; result: McpTestResult }>(
                          `/mcp/${server.id}/test`,
                          { method: 'POST' },
                        )
                        setCapabilities(previous => ({ ...previous, [server.id]: result.result }))
                      } catch (failure) {
                        setError(`${t('mcp', 'errorTest')} — ${describeError(failure)}`)
                      } finally {
                        setBusyId(null)
                      }
                    })()
                  }}
                >
                  {busyId === server.id ? t('mcp', 'testing') : t('mcp', 'test')}
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === server.id}
                  onClick={() => {
                    setBusyId(server.id)
                    setError(null)
                    void (async () => {
                      try {
                        const result = await request<{ ok: true; result: McpTestResult }>(
                          `/mcp/${server.id}/enumerate`,
                          { method: 'POST' },
                        )
                        setCapabilities(previous => ({ ...previous, [server.id]: result.result }))
                      } catch (failure) {
                        setError(`${t('mcp', 'errorEnumerate')} — ${describeError(failure)}`)
                      } finally {
                        setBusyId(null)
                      }
                    })()
                  }}
                >
                  {busyId === server.id ? t('mcp', 'enumerating') : t('mcp', 'enumerate')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconTrashOutline16 size={14} />}
                  disabled={busyId === server.id}
                  onClick={() => { setDeleteTarget(server) }}
                >
                  {t('common', 'actionDelete')}
                </Button>
              </div>
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
                </div>
              )}
            </article>
          )
        })}
      </div>

      <CreateServerDialog
        variant={createVariant}
        onClose={() => { setCreateVariant(null) }}
        onCreated={server => {
          setCreateVariant(null)
          setNotice(`${t('mcp', 'create')}: ${server.name}`)
          void load()
        }}
        onError={message => { setError(message) }}
      />

      <CallToolDialog
        target={callTarget}
        onClose={() => { setCallTarget(null) }}
        onError={message => { setError(message) }}
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
              variant="primary"
              disabled={deleteTarget === null || busyId === deleteTarget.id}
              onClick={() => {
                const target = deleteTarget
                if (target === null) return
                act(target.id, async () => {
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
      <div className={css.fieldLabel}>{title} · {t('mcp', 'capabilityCount', { count: items.length })}</div>
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

/** 四类创建入口的表单对话框。 */
function CreateServerDialog({ variant, onClose, onCreated, onError }: {
  variant: CreateVariant | null
  onClose: () => void
  onCreated: (server: McpServerView) => void
  onError: (message: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
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
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [transportMenuOpen, setTransportMenuOpen] = useState(false)
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
      contentClassName={css.scrollArea ?? ''}
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
              if (effectiveTransport === 'stdio' && command.trim() === '') {
                setError(t('mcp', 'errorConfigRequired'))
                return
              }
              if (effectiveTransport === 'http' && url.trim() === '') {
                setError(t('mcp', 'errorConfigRequired'))
                return
              }
              setBusy(true)
              setError(null)
              const metadata: Record<string, string | number> = {}
              if (variant === 'code') {
                metadata.upload = 'code'
                metadata.codeLength = code.length
              }
              if (variant === 'package') {
                metadata.upload = 'package'
                metadata.fileName = uploadName
                metadata.bytes = uploadBytes
              }
              const body: Record<string, unknown> = {
                name: name.trim(),
                transport_type: effectiveTransport,
                ...(description.trim() === '' ? {} : { description: description.trim() }),
                ...(variant === 'code' || variant === 'package' ? { source_type: variant } : {}),
                ...(Object.keys(metadata).length === 0 ? {} : { tags: JSON.stringify(metadata) }),
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
                  setError(describeError(failure))
                  onError(`${t('mcp', 'errorCreate')} — ${describeError(failure)}`)
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
          <Input value={name} onChange={event => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('mcp', 'descriptionLabel')}>
          <Input value={description} onChange={event => { setDescription(event.currentTarget.value) }} />
        </Field>
        {variant === 'code' || variant === 'package' ? (
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('mcp', 'transportLabel')}</span>
            <div className={css.fieldControl}>
              <Menu
                open={transportMenuOpen}
                items={[
                  { id: 'stdio', label: t('mcp', 'transportStdio') },
                  { id: 'http', label: t('mcp', 'transportHttp') },
                ]}
                selectedId={transport}
                onSelect={id => { setTransport(id === 'http' ? 'http' : 'stdio'); setTransportMenuOpen(false) }}
                onClose={() => { setTransportMenuOpen(false) }}
                anchor={(
                  <Button size="sm" onClick={() => { setTransportMenuOpen(!transportMenuOpen) }}>
                    {transport === 'http' ? t('mcp', 'transportHttp') : t('mcp', 'transportStdio')}
                  </Button>
                )}
              />
            </div>
          </div>
        ) : null}
        {variant === 'code' && (
          <Field label={t('mcp', 'codeLabel')} hint={t('mcp', 'codeHint')}>
            <textarea
              className={`${css.textarea} ${css.textareaMono}`}
              value={code}
              onChange={event => { setCode(event.currentTarget.value) }}
            />
          </Field>
        )}
        {variant === 'package' && (
          <Field label={t('mcp', 'packageLabel')} hint={t('mcp', 'packageHint')}>
            <input
              ref={fileRef}
              type="file"
              onChange={event => {
                const file = event.currentTarget.files?.[0]
                if (file === undefined) return
                setUploadName(file.name)
                setUploadBytes(file.size)
              }}
            />
          </Field>
        )}
        {uploadName !== '' && (
          <div className={css.fieldHint}>{uploadName} · {t('mcp', 'capabilityCount', { count: uploadBytes })}</div>
        )}
        {effectiveTransport === 'stdio' ? (
          <div className={css.formGrid}>
            <Field label={t('mcp', 'commandLabel')}>
              <Input value={command} onChange={event => { setCommand(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'argsLabel')}>
              <Input value={args} onChange={event => { setArgs(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'envLabel')}>
              <Input value={env} onChange={event => { setEnv(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'workingDirLabel')}>
              <Input value={workingDir} onChange={event => { setWorkingDir(event.currentTarget.value) }} />
            </Field>
          </div>
        ) : (
          <div className={css.formGrid}>
            <Field label={t('mcp', 'urlLabel')}>
              <Input value={url} onChange={event => { setUrl(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'headersLabel')}>
              <Input value={headers} onChange={event => { setHeaders(event.currentTarget.value) }} />
            </Field>
            <Field label={t('mcp', 'timeoutLabel')}>
              <Input value={timeout} onChange={event => { setTimeoutValue(event.currentTarget.value) }} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 单工具试运行对话框：参数表单由工具 JSON schema 生成。 */
function CallToolDialog({ target, onClose, onError }: {
  target: { server: McpServerView; tool: McpToolInfo } | null
  onClose: () => void
  onError: (message: string) => void
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
      contentClassName={css.scrollArea ?? ''}
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
                    if (!Number.isFinite(parsed)) throw new Error(`${field.name} is not a number`)
                    args[field.name] = parsed
                  } else if (field.kind === 'json') {
                    args[field.name] = JSON.parse(String(value)) as unknown
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
                  setError(describeError(failure))
                  onError(`${t('mcp', 'errorCall')} — ${describeError(failure)}`)
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
        {fields.length === 0 && <div className={css.fieldHint}>{t('mcp', 'noCapabilities')}</div>}
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
              onChange={next => { setValue(field.name, next) }}
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
        checked={value === true}
        label={field.name}
        onChange={next => { onChange(next) }}
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
        onSelect={id => { onChange(id); setMenuOpen(false) }}
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
        onChange={event => { onChange(event.currentTarget.value) }}
      />
    )
  }
  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={event => { onChange(event.currentTarget.value) }}
    />
  )
}
