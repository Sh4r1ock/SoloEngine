/** 输出卡片（TerminalBlock / CodeBlock）所需的本地化标签。 */
import { t } from '../i18n.ts'
import type { CodeBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** CodeBlock 的复制标签。 */
export function codeLabels(): Pick<CodeBlockProps, 'copyLabel' | 'copiedLabel'> {
  return { copyLabel: t('common', 'terminalCopy'), copiedLabel: t('common', 'terminalCopied') }
}

/** TerminalBlock 的完整标签集。 */
export function terminalLabels(): TerminalBlockLabels {
  return {
    signal: signal => t('common', 'terminalSignal', { signal }),
    exitCode: code => t('common', 'terminalExitCode', { code }),
    running: t('common', 'terminalRunning'),
    failed: t('common', 'terminalFailed'),
    done: t('common', 'terminalDone'),
    copy: t('common', 'terminalCopy'),
    copied: t('common', 'terminalCopied'),
    noOutput: t('common', 'terminalNoOutput'),
    noExitCode: t('common', 'terminalNoExitCode'),
    collapseAria: t('common', 'terminalCollapseAria'),
    collapse: t('common', 'terminalCollapse'),
    expandAria: hidden => t('common', 'terminalExpandAria', { hidden }),
    expand: hidden => t('common', 'terminalExpand', { hidden }),
    commandLine: line => t('common', 'terminalCommandLine', { line }),
  }
}
