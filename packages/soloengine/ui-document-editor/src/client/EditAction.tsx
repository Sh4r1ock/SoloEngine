/**
 * 官方文档工具栏上的「编辑」动作（R190 的原生入口）。
 *
 * 座位 `sidebar.right.tab.document.actions` 由官方 `ui-sidebar-documentpreview` 声明，
 * owner 只带 `absolutePath`；会话由座位的 session 作用域提供。点击即以编辑器 kind
 * 打开同一地址——查看仍留在官方预览，编辑是一个显式的新增动作。
 *
 * @module @soloengine/ui-document-editor/EditAction
 */

import type { ReactNode } from 'react'
import { Button, IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { SoloengineEditorKey } from './locales.ts'

/** 动作组件经 slot `inject` 收到的打开能力。 */
export interface EditActionInjected {
  /**
   * 以编辑器 kind 打开一个绝对路径。
   * @param sessionId - 当前 tab 所属会话。
   * @param absolutePath - 官方预览给出的文件绝对路径。
   */
  readonly openEditor: (sessionId: SessionId, absolutePath: string) => void
}

/** 动作组件 props：座位 owner + 本地化 + 打开能力。 */
export type EditActionProps =
  PropsRuntime<'sidebar.right.tab.document.actions'>
  & PropsLocale<'soloengineEditor'>
  & EditActionInjected

/**
 * 渲染「编辑」按钮。
 * @param props - 文件绝对路径、会话、打开能力与本地化。
 * @returns 工具栏按钮。
 */
export function EditAction({ absolutePath, sessionId, openEditor, t }: EditActionProps): ReactNode {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t('editor.open')}
      title={t('editor.open')}
      data-soloengine-edit
      onClick={() => { openEditor(sessionId, absolutePath) }}
    >
      <IconEditOutlineRegular />
      {t('editor.open')}
    </Button>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineEditorKey }
