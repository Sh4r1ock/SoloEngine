/**
 * 工具跟随联动层（PRD-08 FR-OPS-011 / FR-OPS-004）。
 *
 * 数据：宿主权威投影 `soloengine.followIntent`（由工具自己的 `presentCall` 派生）与
 * `soloengine.runContext`（画布全局「实时跟随」开关）。本组件**只做分派**：
 * 按呈现意图的卡片判别打开/聚焦对应面板并定位——**没有任何「工具名 → 面板」映射表**，
 * 新工具（含第三方 MCP 工具）自带定位元数据即自动生效。
 *
 * 「实时跟随」关闭时只打开不抢焦点：`revealIfOpened: false`（已开的同内容标签不被聚焦）。
 *
 * 右栏的会话座（session surface）由 `ui-sidebar-right` 在会话选中的**同一帧之后**挂载，
 * 故分派必须等待座位就位：座位未就位时 `openResource`/`openTab` 会抛
 * 「no session surface is mounted」。本组件以有界重试等待座位，**不静默吞错**——
 * 重试耗尽即把失败原文呈现出来（fail loud）。
 *
 * @module @soloengine/ui-operation-area/FollowWatcher
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { SoloengineOpsKey } from './locales.ts'

/** 联动层注入面：普通回调（非可观察源），由注册方绑定 ctx.sidebarRight。 */
export interface FollowFace {
  /** 打开资源地址（focus=false 时不聚焦已开标签）。 */
  openFile: (address: string, line: number | undefined, focus: boolean) => void
  /** 打开/聚焦终端面板。 */
  openTerminal: (focus: boolean) => void
}

/** 会话头工具座位上的联动层 props。 */
export type FollowWatcherProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'soloengineOps'>
  & FollowFace

/** 等待右栏座位就绪的有界重试参数（座位通常在数帧内挂载）。 */
const RETRY_DELAY_MS = 100
const RETRY_ATTEMPTS = 60

/**
 * 渲染空节点并在呈现意图变化时执行一次跟随分派。
 * @param props - session 作用域标准座位、注入面与本地化座位。
 * @returns 失败说明节点，或 null。
 */
export function FollowWatcher({ useProjection, useSessions, sessionId, openFile, openTerminal, t }: FollowWatcherProps) {
  const intent = useProjection('soloengine.followIntent')
  const context = useProjection('soloengine.runContext')
  const cwd = useSessions(snapshot => snapshot.byId[sessionId]?.cwd)
  // 同一次调用只跟随一次（投影在其它事件到达时也会重算，但值不变即不重复分派）。
  const handled = useRef<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (intent === undefined || intent === null) return undefined
    if (handled.current === intent.callId) return undefined
    handled.current = intent.callId
    const liveFollow = context === undefined || context === null ? true : context.liveFollow
    const location = intent.locations[0]
    const dispatch = (): void => {
      if (intent.card === 'terminal') openTerminal(liveFollow)
      else if (location !== undefined) openFile(fileAddressFor(sessionId, cwd, location.path), location.line, liveFollow)
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const attempt = (): void => {
      if (cancelled) return
      try {
        dispatch()
        setFailure(null)
      } catch {
        attempts += 1
        if (attempts >= RETRY_ATTEMPTS) {
          // 重试耗尽即如实报失败（不静默吞错），但给人看的是**已判定的原因**：
          // 这条路径上唯一的可能就是右栏会话座位始终没挂载，原生抛的是英文诊断原文。
          setFailure(t('follow.failed'))
          return
        }
        timer = setTimeout(attempt, RETRY_DELAY_MS)
      }
    }
    attempt()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [intent, context, cwd, sessionId, openFile, openTerminal, t])

  if (failure === null) return null
  return <span role="alert">{failure}</span>
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineOpsKey }
