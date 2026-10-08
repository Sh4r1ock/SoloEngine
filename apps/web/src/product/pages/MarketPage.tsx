/** 市场页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Menu, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { PathValue } from '../components/PathValue.tsx'
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
  // 搜索输入与生效值分离：`load` 依赖 search，不分离时每个按键都会重跑一次请求；
  // 停顿 300ms 才把输入落到 search（实测连打 4 键只发 1 个 /market 请求）。
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('featured')
  const [featuredOnly, setFeaturedOnly] = useState(false)
  const [entries, setEntries] = useState<MarketEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // 错误来源必须区分：「重试」这一行内动作做的是重新拉取列表，只对列表加载失败成立。
  // 安装失败时挂同一个按钮会把用户引向「刷新列表」（实测语义错位：安装 409 后点重试
  // 只会重发 GET /market），而正确的出路就是卡片上重新可点的「安装」按钮本身。
  const [error, setError] = useState<{ text: string; listFailed: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  // 全站唯一的在途请求：`load` 既被 effect（筛选变化）调用，也被「刷新」按钮与
  // 错误行的「重试」直接调用。只给 effect 那条路挂 signal 时，直接调用的请求既不参与
  // 中止也不讲顺序（实测：刷新→立刻切 MCP，被延迟 1.5s 的 skill 响应后到，
  // 把 mcp 结果整片覆盖成技能条目，而分类药丸已显示 MCP）。故中止权收归一个 ref。
  const controllerRef = useRef<AbortController | null>(null)

  // 安装按钮的在途集合：一次安装不冻结其他条目，但同一条目在途期间必须禁用（R26）。
  const [installing, setInstalling] = useState<Set<string>>(() => new Set<string>())

  const markInstalling = (id: string, on: boolean): void => {
    setInstalling((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const load = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
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
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setEntries(result.entries)
      setTotal(result.total)
      setError(null)
    } catch (failure) {
      // 只吞「本次请求已被更新的一轮筛选/刷新中止」这一种情况：中止信息由自己的
      // controller 判定，不能用 status===0 代替——网络不可达/离线同样是 status 0，
      // 一并吞掉会让用户看到一份没有任何说明的过期列表（R31 离线可见性 / R24 恢复路径）。
      if (controller.signal.aborted) return
      setError({
        text: `${t('market', 'errorLoad')} — ${describeError(failure)}`,
        listFailed: true,
      })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [kind, search, category, sort, featuredOnly])

  // 筛选条件（kind/搜索/分类/排序/精选）任一变化 → 中止上一请求再发起新请求：
  // 无中止时快速连续切换会用「后返回的旧响应」覆盖新结果（边界条件竞态）。
  useEffect(() => {
    void load()
    return () => { controllerRef.current?.abort() }
  }, [load])

  // 搜索防抖：输入停顿 300ms 才生效。
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput) }, 300)
    return () => { clearTimeout(timer) }
  }, [searchInput])

  const categories = useMemo(() => {
    const values = new Set<string>()
    for (const entry of entries) for (const item of entry.categories) values.add(item)
    return [...values].sort()
  }, [entries])

  // 分类候选来自「当前结果集」：结果被分类本身收窄后，该分类就会从这一行消失，
  // 而它仍在生效（实测 documentation + 只看精选 → 0 条、行内只剩「全部分类」、
  // 用户看不到自己被套在哪一层筛选上）。已生效的分类必须始终可见、可撤销。
  const categoryOptions = useMemo(() => (
    category === null || categories.includes(category)
      ? categories
      : [...categories, category].sort()
  ), [categories, category])

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
        {/* 原生 Pill 只把选中态写成 class（`_active_`），辅助技术读不到状态（WCAG 4.1.2）。
            Pill 透传 ButtonHTMLAttributes，故产品层补 aria-pressed（原生包禁改）。 */}
        <Pill active={kind === 'skill'} aria-pressed={kind === 'skill'} onClick={() => { setKind('skill') }}>{t('market', 'kindSkill')}</Pill>
        <Pill active={kind === 'mcp'} aria-pressed={kind === 'mcp'} onClick={() => { setKind('mcp') }}>{t('market', 'kindMcp')}</Pill>
        {/* 搜索框只有 placeholder：placeholder 在输入后消失，可访问名必须常驻（WCAG 3.3.2），
            原生 Input 透传 input 属性，故产品层补 aria-label（原生包禁改）。 */}
        <Input
          className={css.toolbarSearch ?? ''}
          value={searchInput}
          placeholder={t('market', 'searchPlaceholder')}
          aria-label={t('market', 'searchAria')}
          onChange={(event) => { setSearchInput(event.currentTarget.value) }}
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
          onSelect={(id) => {
            setSort(id === 'installs' ? 'installs' : id === 'name' ? 'name' : 'featured')
            setSortMenuOpen(false)
          }}
          onClose={() => { setSortMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setSortMenuOpen(!sortMenuOpen) }}>{sortLabel}</Button>}
        />
        <Pill active={featuredOnly} aria-pressed={featuredOnly} onClick={() => { setFeaturedOnly(!featuredOnly) }}>{t('market', 'featuredOnly')}</Pill>
      </div>

      <div className={css.toolbar}>
        <span className={css.fieldHint}>{t('market', 'categoryLabel')}</span>
        <Pill active={category === null} aria-pressed={category === null} onClick={() => { setCategory(null) }}>{t('market', 'categoryAll')}</Pill>
        {categoryOptions.map(item => (
          <Pill key={item} active={category === item} aria-pressed={category === item} onClick={() => { setCategory(item) }}>{item}</Pill>
        ))}
        <span className={css.toolbarSpacer} />
        <span className={css.fieldHint}>{total === 1 ? t('market', 'totalEntriesOne') : t('market', 'totalEntries', { count: total })}</span>
      </div>

      <NoticeLine
        tone="error"
        text={error === null ? null : error.text}
        {...(error !== null && error.listFailed
          ? { action: { label: t('common', 'actionRetry'), onClick: (): void => { void load() } } }
          : {})}
      />
      <NoticeLine tone="success" text={notice} />

      {/* 加载行与列表互斥地占同一个位置：两条并列时，118px 高的加载行会把仍可见的卡片
          整体推下去（实测筛选时卡片 y 216 → 358，回弹 142px，R1 非预期位移）。
          已有内容时不再插行，只在首屏（还没有任何条目）时显示加载态。 */}
      {loading && entries.length === 0 && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && entries.length === 0 && <div className={css.empty}>{t('market', 'empty')}</div>}

      <div className={css.cardGrid}>
        {entries.map(entry => (
          <article key={entry.id} className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.iconBlock}>{entry.name.slice(0, 1)}</span>
              <div className={css.cardTitleBlock}>
                <h2 className={css.cardTitle}>{entry.name}</h2>
                <span className={css.cardMeta}>
                  <span className={css.nowrap}>{t('common', 'labelVersion')} {entry.version}</span>
                  {' · '}
                  <span className={css.nowrap}>{t('market', 'authorLabel')} {entry.author}</span>
                  {' · '}
                  <span className={css.nowrap}>{entry.installs === 1 ? t('market', 'entryInstallsOne') : t('market', 'entryInstalls', { count: entry.installs })}</span>
                </span>
              </div>
            </div>
            {/* 描述为空时整行省略：空行会让同一网格行的卡片体留出无意义空洞（与 MCP/技能页同一规则）。 */}
            {entry.description !== ''
              ? <div className={css.cardBody}>{entry.description}</div>
              : null}
            <div className={css.chipRow}>
              <Tag tone={entry.kind === 'skill' ? 'info' : 'neutral'} className={css.statusTag}>
                {entry.kind === 'skill' ? t('market', 'kindSkill') : t('market', 'kindMcp')}
              </Tag>
              {entry.featured && <Tag tone="solid">{t('market', 'featuredBadge')}</Tag>}
              {entry.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
            <div className={css.definition}>
              <span className={css.definitionLabel}>{t('market', 'sourceLabel')}</span>
              <span className={css.definitionValue}><PathValue value={entry.source} /></span>
              <span className={css.definitionLabel}>{t('market', 'categoriesLabel')}</span>
              <span className={css.definitionValue}>
                {entry.categories.length === 0 ? t('common', 'labelNone') : entry.categories.join(' / ')}
              </span>
            </div>
            <div className={css.cardActions}>
              <Button
                size="sm"
                variant="primary"
                disabled={installing.has(entry.id)}
                aria-label={t('market', 'installAria', { name: entry.name })}
                onClick={() => {
                  markInstalling(entry.id, true)
                  setError(null)
                  // 成功提示只描述上一次动作：本次安装起手即作废上一条「已安装」（O-S10-1）。
                  setNotice(null)
                  void (async () => {
                    try {
                      await request(`/market/${entry.id}/install`, { method: 'POST' })
                      setNotice(t('market', 'installSuccess', { name: entry.name }))
                      await load()
                    } catch (failure) {
                      setError({
                        text: failure instanceof ApiError && failure.code === 'MARKET_ALREADY_INSTALLED'
                          ? t('market', 'errorAlreadyInstalled', { name: entry.name })
                          : `${t('market', 'errorInstall')} — ${describeError(failure)}`,
                        listFailed: false,
                      })
                    } finally {
                      markInstalling(entry.id, false)
                    }
                  })()
                }}
              >
                {installing.has(entry.id) ? t('market', 'installing') : t('market', 'install')}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
