/**
 * 文本/二进制判定（技能编辑器与 MCP 上传服务器文件编辑共用同一份规则）。
 *
 * @module @soloengine/framework/util/text
 */

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
 * 判定字节是否为可文本化内容。
 *
 * 先按魔数排除常见二进制（PDF/图片/压缩包/可执行/OLE/RIFF），再检查前 4KB 的控制字符；
 * 任一处判二进制即返回 false——文本编辑器不得把二进制当 UTF-8 读入再写回。
 * @param data - 原始字节（至少前 4KB）。
 * @returns 是否可当文本编辑。
 */
export function looksTextual(data: Uint8Array): boolean {
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
  return true
}
