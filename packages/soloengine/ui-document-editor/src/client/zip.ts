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
  /** 机器可读码（供界面按码取本地化句子，诊断原文只进日志）。 */
  readonly code: ZipFailureCode

  /**
   * @param code - 机器可读码。
   * @param message - 面向开发者的诊断原文（含部件名等具体项）。
   */
  constructor(code: ZipFailureCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

/** ZIP/OPC 解析失败的稳定码集（界面侧本地化按此分支）。 */
export type ZipFailureCode =
  | 'not-zip'
  | 'truncated'
  | 'bad-signature'
  | 'unsupported-method'
  | 'missing-part'
  | 'malformed-xml'
  | 'too-large'

/**
 * 读取中央目录（从文件尾向前找 EOCD）。
 * @param bytes - 整包字节。
 * @returns 条目表（按中央目录顺序）。
 */
function readDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const floor = Math.max(0, bytes.length - 66_000)
  for (let index = Math.max(0, bytes.length - 22); index >= floor; index -= 1) {
    if (view.getUint32(index, true) === 0x0605_4b50) { eocd = index; break }
  }
  if (eocd === -1) throw new ZipError('not-zip', 'not a ZIP container: end-of-central-directory record not found')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length) throw new ZipError('truncated', 'truncated central directory')
    if (view.getUint32(offset, true) !== 0x0201_4b50) {
      throw new ZipError('bad-signature', `central directory entry ${String(index)} has a bad signature`)
    }
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

/** 单个部件解压上限（防御压缩炸弹：Office 包可以几十 KB inflate 到 GB 级，不设限即整页崩）。 */
const MAX_PART_BYTES = 64 * 1024 * 1024

/**
 * 解出一个部件的字节。
 * @param bytes - 整包字节。
 * @param entry - 中央目录条目。
 * @returns 部件字节。
 */
async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.localHeaderOffset + 30 > bytes.length) {
    throw new ZipError('truncated', `local header of ${entry.name} points outside the container`)
  }
  if (view.getUint32(entry.localHeaderOffset, true) !== 0x0403_4b50) {
    throw new ZipError('bad-signature', `local header of ${entry.name} has a bad signature`)
  }
  const nameLength = view.getUint16(entry.localHeaderOffset + 26, true)
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true)
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new ZipError('unsupported-method', `${entry.name} uses unsupported compression method ${String(entry.method)}`)
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (chunk.value.byteLength === 0) continue
    total += chunk.value.byteLength
    if (total > MAX_PART_BYTES) {
      await reader.cancel()
      throw new ZipError('too-large', `${entry.name} inflates beyond the ${String(MAX_PART_BYTES)} byte part limit`)
    }
    chunks.push(chunk.value)
  }
  const output = new Uint8Array(total)
  let written = 0
  for (const chunk of chunks) {
    output.set(chunk, written)
    written += chunk.byteLength
  }
  return output
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
    if (entry === undefined) throw new ZipError('missing-part', `part ${name} is missing from the package`)
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
  if (failure !== null) throw new ZipError('malformed-xml', `XML part is not well formed: ${failure.textContent}`)
  return document
}
