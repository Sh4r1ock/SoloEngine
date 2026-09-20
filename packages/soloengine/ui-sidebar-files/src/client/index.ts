/**
 * `@soloengine/ui-sidebar-files` 的浏览器半：编辑型文件树（接管官方只读 `files` 档）。
 *
 * 依据 PRD-08 FR-OPS-010/012 与《SoloEngine Harness插件体系完整介绍》§三 文件树：
 * 以**同名 kind `files` 的 `extension` 档**注册（官方档位契约：extension 生效、builtin 在
 * extension 卸载后恢复），读复用平台工作区文件能力（`remote.workspaceFiles.list` 懒加载 +
 * `changes` 变更流），人写入走产品自己的接口（操作区桥 + 沙箱根约束）。
 *
 * @module @soloengine/ui-sidebar-files/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@soloengine/types'
import { FilesTree, type FilesFace } from './FilesTree.tsx'
import { en, NS, zh, type SoloengineFilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 文件树文案。 */
    soloengineFiles: SoloengineFilesKey
  }
}

/** 需要的服务：槽位、右栏 tab 注册表、本地化、远程工作区文件命名空间。 */
export const inject = ['slots', 'sidebarRightTabs', 'locale', 'remote', 'remote.workspaceFiles']

/** 本实现在 tab 系统中的身份（一个 kind 的 extension 档）。 */
const FILES_ID = '@soloengine/ui-sidebar-files'

/**
 * 浏览器插件体：以 extension 档接管 `files` kind 并注册面板正文。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-sidebar-files:dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: FILES_ID,
    kind: 'files',
    priority: 'extension',
    title: () => t('files.type'),
    guide: [{
      id: 'workspace',
      order: 10,
      title: () => t('files.guide.title'),
      description: () => t('files.guide.description'),
    }],
  }), 'soloengine-ui-sidebar-files:type')

  const face = (sessionId: SessionId): FilesFace => ({
    list: async (path, signal) => {
      const result = await ctx.remote.workspaceFiles.list(sessionId, path, signal)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    },
    changes: async function* changes(signal: AbortSignal) {
      // 平台变更流经 `$stream` 托管（重连与背压由 Remote 负责）；本迭代器负责按信号释放。
      const stream = ctx.remote.$stream<WorkspaceFileWatchFrame>({
        name: `soloengine file tree changes of ${String(sessionId)}`,
        open: inner => ctx.remote.workspaceFiles.changes(sessionId, inner),
        ended: () => new Error(`soloengine file tree change stream of ${String(sessionId)} ended`),
      })
      const release = (): void => { void stream.dispose() }
      signal.addEventListener('abort', release, { once: true })
      try {
        for await (const item of stream) {
          item.accept()
          yield item.value
        }
      } finally {
        signal.removeEventListener('abort', release)
        await stream.dispose()
      }
    },
  })

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: FILES_ID,
    locale: NS,
    inject: face,
  }, FilesTree))
  console.log('soloengine-ui-sidebar-files: editable file tree registered as the extension band of kind "files"')
}
