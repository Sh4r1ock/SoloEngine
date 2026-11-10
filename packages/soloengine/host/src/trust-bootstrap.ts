/**
 * 连接信任门引导（PRD-10 FR-SEC-011 / PRD-07 FR-UI-018 / PRD-11 FR-DEP-002）的消费端。
 *
 * 浏览器信任门是**权威绑定**的：进程启动令牌经 `/?token=…` 换取一张按 `Host:port` 命名的
 * 签名 cookie，之后同一 authority 的页面与 `/api` 才被放行。全新浏览器首次访问深链
 * （`/run/:flow`、`/canvas/:id` 等）时既没有 cookie、也没有令牌 URL，页面无法呈现。
 *
 * 引导本体在原生实现里（`ctx.connection.authorizeIndex` 的 `bootstrap` 参数）：本机回环
 * （回环远端 + 回环 authority）的未认证 GET/HEAD 收到 303 到同一 authority 的令牌 URL，
 * 原始路径写进本模块导出的回跳 cookie。产品侧只保留两处消费：页面向原生门请求引导
 * （`host/src/index.ts` 的页面路由），Web 入口消费回跳 cookie（`apps/web/src/main.ts`）。
 * 连接面（RPC 与事件流）不经过引导，仍由 `ctx.connection` 的信任门判定。
 *
 * @module @soloengine/host/trust-bootstrap
 */

/** 引导回跳 cookie 名（页面侧消费一次即清）；与 `apps/web/src/main.ts` 同名。 */
export const RETURN_COOKIE = 'soloengine-return'
