/**
 * `@soloengine/ui-conversation` 的浏览器半：会话头产品信息层级 + 预览记录对话节点。
 *
 * 依据 PRD-07 FR-UI-006 / FR-UI-007 / FR-UI-020 与《SoloEngine 框架设计》§4.5：
 * - 会话头「动作」座位叠加运行状态 / 当前项目 / 运行模式（投影数据）；
 * - 会话头「工具」座位叠加预览记录入口（投影数据）；
 * - `soloengine/preview` 事件族以**原生对话节点**形式注册（Definition + 键控渲染器两步），
 *   与 dsh 工作流节点同构，不自建第二份渲染。
 *
 * @module @soloengine/ui-conversation/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// 事件族与投影键的声明合并（soloengine/preview 事件、soloengine.runContext 投影）。
import type {} from '@soloengine/open-preview/types'
import type {} from '@soloengine/types'
import { ChangesSummary, type ChangesFace } from './ChangesSummary.tsx'
import { PreviewCard } from './PreviewCard.tsx'
import { PreviewList, type PreviewFace } from './PreviewList.tsx'
import { SessionContext } from './SessionContext.tsx'
import { previewDefinition } from './preview-definition.ts'
import { en, NS, zh, type SoloengineConversationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 会话头叠加与预览卡文案。 */
    soloengineConversation: SoloengineConversationKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /**
     * 操作区浏览器面板的导航参数：`url` 为目标地址。
     *
     * **发送方声明**：本包（预览记录入口，FR-OPS-008）是唯一以参数打开该 kind 的调用方，
     * 故由本包声明它实际发送的形状；面板体（`@soloengine/ui-operation-area`）按同一约定读取。
     * 右栏契约明文说明参数为「JSON-shaped by convention，不在运行期校验」。
     */
    'soloengine-browser': { url?: string }
  }
}

/** 需要的服务：对话事件注册表、槽位注册表、会话座位、右栏导航与本地化运行时。 */
export const inject = ['uiConversation', 'slots', 'sessions', 'sidebarRight', 'locale']

/**
 * 浏览器插件体：注册字典、对话节点定义与三个座位占位。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-conversation:dictionaries')
  /** 预览入口的注入面：点击一条预览记录即在浏览器面板的当前标签打开该地址。 */
  const previewFace = (): PreviewFace => ({
    openPreview: (url: string) => {
      ctx.sidebarRight.openTab('soloengine-browser', { params: { url } })
    },
  })
  // 事件族 → 对话节点（Definition 一步）。
  ctx.uiConversation.events.register(previewDefinition)
  // 节点 → 键控渲染器（键控槽一步）。
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'soloengine-preview',
    locale: NS,
  }, PreviewCard))
  // 会话头叠加：动作座位（运行状态 / 当前项目 / 运行模式）与工具座位（预览记录）。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'soloengine.session-context', locale: NS },
    SessionContext,
  ))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: 'soloengine.previews', locale: NS, inject: previewFace },
    PreviewList,
  ))
  // 消息区变更汇总条（PRD-09 FR-FC-006 三处同源）：读同一份台账，点击开变更面板。
  const changesFace = (): ChangesFace => ({
    openChanges: () => {
      ctx.sidebarRight.openTab('soloengine-changes', { revealIfOpened: true })
    },
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: 'soloengine.changes-summary', locale: NS, inject: changesFace },
    ChangesSummary,
  ))
}
