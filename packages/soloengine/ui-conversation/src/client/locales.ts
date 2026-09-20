/** `@soloengine/ui-conversation` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineConversation'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'status.running': '运行中',
  'status.idle': '空闲',
  'context.project': '项目',
  'context.mode': '运行模式',
  'mode.ask': '逐次审批',
  'mode.allowlist': '白名单',
  'mode.auto': '自动',
  'preview.title': '预览',
  'preview.open': '打开 {title}',
  'preview.utilities': '预览记录',
  'preview.empty': '暂无预览记录',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'status.running': 'Running',
  'status.idle': 'Idle',
  'context.project': 'Project',
  'context.mode': 'Run mode',
  'mode.ask': 'Ask every time',
  'mode.allowlist': 'Allowlist',
  'mode.auto': 'Auto',
  'preview.title': 'Preview',
  'preview.open': 'Open {title}',
  'preview.utilities': 'Previews',
  'preview.empty': 'No previews yet',
}

/** 本命名空间的键集联合。 */
export type SoloengineConversationKey = keyof typeof zh
