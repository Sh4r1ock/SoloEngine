/**
 * 技能域（PRD-04 FR-SKILL-001~009）。
 *
 * - 元数据存 `skills_packages` 表；正文（SKILL.md/资源）在用户技能目录（文件系统）；
 * - 两阶段导入（解析元数据 → 确认落盘），含 zip 解包防路径穿越（含 `../`/绝对路径/
 *   符号链接目标越界一律整包拒绝并报出具体条目）；
 * - 启停热生效：启用中的技能以 junction 同步进运行项目的项目层技能根
 *   （`<project>/.dsh/skills`，即 per-user SkillProvider 的发现根），junction 的增删由
 *   dsh skill-filesystem 的目录观察转为失效事件——模型下一步即见/不见；
 *   停用即移除 junction（项目里的真实目录与 junction 一律不误删）；
 * - 目录安全经 UserDirectoryService.within 保证（三层隔离第 2 层）。
 *
 * @module @soloengine/framework/modules/skills
 */

import { createHash } from 'node:crypto'
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path, { dirname, join, resolve } from 'node:path'
import type { BusinessDatabase } from '../db/port.ts'
import { isUniqueViolation } from '../db/port.ts'
import yaml from 'js-yaml'
import { zipSync, unzipSync, strFromU8 } from 'fflate'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { looksTextual } from '../util/text.ts'
import { FrameworkError } from './accounts.ts'

/** skills_packages 行。 */
export interface SkillPackageRow {
  id: string
  user_id: string | null
  name: string
  pkg_version: string
  description: string | null
  icon: string | null
  author: string
  tags: string | null
  folder_path: string | null
  is_active: number
  is_public: number
  source: string | null
  /** 文件备注（JSON map：path → note；PRD-04 FR-SKILL-006，不改包）。 */
  notes: string | null
  created_at: string | null
  updated_at: string | null
  version: number
}

/** 对外视图。 */
export interface SkillPackageView extends Omit<SkillPackageRow, 'user_id' | 'is_active' | 'is_public' | 'tags'> {
  user_id: string | null
  is_active: boolean
  is_public: boolean
  /** 标签数组：库列是 JSON 数组文本（旧数据可能是逗号串），视图统一解析后返回。 */
  tags: string[]
  /** 包内文件数（技能列表行展示；目录缺失时为 0）。 */
  file_count: number
}

/**
 * 解析技能标签列。
 * @param raw - `skills_packages.tags` 原文（JSON 数组文本；旧数据为逗号串）。
 * @returns 标签数组（非法/空值返回空数组）。
 */
function parseSkillTags(raw: string | null): string[] {
  if (raw === null || raw.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    // 旧数据是逗号分隔文本，落到下面的兼容分支。
  }
  return raw.split(',').map(item => item.trim()).filter(item => item !== '')
}

/**
 * 解析创建对话框提交的标签串（英文/中文逗号分隔）。
 * @param raw - 请求里的标签值（未校验的 JSON）。
 * @returns 去空、去重保序的标签数组；空输入记 `untagged`。
 */
function parseCreateTags(raw: unknown): string[] {
  const text = raw === undefined || raw === null ? '' : String(raw)
  const tags: string[] = []
  for (const item of text.split(/[,，]/u)) {
    const tag = item.trim()
    if (tag === '' || tags.includes(tag)) continue
    tags.push(tag)
  }
  return tags.length === 0 ? ['untagged'] : tags
}

/** 技能元数据（SKILL.md frontmatter）。 */
export interface SkillMetadata {
  name: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  icon?: string
  [`model-invocable`]?: boolean
  [`user-invocable`]?: boolean
}

/** 单条包内文件（相对路径 + 字节数 + 文本或字节）。 */
export interface SkillFileEntry {
  path: string
  /** 文件字节数（预览与文件树展示用；与落盘内容同源）。 */
  size: number
  text?: string
  bytes?: Uint8Array
}

/** 导入预览里的一个文件条目（相对路径 + 字节数）。 */
export interface SkillPreviewFile {
  path: string
  /** 文件字节数。 */
  size: number
}

/** 导入第一阶段结果：元数据 + 目录树预览。 */
export interface SkillImportPreview {
  name: string
  version: string
  description: string | null
  author: string
  files: SkillPreviewFile[]
  skippedRejected: string[]
  /** 预览内容的指纹：确认阶段必须回传，源在预览后被改动即拒绝导入。 */
  fingerprint: string
}

/** zip 条目。 */
interface ZipEntry {
  name: string
  data: Uint8Array
}

/**
 * 读文件头部若干字节（只用于文本/二进制判定，不整份载入）。
 * @param file - 文件绝对路径。
 * @param bytes - 期望读取的字节数。
 * @returns 实际读到的字节。
 */
function readHead(file: string, bytes: number): Uint8Array {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/**
 * 原子落盘一个技能目录：先写同级临时目录，再用 `rename` 抢占目标名。
 *
 * 目录创建与内容写入不是事务：直接往目标目录写，登记失败后的清理会删掉并发赢家刚写好的
 * 内容。`rename` 在目标已存在时失败，因此同一技能名的并发导入只有一个赢家。
 * @param targetRoot - 目标技能目录。
 * @param write - 在临时目录内写内容。
 */
function writeSkillDirectory(targetRoot: string, write: (staging: string) => void): void {
  const staging = `${targetRoot}.staging-${newId()}`
  mkdirSync(staging, { recursive: true })
  try {
    write(staging)
    renameSync(staging, targetRoot)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (existsSync(targetRoot)) {
      throw new FrameworkError(409, 'SKILL_EXISTS', `skill directory ${targetRoot} was claimed by a concurrent request`)
    }
    throw error
  }
}

/** 技能域服务。 */
export class SkillService {
  private readonly db: BusinessDatabase
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.db = runtime.db
    this.runtime = runtime
  }

  /** 用户技能根目录（在用户目录隔离区内）。 */
  private rootOf(username: string): string {
    this.runtime.userDirs.ensure(username)
    return this.runtime.userDirs.sub(username, 'skills')
  }

  /** 行 → 视图。 */
  view(row: SkillPackageRow): SkillPackageView {
    const { user_id, is_active, is_public, tags, ...rest } = row
    return {
      ...rest,
      user_id,
      is_active: is_active === 1,
      is_public: is_public === 1,
      tags: parseSkillTags(tags),
      file_count: row.folder_path !== null && existsSync(row.folder_path)
        ? walkDirectory(resolve(row.folder_path)).length
        : 0,
    }
  }

  /** 列某用户技能（含系统技能与其他用户的公共技能）。 */
  async list(userId: string): Promise<SkillPackageRow[]> {
    return await this.db.prepare(
      `SELECT * FROM skills_packages
        WHERE user_id = ? OR user_id IS NULL OR is_public = 1
        ORDER BY created_at ASC`,
    ).all<SkillPackageRow>(userId)
  }

  /**
   * 列某用户**可挂载**的技能：本人的与系统级的。
   *
   * 判据与 `syncProjectSkills` 的项目层 junction 农场一致：其他用户在管理面标记为公共的技能
   * 可以查看，但不会被链接进运行项目，故编译翻译、运行提示、打包契约都必须按这条判据判定，
   * 不能拿 `list()` 的可读集合冒充可用集合（否则运行期挂不上且诊断沉默）。
   * @param userId - 归属用户。
   * @returns 可挂载的技能行。
   */
  async listMountable(userId: string): Promise<SkillPackageRow[]> {
    return await this.db.prepare(
      `SELECT * FROM skills_packages
        WHERE user_id = ? OR user_id IS NULL
        ORDER BY created_at ASC`,
    ).all<SkillPackageRow>(userId)
  }

  /**
   * 出厂技能播种（W11.4 / PRD-04 §2）：把 `data/market/skills` 的资产幂等登记为系统技能。
   *
   * 规则：
   * - 系统行 `user_id = NULL`、`is_active = 1`、`source = 'factory'`；目录落 `data/skills/<name>`；
   * - 已存在的系统行不自动重启（用户停用后保持停用）；
   * - 仅当已安装目录仍是 factory 版本（SKILL.md 的 version 未变）时才随资产升级覆盖；
   * - 坏资产（缺 SKILL.md / frontmatter 非法）跳过并打印一行，不阻断启动；
   * - 播种后把启用中的出厂技能同步进已有运行项目的项目层 junction。
   * @returns 新登记与升级的条数。
   */
  async seedSystemSkills(): Promise<{ created: number; upgraded: number; skipped: number }> {
    const sourceRoot = join(this.runtime.dataDir, 'market', 'skills')
    if (!existsSync(sourceRoot)) return { created: 0, upgraded: 0, skipped: 0 }
    const targetRoot = join(this.runtime.dataDir, 'skills')
    mkdirSync(targetRoot, { recursive: true })
    let created = 0
    let upgraded = 0
    let skipped = 0
    for (const entry of readdirSync(sourceRoot)) {
      const source = join(sourceRoot, entry)
      if (!statSync(source).isDirectory()) continue
      const sourceSkill = join(source, 'SKILL.md')
      if (!existsSync(sourceSkill)) {
        skipped += 1
        console.log(`soloengine: factory skill "${entry}" has no SKILL.md; skipped`)
        continue
      }
      let meta: SkillMetadata
      try {
        meta = this.parseMetadata(readFileSync(sourceSkill, 'utf8'), entry)
      } catch (error) {
        skipped += 1
        console.log(`soloengine: factory skill "${entry}" has invalid metadata; skipped (${String(error)})`)
        continue
      }
      const installedRoot = join(targetRoot, meta.name)
      const version = meta.version ?? '1.0.0'
      const existing = await this.db.prepare(
        'SELECT * FROM skills_packages WHERE user_id IS NULL AND name = ?',
      ).get<SkillPackageRow>(meta.name)
      if (existing !== undefined) {
        if (existing.source !== 'factory' || existing.is_active !== 1) continue
        const installedSkill = join(installedRoot, 'SKILL.md')
        let installedVersion = existing.pkg_version
        if (existsSync(installedSkill)) {
          try {
            installedVersion = this.parseMetadata(readFileSync(installedSkill, 'utf8'), meta.name).version ?? '1.0.0'
          } catch {
            continue
          }
        }
        // 目录版本与登记版本不一致 = 用户改过，保持原样；资产版本与登记一致 = 已是最新。
        if (installedVersion !== existing.pkg_version || version === existing.pkg_version) continue
        cpSync(source, installedRoot, { recursive: true, force: true })
        await this.db.prepare(
          `UPDATE skills_packages
             SET pkg_version = ?, description = ?, icon = ?, tags = ?, folder_path = ?,
                 updated_at = ?, version = version + 1
           WHERE id = ?`,
        ).run(
          version,
          meta.description ?? '',
          meta.icon ?? null,
          meta.tags === undefined ? null : JSON.stringify(meta.tags),
          installedRoot,
          new Date().toISOString(),
          existing.id,
        )
        upgraded += 1
        console.log(`soloengine: factory skill "${meta.name}" upgraded to ${version}`)
        continue
      }
      cpSync(source, installedRoot, { recursive: true, force: true })
      const now = new Date().toISOString()
      await this.db.prepare(
        `INSERT INTO skills_packages
          (id, user_id, name, pkg_version, description, icon, author, tags, folder_path,
           is_active, is_public, source, created_at, updated_at, version)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'factory', ?, ?, 1)`,
      ).run(
        newId(),
        meta.name,
        version,
        meta.description ?? '',
        meta.icon ?? null,
        meta.author ?? 'soloengine',
        meta.tags === undefined ? null : JSON.stringify(meta.tags),
        installedRoot,
        now,
        now,
      )
      created += 1
      console.log(`soloengine: factory skill "${meta.name}" registered at ${installedRoot}`)
    }
    const projects = await this.db.prepare(
      'SELECT user_id, folder_path FROM run_projects WHERE is_active = 1',
    ).all<{ user_id: string; folder_path: string }>()
    for (const project of projects) {
      try {
        await this.syncProjectSkills(project.user_id, project.folder_path)
      } catch (error) {
        console.log(`soloengine: syncing factory skills into project ${project.folder_path} failed: ${String(error)}`)
      }
    }
    return { created, upgraded, skipped }
  }

  /** 按 ID 取（归属或公共）。 */
  async byIdScoped(userId: string, id: string): Promise<SkillPackageRow | undefined> {
    return await this.db.prepare(
      'SELECT * FROM skills_packages WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
    ).get<SkillPackageRow>(id, userId)
  }

  /**
   * 按 ID 取可读行：自己的、系统级的、或其他用户标记为公共的。
   * @param userId - 当前用户。
   * @param id - 技能 ID。
   * @returns 行或 undefined。
   */
  private async byIdVisible(userId: string, id: string): Promise<SkillPackageRow | undefined> {
    return await this.db.prepare(
      'SELECT * FROM skills_packages WHERE id = ? AND (user_id = ? OR user_id IS NULL OR is_public = 1)',
    ).get<SkillPackageRow>(id, userId)
  }

  /**
   * 取一行并校验「可改写」：自己的技能；系统技能仅超管；其他用户的公共技能只读。
   * @param userId - 当前用户。
   * @param id - 技能 ID。
   * @param isSuperuser - 当前用户是否超管。
   * @returns 可改写的行。
   */
  private async mutableRow(userId: string, id: string, isSuperuser: boolean): Promise<SkillPackageRow> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.user_id === null && !isSuperuser) {
      throw new FrameworkError(403, 'SKILL_SYSTEM_READONLY', `skill ${id} is a system skill; only a superuser can modify it`)
    }
    return row
  }

  /**
   * 解析 SKILL.md 元数据（frontmatter）。
   * @param text - SKILL.md 全文。
   * @param fallbackName - 无前页时的兜底目录名。
   */
  parseMetadata(text: string, fallbackName: string): SkillMetadata {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (match === null) {
      return { name: fallbackName }
    }
    let doc: unknown
    try {
      doc = yaml.load(match[1] as string)
    } catch (error) {
      throw new FrameworkError(400, 'INVALID_SKILL_FRONTMATTER', `SKILL.md frontmatter is invalid YAML: ${String(error)}`)
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new FrameworkError(400, 'INVALID_SKILL_FRONTMATTER', 'SKILL.md frontmatter must be a YAML object')
    }
    const fields = doc as Record<string, unknown>
    const name = typeof fields.name === 'string' ? fields.name.trim() : ''
    if (name === '') throw new FrameworkError(400, 'MISSING_SKILL_NAME', 'SKILL.md frontmatter must declare a non-empty name')
    const meta: SkillMetadata = { name: assertSkillName(name) }
    if (typeof fields.description === 'string') meta.description = fields.description
    if (typeof fields.version === 'string') meta.version = fields.version
    if (typeof fields.author === 'string') meta.author = fields.author
    if (Array.isArray(fields.tags)) meta.tags = fields.tags.filter((item): item is string => typeof item === 'string')
    if (typeof fields.icon === 'string') meta.icon = fields.icon
    if (typeof fields[`model-invocable`] === 'boolean') meta[`model-invocable`] = fields[`model-invocable`]
    if (typeof fields[`user-invocable`] === 'boolean') meta[`user-invocable`] = fields[`user-invocable`]
    return meta
  }

  /**
   * 空字节序列（处理二进制文件的遍历）。
   * @param bytes - 原始字节。
   */
  private static bytesToEntries(bytes: Uint8Array): ZipEntry[] {
    const map = unzipSync(bytes)
    const entries = Object.entries(map).map(([name, data]) => ({ name, data }))
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new FrameworkError(400, 'ARCHIVE_TOO_LARGE', `archive has ${String(entries.length)} entries; the limit is ${String(MAX_ARCHIVE_ENTRIES)}`)
    }
    let total = 0
    for (const entry of entries) {
      if (entry.data.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new FrameworkError(400, 'ARCHIVE_TOO_LARGE', `archive entry ${entry.name} exceeds ${String(MAX_ARCHIVE_ENTRY_BYTES)} bytes`)
      }
      total += entry.data.byteLength
      if (total > MAX_ARCHIVE_BYTES) {
        throw new FrameworkError(400, 'ARCHIVE_TOO_LARGE', `archive expands beyond ${String(MAX_ARCHIVE_BYTES)} bytes`)
      }
    }
    return entries
  }

  /**
   * 展开 zip 条目为包文件清单（先收集，越界判定在安全目录内进行）。
   * @param entries - zip 条目。
   * @returns 包文件条目（相对路径）与被跳过的宿主垃圾条目。
   */
  private expandEntries(entries: readonly ZipEntry[]): { files: SkillFileEntry[]; skipped: string[] } {
    const files: SkillFileEntry[] = []
    const skipped: string[] = []
    for (const entry of entries) {
      const rawName = entry.name.replace(/\\/g, '/')
      if (rawName.endsWith('/')) continue
      // 打包工具附带的宿主元数据不导入，但要在预览里点名（不静默丢弃）。
      if (isArchiveJunk(rawName)) {
        skipped.push(rawName)
        continue
      }
      const textual = looksTextual(entry.data)
      const file: SkillFileEntry = { path: rawName, size: entry.data.byteLength }
      if (textual) file.text = strFromU8(entry.data)
      else file.bytes = entry.data
      files.push(file)
    }
    return { files, skipped }
  }

  /**
   * 在目标技能目录内规范化并校验路径（防穿越：../、绝对路径一律拒绝）。
   * @param targetRoot - 技能包根目录绝对路径。
   * @param relative - zip 内相对路径。
   * @returns 安全绝对路径。
   */
  private safeJoin(targetRoot: string, relative: string): string {
    if (relative === '' || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} is an absolute path and is rejected`)
    }
    const parts = relative.split('/')
    if (parts.includes('..')) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} contains .. and is rejected`)
    }
    // Windows 备用数据流（`file:stream`）与盘符相对路径（`C:evil`）都不是包内普通文件。
    if (parts.some(part => part.includes(':'))) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} names a drive or stream and is rejected`)
    }
    const resolved = normalize(resolve(targetRoot, relative))
    const prefix = targetRoot.endsWith(path.sep) ? targetRoot : `${targetRoot}${path.sep}`
    if (resolved !== targetRoot && !resolved.startsWith(prefix)) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} escapes the skill directory and is rejected`)
    }
    // 词法归一挡不住指向根外的符号链接：目标已存在时按真实路径复核一次。
    if (existsSync(resolved)) {
      const realRoot = realpathSync(targetRoot)
      const realTarget = realpathSync(resolved)
      const realPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`
      if (realTarget !== realRoot && !realTarget.startsWith(realPrefix)) {
        throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} resolves outside the skill directory and is rejected`)
      }
    }
    return resolved
  }

  /**
   * 两阶段导入：第一阶段解析 zip 或目录得到预览。
   * @param userId - 归属用户。
   * @param username - 登录名（决定用户技能目录）。
   * @param archiveBytes - zip 字节（或 null 走目录）。
   * @param sourcePath - 源目录绝对路径（archiveBytes 为 null 时用）。
   * @returns 预览（名称/版本/描述/作者/文件清单）。
   */
  previewImport(username: string, archiveBytes: Uint8Array | null, sourcePath?: string): SkillImportPreview {
    return this.previewFromEntries(this.collectEntries(username, archiveBytes, sourcePath), username)
  }

  /**
   * 收集导入源的全部条目（zip 字节或目录），带条目数/单文件/总量上限。
   * @param username - 登录名（目录源在用户技能根内解析）。
   * @param archiveBytes - zip 字节；`null` 表示目录源。
   * @param sourcePath - 目录源（相对用户技能根）。
   * @returns zip 条目（不做路径改写）。
   */
  private collectEntries(username: string, archiveBytes: Uint8Array | null, sourcePath?: string): ZipEntry[] {
    if (archiveBytes !== null) return SkillService.bytesToEntries(archiveBytes)
    if (sourcePath === undefined) throw new FrameworkError(400, 'SOURCE_REQUIRED', 'either archive or source path is required')
    this.rootOf(username)
    let safeSource: string
    try {
      safeSource = this.runtime.userDirs.within(username, 'skills', sourcePath)
    } catch {
      // 越界来源是用户输入错误（`within` 抛的是带内部绝对路径的普通 Error）：
      // 转成可处置的 400，避免 500 把 data/home/users/<name>/skills 原样回给浏览器。
      throw new FrameworkError(400, 'SKILL_SOURCE_OUTSIDE', 'skill source must be inside your skill directory; use a path relative to it or import a .zip')
    }
    let isDirectory = false
    try {
      isDirectory = existsSync(safeSource) && statSync(safeSource).isDirectory()
    } catch {
      isDirectory = false
    }
    if (!isDirectory) {
      throw new FrameworkError(400, 'SKILL_SOURCE_NOT_FOUND', 'skill source directory does not exist; check the path relative to your skill directory')
    }
    const real = resolve(safeSource)
    const files = walkDirectory(real)
    if (files.length > MAX_ARCHIVE_ENTRIES) {
      throw new FrameworkError(400, 'ARCHIVE_TOO_LARGE', `directory has ${String(files.length)} files; the limit is ${String(MAX_ARCHIVE_ENTRIES)}`)
    }
    let total = 0
    return files.map(p => {
      const data = readFileSync(p)
      total += data.byteLength
      if (data.byteLength > MAX_ARCHIVE_ENTRY_BYTES || total > MAX_ARCHIVE_BYTES) {
        throw new FrameworkError(400, 'ARCHIVE_TOO_LARGE', `directory expands beyond the import limits at ${p}`)
      }
      return { name: path.relative(real, p).replace(/\\/g, '/'), data }
    })
  }

  /**
   * 由条目生成预览（含内容指纹）。
   * @param entries - 导入源条目。
   * @param username - 登录名（作者回退）。
   * @returns 预览。
   */
  private previewFromEntries(entries: readonly ZipEntry[], username: string): SkillImportPreview {
    const { files, skipped } = this.expandEntries(entries)
    // 防穿越在**第一阶段**即整包拒绝并报出具体条目（不部分导入）。
    const rejected: string[] = []
    for (const file of files) {
      try {
        this.safeJoin(resolve('/soloengine-skill-probe'), file.path)
      } catch (error) {
        rejected.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (rejected.length > 0) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `import rejected: ${rejected.length} entry(ies) escape the skill directory — ${rejected.slice(0, 5).join('; ')}`)
    }
    const skillMd = files.find(file => path.basename(file.path).toLowerCase() === 'skill.md')
    const rootName = guessRootName(files)
    const meta = skillMd?.text !== undefined ? this.parseMetadata(skillMd.text, rootName) : { name: rootName }
    return {
      name: assertSkillName(meta.name),
      version: meta.version ?? '1.0.0',
      description: meta.description ?? null,
      author: meta.author ?? username,
      files: files
        .map(file => ({ path: file.path, size: file.size }))
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
      skippedRejected: skipped.sort(),
      fingerprint: fingerprintOf(entries),
    }
  }

  /**
   * 两阶段导入：第二阶段确认后落盘并登记。
   * @param userId - 归属用户。
   * @param username - 登录名。
   * @param archiveBytes - zip 字节（或 null 走目录）。
   * @param sourcePath - 源目录（可选）。
   * @param expectedFingerprint - 第一阶段预览指纹；提供时必须与当前源一致（源在预览后被改动即 409）。
   * @returns 技能包视图。
   */
  async importConfirmed(
    userId: string,
    username: string,
    archiveBytes: Uint8Array | null,
    sourcePath?: string,
    expectedFingerprint?: string,
  ): Promise<SkillPackageView> {
    const entries = this.collectEntries(username, archiveBytes, sourcePath)
    if (expectedFingerprint !== undefined && fingerprintOf(entries) !== expectedFingerprint) {
      throw new FrameworkError(409, 'IMPORT_PREVIEW_STALE',
        'the imported source changed after its preview; run the preview again before confirming')
    }
    const welcome = this.previewFromEntries(entries, username)
    const name = assertSkillName(welcome.name)
    const targetRoot = join(this.rootOf(username), name)
    if (existsSync(targetRoot)) {
      // 目录存在但没有任何数据行引用它：上一次导入在「建目录」与「登记」之间中断留下的残留。
      // 它与「同名技能已存在」是两种状态，必须分开报，否则用户只会看到「已安装」而无从处置。
      const owner = await this.db.prepare(
        'SELECT id FROM skills_packages WHERE user_id = ? AND name = ?',
      ).get<{ id: string }>(userId, name)
      if (owner === undefined) {
        throw new FrameworkError(409, 'SKILL_DIRECTORY_ORPHANED',
          `skill directory ${targetRoot} has no skill record; it is left over from an interrupted import and blocks installing ${name}`)
      }
      throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${name} already exists for user`)
    }
    writeSkillDirectory(targetRoot, (staging) => {
      for (const entry of entries) {
        const rawName = entry.name.replace(/\\/g, '/')
        if (rawName.endsWith('/')) continue
        // 与预览同一口径：宿主元数据不落盘（否则预览说跳过、实际却写进去了）。
        if (isArchiveJunk(rawName)) continue
        const text = looksTextual(entry.data) ? strFromU8(entry.data) : undefined
        const safePath = this.safeJoin(staging, rawName)
        mkdirSync(dirname(safePath), { recursive: true })
        if (text !== undefined) writeFileSync(safePath, text, 'utf8')
        else writeFileSync(safePath, entry.data)
      }
    })

    try {
      const now = new Date().toISOString()
      const id = newId()
      await this.db.prepare(
        `INSERT INTO skills_packages
          (id, user_id, name, pkg_version, description, icon, author, tags, folder_path,
           is_active, is_public, source, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'import', ?, ?, 1)`,
      ).run(id, userId, name, welcome.version, welcome.description, null, welcome.author, null,
        targetRoot, now, now)
      return this.view(await this.byIdScoped(userId, id) as SkillPackageRow)
    } catch (error) {
      // 目录由本次调用原子抢占，登记失败时删掉它不会误伤并发赢家。
      rmSync(targetRoot, { recursive: true, force: true })
      if (isUniqueViolation(error)) {
        throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${name} already exists for user`)
      }
      throw error
    }
  }

  /**
   * 创建技能包骨架（SKILL.md + 标准目录 references/ 与 scripts/）。
   *
   * 默认值来自技能页的创建对话框：版本 0.1.0、描述回落到技能名、标签在空串时记 `untagged`。
   * @param userId - 归属用户。
   * @param username - 登录名（作者与技能目录分配键）。
   * @param name - 技能包名（同时是目录名）。
   * @param options - 可选的版本、描述与逗号分隔标签。
   * @returns 技能包视图。
   */
  async create(
    userId: string,
    username: string,
    name: string,
    options: { version?: unknown; description?: unknown; tags?: unknown } = {},
  ): Promise<SkillPackageView> {
    const clean = assertSkillName(String(name ?? ''))
    const ver = options.version === undefined || options.version === null || String(options.version).trim() === ''
      ? '0.1.0'
      : String(options.version).trim()
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(ver)) {
      throw new FrameworkError(400, 'INVALID_VERSION', `version ${ver} must be a semantic version such as 1.0.0`)
    }
    const description = String(options.description ?? '').trim() || clean
    const tags = parseCreateTags(options.tags)
    const targetRoot = join(this.rootOf(username), clean)
    if (existsSync(targetRoot)) throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${clean} already exists`)
    // 标准目录：空目录即骨架的一部分（不放占位文件，内容由用户在文件编辑器里补）。
    // YAML 双引号标量：名称含 `#`、`: ` 或 `---` 也不会被解析成注释/新文档。
    const skeleton = `---\nname: ${JSON.stringify(clean)}\ndescription: ${JSON.stringify(description)}\nversion: ${JSON.stringify(ver)}\nauthor: ${JSON.stringify(username)}\ntags: [${tags.map(tag => JSON.stringify(tag)).join(', ')}]\n---\n\n# ${clean}\n\nDescribe what this skill does and when to use it.\n`
    writeSkillDirectory(targetRoot, (staging) => {
      for (const directory of SKILL_SKELETON_DIRS) mkdirSync(join(staging, directory), { recursive: true })
      writeFileSync(join(staging, 'SKILL.md'), skeleton, 'utf8')
    })
    try {
      const now = new Date().toISOString()
      const id = newId()
      await this.db.prepare(
        `INSERT INTO skills_packages
          (id, user_id, name, pkg_version, description, icon, author, tags, folder_path,
           is_active, is_public, source, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'local', ?, ?, 1)`,
      ).run(id, userId, clean, ver, description, null, username, JSON.stringify(tags), targetRoot, now, now)
      return this.view(await this.byIdScoped(userId, id) as SkillPackageRow)
    } catch (error) {
      // 目录由本次调用原子抢占，登记失败时删掉它不会误伤并发赢家。
      rmSync(targetRoot, { recursive: true, force: true })
      if (isUniqueViolation(error)) {
        throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${clean} already exists for user`)
      }
      throw error
    }
  }

  /** 启用/停用（热生效：junction 农场同步 + skill-filesystem 文件观察驱动失效）。 */
  async setActive(
    userId: string,
    id: string,
    active: boolean,
    actor: { isSuperuser?: boolean } = {},
  ): Promise<SkillPackageView> {
    await this.mutableRow(userId, id, actor.isSuperuser === true)
    await this.db.prepare('UPDATE skills_packages SET is_active = ?, updated_at = ?, version = version + 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
      .run(active ? 1 : 0, new Date().toISOString(), id, userId)
    // 热生效（PRD-04 FR-SKILL-005）：把该用户**全部活跃运行项目**的项目层技能根重同步一遍。
    // junction 的增删由 dsh skill-filesystem 的目录观察转成失效事件——模型下一步即见/不见。
    const projects = await this.db.prepare(
      'SELECT folder_path FROM run_projects WHERE user_id = ? AND is_active = 1',
    ).all<{ folder_path: string }>(userId)
    for (const project of projects) {
      try {
        await this.syncProjectSkills(userId, project.folder_path)
      } catch (error) {
        // 单项目同步失败不吞错：显式打行（台账里可见），继续同步其余项目。
        console.log(`soloengine: syncing skills into project ${project.folder_path} failed: ${String(error)}`)
      }
    }
    return this.view(await this.byIdScoped(userId, id) as SkillPackageRow)
  }

  /**
   * 解析台账里的备注列。
   * @param raw - `skills_packages.notes` 原文（JSON map）。
   * @returns 只保留字符串值的 path → note。
   */
  private static decodeNotes(raw: string | null): Record<string, string> {
    if (raw === null || raw === '') return {}
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed !== 'object' || parsed === null) return {}
      const notes: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') notes[key] = value
      }
      return notes
    } catch {
      return {}
    }
  }

  /** 文件备注读取（PRD-04 FR-SKILL-006：备注存台账列、不改包；返回 path → note map）。 */
  async getNotes(userId: string, id: string): Promise<Record<string, string>> {
    const row = await this.byIdVisible(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    return SkillService.decodeNotes(row.notes)
  }

  /**
   * 文件备注保存（整包覆盖式 map；空串条目视为删除）。
   *
   * 带版本栅栏：两个页面同时编辑同一技能的备注时，后写者拿到 409 而不是静默覆盖
   * 前者的改动；成功后版本 +1，调用方据此继续下一次写入。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @param notes - 完整备注 map（空串条目删除）。
   * @param actor - 操作者（系统技能只有超管可写）。
   * @param version - 客户端读到的技能版本。
   * @returns 落库后的备注与自增后的版本。
   */
  async setNotes(
    userId: string,
    id: string,
    notes: Record<string, string>,
    actor: { isSuperuser?: boolean } = {},
    version?: number,
  ): Promise<{ notes: Record<string, string>; version: number }> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required to update notes')
    if (Number(version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `skill ${id} notes were modified (expected ${String(row.version)}, got ${String(version)}); refresh and retry`)
    }
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(notes)) {
      if (typeof value === 'string' && value !== '') clean[key] = value
    }
    const updated = await this.db.prepare(
      `UPDATE skills_packages SET notes = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND version = ?`,
    ).run(JSON.stringify(clean), new Date().toISOString(), id, userId, version)
    if (updated.changes === 0) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `skill ${id} notes were modified by another request; refresh and retry`)
    }
    return { notes: clean, version: Number(row.version) + 1 }
  }

  /**
   * per-user SkillProvider（PRD-04 FR-SKILL-007 / 决策 7）的落地形态：
   * 把该用户「启用中」的技能以 Windows junction / POSIX symlink 形式同步进一个运行项目的
   * 项目层技能根（`<project>/.dsh/skills`）。运行项目的项目层即**该用户**启用技能的发现根
   * （项目层在 dsh 技能分层中最近，同名项胜出），天然按用户×项目隔离；junction 的增删由
   * skill-filesystem 的文件观察转为失效事件（启停热生效、清缓存、注册表版本随观察递增）。
   *
   * @param userId - 归属用户。
   * @param projectFolderPath - 运行项目目录（沙箱根）。
   */
  async syncProjectSkills(userId: string, projectFolderPath: string): Promise<void> {
    if (String(projectFolderPath ?? '').trim() === '') return
    // 同名时用户自己的技能胜过系统技能：系统行在前、用户行在后，Map 后者覆盖前者。
    const enabled = await this.db.prepare(
      `SELECT name, folder_path FROM skills_packages
        WHERE (user_id = ? OR user_id IS NULL) AND is_active = 1 AND folder_path IS NOT NULL
        ORDER BY (user_id IS NULL) DESC, name ASC`,
    ).all<{ name: string; folder_path: string }>(userId)
    const owned = await this.db.prepare(
      'SELECT name, folder_path FROM skills_packages WHERE user_id = ? AND folder_path IS NOT NULL',
    ).all<{ name: string; folder_path: string }>(userId)
    const targetRoot = join(projectFolderPath, '.dsh', 'skills')
    mkdirSync(targetRoot, { recursive: true })
    const wanted = new Map(projectSkillNames(enabled))
    // 只移除**我们自己创建的 junction**：链接目标必须落在一条已登记技能目录上，否则保留并报行。
    const registeredRoots = [...new Set([...owned.map(row => row.folder_path), ...enabled.map(row => row.folder_path)])]
      .filter((folder): folder is string => folder !== null)
      .map(folder => resolve(folder))
    for (const entry of readdirSync(targetRoot)) {
      const full = join(targetRoot, entry)
      let link = false
      try {
        link = lstatSync(full).isSymbolicLink()
      } catch { continue }
      if (!link) continue
      let target = ''
      try { target = resolve(readlinkSync(full)) } catch { target = '' }
      // `existsSync` 跟随链接：悬空 junction 在这里是 false，而 `lstatSync` 仍报符号链接。
      const dangling = !existsSync(full)
      const desired = wanted.get(entry)
      if (desired !== undefined) {
        // 名字仍启用但链接指向别处（含悬空）：指向已登记目录或已悬空的链接由我们替换，
        // 否则保留并报行。此前只要名字在启用集合里就直接跳过，悬空链接永远修不好，
        // 随后的创建又撞 EEXIST，每次同步都打一行失败。
        if (!dangling && target === resolve(desired)) continue
        const ours = dangling || (target !== '' && registeredRoots.some(root => target === root || target.startsWith(`${root}${path.sep}`)))
        if (!ours) {
          console.log(`soloengine: skill link "${entry}" in ${targetRoot} does not point at a registered skill directory (${target}); left untouched`)
          continue
        }
        rmSyncLink(full)
        console.log(`soloengine: skill "${entry}" link repaired in ${targetRoot}`)
        continue
      }
      const isOurs = target !== '' && registeredRoots.some(root => target === root || target.startsWith(`${root}${path.sep}`))
      if (!isOurs) {
        console.log(`soloengine: skill link "${entry}" in ${targetRoot} does not point at a registered skill directory (${target}); left untouched`)
        continue
      }
      rmSyncLink(full)
      console.log(`soloengine: skill "${entry}" left the active set of user ${userId}; junction removed from ${targetRoot}`)
    }
    for (const [name, folder] of wanted) {
      const link = join(targetRoot, name)
      if (existsSync(link)) {
        if (!lstatSync(link).isSymbolicLink()) {
          console.log(`soloengine: skill "${name}" is shadowed by a real directory at ${link}; left untouched`)
        }
        continue
      }
      if (!existsSync(folder)) continue
      symlinkSync(resolve(folder), link, 'junction')
      console.log(`soloengine: skill "${name}" is active for user ${userId}; junction created at ${link}`)
    }
  }

  /**
   * 删除技能（先删目录，再删记录）。
   *
   * 目录删不掉时**保留记录**并报 409：记录先删会让残留目录挡住同名重建（`SKILL_EXISTS`），
   * 且用户已无从重试。`rmSync(force)` 对已不存在的目录是空操作，因此部分失败后重试仍收敛。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @param actor - 操作者（系统技能只有超管可删）。
   */
  async remove(userId: string, id: string, actor: { isSuperuser?: boolean } = {}): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (row.folder_path !== null) {
      try {
        rmSync(row.folder_path, { recursive: true, force: true })
      } catch (error) {
        throw new FrameworkError(409, 'SKILL_DIRECTORY_BUSY',
          `skill ${id} still owns ${row.folder_path}, which could not be removed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.db.prepare('DELETE FROM skills_packages WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
  }

  /**
   * 发布/取消发布用户自己的技能（系统技能是出厂公共资产，不参与发布）。
   * @param userId - 当前用户。
   * @param id - 技能 ID。
   * @param isPublic - 是否公共。
   * @returns 更新后的技能视图。
   */
  async setPublic(userId: string, id: string, isPublic: boolean): Promise<SkillPackageView> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.user_id === null) {
      throw new FrameworkError(409, 'SKILL_SYSTEM_PUBLIC', `skill ${id} is a system skill and is already a shared asset`)
    }
    await this.db.prepare(
      'UPDATE skills_packages SET is_public = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?',
    ).run(isPublic ? 1 : 0, new Date().toISOString(), id, userId)
    return this.view(await this.byIdScoped(userId, id) as SkillPackageRow)
  }

  /**
   * 列出包内文件树（相对路径 + 字节数 + 文本化）。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @returns 文件条目（按路径排序由目录遍历保证；`text` 为 null 表示二进制）。
   */
  async listFiles(userId: string, id: string): Promise<{ path: string; size: number; text: string | null }[]> {
    const row = await this.byIdVisible(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) return []
    const root = resolve(row.folder_path)
    return walkDirectory(root).map(p => {
      const relative = path.relative(root, p).replace(/\\/g, '/')
      const stat = statSync(p)
      // 清单只用于文件树与二进制判定：不整份读入（大文件会把响应体撑爆）。
      // 文本文件给空串，二进制给 null；正文由 `/skills/:id/file` 单文件读取。
      const textual = looksTextual(readHead(p, 4096))
      return { path: relative, size: stat.size, text: textual ? '' : null }
    })
  }

  /**
   * 列出包内目录（含**空目录**，创建骨架里的 `references/`、`scripts/` 不会因没有文件而消失）。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @returns 相对目录路径（`/` 分隔，排序稳定）。
   */
  async listDirectories(userId: string, id: string): Promise<string[]> {
    const row = await this.byIdVisible(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) return []
    return walkDirectories(resolve(row.folder_path))
  }

  /** 读取单个文件内容（越界校验；二进制文件拒绝按文本读出）。 */
  async readFile(userId: string, id: string, relative: string): Promise<string> {
    const row = await this.byIdVisible(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (!existsSync(safePath)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `${relative} not found`)
    if (statSync(safePath).isDirectory()) {
      throw new FrameworkError(400, 'IS_A_DIRECTORY', `${relative} is a directory and cannot be opened in the text editor`)
    }
    const data = readFileSync(safePath)
    if (!looksTextual(data)) {
      throw new FrameworkError(415, 'BINARY_FILE', `${relative} is a binary file and cannot be opened in the text editor`)
    }
    return data.toString('utf8')
  }

  /** 写入单个文件（越界校验；二进制文件拒绝按文本覆盖）。 */
  async writeFile(
    userId: string,
    id: string,
    relative: string,
    content: string,
    actor: { isSuperuser?: boolean } = {},
  ): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (existsSync(safePath)) {
      if (statSync(safePath).isDirectory()) {
        throw new FrameworkError(409, 'PATH_IS_DIRECTORY', `${relative} is a directory; the editor only writes files`)
      }
      if (!looksTextual(readFileSync(safePath))) {
        throw new FrameworkError(415, 'BINARY_FILE', `${relative} is a binary file and cannot be overwritten by the text editor`)
      }
    }
    mkdirSync(dirname(safePath), { recursive: true })
    writeFileSync(safePath, content, 'utf8')
  }

  /** 新建文件。 */
  async createFile(
    userId: string,
    id: string,
    relative: string,
    content: string,
    actor: { isSuperuser?: boolean } = {},
  ): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (existsSync(safePath)) throw new FrameworkError(409, 'FILE_EXISTS', `${relative} already exists`)
    mkdirSync(dirname(safePath), { recursive: true })
    writeFileSync(safePath, content, 'utf8')
  }

  /**
   * 重命名/移动文件（文件系统内单次 rename，要么全成要么全不成）。
   *
   * 与「新建 + 删除」的两次请求不同：rename 不会留下「新文件已写、旧文件删不掉」
   * 或「旧文件已删、新文件没写成」的中间态；目标已存在即 409，不隐式覆盖。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @param from - 源相对路径。
   * @param to - 目标相对路径。
   * @param actor - 操作者（系统技能只有超管可写）。
   */
  async renameFile(
    userId: string,
    id: string,
    from: string,
    to: string,
    actor: { isSuperuser?: boolean } = {},
  ): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const root = resolve(row.folder_path)
    const source = this.safeJoin(root, from)
    const target = this.safeJoin(root, to)
    if (!existsSync(source)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `${from} not found`)
    if (existsSync(target)) throw new FrameworkError(409, 'FILE_EXISTS', `${to} already exists`)
    const sourceStat = statSync(source)
    if (sourceStat.isDirectory() && (target === source || target.startsWith(`${source}${path.sep}`))) {
      throw new FrameworkError(400, 'RENAME_INTO_SELF', `cannot move ${from} inside itself`)
    }
    mkdirSync(dirname(target), { recursive: true })
    renameSync(source, target)
  }

  /**
   * 删除文件/目录。
   *
   * 文件没了，指向它的备注也必须一起消失：否则同名文件重建时会把旧备注「复活」，
   * 而那条备注说的已经是另一个文件。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @param relative - 目标相对路径。
   * @param actor - 操作者（系统技能只有超管可写）。
   */
  async removeFile(
    userId: string,
    id: string,
    relative: string,
    actor: { isSuperuser?: boolean } = {},
  ): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const root = resolve(row.folder_path)
    const safePath = this.safeJoin(root, relative)
    if (!existsSync(safePath)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `${relative} not found`)
    const key = relative.replace(/\\/gu, '/')
    const prefix = `${key}/`
    // 技能包至少保留一个文件：删除前按剩余文件判定，目录整体删除同样受此约束。
    const remainingFiles = walkDirectory(root).filter((file) => {
      const rel = path.relative(root, file).replace(/\\/gu, '/')
      return rel !== key && !rel.startsWith(prefix)
    })
    if (remainingFiles.length === 0) {
      throw new FrameworkError(400, 'LAST_FILE_REQUIRED', 'a skill package must keep at least one file')
    }
    rmSync(safePath, { recursive: true, force: true })
    const current = SkillService.decodeNotes(row.notes)
    const remaining: Record<string, string> = {}
    let changed = false
    for (const [notePath, note] of Object.entries(current)) {
      if (notePath === key || notePath.startsWith(prefix)) {
        changed = true
        continue
      }
      remaining[notePath] = note
    }
    if (changed) {
      await this.db.prepare(
        'UPDATE skills_packages SET notes = ?, updated_at = ?, version = version + 1 WHERE id = ?',
      ).run(JSON.stringify(remaining), new Date().toISOString(), id)
    }
  }

  /**
   * 导出技能包为 zip 字节（保持目录结构）。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @returns zip 字节。
   */
  async exportArchive(userId: string, id: string): Promise<Uint8Array> {
    const row = await this.byIdVisible(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const root = resolve(row.folder_path)
    if (!existsSync(root)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `skill ${id} has no directory on disk`)
    // 导出物顶层名同样受包名约束：未净化名称会把 `../` 写进 zip 条目（接收方解压即穿越）。
    const top = assertSkillName(row.name)
    const tree: Record<string, Uint8Array> = {}
    for (const file of walkDirectory(root)) {
      const relative = path.relative(root, file).replace(/\\/g, '/')
      tree[`${top}/${relative}`] = new Uint8Array(readFileSync(file))
    }
    return zipSync(tree, { level: 6 })
  }
}

/** 技能包名的字符集与长度（同时用作目录名与 junction 名，必须与文件系统安全）。 */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

/** 创建骨架时生成的标准目录（空目录即骨架的一部分）。 */
const SKILL_SKELETON_DIRS = ['references', 'scripts'] as const

/** 导入包条目数上限（zip bomb 防护）。 */
const MAX_ARCHIVE_ENTRIES = 2000

/** 导入包单条目解压上限。 */
const MAX_ARCHIVE_ENTRY_BYTES = 16 * 1024 * 1024

/** 导入包解压总量上限。 */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

/** 目录导入的递归深度上限（符号链接已被跳过，仍防异常深树）。 */
const MAX_DIRECTORY_DEPTH = 32

/**
 * 校验技能包名并原样返回。
 *
 * 名称既是 `skills_packages.name` 也是目录名/junction 名：只允许字母数字与 `._-`，
 * 首字符必须是字母或数字，长度 1–64；`..`、路径分隔符、空白与控制字符一律拒绝。
 * @param name - 原始名称。
 * @returns 通过校验的名称。
 * @throws FrameworkError 400 `INVALID_SKILL_NAME`。
 */
function assertSkillName(name: string): string {
  const clean = String(name ?? '').trim()
  if (!SKILL_NAME_PATTERN.test(clean)) {
    throw new FrameworkError(400, 'INVALID_SKILL_NAME', `skill name ${JSON.stringify(clean)} must match ${String(SKILL_NAME_PATTERN)}`)
  }
  if (clean === '.' || clean === '..' || clean.includes('..')) {
    throw new FrameworkError(400, 'INVALID_SKILL_NAME', `skill name ${JSON.stringify(clean)} must not contain ".."`)
  }
  if (clean.endsWith('.')) {
    throw new FrameworkError(400, 'INVALID_SKILL_NAME', `skill name ${JSON.stringify(clean)} must not end with a dot`)
  }
  return clean
}

/**
 * 导入源的内容指纹：按条目名排序后对「路径 + 内容摘要」求 sha256。
 * @param entries - 导入源条目。
 * @returns `sha256:<hex>` 指纹。
 */
function fingerprintOf(entries: readonly ZipEntry[]): string {
  const hash = createHash('sha256')
  const sorted = entries
    .map(entry => ({ name: entry.name.replace(/\\/g, '/'), data: entry.data }))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of sorted) {
    const digest = createHash('sha256').update(entry.data).digest('hex')
    hash.update(`${entry.name}\u0000${digest}\n`)
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * 递归列出目录下所有普通文件的绝对路径（排序稳定）。
 *
 * 不跟随符号链接（结构链接指向目录外的内容不进清单），并有深度上限。
 * @param root - 目录绝对路径。
 * @returns 文件绝对路径（排序）。
 */
function walkDirectory(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DIRECTORY_DEPTH) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let stat
      try { stat = lstatSync(p) } catch { continue }
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) visit(p, depth + 1)
      else if (stat.isFile()) out.push(p)
    }
  }
  visit(root, 0)
  return out.sort()
}

/**
 * 递归列出目录下的相对目录路径（含空目录，排序稳定）。
 *
 * 与 {@link walkDirectory} 同一防穿越规则：不跟随符号链接、深度受限。
 * @param root - 目录绝对路径。
 * @returns 相对目录路径（`/` 分隔）。
 */
function walkDirectories(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string, depth: number, prefix: string): void => {
    if (depth > MAX_DIRECTORY_DEPTH) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let stat
      try { stat = lstatSync(p) } catch { continue }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue
      const relative = prefix === '' ? name : `${prefix}/${name}`
      out.push(relative)
      visit(p, depth + 1, relative)
    }
  }
  visit(root, 0, '')
  return out.sort()
}

/**
 * 移除一个符号链接/junction 条目（不跟随目标）。
 *
 * Windows 的悬空 junction 用 `rmSync` 会按 ENOENT 被 `force` 吞掉并留下目录项，
 * 必须用 `unlinkSync` 摘除链接本身；非链接条目才回落到递归删除。
 * @param path - 链接路径。
 */
function rmSyncLink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    rmSync(path, { recursive: true, force: true })
  }
}

/**
 * 把启用行转成「junction 名 → 目标目录」清单；名称不合规的行跳过并报行。
 * @param rows - 技能行（名称与目录）。
 * @returns 可创建链接的条目（按输入顺序）。
 */
function projectSkillNames(rows: readonly { name: string; folder_path: string | null }[]): [string, string][] {
  const out: [string, string][] = []
  for (const row of rows) {
    if (row.folder_path === null) continue
    try {
      out.push([assertSkillName(row.name), row.folder_path])
    } catch (error) {
      console.log(`soloengine: skill ${row.name} cannot be linked into a project: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return out
}

/**
 * 导入源里的宿主垃圾条目（macOS 资源分叉、Windows 缩略图/桌面配置）。
 *
 * 这些是打包工具附带的元数据，不属于技能包本身；跳过而不是整包拒绝，
 * 但必须在预览的 `skippedRejected` 里点名，保证「说跳过就真的不落盘」。
 * @param relative - 包内相对路径（已统一为 `/`）。
 * @returns 是否属于宿主垃圾条目。
 */
function isArchiveJunk(relative: string): boolean {
  const segments = relative.split('/')
  const base = segments[segments.length - 1] ?? ''
  return base === '.DS_Store' || base === 'Thumbs.db' || segments.includes('__MACOSX')
}

/** 从文件清单猜测技能根名（首个目录段或 SKILL.md 目录）。 */
function guessRootName(files: SkillFileEntry[]): string {
  const skillMd = files.find(file => path.basename(file.path).toLowerCase() === 'skill.md')
  if (skillMd !== undefined) {
    const dir = path.dirname(skillMd.path)
    if (dir !== '' && dir !== '.') return dir.split('/')[0] as string
  }
  const first = files[0]
  if (first !== undefined) {
    const seg = first.path.split('/')[0]
    if (seg !== undefined && seg !== '') return seg
  }
  return 'skill'
}

/** 归一化路径（复用 node:path）。 */
function normalize(p: string): string {
  return path.normalize(p)
}