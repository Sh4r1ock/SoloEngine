/**
 * 设计系统对照页（`/styleguide`）：应用壳层内、无当前导航项的开发参考页。
 *
 * 渲染六色、字阶、间距/圆角、控件、标记、表格、节点卡、终端、空态、图标与浮层示例；
 * 所有数值来自 `design-spec.md` §4 与 docs/01、docs/03，颜色只用语义 token。
 */
import { useState } from 'react'
import {
  Button,
  IconArchiveOutlineRegular,
  IconAgentPresetOutlineRegular,
  IconBrowseOutlineRegular,
  IconCheckOutlineRegular,
  IconCodeOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconPlanOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
  IconSkillOutlineRegular,
  IconSparkleRegular,
  IconUsersOutlineRegular,
  IconWarningTriangleOutlineRegular,
  Input,
  Modal,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Drawer } from '../components/Drawer.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import common from '../styles/common.module.css'
import css from '../styles/styleguide.module.css'

/** 六色色板（名称与用途走字典，展示用色块由类名取 token）。 */
const SWATCHES = [
  { chip: 'chipBg', name: 'colorBg', hex: '#ffffff', use: 'colorBgUse' },
  { chip: 'chipInk', name: 'colorInk', hex: '#0f1115', use: 'colorInkUse' },
  { chip: 'chipBlue', name: 'colorBlue', hex: '#4176e6', use: 'colorBlueUse' },
  { chip: 'chipSurface', name: 'colorSurface', hex: '#f9fafb', use: 'colorSurfaceUse' },
  { chip: 'chipMuted', name: 'colorMuted', hex: '#61666b', use: 'colorMutedUse' },
  { chip: 'chipBorder', name: 'colorBorder', hex: '#e1e5ee', use: 'colorBorderUse' },
] as const

/** 间距阶梯（8px 基线 + 4px 半步）。 */
const SPACES = [4, 8, 12, 16, 24, 32, 48, 64, 96, 120] as const

/** 圆角阶梯。 */
const RADII = [
  { size: 4, key: 'radius4' },
  { size: 8, key: 'radius8' },
  { size: 12, key: 'radius12' },
  { size: 16, key: 'radius16' },
  { size: 20, key: 'radius20' },
  { size: 28, key: 'radius28' },
] as const

/** 分区导航示例的四个标签（键名不含 copy 后缀，避免被 i18n 门禁当作硬编码文案）。 */
const SECTION_NAV = ['tabGeneral', 'tabAppearance', 'tabLanguage', 'tabPlugins'] as const

/** 分段控件示例的三个标签。 */
const SEGMENTS = ['segmentedAll', 'segmentedMine', 'segmentedPublic'] as const

/** 图标示例（使用产品实际图标，不引入装饰性自绘图形）。 */
const ICONS = [
  { key: 'iconCanvas', Icon: IconBrowseOutlineRegular },
  { key: 'iconModel', Icon: IconSparkleRegular },
  { key: 'iconSkill', Icon: IconSkillOutlineRegular },
  { key: 'iconMcp', Icon: IconCordisPluginOutlineRegular },
  { key: 'iconPackage', Icon: IconArchiveOutlineRegular },
  { key: 'iconSettings', Icon: IconSettingsOutlineRegular },
  { key: 'iconUsers', Icon: IconUsersOutlineRegular },
  { key: 'iconTerminal', Icon: IconCodeOutlineRegular },
  { key: 'iconSearch', Icon: IconSearchOutlineRegular },
  { key: 'iconPlus', Icon: IconPlusOutlineRegular },
  { key: 'iconPlay', Icon: IconPlayOutlineRegular },
  { key: 'iconCheck', Icon: IconCheckOutlineRegular },
] as const

/** 渲染设计系统对照页。 */
export function StyleguidePage() {
  const [search, setSearch] = useState('')
  // 名称示例与抽屉名称示例都是可编辑演示：本地状态承载输入，不再固定在字典文案上。
  const [nameValue, setNameValue] = useState(() => t('styleguide', 'fieldNameValue'))
  const [drawerNameValue, setDrawerNameValue] = useState(() => t('styleguide', 'fieldNameValue'))
  const [switchOn, setSwitchOn] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [segment, setSegment] = useState(0)
  const toast = useToastHost()

  return (
    <div className={common.page}>
      <PageHeader
        eyebrow={t('styleguide', 'eyebrow')}
        title={t('styleguide', 'title')}
        subtitle={t('styleguide', 'subtitle')}
        actions={(
          <>
            <span className={css.specGuide}>{t('styleguide', 'specGuide')}</span>
            <Button variant="primary" onClick={() => { navigate('/canvas') }}>{t('styleguide', 'consoleLink')}</Button>
          </>
        )}
      />

      <section className={css.section} id="sg-color">
        <div className={css.sectionHead}>
          <h2>{t('styleguide', 'colorTitle')}</h2>
          <p>{t('styleguide', 'colorDesc')}</p>
        </div>
        <div className={css.swatches}>
          {SWATCHES.map(swatch => (
            <div key={swatch.name} className={css.swatch}>
              <span className={`${css.chip} ${css[swatch.chip]}`} aria-hidden="true" />
              <span className={css.swatchName}>{t('styleguide', swatch.name)}</span>
              <span className={css.mono}>{swatch.hex}</span>
              <span className={css.swatchUse}>{t('styleguide', swatch.use)}</span>
            </div>
          ))}
        </div>
        <p className={css.notice}>
          <span className={css.noticeIcon} aria-hidden="true"><IconWarningTriangleOutlineRegular size={16} /></span>
          <span>{t('styleguide', 'colorNotice')}</span>
        </p>
      </section>

      <section className={css.section} id="sg-type">
        <div className={css.sectionHead}>
          <h2>{t('styleguide', 'typeTitle')}</h2>
          <p>{t('styleguide', 'typeDesc')}</p>
        </div>
        <div className={css.typeGrid}>
          <div className={css.typeCard}>
            <span className={css.typeLabel}>{t('styleguide', 'typeDisplayLabel')}</span>
            <p className={css.display}>{t('styleguide', 'typeDisplaySample')}</p>
            <span className={css.meta}>{t('styleguide', 'typeDisplayMeta')}</span>
          </div>
          <div className={css.typeCard}>
            <span className={css.typeLabel}>{t('styleguide', 'typeUiLabel')}</span>
            <p className={css.typeUi}>{t('styleguide', 'typeUiSample')}</p>
            <span className={css.meta}>{t('styleguide', 'typeUiMeta')}</span>
          </div>
          <div className={css.typeCard}>
            <span className={css.typeLabel}>{t('styleguide', 'typeBodyLabel')}</span>
            <p className={css.typeBody}>{t('styleguide', 'typeBodySample')}</p>
            <span className={css.meta}>{t('styleguide', 'typeBodyMeta')}</span>
          </div>
          <div className={css.typeCard}>
            <span className={css.typeLabel}>{t('styleguide', 'typeMonoLabel')}</span>
            <p className={css.code}>{t('styleguide', 'typeMonoSample')}</p>
            <span className={css.meta}>{t('styleguide', 'typeMonoMeta')}</span>
          </div>
        </div>
        <div className={css.scale}>
          <span className={css.scaleMono}>12/20</span><span>{t('styleguide', 'scale12')}</span>
          <span className={css.scaleMono}>13/22</span><span>{t('styleguide', 'scale13')}</span>
          <span className={css.scaleMono}>14/24</span><span>{t('styleguide', 'scale14')}</span>
          <span className={css.scaleMono}>16/26</span><span>{t('styleguide', 'scale16')}</span>
          <span className={css.scaleMono}>20/30</span><span>{t('styleguide', 'scale20')}</span>
          <span className={css.scaleMono}>28/36</span><span>{t('styleguide', 'scale28')}</span>
          <span className={css.scaleMono}>40/48</span><span>{t('styleguide', 'scale40')}</span>
          <span className={css.scaleMono}>64/68</span><span>{t('styleguide', 'scale64')}</span>
        </div>
      </section>

      <section className={css.section} id="sg-space">
        <div className={css.sectionHead}>
          <h2>{t('styleguide', 'spaceTitle')}</h2>
          <p>{t('styleguide', 'spaceDesc')}</p>
        </div>
        <div className={css.spaceGrid}>
          {SPACES.map(space => (
            <div key={space} className={css.spaceRow}>
              <span className={css.spaceLabel}>{space}</span>
              <span className={css.spaceBar} style={{ width: `${Math.min(space, 120)}px` }} />
            </div>
          ))}
        </div>
        <div className={css.radii}>
          {RADII.map(radius => (
            <div key={radius.size} className={css.radius}>
              <span className={css.radiusBox} style={{ borderRadius: `${radius.size}px` }} />
              <span className={css.mono}>{t('styleguide', radius.key)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={css.section} id="sg-components">
        <div className={css.sectionHead}>
          <h2>{t('styleguide', 'componentsTitle')}</h2>
          <p>{t('styleguide', 'componentsDesc')}</p>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'buttonsLabel')}</div>
          <div className={css.row}>
            <Button variant="primary">{t('styleguide', 'btnPrimary')}</Button>
            <Button variant="outline">{t('styleguide', 'btnSecondary')}</Button>
            <Button variant="ghost">{t('styleguide', 'btnGhost')}</Button>
            <Button variant="outline" className={common.dangerButton}>{t('styleguide', 'btnDanger')}</Button>
            <Button variant="outline" size="sm">{t('styleguide', 'btnSmall')}</Button>
            <Button variant="outline" disabled>{t('styleguide', 'btnDisabled')}</Button>
            <Button variant="primary" aria-busy="true">
              <span className={css.spinner} aria-hidden="true" />
              {t('styleguide', 'btnBusy')}
            </Button>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'tabsLabel')}</div>
          <div className={css.tabs} role="tablist" aria-label={t('styleguide', 'tabsLabel')}>
            {SECTION_NAV.map((key, index) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === index}
                className={tab === index ? `${css.tab} ${css.tabActive}` : css.tab}
                onClick={() => { setTab(index) }}
              >
                {t('styleguide', key)}
              </button>
            ))}
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'formsLabel')}</div>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('styleguide', 'fieldName')}</span>
              <Input
                value={nameValue}
                onChange={(event) => { setNameValue(event.target.value) }}
                aria-label={t('styleguide', 'fieldName')}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('styleguide', 'fieldRunMode')}</span>
              <select className={css.select} defaultValue={t('styleguide', 'fieldRunModeValue')} aria-label={t('styleguide', 'fieldRunMode')}>
                <option>{t('styleguide', 'fieldRunModeValue')}</option>
                <option>{t('styleguide', 'fieldRunModeAuto')}</option>
              </select>
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('styleguide', 'fieldSearch')}</span>
              <Input
                icon={<IconSearchOutlineRegular size={16} />}
                value={search}
                onChange={(event) => { setSearch(event.target.value) }}
                placeholder={t('styleguide', 'fieldSearchPlaceholder')}
                aria-label={t('styleguide', 'fieldSearch')}
              />
            </label>
            <div className={css.field}>
              <span className={css.fieldLabel}>{t('styleguide', 'fieldSwitch')}</span>
              <div className={css.switchRow}>
                <Switch checked={switchOn} onChange={setSwitchOn} label={t('styleguide', 'fieldSwitchLabel')} />
              </div>
            </div>
          </div>
          <label className={`${css.field} ${css.fieldSpaced}`}>
            <span className={css.fieldLabel}>{t('styleguide', 'fieldPrompt')}</span>
            <textarea className={`${css.textarea} ${css.textareaMono}`} rows={4} defaultValue={t('styleguide', 'fieldPromptValue')} aria-label={t('styleguide', 'fieldPrompt')} />
          </label>
          <div className={`${css.row} ${css.rowSpaced}`}>
            <div className={css.segmented}>
              {SEGMENTS.map((key, index) => (
                <button
                  key={key}
                  type="button"
                  className={segment === index ? `${css.segmentItem} ${css.segmentActive}` : css.segmentItem}
                  aria-pressed={segment === index}
                  onClick={() => { setSegment(index) }}
                >
                  {t('styleguide', key)}
                </button>
              ))}
            </div>
            <label className={css.checkbox}>
              <input type="checkbox" defaultChecked />
              <span>{t('styleguide', 'checkboxEnabled')}</span>
            </label>
            <label className={css.radioCard}>
              <input type="radio" name="sg-radio" defaultChecked />
              <span>
                <span className={css.radioCardTitle}>{t('styleguide', 'radioTitle')}</span>
                <span className={css.radioCardDesc}>{t('styleguide', 'radioDesc')}</span>
              </span>
            </label>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'marksLabel')}</div>
          <div className={css.row}>
            <Tag tone="neutral" className={`${css.badge} ${css.badgeNeutral}`}>{t('styleguide', 'badgeDefault')}</Tag>
            <Tag tone="info" className={`${css.badge} ${css.badgeAccent}`}>
              <span className={css.badgeDot} aria-hidden="true" />
              {t('styleguide', 'badgeFeatured')}
            </Tag>
            <Tag tone="solid" className={css.badge}>{t('styleguide', 'badgeSuperuser')}</Tag>
            <Tag className={`${css.badge} ${css.badgeOutline}`}>{t('styleguide', 'badgeTemplate')}</Tag>
            <Tag tone="quiet" className={`${css.badge} ${css.badgeDisabled}`}>{t('styleguide', 'badgeDisabled')}</Tag>
            <span className={css.tag}>{t('styleguide', 'tagResearch')}</span>
            <span className={css.status}><span className={css.statusAccent} />{t('styleguide', 'statusRunning')}</span>
            <span className={css.status}><span className={css.statusDot} />{t('styleguide', 'statusDone')}</span>
            <span className={css.status}><span className={css.statusInk} />{t('styleguide', 'statusAction')}</span>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'tableLabel')}</div>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th scope="col">{t('styleguide', 'tableName')}</th>
                  <th scope="col">{t('styleguide', 'tableProvider')}</th>
                  <th scope="col">{t('styleguide', 'tableModel')}</th>
                  <th scope="col">{t('styleguide', 'tableStatus')}</th>
                  <th scope="col">{t('styleguide', 'tableActions')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div className={css.cellMain}>
                      <span className={css.modelGlyph}>{t('styleguide', 'tableGlyphPrimary')}</span>
                      <div>
                        <div className={css.cellTitle}>{t('styleguide', 'tablePrimary')}</div>
                        <div className={css.cellSub}>{t('styleguide', 'tablePrimarySub')}</div>
                      </div>
                    </div>
                  </td>
                  <td>{t('styleguide', 'tableProviderPrimary')}</td>
                  <td className={css.mono}>{t('styleguide', 'tableModelPrimary')}</td>
                  <td><span className={css.status}><span className={css.statusAccent} />{t('styleguide', 'tableEnabled')}</span></td>
                  <td><Button variant="outline" size="sm">{t('styleguide', 'tableEdit')}</Button></td>
                </tr>
                <tr>
                  <td>
                    <div className={css.cellMain}>
                      <span className={css.modelGlyph}>{t('styleguide', 'tableGlyphSecondary')}</span>
                      <div>
                        <div className={css.cellTitle}>{t('styleguide', 'tableSecondary')}</div>
                        <div className={css.cellSub}>{t('styleguide', 'tableSecondarySub')}</div>
                      </div>
                    </div>
                  </td>
                  <td>{t('styleguide', 'tableProviderSecondary')}</td>
                  <td className={css.mono}>{t('styleguide', 'tableModelSecondary')}</td>
                  <td><span className={css.status}><span className={css.statusAccent} />{t('styleguide', 'tableEnabled')}</span></td>
                  <td><Button variant="outline" size="sm">{t('styleguide', 'tableEdit')}</Button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'nodeLabel')}</div>
          <div className={css.canvasDemo}>
            <article className={`${css.node} ${css.nodeSelected}`}>
              <div className={css.nodeHead}>
                <span className={css.nodeGlyph} aria-hidden="true"><IconAgentPresetOutlineRegular size={16} /></span>
                <div className={css.nodeTitles}>
                  <div className={css.nodeTitle}>{t('styleguide', 'nodeCoordinator')}</div>
                  <div className={css.nodeRole}>{t('styleguide', 'nodeCoordinatorRole')}</div>
                </div>
                <span className={css.nodeStatus} />
              </div>
              <p className={css.nodeSummary}>{t('styleguide', 'nodeCoordinatorDesc')}</p>
              <div className={css.nodeFoot}><span className={css.statusDot} />{t('styleguide', 'nodeModel')} · {t('styleguide', 'nodeTools', { count: '2' })}</div>
              <span className={css.nodePort} />
            </article>
            <article className={css.node}>
              <div className={css.nodeHead}>
                <span className={css.nodeGlyph} aria-hidden="true"><IconPlanOutlineRegular size={16} /></span>
                <div className={css.nodeTitles}>
                  <div className={css.nodeTitle}>{t('styleguide', 'nodePlanner')}</div>
                  <div className={css.nodeRole}>{t('styleguide', 'nodePlannerRole')}</div>
                </div>
                <span className={css.nodeStatus} />
              </div>
              <p className={css.nodeSummary}>{t('styleguide', 'nodePlannerDesc')}</p>
              <div className={css.nodeFoot}><span className={css.statusDot} />{t('styleguide', 'nodeModel')} · {t('styleguide', 'nodeTools', { count: '1' })}</div>
              <span className={css.nodePort} />
            </article>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'terminalLabel')}</div>
          <div className={css.two}>
            <div className={css.terminal}>
              <div className={css.terminalHead}>
                <span className={css.terminalTitle}><span className={css.statusAccent} />{t('styleguide', 'terminalTitle')}</span>
                <span className={css.terminalMuted}>{t('styleguide', 'terminalLive')}</span>
              </div>
              <pre className={css.terminalBody}>
                <span className={css.termLine}>
                  <span className={css.termTime}>{t('styleguide', 'terminalTime1')}</span>
                  <span className={css.termRun}>{t('styleguide', 'termLine1')}</span>
                </span>
                <span className={css.termLine}>
                  <span className={css.termTime}>{t('styleguide', 'terminalTime2')}</span>
                  <span className={css.termOk}>{t('styleguide', 'termLine2')}</span>
                </span>
                <span className={css.termLine}>
                  <span className={css.termTime}>{t('styleguide', 'terminalTime3')}</span>
                  <span className={css.termOk}>{t('styleguide', 'termLine3')}</span>
                </span>
              </pre>
            </div>
            <div className={`${css.empty} ${css.emptyBordered}`}>
              <span className={css.emptyIcon} aria-hidden="true">
                <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M3 8h14M7 4v4M13 4v4" /></svg>
              </span>
              <p className={css.emptyTitle}>{t('styleguide', 'emptyTitle')}</p>
              <p className={css.emptyDesc}>{t('styleguide', 'emptyDesc')}</p>
              <Button variant="primary" size="sm">{t('styleguide', 'emptyAction')}</Button>
            </div>
          </div>
        </div>

        <div className={css.block}>
          <div className={css.blockLabel}>{t('styleguide', 'interactionsLabel')}</div>
          <div className={css.row}>
            <Button variant="outline" onClick={() => { setDialogOpen(true) }}>{t('styleguide', 'confirmDemo')}</Button>
            <Button variant="outline" onClick={() => { toast.show(t('styleguide', 'toastText'), 'success') }}>{t('styleguide', 'toastDemo')}</Button>
            <Button variant="outline" onClick={() => { setDrawerOpen(true) }}>{t('styleguide', 'drawerDemo')}</Button>
          </div>
          <div className={css.icons}>
            {ICONS.map(({ key, Icon }) => (
              <span key={key} className={css.icon}>
                <Icon size={18} />
                <span>{t('styleguide', key)}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className={css.section} id="sg-metrics">
        <div className={css.sectionHead}>
          <h2>{t('styleguide', 'metricLabel')}</h2>
          <p>{t('styleguide', 'metricDesc')}</p>
        </div>
        <div className={css.tableWrap}>
          <table className={`${css.table} ${css.metricsTable}`}>
            <thead>
              <tr>
                <th scope="col">{t('styleguide', 'metricName')}</th>
                <th scope="col">{t('styleguide', 'metricValue')}</th>
                <th scope="col">{t('styleguide', 'metricUse')}</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['--sidebar-w', '280px', 'metricSidebar'],
                ['--rail-w', '56px', 'metricRail'],
                ['--topbar-h', '48px', 'metricTopbar'],
                ['--inspector-w', '320px', 'metricInspector'],
                ['--panel-h', '224px', 'metricPanel'],
                ['--control-sm / md', '28 / 36px', 'metricControl'],
                ['--content-max', 'calc(1120px + 64px)', 'metricContent'],
                ['--content-wide', 'calc(1240px + 64px)', 'metricWide'],
                ['--reading-max', '760px', 'metricReading'],
              ] as const).map(row => (
                <tr key={row[0]}>
                  <td className={css.mono}>{row[0]}</td>
                  <td className={css.mono}>{row[1]}</td>
                  <td>{t('styleguide', row[2])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={dialogOpen}
        onClose={() => { setDialogOpen(false) }}
        title={t('styleguide', 'confirmTitle')}
        description={t('styleguide', 'confirmDescription')}
        closeLabel={t('common', 'actionClose')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setDialogOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={common.dangerButton}
              onClick={() => {
                setDialogOpen(false)
                toast.show(t('styleguide', 'confirmDone'), 'success')
              }}
            >
              {t('styleguide', 'confirmDelete')}
            </Button>
          </>
        )}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false) }}
        title={t('styleguide', 'drawerTitle')}
        description={t('styleguide', 'drawerDesc')}
        closeLabel={t('common', 'actionClose')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setDrawerOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDrawerOpen(false)
                toast.show(t('styleguide', 'toastText'), 'success')
              }}
            >
              {t('common', 'actionSave')}
            </Button>
          </>
        )}
      >
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('styleguide', 'fieldName')}</span>
          <Input
            value={drawerNameValue}
            onChange={(event) => { setDrawerNameValue(event.target.value) }}
            aria-label={t('styleguide', 'fieldName')}
          />
        </label>
        <p className={`${css.notice} ${css.noticeSpaced}`}>
          <span className={css.noticeIcon} aria-hidden="true"><IconWarningTriangleOutlineRegular size={16} /></span>
          <span>{t('styleguide', 'drawerNotice')}</span>
        </p>
      </Drawer>

    </div>
  )
}
