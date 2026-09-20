/**
 * 最小 ZIP 读取器（Office 文档解析用；不引第三方解压库）。
 *
 * Office（docx/xlsx/pptx）是 OPC 包：ZIP 容器 + XML 部件。本模块只做两件事——
 * 读中央目录取部件清单、按需解出单个部件字节；deflate 走浏览器原生 `DecompressionStream('deflate-raw')`。
 *
 * @module @soloengine/ui-document-editor/zip
 */

/** 一个 ZIP 条目。 */
interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

/** ZIP 解析失败（明确报出原因，不静默降级）。 */
export class ZipError extends Error {
  /**
   * @param message - 人类可读原因。
   */
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * 读取中央目录（从文件尾向前找 EOCD）。
 * @param bytes - 整包字节。
 * @returns 条目表（按中央目录顺序）。
 */
function readDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const floor = Math.max(0, bytes.length - 66_000)
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (view.getUint32(index, true) === 0x0605_4b50) { eocd = index; break }
  }
  if (eocd === -1) throw new ZipError('not a ZIP container: end-of-central-directory record not found')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length) throw new ZipError('truncated central directory')
    if (view.getUint32(offset, true) !== 0x0201_4b50) throw new ZipError(`central directory entry ${String(index)} has a bad signature`)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * 解出一个部件的字节。
 * @param bytes - 整包字节。
 * @param entry - 中央目录条目。
 * @returns 部件字节。
 */
async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(entry.localHeaderOffset, true) !== 0x0403_4b50) {
    throw new ZipError(`local header of ${entry.name} has a bad signature`)
  }
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true)
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true)
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new ZipError(`${entry.name} uses unsupported compression method ${String(entry.method)}`)
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * 打开一个 OPC 包，返回按名取部件的读取器。
 * @param data - 整包字节。
 * @returns 部件名清单与读取函数。
 */
export function openPackage(data: Uint8Array): {
  names: string[]
  read: (name: string) => Promise<Uint8Array>
  readText: (name: string) => Promise<string>
} {
  const entries = readDirectory(data)
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  const entryOf = (name: string): ZipEntry => {
    const entry = byName.get(name)
    if (entry === undefined) throw new ZipError(`part ${name} is missing from the package`)
    return entry
  }
  return {
    names: entries.map(entry => entry.name),
    read: (name: string) => readEntry(data, entryOf(name)),
    readText: async (name: string) => new TextDecoder().decode(await readEntry(data, entryOf(name))),
  }
}

/**
 * 解析 XML 文本（解析失败即明确报错）。
 * @param text - XML 文本。
 * @returns 文档对象。
 */
export function parseXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  const failure = document.querySelector('parsererror')
  if (failure !== null) throw new ZipError(`XML part is not well formed: ${failure.textContent ?? ''}`)
  return document
}
