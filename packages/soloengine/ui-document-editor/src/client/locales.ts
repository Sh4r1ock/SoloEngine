/** `@soloengine/ui-document-editor` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineEditor'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'editor.title': '编辑器',
  'editor.save': '保存',
  'editor.saving': '保存中…',
  'editor.saved': '已写回项目目录',
  'editor.dirty': '有未保存的改动',
  'editor.conflict': '磁盘上的内容已被其他写入改动（mtime 冲突），请重新打开后再编辑',
  'editor.error': '写入失败',
  'editor.readonly': '只读查看',
  'editor.decoration': '变更装饰：本行被 agent 修改过',
  'office.title': '文档',
  'office.unsupported': '无法渲染该 Office 文档：{reason}（已降级为只读说明，不做假成功）',
  'office.paragraphs': '{count} 段',
  'office.sheets': '{count} 个工作表',
  'office.slides': '{count} 页',
  'office.loading': '正在浏览器内解析…',
  'fallback.title': '纯文本兜底',
  'fallback.reason': '没有渲染器认领该扩展名（{ext}）：以只读说明呈现，不伪造内容',
  'fallback.binary': '该文件为二进制且无渲染器认领（{ext}）：明确不支持预览',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'editor.title': 'Editor',
  'editor.save': 'Save',
  'editor.saving': 'Saving…',
  'editor.saved': 'Written back to the project directory',
  'editor.dirty': 'Unsaved changes',
  'editor.conflict': 'The file changed on disk (mtime conflict); reopen it before editing again',
  'editor.error': 'Write failed',
  'editor.readonly': 'Read-only',
  'editor.decoration': 'Change decoration: this line was modified by the agent',
  'office.title': 'Document',
  'office.unsupported': 'This Office document cannot be rendered: {reason} (degraded to an explicit read-only notice, never a fake success)',
  'office.paragraphs': '{count} paragraphs',
  'office.sheets': '{count} sheets',
  'office.slides': '{count} slides',
  'office.loading': 'Parsing in the browser…',
  'fallback.title': 'Plain-text fallback',
  'fallback.reason': 'No renderer claims this extension ({ext}): shown as an explicit read-only notice, with no fabricated content',
  'fallback.binary': 'This is a binary file no renderer claims ({ext}): preview is explicitly unsupported',
}

/** 本命名空间的键集联合。 */
export type SoloengineEditorKey = keyof typeof zh
