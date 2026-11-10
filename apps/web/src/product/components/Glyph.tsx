/** 产品页面内联线性图标（20×20 网格；原语没有同名图形时使用）。 */
import type { ReactNode } from 'react'

/**
 * 渲染一个 20×20 网格的线性 SVG 图标。
 * @param props.children - SVG 图形节点（path / circle / rect）。
 * @param props.size - 渲染尺寸（默认 16；空态与详情头用 20）。
 */
export function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
