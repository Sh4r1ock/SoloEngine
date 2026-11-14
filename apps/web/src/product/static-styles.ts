/**
 * 安装静态客户端库的延迟样式表。
 *
 * rc.3 起，`staticLinked` 产出的库不再在导入时注入样式：样式文本作为模块元数据
 * （`__$dsh_client_module_manifest.meta()`）随产物交付，由渲染层的 DocumentStyles
 * 在挂载客户端树时安装。产品页面（`apps/web/src/product`）直接导入
 * `@deepseek-ai/dsh-client-ui-primitives` 而不经过那棵树，因此必须在这里自己安装，
 * 否则弹窗、输入框等控件会以 `position: static` 落进文档流。
 *
 * @module apps/web/src/product/static-styles
 */

import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshClientModuleManifest } from '@deepseek-ai/dsh-package-manifest'

/** 产品页面直接消费、且以静态产物交付的客户端库。 */
const STATIC_LIBRARIES: readonly object[] = [Primitives]

/** 静态库在产物里携带模块清单的导出名（与 `client/web` 的 `STATIC_MODULE_MANIFEST_EXPORT` 同值）。 */
const MANIFEST_EXPORT = '__$dsh_client_module_manifest'

/**
 * 把一个静态库的样式表挂进 `document.head`，重复调用不会重复插入。
 * @param namespace - 库的 ESM 命名空间。
 */
function installLibrary(namespace: object): void {
  const manifest = Reflect.get(namespace, MANIFEST_EXPORT) as DshClientModuleManifest | undefined
  if (manifest === undefined || manifest.meta === undefined) return
  const stylesheets = manifest.meta().stylesheets ?? {}
  for (const [path, descriptor] of Object.entries(stylesheets)) {
    if (document.head.querySelector(`style[data-plugin="${manifest.id}"][data-path="${path}"]`) !== null) continue
    const element = document.createElement('style')
    element.setAttribute('data-plugin', manifest.id)
    element.setAttribute('data-path', path)
    // 这些样式表里的 url() 只有同文档片段引用，逐字保留即可。
    element.textContent = descriptor.text({ asset: reference => reference })
    document.head.appendChild(element)
  }
}

/** 安装产品页面所依赖的静态客户端库样式；在首次渲染前调用一次。 */
export function installStaticLibraryStyles(): void {
  for (const namespace of STATIC_LIBRARIES) installLibrary(namespace)
}
