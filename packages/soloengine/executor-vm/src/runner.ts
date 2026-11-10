/**
 * 命令执行接缝：全 VM 后端只通过子进程调用 `qemu-img` / `qemu-system-*` / `ssh`，
 * 不引入 QEMU 绑定库。测试注入同一接缝，覆盖命令装配、启动失败与超时路径。
 *
 * @module @soloengine/executor-vm/runner
 */

import { spawn } from 'node:child_process'

/** 一条已完成的子进程结果。 */
export interface VmCommandResult {
  /** 退出码。 */
  code: number
  /** 标准输出。 */
  stdout: string
  /** 标准错误。 */
  stderr: string
}

/** 命令执行器：生产用 {@link spawnRunner}，测试注入脚本化实现。 */
export type VmCommandRunner = (bin: string, args: readonly string[], timeoutMs: number) => Promise<VmCommandResult>

/* jscpd:ignore-start */
// Same 25-line runner as the container executor and the image cache: a shared package would
// couple image distribution to the executors for one primitive.
/**
 * 运行一个子进程并收集输出。
 * @param bin - 可执行文件。
 * @param args - 参数。
 * @param timeoutMs - 超时。
 * @returns 退出码与输出。
 */
export const spawnRunner: VmCommandRunner = async (bin, args, timeoutMs) => await new Promise((resolve, reject) => {
  const child = spawn(bin, [...args], { windowsHide: true })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error(`${bin} ${args.join(' ')} timed out after ${String(timeoutMs)}ms`))
  }, timeoutMs)
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code) => {
    clearTimeout(timer)
    resolve({ code: code ?? -1, stdout, stderr })
  })
})
/* jscpd:ignore-end */
