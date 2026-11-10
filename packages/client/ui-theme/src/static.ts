/**
 * `@deepseek-ai/dsh-client-ui-theme` 的静态共享面：产品壳层（`apps/web`）在插件树之外
 * 复用同一份主题启动注入与字号默认值，不引用包内 `src/*` 私有路径。
 *
 * @module @deepseek-ai/dsh-client-ui-theme/static
 */

export { bootThemeInjections } from './boot-theme.ts'
export { DEFAULT_FONT_SIZES, FONT_SIZE_MAX, FONT_SIZE_MIN } from './theme-settings.ts'
