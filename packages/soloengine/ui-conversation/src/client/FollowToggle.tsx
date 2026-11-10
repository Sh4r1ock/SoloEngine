/**
 * 会话头「实时跟随」开关（PRD-02 FR-CANVAS-017）。
 *
 * 跟随属于「这一次运行怎么跑」：值来自 `soloengine/run-context` 投影（后写覆盖先写），
 * 切换经宿主运行设置桥写一条新事件，画布不再承载这个开关。
 *
 * @module @soloengine/ui-conversation/FollowToggle
 */

import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@soloengine/types'
import styles from './SessionContext.module.css'
import type { SoloengineConversationKey } from './locales.ts'

/** 开关 props：composer 左侧区标准座位 + 本地化座位。 */
export type FollowToggleProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'soloengineConversation'>

/**
 * 渲染实时跟随开关：读运行上下文投影，切换即写回。
 * @param props - session 作用域标准座位与本地化座位。
 * @returns 开关；该会话还没有运行上下文时 null。
 */
export function FollowToggle({ useProjection, sessionId, t }: FollowToggleProps) {
  const context = useProjection('soloengine.runContext')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (context === null || context === undefined) return null

  const change = (next: boolean): void => {
    setBusy(true)
    setFailed(false)
    void fetch('/soloengine/run-settings/live-follow', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: sessionId, liveFollow: next }),
    })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)) })
      .catch(() => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }

  return (
    <span className={styles.follow}>
      <span className={styles.value}>{t('follow.label')}</span>
      <Switch
        checked={context.liveFollow}
        label={t('follow.label')}
        disabled={busy}
        onChange={change}
      />
      {failed && <span className={styles.followError}>{t('follow.failed')}</span>}
    </span>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineConversationKey }
