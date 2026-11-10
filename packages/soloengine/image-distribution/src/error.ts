/**
 * 分发层的显式失败类型（fail loud）。
 *
 * @module @soloengine/image-distribution/error
 */

/** 分发层错误（不静默降级）。 */
export class DistributionError extends Error {
  /**
   * @param message - 原因。
   * @param stderr - 子进程标准错误（保留原文）。
   */
  constructor(message: string, readonly stderr = '') {
    super(stderr === '' ? message : `${message}: ${stderr.trim()}`)
    this.name = 'DistributionError'
  }
}
