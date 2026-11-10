/**
 * `sidebarFiles` namespace dictionaries, and the namespace's declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarFiles'>` or `PropsLocale<'sidebarFiles'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-tree type name, guide entry, row states, and failure lines. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'shortcut.noSession': '请先选择会话',
  'type.label': '文件',
  'guide.title': '工作区文件',
  'guide.description': '浏览会话工作区的文件',
  loading: '正在读取…',
  empty: '空目录',
  truncated: '条目太多，只显示了一部分。',
  noWorkspace: '这个会话没有工作区目录。',
  reload: '重新读取',
  autoRefresh: '自动刷新',
  'autoRefresh.enable': '开启自动刷新',
  'autoRefresh.disable': '关闭自动刷新',
  'entry.other': '这不是文件或目录，没法打开。',
  'search.open': '搜索文件',
  'search.close': '关闭搜索',
  'search.placeholder': '按名称搜索文件',
  'search.empty': '没有名称匹配的条目。',
  'search.truncated': '匹配太多，只列出了一部分。',
  'new.file': '新建文件',
  'new.directory': '新建目录',
  'action.rename': '重命名 {name}',
  'action.delete': '删除 {name}',
  'name.placeholder': '名称',
  'confirm.createFile': '新建文件 {path}？',
  'confirm.createDirectory': '新建目录 {path}？',
  'confirm.rename': '把 {name} 重命名为 {to}？',
  'confirm.removeFile': '删除文件 {name}？',
  'confirm.removeDirectory': '删除目录 {name} 及其全部内容？',
  'confirm.ok': '确认',
  'confirm.cancel': '取消',
  'error.notFound': '这个目录不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个目录在工作区之外，侧栏不会读取它。',
  'error.notDirectory': '这不是一个目录。',
  'error.exists': '同名条目已经存在。',
  'error.stale': '文件已被别处修改，请重新读取后再试。',
  'error.parentMissing': '上级目录不存在。',
  'error.symlink': '这个条目是符号链接，文件树不会跟随它改写。',
  'error.forbidden': '当前权限不允许这个操作。',
  'error.tooLarge': '内容超过了大小上限。',
  'error.network': '连接本地服务失败。',
  'error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** Files dictionary key union. */
export type SidebarFilesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'shortcut.noSession': 'Select a session first',
  'type.label': 'Files',
  'guide.title': 'Workspace files',
  'guide.description': 'Browse files in this session\'s workspace',
  loading: 'Reading…',
  empty: 'Empty directory',
  truncated: 'Too many entries, showing only some of them.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  autoRefresh: 'Auto refresh',
  'autoRefresh.enable': 'Enable auto refresh',
  'autoRefresh.disable': 'Disable auto refresh',
  'entry.other': 'Not a file or a directory, so it cannot be opened.',
  'search.open': 'Search files',
  'search.close': 'Close search',
  'search.placeholder': 'Search files by name',
  'search.empty': 'No entry matches that name.',
  'search.truncated': 'Too many matches, showing only some of them.',
  'new.file': 'New file',
  'new.directory': 'New directory',
  'action.rename': 'Rename {name}',
  'action.delete': 'Delete {name}',
  'name.placeholder': 'Name',
  'confirm.createFile': 'Create the file {path}?',
  'confirm.createDirectory': 'Create the directory {path}?',
  'confirm.rename': 'Rename {name} to {to}?',
  'confirm.removeFile': 'Delete the file {name}?',
  'confirm.removeDirectory': 'Delete the directory {name} and everything in it?',
  'confirm.ok': 'Confirm',
  'confirm.cancel': 'Cancel',
  'error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
  'error.notDirectory': 'That is not a directory.',
  'error.exists': 'An entry with that name already exists.',
  'error.stale': 'The file changed elsewhere; reload it and try again.',
  'error.parentMissing': 'The parent directory does not exist.',
  'error.symlink': 'That entry is a symbolic link, which the tree will not rewrite through.',
  'error.forbidden': 'The current permissions do not allow that.',
  'error.tooLarge': 'The content exceeds the size cap.',
  'error.network': 'Could not reach the local service.',
  'error.unavailable': 'Read failed: {message}',
} satisfies Record<SidebarFilesKey, string>
