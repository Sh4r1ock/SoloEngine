/** `@soloengine/ui-document-editor` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineEditor'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'editor.title': '编辑器',
  'editor.open': '编辑',
  'editor.reload': '重新读取',
  'editor.save': '保存',
  'editor.saving': '保存中…',
  'editor.saved': '已写回项目目录',
  'editor.dirty': '有未保存的改动',
  'editor.conflict': '磁盘上的内容已被其他写入改动（版本冲突），请重新打开后再编辑',
  'editor.error': '写入失败',
  'editor.errorNetwork': '无法连接本地服务，请确认 Host 正在运行',
  'editor.errorUnknown': '未知错误',
  'editor.errorExists': '该名称已存在，未覆盖它',
  'editor.errorNotFound': '该文件已不存在，可能被其他操作删除',
  'editor.errorParentMissing': '上级目录不存在，请先创建它',
  'editor.errorTooLarge': '内容过大，超出单次写入上限',
  'editor.errorForbidden': '当前权限不允许写入该文件，或它不在本会话的工作区内',
  'editor.errorNoProject': '该会话没有可解析的工作目录，无法写回',
  'editor.errorNotText': '该文件不是 UTF-8 文本，不能在这里编辑',
  'editor.incomplete': '文件仍在分页读取，读全前不能保存（保存会整文件写回，截断会丢内容）',
  'editor.outsideWorkspace': '该文件不在本会话的工作区内，只能查看，不能从这里保存',
  'editor.textAria': '编辑 {path}',
  'editor.textAriaReadonly': '文件内容（只读）',
  'editor.readonly': '只读查看',
  'editor.decoration': '变更装饰：本行被 agent 修改过',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'editor.title': 'Editor',
  'editor.open': 'Edit',
  'editor.reload': 'Reload',
  'editor.save': 'Save',
  'editor.saving': 'Saving…',
  'editor.saved': 'Written back to the project directory',
  'editor.dirty': 'Unsaved changes',
  'editor.conflict': 'The file changed on disk (version conflict); reopen it before editing again',
  'editor.error': 'Write failed',
  'editor.errorNetwork': 'Cannot reach the local service; check the Host is running',
  'editor.errorUnknown': 'Unknown error',
  'editor.errorExists': 'That name already exists; nothing was overwritten',
  'editor.errorNotFound': 'That file no longer exists; another operation may have deleted it',
  'editor.errorParentMissing': 'The parent directory does not exist; create it first',
  'editor.errorTooLarge': 'The content is too large for a single write',
  'editor.errorForbidden': 'The current permissions do not allow writing that file, or it is outside this session’s workspace',
  'editor.errorNoProject': 'This session has no resolvable working directory, so nothing can be written back',
  'editor.errorNotText': 'That file is not UTF-8 text, so it cannot be edited here',
  'editor.incomplete': 'The file is still being paged in; saving is disabled until it is fully loaded (a save writes the whole file)',
  'editor.outsideWorkspace': 'This file is outside the session workspace, so it can be viewed but not saved from here',
  'editor.textAria': 'Edit {path}',
  'editor.textAriaReadonly': 'File content (read-only)',
  'editor.readonly': 'Read-only',
  'editor.decoration': 'Change decoration: this line was modified by the agent',
}

/** 本命名空间的键集联合。 */
export type SoloengineEditorKey = keyof typeof zh
