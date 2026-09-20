/**
 * SoloEngine 品牌标识（内联 SVG，骑 currentColor；不引图标库）。
 *
 * 形状：圆角方 + 内部双斜杠（产品标识），尺寸由 owner 座位给出（侧栏 24 / 首屏 40 等）。
 *
 * @module @soloengine/ui-brand/BrandMark
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './Brand.module.css'
import type { SoloengineBrandKey } from './locales.ts'

/** 侧栏品牌标记座位的组件 props（owner 给出请求边长）。 */
export type BrandMarkProps =
  PropsRuntime<'sidebar.brand.mark'>
  & PropsLocale<'soloengineBrand'>

/**
 * 渲染品牌标记。
 * @param props - owner 边长与本地化座位。
 * @returns 内联 SVG 标记。
 */
export function BrandMark({ size, t }: BrandMarkProps) {
  return (
    <svg
      className={styles.mark}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={t('brand.mark.label')}
      fill="none"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 16.5 14.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 16.5 18.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

/** 对话首屏品牌标记座位的组件 props（owner 给出边长与宿主类名）。 */
export type HeroBrandMarkProps =
  PropsRuntime<'conversation.hero.brand.mark'>
  & PropsLocale<'soloengineBrand'>

/**
 * 渲染首屏品牌标记（复用同一图形，尺寸与类名由宿主给出）。
 * @param props - owner 边长/类名与本地化座位。
 * @returns 内联 SVG 标记。
 */
export function HeroBrandMark({ size, className, t }: HeroBrandMarkProps) {
  return (
    <svg
      className={className === undefined ? styles.mark : `${className} ${styles.mark}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={t('brand.mark.label')}
      fill="none"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 16.5 14.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 16.5 18.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

/**
 * 侧栏品牌名座位的组件 props（owner 不提供值，占位符即标记）。
 */
export type BrandNameProps =
  PropsRuntime<'sidebar.brand.name'>
  & PropsLocale<'soloengineBrand'>

/**
 * 渲染品牌名。
 * @param props - 本地化座位。
 * @returns 品牌名文本。
 */
export function BrandName({ t }: BrandNameProps) {
  return <span className={styles.name}>{t('brand.name')}</span>
}

/** 本包使用的字典键（供类型收窄）。 */
export type { SoloengineBrandKey }
