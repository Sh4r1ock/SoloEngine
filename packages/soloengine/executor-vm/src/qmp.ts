/**
 * QMP 控制面：全 VM 的暂停/恢复/销毁经 QEMU Monitor Protocol（TCP 回环）完成。
 *
 * 每条命令一个短连接：读问候 → `qmp_capabilities` → 目标命令 → 关闭。超时、连接失败、
 * 非 JSON 行与 QMP 错误对象都显式抛出，不把「命令没送到」当成成功。
 *
 * @module @soloengine/executor-vm/qmp
 */

import { connect } from 'node:net'
import { VmExecutorError } from './error.ts'

/** QMP 消息（只声明本模块用到的字段）。 */
interface QmpMessage {
  /** 成功返回值。 */
  return?: unknown
  /** 错误对象。 */
  error?: { desc?: string }
  /** 异步事件（控制命令期间忽略）。 */
  event?: string
}

/**
 * 发送一条 QMP 控制命令。
 * @param port - 宿主回环上的 QMP 端口。
 * @param command - `stop` / `cont` / `quit` 等命令名。
 * @param timeoutMs - 整个握手与命令的超时。
 * @returns 命令被接受时完成。
 * @throws {VmExecutorError} 连接失败、超时、响应非法或被 QMP 拒绝。
 */
export async function qmpCommand(port: number, command: string, timeoutMs = 5_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let buffer = ''
    let step: 'greeting' | 'capabilities' | 'command' = 'greeting'
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new VmExecutorError(`QMP ${command} timed out after ${String(timeoutMs)}ms`))
    }, timeoutMs)
    const fail = (message: string): void => {
      clearTimeout(timer)
      socket.destroy()
      reject(new VmExecutorError(message))
    }
    socket.setEncoding('utf8')
    socket.on('error', (error: Error) => { fail(`QMP ${command} failed: ${error.message}`) })
    socket.on('close', () => { fail(`QMP ${command} closed before the command was acknowledged`) })
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line === '') continue
        let message: QmpMessage
        try {
          message = JSON.parse(line) as QmpMessage
        } catch {
          fail(`QMP ${command} returned a non-JSON line`)
          return
        }
        if (message.event !== undefined) continue
        if (message.error !== undefined) {
          fail(`QMP ${command} was rejected: ${message.error.desc ?? 'no description'}`)
          return
        }
        if (step === 'greeting') {
          step = 'capabilities'
          socket.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\n`)
          continue
        }
        if (step === 'capabilities') {
          step = 'command'
          socket.write(`${JSON.stringify({ execute: command })}\n`)
          continue
        }
        clearTimeout(timer)
        socket.end()
        resolve()
        return
      }
    })
  })
}
