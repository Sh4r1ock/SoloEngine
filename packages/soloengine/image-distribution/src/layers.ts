/**
 * 分层镜像分发（W13）：标准 OCI manifest 作为外部索引、按需取层、节点缓存治理。
 *
 * 层格式不由本包定义：入口是标准 OCI/Docker image manifest 的 `layers[]`
 * （digest / mediaType / size），装配顺序即 manifest 顺序（基础层 → 组合层 → 工具层
 * 由构建侧保证）。节点缓存按内容摘要寻址：命中即跳过取层，摘要变化即选择新层；
 * 容量上限触发 LRU 淘汰，{@link LayerCache.prune} 回收不再被任何清单引用的旧层。
 *
 * 三种取层档位对应访问密度：`lazy` 逐层按需（低密度）、`batch` 有界并发批量预取
 * （中间态）、`full` 高并发全量预热（高密度）。缓存目录是节点级只读共享资源，
 * 不按用户或会话分区；缓存文件只含镜像层字节，不含任何凭据。
 *
 * @module @soloengine/image-distribution/layers
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { downloadResponseBody } from './download.ts'
import { DistributionError } from './error.ts'

/** OCI 摘要语法（algorithm:encoded）；同时保证可安全用作缓存路径。 */
const DIGEST_PATTERN = /^[a-z0-9]+(?:[+._-][a-z0-9]+)*:[0-9a-f]+$/

/** manifest 的常见媒体类型（作为 Accept 头；响应内容仍按 JSON 结构校验）。 */
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/** 镜像索引（多架构）的媒体类型前缀；本适配器要求先解析到平台清单。 */
const INDEX_MEDIA_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]

/** 标准 manifest 中的一层。 */
export interface OciLayer {
  /** 内容摘要（如 `sha256:…`）。 */
  digest: string
  /** 层媒体类型。 */
  mediaType: string
  /** 层字节数。 */
  size: number
}

/** 从标准 image manifest 提取的层清单（装配顺序即数组顺序）。 */
export interface OciManifest {
  /** manifest 媒体类型（缺省为 OCI image manifest）。 */
  mediaType: string
  /** 层列表（按装配顺序）。 */
  layers: readonly OciLayer[]
}

/**
 * 校验并读取标准 OCI/Docker image manifest。
 *
 * 只接受平台清单；多架构镜像索引必须先解析到平台清单（不静默挑一个平台）。
 * @param value - 解析后的 JSON（网络边界，必须校验）。
 * @param context - 诊断中的来源描述。
 * @returns 校验过的层清单。
 */
export function readOciManifest(value: unknown, context = 'OCI image manifest'): OciManifest {
  if (typeof value !== 'object' || value === null) throw new DistributionError(`${context} is not a JSON object`)
  const record = value as Record<string, unknown>
  if (record['schemaVersion'] !== 2) throw new DistributionError(`${context} has unsupported schemaVersion`)
  if (Array.isArray(record['manifests'])) {
    throw new DistributionError(`${context} is an image index; resolve a platform manifest before preparing layers`)
  }
  const rawLayers = record['layers']
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new DistributionError(`${context} has no layers`)
  }
  const layers: OciLayer[] = []
  for (const [index, raw] of rawLayers.entries()) {
    if (typeof raw !== 'object' || raw === null) throw new DistributionError(`${context} layer ${String(index)} is not an object`)
    const layer = raw as Record<string, unknown>
    const digest = layer['digest']
    const mediaType = layer['mediaType']
    const size = layer['size']
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      throw new DistributionError(`${context} layer ${String(index)} has an invalid digest`)
    }
    if (typeof mediaType !== 'string' || mediaType === '') {
      throw new DistributionError(`${context} layer ${String(index)} has no mediaType`)
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
      throw new DistributionError(`${context} layer ${String(index)} has an invalid size`)
    }
    layers.push({ digest, mediaType, size })
  }
  const mediaType = typeof record['mediaType'] === 'string' && record['mediaType'] !== ''
    ? record['mediaType']
    : 'application/vnd.oci.image.manifest.v1+json'
  return { mediaType, layers }
}

/** 层字节来源（registry、共享卷或部署提供的其它实现）。 */
export interface LayerSource {
  /**
   * 把一层下载到本地目标路径。
   * @param digest - 层摘要。
   * @param destination - 目标文件（父目录已创建）。
   */
  fetch(digest: string, destination: string): Promise<void>
}

/**
 * 缓存文件的布局：`<root>/layers/<algorithm>/<encoded>`。
 * @param root - 缓存根目录。
 * @param digest - 已校验的摘要。
 * @returns 绝对路径。
 */
function layerPath(root: string, digest: string): string {
  const [algorithm, encoded] = digest.split(':')
  return join(root, 'layers', algorithm as string, encoded as string)
}

/** 共享卷/本地目录形式的层来源（离线节点与测试夹具）。 */
export class FilesystemLayerSource implements LayerSource {
  /**
   * @param root - 层目录根（布局与 {@link LayerCache} 相同：`layers/<algorithm>/<encoded>`）。
   */
  constructor(private readonly root: string) {}

  async fetch(digest: string, destination: string): Promise<void> {
    const source = layerPath(this.root, digest)
    try {
      await stat(source)
    } catch (_layerAbsent) {
      throw new DistributionError(`layer ${digest} is not in the filesystem source (${this.root})`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
}

/** registry 层来源的部署输入。 */
export interface RegistryLayerSourceOptions {
  /** registry 根地址（如 `https://registry.example.com`）。 */
  baseUrl: string
  /** 仓库名（如 `soloengine/runtime`）。 */
  repository: string
  /** HTTP Basic 用户名（可选）。 */
  username?: string
  /** HTTP Basic 口令（可选）。 */
  password?: string
}

/**
 * 按 OCI Distribution API 取层的 registry 适配器。
 *
 * 只实现 manifest 读取与 blob 下载；多架构索引要求调用方先给出平台清单摘要。
 * 认证只支持部署提供的 Basic 凭据，401/403 直接失败，不静默改用匿名。
 */
export class RegistryLayerSource implements LayerSource {
  private readonly baseUrl: string
  private readonly repository: string
  private readonly authorization: string | undefined

  /**
   * @param options - registry 地址、仓库与可选凭据。
   */
  constructor(options: RegistryLayerSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.repository = options.repository
    this.authorization = options.username === undefined
      ? undefined
      : `Basic ${Buffer.from(`${options.username}:${options.password ?? ''}`).toString('base64')}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.authorization === undefined ? extra : { ...extra, authorization: this.authorization }
  }

  /**
   * 读取一个平台 image manifest。
   * @param reference - tag 或摘要。
   * @returns 校验过的层清单。
   */
  async manifest(reference: string): Promise<OciManifest> {
    const response = await fetch(
      `${this.baseUrl}/v2/${this.repository}/manifests/${encodeURIComponent(reference)}`,
      { headers: this.headers({ accept: MANIFEST_ACCEPT }) },
    )
    if (!response.ok) {
      throw new DistributionError(
        `registry manifest ${this.repository}:${reference} returned ${String(response.status)}`,
        await response.text(),
      )
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (INDEX_MEDIA_TYPES.some(mediaType => contentType.includes(mediaType))) {
      throw new DistributionError(
        `registry manifest ${this.repository}:${reference} is an image index; resolve a platform manifest first`,
      )
    }
    return readOciManifest(await response.json(), `registry manifest ${this.repository}:${reference}`)
  }

  async fetch(digest: string, destination: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/v2/${this.repository}/blobs/${digest}`,
      { headers: this.headers() },
    )
    if (!response.ok) {
      throw new DistributionError(
        `registry blob ${this.repository}@${digest} returned ${String(response.status)}`,
        await response.text(),
      )
    }
    if (response.body === null) throw new DistributionError(`registry blob ${this.repository}@${digest} has no body`)
    await downloadResponseBody(response, destination)
  }
}

/** 取层档位（按访问密度）。 */
export type LayerPrepareMode = 'lazy' | 'batch' | 'full'

/** 各档位的缺省并发（部署可经 `concurrency` 覆盖）。 */
const MODE_CONCURRENCY: Record<LayerPrepareMode, number> = { lazy: 1, batch: 4, full: 8 }

/** 节点层缓存配置。 */
export interface LayerCacheOptions {
  /** 缓存根目录（节点级共享、只读复用）。 */
  root: string
  /** 层来源。 */
  source: LayerSource
  /** 字节上限（省略表示不限制）。 */
  maxBytes?: number
  /** 条目数上限（省略表示不限制）。 */
  maxEntries?: number
  /** 诊断输出。 */
  log?: (message: string) => void
}

/** 一次取层的结果。 */
export interface LayerPrepareResult {
  /** manifest 的层数。 */
  layers: number
  /** 命中缓存、未取层的层数。 */
  hits: number
  /** 实际取层的摘要（按 manifest 顺序）。 */
  fetched: readonly string[]
  /** 因容量上限被淘汰的摘要。 */
  evicted: readonly string[]
  /** 本次取层字节数。 */
  bytesFetched: number
  /** 耗时（毫秒）。 */
  durationMs: number
}

/** 节点层缓存统计（命中率/容量遥测口径）。 */
export interface LayerCacheStats {
  /** 命中次数。 */
  hits: number
  /** 取层次数。 */
  misses: number
  /** 命中率（0~1；无请求时为 0）。 */
  hitRate: number
  /** 当前缓存条目数。 */
  entries: number
  /** 当前缓存字节数。 */
  bytes: number
  /** 淘汰次数。 */
  evictions: number
}

/** 内部条目：字节数与最近访问序。 */
interface CacheEntry {
  size: number
  access: number
}

/**
 * 节点分层镜像缓存。
 *
 * 只缓存层字节，缓存目录可在同一节点的多个会话/用户间共享；同一摘要只存一份。
 * 容量上限是硬边界：超出时按最近最少使用淘汰（优先淘汰当前 manifest 之外的层），
 * 已运行会话在其执行器内持有自己的层副本，淘汰不会改变正在运行的容器。
 */
export class LayerCache {
  private readonly root: string
  private readonly source: LayerSource
  private readonly maxBytes: number | undefined
  private readonly maxEntries: number | undefined
  private readonly log: (message: string) => void
  private readonly cached = new Map<string, CacheEntry>()
  private loaded = false
  private accessSequence = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private bytes = 0

  /**
   * @param options - 缓存根目录、层来源与容量上限。
   */
  constructor(options: LayerCacheOptions) {
    this.root = options.root
    this.source = options.source
    this.maxBytes = options.maxBytes
    this.maxEntries = options.maxEntries
    this.log = options.log ?? (() => {})
  }

  /**
   * 确保 manifest 的所有层在节点缓存中可用。
   *
   * 只取缺失层：已缓存的层直接命中（跨会话/跨用户共享），层摘要变化时只取新层。
   * @param manifest - 标准 image manifest。
   * @param options.mode - 取层档位（默认 `lazy`）。
   * @param options.concurrency - 并发覆盖（默认按档位）。
   * @returns 命中、取层与淘汰统计。
   */
  async prepare(
    manifest: OciManifest,
    options: { mode?: LayerPrepareMode; concurrency?: number } = {},
  ): Promise<LayerPrepareResult> {
    const startedAt = Date.now()
    await this.load()
    const mode = options.mode ?? 'lazy'
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? MODE_CONCURRENCY[mode]))
    let hits = 0
    const missing: OciLayer[] = []
    const missingDigests = new Set<string>()
    for (const layer of manifest.layers) {
      const cached = this.cached.get(layer.digest)
      if (cached !== undefined) {
        cached.access = ++this.accessSequence
        this.hits += 1
        hits += 1
        continue
      }
      if (missingDigests.has(layer.digest)) continue
      missingDigests.add(layer.digest)
      missing.push(layer)
    }
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        const layer = missing[index]
        if (layer === undefined) return
        await this.fetchOne(layer)
      }
    })
    await Promise.all(workers)
    const active = new Set(manifest.layers.map(layer => layer.digest))
    const evicted = await this.enforceCapacity(active)
    return {
      layers: manifest.layers.length,
      hits,
      fetched: missing.map(layer => layer.digest),
      evicted,
      bytesFetched: missing.reduce((total, layer) => total + layer.size, 0),
      durationMs: Date.now() - startedAt,
    }
  }

  /**
   * 回收不再被给定清单引用的层（哈希变更后的旧层 GC）。
   * @param activeDigests - 仍需保留的摘要集合。
   * @returns 被删除的摘要。
   */
  async prune(activeDigests: Iterable<string>): Promise<string[]> {
    await this.load()
    const active = new Set(activeDigests)
    const removed: string[] = []
    for (const [digest, entry] of [...this.cached]) {
      if (active.has(digest)) continue
      this.cached.delete(digest)
      this.bytes -= entry.size
      removed.push(digest)
      await rm(layerPath(this.root, digest), { force: true })
    }
    if (removed.length > 0) this.log(`soloengine: pruned ${String(removed.length)} unreferenced layer(s) from node cache`)
    return removed
  }

  /**
   * 当前缓存统计（命中率、条目数与字节数）。
   * @returns 统计快照。
   */
  stats(): LayerCacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      entries: this.cached.size,
      bytes: this.bytes,
      evictions: this.evictions,
    }
  }

  /**
   * 取一层并校验摘要；校验失败删除半成品并失败。
   * @param layer - manifest 中的一层。
   */
  private async fetchOne(layer: OciLayer): Promise<void> {
    const destination = layerPath(this.root, layer.digest)
    await mkdir(dirname(destination), { recursive: true })
    await this.source.fetch(layer.digest, destination)
    const actualDigest = await digestOf(destination, layer.digest)
    if (actualDigest !== layer.digest) {
      await rm(destination, { force: true })
      throw new DistributionError(`layer ${layer.digest} failed digest verification (got ${actualDigest})`)
    }
    const info = await stat(destination)
    if (info.size !== layer.size) {
      await rm(destination, { force: true })
      throw new DistributionError(`layer ${layer.digest} has ${String(info.size)} bytes, manifest declares ${String(layer.size)}`)
    }
    this.cached.set(layer.digest, { size: info.size, access: ++this.accessSequence })
    this.bytes += info.size
    this.misses += 1
  }

  /**
   * 把缓存压回容量边界（优先淘汰不在当前 manifest 中的最久未用层）。
   * @param active - 当前 manifest 的摘要。
   * @returns 被淘汰的摘要。
   */
  private async enforceCapacity(active: ReadonlySet<string>): Promise<string[]> {
    const over = (): boolean =>
      (this.maxBytes !== undefined && this.bytes > this.maxBytes)
      || (this.maxEntries !== undefined && this.cached.size > this.maxEntries)
    const evicted: string[] = []
    while (over()) {
      let candidate: string | undefined
      let candidateAccess = Number.POSITIVE_INFINITY
      for (const [digest, entry] of this.cached) {
        if (active.has(digest)) continue
        if (entry.access < candidateAccess) {
          candidate = digest
          candidateAccess = entry.access
        }
      }
      if (candidate === undefined) {
        for (const [digest, entry] of this.cached) {
          if (entry.access < candidateAccess) {
            candidate = digest
            candidateAccess = entry.access
          }
        }
      }
      if (candidate === undefined) break
      const entry = this.cached.get(candidate)
      if (entry === undefined) break
      this.cached.delete(candidate)
      this.bytes -= entry.size
      this.evictions += 1
      evicted.push(candidate)
      await rm(layerPath(this.root, candidate), { force: true })
      this.log(`soloengine: evicted layer ${candidate} from node cache (capacity)`)
    }
    return evicted
  }

  /** 首次使用时按磁盘内容恢复缓存索引（按 mtime 近似 LRU）。 */
  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const layersRoot = join(this.root, 'layers')
    let algorithms
    try {
      algorithms = await readdir(layersRoot, { withFileTypes: true })
    } catch (_emptyCache) {
      return
    }
    const found: { digest: string; size: number; mtimeMs: number }[] = []
    for (const algorithm of algorithms) {
      if (!algorithm.isDirectory()) continue
      for (const file of await readdir(join(layersRoot, algorithm.name), { withFileTypes: true })) {
        if (!file.isFile()) continue
        const absolute = join(layersRoot, algorithm.name, file.name)
        const info = await stat(absolute)
        found.push({ digest: `${algorithm.name}:${file.name}`, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
    found.sort((left, right) => left.mtimeMs - right.mtimeMs)
    for (const entry of found) {
      this.cached.set(entry.digest, { size: entry.size, access: ++this.accessSequence })
      this.bytes += entry.size
    }
    if (found.length > 0) await this.enforceCapacity(new Set())
  }
}

/**
 * 按摘要算法计算文件摘要。
 * @param path - 文件路径。
 * @param declared - manifest 声明的摘要（决定算法）。
 * @returns 实际摘要。
 */
async function digestOf(path: string, declared: string): Promise<string> {
  const algorithm = declared.slice(0, declared.indexOf(':'))
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return `${algorithm}:${hash.digest('hex')}`
}
