/** 全局 Toast 区域：所有页面与壳层共用一个底部堆叠区域（原型 `.toast-region` 单实例）。 */
import { useCallback, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Toaster.module.css'

/** 提示语气：成功与失败必须可区分。 */
export type ToastTone = 'success' | 'error'

interface ToastEntry {
  id: number
  text: string
  tone: ToastTone
}

/** 应用级唯一队列；`useSyncExternalStore` 以本引用做快照，变更时才发布新数组。 */
let entries: readonly ToastEntry[] = []
let toastSeq = 0
const listeners = new Set<() => void>()

/**
 * 发布一条新队列。
 * @param next - 新队列。
 */
function publish(next: readonly ToastEntry[]): void {
  entries = next
  for (const listener of listeners) listener()
}

/**
 * 订阅队列变更。
 * @param listener - 变更回调。
 * @returns 取消订阅函数。
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 压入一条提示（模块级入口：页面与壳层写入同一队列）。
 * @param text - 已本地化文案。
 * @param tone - 成功或失败。
 */
export function showToast(text: string, tone: ToastTone = 'success'): void {
  toastSeq += 1
  publish([...entries, { id: toastSeq, text, tone }])
}

/**
 * 移除一条提示（由计时器结束触发）。
 * @param id - 条目 id。
 */
function removeToast(id: number): void {
  publish(entries.filter(entry => entry.id !== id))
}

/** Toast 宿主 API：页面只拿 `show`，区域由应用根挂载。 */
export interface ToastHost {
  /** 弹一条提示。 */
  show: (text: string, tone?: ToastTone) => void
}

/** 单条提示（自己持有稳定的 onDone，避免计时器被重建）。 */
function ToastItem({ entry, holdMs, onDone }: {
  entry: ToastEntry
  holdMs: number
  onDone: (id: number) => void
}) {
  const done = useCallback(() => { onDone(entry.id) }, [onDone, entry.id])
  // 设计参考 §5.4：role="status" + aria-live="polite"；行由宿主区域的列向堆叠排列，
  // 不在行上做视口定位（原型 .toast-region）。
  return <Toast text={entry.text} tone={entry.tone} holdMs={holdMs} role="status" stacked onDone={done} />
}

/**
 * 取得写入全局 Toast 区域的句柄。
 * @returns 仅含 `show` 的宿主 API；`show` 跨渲染稳定。
 */
export function useToastHost(): ToastHost {
  const show = useCallback((text: string, tone: ToastTone = 'success') => { showToast(text, tone) }, [])
  return { show }
}

/**
 * 渲染应用级唯一 Toast 区域；挂在应用根（`main.tsx`），页面不再各自持有区域。
 * @param props.holdMs - 完整不透明保持时长（设计参考 §5.4：3.2s 后自动消失）。
 * @returns 底部堆叠区域；没有提示时为 null。
 */
export function ToastRegion({ holdMs = 3200 }: { holdMs?: number }) {
  const list = useSyncExternalStore(subscribe, () => entries, () => entries)
  if (list.length === 0) return null
  // 区域挂到 body：页面里的变换/裁切祖先不会把固定层困在自己的盒子里。
  return createPortal(
    <div className={css.region}>
      {list.map(entry => <ToastItem key={entry.id} entry={entry} holdMs={holdMs} onDone={removeToast} />)}
    </div>,
    document.body,
  )
}
