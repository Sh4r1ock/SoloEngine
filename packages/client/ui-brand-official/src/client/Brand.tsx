import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { brandCopy } from './locales.ts'
import { BrandGlyph } from './Glyph.tsx'

/** 品牌标记颜色：只由官方品牌座位承载。 */
const MARK_STYLE = {
  display: 'block',
  color: 'var(--dsw-alias-brand-primary)',
} as const

/** 品牌字标约定（Plan W7）：18px / 600 / 0.04em，行盒固定。 */
const NAME_STYLE = {
  fontFamily: 'var(--dsw-font-family)',
  fontSize: '18px',
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '0.04em',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
} as const

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the SoloEngine mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <span style={MARK_STYLE}><BrandGlyph size={size} label={brandCopy.name} /></span>
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the SoloEngine name wordmark.
 */
export function OfficialBrandName() {
  return <span style={NAME_STYLE}>{brandCopy.name}</span>
}

/**
 * Render the conversation hero mark, reusing the same product glyph.
 * @param props - Host-supplied size and optional class name.
 * @returns the SoloEngine mark.
 */
export function OfficialHeroBrandMark({ size, className }: PropsRuntime<'conversation.hero.brand.mark'>) {
  const glyph = <BrandGlyph size={size} className={className} label={brandCopy.name} />
  return className === undefined ? <span style={MARK_STYLE}>{glyph}</span> : glyph
}
