/**
 * 文本/二进制判定（技能编辑器与 MCP 上传服务器文件编辑共用同一份规则）。
 *
 * @module @soloengine/framework/util/text
 */

import { isUtf8 } from 'node:buffer'

/** 已知二进制魔数（前 8 字节内命中即判二进制）。 */
const BINARY_MAGIC: readonly (readonly number[])[] = [
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0x47, 0x49, 0x46, 0x38], // GIF8
  [0xff, 0xd8, 0xff], // JPEG
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x1f, 0x8b], // gzip
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xd0, 0xcf, 0x11, 0xe0], // OLE（doc/xls/ppt）
  [0x52, 0x49, 0x46, 0x46], // RIFF（webp/wav/avi）
  [0x4d, 0x5a], // PE
]

/**
 * 尾部是否是一个「开头合法、但被采样截断」的 UTF-8 多字节序列。
 *
 * 文件尾采样（4KB）可能切在字符中间：这段残片在完整文件里是合法的，不能因此把
 * 整个文件判成二进制。只接受真正可能补全的前缀（含过长/代理区间的首字节约束）。
 * @param tail - 采样末尾的 1~3 字节。
 * @returns 是否是一个未完成但合法的多字节序列开头。
 */
function isIncompleteUtf8Tail(tail: Uint8Array): boolean {
  if (tail.length === 0 || tail.length > 3) return false
  const lead = tail[0] as number
  const second = tail[1]
  const need = lead >= 0xc2 && lead <= 0xdf
    ? 2
    : lead >= 0xe0 && lead <= 0xef
      ? 3
      : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0
  if (need === 0 || tail.length >= need) return false
  if (second !== undefined) {
    if (second < 0x80 || second > 0xbf) return false
    if (lead === 0xe0 && second < 0xa0) return false
    if (lead === 0xed && second > 0x9f) return false
    if (lead === 0xf0 && second < 0x90) return false
    if (lead === 0xf4 && second > 0x8f) return false
  }
  for (let index = 2; index < tail.length; index += 1) {
    const byte = tail[index] as number
    if (byte < 0x80 || byte > 0xbf) return false
  }
  return true
}

/**
 * 判定字节是否为可文本化内容。
 *
 * 先按魔数排除常见二进制（PDF/图片/压缩包/可执行/OLE/RIFF），再检查前 4KB 的控制字符，
 * 最后要求内容本身是合法 UTF-8：编辑器按 UTF-8 读入并按 UTF-8 写回，GBK 等其它编码
 * 会被解码成替换字符、保存时永久丢字节，只能按二进制处理（不读入编辑器）。
 * @param data - 原始字节（完整文件，或 `sample: true` 时的 4KB 采样）。
 * @param options - `sample` 为真时允许末尾 1~3 字节是采样截断的半个字符。
 * @returns 是否可当文本编辑。
 */
export function looksTextual(data: Uint8Array, options: { sample?: boolean } = {}): boolean {
  if (data.length === 0) return true
  for (const magic of BINARY_MAGIC) {
    if (magic.every((byte, index) => data[index] === byte)) return false
  }
  const sample = data.subarray(0, Math.min(4096, data.length))
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 0x09) return false
    if (byte > 0x0d && byte < 0x20) return false
  }
  // 整份文件必须整体合法；只有采样形态才允许末尾是截断的半个字符。
  if (isUtf8(options.sample === true ? sample : data)) return true
  if (options.sample !== true) return false
  // 采样截断在字符中间：让出 1~3 字节后前缀合法、且残片能补全才算文本。
  for (let trim = 1; trim <= 3 && trim < sample.length; trim += 1) {
    const end = sample.length - trim
    if (isUtf8(sample.subarray(0, end)) && isIncompleteUtf8Tail(sample.subarray(end))) return true
  }
  return false
}
