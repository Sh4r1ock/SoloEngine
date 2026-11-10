/** Copy owned by the sidebar terminal feature. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebarTerminal: keyof typeof zh
  }
}

/** Simplified Chinese terminal copy. */
export const zh = {
  'shortcut.noSession': '请先选择会话',
  description: '接续本会话的 agent 终端（行式契约，不支持全屏 TUI）',
  title: '终端', new: '新建终端', loading: '正在读取终端…', creating: '正在启动…',
  owner: '归属会话',
  exited: '进程已退出（{code}）', exitedUnknown: '进程已退出（退出码未知）',
  failed: '终端错误：{message}',
  missingTerminal: '此终端已不存在，请新建终端。',
  terminalLimit: '终端数量已达上限，请关闭不用的终端后重试。已退出的终端也计入数量。',
  lineError: '终端操作失败',
  lineReadError: '读取终端输出失败',
  lineEmpty: '本会话还没有终端。',
  lineScreenAria: '终端输出',
  lineScreenEmpty: '（没有输出）',
  lineInputPlaceholder: '输入一行命令后回车',
  lineSend: '发送',
  lineInterrupt: '中断',
  lineContract: '行式契约：这里显示 agent 终端的保留输出，全屏 TUI 程序不在此呈现。',
  recovered: '上一代终端 {id} 已结束；下方是新代际终端。',
  replayLabel: '上一代已持久输出（会话日志中的工具结果，有界）',
  replayAria: '上一代终端持久输出',
  replayEmpty: '上一代没有可回放的持久输出。',
} satisfies Record<string, string>

/** English terminal copy. */
export const en = {
  'shortcut.noSession': 'Select a session first',
  description: 'Continue this session’s agent terminals (line contract; full-screen TUI is not supported)',
  title: 'Terminal', new: 'New terminal', loading: 'Reading terminals…', creating: 'Starting…',
  owner: 'Owner session',
  exited: 'Process exited ({code})', exitedUnknown: 'Process exited (exit code unknown)',
  failed: 'Terminal error: {message}',
  missingTerminal: 'This terminal no longer exists. Open a new terminal.',
  terminalLimit: 'The terminal limit has been reached. Close unused terminals and try again. Exited terminals also count toward the limit.',
  lineError: 'Terminal command failed',
  lineReadError: 'Reading terminal output failed',
  lineEmpty: 'This session has no terminal yet.',
  lineScreenAria: 'Terminal output',
  lineScreenEmpty: '(no output)',
  lineInputPlaceholder: 'Type one line and press Enter',
  lineSend: 'Send',
  lineInterrupt: 'Interrupt',
  lineContract: 'Line contract: this shows an agent terminal’s retained output; full-screen TUI programs are not rendered here.',
  recovered: 'Previous terminal {id} has ended; the terminal below is a new generation.',
  replayLabel: 'Persisted output of the previous generation (bounded tool results from the session log)',
  replayAria: 'Persisted output of the previous terminal',
  replayEmpty: 'The previous generation left no persisted output to replay.',
} satisfies Record<keyof typeof zh, string>
