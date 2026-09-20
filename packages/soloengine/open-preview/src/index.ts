/**
 * `@soloengine/open-preview` —— 预览记录的消费侧（完全自研，Host 面）。
 *
 * 依据 PRD-06 FR-ENG-032 与《SoloEngine Harness插件体系完整介绍》§五 open-preview：
 * - 生产侧：`open_preview` 工具经官方 `session.append('soloengine/preview', …)` 写日志；
 * - 消费侧：本插件把该事件族折叠为会话投影 `soloengine.openPreview`——新到旧排序、
 *   同链接去重刷新（置顶）、上限 50 条；面板经官方投影推送帧消费（宿主权威、客户端只读）；
 * - 全程走官方原生通道（append + 投影注册表），不自建事件通道、不落第二副本。
 *
 * @module @soloengine/open-preview
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import { registerOpenPreviewTool } from './tool.ts'
import type { PreviewRecord } from './types.ts'

export type { PreviewRecord } from './types.ts'
export { registerOpenPreviewTool, validatePreviewUrl, type PreviewToolValue } from './tool.ts'

export const name = 'soloengine-open-preview'
export const inject = ['sessionProjections', 'tools']

/** 每个会话保留的预览记录上限（PRD-06 FR-ENG-032）。 */
export const PREVIEW_LIMIT = 50

/** 投影状态/线值的 zod 校验（持久缓存先验）。 */
const previewRecordSchema = zod.object({
  url: zod.string(),
  title: zod.string(),
  sessionId: zod.string(),
  at: zod.number(),
})

/** 线值与状态同形（宿主权威、客户端只读）。 */
const previewListSchema = zod.array(previewRecordSchema)

/**
 * 预览列表折叠：同链接去重刷新（新记录置顶），超出上限淘汰最旧。
 * @param state - 当前列表（新到旧）。
 * @param record - 本次记录。
 * @returns 折叠后的新列表（无变化时返回同一引用）。
 */
export function foldPreview(state: readonly PreviewRecord[], record: PreviewRecord): PreviewRecord[] {
  const withoutDuplicate = state.filter(entry => entry.url !== record.url)
  const next = [record, ...withoutDuplicate].slice(0, PREVIEW_LIMIT)
  if (
    next.length === state.length
    && next.every((entry, index) => {
      const previous = state[index]
      return previous !== undefined
        && previous.url === entry.url
        && previous.title === entry.title
        && previous.sessionId === entry.sessionId
        && previous.at === entry.at
    })
  ) {
    return state as PreviewRecord[]
  }
  return next
}

/** 会话投影单元：`soloengine.openPreview`。 */
export const previewProjectionDefinition = {
  key: 'soloengine.openPreview',
  stateVersion: 1,
  stateSchema: previewListSchema,
  init: () => [],
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'soloengine/preview') return state
    const data = event.data
    return foldPreview(state, {
      url: data.url,
      title: data.title === undefined || data.title.trim() === '' ? data.url : data.title.trim(),
      sessionId: data.sessionId,
      at: event.time,
    })
  },
  wire: {
    viewSchema: previewListSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'soloengine.openPreview', PreviewRecord[]>

/**
 * 注册预览记录投影与 `open_preview` 工具（注册即可逆效果：卸载即撤销）。
 * @param ctx - 插件上下文（必须注入 `sessionProjections` 与 `tools`）。
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(previewProjectionDefinition)
  registerOpenPreviewTool(ctx)
  // 可取证行走 console：本 profile 未挂 logger-console，logger 输出不进启动日志。
  console.log(`soloengine-open-preview: registered projection "soloengine.openPreview" (limit ${String(PREVIEW_LIMIT)}) and tool "open_preview"`)
}
