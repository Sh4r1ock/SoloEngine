/**
 * `@soloengine/ui-document-editor` 的浏览器半：在官方文档预览之上补**编辑**能力。
 *
 * 依据 PRD-08 FR-OPS-006 / FR-OPS-007 与 R190：
 * - **查看**全部归官方 `ui-sidebar-documentpreview`（文本 / Office / Excel 各按官方渲染器）；
 * - **编辑**是原生没有的新增能力，注册为独立 tab 类型（kind `soloengine-editor`，无 patterns，
 *   只能按 kind 命名打开），入口是官方文档动作座位 `sidebar.right.tab.document.actions` 上的
 *   「编辑」按钮；
 * - 正文与保存全部经原生 `workspaceFiles.read` / `workspaceFiles.write`（工作区限定 + 版本乐观锁）。
 *
 * @module @soloengine/ui-document-editor/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
// 工具呈现意图投影键的声明合并（编辑器变更装饰与台账同源）。
import type {} from '@soloengine/types'
import { EDITOR_ID, EDITOR_KIND, editorDefinition } from './definition.ts'
import { EditAction } from './EditAction.tsx'
import { EditorView } from './EditorView.tsx'
import { en, NS, zh, type SoloengineEditorKey } from './locales.ts'
import { createEditorWorkspace } from './workspace.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 编辑器/文档面板文案。 */
    soloengineEditor: SoloengineEditorKey
  }
}

/** 需要的服务：槽位、tab 注册表、右栏服务、本地化、远程读写面（含工作区文件命名空间）。 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale', 'remote', 'remote.workspaceFiles']

/**
 * 浏览器插件体：注册编辑器 tab 类型、正文与官方文档动作。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-document-editor:dictionaries')

  ctx.effect(() => ctx.sidebarRightTabs.register(editorDefinition()), 'soloengine-ui-document-editor:type')

  const face = createEditorWorkspace(ctx.remote)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: EDITOR_ID, locale: NS, inject: () => face },
    EditorView,
  )), 'soloengine-ui-document-editor:body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register(
    {
      name: 'sidebar.right.tab.document.actions',
      id: 'soloengine-editor',
      locale: NS,
      inject: () => ({
        openEditor: (sessionId: SessionId, absolutePath: string): void => {
          ctx.sidebarRight.openResourceIn(
            sessionId,
            fileAddressFor(sessionId, undefined, absolutePath),
            { kind: EDITOR_KIND },
          )
        },
      }),
    },
    EditAction,
  )), 'soloengine-ui-document-editor:edit-action')
}
