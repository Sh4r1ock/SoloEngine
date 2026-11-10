/**
 * 工作区 / 镜像分发层（W10.12 / W13）。
 *
 * 四条独立能力：
 * - {@link ImageCache}：节点镜像缓存——本地命中（`local`）、按需拉取（`pulled`）、
 *   拉取失败显式报错；不自研层格式，镜像分发交给容器运行时的常规 registry 路径。
 * - {@link WorkspaceStore}：内容寻址（sha256）的工作区对象存储。**对象存储权威 + 本地副本**：
 *   `put` 同时写远端权威与本地缓存；`get` 先本地命中，未命中再从远端下载并回填本地。
 *   统计命中率供 W10.12 的「缓存命中率 ≥80%」验收读取。
 * - {@link LayerCache}：标准 OCI manifest 驱动的分层取层与节点缓存治理（按需/批量/全量
 *   三档、容量淘汰、命中率遥测、哈希变更 GC），层格式由外部标准定义。
 * - {@link exportEnvironment}：会话检查点的工作区环境导出（builder/runtime 账号分离、
 *   剥离构建残留），{@link verifyEnvironmentExport} 提供防泄漏验收。
 *
 * @module @soloengine/image-distribution
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DistributionError } from './error.ts'
import type { ObjectStore } from './object-store.ts'

export { DistributionError } from './error.ts'
export type { ObjectStore } from './object-store.ts'
export * from './layers.ts'
export * from './environment.ts'
export * from './s3.ts'


/** 镜像命中档位。 */
export type ImageTier = 'local' | 'pulled'

/** 镜像就绪结果。 */
export interface EnsureImageResult {
  /** 镜像引用。 */
  image: string
  /** 命中档位。 */
  tier: ImageTier
  /** 耗时（毫秒）。 */
  durationMs: number
}

/** 一条子进程结果。 */
interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * 运行子进程并收集输出。
 * @param bin - 可执行文件。
 * @param args - 参数。
 * @param timeoutMs - 超时。
 * @returns 退出码与输出。
 */
async function run(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new DistributionError(`${bin} ${args[0] ?? ''} timed out after ${String(timeoutMs)}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); reject(new DistributionError(String(error))) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** 镜像缓存统计（命中率验收口径）。 */
export interface ImageCacheStats {
  /** 本地命中次数。 */
  hits: number
  /** 按需拉取次数。 */
  pulls: number
  /** 命中率（0~1；无请求时为 0）。 */
  hitRate: number
}

/** 节点镜像缓存（本地命中优先，缺失时按需拉取）。 */
export class ImageCache {
  private readonly docker: string
  private readonly allowPull: boolean
  private readonly pullTimeoutMs: number
  private hits = 0
  private pulls = 0

  /**
   * @param options.docker - Docker 可执行文件。
   * @param options.allowPull - 是否允许按需拉取（默认允许；离线节点可关）。
   * @param options.pullTimeoutMs - 拉取超时（默认 10 分钟）。
   */
  constructor(options: { docker?: string; allowPull?: boolean; pullTimeoutMs?: number } = {}) {
    this.docker = options.docker ?? 'docker'
    this.allowPull = options.allowPull ?? true
    this.pullTimeoutMs = options.pullTimeoutMs ?? 10 * 60 * 1000
  }

  /**
   * 确保镜像在本地可用。
   * @param image - 镜像引用。
   * @returns 命中档位与耗时。
   */
  async ensure(image: string): Promise<EnsureImageResult> {
    const startedAt = Date.now()
    const local = await run(this.docker, ['image', 'inspect', image], 10_000)
    if (local.code === 0) {
      this.hits += 1
      return { image, tier: 'local', durationMs: Date.now() - startedAt }
    }
    if (!this.allowPull) throw new DistributionError(`image ${image} is not cached and pulling is disabled`, local.stderr)
    const pulled = await run(this.docker, ['pull', image], this.pullTimeoutMs)
    if (pulled.code !== 0) throw new DistributionError(`docker pull ${image} failed`, pulled.stderr)
    this.pulls += 1
    return { image, tier: 'pulled', durationMs: Date.now() - startedAt }
  }

  /**
   * 批量预热一组镜像（高访问密度档：有界并发）。
   *
   * 并发上限是调用方策略：节点启动/扩容时全量并行预热用较高并发，按需批量预取用较低并发。
   * 失败即抛（带出具体镜像），不静默跳过——缺镜像的会话会在创建容器时同样失败。
   * @param images - 镜像引用列表。
   * @param options.concurrency - 并发上限（默认 4）。
   * @returns 每个镜像的命中结果（与输入同序）。
   */
  async prefetch(images: readonly string[], options: { concurrency?: number } = {}): Promise<EnsureImageResult[]> {
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4))
    const results: EnsureImageResult[] = new Array<EnsureImageResult>(images.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, images.length) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        const image = images[index]
        if (image === undefined) return
        results[index] = await this.ensure(image)
      }
    })
    await Promise.all(workers)
    return results
  }

  /**
   * 当前缓存统计（本地命中 / 拉取 / 命中率）。
   * @returns 命中数、拉取数与命中率。
   */
  stats(): ImageCacheStats {
    const total = this.hits + this.pulls
    return { hits: this.hits, pulls: this.pulls, hitRate: total === 0 ? 0 : this.hits / total }
  }
}

/** 写入结果。 */
export interface PutResult {
  /** 内容摘要（sha256 hex）。 */
  digest: string
  /** 字节数。 */
  size: number
  /** 本地是否已有同内容对象（去重命中）。 */
  deduped: boolean
}

/** 读取结果。 */
export interface GetResult {
  /** 是否本地命中（false 表示从远端下载并回填）。 */
  cached: boolean
}

/** 缓存统计。 */
export interface StoreStats {
  /** 本地命中次数。 */
  hits: number
  /** 远端下载次数。 */
  misses: number
  /** 命中率（0~1；无读取时为 0）。 */
  hitRate: number
}

/** 内容寻址工作区对象存储（本地副本 + 远端权威）。 */
export class WorkspaceStore {
  private readonly root: string
  private readonly remote: ObjectStore | undefined
  private hits = 0
  private misses = 0

  /**
   * @param options.root - 本地缓存根目录（其下 `blobs/` 存对象）。
   * @param options.remote - 权威对象存储（省略时纯本地）。
   */
  constructor(options: { root: string; remote?: ObjectStore }) {
    this.root = options.root
    this.remote = options.remote
  }

  /**
   * 写入一份工作区对象（同时写本地与远端权威）。
   * @param sourcePath - 源文件。
   * @returns 摘要、大小与去重标记。
   */
  async put(sourcePath: string): Promise<PutResult> {
    const bytes = await readFile(sourcePath)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const blob = join(this.root, 'blobs', digest)
    await mkdir(join(this.root, 'blobs'), { recursive: true })
    let deduped = true
    try {
      await stat(blob)
    } catch {
      deduped = false
      await writeFile(blob, bytes)
    }
    await this.remote?.put(digest, blob)
    return { digest, size: bytes.byteLength, deduped }
  }

  /**
   * 读取一份对象到目标路径（本地命中优先，未命中从远端下载并回填）。
   * @param digest - 内容摘要。
   * @param destination - 目标路径。
   * @returns 是否本地命中。
   */
  async get(digest: string, destination: string): Promise<GetResult> {
    const blob = join(this.root, 'blobs', digest)
    try {
      await stat(blob)
      await copyFile(blob, destination)
      this.hits += 1
      return { cached: true }
    } catch {
      if (this.remote === undefined) throw new DistributionError(`object ${digest} is not cached and no remote store is configured`)
      await this.remote.get(digest, destination)
      await mkdir(join(this.root, 'blobs'), { recursive: true })
      await copyFile(destination, blob)
      this.misses += 1
      return { cached: false }
    }
  }

  /**
   * 当前缓存统计。
   * @returns 命中数、缺失数与命中率。
   */
  stats(): StoreStats {
    const total = this.hits + this.misses
    return { hits: this.hits, misses: this.misses, hitRate: total === 0 ? 0 : this.hits / total }
  }
}

/**
 * 文件系统落地的内容寻址权威存储（单机/共享卷形态的对象存储实现）。
 *
 * 对象按摘要命名（`objects/<sha256>`），`put` 幂等：同内容重复写入直接命中；
 * `get` 在对象缺失时显式报错，不做静默空文件。云端可换成 S3/OSS 等实现，
 * 消费方只依赖 {@link ObjectStore} 三个方法。
 */
export class FilesystemObjectStore implements ObjectStore {
  private readonly root: string

  /**
   * @param root - 权威存储根目录（其下 `objects/` 存对象）。
   */
  constructor(root: string) {
    this.root = root
  }

  private pathOf(digest: string): string {
    return join(this.root, 'objects', digest)
  }

  async has(digest: string): Promise<boolean> {
    try {
      await stat(this.pathOf(digest))
      return true
    } catch (_objectAbsent) {
      return false
    }
  }

  async get(digest: string, destination: string): Promise<void> {
    const source = this.pathOf(digest)
    try {
      await stat(source)
    } catch (_objectAbsent) {
      throw new DistributionError(`object ${digest} is not in the authoritative store (${this.root})`)
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  async put(digest: string, source: string): Promise<void> {
    const destination = this.pathOf(digest)
    await mkdir(dirname(destination), { recursive: true })
    try {
      await stat(destination)
      return
    } catch (_objectAbsent) {
      // 首次写入：内容寻址保证同摘要同内容。
    }
    await copyFile(source, destination)
  }
}
