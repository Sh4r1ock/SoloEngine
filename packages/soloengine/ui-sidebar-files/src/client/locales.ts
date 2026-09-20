/** `@soloengine/ui-sidebar-files` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineFiles'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'files.type': '文件',
  'files.guide.title': '工作区文件',
  'files.guide.description': '懒加载目录树，可新建/重命名/删除',
  'files.search.placeholder': '搜索文件名…',
  'files.search.clear': '清除搜索',
  'files.search.empty': '没有匹配的文件',
  'files.new.file': '新建文件',
  'files.new.folder': '新建目录',
  'files.rename': '重命名',
  'files.delete': '删除',
  'files.collapse': '收起',
  'files.expand': '展开',
  'files.name.prompt': '输入名称（相对当前目录）',
  'files.confirm.delete': '确认删除 {path}？该操作不可撤销',
  'files.confirm.rename': '确认把 {from} 重命名为 {to}？',
  'files.confirm.create': '确认新建 {path}？',
  'files.empty': '目录为空',
  'files.loading': '正在读取目录…',
  'files.error': '文件操作失败',
  'files.current': '当前文件',
  'files.root': '工作区根',
  'files.noRoot': '该会话尚无工作目录（运行项目未绑定），文件树不可用',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'files.type': 'Files',
  'files.guide.title': 'Workspace files',
  'files.guide.description': 'Lazy directory tree with create/rename/delete',
  'files.search.placeholder': 'Search file names…',
  'files.search.clear': 'Clear search',
  'files.search.empty': 'No matching file',
  'files.new.file': 'New file',
  'files.new.folder': 'New folder',
  'files.rename': 'Rename',
  'files.delete': 'Delete',
  'files.collapse': 'Collapse',
  'files.expand': 'Expand',
  'files.name.prompt': 'Enter a name (relative to the current directory)',
  'files.confirm.delete': 'Delete {path}? This cannot be undone',
  'files.confirm.rename': 'Rename {from} to {to}?',
  'files.confirm.create': 'Create {path}?',
  'files.empty': 'This directory is empty',
  'files.loading': 'Reading the directory…',
  'files.error': 'File operation failed',
  'files.current': 'Current file',
  'files.root': 'Workspace root',
  'files.noRoot': 'This session has no workspace directory (the run project is unbound); the file tree is unavailable',
}

/** 本命名空间的键集联合。 */
export type SoloengineFilesKey = keyof typeof zh
