/** 模型配置页。 */
import { useCallback, useEffect, useState } from 'react'
import { Button, IconTrashOutline16, Input, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import type { ModelTestResult, ModelUsageRow, ModelView } from '../types.ts'
import css from '../styles/common.module.css'

/** 一条测试结果的展示态。 */
interface TestState {
  id: string
  result: ModelTestResult
}

/**
 * 渲染模型配置页。
 */
export function ModelsPage() {
  useLocale()
  const [models, setModels] = useState<ModelView[]>([])
  const [usage, setUsage] = useState<ModelUsageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ModelView | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelView | null>(null)
  const [test, setTest] = useState<TestState | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [modelResult, usageResult] = await Promise.all([
        request<{ ok: true; models: ModelView[] }>('/models'),
        request<{ ok: true; byModel: ModelUsageRow[] }>('/usage'),
      ])
      setModels(modelResult.models)
      setUsage(usageResult.byModel)
      setError(null)
    } catch (failure) {
      setError(describeError(failure))
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
        setError(`${t('models', failureKey)} — ${describeError(failure)}`)
      } finally {
        setBusyId(null)
      }
    })()
  }

  return (
    <div className={css.page}>
      <PageHeader
        title={t('models', 'title')}
        subtitle={t('models', 'subtitle')}
        actions={(
          <>
            <Button variant="primary" onClick={() => { setCreateOpen(true) }}>{t('models', 'create')}</Button>
            <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
      {test !== null && (
        <NoticeLine
          tone={test.result.ok ? 'success' : 'error'}
          text={[
            test.result.ok ? t('models', 'testOk') : t('models', 'testFail'),
            test.result.kind === undefined ? null : t('models', kindKey(test.result.kind)),
            test.result.latency_ms === undefined ? null : t('models', 'testLatency', { ms: test.result.latency_ms }),
            test.result.status === undefined ? null : t('models', 'testStatus', { status: test.result.status }),
            test.result.provider === undefined ? null : test.result.provider,
            test.result.message === undefined ? null : test.result.message,
          ].filter(part => part !== null).join(' · ')}
        />
      )}

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && models.length === 0 && <div className={css.empty}>{t('models', 'empty')}</div>}

      {models.length > 0 && (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{t('models', 'tableName')}</th>
                <th>{t('models', 'tableProvider')}</th>
                <th>{t('models', 'tableModel')}</th>
                <th>{t('models', 'tableBaseUrl')}</th>
                <th>{t('models', 'tableRoute')}</th>
                <th>{t('models', 'tableDefault')}</th>
                <th>{t('models', 'tableActive')}</th>
                <th>{t('models', 'tableUsage')}</th>
                <th>{t('common', 'labelAction')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map(model => {
                const row = usage.find(item => item.llm_config_id === model.id)
                return (
                  <tr key={model.id}>
                    <td>{model.name}</td>
                    <td>{model.provider}</td>
                    <td>{model.model_name}</td>
                    <td className={css.mono}>
                      {model.base_url === null || model.base_url === ''
                        ? t('common', 'labelNone')
                        : model.base_url}
                    </td>
                    <td className={css.mono}>{model.model_route}</td>
                    <td>{model.is_default ? <Tag tone="solid">{t('common', 'stateDefault')}</Tag> : t('common', 'stateNo')}</td>
                    <td>
                      <Tag tone={model.is_active ? 'success' : 'warning'}>
                        {model.is_active ? t('common', 'stateActive') : t('common', 'stateInactive')}
                      </Tag>
                    </td>
                    <td>
                      {row === undefined
                        ? t('common', 'labelNone')
                        : `${t('models', 'usageRequests', { count: row.requests })} · ${t('models', 'usageTokens', { count: row.totalTokens })}`}
                    </td>
                    <td>
                      <div className={css.rowActions}>
                        <Button size="sm" onClick={() => { setEditTarget(model) }}>{t('common', 'actionEdit')}</Button>
                        <Button
                          size="sm"
                          disabled={busyId === model.id}
                          onClick={() => {
                            act(model.id, async () => {
                              await request(`/models/${model.id}/active`, {
                                method: 'POST',
                                body: { active: !model.is_active },
                              })
                              await load()
                            }, 'errorSave')
                          }}
                        >
                          {model.is_active ? t('models', 'disable') : t('models', 'enable')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === model.id || model.is_default}
                          onClick={() => {
                            act(model.id, async () => {
                              await request(`/models/${model.id}/default`, { method: 'POST' })
                              await load()
                            }, 'errorSave')
                          }}
                        >
                          {t('models', 'setDefault')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === model.id}
                          onClick={() => {
                            setBusyId(model.id)
                            setError(null)
                            void (async () => {
                              try {
                                const result = await request<{ ok: true; result: ModelTestResult }>(
                                  `/models/${model.id}/test`,
                                  { method: 'POST' },
                                )
                                setTest({ id: model.id, result: result.result })
                              } catch (failure) {
                                setError(`${t('models', 'errorTest')} — ${describeError(failure)}`)
                              } finally {
                                setBusyId(null)
                              }
                            })()
                          }}
                        >
                          {busyId === model.id ? t('models', 'testing') : t('common', 'actionTest')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<IconTrashOutline16 size={14} />}
                          disabled={busyId === model.id}
                          onClick={() => { setDeleteTarget(model) }}
                        >
                          {t('common', 'actionDelete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModelFormDialog
        open={createOpen || editTarget !== null}
        target={editTarget}
        onClose={() => { setCreateOpen(false); setEditTarget(null) }}
        onSaved={() => { setCreateOpen(false); setEditTarget(null); void load() }}
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
                  await request(`/models/${target.id}`, { method: 'DELETE' })
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
            {t('models', 'deleteNote')}
          </p>
        )}
      </Modal>
    </div>
  )
}

/** 测试失败归因键（真实六类，来自 models.ts 的 classifyHttpFailure）。 */
function kindKey(kind: NonNullable<ModelTestResult['kind']>): string {
  switch (kind) {
    case 'auth': return 'kindAuth'
    case 'address': return 'kindAddress'
    case 'timeout': return 'kindTimeout'
    case 'network': return 'kindNetwork'
    case 'response': return 'kindResponse'
    default: return 'kindUnknown'
  }
}

/** 数字字段的可空输入。 */
function numberField(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 新建 / 编辑模型配置对话框。 */
function ModelFormDialog({ open, target, onClose, onSaved, onError }: {
  open: boolean
  target: ModelView | null
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('deepseek')
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [isFullUrl, setIsFullUrl] = useState(false)
  const [temperature, setTemperature] = useState('')
  const [maxTokens, setMaxTokens] = useState('')
  const [maxInputTokens, setMaxInputTokens] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [topP, setTopP] = useState('')
  const [frequencyPenalty, setFrequencyPenalty] = useState('')
  const [presencePenalty, setPresencePenalty] = useState('')
  const [timeout, setTimeoutValue] = useState('')
  const [maxToolCalls, setMaxToolCalls] = useState('')
  const [extraParams, setExtraParams] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(target?.name ?? '')
    setProvider(target?.provider ?? 'deepseek')
    setModelName(target?.model_name ?? '')
    setApiKey('')
    setBaseUrl(target?.base_url ?? '')
    setIsFullUrl(target?.is_full_url ?? false)
    setTemperature(target?.temperature === null || target?.temperature === undefined ? '' : String(target.temperature))
    setMaxTokens(target?.max_tokens === null || target?.max_tokens === undefined ? '' : String(target.max_tokens))
    setMaxInputTokens(target?.max_input_tokens === null || target?.max_input_tokens === undefined ? '' : String(target.max_input_tokens))
    setMaxOutputTokens(target?.max_output_tokens === null || target?.max_output_tokens === undefined ? '' : String(target.max_output_tokens))
    setTopP(target?.top_p === null || target?.top_p === undefined ? '' : String(target.top_p))
    setFrequencyPenalty(target?.frequency_penalty === null || target?.frequency_penalty === undefined ? '' : String(target.frequency_penalty))
    setPresencePenalty(target?.presence_penalty === null || target?.presence_penalty === undefined ? '' : String(target.presence_penalty))
    setTimeoutValue(target?.timeout === null || target?.timeout === undefined ? '' : String(target.timeout))
    setMaxToolCalls(target?.max_tool_calls === null || target?.max_tool_calls === undefined ? '' : String(target.max_tool_calls))
    setExtraParams(target?.extra_params ?? '')
    setError(null)
  }, [target, open])

  const numeric = (): Record<string, number> => {
    const fields: Record<string, number | undefined> = {
      temperature: numberField(temperature),
      max_tokens: numberField(maxTokens),
      max_input_tokens: numberField(maxInputTokens),
      max_output_tokens: numberField(maxOutputTokens),
      top_p: numberField(topP),
      frequency_penalty: numberField(frequencyPenalty),
      presence_penalty: numberField(presencePenalty),
      timeout: numberField(timeout),
      max_tool_calls: numberField(maxToolCalls),
    }
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) result[key] = value
    }
    return result
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target === null ? t('models', 'createTitle') : t('models', 'editTitle')}
      closeLabel={t('common', 'actionClose')}
      contentClassName={css.scrollArea ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (name.trim() === '' || provider.trim() === '' || modelName.trim() === '') {
                setError(t('models', 'errorRequired'))
                return
              }
              setBusy(true)
              setError(null)
              const body: Record<string, unknown> = {
                name: name.trim(),
                provider: provider.trim(),
                model_name: modelName.trim(),
                is_full_url: isFullUrl,
                ...numeric(),
              }
              if (apiKey !== '') body.api_key = apiKey
              if (baseUrl.trim() !== '') body.base_url = baseUrl.trim()
              if (extraParams.trim() !== '') body.extra_params = extraParams.trim()
              if (target !== null) body.version = target.version
              void (async () => {
                try {
                  if (target === null) await request('/models', { method: 'POST', body })
                  else await request(`/models/${target.id}`, { method: 'PATCH', body })
                  onSaved()
                } catch (failure) {
                  setError(describeError(failure))
                  onError(`${t('models', 'errorSave')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('common', 'stateSaving') : t('common', 'actionSave')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <div className={css.formGrid}>
          <Field label={t('models', 'fieldName')}>
            <Input value={name} onChange={event => { setName(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldProvider')} hint={t('models', 'fieldProviderHint')}>
            <Input value={provider} onChange={event => { setProvider(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldModelName')}>
            <Input value={modelName} onChange={event => { setModelName(event.currentTarget.value) }} />
          </Field>
          <Field
            label={t('models', 'fieldApiKey')}
            hint={target === null
              ? t('models', 'fieldApiKeyHint')
              : `${t('models', 'fieldApiKeyHint')} · ${target.api_key_masked ?? t('models', 'secretAbsent')}`}
          >
            <Input
              type="password"
              value={apiKey}
              placeholder={t('models', 'secretPlaceholder')}
              onChange={event => { setApiKey(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('models', 'fieldBaseUrl')} hint={t('models', 'fieldBaseUrlHint')}>
            <Input value={baseUrl} onChange={event => { setBaseUrl(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldIsFullUrl')}>
            <input
              className={css.checkInput}
              type="checkbox"
              checked={isFullUrl}
              onChange={event => { setIsFullUrl(event.currentTarget.checked) }}
            />
          </Field>
          <Field label={t('models', 'fieldTemperature')}>
            <Input value={temperature} onChange={event => { setTemperature(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldMaxTokens')}>
            <Input value={maxTokens} onChange={event => { setMaxTokens(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldMaxInputTokens')}>
            <Input value={maxInputTokens} onChange={event => { setMaxInputTokens(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldMaxOutputTokens')}>
            <Input value={maxOutputTokens} onChange={event => { setMaxOutputTokens(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldTopP')}>
            <Input value={topP} onChange={event => { setTopP(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldFrequencyPenalty')}>
            <Input value={frequencyPenalty} onChange={event => { setFrequencyPenalty(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldPresencePenalty')}>
            <Input value={presencePenalty} onChange={event => { setPresencePenalty(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldTimeout')}>
            <Input value={timeout} onChange={event => { setTimeoutValue(event.currentTarget.value) }} />
          </Field>
          <Field label={t('models', 'fieldMaxToolCalls')}>
            <Input value={maxToolCalls} onChange={event => { setMaxToolCalls(event.currentTarget.value) }} />
          </Field>
        </div>
        <Field label={t('models', 'fieldExtraParams')} hint={t('models', 'fieldExtraParamsHint')}>
          <textarea
            className={`${css.textarea} ${css.textareaMono}`}
            value={extraParams}
            onChange={event => { setExtraParams(event.currentTarget.value) }}
          />
        </Field>
      </div>
    </Modal>
  )
}
