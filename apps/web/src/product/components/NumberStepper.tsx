/** 数值步进器（温度 / max_tokens / 轮次上限）。 */
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../styles/common.module.css'

/**
 * 减号图标（16 号轮廓族）。
 *
 * `ui-primitives/icons` 里没有减号：步进器此前借用 `IconCloseOutlineRegular`，按钮语义是「减」、
 * 渲染出来却是叉号（用户实测缺陷）。DSH 原生包禁改，故在本产品层按该族写法补一个——
 * 横条逐点取自 `IconPlusOutlineRegular` 的 `IconPlusOutlineArtwork` 水平横条
 * （`M2 8H14`、stroke=currentColor、strokeWidth=1、16 视窗），两枚按钮视觉完全对称。
 */
function IconMinusOutline16({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1}>
      <path d="M2 8H14" stroke="currentColor" />
    </svg>
  )
}

/**
 * 渲染一个步进器。
 * @param props.label - 无障碍标签（已本地化）。
 * @param props.value - 当前值；null 表示未设置。
 * @param props.step - 步长。
 * @param props.min - 下限。
 * @param props.max - 上限。
 * @param props.placeholder - 未设置时的占位文案。
 * @param props.disabled - 整组禁用（写请求在途时锁控件，避免并发写自撞版本）。
 * @param props.onChange - 新值回调；传 null 表示清空。
 */
export function NumberStepper({ label, value, step, min, max, placeholder, disabled = false, onChange }: {
  label: string
  value: number | null
  step: number
  min: number
  max: number
  placeholder: string
  disabled?: boolean
  onChange: (next: number | null) => void
}) {
  const current = value ?? null
  const clamp = (next: number): number => Math.min(max, Math.max(min, next))
  const atMax = current !== null && current >= max
  return (
    <span className={css.stepper} role="group" aria-label={label}>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} -`}
        icon={<IconMinusOutline16 size={12} />}
        disabled={disabled}
        onClick={() => {
          if (current === null) return
          const next = clamp(current - step)
          // 到达下限再减一次即清空为「未设置」：调用方用 null 删键，否则值永远清不掉。
          onChange(next === min && current === min ? null : next)
        }}
      />
      <span className={css.stepperValue}>{current === null ? placeholder : String(current)}</span>
      <Button
        size="sm"
        variant="outline"
        aria-label={`${label} +`}
        icon={<IconPlusOutlineRegular size={12} />}
        disabled={disabled || atMax}
        onClick={() => { onChange(clamp((current ?? min) + step)) }}
      />
    </span>
  )
}
