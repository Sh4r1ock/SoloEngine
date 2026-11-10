/** 页面搜索框的全局快捷键（原型 app.js:650-659：Ctrl/Cmd+K 聚焦搜索）。 */
import { useEffect, type RefObject } from 'react'

/**
 * 把 Ctrl/Cmd+K 绑定到给定搜索框。
 * @param target - 页面搜索输入框引用。
 */
export function useSearchShortcut(target: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      // 模态层打开时焦点归对话框所有：快捷键不得把焦点挪到遮罩后的搜索框。
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return
      event.preventDefault()
      target.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [target])
}
