/**
 * 面板侧各桥（操作区 / 变更台账 / 运行设置）共用的协议写法。
 *
 * 这些桥都挂在同一张 `webServer` 上、共用同一条信任门鉴权；请求体解析、结构化成功/失败与
 * 桥自身的错误类型完全一致，因此收在一处，避免多份逐字相同的 helper 漂移。
 *
 * @module @soloengine/host/bridge-json
 */

import type { ServerResponse } from 'node:http'

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
 *
 * 非对象/非法 JSON 是请求问题（400），不是桥的内部错误：两个桥把本函数的失败原样回给
 * 浏览器，状态码必须让调用方知道「改请求」而不是「重试」。
 * @param req - 请求（只读异步块流；`IncomingMessage` 即满足）。
 * @returns 解析后的对象。
 * @throws {BridgeFailure} 请求体不是合法 JSON，或顶层不是对象。
 */
export async function readJsonBody(req: AsyncIterable<Buffer | string>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new BridgeFailure(400, 'BODY_INVALID', `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeFailure(400, 'BODY_NOT_OBJECT', 'request body must be a JSON object')
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
