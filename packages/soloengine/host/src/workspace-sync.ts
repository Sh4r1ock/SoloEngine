/**
 * 会话工作区同步（W10.12）：本地工作副本 + 对象存储权威副本。
 *
 * - **写入顺序**：会话工作区始终先落本地（工具直接写盘），`save` 在持久化屏障
 *   （`session/flush`）与销毁时把文件按内容寻址提交到对象存储，并整份更新清单；
 * - **恢复顺序**：新节点/本地副本丢失时，按清单只补**缺失**文件——本地已有的文件
 *   保留（本地写入更新，尚未提交的内容不会被远端旧副本覆盖）。
 *
 * 清单与对象键都在控制面共享库里，因此跨节点接管后能对账恢复；对象存储实现可替换
 * （单机/共享卷用 {@link FilesystemObjectStore}，云端换 S3/OSS），本模块只依赖
 * `WorkspaceStore` 与两个清单读写回调。
 *
 * @module @soloengine/host/workspace-sync
 */

import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { WorkspaceFileEntry } from '@soloengine/cloud-control'
import type { WorkspaceStore } from '@soloengine/image-distribution'

/** 同步器依赖。 */
export interface WorkspaceSyncOptions {
  /** 内容寻址对象存储（本地副本 + 远端权威）。 */
  store: WorkspaceStore
  /** 保存清单（控制面共享库）。 */
  saveManifest: (sessionKey: string, files: readonly WorkspaceFileEntry[]) => Promise<void>
  /** 读取清单（控制面共享库）。 */
  loadManifest: (sessionKey: string) => Promise<WorkspaceFileEntry[]>
  /** 诊断输出。 */
  log: (message: string) => void
}

/** 一次提交的结果。 */
export interface WorkspaceSaveResult {
  /** 提交的文件数。 */
  files: number
  /** 本次新增到本地对象缓存的文件数（去重命中不计）。 */
  added: number
}

/** 一次恢复的结果。 */
export interface WorkspaceRestoreResult {
  /** 清单条目总数。 */
  listed: number
  /** 本次补回的文件数（本地已存在的不计）。 */
  restored: number
}

/**
 * 递归列出工作区内的普通文件（不跟随符号链接：链接可能指向工作区之外）。
 * @param root - 工作区根（绝对路径）。
 * @returns 相对 POSIX 路径（排序后稳定）。
 */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      found.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  await walk(root)
  return found.sort()
}

/** 工作区同步器（一个节点一份）。 */
export class WorkspaceSync {
  private readonly inFlight = new Map<string, Promise<WorkspaceSaveResult>>()

  /**
   * @param options - 对象存储与清单读写。
   */
  constructor(private readonly options: WorkspaceSyncOptions) {}

  /**
   * 合并连续提交：同一会话已有提交在跑时复用那一次，避免每个持久化屏障都重扫工作区。
   *
   * 最终状态由销毁时的 {@link save} 保证；这里只做随回合推进的异步提交。
   * @param sessionKey - 根会话键。
   * @param workspaceDir - 本地工作区目录。
   */
  async saveSoon(sessionKey: string, workspaceDir: string): Promise<void> {
    const running = this.inFlight.get(sessionKey)
    if (running !== undefined) {
      await running
      return
    }
    const run = this.save(sessionKey, workspaceDir)
      .finally(() => { this.inFlight.delete(sessionKey) })
    this.inFlight.set(sessionKey, run)
    await run
  }

  /**
   * 提交整份工作区：逐文件写入内容寻址对象存储，然后整份覆盖清单。
   * @param sessionKey - 根会话键。
   * @param workspaceDir - 本地工作区目录。
   * @returns 提交统计。
   */
  async save(sessionKey: string, workspaceDir: string): Promise<WorkspaceSaveResult> {
    const files: WorkspaceFileEntry[] = []
    let added = 0
    for (const path of await listFiles(workspaceDir)) {
      const absolute = join(workspaceDir, ...path.split('/'))
      const put = await this.options.store.put(absolute)
      if (!put.deduped) added += 1
      files.push({ path, digest: put.digest, size: put.size })
    }
    await this.options.saveManifest(sessionKey, files)
    return { files: files.length, added }
  }

  /**
   * 按权威清单补回本地缺失的文件（本地已有的一律保留）。
   *
   * @param sessionKey - 根会话键。
   * @param workspaceDir - 本地工作区目录（不存在时创建）。
   * @returns 恢复统计。
   */
  async restore(sessionKey: string, workspaceDir: string): Promise<WorkspaceRestoreResult> {
    const manifest = await this.options.loadManifest(sessionKey)
    const root = resolve(workspaceDir)
    await mkdir(root, { recursive: true })
    let restored = 0
    for (const entry of manifest) {
      const destination = resolve(root, ...entry.path.split('/'))
      // 清单来自共享库（跨节点），路径必须落在工作区根内；越界条目直接报错，不静默跳过。
      if (destination !== root && !destination.startsWith(root + sep)) {
        throw new Error(`workspace manifest for session ${sessionKey} contains an out-of-root path: ${entry.path}`)
      }
      try {
        const info = await stat(destination)
        if (info.isFile()) continue
      } catch (_missingLocally) {
        // 本地没有这份文件：从对象存储补回。
      }
      await this.options.store.get(entry.digest, destination)
      restored += 1
    }
    if (restored > 0) {
      this.options.log(`soloengine: restored ${String(restored)} workspace file(s) for session ${sessionKey} from object storage`)
    }
    return { listed: manifest.length, restored }
  }
}
