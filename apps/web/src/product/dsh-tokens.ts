/**
 * DSH 六个 token 样式表 + SoloEngine 设计语言阶梯的导入点。
 *
 * 说明：本仓库的 Vite CSS 管线对 `@import` 的**相对路径**按 Vite root 解析
 * （实测 `apps/web/src/product/product.css` 里的 `@import` 被解析到 root 之上，构建报 ENOENT），
 * 因此这里改用模块导入：模块导入的说明符由 Vite 相对**导入方文件**解析，
 * 与 ui-theme 自身（`src/client/styles.ts`）的导入方式一致。
 *
 * 顺序与 ui-theme 一致：base → corner-shape → design-platform → scrollbar →
 * gradient-shadow-text → shiki（scrollbar 必须排在声明其 token 的
 * design-platform 之后）。
 *
 * 最后一项是 SoloEngine 设计语言阶梯（`--se-space/radius/z`）：**唯一真源**，
 * 运行面板侧由 `@soloengine/ui-theme` 插件注入同一个物理文件，产品页面导入同一文件。
 */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/corner-shape.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/scrollbar.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/shiki.css'
import '@soloengine/ui-theme/src/styles/tokens.css'
