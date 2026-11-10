/**
 * `@deepseek-ai/dsh-client-ui-layout` 的静态共享面：产品壳层（`apps/web`）复用同一份
 * 主题 DOM 呈现器，不引用包内 `src/*` 私有路径。
 *
 * @module @deepseek-ai/dsh-client-ui-layout/static
 */

export { ThemePresenter, DARK_ATTRIBUTE, THEME_SOURCE_ATTRIBUTE, CONTENT_FONT_SIZE_VARIABLE } from './client/theme-presenter.ts'
