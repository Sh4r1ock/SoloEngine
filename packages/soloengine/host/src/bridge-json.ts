/**
 * 面板侧各桥（操作区 / 变更台账 / 运行设置）共用的协议写法。
 *
 * 这些桥都挂在同一张 `webServer` 上、共用同一条信任门鉴权；请求体解析、结构化成功/失败与
 * 桥自身的错误类型完全一致，因此收在一处，避免多份逐字相同的 helper 漂移。
 *
 * @module @soloengine/host/bridge-json
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 桥自身的结构化错误（状态码 + 稳定错误码）。 */
export class BridgeFailure extends Error {
  /**
   * @param status - HTTP 状态码。
   * @param code - 稳定错误码。
   * @param message - 人类可读原因（指出具体项）。
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeFailure'
  }
}

/**
 * 读取请求体（JSON；空体即 `{}`）。
 * @param req - 请求。
 * @returns 解析后的对象。
 */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * 写一个结构化 JSON 响应。
 * @param res - 响应对象。
 * @param status - HTTP 状态码。
 * @param body - 响应体（JSON 可序列化）。
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 写一个结构化失败响应（fail loud）。
 * @param res - 响应对象。
 * @param status - HTTP 状态码。
 * @param code - 稳定错误码。
 * @param message - 可定位的错误文本。
 */
export function sendFailure(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}
