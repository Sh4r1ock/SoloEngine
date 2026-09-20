/**
 * `@soloengine/ui-theme` 的浏览器半：把 SoloEngine 设计语言阶梯（`--se-*`）注入运行面板文档。
 *
 * 阶梯数值的唯一真源是同包内的 `src/styles/tokens.css`（框架层产品页面导入同一文件）。
 * 本插件不做任何注册调用——它只负责让运行面板与产品页面消费同一份阶梯定义。
 *
 * @module @soloengine/ui-theme/client
 */

// 插件自有样式：由 client 构建预设编译并注入 <style data-plugin="…">（卸载即撤销）。
import '../styles/tokens.css'

/** 本包不依赖任何服务；加载即注入阶梯。 */
export const inject: readonly string[] = []

/**
 * 浏览器插件体：阶梯样式由上面的 CSS 导入在包加载时注入，故这里无需注册动作。
 */
export function apply(): void {
  // 阶梯是纯声明式 CSS 变量，无生命周期注册；保留空体以维持「一功能一插件」的形态契约。
}
