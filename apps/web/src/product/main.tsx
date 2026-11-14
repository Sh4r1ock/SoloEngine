/** 产品页面挂载入口。 */
import { createRoot } from 'react-dom/client'
import { ProductApp } from './App.tsx'
import { ToastRegion } from './components/Toaster.tsx'
import { installStaticLibraryStyles } from './static-styles.ts'
import './dsh-tokens.ts'
import './product.css'

/**
 * 把产品页面应用挂到给定容器。
 * @param el - 容器元素（index.html 的 #root）。
 */
export function mountProductApp(el: HTMLElement): void {
  // 静态客户端库的样式随模块元数据交付（rc.3 起不再导入即注入），挂载前先安装一次。
  installStaticLibraryStyles()
  // 全局只挂一个 Toast 区域（原型 .toast-region 单实例）：壳层与页面写同一队列，不再各自叠加。
  createRoot(el).render(<><ProductApp /><ToastRegion /></>)
}
