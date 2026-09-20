/**
 * Office 浏览器内解析（PRD-08 FR-OPS-006；不引入任何外部 Document Server 端口）。
 *
 * 三格式各自取最小可读呈现：
 * - `.docx`：`word/document.xml` 的段落与文本运行；
 * - `.xlsx`：`xl/sharedStrings.xml` + `xl/worksheets/sheet*.xml` 的行列；
 * - `.pptx`：`ppt/slides/slide*.xml` 的每页文本。
 *
 * 解析失败（损坏/版本不支持）即抛错——由面板按「真编辑 → 只读查看 → 明确说明原因」逐级降级。
 *
 * @module @soloengine/ui-document-editor/office
 */

import { openPackage, parseXml } from './zip.ts'

/** 一种 Office 文档的解析结果。 */
export type OfficeContent =
  | { kind: 'docx'; paragraphs: string[] }
  | { kind: 'xlsx'; sheets: { name: string; rows: string[][] }[] }
  | { kind: 'pptx'; slides: { index: number; lines: string[] }[] }

/**
 * 取元素下所有指定本地名的后代文本。
 * @param root - 起点。
 * @param localName - 本地名（忽略命名空间前缀）。
 * @returns 文本片段（保持文档顺序）。
 */
function textsOf(root: Element | Document, localName: string): string[] {
  return [...root.getElementsByTagName('*')]
    .filter(node => node.localName === localName)
    .map(node => node.textContent ?? '')
}

/**
 * 解析 docx。
 * @param data - 包字节。
 * @returns 段落文本。
 */
async function parseDocx(data: Uint8Array): Promise<OfficeContent> {
  const pkg = openPackage(data)
  const document = parseXml(await pkg.readText('word/document.xml'))
  const paragraphs = [...document.getElementsByTagName('*')]
    .filter(node => node.localName === 'p')
    .map(node => textsOf(node, 't').join(''))
  return { kind: 'docx', paragraphs }
}

/** 把一列字母编号（A、AB…）换算为 0 基列号。 */
function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Za-z]/gu, '').toUpperCase()
  let value = 0
  for (const character of letters) value = value * 26 + (character.charCodeAt(0) - 64)
  return Math.max(0, value - 1)
}

/**
 * 解析 xlsx。
 * @param data - 包字节。
 * @returns 每个工作表的行列文本。
 */
async function parseXlsx(data: Uint8Array): Promise<OfficeContent> {
  const pkg = openPackage(data)
  const shared: string[] = []
  if (pkg.names.includes('xl/sharedStrings.xml')) {
    const strings = parseXml(await pkg.readText('xl/sharedStrings.xml'))
    for (const item of [...strings.getElementsByTagName('*')].filter(node => node.localName === 'si')) {
      shared.push(textsOf(item, 't').join(''))
    }
  }
  const sheetNames = pkg.names
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const sheets: { name: string; rows: string[][] }[] = []
  for (const name of sheetNames) {
    const sheet = parseXml(await pkg.readText(name))
    const rows: string[][] = []
    for (const row of [...sheet.getElementsByTagName('*')].filter(node => node.localName === 'row')) {
      const cells: string[] = []
      for (const cell of [...row.getElementsByTagName('*')].filter(node => node.localName === 'c')) {
        const reference = cell.getAttribute('r') ?? ''
        const type = cell.getAttribute('t') ?? ''
        const value = textsOf(cell, 'v')[0] ?? ''
        const text = type === 's' ? shared[Number(value)] ?? '' : value
        const index = columnIndex(reference)
        while (cells.length < index) cells.push('')
        cells[index] = text
      }
      rows.push(cells)
    }
    sheets.push({ name, rows })
  }
  return { kind: 'xlsx', sheets }
}

/**
 * 解析 pptx。
 * @param data - 包字节。
 * @returns 每页的文本行。
 */
async function parsePptx(data: Uint8Array): Promise<OfficeContent> {
  const pkg = openPackage(data)
  const slideNames = pkg.names
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const slides: { index: number; lines: string[] }[] = []
  for (const [index, name] of slideNames.entries()) {
    const slide = parseXml(await pkg.readText(name))
    slides.push({ index: index + 1, lines: textsOf(slide, 't').filter(line => line !== '') })
  }
  return { kind: 'pptx', slides }
}

/**
 * 按扩展名解析一个 Office 包。
 * @param extension - 小写扩展名（含点）。
 * @param data - 包字节。
 * @returns 解析结果。
 * @throws Error - 不支持的扩展名或包损坏。
 */
export async function parseOffice(extension: string, data: Uint8Array): Promise<OfficeContent> {
  switch (extension) {
    case '.docx': return parseDocx(data)
    case '.xlsx': return parseXlsx(data)
    case '.pptx': return parsePptx(data)
    default: throw new Error(`no Office parser is registered for ${extension}`)
  }
}
