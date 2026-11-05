/**
 * `@soloengine/ui-theme` 的静态共享面：原生 token 对比度校正的**唯一真源**。
 *
 * 消费方两处，值只有这一份：
 * - 运行面板：`client/index.ts` 经原生 `ctx.theme.overrideTokens` 注册为覆盖层；
 * - 产品页面：`apps/web` 的 `ThemePresenter` 快照把同一份校正写进主题 token。
 *
 * 校正只覆盖三处实测不达标的原生别名；同名的深色值取原生现值（`design-platform.css`
 * 的深色块），因此覆盖层不改变深色表现。原生 `html body` 覆写已删除。
 *
 * @module @soloengine/ui-theme/static
 */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/**
 * 三处对比度校正（light/dark 成对，原生 `ThemeRuntime.overrideTokens` 契约）。
 *
 * - tertiary 浅色 #646a70：白底 5.9、行 hover 底（6% 墨，rgb(242,243,244)）4.8——
 *   原 #6b7278 在 hover 底上只有 4.38，低于正文 4.5 的下限；深色取原生现值 #9a9b9d。
 * - caption 浅色 #757575：白底 4.6；深色 #9a9fa6：深底 5.03。
 * - 选中态墨色浅色取 deepseek-600（白底 5.39）；深色保留原生 deepseek-400。
 */
export const CONTRAST_TOKEN_OVERRIDES: ThemeTokenOverrides = {
  '--dsw-alias-label-tertiary': {
    light: '#646a70',
    dark: 'color-mix(in srgb, var(--dsw-static-neutral-00) 58%, var(--dsw-static-neutral-bluish-1000))',
  },
  '--dsw-alias-label-caption': { light: '#757575', dark: '#9a9fa6' },
  '--dsw-alias-state-business-primary': {
    light: 'var(--dsw-static-deepseek-600)',
    dark: 'var(--dsw-static-deepseek-400)',
  },
}
