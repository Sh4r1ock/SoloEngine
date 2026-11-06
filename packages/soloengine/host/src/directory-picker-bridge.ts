/**
 * 目录桥：把 dsh 原生目录选择 seam（`ctx.directoryPicker`）暴露给框架层产品页面。
 *
 * 产品页面是框架层 SPA（不在 cordis 插件树上），无法直接消费客户端 Remote；本桥在 Host 面
 * 调用 seam 的能力，让运行起始页的目录选择走同一套目录语义：
 * - `POST /soloengine/pick-directory` —— 原生 OS 选择器（`native` 后端）；
 * - `GET  /soloengine/directory?path=` —— 逐层目录列举（`browse` 后端），
 * - `POST /soloengine/directory` —— 在指定父目录下新建子目录（`browse` 后端）。
 *
 * SoloEngine 组合层钉的是 `browse` 后端（见 `cordis.patch.yml`）：产品是 Web 控制台，选择动作
 * 必须在页面内完成，远程访问时才可用、结果才可复现；原生 OS 选择器在远程会话里无法驱动。
 *
 * 鉴权与其它桥同一条信任门（浏览器签名 cookie）；连接面不经过本桥。
 *
 * @module @soloengine/host/directory-picker-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { sendFailure, sendJson } from './bridge-json.ts'

/** 选择器最长等待（操作者可能长时间不操作；超时即当作取消）。 */
const PICK_TIMEOUT_MS = 300_000

/** 请求体读取上限：目录桥只接受短 JSON（路径与文件夹名）。 */
const BODY_LIMIT_BYTES = 8 * 1024

/** 一层目录（与 seam 的 `DirectoryListing` 同形，客户端只读这些字段）。 */
interface DirectoryListingFace {
  path: string
  home: string
  crumbs: { name: string; path: string; hidden: boolean }[]
  entries: { name: string; path: string; hidden: boolean }[]
  truncated: boolean
}

/** 本桥用到的最小选择器面（后端由组合层装配，本插件不声明注入）。 */
interface DirectoryPickerFace {
  /** 后端交互能力。 */
  capability: () => DirectoryPickerCapabilityFace
}

/** 本桥区分的交互形态：原生 OS 选择器与页内浏览。 */
type DirectoryPickerCapabilityFace =
  | { kind: 'native'; pick: (signal: AbortSignal) => Promise<string | null> }
  | {
    kind: 'browse'
    list: (path?: string, signal?: AbortSignal) => Promise<DirectoryListingFace>
    createDirectory: (path: string, name: string) => Promise<string>
  }

/**
 * 读取请求体 JSON（上限之内）。
 * @param req - 传入请求。
 * @returns 解析后的对象；非对象或超限时为 undefined。
 */
async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > BODY_LIMIT_BYTES) return undefined
    chunks.push(buffer)
  }
  if (total === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 挂载目录桥（原生选择 + 页内浏览两条路径）。
 * @param ctx - 已注入 `webServer` 与 `connection` 的上下文。
 */
export function mountDirectoryPickerBridge(ctx: Context): void {
  /** 信任门：与 /api 路由同一条（Host/Origin 反 DNS-rebinding + 浏览器签名 cookie）。 */
  const rejectUntrusted = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection === undefined) return false
    sendFailure(res, rejection, 'UNTRUSTED', `directory bridge rejected the request (${String(rejection)})`)
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/soloengine/pick-directory',
    handler: (req, res) => {
      void (async () => {
        if (rejectUntrusted(req, res)) return
        if ((req.method ?? 'GET') !== 'POST') {
          sendFailure(res, 405, 'METHOD_NOT_ALLOWED', 'the directory picker bridge answers POST only')
          return
        }
        const picker = ctx.get('directoryPicker') as DirectoryPickerFace | undefined
        const capability = picker?.capability()
        if (capability === undefined) {
          sendFailure(res, 501, 'DIRECTORY_PICKER_UNAVAILABLE', 'no directory-picker backend is composed in this profile')
          return
        }
        if (capability.kind !== 'native') {
          sendFailure(
            res, 409, 'DIRECTORY_PICKER_BROWSE_ONLY',
            `the composed picker serves "${capability.kind}"; the native OS chooser is unavailable on this host`,
          )
          return
        }
        try {
          const picked = await capability.pick(AbortSignal.timeout(PICK_TIMEOUT_MS))
          sendJson(res, 200, { ok: true, path: picked })
        } catch (error) {
          sendFailure(res, 500, 'DIRECTORY_PICK_FAILED', error instanceof Error ? error.message : String(error))
        }
      })()
    },
  }), 'soloengine-host.directoryPickerBridge.pick')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/soloengine/directory',
    handler: (req, res) => {
      void (async () => {
        if (rejectUntrusted(req, res)) return
        const picker = ctx.get('directoryPicker') as DirectoryPickerFace | undefined
        const capability = picker?.capability()
        if (capability === undefined || capability.kind !== 'browse') {
          sendFailure(
            res, 409, 'DIRECTORY_LISTING_UNAVAILABLE',
            'the composed directory picker serves no directory listing; compose the browse backend',
          )
          return
        }
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          try {
            const listing = await capability.list(new URL(req.url ?? '/', 'http://localhost').searchParams.get('path') ?? undefined)
            sendJson(res, 200, { ok: true, listing })
          } catch (error) {
            sendFailure(res, 422, 'DIRECTORY_UNREADABLE', error instanceof Error ? error.message : String(error))
          }
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          const path = typeof body?.path === 'string' ? body.path : ''
          const name = typeof body?.name === 'string' ? body.name : ''
          if (path === '' || name === '') {
            sendFailure(res, 400, 'DIRECTORY_CREATE_INVALID', 'both path and name are required to create a folder')
            return
          }
          try {
            const created = await capability.createDirectory(path, name)
            sendJson(res, 201, { ok: true, path: created })
          } catch (error) {
            sendFailure(res, 422, 'DIRECTORY_CREATE_FAILED', error instanceof Error ? error.message : String(error))
          }
          return
        }
        sendFailure(res, 405, 'METHOD_NOT_ALLOWED', 'the directory bridge answers GET and POST')
      })()
    },
  }), 'soloengine-host.directoryPickerBridge.browse')
}
