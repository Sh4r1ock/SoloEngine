/**
 * 目录选择桥：把 dsh 原生目录选择 seam（`ctx.directoryPicker`）暴露给框架层产品页面。
 *
 * 产品页面是框架层 SPA（不在 cordis 插件树上），无法直接消费客户端 Remote；本桥在 Host 面
 * 调 seam 的 `native` 能力（`host-directory-picker-auto` 在本机装配 OS 选择器），让
 * 「新建运行项目」的目录选择走 dsh 原生选择器——即《Harness插件体系》第二章
 * directory-picker 节所述「新建会话与运行项目的目录选择走它」。
 *
 * 鉴权与其它桥同一条信任门（浏览器签名 cookie）；连接面不经过本桥。
 *
 * @module @soloengine/host/directory-picker-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'

/** 桥路径（exact；与 `/api/solo`、`/soloengine/*` 的其它前缀互不遮蔽）。 */
export const PICK_DIRECTORY_PATH = '/soloengine/pick-directory'

/** 选择器最长等待（操作者可能长时间不操作；超时即当作取消）。 */
const PICK_TIMEOUT_MS = 300_000

/** 结构化 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 结构化失败（fail loud）。 */
function sendFailure(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * 挂载目录选择桥。
 * @param ctx - 已注入 `webServer` 与 `connection` 的上下文。
 */
export function mountDirectoryPickerBridge(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PICK_DIRECTORY_PATH,
    handler: (req, res) => {
      void (async () => {
        // 信任门：与 /api 路由同一条（Host/Origin 反 DNS-rebinding + 浏览器签名 cookie）。
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          sendFailure(res, rejection, 'UNTRUSTED', `directory picker bridge rejected the request (${String(rejection)})`)
          return
        }
        if ((req.method ?? 'GET') !== 'POST') {
          sendFailure(res, 405, 'METHOD_NOT_ALLOWED', 'the directory picker bridge answers POST only')
          return
        }
        const picker = ctx.get('directoryPicker')
        const capability = picker?.capability()
        if (capability === undefined) {
          sendFailure(res, 501, 'DIRECTORY_PICKER_UNAVAILABLE', 'no directory-picker backend is composed in this profile')
          return
        }
        if (capability.kind !== 'native') {
          // browse 后端不弹 OS 选择器：如实说明，由调用方决定回退（手填路径）。
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
  }), 'soloengine-host.directoryPickerBridge')
}
