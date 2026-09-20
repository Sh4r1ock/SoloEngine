/**
 * 会话头「工具」座位上的预览记录入口（PRD-07 FR-UI-020；PRD-08 FR-OPS-008）。
 *
 * 数据来自宿主权威投影 `soloengine.openPreview`（新到旧、同链接去重置顶、上限 50），
 * 客户端只读、不自算。**点击一条预览即经同源代理的浏览器面板打开该地址**：
 * 以 `{ url }` 调 `ctx.sidebarRight.openTab('soloengine-browser')`，参数到达面板体后
 * 在当前标签导航（地址栏同步）——页面加载与安全判定全部由 Host 侧代理承担。
 *
 * @module @soloengine/ui-conversation/PreviewList
 */

import { useState } from 'react'
import { Menu, Pill, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SoloengineConversationKey } from './locales.ts'

/** 注入面：打开预览地址（由注册方绑定 ctx.sidebarRight.openTab）。 */
export interface PreviewFace {
  /** 在浏览器面板的当前标签打开一个地址。 */
  openPreview: (url: string) => void
}

/** 会话头工具座位的组件 props。 */
export type PreviewListProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'soloengineConversation'>
  & PreviewFace

/**
 * 渲染预览记录入口（数量药丸 + 就地菜单）。
 * @param props - session 作用域标准座位、注入面与本地化座位。
 * @returns 预览记录入口。
 */
export function PreviewList({ useProjection, openPreview, t }: PreviewListProps) {
  const [open, setOpen] = useState(false)
  const previews = useProjection('soloengine.openPreview')
  const entries: MenuEntry[] = previews === undefined || previews.length === 0
    ? [{ id: 'soloengine-preview:empty', label: t('preview.empty'), disabled: true }]
    : previews.map(record => ({ id: record.url, label: record.title }))
  return (
    <Menu
      open={open}
      anchor={(
        <Pill onClick={() => { setOpen(current => !current) }} aria-expanded={open}>
          {`${t('preview.utilities')} · ${String(previews?.length ?? 0)}`}
        </Pill>
      )}
      items={entries}
      onSelect={(id) => {
        setOpen(false)
        if (id.startsWith('soloengine-preview:empty')) return
        openPreview(id)
      }}
      onClose={() => { setOpen(false) }}
      align="end"
      portal
    />
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineConversationKey }
