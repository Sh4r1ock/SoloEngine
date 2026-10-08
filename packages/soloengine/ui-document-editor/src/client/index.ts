/**
 * `@soloengine/ui-document-editor` 的浏览器半：在官方 `documentPreviews` 注册表上补编辑与 Office。
 *
 * 依据 PRD-08 FR-OPS-006 与《SoloEngine Harness插件体系完整介绍》§四 ui-agentic：
 * 官方 `ui-sidebar-documentpreview` 提供**文档面板机制**（`text` 页面类型 + 渲染器注册表 +
 * 纯文本兜底），SoloEngine 在其上补两件事——
 * 1. **编辑能力**：文本/代码/Markdown 以 `extension` 档渲染器（可编辑 + 保存写回项目目录）；
 * 2. **Office 渲染器**：`.docx`/`.xlsx`/`.pptx` 浏览器内解析（**不引入任何外部 Document Server 端口**）。
 *
 * 未认领扩展名仍落官方纯文本兜底（本包不改其行为）。
 *
 * @module @soloengine/ui-document-editor/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// 工具呈现意图投影键的声明合并（编辑器变更装饰与台账同源）。
import type {} from '@soloengine/types'
import { EditorView } from './EditorView.tsx'
import { OfficeView } from './OfficeView.tsx'
import { en, NS, zh, type SoloengineEditorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 编辑器/文档面板文案。 */
    soloengineEditor: SoloengineEditorKey
  }
}

/** 需要的服务：槽位、文档渲染器注册表、本地化。 */
export const inject = ['slots', 'documentPreviews', 'locale']

/** 可编辑文本渲染器 id。 */
const EDITOR_ID = '@soloengine/ui-document-editor/text'
/** Office 渲染器 id。 */
const OFFICE_ID = '@soloengine/ui-document-editor/office'

/** 可编辑文本类扩展名（含 Markdown 与常见代码）。 */
const EDITABLE_EXTENSIONS = [
  '.md', '.markdown', '.mdx', '.txt', '.log', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.env',
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.ps1', '.psm1',
  '.sql', '.graphql', '.proto', '.css', '.scss', '.less', '.html', '.htm', '.vue', '.svelte', '.xml', '.svg',
  '.csv', '.tsv', '.gitignore', '.editorconfig',
]

/** Office 扩展名（浏览器内解析）。 */
const OFFICE_EXTENSIONS = ['.docx', '.xlsx', '.pptx']

/**
 * 浏览器插件体：注册可编辑文本渲染器与 Office 渲染器。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-document-editor:dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.documentPreviews.register({
    id: EDITOR_ID,
    extensions: EDITABLE_EXTENSIONS,
    priority: 'extension',
    title: () => t('editor.title'),
    loading: 'text-pages',
    wrap: true,
  }), 'soloengine-ui-document-editor:textRenderer')
  ctx.slots.register({ name: 'sidebar.right.tab.document', key: EDITOR_ID, locale: NS }, EditorView)

  ctx.effect(() => ctx.documentPreviews.register({
    id: OFFICE_ID,
    extensions: OFFICE_EXTENSIONS,
    binaryExtensions: OFFICE_EXTENSIONS,
    priority: 'extension',
    title: () => t('office.title'),
    loading: 'bytes-complete',
  }), 'soloengine-ui-document-editor:officeRenderer')
  ctx.slots.register({ name: 'sidebar.right.tab.document', key: OFFICE_ID, locale: NS }, OfficeView)
}
