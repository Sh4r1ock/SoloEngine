/** `@soloengine/ui-brand` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineBrand'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'brand.name': 'SoloEngine',
  'brand.mark.label': 'SoloEngine 标识',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'brand.name': 'SoloEngine',
  'brand.mark.label': 'SoloEngine mark',
}

/** 本命名空间的键集联合。 */
export type SoloengineBrandKey = keyof typeof zh
