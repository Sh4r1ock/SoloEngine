/**
 * 消息区变更汇总条（PRD-09 FR-FC-006 三处同源之一）。
 *
 * 数据与变更面板、编辑器装饰读**同一份事实**（`file_changes` 台账，经操作区桥
 * `/soloengine/changes`）；汇总条只做折叠呈现——回合变更条数与净行数，点击打开变更面板。
 * 不自算差异、不落第二副本。
 *
 * 刷新时机：会话从运行态转空闲（回合收尾）时重读台账（运行中写入尚未落定，读了也不可裁）。
 *
 * @module @soloengine/ui-conversation/ChangesSummary
 */

import { useCallback, useEffect, useState } from 'react'
import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './SessionContext.module.css'
import type { SoloengineConversationKey } from './locales.ts'

/** 汇总条注入面：打开变更面板（由注册方绑定 ctx.sidebarRight）。 */
export interface ChangesFace {
  /** 打开/聚焦操作区的变更面板（kind `soloengine-changes`）。 */
  openChanges: () => void
}

/** 汇总条 props：session 作用域标准座位 + 注入面 + 本地化座位。 */
export type ChangesSummaryProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'soloengineConversation'>
  & ChangesFace

/** 台账响应（与变更面板读的同一接口同形）。 */
interface ChangesResponse {
  ok: boolean
  summary?: { total: number; linesAdded: number; linesRemoved: number }
  error?: { code: string; message: string }
}

/**
 * 渲染变更汇总芯片：读台账摘要，点击打开变更面板。
 * @param props - session 作用域标准座位、注入面与本地化座位。
 * @returns 汇总芯片，或无变更时 null。
 */
export function ChangesSummary({ useSession, sessionId, openChanges, t }: ChangesSummaryProps) {
  const running = useSession(snapshot => snapshot.running)
  const [summary, setSummary] = useState<{ total: number; linesAdded: number; linesRemoved: number } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/soloengine/changes?sessionKey=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
      const body = await response.json() as ChangesResponse
      if (!response.ok || !body.ok) return
      setSummary(body.summary ?? { total: 0, linesAdded: 0, linesRemoved: 0 })
    } catch {
      // 汇总条是折叠呈现：读取失败不渲染数字也不吞掉事实——变更面板里会呈现完整错误。
      setSummary(null)
    }
  }, [sessionId])

  // 运行态转空闲（回合收尾）时重读；空闲期只读一次。
  useEffect(() => {
    if (running) return undefined
    void load()
    return undefined
  }, [running, load])

  if (running || summary === null || summary.total === 0) return null
  const { total: count, linesAdded, linesRemoved } = summary
  // `Pill` 本身就是 `button`（实测 `button.pill.interactive`）：外层再套一颗按钮会渲染出
  // 嵌套可聚焦元素（HTML 非法、AT 行为未定义、点击双触发），故点击直接落在 Pill 上。
  return (
    <Pill onClick={openChanges}>
      <span className={styles.value}>
        {t(count === 1 ? 'changes.summaryOne' : 'changes.summary', { count, added: linesAdded, removed: linesRemoved })}
      </span>
    </Pill>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineConversationKey }
