/**
 * 会话 VM 的命名约定（节点、执行器与按会话路由的子进程提供方共用）。
 *
 * @module @soloengine/executor-vm/naming
 */

/** 会话 VM 名缺省前缀（与容器命名区分）。 */
export const DEFAULT_VM_PREFIX = 'soloengine-vm-'

/**
 * 由一个会话键推导 VM 名（节点与子进程提供方必须得到同一个名字）。
 *
 * 会话键可能含状态文件名不允许的字符；统一替换为 `-`，保证两侧一致。
 * @param sessionKey - 根会话键。
 * @param prefix - 名称前缀。
 * @returns VM 名。
 */
export function sessionVmName(sessionKey: string, prefix = DEFAULT_VM_PREFIX): string {
  return `${prefix}${sessionKey.replace(/[^A-Za-z0-9_.-]/gu, '-')}`
}
