/**
 * Office 视图（PRD-08 FR-OPS-006）：浏览器内解析渲染（无外部 Document Server 端口）。
 *
 * 降级链三档（逐级明示，不假成功）：**只读**（解析成功——本插件的 Office 解析器是纯读实现，
 * 无编辑写回，故呈现成功即明确标注「只读」）→ 不可渲染（损坏 / 版本不支持 / 解析失败）
 * → 明确说明原因。
 *
 * @module @soloengine/ui-document-editor/OfficeView
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { ZipError } from './zip.ts'
import { parseOffice, type OfficeContent } from './office.ts'
import styles from './EditorView.module.css'
import type { SoloengineEditorKey } from './locales.ts'

/** Office 视图 props。 */
export type OfficeViewProps =
  PropsRuntime<'sidebar.right.tab.document'>
  & PropsLocale<'soloengineEditor'>

/** ZipError 码 → 本面板文案键（诊断原文含部件名与英文说明，不进用户可见层）。 */
const ZIP_REASON_KEYS: Record<string, SoloengineEditorKey> = {
  'not-zip': 'office.zipNotZip',
  truncated: 'office.zipTruncated',
  'bad-signature': 'office.zipSignature',
  'unsupported-method': 'office.zipMethod',
  'missing-part': 'office.zipPart',
  'malformed-xml': 'office.zipXml',
  'too-large': 'office.zipTooLarge',
}

/**
 * 渲染 Office 文档（docx/xlsx/pptx）。
 * @param props - 文档 owner 座位与本地化座位。
 * @returns 解析结果或明确的原因说明。
 */
export function OfficeView({ resourceAddress, content, t }: OfficeViewProps) {
  const [parsed, setParsed] = useState<OfficeContent | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const address = parseFileAddress(resourceAddress)
  const extension = (address?.path ?? resourceAddress).toLowerCase().match(/\.[a-z0-9]+$/u)?.[0] ?? ''

  useEffect(() => {
    if (content.kind !== 'bytes') {
      setReason(t('office.noBytes'))
      return
    }
    const cancelledRef = { current: false }
    void (async () => {
      try {
        const result = await parseOffice(extension, content.data)
        if (!cancelledRef.current) { setParsed(result); setReason(null) }
      } catch (failure) {
        if (cancelledRef.current) return
        const key = failure instanceof ZipError ? ZIP_REASON_KEYS[failure.code] : undefined
        // 降级说明要具体到「哪一档失败」，但不能把开发者诊断原文（英文 + 部件名）丢给人看。
        setReason(key !== undefined
          ? t(key)
          : failure instanceof ZipError ? failure.message : t('office.unsupportedExt', { extension }))
      }
    })()
    return () => { cancelledRef.current = true }
  }, [content, extension, t])

  if (reason !== null) {
    return <div className={styles.error} role="alert">{t('office.unsupported', { reason })}</div>
  }
  if (parsed === null) return <div className={styles.state}>{t('office.loading')}</div>

  // 中间档：只读（明示，不与文本编辑器的可编辑档混同——Office 解析器无编辑写回）。
  // 用中性说明色而非成功绿：只读不是「做成了什么」，绿标会把它误读成操作反馈。
  const readOnlyBanner = <div className={styles.note}>{t('office.readonly')}</div>

  if (parsed.kind === 'docx') {
    return (
      <div className={styles.document}>
        {readOnlyBanner}
        <div className={styles.state}>{t('office.paragraphs', { count: parsed.paragraphs.length })}</div>
        {parsed.paragraphs.map((paragraph, index) => <p key={index} className={styles.paragraph}>{paragraph}</p>)}
      </div>
    )
  }
  if (parsed.kind === 'xlsx') {
    return (
      <div className={styles.document}>
        {readOnlyBanner}
        <div className={styles.state}>{t('office.sheets', { count: parsed.sheets.length })}</div>
        {parsed.sheets.map(sheet => (
          <table key={sheet.name} className={styles.table}>
            <caption className={styles.caption}>{sheet.name}</caption>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex} className={styles.cell}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    )
  }
  return (
    <div className={styles.document}>
      {readOnlyBanner}
      <div className={styles.state}>{t('office.slides', { count: parsed.slides.length })}</div>
      {parsed.slides.map(slide => (
        <section key={slide.index} className={styles.slide}>
          <div className={styles.caption}>{t('office.slide', { index: slide.index })}</div>
          {slide.lines.map((line, index) => <p key={index} className={styles.paragraph}>{line}</p>)}
        </section>
      ))}
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineEditorKey }
