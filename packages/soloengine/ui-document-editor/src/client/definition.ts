/**
 * 编辑器 tab 类型：只由「编辑」动作显式打开，不认领任何地址模式。
 *
 * 官方 `text` 类型以 `fallback` 档认领所有 `file:` 地址，是普通打开的落点；
 * 本类型**不登记 patterns**（`claim(address, kind)` 命名即决定，不查 glob），
 * 因此浏览/打开文件永远不会落到编辑器，只有官方文档动作座位上的「编辑」按钮会
 * 以 kind 打开它——查看仍归官方只读预览（R190）。
 *
 * @module @soloengine/ui-document-editor/definition
 */

import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** 编辑器 tab 的 kind（只经命名打开）。 */
export const EDITOR_KIND = 'soloengine-editor'

/** 本实现在 tab 系统中的身份（body / title 座位共用）。 */
export const EDITOR_ID = '@soloengine/ui-document-editor'

/**
 * 地址最后一个路径段的解码文本（仅用于 chip 文案）。
 * @param address - `file:` 形状的地址。
 * @returns 解码后的末段；无末段时返回地址本身。
 */
function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // 百分号序列畸形时仍按原文显示：能读的名字好过拒绝打开。
    return name
  }
}

/**
 * 编辑器类型的注册定义。
 * @returns 定义（无 patterns，只有命名打开）。
 */
export function editorDefinition(): SidebarRightTabDefinition {
  return {
    id: EDITOR_ID,
    kind: EDITOR_KIND,
    // 空 patterns：候选排序不会选中它；`claim(address, EDITOR_KIND)` 不看 globs。
    patterns: [],
    canOpen: address => parseFileAddress(address)?.scope === 'session',
    title: basenameOf,
  }
}
