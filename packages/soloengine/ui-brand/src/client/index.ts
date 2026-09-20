/**
 * `@soloengine/ui-brand` 的浏览器半：SoloEngine 产品品牌呈现。
 *
 * 依据 PRD-07 FR-UI-006 与《SoloEngine 框架设计》§4.5：无会话首屏与侧栏品牌行的产品呈现
 * 经**原生品牌座位**叠加——不替换壳、不自建平行结构，只占原生座位。
 *
 * 座位（声明者是 ui-sidebar / ui-conversation，故用「等待声明」的注入方式）：
 * - `sidebar.brand.mark` / `sidebar.brand.name`：侧栏品牌行；
 * - `conversation.hero.brand.mark`：无会话首屏品牌标记。
 *
 * @module @soloengine/ui-brand/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrandMark, BrandName, HeroBrandMark } from './Brand.tsx'
import { en, NS, zh, type SoloengineBrandKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 品牌呈现文案。 */
    soloengineBrand: SoloengineBrandKey
  }
}

/** 需要的服务：槽位注册表与本地化运行时。 */
export const inject = ['slots', 'locale']

/**
 * 浏览器插件体：注册字典并把品牌占位注册进原生品牌座位。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-brand: dictionaries')
  // 侧栏品牌行：标记与名字各自一格一占（替换点）。
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark', locale: NS },
    BrandMark,
  ))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', locale: NS },
    BrandName,
  ))
  // 无会话首屏品牌标记。
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
    { name: 'conversation.hero.brand.mark', locale: NS },
    HeroBrandMark,
  ))
}
