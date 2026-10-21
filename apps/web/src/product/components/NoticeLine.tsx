/** 错误 / 成功 / 信息提示行（错误必须出现在界面上）。 */
import { IconWarningOutlineRegular, IconCheckOutlineRegular, IconQuestionOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../styles/common.module.css'

/** 提示种类。 */
export type NoticeTone = 'error' | 'success' | 'info'

/**
 * 渲染一行提示。
 *
 * 生命周期归调用方：本组件收不到「同一条消息又发生了一次」（父级 state 值不变时
 * text 逐字相同），因此任何「过期即隐藏 / 用户可收起」都必须由持有该消息的页面触发
 * （见 `SkillsPage`/`McpPage`/`MarketPage` 每次动作起手的 `setNotice(null)`）。
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
    ? <IconWarningOutlineRegular size={16} />
    : tone === 'success' ? <IconCheckOutlineRegular size={16} /> : <IconQuestionOutlineRegular size={14} />
  return (
    <div className={className} role={tone === 'error' ? 'alert' : 'status'}>
      {/* 语气图标是纯装饰：原生图标原语只收 {size, className}（禁改），不会自标 aria-hidden，
          裸渲染会在无障碍树里留下无名 image 节点（实测 a11y 快照出现 `- image`）。
          产品层在此包一层装饰标记，文字已完整表达状态。 */}
      <span aria-hidden="true" className={css.noticeIcon}>{icon}</span>
      <span>{text}</span>
      {action !== undefined && (
        <button
          type="button"
          className={css.noticeAction}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
