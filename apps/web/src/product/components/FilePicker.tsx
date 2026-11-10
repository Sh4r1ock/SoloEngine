/**
 * 统一的产品化文件选择控件。
 *
 * 缺陷背景：技能导入向导与 MCP 包上传直接用原生 `<input type="file">`，浏览器渲染出
 * OS 原生「选择文件 / 未选择任何文件」控件（与产品控件语言不一致，且文案不受 i18n 控制）。
 * 本组件把原生输入视觉隐藏、由 ui-primitives 的 Button 触发，选中文件名用产品字号轴呈现。
 *
 * @module product/components/FilePicker
 */
import { useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../i18n.ts'
import { NoticeLine } from './NoticeLine.tsx'
import css from '../styles/common.module.css'

/** 组件属性。 */
export interface FilePickerProps {
  /** `accept` 属性（如 `.zip`）；省略表示不限。 */
  accept?: string
  /** 已选文件名；空串表示未选择。 */
  fileName?: string
  /** 是否由本组件展示文件名（调用方另有更详细回显时传 false）。 */
  showName?: boolean
  /** 允许的最大字节数；省略表示不限制（服务端仍为最终权威）。 */
  maxBytes?: number
  /** 选中文件回调（调用方自行读取内容）。 */
  onFile: (file: File) => void
}

/**
 * 按 `accept` 判定选中文件是否可用（R28 前置校验）。
 *
 * `accept` 只是 OS 选择框的过滤器：用户可切到「所有文件」绕过，此前组件把任何文件都
 * 直接交给调用方（实测选 .txt 也照常 base64 上传）。扩展名、`type/*`、精确 MIME 三种
 * 写法都支持；未给 accept 时不设限。
 */
function matchesAccept(file: File, accept: string | undefined): boolean {
  const patterns = (accept ?? '').split(',').map(item => item.trim().toLowerCase()).filter(item => item !== '')
  if (patterns.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern)
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1))
    return type === pattern
  })
}

/**
 * 字节数 → 人类可读上限（整 MB 取整，其余保留一位小数）。
 * @param bytes - 字节数。
 * @returns 例如 `64 MB`。
 */
function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`
}

/**
 * 渲染文件选择控件。
 * @param props - 见 {@link FilePickerProps}。
 */
export function FilePicker({ accept, fileName = '', showName = true, maxBytes, onFile }: FilePickerProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = useState<string | null>(null)
  return (
    <>
      <div className={css.filePicker}>
        {/* 原生输入被视觉隐藏成 1×1（clip-path），保留可聚焦会让键盘焦点落进看不见的
            元素（实测 tabIndex=0 / 1×1 / WCAG 2.4.7 焦点不可见）。控件真身是下面那颗按钮，
            输入只是被程序触发，故移出 tab 序并对辅助技术隐藏。 */}
        <input
          ref={ref}
          type="file"
          aria-hidden="true"
          tabIndex={-1}
          {...(accept === undefined ? {} : { accept })}
          className={css.filePickerInput ?? ''}
          onChange={(event) => {
            const input = event.currentTarget
            const file = input.files?.[0]
            // 选中后清空原生值：同一文件再次选择仍会触发 change，校验/上传失败后可重试。
            input.value = ''
            if (file === undefined) return
            if (!matchesAccept(file, accept)) {
              setRejected(t('common', 'fileTypeRejected', { accept: accept ?? '' }))
              return
            }
            if (maxBytes !== undefined && file.size > maxBytes) {
              setRejected(t('common', 'fileTooLarge', { limit: formatLimit(maxBytes) }))
              return
            }
            setRejected(null)
            onFile(file)
          }}
        />
        <Button size="sm" onClick={() => { ref.current?.click() }}>{t('common', 'actionPickFile')}</Button>
        {showName && (
          <span role="status" className={css.filePickerName ?? ''} title={fileName === '' ? undefined : fileName}>
            {fileName === '' ? t('common', 'stateNoFileChosen') : fileName}
          </span>
        )}
      </div>
      {/* 拒绝原因另起一行（`.filePicker` 是横排），就近出现在控件下方（R8 就近具体 / R17 出路）。 */}
      <NoticeLine tone="error" text={rejected} />
    </>
  )
}
