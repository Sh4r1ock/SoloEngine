/**
 * 全 VM 后端的显式失败：创建、执行、QMP 控制与销毁都不静默降级。
 *
 * @module @soloengine/executor-vm/error
 */

/** 全 VM 后端错误。 */
export class VmExecutorError extends Error {
  /**
   * @param message - 原因。
   * @param stderr - 子进程标准错误（保留原文便于定位）。
   */
  constructor(message: string, readonly stderr = '') {
    super(stderr === '' ? message : `${message}: ${stderr.trim()}`)
    this.name = 'VmExecutorError'
  }
}
