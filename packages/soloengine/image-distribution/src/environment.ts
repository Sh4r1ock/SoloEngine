/**
 * 环境导出（W13，pack_diff 等价物）：把会话检查点的工作区导出为可复用环境。
 *
 * 导出在两个账号语义下完成：**builder** 负责构建，**runtime** 负责运行；两者必须不同，
 * 否则直接失败（账号分离是防泄漏前提）。导出前剥离构建期残留（VCS 元数据、环境变量
 * 文件、缓存、测试产物与日志），并写出导出记录；{@link verifyEnvironmentExport}
 * 重新逐文件核对摘要与残留，作为防泄漏验收判据。
 *
 * 导出产物是普通文件树 + 一份记录文件，不是新的镜像格式；运行时直接消耗该文件树。
 *
 * @module @soloengine/image-distribution/environment
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DistributionError } from './error.ts'

/** 导出记录文件名（位于导出根目录）。 */
export const ENVIRONMENT_RECORD = '.soloengine-environment.json'

/** 导出记录格式标识。 */
export const ENVIRONMENT_FORMAT = 'soloengine.environment/v1'

/**
 * 缺省剥离的构建期残留：版本库元数据、环境变量文件、缓存/测试产物与日志。
 *
 * 部署可用 `residue` 追加项目特有残留；模式不含 `/` 时按文件名匹配，
 * 含 `/` 时按相对路径匹配，`*` 匹配段内任意字符。
 */
export const DEFAULT_BUILD_RESIDUE: readonly string[] = [
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  '.env',
  '.env*',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.cache',
  'node_modules/.cache',
  'coverage',
  '.nyc_output',
  '*.log',
  '*.pyc',
]

/** 导出选项。 */
export interface EnvironmentExportOptions {
  /** 源工作区根目录（会话检查点的工作树）。 */
  source: string
  /** 导出目标目录（必须位于源目录之外；导出前清空）。 */
  destination: string
  /** 构建账号（仅构建期使用）。 */
  builderAccount: string
  /** 运行账号（导出产物在运行期的身份）。 */
  runtimeAccount: string
  /** 追加的残留模式（与 {@link DEFAULT_BUILD_RESIDUE} 合并）。 */
  residue?: readonly string[]
  /** 诊断输出。 */
  log?: (message: string) => void
}

/** 导出结果。 */
export interface EnvironmentExportResult {
  /** 导出的文件数。 */
  files: number
  /** 导出字节数。 */
  bytes: number
  /** 被剥离的相对路径（目录或文件）。 */
  stripped: readonly string[]
  /** 导出记录路径。 */
  recordPath: string
}

/** 导出记录中的一份文件。 */
export interface EnvironmentFileEntry {
  /** 相对 POSIX 路径。 */
  path: string
  /** sha256 摘要。 */
  digest: string
  /** 字节数。 */
  size: number
}

/** 导出记录（防泄漏校验的输入）。 */
export interface EnvironmentRecord {
  /** 格式标识。 */
  format: string
  /** 构建账号。 */
  builderAccount: string
  /** 运行账号。 */
  runtimeAccount: string
  /** 导出时刻（ISO）。 */
  createdAt: string
  /** 本次生效的残留模式。 */
  residue: readonly string[]
  /** 导出的文件清单（按路径排序）。 */
  files: readonly EnvironmentFileEntry[]
  /** 被剥离的相对路径。 */
  stripped: readonly string[]
}

/** 一次导出的中间状态。 */
interface ExportState {
  files: EnvironmentFileEntry[]
  stripped: string[]
  bytes: number
}

/**
 * 模式匹配：不含 `/` 的模式按文件名匹配，含 `/` 的模式按相对路径匹配。
 * @param relativePath - 相对 POSIX 路径。
 * @param patterns - 残留模式。
 * @returns 是否命中。
 */
function isResidue(relativePath: string, patterns: readonly string[]): boolean {
  const base = relativePath.split('/').pop() ?? relativePath
  return patterns.some((pattern) => {
    const target = pattern.includes('/') ? relativePath : base
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replace(/\*/gu, '[^/]*')
      .replace(/\?/gu, '[^/]')
    return new RegExp(`^${escaped}$`, 'u').test(target)
  })
}

/**
 * 递归导出工作区，剥离残留并写出记录。
 * @param options - 源/目标、双账号与残留模式。
 * @returns 导出统计。
 */
export async function exportEnvironment(options: EnvironmentExportOptions): Promise<EnvironmentExportResult> {
  const builderAccount = options.builderAccount.trim()
  const runtimeAccount = options.runtimeAccount.trim()
  if (builderAccount === '' || runtimeAccount === '') {
    throw new DistributionError('environment export requires both builder and runtime accounts')
  }
  if (builderAccount === runtimeAccount) {
    throw new DistributionError(
      `environment export requires distinct builder and runtime accounts (both are "${builderAccount}")`,
    )
  }
  const source = resolve(options.source)
  const destination = resolve(options.destination)
  if (
    destination === source
    || destination.startsWith(source + sep)
    || source.startsWith(destination + sep)
  ) {
    throw new DistributionError(`environment export source and destination must not contain each other (${source} → ${destination})`)
  }
  const sourceInfo = await stat(source).catch((error: unknown) => {
    throw new DistributionError(`environment export source is not readable: ${source}`, String(error))
  })
  if (!sourceInfo.isDirectory()) throw new DistributionError(`environment export source is not a directory: ${source}`)
  const patterns = [...DEFAULT_BUILD_RESIDUE, ...(options.residue ?? [])]
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  const state: ExportState = { files: [], stripped: [], bytes: 0 }
  await exportDirectory(source, source, destination, patterns, state)
  state.files.sort((left, right) => left.path.localeCompare(right.path))
  const record: EnvironmentRecord = {
    format: ENVIRONMENT_FORMAT,
    builderAccount,
    runtimeAccount,
    createdAt: new Date().toISOString(),
    residue: patterns,
    files: state.files,
    stripped: state.stripped.sort((left, right) => left.localeCompare(right)),
  }
  const recordPath = join(destination, ENVIRONMENT_RECORD)
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  const log = options.log ?? (() => {})
  log(
    `soloengine: exported environment ${source} → ${destination} `
    + `(${String(state.files.length)} file(s), ${String(state.bytes)} byte(s), ${String(state.stripped.length)} stripped)`,
  )
  return { files: state.files.length, bytes: state.bytes, stripped: record.stripped, recordPath }
}

/**
 * 递归导出目录内容。
 * @param root - 源根（相对路径基准）。
 * @param directory - 当前目录。
 * @param destination - 导出根。
 * @param patterns - 残留模式。
 * @param state - 累计状态。
 */
async function exportDirectory(
  root: string,
  directory: string,
  destination: string,
  patterns: readonly string[],
  state: ExportState,
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    const path = relative(root, absolute).split(sep).join('/')
    if (entry.isSymbolicLink()) {
      state.stripped.push(path)
      continue
    }
    if (isResidue(path, patterns)) {
      state.stripped.push(path)
      continue
    }
    if (entry.isDirectory()) {
      await exportDirectory(root, absolute, destination, patterns, state)
      continue
    }
    if (!entry.isFile()) continue
    const bytes = await readFile(absolute)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const target = join(destination, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    state.files.push({ path, digest, size: bytes.byteLength })
    state.bytes += bytes.byteLength
  }
}

/**
 * 校验导出产物：双账号分离、无构建残留、文件摘要与记录一致。
 * @param destination - 导出根目录。
 * @returns 文件数与字节数。
 */
export async function verifyEnvironmentExport(
  destination: string,
): Promise<{ files: number; bytes: number }> {
  const root = resolve(destination)
  const recordPath = join(root, ENVIRONMENT_RECORD)
  let raw: string
  try {
    raw = await readFile(recordPath, 'utf8')
  } catch (_recordAbsent) {
    throw new DistributionError(`environment export record is missing: ${recordPath}`)
  }
  const record = readEnvironmentRecord(JSON.parse(raw), recordPath)
  if (record.builderAccount === record.runtimeAccount) {
    throw new DistributionError('environment export record has identical builder and runtime accounts')
  }
  const actual = new Map<string, { digest: string; size: number }>()
  const bytes = await collectExported(root, root, record.residue, actual)
  const expected = new Map(record.files.map(entry => [entry.path, entry]))
  for (const [path, entry] of actual) {
    const declared = expected.get(path)
    if (declared === undefined) throw new DistributionError(`environment export contains an unrecorded file: ${path}`)
    if (declared.digest !== entry.digest) {
      throw new DistributionError(`environment export file digest mismatch: ${path}`)
    }
  }
  for (const path of expected.keys()) {
    if (!actual.has(path)) throw new DistributionError(`environment export is missing a recorded file: ${path}`)
  }
  return { files: actual.size, bytes }
}

/**
 * 递归收集导出文件并核对残留/摘要。
 * @param root - 导出根。
 * @param directory - 当前目录。
 * @param patterns - 记录中的残留模式。
 * @param found - 累计文件。
 * @returns 累计字节数。
 */
async function collectExported(
  root: string,
  directory: string,
  patterns: readonly string[],
  found: Map<string, { digest: string; size: number }>,
): Promise<number> {
  let bytes = 0
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    const path = relative(root, absolute).split(sep).join('/')
    if (path === ENVIRONMENT_RECORD) continue
    if (entry.isSymbolicLink()) throw new DistributionError(`environment export contains a symbolic link: ${path}`)
    if (isResidue(path, patterns)) throw new DistributionError(`environment export contains build residue: ${path}`)
    if (entry.isDirectory()) {
      bytes += await collectExported(root, absolute, patterns, found)
      continue
    }
    if (!entry.isFile()) continue
    const data = await readFile(absolute)
    found.set(path, { digest: createHash('sha256').update(data).digest('hex'), size: data.byteLength })
    bytes += data.byteLength
  }
  return bytes
}

/**
 * 校验导出记录（文件边界）。
 * @param value - 解析后的 JSON。
 * @param context - 诊断来源。
 * @returns 记录。
 */
function readEnvironmentRecord(value: unknown, context: string): EnvironmentRecord {
  if (typeof value !== 'object' || value === null) throw new DistributionError(`${context} is not a JSON object`)
  const record = value as Record<string, unknown>
  if (record['format'] !== ENVIRONMENT_FORMAT) throw new DistributionError(`${context} has an unsupported format`)
  if (typeof record['builderAccount'] !== 'string' || typeof record['runtimeAccount'] !== 'string') {
    throw new DistributionError(`${context} has invalid account fields`)
  }
  if (typeof record['createdAt'] !== 'string') throw new DistributionError(`${context} has no createdAt`)
  if (!Array.isArray(record['residue']) || !record['residue'].every(item => typeof item === 'string')) {
    throw new DistributionError(`${context} has invalid residue patterns`)
  }
  if (!Array.isArray(record['stripped']) || !record['stripped'].every(item => typeof item === 'string')) {
    throw new DistributionError(`${context} has invalid stripped entries`)
  }
  const rawFiles = record['files']
  if (!Array.isArray(rawFiles)) throw new DistributionError(`${context} has no files array`)
  const files: EnvironmentFileEntry[] = []
  for (const [index, raw] of rawFiles.entries()) {
    if (typeof raw !== 'object' || raw === null) throw new DistributionError(`${context} file ${String(index)} is not an object`)
    const file = raw as Record<string, unknown>
    const path = file['path']
    const digest = file['digest']
    const size = file['size']
    if (typeof path !== 'string' || path === '' || path.includes('..')) {
      throw new DistributionError(`${context} file ${String(index)} has an invalid path`)
    }
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) {
      throw new DistributionError(`${context} file ${String(index)} has an invalid digest`)
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
      throw new DistributionError(`${context} file ${String(index)} has an invalid size`)
    }
    files.push({ path, digest, size })
  }
  return {
    format: ENVIRONMENT_FORMAT,
    builderAccount: record['builderAccount'],
    runtimeAccount: record['runtimeAccount'],
    createdAt: record['createdAt'],
    residue: record['residue'],
    files,
    stripped: record['stripped'],
  }
}
