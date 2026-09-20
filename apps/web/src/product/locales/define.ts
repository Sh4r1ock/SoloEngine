/**
 * 字典构造器：`zh` 为键集真源，`en` 必须是同键集（缺键即类型错误）。
 */

/** 一份双语字典。 */
export interface Dictionary<Z extends Record<string, string>> {
  zh: Z
  en: Record<keyof Z, string>
}

/**
 * 声明一份双语字典。
 * @param zh - 中文文案（键集真源）。
 * @param en - 英文文案（键集必须与 zh 完全一致）。
 * @returns 冻结的双语字典。
 */
export function defineDictionary<Z extends Record<string, string>>(
  zh: Z,
  en: Record<keyof Z, string>,
): Dictionary<Z> {
  return { zh, en }
}
