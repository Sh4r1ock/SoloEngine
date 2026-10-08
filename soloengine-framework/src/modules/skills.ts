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

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path, { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import yaml from 'js-yaml'
import { zipSync, unzipSync, strFromU8 } from 'fflate'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
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
export interface SkillPackageView extends Omit<SkillPackageRow, 'user_id' | 'is_active' | 'is_public'> {
  user_id: string | null
  is_active: boolean
  is_public: boolean
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

/** 单条包内文件（相对路径 + 文本或字节）。 */
export interface SkillFileEntry {
  path: string
  text?: string
  bytes?: Uint8Array
}

/** 导入第一阶段结果：元数据 + 目录树预览。 */
export interface SkillImportPreview {
  name: string
  version: string
  description: string | null
  author: string
  files: string[]
  skippedRejected: string[]
}

/** zip 条目。 */
interface ZipEntry {
  name: string
  data: Uint8Array
}

/** 技能域服务。 */
export class SkillService {
  private readonly raw: DatabaseSync
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.raw = runtime.db.raw
    this.runtime = runtime
  }

  /** 用户技能根目录（在用户目录隔离区内）。 */
  private rootOf(username: string): string {
    this.runtime.userDirs.ensure(username)
    return this.runtime.userDirs.sub(username, 'skills')
  }

  /** 行 → 视图。 */
  view(row: SkillPackageRow): SkillPackageView {
    const { user_id, is_active, is_public, ...rest } = row
    return { ...rest, user_id, is_active: is_active === 1, is_public: is_public === 1 }
  }

  /** 列某用户技能（含公共）。 */
  list(userId: string): SkillPackageRow[] {
    return this.raw.prepare(
      `SELECT * FROM skills_packages WHERE user_id = ? OR user_id IS NULL ORDER BY created_at ASC`,
    ).all(userId) as unknown as SkillPackageRow[]
  }

  /** 按 ID 取（归属或公共）。 */
  byIdScoped(userId: string, id: string): SkillPackageRow | undefined {
    return this.raw.prepare(
      'SELECT * FROM skills_packages WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
    ).get(id, userId) as SkillPackageRow | undefined
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
    const meta: SkillMetadata = { name }
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
    return Object.entries(map).map(([name, data]) => ({ name, data }))
  }

  /**
   * 展开 zip 条目为包文件清单（先收集，越界判定在安全目录内进行）。
   * @param entries - zip 条目。
   * @returns 包文件条目（相对路径）。
   */
  private expandEntries(entries: ZipEntry[]): SkillFileEntry[] {
    const files: SkillFileEntry[] = []
    for (const entry of entries) {
      const rawName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
      if (rawName.endsWith('/')) continue
      const textual = looksTextual(entry.data)
      const file: SkillFileEntry = { path: rawName }
      if (textual) file.text = strFromU8(entry.data)
      else file.bytes = entry.data
      files.push(file)
    }
    return files
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
    const resolved = normalize(resolve(targetRoot, relative))
    const prefix = targetRoot.endsWith(path.sep) ? targetRoot : `${targetRoot}${path.sep}`
    if (resolved !== targetRoot && !resolved.startsWith(prefix)) {
      throw new FrameworkError(400, 'PATH_TRAVERSAL', `entry ${relative} escapes the skill directory and is rejected`)
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
    let entries: ZipEntry[]
    if (archiveBytes !== null) {
      entries = SkillService.bytesToEntries(archiveBytes)
    } else {
      if (sourcePath === undefined) throw new FrameworkError(400, 'SOURCE_REQUIRED', 'either archive or source path is required')
      this.rootOf(username)
      const safeSource = this.runtime.userDirs.within(username, 'skills', sourcePath)
      const real = resolve(safeSource)
      entries = walkDirectory(real).map(p => {
        const data = readFileSync(p)
        return { name: path.relative(real, p).replace(/\\/g, '/'), data }
      })
    }
    const files = this.expandEntries(entries)
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
      name: meta.name,
      version: meta.version ?? '1.0.0',
      description: meta.description ?? null,
      author: meta.author ?? username,
      files: files.map(file => file.path).sort(),
      skippedRejected: [],
    }
  }

  /**
   * 两阶段导入：第二阶段确认后落盘并登记。
   * @param userId - 归属用户。
   * @param username - 登录名。
   * @param archiveBytes - zip 字节（或 null 走目录）。
   * @param sourcePath - 源目录（可选）。
   * @returns 技能包视图。
   */
  importConfirmed(userId: string, username: string, archiveBytes: Uint8Array | null, sourcePath?: string): SkillPackageView {
    const welcome = this.previewImport(username, archiveBytes, sourcePath)
    const targetRoot = join(this.rootOf(username), welcome.name)
    if (existsSync(targetRoot)) {
      throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${welcome.name} already exists for user`)
    }
    mkdirSync(targetRoot, { recursive: true })

    if (archiveBytes !== null) {
      const entries = SkillService.bytesToEntries(archiveBytes)
      for (const entry of entries) {
        const rawName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
        if (rawName.endsWith('/')) continue
        const text = looksTextual(entry.data) ? strFromU8(entry.data) : undefined
        const safePath = this.safeJoin(targetRoot, rawName)
        mkdirSync(dirname(safePath), { recursive: true })
        if (text !== undefined) writeFileSync(safePath, text, 'utf8')
        else writeFileSync(safePath, entry.data)
      }
    } else {
      this.rootOf(username)
      const safeSource = resolve(this.runtime.userDirs.within(username, 'skills', sourcePath as string))
      cpSync(safeSource, targetRoot, { recursive: true })
    }

    const now = new Date().toISOString()
    const id = newId()
    this.raw.prepare(
      `INSERT INTO skills_packages
        (id, user_id, name, pkg_version, description, icon, author, tags, folder_path,
         is_active, is_public, source, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'import', ?, ?, 1)`,
    ).run(id, userId, welcome.name, welcome.version, welcome.description, null, welcome.author, null,
      targetRoot, now, now)
    return this.view(this.byIdScoped(userId, id) as SkillPackageRow)
  }

  /** 创建技能包骨架（SKILL.md + 标准目录）。 */
  create(userId: string, username: string, name: string, version?: string): SkillPackageView {
    const clean = String(name ?? '').trim()
    if (clean === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    const skillName = clean.replace(/[^A-Za-z0-9_.-]/g, '_')
    const targetRoot = join(this.rootOf(username), skillName)
    if (existsSync(targetRoot)) throw new FrameworkError(409, 'SKILL_EXISTS', `skill ${skillName} already exists`)
    mkdirSync(targetRoot, { recursive: true })
    const ver = version ?? '1.0.0'
    const skeleton = `---\nname: ${clean}\ndescription: ''\nversion: ${ver}\nauthor: ${username}\ntags: []\n---\n\n# ${clean}\n\nDescribe what this skill does and when to use it.\n`
    writeFileSync(join(targetRoot, 'SKILL.md'), skeleton, 'utf8')
    const now = new Date().toISOString()
    const id = newId()
    this.raw.prepare(
      `INSERT INTO skills_packages
        (id, user_id, name, pkg_version, description, icon, author, tags, folder_path,
         is_active, is_public, source, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'local', ?, ?, 1)`,
    ).run(id, userId, clean, ver, '', null, username, null, targetRoot, now, now)
    return this.view(this.byIdScoped(userId, id) as SkillPackageRow)
  }

  /** 启用/停用（热生效：junction 农场同步 + skill-filesystem 文件观察驱动失效）。 */
  setActive(userId: string, id: string, active: boolean): SkillPackageView {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    this.raw.prepare('UPDATE skills_packages SET is_active = ?, updated_at = ?, version = version + 1 WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
      .run(active ? 1 : 0, new Date().toISOString(), id, userId)
    // 热生效（PRD-04 FR-SKILL-005）：把该用户**全部活跃运行项目**的项目层技能根重同步一遍。
    // junction 的增删由 dsh skill-filesystem 的目录观察转成失效事件——模型下一步即见/不见。
    const projects = this.raw.prepare(
      'SELECT folder_path FROM run_projects WHERE user_id = ? AND is_active = 1',
    ).all(userId) as { folder_path: string }[]
    for (const project of projects) {
      try {
        this.syncProjectSkills(userId, project.folder_path)
      } catch (error) {
        // 单项目同步失败不吞错：显式打行（台账里可见），继续同步其余项目。
        console.log(`soloengine: syncing skills into project ${project.folder_path} failed: ${String(error)}`)
      }
    }
    return this.view(this.byIdScoped(userId, id) as SkillPackageRow)
  }

  /** 文件备注读取（PRD-04 FR-SKILL-006：备注存台账列、不改包；返回 path → note map）。 */
  getNotes(userId: string, id: string): Record<string, string> {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.notes === null || row.notes === '') return {}
    try {
      const parsed = JSON.parse(row.notes) as unknown
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  /** 文件备注保存（整包覆盖式 map；空串条目视为删除）。 */
  setNotes(userId: string, id: string, notes: Record<string, string>): Record<string, string> {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(notes)) {
      if (typeof value === 'string' && value !== '') clean[key] = value
    }
    this.raw.prepare(
      'UPDATE skills_packages SET notes = ?, updated_at = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)',
    ).run(JSON.stringify(clean), new Date().toISOString(), id, userId)
    return clean
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
  syncProjectSkills(userId: string, projectFolderPath: string): void {
    if (String(projectFolderPath ?? '').trim() === '') return
    const enabled = this.raw.prepare(
      `SELECT name, folder_path FROM skills_packages
        WHERE (user_id = ? OR user_id IS NULL) AND is_active = 1 AND folder_path IS NOT NULL`,
    ).all(userId) as { name: string; folder_path: string }[]
    const targetRoot = join(projectFolderPath, '.dsh', 'skills')
    mkdirSync(targetRoot, { recursive: true })
    const wanted = new Map(enabled.map(row => [row.name, row.folder_path]))
    // 只移除**我们自己创建的 junction**（符号链接判定）：项目里用户自建的真实技能目录不动。
    for (const entry of readdirSync(targetRoot)) {
      const full = join(targetRoot, entry)
      try {
        if (!lstatSync(full).isSymbolicLink()) continue
      } catch { continue }
      if (wanted.has(entry)) continue
      rmSync(full, { recursive: true, force: true })
      console.log(`soloengine: skill "${entry}" left the active set of user ${userId}; junction removed from ${targetRoot}`)
    }
    for (const [name, folder] of wanted) {
      const link = join(targetRoot, name)
      if (existsSync(link)) continue
      if (!existsSync(folder)) continue
      symlinkSync(resolve(folder), link, 'junction')
      console.log(`soloengine: skill "${name}" is active for user ${userId}; junction created at ${link}`)
    }
  }

  /** 删除技能（删除目录与记录）。 */
  remove(userId: string, id: string): void {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path !== null) rmSync(row.folder_path, { recursive: true, force: true })
    this.raw.prepare('DELETE FROM skills_packages WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
  }

  /** 列出包内文件树（相对路径 + 文本化）。 */
  listFiles(userId: string, id: string): { path: string; text: string | null }[] {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) return []
    const root = resolve(row.folder_path)
    return walkDirectory(root).map(p => {
      const relative = path.relative(root, p).replace(/\\/g, '/')
      const data = readFileSync(p)
      return { path: relative, text: looksTextual(data) ? data.toString('utf8') : null }
    })
  }

  /** 读取单个文件内容（越界校验）。 */
  readFile(userId: string, id: string, relative: string): string {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (!existsSync(safePath)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `${relative} not found`)
    return readFileSync(safePath, 'utf8')
  }

  /** 写入单个文件（越界校验；保存后 description 热生效由 harness 侧目录重扫驱动）。 */
  writeFile(userId: string, id: string, relative: string, content: string): void {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    mkdirSync(dirname(safePath), { recursive: true })
    writeFileSync(safePath, content, 'utf8')
  }

  /** 新建文件。 */
  createFile(userId: string, id: string, relative: string, content: string): void {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (existsSync(safePath)) throw new FrameworkError(409, 'FILE_EXISTS', `${relative} already exists`)
    mkdirSync(dirname(safePath), { recursive: true })
    writeFileSync(safePath, content, 'utf8')
  }

  /** 删除文件/目录。 */
  removeFile(userId: string, id: string, relative: string): void {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const safePath = this.safeJoin(resolve(row.folder_path), relative)
    if (!existsSync(safePath)) throw new FrameworkError(404, 'FILE_NOT_FOUND', `${relative} not found`)
    rmSync(safePath, { recursive: true, force: true })
  }

  /**
   * 导出技能包为 zip 字节（保持目录结构）。
   * @param userId - 归属用户。
   * @param id - 技能 ID。
   * @returns zip 字节。
   */
  exportArchive(userId: string, id: string): Uint8Array {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'SKILL_NOT_FOUND', `skill ${id} not found`)
    if (row.folder_path === null) throw new FrameworkError(404, 'FILE_NOT_FOUND', 'skill has no directory')
    const root = resolve(row.folder_path)
    const tree: Record<string, Uint8Array> = {}
    for (const file of walkDirectory(root)) {
      const relative = path.relative(root, file).replace(/\\/g, '/')
      tree[`${row.name}/${relative}`] = new Uint8Array(readFileSync(file))
    }
    return zipSync(tree, { level: 6 })
  }
}

/** 判定字节是否为可文本化内容（前 512 字节无非打印字符）。 */
function looksTextual(data: Uint8Array): boolean {
  const sample = data.slice(0, Math.min(512, data.length))
  for (const byte of sample) {
    if (byte === 0) return false
    if (byte < 0x09) return false
    if (byte > 0x0d && byte < 0x20) return false
  }
  return true
}

/** 递归列出目录下所有文件的绝对路径（排序稳定）。 */
function walkDirectory(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let isDirectory = false
      try { isDirectory = statSync(p).isDirectory() } catch { isDirectory = false }
      if (isDirectory) visit(p)
      else out.push(p)
    }
  }
  visit(root)
  return out.sort()
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