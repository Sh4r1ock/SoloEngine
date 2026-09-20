/** 市场页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Menu, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import type { MarketEntry } from '../types.ts'
import css from '../styles/common.module.css'

/** 排序键。 */
type SortKey = 'featured' | 'installs' | 'name'

/**
 * 渲染市场页。
 */
export function MarketPage() {
  useLocale()
  const [kind, setKind] = useState<'skill' | 'mcp'>('skill')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('featured')
  const [featuredOnly, setFeaturedOnly] = useState(false)
  const [entries, setEntries] = useState<MarketEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await request<{ ok: true; entries: MarketEntry[]; total: number }>('/market', {
        query: {
          kind,
          ...(search.trim() === '' ? {} : { q: search.trim() }),
          ...(category === null ? {} : { category }),
          sort,
          ...(featuredOnly ? { featured: true } : {}),
        },
      })
      setEntries(result.entries)
      setTotal(result.total)
      setError(null)
    } catch (failure) {
      setError(`${t('market', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [kind, search, category, sort, featuredOnly])

  useEffect(() => { void load() }, [load])

  const categories = useMemo(() => {
    const values = new Set<string>()
    for (const entry of entries) for (const item of entry.categories) values.add(item)
    return [...values].sort()
  }, [entries])

  const sortLabel = sort === 'installs'
    ? t('market', 'sortInstalls')
    : sort === 'name' ? t('market', 'sortName') : t('market', 'sortFeatured')

  return (
    <div className={css.page}>
      <PageHeader
        title={t('market', 'title')}
        subtitle={t('market', 'subtitle')}
        actions={<Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>}
      />

      <div className={css.toolbar}>
        <Pill active={kind === 'skill'} onClick={() => { setKind('skill') }}>{t('market', 'kindSkill')}</Pill>
        <Pill active={kind === 'mcp'} onClick={() => { setKind('mcp') }}>{t('market', 'kindMcp')}</Pill>
        <Input
          value={search}
          placeholder={t('market', 'searchPlaceholder')}
          onChange={event => { setSearch(event.currentTarget.value) }}
        />
        <span className={css.fieldHint}>{t('market', 'sortLabel')}</span>
        <Menu
          open={sortMenuOpen}
          items={[
            { id: 'featured', label: t('market', 'sortFeatured') },
            { id: 'installs', label: t('market', 'sortInstalls') },
            { id: 'name', label: t('market', 'sortName') },
          ]}
          selectedId={sort}
          onSelect={id => {
            setSort(id === 'installs' ? 'installs' : id === 'name' ? 'name' : 'featured')
            setSortMenuOpen(false)
          }}
          onClose={() => { setSortMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setSortMenuOpen(!sortMenuOpen) }}>{sortLabel}</Button>}
        />
        <Pill active={featuredOnly} onClick={() => { setFeaturedOnly(!featuredOnly) }}>{t('market', 'featuredOnly')}</Pill>
      </div>

      <div className={css.toolbar}>
        <span className={css.fieldHint}>{t('market', 'categoryLabel')}</span>
        <Pill active={category === null} onClick={() => { setCategory(null) }}>{t('market', 'categoryAll')}</Pill>
        {categories.map(item => (
          <Pill key={item} active={category === item} onClick={() => { setCategory(item) }}>{item}</Pill>
        ))}
        <span className={css.toolbarSpacer} />
        <span className={css.fieldHint}>{t('market', 'totalEntries', { count: total })}</span>
      </div>

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
      <NoticeLine tone="success" text={notice} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && entries.length === 0 && <div className={css.empty}>{t('market', 'empty')}</div>}

      <div className={css.cardGrid}>
        {entries.map(entry => (
          <article key={entry.id} className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.iconBlock}>{entry.name.slice(0, 1)}</span>
              <div className={css.cardTitleBlock}>
                <h2 className={css.cardTitle}>{entry.name}</h2>
                <span className={css.cardMeta}>
                  {t('common', 'labelVersion')} {entry.version}
                  {' · '}
                  {t('market', 'authorLabel')} {entry.author}
                  {' · '}
                  {t('market', 'entryInstalls', { count: entry.installs })}
                </span>
              </div>
            </div>
            <div className={css.cardBody}>{entry.description}</div>
            <div className={css.chipRow}>
              <Tag tone={entry.kind === 'skill' ? 'info' : 'neutral'}>
                {entry.kind === 'skill' ? t('market', 'kindSkill') : t('market', 'kindMcp')}
              </Tag>
              {entry.featured && <Tag tone="solid">{t('market', 'sortFeatured')}</Tag>}
              {entry.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
            <div className={css.definition}>
              <span className={css.definitionLabel}>{t('market', 'sourceLabel')}</span>
              <span className={css.definitionValue}>{entry.source}</span>
              <span className={css.definitionLabel}>{t('market', 'categoriesLabel')}</span>
              <span className={css.definitionValue}>
                {entry.categories.length === 0 ? t('common', 'labelNone') : entry.categories.join(' / ')}
              </span>
            </div>
            <div className={css.cardActions}>
              <Button
                size="sm"
                variant="primary"
                disabled={installing === entry.id}
                onClick={() => {
                  setInstalling(entry.id)
                  setError(null)
                  void (async () => {
                    try {
                      await request(`/market/${entry.id}/install`, { method: 'POST' })
                      setNotice(t('market', 'installSuccess', { name: entry.name }))
                      await load()
                    } catch (failure) {
                      setError(`${t('market', 'errorInstall')} — ${describeError(failure)}`)
                    } finally {
                      setInstalling(null)
                    }
                  })()
                }}
              >
                {installing === entry.id ? t('market', 'installing') : t('market', 'install')}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
