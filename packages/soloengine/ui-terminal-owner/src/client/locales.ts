/** `@soloengine/ui-terminal-owner` 的文案命名空间字典（zh 为键集真源，en 完整对应）。 */

/** 本插件拥有的文案命名空间。 */
export const NS = 'soloengineTerminal'

/** 简体中文字典（键集真源）。 */
export const zh = {
  'terminal.type': '终端',
  'terminal.guide.title': '打开终端',
  'terminal.guide.description': '属于当前会话 owner 作用域的常驻终端',
  'terminal.new': '新建终端',
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
  'terminal.lineContract': '行式契约：全屏 TUI（vim/htop 等）不在支持范围内，输出按行呈现',
  'terminal.exited': '已结束（退出码 {code}）',
  'terminal.exitedUnknown': '已结束（退出码未上报）',
  'terminal.failed': '启动失败（退出码 {code}）',
  'terminal.failedUnknown': '启动失败（退出码未上报）',
  'terminal.error': '终端操作失败',
  'terminal.errorRead': '读取终端输出失败',
  'terminal.screenEmpty': '终端还没有输出',
  'terminal.loading': '正在读取终端…',
  'terminal.screen.aria': '终端输出',
  'terminal.errorNetwork': '无法连接终端服务，请稍后重试',
  'terminal.errorUnknown': '终端服务返回了无法识别的失败',
  'terminal.errorOwner': '当前会话在本进程里没有运行中的代理，owner 终端暂不可用',
  'terminal.errorSessionGone': '该会话不在本进程里，终端记录已不可读',
  'terminal.errorUntrusted': '请求未被本机信任门接受，请通过本实例的地址访问',
  'terminal.errorNoBackend': '本组合层没有注册终端后端，终端不可用',
}

/** 英文字典（键集与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'terminal.type': 'Terminal',
  'terminal.guide.title': 'Open a terminal',
  'terminal.guide.description': 'A persistent terminal owned by this session',
  'terminal.new': 'New terminal',
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
  'terminal.lineContract': 'Line-oriented contract: full-screen TUI (vim/htop) is out of scope; output is shown as lines',
  'terminal.exited': 'Exited (code {code})',
  'terminal.exitedUnknown': 'Exited (no exit code reported)',
  'terminal.failed': 'Failed to start (code {code})',
  'terminal.failedUnknown': 'Failed after start (no exit code reported)',
  'terminal.error': 'Terminal operation failed',
  'terminal.errorRead': 'Reading the terminal output failed',
  'terminal.screenEmpty': 'The terminal has no output yet',
  'terminal.loading': 'Reading the terminal…',
  'terminal.screen.aria': 'Terminal output',
  'terminal.errorNetwork': 'The terminal service could not be reached — try again shortly',
  'terminal.errorUnknown': 'The terminal service returned an unrecognised failure',
  'terminal.errorOwner': 'This session has no live agent in this process, so its owner terminal is unavailable',
  'terminal.errorSessionGone': 'This session is no longer in this process; the terminal transcript cannot be read',
  'terminal.errorUntrusted': 'The request was not accepted by the local trust gate; open this instance by its own address',
  'terminal.errorNoBackend': 'No terminal backend is registered in this composition, so terminals are unavailable',
}

/** 本命名空间的键集联合。 */
export type SoloengineTerminalKey = keyof typeof zh
