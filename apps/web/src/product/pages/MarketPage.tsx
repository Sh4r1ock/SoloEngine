/** 市场页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconCheckOutlineRegular, IconDatabaseOutlineRegular,
  IconSearchOutlineRegular, IconSkillOutlineRegular, Input, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import type { MarketEntry, McpServerView, SkillView } from '../types.ts'
import common from '../styles/common.module.css'
import css from '../styles/market.module.css'

/** 排序键。 */
type SortKey = 'featured' | 'installs' | 'name'

/**
 * 安装失败的文案按后端错误码本地化（错误码是稳定契约，文案随语言切换）。
 * @param failure - 捕获的失败。
 * @param name - 条目名（需要内插时使用）。
 * @returns 展示文案。
 */
function installFailureText(failure: unknown, name: string): string {
  if (failure instanceof ApiError) {
    switch (failure.code) {
      case 'MARKET_ALREADY_INSTALLED': return t('market', 'errorAlreadyInstalled', { name })
      case 'MCP_NAME_TAKEN': return t('market', 'errorMcpNameTaken', { name })
      case 'MARKET_DIRECTORY_ORPHANED': return t('market', 'errorDirectoryOrphaned', { name })
      case 'MARKET_NAME_MISMATCH': return t('market', 'errorNameMismatch', { name })
      case 'MARKET_SOURCE_MISSING': return t('market', 'errorSourceMissing', { name })
      case 'MARKET_ENTRY_INVALID': return t('market', 'errorEntryInvalid', { name })
      case 'MARKET_ENTRY_NOT_FOUND': return t('market', 'errorEntryNotFound', { name })
      case 'MARKET_CATALOG_INVALID': return t('market', 'errorCatalogInvalid')
      default: break
    }
  }
  return `${t('market', 'errorInstall')} — ${describeError(failure)}`
}

/**
 * 分类候选的回退累积：响应没有 `categories` 字段时按已加载条目补齐（旧后端）。
 * @param previous - 已知分类。
 * @param entries - 本次加载的条目。
 * @returns 合并后的分类；无变化时返回原数组。
 */
function accumulateCategories(previous: string[], entries: MarketEntry[]): string[] {
  const seen = new Set(previous)
  let changed = false
  for (const entry of entries) {
    for (const item of entry.categories) {
      if (!seen.has(item)) {
        seen.add(item)
        changed = true
      }
    }
  }
  return changed ? [...seen].sort() : previous
}

/**
 * 分类 slug → 当前语言标签。
 *
 * 目录文件存英文 slug（engineering / documentation / tools），原型的分类是中文
 * 「工程 / 文档 / 工具」（data.js:425）；未知 slug 原样显示，不臆造译文。
 * @param value - 目录里的分类值。
 * @returns 本地化标签或原值。
 */
function categoryLabel(value: string): string {
  if (value === 'engineering') return t('market', 'categoryEngineering')
  if (value === 'documentation') return t('market', 'categoryDocumentation')
  if (value === 'tools') return t('market', 'categoryTools')
  return value
}

/**
 * 渲染市场页。
 */
export function MarketPage() {
  const locale = useLocale()
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
  // 分类候选：来自响应的该 kind 完整目录（旧后端缺字段时按已加载条目回退累积）。
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // 错误来源必须区分：「重试」这一行内动作做的是重新拉取列表，只对列表加载失败成立。
  // 安装失败时挂同一个按钮会把用户引向「刷新列表」（实测语义错位：安装 409 后点重试
  // 只会重发 GET /market），而正确的出路就是卡片上重新可点的「安装」按钮本身。
  const [error, setError] = useState<{ text: string; listFailed: boolean } | null>(null)
  // 安装成功走 Toast（原型 market.js:111 的 App.toast）；失败留在页内 NoticeLine，带处置动作。
  const toast = useToastHost()

  // 全站唯一的在途请求：`load` 既被 effect（筛选变化）调用，也被「刷新」按钮与
  // 错误行的「重试」直接调用。只给 effect 那条路挂 signal 时，直接调用的请求既不参与
  // 中止也不讲顺序（实测：刷新→立刻切 MCP，被延迟 1.5s 的 skill 响应后到，
  // 把 mcp 结果整片覆盖成技能条目，而分类药丸已显示 MCP）。故中止权收归一个 ref。
  const controllerRef = useRef<AbortController | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ctrl/Cmd+K 聚焦搜索（原型 app.js:650-659 的全局快捷键）。
  useSearchShortcut(searchRef)

  // 安装按钮的在途集合：一次安装不冻结其他条目，但同一条目在途期间必须禁用（R26）。
  const [installing, setInstalling] = useState<Set<string>>(() => new Set<string>())
  // 已安装项（按名称持久）：技能读 /skills，MCP 读 /mcp，安装后立即并入，无需猜测。
  const [installedNames, setInstalledNames] = useState<Set<string>>(() => new Set<string>())
  /** 已安装集合的请求序号：切换类型后旧类型的慢响应不能把名字写进当前类型的集合。 */
  const installedSeq = useRef(0)
  const [kindCounts, setKindCounts] = useState<{ skill: number; mcp: number } | null>(null)

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
      const result = await request<{ ok: true; entries: MarketEntry[]; total: number; categories?: string[] }>('/market', {
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
      // 分类候选取该 kind 的完整目录（响应字段），不按本次筛选结果累积；
      // 旧后端没有该字段时退回按已加载条目累积。
      if (result.categories === undefined) {
        setCategories(previous => accumulateCategories(previous, result.entries))
      } else {
        setCategories([...result.categories].sort())
      }
      setError(null)
    } catch (failure) {
      // 只吞「本次请求已被更新的一轮筛选/刷新中止」这一种情况：中止信息由自己的
      // controller 判定，不能用 status===0 代替——网络不可达/离线同样是 status 0，
      // 一并吞掉会让用户看到一份没有任何说明的过期列表（R31 离线可见性 / R24 恢复路径）。
      if (controller.signal.aborted) return
      setError({
        text: failure instanceof ApiError && failure.code === 'MARKET_CATALOG_INVALID'
          ? t('market', 'errorCatalogInvalid')
          : `${t('market', 'errorLoad')} — ${describeError(failure)}`,
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

  // 已安装项：与本地清单同名即视为已安装（技能与 MCP 各自一套清单）。
  const loadInstalled = useCallback(async (): Promise<void> => {
    const seq = ++installedSeq.current
    try {
      if (kind === 'skill') {
        const result = await request<{ ok: true; skills: SkillView[] }>('/skills')
        if (seq !== installedSeq.current) return
        setInstalledNames(new Set(result.skills.map(skill => skill.name)))
      } else {
        const result = await request<{ ok: true; servers: McpServerView[] }>('/mcp')
        if (seq !== installedSeq.current) return
        setInstalledNames(new Set(result.servers.map(server => server.name)))
      }
    } catch (failure) {
      if (seq !== installedSeq.current) return
      setError({ text: `${t('market', 'errorInstalled')} — ${describeError(failure)}`, listFailed: false })
    }
  }, [kind])

  useEffect(() => { void loadInstalled() }, [loadInstalled])

  // 类型标签计数：两类目录各自的总数（辅助信息，失败时不显示数字）。
  useEffect(() => {
    void (async () => {
      try {
        const [skillResult, mcpResult] = await Promise.all([
          request<{ ok: true; total: number }>('/market', { query: { kind: 'skill' } }),
          request<{ ok: true; total: number }>('/market', { query: { kind: 'mcp' } }),
        ])
        setKindCounts({ skill: skillResult.total, mcp: mcpResult.total })
      } catch {
        // 计数失败不影响目录列表：省略数字即可，列表加载失败会由 load() 单独报错。
      }
    })()
  }, [])

  // 已生效的分类必须始终可见、可撤销：即使它来自更早的全目录结果，也不能从下拉里消失。
  const categoryOptions = useMemo(() => (
    category === null || categories.includes(category)
      ? categories
      : [...categories, category].sort()
  ), [categories, category])

  /** 切换类型：分类属于某个 kind 的完整目录，换类型时必须清空并重新加载该 kind 的分类。 */
  const switchKind = (next: 'skill' | 'mcp'): void => {
    setKind(next)
    setCategory(null)
    if (next !== kind) {
      setCategories([])
      // 已安装集合按类型区分：换类型先作废旧响应并清空，避免另一类型的同名条目被误标「已安装」。
      installedSeq.current += 1
      setInstalledNames(new Set<string>())
    }
  }

  /** 清除搜索、分类、精选与排序（空态里的恢复动作，与原型一致）。 */
  const clearFilters = (): void => {
    setSearchInput('')
    setSearch('')
    setCategory(null)
    setFeaturedOnly(false)
    setSort('featured')
    // 原型 market.js:132-139：恢复后把焦点放回搜索框，用户可以直接重新输入。
    searchRef.current?.focus()
  }

  return (
    <div className={common.page}>
      <PageHeader
        title={t('market', 'title')}
        subtitle={t('market', 'subtitle')}
        actions={(
          <>
            <Button variant="outline" onClick={() => { navigate('/skill') }}>{t('market', 'localSkills')}</Button>
            <Button variant="outline" onClick={() => { navigate('/mcp') }}>{t('market', 'localMcp')}</Button>
          </>
        )}
      />

      <div className={css.content}>
        <div className={css.tabs} role="tablist" aria-label={t('market', 'kindAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'skill'}
            className={kind === 'skill' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => { switchKind('skill') }}
          >
            {t('market', 'kindSkill')}
            {kindCounts !== null && <span className={css.tabCount}>{kindCounts.skill}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'mcp'}
            className={kind === 'mcp' ? `${css.tab} ${css.tabActive}` : css.tab}
            onClick={() => { switchKind('mcp') }}
          >
            {t('market', 'kindMcp')}
            {kindCounts !== null && <span className={css.tabCount}>{kindCounts.mcp}</span>}
          </button>
        </div>

        <div className={css.filterBar}>
          {/* 搜索框只有 placeholder：placeholder 在输入后消失，可访问名必须常驻（WCAG 3.3.2），
              原生 Input 透传 input 属性，故产品层补 aria-label（原生包禁改）。 */}
          <Input
            ref={searchRef}
            className={css.search ?? ''}
            type="search"
            icon={<IconSearchOutlineRegular size={16} />}
            value={searchInput}
            placeholder={t('market', 'searchPlaceholder')}
            aria-label={t('market', 'searchAria')}
            onChange={(event) => { setSearchInput(event.currentTarget.value) }}
          />
          {/* 分类与排序按原型用原生 select（36px `.select`），不是 28px 的药丸/菜单：
              原型 market.html 里这两个控件就是 <select class="select">。 */}
          <select
            className={`${css.select} ${css.filterSelect}`}
            value={category ?? 'all'}
            aria-label={t('market', 'categoryLabel')}
            onChange={(event) => {
              const value = event.currentTarget.value
              setCategory(value === 'all' ? null : value)
            }}
          >
            <option value="all">{t('market', 'categoryAll')}</option>
            {categoryOptions.map(item => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </select>
          <select
            className={`${css.select} ${css.filterSelect}`}
            value={sort}
            aria-label={t('market', 'sortLabel')}
            onChange={(event) => {
              const value = event.currentTarget.value
              setSort(value === 'installs' ? 'installs' : value === 'name' ? 'name' : 'featured')
            }}
          >
            <option value="featured">{t('market', 'sortFeatured')}</option>
            <option value="installs">{t('market', 'sortInstalls')}</option>
            <option value="name">{t('market', 'sortName')}</option>
          </select>
          <span className={css.switchLabel}>
            <Switch
              checked={featuredOnly}
              label={t('market', 'featuredOnly')}
              onChange={(next) => { setFeaturedOnly(next) }}
            />
            {/* 原型把文字与开关包在同一个 label 里：点文字也切换。开关本身是 button，
                这里用不可聚焦的冗余按钮承接文字点击，屏幕阅读器仍只读开关的可访问名。 */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className={css.switchText}
              onClick={() => { setFeaturedOnly(!featuredOnly) }}
            >
              {t('market', 'featuredOnly')}
            </button>
          </span>
          <span className={css.spacer} />
          <span className={css.count}>
            {total === 1 ? t('market', 'totalEntriesOne') : t('market', 'totalEntries', { count: total })}
          </span>
        </div>

        {error !== null && (
          <div className={css.notices}>
            <NoticeLine
              tone="error"
              text={error.text}
              {...(error.listFailed
                ? { action: { label: t('common', 'actionRetry'), onClick: (): void => { void load() } } }
                : {})}
            />
          </div>
        )}

        {/* 加载行与列表互斥地占同一个位置：两条并列时，118px 高的加载行会把仍可见的卡片
            整体推下去（实测筛选时卡片 y 216 → 358，回弹 142px，R1 非预期位移）。
            已有内容时不再插行，只在首屏（还没有任何条目）时显示加载态。 */}
        {loading && entries.length === 0 && <div className={common.empty}>{t('common', 'stateLoading')}</div>}
        {/* 加载失败不是「没有匹配条目」：错误行已经说明原因，空态不能同屏再报一次。 */}
        {!loading && entries.length === 0 && error?.listFailed !== true && (
          <div className={common.emptyState}>
            <span className={common.emptyIcon} aria-hidden="true"><IconArchiveOutlineRegular size={22} /></span>
            <p className={common.emptyTitle}>{t('market', 'empty')}</p>
            <p className={common.emptyDesc}>{t('market', 'emptyDesc')}</p>
            {/* 空态始终给恢复动作：没有任何过滤时点击它是无害的（重置到默认视图）。 */}
            <Button size="sm" variant="outline" onClick={clearFilters}>{t('market', 'clearFilters')}</Button>
          </div>
        )}

        {entries.length > 0 && (
          <div className={css.rows}>
            {entries.map((entry) => {
              // 后端按当前用户的落库名给出 `installed`；本地集合覆盖「刚安装、列表还没回来」的窗口。
              const installed = entry.installed || installedNames.has(entry.name)
              return (
                <article key={entry.id} className={css.row}>
                  <span className={css.glyph} aria-hidden="true">
                    {entry.kind === 'skill'
                      ? <IconSkillOutlineRegular size={17} />
                      : <IconDatabaseOutlineRegular size={17} />}
                  </span>
                  <div className={css.rowMain}>
                    <div className={css.titleLine}>
                      <span className={css.rowName}>{entry.name}</span>
                      {entry.featured && (
                        <Tag tone="info" className={`${css.featuredBadge} ${common.accentTag} ${common.statusTag}`}>
                          <span className={css.featuredDot} aria-hidden="true" />
                          {t('market', 'featuredBadge')}
                        </Tag>
                      )}
                      <span className={css.version}>{t('market', 'versionLabel', { version: entry.version })}</span>
                    </div>
                    {entry.description !== '' && <p className={css.rowDesc}>{entry.description}</p>}
                    <div className={css.rowMeta}>
                      <span>{entry.author}</span>
                      {entry.tags.length > 0 && (
                        <span className={css.tags}>
                          {entry.tags.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={css.side}>
                    <span className={css.installs}>
                      <strong>{entry.installs.toLocaleString(locale)}</strong>
                      {' '}
                      {t('market', 'installsUnit')}
                    </span>
                    <Button
                      size="sm"
                      variant={installed ? 'outline' : 'primary'}
                      className={installed ? css.installedButton : undefined}
                      disabled={installed || installing.has(entry.id)}
                      aria-busy={installing.has(entry.id)}
                      icon={installed
                        ? <IconCheckOutlineRegular size={13} />
                        : installing.has(entry.id)
                          ? <span className={common.spinner} aria-hidden="true" />
                          : undefined}
                      aria-label={installed
                        ? t('market', 'installed')
                        : installing.has(entry.id)
                          ? t('market', 'installing')
                          : t('market', 'installAria', { name: entry.name })}
                      onClick={() => {
                        markInstalling(entry.id, true)
                        setError(null)
                        void (async () => {
                          try {
                            await request(`/market/${entry.id}/install`, { method: 'POST' })
                            toast.show(t('market', 'installSuccess', { name: entry.name }), 'success')
                            setInstalledNames(previous => new Set(previous).add(entry.name))
                            await load()
                          } catch (failure) {
                            setError({
                              text: installFailureText(failure, entry.name),
                              listFailed: false,
                            })
                          } finally {
                            markInstalling(entry.id, false)
                          }
                        })()
                      }}
                    >
                      {installed
                        ? t('market', 'installed')
                        : installing.has(entry.id) ? t('market', 'installing') : t('market', 'install')}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
