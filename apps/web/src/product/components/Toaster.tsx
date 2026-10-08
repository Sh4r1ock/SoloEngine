/** Toast 宿主：一次性提示条（成功/失败都走这里，不静默）。 */
import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'

interface ToastEntry {
  id: number
  text: string
}

/** Toast 宿主 API。 */
export interface ToastHost {
  /** 弹一条提示。 */
  show: (text: string) => void
  /** 需要渲染的宿主节点。 */
  node: ReactNode
}

/** 单条提示（自己持有稳定的 onDone，避免计时器被重建）。 */
function ToastItem({ entry, holdMs, onDone }: {
  entry: ToastEntry
  holdMs: number
  onDone: (id: number) => void
}) {
  const done = useCallback(() => { onDone(entry.id) }, [onDone, entry.id])
  return <Toast text={entry.text} holdMs={holdMs} onDone={done} />
}

/**
 * 提示条目 id 发生器：单调自增。
 * 此前用 `Date.now() + previous.length`，同一毫秒内「先移除再新增」会算出与在场条目
 * 相同的 id → React 重复 key（控制台报错，R25）。
 */
let toastSeq = 0

/**
 * 建立 Toast 宿主。
 * @param holdMs - 完整不透明保持时长。
 * @returns 弹出函数与宿主节点。
 */
export function useToastHost(holdMs = 4000): ToastHost {
  const [entries, setEntries] = useState<ToastEntry[]>([])
  const show = useCallback((text: string) => {
    toastSeq += 1
    setEntries(previous => [...previous, { id: toastSeq, text }])
  }, [])
  const remove = useCallback((id: number) => {
    setEntries(previous => previous.filter(item => item.id !== id))
  }, [])
  const node = (
    <>
      {entries.map(entry => <ToastItem key={entry.id} entry={entry} holdMs={holdMs} onDone={remove} />)}
    </>
  )
  return { show, node }
}
