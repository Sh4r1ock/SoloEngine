/** 错误 / 成功 / 信息提示行（错误必须出现在界面上）。 */
import { IconWarningOutline16, IconCheckOutline16, IconQuestionOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../styles/common.module.css'

/** 提示种类。 */
export type NoticeTone = 'error' | 'success' | 'info'

/**
 * 渲染一行提示。
 * @param props.tone - error / success / info。
 * @param props.text - 文案；为空时不渲染。
 * @param props.action - 可选的行内操作（例如「重新加载」）。
 */
export function NoticeLine({ tone, text, action }: {
  tone: NoticeTone
  text: string | null
  action?: { label: string; onClick: () => void }
}) {
  if (text === null || text === '') return null
  const className = tone === 'error' ? css.errorLine : tone === 'success' ? css.successLine : css.infoLine
  const icon = tone === 'error'
    ? <IconWarningOutline16 size={16} />
    : tone === 'success' ? <IconCheckOutline16 size={16} /> : <IconQuestionOutline14 size={14} />
  return (
    <div className={className} role={tone === 'error' ? 'alert' : 'status'}>
      {icon}
      <span>{text}</span>
      {action !== undefined && (
        <button
          type="button"
          className={css.mono}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
