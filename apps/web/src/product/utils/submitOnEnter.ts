/** 弹层表单的 Enter 提交。 */
import type { KeyboardEvent } from 'react'

/** 可触发提交的输入类型：文本类输入；多行文本、勾选、单选与下拉保留浏览器自身语义。 */
const TEXT_ENTRY_TYPES = new Set(['text', 'password', 'email', 'number', 'search', 'tel', 'url'])

/**
 * 表单内按 Enter 提交。
 *
 * 弹层的提交按钮经 `form="..."` 放在表单之外的页脚，这类表单在部分输入原语/浏览器组合下
 * 不触发隐式提交（登录页已按同一原因逐个输入显式处理）。挂在 `<form>` 上统一处理：
 * 新增字段不必重复接线，多行文本框仍保留换行。
 * @param event - 表单的 keydown 事件。
 */
export function submitFormOnEnter(event: KeyboardEvent<HTMLFormElement>): void {
  // 输入法组字中的 Enter 是确认候选词，不是提交。
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !TEXT_ENTRY_TYPES.has(target.type)) return
  event.preventDefault()
  event.currentTarget.requestSubmit()
}
