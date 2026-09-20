/**
 * 会话头的产品信息层级（PRD-07 FR-UI-006）。
 *
 * 三个只读芯片叠在原生会话头「动作」座位上：运行状态（`useSession` 的 `running`）、
 * 当前项目与运行模式（`useProjection('soloengine.runContext')`——宿主权威、客户端只读）。
 * 组件不自行订阅、不读 React context；全部数据经框架 hook 座位到达。
 *
 * @module @soloengine/ui-conversation/SessionContext
 */

import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './SessionContext.module.css'
import type { SoloengineConversationKey } from './locales.ts'

/** 会话头动作座位的组件 props（owner 无值；session 作用域提供标准 hook 座位）。 */
export type SessionContextProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'soloengineConversation'>

/**
 * 取路径末段作为项目名（空路径不产出芯片）。
 * @param directory - 运行项目目录。
 * @returns 项目名，或 undefined。
 */
function projectName(directory: string): string | undefined {
  const trimmed = directory.replace(/[\\/]+$/u, '')
  if (trimmed === '') return undefined
  const segments = trimmed.split(/[\\/]/u)
  const last = segments[segments.length - 1]
  return last === undefined || last === '' ? undefined : last
}

/**
 * 渲染运行状态、当前项目与运行模式芯片。
 * @param props - session 作用域标准座位与本地化座位。
 * @returns 芯片行。
 */
export function SessionContext({ useSession, useProjection, t }: SessionContextProps) {
  const running = useSession(snapshot => snapshot.running)
  const context = useProjection('soloengine.runContext')
  const project = context === undefined || context === null ? undefined : projectName(context.projectDir)
  const modeKey = context === undefined || context === null ? undefined : context.runMode
  return (
    <div className={styles.row}>
      <Pill>
        <span className={running ? styles.dot : `${styles.dot} ${styles.dotIdle}`} aria-hidden="true" />
        {running ? t('status.running') : t('status.idle')}
      </Pill>
      {project === undefined ? null : (
        <Pill>
          <span className={styles.value}>{`${t('context.project')} · ${project}`}</span>
        </Pill>
      )}
      {modeKey === undefined ? null : (
        <Pill>
          <span className={styles.value}>{`${t('context.mode')} · ${t(`mode.${modeKey}` as SoloengineConversationKey)}`}</span>
        </Pill>
      )}
    </div>
  )
}
