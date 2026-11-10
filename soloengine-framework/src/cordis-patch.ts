/**
 * Cordis 组合层（patch 文档）的唯一解析实现。
 *
 * 组合的**运行时语义**归原生 Loader（`ctx.loader`）：行合并、`!!js` 求值、匹配不到即跳过
 * 都由它完成，框架层不再复刻。本模块只服务**需要行级摘要的只读消费方**（打包层清单），
 * 因此只把 YAML 读成结构化的行，不求值任何表达式（`!!js` 保持为数据）。
 *
 * @module @soloengine/framework/cordis-patch
 */

import yaml from 'js-yaml'
import { FrameworkError } from './modules/accounts.ts'

/** 组合层里的一行（`insert` 插入行或顶层 `- id:` 覆盖行）。 */
export interface PatchRow {
  id: string
  /** 该行声明的插件包名（覆盖行可能缺省，由更早的层提供）。 */
  name?: string
  /** 是否为 `insert` 插入行（false 表示顶层 `- id:` 覆盖行）。 */
  inserted: boolean
  /** `insert` 行所属的组 id（`- id: group` + `insert:` 的装载语义；顶层 append 时缺省）。 */
  insertInto?: string
  /** 除 id 外的键名（用于摘要，保持文件内出现顺序）。 */
  keys: string[]
  /** 原始 disabled 值（布尔或 `!!js` 表达式标记）。 */
  disabled?: unknown
}

/** `!!js` 表达式在解析结果里的标记（不求值，只保留源码文本）。 */
export interface JsExpression {
  __js: string
}

/** `!!js` 自定义标签（js-yaml 默认 schema 不认该标签）。 */
export const jsExpressionType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: unknown) => typeof data === 'string',
  construct: (data: unknown) => ({ __js: String(data) }),
})

/** 组合层解析 schema。 */
const PATCH_SCHEMA = yaml.DEFAULT_SCHEMA.extend([jsExpressionType])

/** 判定是否为 `!!js` 表达式标记。 */
export function isJsExpression(value: unknown): value is JsExpression {
  return value !== null && typeof value === 'object' && '__js' in (value as Record<string, unknown>)
}

/** 校验并归一化一行。 */
function assertRow(raw: unknown, label: string, inserted: boolean): PatchRow {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a row that is not an object`)
  }
  const row = raw as Record<string, unknown>
  const id = row.id
  if (typeof id !== 'string' || id === '') {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a row without a non-empty id`)
  }
  const keys = Object.keys(row).filter(key => key !== 'id')
  const parsed: PatchRow = { id, inserted, keys }
  if (typeof row.name === 'string') parsed.name = row.name
  if (row.disabled !== undefined) parsed.disabled = row.disabled
  return parsed
}

/**
 * 解析一份 cordis patch 文档为行清单（保持文件内顺序）。
 * @param text - YAML 全文。
 * @param label - 用于错误定位的文件标识。
 * @returns 行清单。
 */
export function parsePatchDocument(text: string, label: string): PatchRow[] {
  let doc: unknown
  try {
    doc = yaml.load(text, { schema: PATCH_SCHEMA })
  } catch (error) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} is not valid YAML: ${String(error)}`)
  }
  if (doc === null) return []
  if (!Array.isArray(doc)) {
    throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} must be a YAML array of patch entries`)
  }
  const rows: PatchRow[] = []
  for (const element of doc) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) {
      throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} carries a non-object patch entry`)
    }
    const entry = element as Record<string, unknown>
    const insert = entry.insert
    if (insert !== undefined) {
      if (!Array.isArray(insert)) {
        throw new FrameworkError(422, 'PLUGIN_PATCH_INVALID', `${label} has an insert that is not an array`)
      }
      // `- id: <group>` + `insert:` 的语义是「插入该组」，与顶层 append 不同：
      // 记下组 id，摘要按装载语义呈现（PatchOptions 的同一条读取规则）。
      const group = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined
      for (const item of insert) {
        const row = assertRow(item, label, true)
        if (group !== undefined) row.insertInto = group
        rows.push(row)
      }
      continue
    }
    rows.push(assertRow(element, label, false))
  }
  return rows
}
