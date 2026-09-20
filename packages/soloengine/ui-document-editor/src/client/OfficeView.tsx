/**
 * Office 视图（PRD-08 FR-OPS-006）：浏览器内解析渲染（无外部 Document Server 端口）。
 *
 * 降级链（逐级明示，不假成功）：可渲染 → 呈现；不可渲染（损坏 / 版本不支持 / 解析失败）
 * → 明确说明原因。
 *
 * @module @soloengine/ui-document-editor/OfficeView
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { parseOffice, type OfficeContent } from './office.ts'
import styles from './EditorView.module.css'
import type { SoloengineEditorKey } from './locales.ts'

/** Office 视图 props。 */
export type OfficeViewProps =
  PropsRuntime<'sidebar.right.tab.document'>
  & PropsLocale<'soloengineEditor'>

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
      setReason('the document bytes were not delivered to the renderer')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await parseOffice(extension, content.data)
        if (!cancelled) { setParsed(result); setReason(null) }
      } catch (failure) {
        if (!cancelled) setReason(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true }
  }, [content, extension])

  if (reason !== null) {
    return <div className={styles.error} role="alert">{t('office.unsupported').replace('{reason}', reason)}</div>
  }
  if (parsed === null) return <div className={styles.state}>{t('office.loading')}</div>

  if (parsed.kind === 'docx') {
    return (
      <div className={styles.document}>
        <div className={styles.state}>{t('office.paragraphs').replace('{count}', String(parsed.paragraphs.length))}</div>
        {parsed.paragraphs.map((paragraph, index) => <p key={index} className={styles.paragraph}>{paragraph}</p>)}
      </div>
    )
  }
  if (parsed.kind === 'xlsx') {
    return (
      <div className={styles.document}>
        <div className={styles.state}>{t('office.sheets').replace('{count}', String(parsed.sheets.length))}</div>
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
      <div className={styles.state}>{t('office.slides').replace('{count}', String(parsed.slides.length))}</div>
      {parsed.slides.map(slide => (
        <section key={slide.index} className={styles.slide}>
          <div className={styles.caption}>{`slide ${String(slide.index)}`}</div>
          {slide.lines.map((line, index) => <p key={index} className={styles.paragraph}>{line}</p>)}
        </section>
      ))}
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineEditorKey }
