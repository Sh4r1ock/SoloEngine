/**
 * `@soloengine/client-bootstrap` 的浏览器半：URL 直达会话与启动接线。
 *
 * 依据 PRD-07 FR-UI-019 与《SoloEngine 框架设计》§4.8：运行面板按会话键区分 URL
 * （`/run/<sessionKey>`）；本插件在启动时读取路径，等会话列表基线就绪后把该会话选为当前
 * （`ctx.sessions.open`），使固定入口直进该会话。未知会话键**明确报错**，不静默停在空白页。
 *
 * 不做路由框架、不做第二份状态：只把 URL 这一段事实翻译为一次原生会话选择。
 *
 * @module @soloengine/client-bootstrap/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** 运行面板深链的路径前缀（与 `@soloengine/host` 的前缀路由一致）。 */
export const RUN_PATH_PREFIX = '/run/'

/** 需要的服务：会话控制器（会话列表基线与选择）。 */
export const inject = ['sessions']

/**
 * 从路径取运行会话键。
 * @param pathname - `location.pathname`。
 * @returns 会话键，或 undefined（非运行面板深链）。
 */
export function sessionKeyFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith(RUN_PATH_PREFIX)) return undefined
  const key = pathname.slice(RUN_PATH_PREFIX.length).split('/')[0]
  return key === undefined || key === '' ? undefined : decodeURIComponent(key)
}

/**
 * 浏览器插件体：等待会话列表就绪并把 URL 指向的会话选为当前。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  const key = sessionKeyFromPath(location.pathname)
  if (key === undefined) return
  const target = key as SessionId
  ctx.effect(() => {
    /** 只认领一次：选择会同步触发列表通知，重入必须被挡在 open 之前（否则无限递归）。 */
    let settled = false
    const select = (): boolean => {
      if (settled) return true
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') return false
      settled = true
      if (!snapshot.ids.includes(target)) {
        // 会话列表已就绪仍无该键：明确报错（不静默停在空白页、不降级到别的会话）。
        console.error(
          `soloengine-client-bootstrap: session ${key} from ${location.pathname} is not in the host session list`,
        )
        return true
      }
      ctx.sessions.open(target)
      console.log(`soloengine-client-bootstrap: selected session ${key} from ${location.pathname}`)
      return true
    }
    if (select()) return () => {}
    const off = ctx.sessions.list.subscribe(() => {
      if (select()) off()
    })
    return off
  }, 'soloengine-client-bootstrap: open the session addressed by the URL')
}
