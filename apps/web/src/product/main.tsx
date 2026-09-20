/** 产品页面挂载入口。 */
import { createRoot } from 'react-dom/client'
import { ProductApp } from './App.tsx'
import './dsh-tokens.ts'
import './product.css'

/**
 * 把产品页面应用挂到给定容器。
 * @param el - 容器元素（index.html 的 #root）。
 */
export function mountProductApp(el: HTMLElement): void {
  createRoot(el).render(<ProductApp />)
}
