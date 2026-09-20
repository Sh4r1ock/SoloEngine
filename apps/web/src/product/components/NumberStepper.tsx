/** 数值步进器（温度 / max_tokens / 轮次上限）。 */
import { Button, IconPlusOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../styles/common.module.css'

/**
 * 渲染一个步进器。
 * @param props.label - 无障碍标签（已本地化）。
 * @param props.value - 当前值；null 表示未设置。
 * @param props.step - 步长。
 * @param props.min - 下限。
 * @param props.max - 上限。
 * @param props.placeholder - 未设置时的占位文案。
 * @param props.onChange - 新值回调；传 null 表示清空。
 */
export function NumberStepper({ label, value, step, min, max, placeholder, onChange }: {
  label: string
  value: number | null
  step: number
  min: number
  max: number
  placeholder: string
  onChange: (next: number | null) => void
}) {
  const current = value ?? null
  const clamp = (next: number): number => Math.min(max, Math.max(min, next))
  return (
    <span className={css.stepper} aria-label={label}>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} -`}
        icon={<IconCloseOutline16 size={12} />}
        onClick={() => {
          if (current === null) return
          const next = clamp(current - step)
          onChange(next === min && current === min ? null : next)
        }}
      />
      <span className={css.stepperValue}>{current === null ? placeholder : String(current)}</span>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} +`}
        icon={<IconPlusOutline16 size={12} />}
        onClick={() => { onChange(clamp((current ?? min) + step)) }}
      />
    </span>
  )
}
