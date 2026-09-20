/**
 * `soloengine/preview` 事件族的对话节点定义（PRD-06 FR-ENG-032 / PRD-07 FR-UI-007）。
 *
 * 每个预览事件折叠为一个独立对话节点（`kind: 'soloengine-preview'`），渲染器按类型注册到
 * 键控槽 `conversation.chat.node`——与 dsh 工作流节点同构的注册方式（Definition + 键控渲染器
 * 两步注册），不自建第二份渲染、不写中心分派器。
 *
 * `match` 只读当前事件（业务标识取事件 seq：一条预览事件即一个节点），`update` 恒返回同一
 * 状态引用（该族无后续更新），折叠按逻辑序号确定性重放。
 *
 * @module @soloengine/ui-conversation/preview-definition
 */

import type {
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 最终键控渲染数据：一条预览记录。 */
export interface SoloenginePreviewChatData {
  /** 预览链接（模型为其启动的本地服务或产物页面）。 */
  readonly url: string
  /** 可读标题（事件未带标题时以 URL 兜底，故恒为非空字符串）。 */
  readonly title: string
  /** 记录时刻（毫秒时间戳）。 */
  readonly at: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** 一条预览记录卡片。 */
    'soloengine-preview': SoloenginePreviewChatData
  }
}

/** 折叠状态：一条记录即一个节点，状态与最终数据同形。 */
type SoloenginePreviewState = SoloenginePreviewChatData

/** 预览记录的对话节点定义。 */
export const previewDefinition: ConversationNodeDefinition<SoloenginePreviewState> = {
  kind: 'soloengine-preview',
  target: 'chat',
  match: event => event.type === 'soloengine/preview'
    ? { id: `soloengine-preview:${String(event.seq)}`, role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'soloengine/preview') {
      throw new Error('soloengine-preview start requires soloengine/preview')
    }
    const data = match.event.data
    const title = data.title === undefined || data.title.trim() === '' ? data.url : data.title.trim()
    return { url: data.url, title, at: match.event.time }
  },
  // 该事件族一条事件即一个节点，无后续更新；保持同一引用以免产生多余下游工作。
  update: context => context.state,
  buildViewNode: (context: ConversationNodeContext<SoloenginePreviewState>): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'soloengine-preview',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state as SoloenginePreviewState,
    }
  },
}
