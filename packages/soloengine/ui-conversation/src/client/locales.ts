/** `@soloengine/ui-conversation` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineConversation'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'preview.title': '预览',
  'preview.utilities': '预览记录',
  'preview.empty': '暂无预览记录',
  'changes.summary': '文件变更 {count} 条（+{added} / −{removed}）',
  'changes.summaryOne': '文件变更 1 条（+{added} / −{removed}）',
  'follow.label': '实时跟随',
  'follow.failed': '实时跟随保存失败',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'preview.title': 'Preview',
  'preview.utilities': 'Previews',
  'preview.empty': 'No previews yet',
  'changes.summary': '{count} file changes (+{added} / −{removed})',
  'changes.summaryOne': '1 file change (+{added} / −{removed})',
  'follow.label': 'Live follow',
  'follow.failed': 'Could not save live follow',
}

/** 本命名空间的键集联合。 */
export type SoloengineConversationKey = keyof typeof zh
