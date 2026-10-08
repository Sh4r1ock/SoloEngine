/**
 * 预览记录卡（PRD-06 FR-ENG-032）：键控对话节点 `soloengine-preview` 的渲染器。
 *
 * 卡片从最终节点数据派生（重放复现同一张卡）。打开联动（经同源代理的浏览器面板）属操作区
 * 职责（PRD-08 FR-OPS-008），故本卡只呈现事实，不自行发起网络访问。
 *
 * @module @soloengine/ui-conversation/PreviewCard
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './PreviewCard.module.css'

/** 键控渲染器的组件 props（owner 给出本 key 的节点）。 */
export type PreviewCardProps =
  PropsRuntime<'conversation.chat.node', 'soloengine-preview'>
  & PropsLocale<'soloengineConversation'>

/**
 * 渲染一张预览记录卡。
 * @param props - 键控节点数据与本地化座位。
 * @returns 预览卡片。
 */
export function PreviewCard({ node, t }: PreviewCardProps) {
  // 键控座位已把 `node.data` 收窄到本 key 的数据体，无需再断言。
  const data = node.data
  return (
    <div className={styles.card}>
      <div className={styles.head}>{t('preview.title')}</div>
      <div className={styles.title}>{data.title}</div>
      <div className={styles.url}>{data.url}</div>
    </div>
  )
}
