/**
 * 出口代理资产定位（W10.9）。
 *
 * 代理容器里运行的 `assets/server.mjs` 是纯 ESM 资产，不参与编译；本入口只把它的
 * 文件系统路径交给部署侧——`EgressSidecar` 以只读挂载把它放进代理容器，因此
 * 源码树与构建产物下都必须是同一份资产，不能复制第二份实现。
 *
 * @module @soloengine/egress-proxy
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** 代理脚本在包内的绝对路径（与 `EgressSidecar` 的只读挂载点对应）。 */
export const EGRESS_PROXY_ASSET = join(
  dirname(require.resolve('@soloengine/egress-proxy/package.json')),
  'assets',
  'server.mjs',
)
