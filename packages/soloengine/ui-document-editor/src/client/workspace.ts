/**
 * 编辑器的写回面：原生 `workspaceFiles` 的 `stat` 与 `write`。
 *
 * 读（文档正文）由官方 documentpreview 经资源系统完成；本模块只补**保存**与
 * 保存所需的版本号。路径、沙箱门禁与工作区归属全部由 Host 的
 * `@deepseek-ai/dsh-api-workspace-files` 判定，前端不拼接、不比较路径。
 *
 * @module @soloengine/ui-document-editor/workspace
 */

import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { WorkspaceFileBytes, WorkspaceFileStat, WorkspaceFileText } from '@deepseek-ai/dsh-api-workspace-files/types'

/** 编辑器需要的四个远程调用。 */
export interface EditorWorkspace {
  /**
   * 取当前文件的版本（乐观锁）。
   * @param sessionId - 所属会话。
   * @param path - 会话工作区内的路径。
   * @returns 文件元数据或结构化失败。
   */
  readonly stat: (sessionId: SessionId, path: string) => Promise<RemoteResult<WorkspaceFileStat>>
  /**
   * 读一页文本行（编辑器的正文来自这里，不再依赖只读预览渲染器）。
   * @param sessionId - 所属会话。
   * @param path - 会话工作区内的路径。
   * @param offset - 起始行（1 基）。
   * @returns 行窗口或结构化失败。
   */
  readonly read: (sessionId: SessionId, path: string, offset: number) => Promise<RemoteResult<WorkspaceFileText>>
  /**
   * 读一段原始字节（只用于判定文件末尾是否有换行：行窗口契约不携带该事实）。
   * @param sessionId - 所属会话。
   * @param path - 会话工作区内的路径。
   * @param offset - 起始字节（0 基）。
   * @param length - 读取长度。
   * @returns 字节窗口或结构化失败。
   */
  readonly readBytes: (
    sessionId: SessionId,
    path: string,
    offset: number,
    length: number,
  ) => Promise<RemoteResult<WorkspaceFileBytes>>
  /**
   * 整文件写回。
   * @param sessionId - 所属会话。
   * @param path - 会话工作区内的路径。
   * @param text - 完整新内容。
   * @param expectedVersion - 读到内容时的版本；省略则不校验新鲜度。
   * @returns 写入后的元数据或结构化失败。
   */
  readonly write: (
    sessionId: SessionId,
    path: string,
    text: string,
    expectedVersion: string | undefined,
  ) => Promise<RemoteResult<WorkspaceFileStat>>
}

/**
 * 把编辑器写回面绑定到一个 Remote。
 * @param remote - 携带 `workspaceFiles` 命名空间的客户端 Remote。
 * @returns 编辑器经 slot `inject` 收到的写回面。
 */
export function createEditorWorkspace(remote: ClientRemote): EditorWorkspace {
  return {
    stat: (sessionId, path) => remote.workspaceFiles.stat(sessionId, path),
    read: (sessionId, path, offset) => remote.workspaceFiles.read(sessionId, path, { offset }),
    readBytes: (sessionId, path, offset, length) => remote.workspaceFiles.readBytes(
      sessionId,
      path,
      { range: { offset, length } },
    ),
    write: (sessionId, path, text, expectedVersion) => remote.workspaceFiles.write(
      sessionId,
      path,
      text,
      expectedVersion === undefined ? {} : { expectedVersion },
    ),
  }
}
