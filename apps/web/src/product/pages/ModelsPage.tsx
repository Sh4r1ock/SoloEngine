/** 模型配置页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconDataOutlineRegular,
  IconDownloadOutlineRegular,
  IconEllipsisOutlineRegular,
  IconGaugeOutlineRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  Menu,
  Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request, requestBlob } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import type { ModelTestResult, ModelUsageRow, ModelUsageWindow, ModelView } from '../types.ts'
import css from '../styles/common.module.css'
import modelsCss from '../styles/models.module.css'
import { Drawer } from '../components/Drawer.tsx'

/** 毫秒 → 展示用秒数（≥10s 取整，否则保留 1 位小数）。 */
function formatDurationSeconds(ms: number): string {
  const seconds = ms / 1000
  return seconds >= 10 ? String(Math.round(seconds)) : seconds.toFixed(1)
}

/** 数量紧凑写法（用量行/表格列：1.2k / 3.4M），与原型同一口径。 */
function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(value)
}

/** 提供方名没有 ASCII 字母时的回落字形（产品缩写，不是可翻译文案）。 */
const FALLBACK_PROVIDER_GLYPH = 'API'

/** 提供方缩写（表格名称列 30px 字形），未知提供方回落到 API。 */
function providerGlyph(provider: string): string {
  const known: Record<string, string> = {
    deepseek: 'DS',
    openai: 'OA',
    anthropic: 'AN',
    ollama: 'OL',
    'openai-compatible': 'OC',
  }
  const letters = known[provider.toLowerCase()]
  if (letters !== undefined) return letters
  const fallback = provider.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()
  return fallback === '' ? FALLBACK_PROVIDER_GLYPH : fallback
}

/** 提供方下拉项：`value` 是后端 PROVIDER 键，显示名走字典（与原型五项同序）。 */
const PROVIDER_OPTIONS = [
  { value: 'deepseek', labelKey: 'providerDeepSeek' },
  { value: 'openai', labelKey: 'providerOpenAI' },
  { value: 'anthropic', labelKey: 'providerAnthropic' },
  { value: 'ollama', labelKey: 'providerOllama' },
  { value: 'openai-compatible', labelKey: 'providerOpenAICompatible' },
] as const

/** 提供方展示名：已知提供方取字典标签，未知值原样呈现（不吞数据）。 */
function providerLabel(provider: string): string {
  const option = PROVIDER_OPTIONS.find(item => item.value === provider.toLowerCase())
  return option === undefined ? provider : t('models', option.labelKey)
}

/** 提供方默认接入地址（与后端 `models.ts` 的 `PROVIDER_DEFAULTS` 同值）。 */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/anthropic',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434/v1',
  'openai-compatible': '',
}

/** 新建模型抽屉的预填参数（原型默认值；编辑既有配置时不套用）。 */
const CREATE_DEFAULTS = {
  provider: 'deepseek',
  temperature: '0.4',
  maxTokens: '8192',
  timeout: '120',
  maxToolCalls: '24',
} as const

/** 提供方默认接入地址；未知提供方回落空串，交由用户填写。 */
function defaultBaseUrl(provider: string): string {
  return PROVIDER_DEFAULT_BASE_URLS[provider] ?? ''
}

/** 地址列展示用短形式：去掉协议与结尾 `/v1`（原型 shortUrl 同一口径）。 */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/v1$/, '')
}

/** 接入地址必须是可解析的 http(s) 网址（空串表示沿用提供方默认地址，另行放行）。 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 渲染模型配置页。
 */
export function ModelsPage() {
  const locale = useLocale()
  const [models, setModels] = useState<ModelView[]>([])
  const [usage, setUsage] = useState<ModelUsageRow[]>([])
  const [usageWindow, setUsageWindow] = useState<ModelUsageWindow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ModelView | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ModelView | null>(null)
  // 测试结果按配置 id 保留：测另一行不会抹掉上一行的结果；`lastTestedId` 只决定顶部提示行点名谁。
  const [testResults, setTestResults] = useState<Record<string, ModelTestResult>>({})
  const [lastTestedId, setLastTestedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // 成功反馈走 Toast（原型 models.js:238/268/282/295/313/339 的 App.toast）。
  const toast = useToastHost()

  // Ctrl/Cmd+K 聚焦搜索（原型 app.js:650-659 的全局快捷键）。
  useSearchShortcut(searchRef)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [modelResult, usageResult] = await Promise.all([
        request<{ ok: true; models: ModelView[] }>('/models'),
        request<{ ok: true; byModel: ModelUsageRow[]; window: ModelUsageWindow }>('/usage'),
      ])
      setModels(modelResult.models)
      setUsage(usageResult.byModel)
      setUsageWindow(usageResult.window)
      setError(null)
    } catch (failure) {
      setError(`${t('models', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword === '') return models
    return models.filter(model =>
      `${model.name} ${model.provider} ${model.model_name}`.toLowerCase().includes(keyword),
    )
  }, [models, search])

  /** 模型配置导出（NFR-OBS-002）：CSV 由后端按配置列生成（含用量聚合），浏览器侧只负责下载。 */
  const exportModels = async (): Promise<void> => {
    try {
      const blob = await requestBlob('/models/export')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'soloengine-models.csv'
      anchor.click()
      // 立即 revoke 会在下载真正取流前撤掉 URL（部分浏览器/下载器直接得到空文件）；
      // 延后释放，页面卸载前足够完成取流。
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
      toast.show(t('models', 'toastExported'), 'success')
    } catch (failure) {
      setError(`${t('models', 'errorExport')} — ${describeError(failure)}`)
    }
  }

  const act = (id: string, action: () => Promise<void>, failureKey: string, successText?: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
        if (successText !== undefined) toast.show(successText, 'success')
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
            <Button variant="outline" icon={<IconDownloadOutlineRegular size={14} />} onClick={() => { void exportModels() }}>
              {t('models', 'usageExport')}
            </Button>
            <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateOpen(true) }}>{t('models', 'create')}</Button>
          </>
        )}
      />

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
      {lastTestedId !== null && (() => {
        // 顶部提示只点名最近一次测试：每行结果按 id 保留在表格里，测另一行不会清空上一行。
        const id = lastTestedId
        const tested = models.find(model => model.id === id)
        const result = testResults[id]
        if (tested === undefined || result === undefined) return null
        // 已归类的失败不再附原始失败链：链里是 `UND_ERR_CONNECT_TIMEOUT` 这类机器码（R8 禁止直出），
        // 归因文案已给出类别；未归类时它是唯一线索，保留。
        const classified = result.kind !== undefined && result.kind !== 'unknown'
        return (
          <NoticeLine
            tone={result.ok ? 'success' : 'error'}
            text={[
              tested.name,
              result.ok ? t('models', 'testOk') : t('models', 'testFail'),
              result.kind === undefined ? null : t('models', kindKey(result.kind)),
              result.latency_ms === undefined ? null : t('models', 'testLatency', { ms: result.latency_ms }),
              result.status === undefined ? null : t('models', 'testStatus', { status: result.status }),
              result.provider === undefined ? null : result.provider,
              classified || result.message === undefined ? null : result.message,
            ].filter(part => part !== null).join(' · ')}
          />
        )
      })()}

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}

      {!loading && (() => {
        // 用量面板遍历**全部模型配置**（原型 models.js:41）：没有调用记录的模型也占一行，
        // 否则新建或未调用的模型在用量图里完全消失。
        const usageById = new Map(usage.map(row => [row.llm_config_id, row]))
        const chartRows: ModelUsageRow[] = models.map(model => usageById.get(model.id) ?? {
          llm_config_id: model.id,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: 0,
          avgMs: 0,
          p50Ms: 0,
          p95Ms: 0,
        })
        // 归一化基线兜底 1（避免除零）；用 reduce 而不是展开传参（行数随模型增长，展开有栈风险）。
        const maxTokens = chartRows.reduce((max, row) => Math.max(max, row.totalTokens), 0) || 1
        const nameOf = (row: ModelUsageRow): string =>
          models.find(model => model.id === row.llm_config_id)?.name ?? row.llm_config_id
        const modelNameOf = (row: ModelUsageRow): string =>
          models.find(model => model.id === row.llm_config_id)?.model_name ?? ''
        const isDefault = (row: ModelUsageRow): boolean =>
          models.find(model => model.id === row.llm_config_id)?.is_default === true
        // R27：tokens 计数千分位**跟随界面语言**（写死 `en-US` 会让中文界面用英文区域取值，属同族缺陷）；
        // count=1 走单数键（复数键会渲染成 "1 tokens"）。
        const tokensText = (row: ModelUsageRow): string => row.totalTokens === 1
          ? t('models', 'usageTokensOne')
          : t('models', 'usageTokens', { count: compactNumber(row.totalTokens) })
        const requestsText = (row: ModelUsageRow): string => row.requests === 1
          ? t('models', 'usageRequestsOne')
          : t('models', 'usageRequests', { count: row.requests.toLocaleString(locale) })
        const latencyText = (row: ModelUsageRow): string | null => row.durationMs <= 0
          ? null
          : t('models', 'usageLatency', {
            avg: formatDurationSeconds(row.avgMs),
            p95: formatDurationSeconds(row.p95Ms),
          })
        // role="img" 的 aria-label 必须带数据摘要（只报标题的话屏幕阅读器听不到任何数值）。
        const summary = chartRows.map(row => `${nameOf(row)} ${tokensText(row)} ${requestsText(row)}`).join('; ')
        return (
          <section className={modelsCss.panel} aria-labelledby="models-usage-title">
            <div className={modelsCss.panelHead}>
              <div>
                <h2 id="models-usage-title" className={modelsCss.panelTitle}>{t('models', 'usageChartTitle')}</h2>
                {usageWindow !== null && (
                  <p className={modelsCss.panelHint}>
                    {t('models', 'usageHint', { limit: usageWindow.limit.toLocaleString(locale) })}
                  </p>
                )}
              </div>
              <span className={modelsCss.count}>
                {t('models', 'usageTotal', {
                  tokens: chartRows.reduce((sum, row) => sum + row.totalTokens, 0).toLocaleString(locale),
                  requests: chartRows.reduce((sum, row) => sum + row.requests, 0).toLocaleString(locale),
                })}
              </span>
            </div>
            <div className={modelsCss.panelBody}>
              {chartRows.length === 0 ? (
                <div className={css.emptyState}>
                  <p className={css.emptyTitle}>{t('models', 'usageEmptyTitle')}</p>
                  <p className={css.emptyDesc}>{t('models', 'usageEmptyDesc')}</p>
                </div>
              ) : (
                <>
                  <div className={modelsCss.chart} role="img" aria-label={`${t('models', 'usageChartTitle')}: ${summary}`}>
                    {chartRows.map((row) => {
                      const latency = latencyText(row)
                      return (
                        <div key={row.llm_config_id} className={modelsCss.chartRow}>
                          <div className={modelsCss.chartTop}>
                            <span className={modelsCss.chartName} title={nameOf(row)}>
                              <span
                                className={isDefault(row) ? `${modelsCss.dot} ${modelsCss.dotAccent}` : modelsCss.dot}
                                aria-hidden="true"
                              />
                              {nameOf(row)}
                            </span>
                            <span className={modelsCss.chartModel}>{modelNameOf(row)}</span>
                            <span className={modelsCss.chartValue}>{tokensText(row)}</span>
                          </div>
                          <div className={modelsCss.chartBar}>
                            <span
                              className={isDefault(row)
                                ? `${modelsCss.chartBarFill} ${modelsCss.chartBarFillAccent}`
                                : modelsCss.chartBarFill}
                              style={{ width: `${Math.max(2, Math.round((row.totalTokens / maxTokens) * 100))}%` }}
                            />
                          </div>
                          <div className={modelsCss.chartMeta}>
                            {requestsText(row)}
                            {latency === null ? '' : ` · ${latency}`}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {usageWindow !== null && usageWindow.total > usageWindow.limit && (
                    <div className={modelsCss.chartNote}>
                      {t('models', 'usageWindow', {
                        limit: usageWindow.limit.toLocaleString(locale),
                        total: usageWindow.total.toLocaleString(locale),
                      })}
                    </div>
                  )}
                  <div className={modelsCss.chartNote}>{t('models', 'usageRule')}</div>
                </>
              )}
            </div>
          </section>
        )
      })()}

      {(!loading || models.length > 0) && (
        <section className={modelsCss.section} aria-labelledby="models-table-title">
          <div className={modelsCss.sectionHead}>
            <div>
              <h2 id="models-table-title" className={modelsCss.sectionTitle}>{t('models', 'tableRegion')}</h2>
              <p className={modelsCss.sectionMeta}>{t('models', 'deleteNote')}</p>
            </div>
            <div className={modelsCss.toolbar}>
              <Input
                ref={searchRef}
                className={modelsCss.search ?? ''}
                type="search"
                icon={<IconSearchOutlineRegular size={16} />}
                value={search}
                placeholder={t('models', 'searchPlaceholder')}
                aria-label={t('models', 'searchAria')}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              <span className={modelsCss.count}>
                {visible.length === 1
                  ? t('models', 'tableCountOne')
                  : t('models', 'tableCount', { count: visible.length.toLocaleString(locale) })}
              </span>
            </div>
          </div>

          {models.length === 0 && (
            <div className={modelsCss.emptyState}>
              <span className={modelsCss.emptyIcon} aria-hidden="true"><IconDataOutlineRegular size={20} /></span>
              <p className={modelsCss.emptyTitle}>{t('models', 'empty')}</p>
              <p className={modelsCss.emptyDesc}>{t('models', 'emptyDesc')}</p>
              <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateOpen(true) }}>
                {t('models', 'create')}
              </Button>
            </div>
          )}

          {models.length > 0 && visible.length === 0 && (
            <div className={modelsCss.emptyState}>
              <span className={modelsCss.emptyIcon} aria-hidden="true"><IconDataOutlineRegular size={20} /></span>
              <p className={modelsCss.emptyTitle}>{t('models', 'noMatch')}</p>
              <p className={modelsCss.emptyDesc}>{t('models', 'emptyDesc')}</p>
              <div className={modelsCss.emptyActions}>
                <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateOpen(true) }}>
                  {t('models', 'create')}
                </Button>
              </div>
            </div>
          )}

          {visible.length > 0 && (
            <div className={modelsCss.tableWrap} tabIndex={0} role="region" aria-label={t('models', 'tableRegion')}>
              {/* 窄视口下表格在包装内横向滚动（720px 断点）：可滚动区域必须可用键盘操作，
                  否则只用鼠标能看到右侧列（WCAG 2.1.1）。region 名走字典，不硬编码。 */}
              <table className={modelsCss.table}>
                <thead>
                  <tr>
                    <th scope="col" className={modelsCss.colName}>{t('models', 'tableName')}</th>
                    <th scope="col" className={modelsCss.colNowrap}>{t('models', 'tableProvider')}</th>
                    <th scope="col" className={modelsCss.colNowrap}>{t('models', 'tableModel')}</th>
                    <th scope="col" className={modelsCss.colWide}>{t('models', 'tableBaseUrl')}</th>
                    <th scope="col">{t('models', 'tableDefault')}</th>
                    <th scope="col">{t('models', 'tableActive')}</th>
                    <th scope="col" className={modelsCss.colUsage}>{t('models', 'tableUsage')}</th>
                    <th scope="col" className={modelsCss.colActions}>{t('common', 'labelAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((model) => {
                    const row = usage.find(item => item.llm_config_id === model.id)
                    const tested = testResults[model.id] ?? null
                    const testing = busyId === model.id
                    const testIcon = tested === null
                      ? <IconGaugeOutlineRegular size={14} />
                      : tested.ok ? <IconCheckOutlineRegular size={14} /> : <IconWarningOutlineRegular size={14} />
                    const testLabel = testing
                      ? t('models', 'testing')
                      : tested === null
                        ? t('common', 'actionTest')
                        : tested.ok
                          ? `${t('models', 'testOk')}${tested.latency_ms === undefined ? '' : ` · ${t('models', 'testLatency', { ms: tested.latency_ms })}`}`
                          : t('models', 'testFail')
                    return (
                      <tr key={model.id}>
                        <td className={modelsCss.colName}>
                          <div className={modelsCss.nameCell}>
                            <span className={modelsCss.glyph} aria-hidden="true">{providerGlyph(model.provider)}</span>
                            <div className={modelsCss.nameText}>
                              <span className={modelsCss.nameTitle} title={model.name}>{model.name}</span>
                              <span className={modelsCss.nameSub}>
                                {t('models', 'rowParams', {
                                  temperature: model.temperature === null ? '—' : String(model.temperature),
                                  tokens: model.max_tokens === null ? '—' : model.max_tokens.toLocaleString(locale),
                                })}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className={modelsCss.colNowrap} title={providerLabel(model.provider)}>{providerLabel(model.provider)}</td>
                        <td className={`${modelsCss.colNowrap} ${modelsCss.mono}`} title={model.model_name}>{model.model_name}</td>
                        <td className={modelsCss.mono}>
                          {model.base_url === null || model.base_url === ''
                            ? t('common', 'labelNone')
                            : (
                              <span className={modelsCss.urlText} title={model.base_url}>
                                {shortUrl(model.base_url)}
                              </span>
                            )}
                        </td>
                        <td>
                          {model.is_default
                            ? (
                              <Tag tone="info" className={`${modelsCss.badgeAccent} ${css.statusTag}`}>
                                <span className={modelsCss.badgeDot} aria-hidden="true" />
                                {t('common', 'stateDefault')}
                              </Tag>
                            )
                            : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={modelsCss.toggle}
                            aria-pressed={model.is_active}
                            disabled={busyId === model.id}
                            onClick={() => {
                              act(model.id, async () => {
                                await request(`/models/${model.id}/active`, {
                                  method: 'POST',
                                  body: { active: !model.is_active },
                                })
                                await load()
                              }, 'errorSave', model.is_active
                                ? t('models', 'toastDisabled', { name: model.name })
                                : t('models', 'toastEnabled', { name: model.name }))
                            }}
                          >
                            <span
                              className={model.is_active ? `${modelsCss.toggleDot} ${modelsCss.toggleDotOn}` : modelsCss.toggleDot}
                              aria-hidden="true"
                            />
                            {model.is_active ? t('common', 'stateActive') : t('common', 'stateInactive')}
                          </button>
                        </td>
                        <td className={modelsCss.colUsage}>
                          {row === undefined
                            ? '—'
                            : (
                              <span className={modelsCss.usageMini}>
                                <span>
                                  {row.totalTokens === 1
                                    ? t('models', 'usageTokensOne')
                                    : t('models', 'usageTokens', { count: compactNumber(row.totalTokens) })}
                                </span>
                                <span className={modelsCss.usageSub}>
                                  {row.requests === 1
                                    ? t('models', 'usageRequestsOne')
                                    : t('models', 'usageRequests', { count: row.requests.toLocaleString(locale) })}
                                </span>
                              </span>
                            )}
                        </td>
                        <td className={modelsCss.colActions}>
                          <div className={modelsCss.rowActions}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={modelsCss.testButton}
                              icon={testing ? <span className={css.spinner} aria-hidden="true" /> : testIcon}
                              disabled={testing}
                              aria-busy={testing}
                              aria-label={t('models', 'testAria', { name: model.name })}
                              onClick={() => {
                                setBusyId(model.id)
                                setError(null)
                                void (async () => {
                                  try {
                                    const result = await request<{ ok: true; result: ModelTestResult }>(
                                      `/models/${model.id}/test`,
                                      { method: 'POST' },
                                    )
                                    setTestResults(previous => ({ ...previous, [model.id]: result.result }))
                                    setLastTestedId(model.id)
                                    // 原型 models.js:268 只对成功的连通性测试弹 Toast；失败留在页内结果行。
                                    if (result.result.ok) {
                                      toast.show(
                                        result.result.latency_ms === undefined
                                          ? t('models', 'testOk')
                                          : t('models', 'toastTestOk', { ms: result.result.latency_ms }),
                                        'success',
                                      )
                                    }
                                  } catch (failure) {
                                    setError(`${t('models', 'errorTest')} — ${describeError(failure)}`)
                                  } finally {
                                    setBusyId(null)
                                  }
                                })()
                              }}
                            >
                              {testLabel}
                            </Button>
                            <Menu
                              open={menuId === model.id}
                              align="end"
                              portal
                              items={[
                                { id: 'edit', label: t('models', 'editAction'), disabled: busyId === model.id },
                                { id: 'default', label: t('models', 'setDefault'), disabled: busyId === model.id || model.is_default },
                                {
                                  id: 'toggle',
                                  label: model.is_active ? t('models', 'disable') : t('models', 'enable'),
                                  disabled: busyId === model.id,
                                },
                                { type: 'separator', id: 'separator' },
                                { id: 'delete', label: t('models', 'deleteAction'), danger: true, disabled: busyId === model.id },
                              ]}
                              onSelect={(id) => {
                                setMenuId(null)
                                if (id === 'edit') setEditTarget(model)
                                if (id === 'default') {
                                  act(model.id, async () => {
                                    await request(`/models/${model.id}/default`, { method: 'POST' })
                                    await load()
                                  }, 'errorSave', t('models', 'toastDefault', { name: model.name }))
                                }
                                if (id === 'toggle') {
                                  act(model.id, async () => {
                                    await request(`/models/${model.id}/active`, {
                                      method: 'POST',
                                      body: { active: !model.is_active },
                                    })
                                    await load()
                                  }, 'errorSave', model.is_active
                                    ? t('models', 'toastDisabled', { name: model.name })
                                    : t('models', 'toastEnabled', { name: model.name }))
                                }
                                if (id === 'delete') setDeleteTarget(model)
                              }}
                              onClose={() => { setMenuId(null) }}
                              anchor={(
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={modelsCss.moreButton}
                                  icon={<IconEllipsisOutlineRegular size={14} />}
                                  aria-label={t('models', 'moreActions')}
                                  disabled={busyId === model.id}
                                  onClick={() => { setMenuId(menuId === model.id ? null : model.id) }}
                                />
                              )}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ModelFormDialog
        open={createOpen || editTarget !== null}
        target={editTarget}
        onClose={() => { setCreateOpen(false); setEditTarget(null) }}
        onSaved={() => {
          toast.show(t('models', editTarget === null ? 'toastCreated' : 'toastSaved'), 'success')
          setCreateOpen(false)
          setEditTarget(null)
          void load()
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null) }}
        title={t('models', 'deleteTitle', { name: deleteTarget?.name ?? '' })}
        closeLabel={t('common', 'actionClose')}
        description={`${t('models', 'deleteNote')}${t('models', 'deleteIrreversible')}`}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={css.dangerButton}
              disabled={deleteTarget === null || busyId === deleteTarget.id}
              onClick={() => {
                const target = deleteTarget
                if (target === null) return
                act(target.id, async () => {
                  await request(`/models/${target.id}`, { method: 'DELETE' })
                  setDeleteTarget(null)
                  await load()
                }, 'errorDelete', t('models', 'toastDeleted'))
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

/** 可空数值字段的输入值：新建时 null 用默认值，编辑时 null 留空。 */
function numericInput(value: number | null | undefined, fallback: string): string {
  if (value === null || value === undefined) return fallback
  return String(value)
}

/** 数字字段的可空输入。 */
function numberField(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 新建 / 编辑模型配置对话框。 */
function ModelFormDialog({ open, target, onClose, onSaved }: {
  open: boolean
  target: ModelView | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('deepseek')
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
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
  // 字段级错误就地挂在对应控件下（原型 `.field-error` 的同一语义）。
  const [nameError, setNameError] = useState<string | null>(null)
  const [modelNameError, setModelNameError] = useState<string | null>(null)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)
  // 版本冲突后就地取一次最新版本：用户不必关掉对话框重进即可原地重试。
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  /** 抽屉里的「设为默认」勾选项（已默认的模型保持勾选且不可更改）。 */
  const [setDefault, setSetDefault] = useState(false)

  useEffect(() => {
    // 新建套用原型默认值（可编辑）；编辑既有配置时一律回显存储值，null 字段留空而非套默认。
    setName(target?.name ?? '')
    setProvider(target?.provider ?? CREATE_DEFAULTS.provider)
    setModelName(target?.model_name ?? '')
    setApiKey('')
    setClearKey(false)
    setBaseUrl(target?.base_url ?? defaultBaseUrl(CREATE_DEFAULTS.provider))
    setIsFullUrl(target?.is_full_url ?? false)
    const createFallback = target === null
    setTemperature(numericInput(target?.temperature, createFallback ? CREATE_DEFAULTS.temperature : ''))
    setMaxTokens(numericInput(target?.max_tokens, createFallback ? CREATE_DEFAULTS.maxTokens : ''))
    setMaxInputTokens(numericInput(target?.max_input_tokens, ''))
    setMaxOutputTokens(numericInput(target?.max_output_tokens, ''))
    setTopP(numericInput(target?.top_p, ''))
    setFrequencyPenalty(numericInput(target?.frequency_penalty, ''))
    setPresencePenalty(numericInput(target?.presence_penalty, ''))
    setTimeoutValue(numericInput(target?.timeout, createFallback ? CREATE_DEFAULTS.timeout : ''))
    setMaxToolCalls(numericInput(target?.max_tool_calls, createFallback ? CREATE_DEFAULTS.maxToolCalls : ''))
    setExtraParams(target?.extra_params ?? '')
    setLatestVersion(null)
    setSetDefault(target?.is_default ?? false)
    setError(null)
    setNameError(null)
    setModelNameError(null)
    setBaseUrlError(null)
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

  const submit = (): void => {
    if (busy) return
    const nextNameError = name.trim() === '' ? t('models', 'errorNameRequired') : null
    const nextModelNameError = modelName.trim() === '' ? t('models', 'errorModelNameRequired') : null
    const nextBaseUrlError = baseUrl.trim() !== '' && !isHttpUrl(baseUrl.trim()) ? t('models', 'errorBaseUrl') : null
    setNameError(nextNameError)
    setModelNameError(nextModelNameError)
    setBaseUrlError(nextBaseUrlError)
    if (nextNameError !== null || nextModelNameError !== null || nextBaseUrlError !== null) return
    // 数字字段合法性前置校验：numberField 曾把非法输入（如 "abc"）静默变成
    // undefined 丢弃——用户以为保存了值，实际字段缺失（违反「不静默」）。
    const numericInputs = [
      temperature, maxTokens, maxInputTokens, maxOutputTokens, topP,
      frequencyPenalty, presencePenalty, timeout, maxToolCalls,
    ]
    if (numericInputs.some(value => value.trim() !== '' && !Number.isFinite(Number(value.trim())))) {
      setError(t('models', 'errorNumeric'))
      return
    }
    // 扩展参数同处前置校验（判据与字段提示语一致）：直出后端的
    // `extra_params is not valid JSON: SyntaxError: …` 是实现细节直出（R8）。
    const extra = extraParams.trim()
    if (extra !== '') {
      let parsedExtra: unknown
      try {
        parsedExtra = JSON.parse(extra)
      } catch {
        parsedExtra = null
      }
      if (parsedExtra === null || typeof parsedExtra !== 'object' || Array.isArray(parsedExtra)) {
        setError(t('models', 'errorJson'))
        return
      }
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
    if (apiKey !== '' && !clearKey) body.api_key = apiKey
    // 清除已保存密钥是独立动作：空串表示「不修改」，不能兼作「清空」。
    if (clearKey) body.clear_api_key = true
    if (baseUrl.trim() !== '') body.base_url = baseUrl.trim()
    if (extraParams.trim() !== '') body.extra_params = extraParams.trim()
    if (target !== null) body.version = latestVersion ?? target.version
    void (async () => {
      try {
        const saved = target === null
          ? await request<{ ok: true; model: ModelView }>('/models', { method: 'POST', body })
          : await request<{ ok: true; model: ModelView }>(`/models/${target.id}`, { method: 'PATCH', body })
        // 默认模型是独立动作（同一时刻只有一个默认）：保存后按开关结果落一次。
        if (setDefault && !saved.model.is_default) {
          await request(`/models/${saved.model.id}/default`, { method: 'POST' })
        }
        onSaved()
      } catch (failure) {
        // 错误就近呈现在对话框内（带本地化前缀）；不再向页面级重复投递（会被 Modal 遮挡）。
        // 版本冲突另有既定产品文案（含「刷新后重试」出路）：直出后端英文串会把配置 id 与
        // 版本号这类实现细节推给用户（R8/R17）。
        const conflict = failure instanceof ApiError && failure.code === 'VERSION_CONFLICT'
        // 区间越界也用产品文案：后端明细是英文实现串（R8 不直出）。
        const rangeError = failure instanceof ApiError && failure.code === 'INVALID_NUMERIC'
        setError(conflict
          ? t('models', 'versionConflict')
          : rangeError
            ? t('models', 'errorNumericRange')
            : `${t('models', 'errorSave')} — ${describeError(failure)}`)
        if (conflict && target !== null) {
          try {
            const fresh = await request<{ ok: true; models: ModelView[] }>('/models')
            const row = fresh.models.find(model => model.id === target.id)
            if (row !== undefined) setLatestVersion(row.version)
          } catch {
            // 取不到最新版本时保留原提示，用户仍可关闭对话框重进。
          }
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={target === null ? t('models', 'createTitle') : t('models', 'editTitle')}
      description={target === null ? t('models', 'createDesc') : t('models', 'editDesc')}
      closeLabel={t('common', 'actionClose')}
      className={modelsCss.drawer}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            type="submit"
            form="model-form"
            variant="primary"
            disabled={busy}
            aria-busy={busy}
            icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
          >
            {busy
              ? t('common', 'stateSaving')
              : target === null ? t('models', 'createSubmit') : t('common', 'actionSave')}
          </Button>
        </>
      )}
    >
      <form
        id="model-form"
        className={css.form}
        noValidate
        onSubmit={(event) => { event.preventDefault(); submit() }}
        onKeyDown={submitFormOnEnter}
      >
        <NoticeLine tone="error" text={error} />
        <div className={modelsCss.formGrid}>
          <div className={modelsCss.fieldFull}>
            <Field label={t('models', 'fieldName')} error={nameError}>
              <Input
                data-modal-autofocus
                aria-invalid={nameError === null ? undefined : true}
                value={name}
                onChange={(event) => { setName(event.currentTarget.value); setNameError(null) }}
              />
            </Field>
          </div>
          <Field label={t('models', 'fieldProvider')}>
            <select
              className={modelsCss.select}
              value={provider}
              onChange={(event) => {
                const next = event.currentTarget.value
                // 新建时地址跟随提供方默认值；用户改过地址后不再覆盖（默认值必须可编辑）。
                if (target === null && (baseUrl.trim() === '' || baseUrl === defaultBaseUrl(provider))) {
                  setBaseUrl(defaultBaseUrl(next))
                }
                setProvider(next)
              }}
            >
              {PROVIDER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{t('models', option.labelKey)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('models', 'fieldModelName')} error={modelNameError}>
            <Input
              aria-invalid={modelNameError === null ? undefined : true}
              placeholder={t('models', 'modelNamePlaceholder')}
              value={modelName}
              onChange={(event) => { setModelName(event.currentTarget.value); setModelNameError(null) }}
            />
          </Field>
          <div className={modelsCss.fieldFull}>
            <Field label={t('models', 'fieldBaseUrl')} hint={t('models', 'fieldBaseUrlHint')} error={baseUrlError}>
              <Input
                aria-invalid={baseUrlError === null ? undefined : true}
                value={baseUrl}
                onChange={(event) => { setBaseUrl(event.currentTarget.value); setBaseUrlError(null) }}
              />
            </Field>
          </div>
          <div className={modelsCss.fieldFull}>
            <label className={css.checkRow}>
              <input
                className={css.checkInput}
                type="checkbox"
                checked={isFullUrl}
                onChange={(event) => { setIsFullUrl(event.currentTarget.checked) }}
              />
              <span>{t('models', 'fieldIsFullUrl')}</span>
            </label>
          </div>
          <div className={modelsCss.fieldFull}>
            <Field
              label={t('models', 'fieldApiKey')}
              hint={target === null
                ? (apiKey === '' ? `${t('models', 'fieldApiKeyHint')} · ${t('models', 'secretEmptyHint')}` : t('models', 'fieldApiKeyHint'))
                : [
                  t('models', 'fieldApiKeyHint'),
                  target.key_state === 'unreadable' ? t('models', 'secretUnreadable') : target.api_key_masked ?? t('models', 'secretAbsent'),
                ].join(' · ')}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                disabled={clearKey}
                placeholder={target === null ? t('models', 'secretPlaceholderNew') : t('models', 'secretPlaceholder')}
                onChange={(event) => { setApiKey(event.currentTarget.value) }}
              />
              {target !== null && target.has_api_key && (
                <label className={css.checkRow}>
                  <input
                    className={css.checkInput}
                    type="checkbox"
                    checked={clearKey}
                    onChange={(event) => {
                      setClearKey(event.currentTarget.checked)
                      if (event.currentTarget.checked) setApiKey('')
                    }}
                  />
                  <span>{t('models', 'fieldApiKeyClear')}</span>
                </label>
              )}
            </Field>
          </div>
          {/* 原型首屏字段顺序（models.js:139-148）：温度 / max_tokens / 超时 / 轮次上限。
              数值输入用原生 number + min/max/step 做第一道约束，区间与 `models.ts` 的
              NUMERIC_LIMITS 同值；后端校验仍是最终守卫。 */}
          <Field label={t('models', 'fieldTemperature')}>
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => { setTemperature(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('models', 'fieldMaxTokens')}>
            <Input
              type="number"
              min={1}
              step={1}
              value={maxTokens}
              onChange={(event) => { setMaxTokens(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('models', 'fieldTimeout')}>
            <Input
              type="number"
              min={1}
              max={600}
              step={1}
              value={timeout}
              onChange={(event) => { setTimeoutValue(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('models', 'fieldMaxToolCalls')}>
            <Input
              type="number"
              min={1}
              step={1}
              value={maxToolCalls}
              onChange={(event) => { setMaxToolCalls(event.currentTarget.value) }}
            />
          </Field>
          <div className={modelsCss.fieldFull}>
            <label className={css.checkRow}>
              <input
                className={css.checkInput}
                type="checkbox"
                checked={setDefault}
                disabled={target?.is_default === true}
                onChange={(event) => { setSetDefault(event.currentTarget.checked) }}
              />
              <span>{t('models', 'fieldDefault')}</span>
            </label>
          </div>
        </div>
        {/* PRD-03 §3 的扩展参数独立成组：原型首屏保持原样，额外字段在下方分节呈现。 */}
        <section className={modelsCss.advanced} aria-labelledby="model-advanced-title">
          <div className={modelsCss.advancedHead}>
            <h3 id="model-advanced-title" className={modelsCss.advancedTitle}>{t('models', 'advancedTitle')}</h3>
            <p className={modelsCss.advancedHint}>{t('models', 'advancedHint')}</p>
          </div>
          <div className={modelsCss.advancedGroup}>
            <h4 className={modelsCss.advancedGroupTitle}>{t('models', 'advancedLimits')}</h4>
            <div className={modelsCss.formGrid}>
              <Field label={t('models', 'fieldMaxInputTokens')}>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={maxInputTokens}
                  onChange={(event) => { setMaxInputTokens(event.currentTarget.value) }}
                />
              </Field>
              <Field label={t('models', 'fieldMaxOutputTokens')}>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={maxOutputTokens}
                  onChange={(event) => { setMaxOutputTokens(event.currentTarget.value) }}
                />
              </Field>
            </div>
          </div>
          <div className={modelsCss.advancedGroup}>
            <h4 className={modelsCss.advancedGroupTitle}>{t('models', 'advancedSampling')}</h4>
            <div className={modelsCss.formGrid}>
              <Field label={t('models', 'fieldTopP')}>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={topP}
                  onChange={(event) => { setTopP(event.currentTarget.value) }}
                />
              </Field>
              <Field label={t('models', 'fieldFrequencyPenalty')}>
                <Input
                  type="number"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={frequencyPenalty}
                  onChange={(event) => { setFrequencyPenalty(event.currentTarget.value) }}
                />
              </Field>
              <Field label={t('models', 'fieldPresencePenalty')}>
                <Input
                  type="number"
                  min={-2}
                  max={2}
                  step={0.1}
                  value={presencePenalty}
                  onChange={(event) => { setPresencePenalty(event.currentTarget.value) }}
                />
              </Field>
            </div>
          </div>
          <div className={modelsCss.advancedGroup}>
            <h4 className={modelsCss.advancedGroupTitle}>{t('models', 'advancedExtra')}</h4>
            <Field label={t('models', 'fieldExtraParams')} hint={t('models', 'fieldExtraParamsHint')}>
              <textarea
                className={`${css.textarea} ${css.textareaMono}`}
                value={extraParams}
                onChange={(event) => { setExtraParams(event.currentTarget.value) }}
              />
            </Field>
          </div>
        </section>
      </form>
    </Drawer>
  )
}
