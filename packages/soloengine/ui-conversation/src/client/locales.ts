/** `@soloengine/ui-conversation` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineConversation'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'status.running': '运行中',
  'status.idle': '空闲',
  'context.project': '项目',
  'context.mode': '运行模式',
  /* 运行模式三档的名字以设置面（画布编辑器节点面板 `editor.runMode*`）为准：
     同一选项在配置处叫「白名单自动」、在运行头叫「白名单」，用户无法确认是同一物
     （R3/R7 同语义同词）。EN 侧同理统一为 Automatic。 */
  'mode.ask': '逐次确认',
  'mode.allowlist': '白名单自动',
  'mode.auto': '全自动',
  'preview.title': '预览',
  'preview.utilities': '预览记录',
  'preview.empty': '暂无预览记录',
  'changes.summary': '文件变更 {count} 条（+{added} / −{removed}）',
  'changes.summaryOne': '文件变更 1 条（+{added} / −{removed}）',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'status.running': 'Running',
  'status.idle': 'Idle',
  'context.project': 'Project',
  'context.mode': 'Run mode',
  'mode.ask': 'Ask every time',
  'mode.allowlist': 'Allowlist',
  'mode.auto': 'Automatic',
  'preview.title': 'Preview',
  'preview.utilities': 'Previews',
  'preview.empty': 'No previews yet',
  'changes.summary': '{count} file changes (+{added} / −{removed})',
  'changes.summaryOne': '1 file change (+{added} / −{removed})',
}

/** 本命名空间的键集联合。 */
export type SoloengineConversationKey = keyof typeof zh
