/** 多选列表（工具 / 技能 / MCP）。 */
import css from '../styles/common.module.css'

/** 一个可选项。 */
export interface MultiSelectOption {
  id: string
  label: string
  /** 不可选时的原因（null 表示可选）。 */
  disabledReason: string | null
}

/**
 * 渲染一个多选清单。
 * @param props.options - 选项列表。
 * @param props.selected - 已选项 id。
 * @param props.emptyText - 无选项时的文案。
 * @param props.onToggle - 勾选回调。
 */
export function MultiSelectList({ options, selected, emptyText, onToggle }: {
  options: MultiSelectOption[]
  selected: string[]
  emptyText: string
  onToggle: (id: string, next: boolean) => void
}) {
  if (options.length === 0) {
    return <div className={css.fieldHint}>{emptyText}</div>
  }
  return (
    <div className={css.checkList}>
      {options.map((option) => {
        const disabled = option.disabledReason !== null
        return (
          <label key={option.id} className={css.checkRow}>
            <input
              className={css.checkInput}
              type="checkbox"
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={(event) => { onToggle(option.id, event.currentTarget.checked) }}
            />
            <span>{option.label}</span>
            {option.disabledReason !== null && (
              <span className={css.checkReason}>{option.disabledReason}</span>
            )}
          </label>
        )
      })}
    </div>
  )
}
