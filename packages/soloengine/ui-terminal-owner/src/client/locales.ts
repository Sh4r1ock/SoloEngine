/** `@soloengine/ui-terminal-owner` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineTerminal'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'terminal.type': '终端',
  'terminal.guide.title': '打开终端',
  'terminal.guide.description': '属于当前会话 owner 作用域的常驻终端',
  'terminal.new': '新建终端',
  'terminal.close': '结束终端',
  'terminal.interrupt': '中断（Ctrl-C）',
  'terminal.send': '发送',
  'terminal.input.placeholder': '输入一行命令并回车（行式契约）',
  'terminal.empty': '该会话尚无终端；点击「新建终端」创建一个',
  'terminal.creating': '正在创建终端…',
  'terminal.owner': 'owner 作用域',
  'terminal.generation.live': '本次进程代',
  'terminal.generation.persisted': '持久回放代',
  'terminal.replay.title': '跨重启回放（已持久输出）',
  'terminal.replay.empty': '没有可回放的已持久输出',
  'terminal.lines': '{count} 行',
  'terminal.lineContract': '行式契约：全屏 TUI（vim/htop 等）不在支持范围内，输出按行呈现',
  'terminal.exited': '已结束（退出码 {code}）',
  'terminal.error': '终端操作失败',
  'terminal.loading': '正在读取终端…',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'terminal.type': 'Terminal',
  'terminal.guide.title': 'Open a terminal',
  'terminal.guide.description': 'A persistent terminal owned by this session',
  'terminal.new': 'New terminal',
  'terminal.close': 'End terminal',
  'terminal.interrupt': 'Interrupt (Ctrl-C)',
  'terminal.send': 'Send',
  'terminal.input.placeholder': 'Type one line and press Enter (line-oriented contract)',
  'terminal.empty': 'This session has no terminal yet; click “New terminal” to create one',
  'terminal.creating': 'Creating a terminal…',
  'terminal.owner': 'owner scope',
  'terminal.generation.live': 'this process generation',
  'terminal.generation.persisted': 'persisted replay generation',
  'terminal.replay.title': 'Cross-restart replay (persisted output)',
  'terminal.replay.empty': 'No persisted output to replay',
  'terminal.lines': '{count} lines',
  'terminal.lineContract': 'Line-oriented contract: full-screen TUI (vim/htop) is out of scope; output is shown as lines',
  'terminal.exited': 'Exited (code {code})',
  'terminal.error': 'Terminal operation failed',
  'terminal.loading': 'Reading the terminal…',
}

/** 本命名空间的键集联合。 */
export type SoloengineTerminalKey = keyof typeof zh
