/** 多选列表（工具 / 技能 / MCP）。 */
import css from '../styles/common.module.css'

/** 一个可选项。 */
export interface MultiSelectOption {
  id: string
  label: string
  /** 不可选时的原因（null 表示可选）。 */
  disabledReason: string | null
}

/** 已勾选但已不在可选集合里的引用（例如被删除的资产）。 */
export interface MultiSelectStale {
  /** 存量引用值（技能行 id 或 MCP 服务器名）。 */
  id: string
  label: string
  /** 失效原因文案。 */
  reason: string
}

/**
 * 渲染一个多选清单。
 * @param props.options - 选项列表。
 * @param props.selected - 已选项 id。
 * @param props.emptyText - 无选项时的文案。
 * @param props.onToggle - 勾选回调。
 * @param props.stale - 已勾选但已失效的引用（仍可取消勾选以移除）。
 */
export function MultiSelectList({ options, selected, emptyText, onToggle, stale = [] }: {
  options: MultiSelectOption[]
  selected: string[]
  emptyText: string
  onToggle: (id: string, next: boolean) => void
  stale?: MultiSelectStale[]
}) {
  if (options.length === 0 && stale.length === 0) {
    return <div className={css.fieldHint}>{emptyText}</div>
  }
  return (
    <div className={css.checkList}>
      {stale.map(item => (
        // 失效引用仍可勾选（点击即取消）：这是移除悬空引用唯一的入口，禁用会让存量值无法清理。
        <label key={`stale:${item.id}`} className={css.checkRow}>
          <input
            className={css.checkInput}
            type="checkbox"
            checked
            onChange={() => { onToggle(item.id, false) }}
          />
          <span>{item.label}</span>
          <span className={css.checkReason}>{item.reason}</span>
        </label>
      ))}
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
