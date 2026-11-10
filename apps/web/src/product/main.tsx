/** 产品页面挂载入口。 */
import { createRoot } from 'react-dom/client'
import { ProductApp } from './App.tsx'
import { ToastRegion } from './components/Toaster.tsx'
import './dsh-tokens.ts'
import './product.css'

/**
 * 把产品页面应用挂到给定容器。
 * @param el - 容器元素（index.html 的 #root）。
 */
export function mountProductApp(el: HTMLElement): void {
  // 全局只挂一个 Toast 区域（原型 .toast-region 单实例）：壳层与页面写同一队列，不再各自叠加。
  createRoot(el).render(<><ProductApp /><ToastRegion /></>)
}
