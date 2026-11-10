/**
 * 市场域：技能与 MCP 服务器的目录浏览与一键安装。
 *
 * - 目录真源为 `data/market/catalog.json`（缺失即**真实创建**：4 条技能条目 + 3 条 MCP 条目）；
 * - 安装**不新增管线**：`skill` 走 `SkillService.importConfirmed`（技能两阶段导入的
 *   「确认落盘」路径，条目 `source` 指向的目录在此被压成 zip 字节后交给同一条落盘逻辑），
 *   `mcp` 走 `McpService.create`（MCP 注册路径，条目 `source` 即传输配置来源）；
 * - 重复安装一律报错（`MARKET_ALREADY_INSTALLED`），不静默覆盖；
 * - 本模块只读目录文件与已有表，不新建表、不写第二份数据副本。
 *
 * @module @soloengine/framework/modules/market
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { zipSync } from 'fflate'
import Schema from '@deepseek-ai/schemastery'
import type { BusinessDatabase } from '../db/port.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError, type UserRow } from './accounts.ts'
import type { SkillPackageView } from './skills.ts'

/** 市场条目类别。 */
export type MarketKind = 'skill' | 'mcp'

/** MCP stdio 传输参数（条目自带）。 */
export interface MarketStdioTransport {
  command: string
  args?: string[]
  env?: Record<string, string>
  working_dir?: string
}

/** MCP http 传输参数（条目自带）。 */
export interface MarketHttpTransport {
  url: string
  headers?: Record<string, string>
  timeout?: number
}

/** 市场条目（目录文件的行形态 + 派生安装数）。 */
export interface MarketEntry {
  id: string
  kind: MarketKind
  name: string
  version: string
  author: string
  description: string
  tags: string[]
  categories: string[]
  featured: boolean
  /** 本实例的真实安装数：由 `skills_packages`/`mcp_servers` 的同名行数派生，不读目录文件。 */
  installs: number
  /** 当前用户是否已安装（按落库名匹配；未给出用户时恒为 false）。 */
  installed: boolean
  /** 安装来源：技能为 data 根下的相对目录/zip；MCP 为传输配置来源串。 */
  source: string
  /** MCP stdio 传输参数（kind==='mcp' 且 stdio 传输时必填）。 */
  stdio?: MarketStdioTransport
  /** MCP http 传输参数（kind==='mcp' 且 http 传输时必填）。 */
  http?: MarketHttpTransport
}

/** 目录文件里的条目行（安装数与安装状态是从业务库派生的展示值，文件不存）。 */
type MarketCatalogRow = Omit<MarketEntry, 'installs' | 'installed'>

/** 目录查询参数（全部为原始 query 字符串，由本模块校验）。 */
export interface MarketQuery {
  kind?: string | undefined
  q?: string | undefined
  category?: string | undefined
  sort?: string | undefined
  featured?: string | undefined
}

/** 安装结果。 */
export interface MarketInstallResult {
  /** 市场条目 ID。 */
  id: string
  kind: MarketKind
  /** 落库资产的 ID（技能包 ID 或 MCP 服务器 ID）。 */
  assetId: string
  name: string
}

/** 目录文件在 data 根下的相对位置。 */
const CATALOG_RELATIVE = join('market', 'catalog.json')

/** 目录条目的必填文本列（非空字符串；类型不被静默强转）。 */
const MarketText = () => Schema.string().required().min(1)

/** MCP stdio 传输块：args/env 只接受字符串，缺省分别归一为 `[]`/`{}`。 */
const MarketStdioSchema = Schema.object({
  command: MarketText(),
  args: Schema.array(Schema.string()).default([]),
  env: Schema.dict(Schema.string()).default({}),
  working_dir: Schema.union([Schema.string().min(1), Schema.const(null)]).default(null),
})

/** MCP http 传输块：headers 只接受字符串；timeout 与 MCP 子表的 1–600 秒一致。 */
const MarketHttpSchema = Schema.object({
  url: MarketText(),
  headers: Schema.dict(Schema.string()).default({}),
  timeout: Schema.union([Schema.natural().min(1).max(600), Schema.const(null)]).default(null),
})

/** 目录条目的标量列；stdio/http 块按 kind 单独校验（两者互斥）。 */
const MarketEntrySchema = Schema.object({
  id: MarketText(),
  kind: Schema.union(['skill', 'mcp'] as const),
  name: MarketText(),
  version: MarketText(),
  author: MarketText(),
  description: MarketText(),
  tags: Schema.array(Schema.string()).default([]),
  categories: Schema.array(Schema.string()).default([]),
  featured: Schema.boolean().default(false),
  source: MarketText(),
  stdio: Schema.any(),
  http: Schema.any(),
})

/**
 * 按声明式 schema 解析一段目录数据，失败统一包成 MARKET_CATALOG_INVALID。
 *
 * 第一类型参数是 schema 的输入侧：目录来自磁盘 JSON，调用点只有 `unknown`，
 * 由 schema 自身完成校验与收窄，输出类型由第二参数 T 保证。
 *
 * @param schema - 目标 schema。
 * @param raw - 待解析的原始值。
 * @param index - 条目序号（错误信息定位）。
 * @param label - 数据位置（条目本身或子块名）。
 * @returns 解析后的值。
 */
function parseCatalog<T>(schema: Schema<any, T>, raw: unknown, index: number, label: string): T {
  try {
    return schema(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new FrameworkError(500, 'MARKET_CATALOG_INVALID',
      `market catalog entry #${String(index)} ${label} is invalid: ${detail}`)
  }
}

/** 内置技能条目（4 条）+ 各自的 SKILL.md 正文。 */
const BUILTIN_SKILLS: {
  id: string
  name: string
  description: string
  tags: string[]
  categories: string[]
  featured: boolean
  body: string
}[] = [
  {
    id: 'skill-code-review',
    name: 'code-review',
    description: '按变更集审查代码：正确性、边界条件、可维护性与回归风险逐条给出证据。',
    tags: ['review', 'quality', 'diff'],
    categories: ['engineering'],
    featured: true,
    body: 'Review the requested change set. For each finding give file, line, the concrete risk and the smallest fix. Never invent code you did not read.',
  },
  {
    id: 'skill-commit-writer',
    name: 'commit-writer',
    description: '读取真实 diff 后撰写符合仓库风格的提交信息（说明「为什么」而非「改了什么」）。',
    tags: ['git', 'commit', 'workflow'],
    categories: ['engineering'],
    featured: true,
    body: 'Read the staged diff and the recent log, then write a commit message that follows the repository style and explains why the change exists.',
  },
  {
    id: 'skill-test-runner',
    name: 'test-runner',
    description: '定位并运行最小相关测试集合，回报真实输出与失败归因。',
    tags: ['test', 'ci', 'verification'],
    categories: ['engineering'],
    featured: false,
    body: 'Pick the smallest test set that covers the outgoing change, run it, and report the real output. Do not claim success without observed output.',
  },
  {
    id: 'skill-doc-writer',
    name: 'doc-writer',
    description: '为已有代码补齐面向读者的说明文档，只写代码中真实存在的行为。',
    tags: ['docs', 'writing'],
    categories: ['documentation'],
    featured: false,
    body: 'Document behaviour that exists in the code you read. Do not document imagined features or planned work.',
  },
]

/** 内置 MCP 条目（3 条）。 */
const BUILTIN_MCPS: MarketCatalogRow[] = [
  {
    id: 'mcp-filesystem',
    kind: 'mcp',
    name: 'filesystem',
    version: '0.6.2',
    author: 'modelcontextprotocol',
    description: '官方文件系统 MCP 服务器：在受限目录内提供读写与检索能力。',
    tags: ['filesystem', 'official'],
    categories: ['tools'],
    featured: true,
    source: 'npx -y @modelcontextprotocol/server-filesystem',
    stdio: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
  },
  {
    id: 'mcp-github',
    kind: 'mcp',
    name: 'github',
    version: '0.6.2',
    author: 'modelcontextprotocol',
    description: '官方 GitHub MCP 服务器：仓库、Issue 与 PR 读写（令牌由环境变量提供）。',
    tags: ['github', 'official', 'vcs'],
    categories: ['tools'],
    featured: false,
    source: 'npx -y @modelcontextprotocol/server-github',
    stdio: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    id: 'mcp-deepwiki',
    kind: 'mcp',
    name: 'deepwiki',
    version: '1.0.0',
    author: 'deepwiki',
    description: '公开的 DeepWiki MCP 服务器（Streamable HTTP）：查询 GitHub 仓库的文档与问答。',
    tags: ['http', 'remote', 'docs'],
    categories: ['tools'],
    featured: false,
    source: 'https://mcp.deepwiki.com/mcp',
    http: {
      url: 'https://mcp.deepwiki.com/mcp',
      timeout: 30,
    },
  },
]

/** 市场域服务。 */
export class MarketService {
  private readonly runtime: FrameworkRuntime
  private readonly db: BusinessDatabase

  /**
   * @param runtime - 框架层运行时（技能/MCP 服务与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
    this.db = runtime.db
  }

  /** 目录文件绝对路径（data 根下 `market/catalog.json`）。 */
  private catalogPath(): string {
    return join(this.runtime.dataDir, CATALOG_RELATIVE)
  }

  /** 技能资产目录绝对路径（data 根下 `market/skills/<name>`）。 */
  private skillSourceDir(name: string): string {
    return join(this.runtime.dataDir, 'market', 'skills', name)
  }

  /** 条目 → 目录文件行（技能 source 为 data 根下的相对目录）。 */
  private builtinEntries(): MarketCatalogRow[] {
    const skills: MarketCatalogRow[] = BUILTIN_SKILLS.map(skill => ({
      id: skill.id,
      kind: 'skill',
      name: skill.name,
      version: '1.0.0',
      author: 'soloengine',
      description: skill.description,
      tags: skill.tags,
      categories: skill.categories,
      featured: skill.featured,
      source: join('market', 'skills', skill.name),
    }))
    return [...skills, ...BUILTIN_MCPS]
  }

  /** 缺失即真实创建目录文件与其技能资产（不覆盖已存在者）。 */
  private ensureCatalog(): void {
    const catalogPath = this.catalogPath()
    if (existsSync(catalogPath)) return
    for (const skill of BUILTIN_SKILLS) {
      const dir = this.skillSourceDir(skill.name)
      mkdirSync(dir, { recursive: true })
      const skillPath = join(dir, 'SKILL.md')
      if (existsSync(skillPath)) continue
      const frontmatter = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        'version: 1.0.0',
        'author: soloengine',
        `tags: [${skill.tags.join(', ')}]`,
        '---',
        '',
        `# ${skill.name}`,
        '',
        skill.body,
        '',
      ].join('\n')
      writeFileSync(skillPath, frontmatter, 'utf8')
    }
    this.writeCatalogAtomic({ entries: this.builtinEntries() })
  }

  /**
   * 原子写目录文件（临时文件 + rename）：中断只留临时文件，真源不会半写。
   * @param parsed - 待写入的完整目录对象。
   */
  private writeCatalogAtomic(parsed: unknown): void {
    const catalogPath = this.catalogPath()
    mkdirSync(dirname(catalogPath), { recursive: true })
    const temporary = `${catalogPath}.tmp`
    writeFileSync(temporary, `${JSON.stringify(parsed, undefined, 2)}\n`, 'utf8')
    renameSync(temporary, catalogPath)
  }

  /** 读取并校验目录（缺失即创建；损坏即报错，不静默清空）。 */
  private loadEntries(): MarketCatalogRow[] {
    this.ensureCatalog()
    const text = readFileSync(this.catalogPath(), 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new FrameworkError(500, 'MARKET_CATALOG_INVALID', `market catalog is not valid JSON: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(500, 'MARKET_CATALOG_INVALID', 'market catalog must be a JSON object with an entries array')
    }
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) {
      throw new FrameworkError(500, 'MARKET_CATALOG_INVALID', 'market catalog must carry an entries array')
    }
    return entries.map((raw, index) => this.assertEntry(raw, index))
  }

  /** 按声明式 schema 校验一条目录条目（非法即报错，不静默强转）。 */
  private assertEntry(raw: unknown, index: number): MarketCatalogRow {
    const fail = (detail: string): never => {
      throw new FrameworkError(500, 'MARKET_CATALOG_INVALID', `market catalog entry #${String(index)} ${detail}`)
    }
    const parsed = parseCatalog(MarketEntrySchema, raw, index, 'entry')
    const entry: MarketCatalogRow = {
      id: parsed.id,
      kind: parsed.kind,
      name: parsed.name,
      version: parsed.version,
      author: parsed.author,
      description: parsed.description,
      tags: parsed.tags,
      categories: parsed.categories,
      featured: parsed.featured,
      source: parsed.source,
    }
    if (entry.kind !== 'mcp') return entry
    const rawStdio: unknown = parsed.stdio
    const rawHttp: unknown = parsed.http
    const stdio = rawStdio === undefined || rawStdio === null
      ? undefined
      : parseCatalog(MarketStdioSchema, rawStdio, index, 'stdio block')
    const http = rawHttp === undefined || rawHttp === null
      ? undefined
      : parseCatalog(MarketHttpSchema, rawHttp, index, 'http block')
    if (stdio !== undefined && http !== undefined) {
      fail('declares both stdio and http transport parameters; an mcp entry keeps exactly one')
    }
    if (stdio !== undefined) {
      entry.stdio = {
        command: stdio.command,
        args: stdio.args,
        env: stdio.env,
        ...stdio.working_dir === null ? {} : { working_dir: stdio.working_dir },
      }
    }
    if (http !== undefined) {
      entry.http = {
        url: http.url,
        headers: http.headers,
        ...http.timeout === null ? {} : { timeout: http.timeout },
      }
    }
    if (entry.stdio === undefined && entry.http === undefined) {
      fail('is an mcp entry without stdio or http transport parameters')
    }
    return entry
  }

  /**
   * 列目录（kind/q/category/sort/featured 过滤与排序）。
   *
   * `categories` 取自**该 kind 的完整目录**（不是本次筛选后的页），供首屏一次性给出全部筛选候选。
   * `installs` 是业务库派生的真实安装数；`installed` 是当前用户本地清单里是否已有同名资产。
   * @param query - 原始 query 参数。
   * @param userId - 当前用户（省略时不判定 installed）。
   * @returns 条目与总数、该 kind 的全部类别（排序）。
   */
  async list(query: MarketQuery, userId?: string): Promise<{ entries: MarketEntry[]; total: number; categories: string[] }> {
    const invalid = (detail: string): never => {
      throw new FrameworkError(400, 'MARKET_QUERY_INVALID', detail)
    }
    const kind = query.kind
    if (kind !== undefined && kind !== '' && kind !== 'skill' && kind !== 'mcp') {
      invalid(`kind must be skill or mcp, got ${JSON.stringify(kind)}`)
    }
    const sort = query.sort === undefined || query.sort === '' ? 'featured' : query.sort
    if (sort !== 'featured' && sort !== 'installs' && sort !== 'name') {
      invalid(`sort must be featured|installs|name, got ${JSON.stringify(query.sort ?? '')}`)
    }
    const featuredRaw = query.featured
    if (featuredRaw !== undefined && featuredRaw !== '' && featuredRaw !== 'true' && featuredRaw !== 'false') {
      invalid(`featured must be true or false, got ${JSON.stringify(featuredRaw)}`)
    }
    const keyword = (query.q ?? '').trim().toLowerCase()
    const category = (query.category ?? '').trim().toLowerCase()

    const catalog = this.loadEntries()
    const scoped = kind === undefined || kind === '' ? catalog : catalog.filter(entry => entry.kind === kind)
    const categories = [...new Set(scoped.flatMap(entry => entry.categories))]
      .sort((left, right) => left.localeCompare(right))
    const counts = await this.installCounts()
    const owned = await this.installedNames(userId)
    const entries = catalog.map(entry => ({
      ...entry,
      installs: counts.get(entry.kind)?.get(entry.name) ?? 0,
      installed: owned.get(entry.kind)?.has(entry.name) ?? false,
    })).filter(entry => {
      if (kind !== undefined && kind !== '' && entry.kind !== kind) return false
      if (featuredRaw === 'true' && !entry.featured) return false
      if (featuredRaw === 'false' && entry.featured) return false
      if (category !== '' && !entry.categories.some(item => item.toLowerCase() === category)) return false
      if (keyword !== '') {
        const haystack = [entry.name, entry.description, entry.author, ...entry.tags].join(' ').toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })

    entries.sort((left, right) => {
      if (sort === 'installs') return right.installs - left.installs || left.name.localeCompare(right.name)
      if (sort === 'name') return left.name.localeCompare(right.name)
      if (left.featured !== right.featured) return left.featured ? -1 : 1
      return right.installs - left.installs || left.name.localeCompare(right.name)
    })
    return { entries, total: entries.length, categories }
  }

  /**
   * 统计真实安装数：目录条目按 `name` 对应已落库的技能包/MCP 服务器行数。
   * @returns kind →（name → 行数）。
   */
  private async installCounts(): Promise<Map<MarketKind, Map<string, number>>> {
    const counts = new Map<MarketKind, Map<string, number>>()
    for (const [kind, table] of [['skill', 'skills_packages'], ['mcp', 'mcp_servers']] as const) {
      const rows = await this.db.prepare(`SELECT name, COUNT(*) AS total FROM ${table} GROUP BY name`)
        .all<{ name: string; total: number }>()
      counts.set(kind, new Map(rows.map(row => [row.name, Number(row.total)])))
    }
    return counts
  }

  /**
   * 当前用户本地清单里的资产名（与安装判重同一口径）。
   *
   * 技能只算**自有行**：系统/公共技能在列表里可见不等于已安装，市场安装会落一份自有副本；
   * 把它算成「已安装」会让页面禁用安装按钮，而接口又能真的安装（两处口径分叉）。
   * MCP 名称全实例唯一，任何可见同名行都会阻止注册，故按自有 + 系统行判定。
   * @param userId - 当前用户；省略时返回空表。
   * @returns kind →（已安装的名称集合）。
   */
  private async installedNames(userId: string | undefined): Promise<Map<MarketKind, Set<string>>> {
    const owned = new Map<MarketKind, Set<string>>([
      ['skill', new Set<string>()],
      ['mcp', new Set<string>()],
    ])
    if (userId === undefined || userId === '') return owned
    const skills = await this.db.prepare(
      'SELECT name FROM skills_packages WHERE user_id = ?',
    ).all<{ name: string }>(userId)
    owned.set('skill', new Set(skills.map(row => row.name)))
    const servers = await this.db.prepare('SELECT name FROM mcp_servers WHERE user_id = ? OR user_id IS NULL')
      .all<{ name: string }>(userId)
    owned.set('mcp', new Set(servers.map(row => row.name)))
    return owned
  }

  /**
   * 安装一条目录条目（复用既有管线：技能两阶段导入的确认落盘 / MCP 注册）。
   * @param user - 请求级用户。
   * @param entryId - 条目 ID。
   * @returns 落库资产。
   */
  async install(user: UserRow, entryId: string): Promise<MarketInstallResult> {
    const entry = this.loadEntries().find(candidate => candidate.id === entryId)
    if (entry === undefined) {
      throw new FrameworkError(404, 'MARKET_ENTRY_NOT_FOUND', `market entry ${entryId} not found`)
    }
    return entry.kind === 'skill' ? await this.installSkill(user, entry) : await this.installMcp(user, entry)
  }

  /**
   * 解析条目 source（必须落在市场数据根内，防止目录文件被改成任意路径）。
   * @param source - 条目声明的相对路径。
   * @returns 源绝对路径。
   */
  private resolveSource(source: string): string {
    const root = resolve(this.runtime.dataDir)
    const target = resolve(root, source)
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`
    if (target !== root && !target.startsWith(prefix)) {
      throw new FrameworkError(404, 'MARKET_SOURCE_MISSING', `market source ${source} escapes the data directory`)
    }
    return target
  }

  /** 技能安装：条目 source 指向的目录/zip → 技能两阶段导入的确认落盘。 */
  private async installSkill(user: UserRow, entry: MarketCatalogRow): Promise<MarketInstallResult> {
    const sourcePath = this.resolveSource(entry.source)
    if (!existsSync(sourcePath)) {
      throw new FrameworkError(404, 'MARKET_SOURCE_MISSING', `market entry ${entry.id} source ${entry.source} does not exist`)
    }
    let archive: Uint8Array
    if (statSync(sourcePath).isDirectory()) {
      // 目录以包内相对路径直接入包（不加前缀）：落盘后技能根即 <用户技能目录>/<name>，
      // 与 SKILL.md frontmatter 的 name 一致，不产生多余嵌套层。
      const tree: Record<string, Uint8Array> = {}
      for (const file of walkFiles(sourcePath)) {
        const rel = relative(sourcePath, file).replace(/\\/g, '/')
        tree[rel] = new Uint8Array(readFileSync(file))
      }
      if (Object.keys(tree).length === 0) {
        throw new FrameworkError(404, 'MARKET_SOURCE_MISSING', `market entry ${entry.id} source directory ${entry.source} is empty`)
      }
      archive = zipSync(tree, { level: 6 })
    } else {
      archive = new Uint8Array(readFileSync(sourcePath))
    }
    // 落盘名以 SKILL.md frontmatter 为准：条目名与它不一致会出现「装了但列表里换了名字」。
    const preview = this.runtime.skills.previewImport(user.username, archive)
    if (preview.name !== entry.name) {
      throw new FrameworkError(409, 'MARKET_NAME_MISMATCH',
        `market entry ${entry.id} declares name ${entry.name}, but its SKILL.md declares ${preview.name}`)
    }
    // 判重也用落盘名（同一解析结果），并保留 importConfirmed 的存在性检查兜住并发。
    // 只按**本人**的行判重：公共技能同名不代表已安装（安装后是本人目录下的一份副本）。
    const existing = await this.db.prepare('SELECT id FROM skills_packages WHERE user_id = ? AND name = ?')
      .get<{ id: string }>(user.id, preview.name)
    if (existing !== undefined) {
      throw new FrameworkError(409, 'MARKET_ALREADY_INSTALLED',
        `skill ${preview.name} is already installed for user ${user.username} (skill ${existing.id})`)
    }
    const skill = await this.importSkillMapped(user, archive)
    return { id: entry.id, kind: 'skill', assetId: skill.id, name: skill.name }
  }

  /**
   * 走技能确认落盘，并把并发下的 `SKILL_EXISTS` 归一到市场语义。
   * @param user - 请求级用户。
   * @param archive - 技能包字节。
   * @returns 落库技能包行。
   */
  private async importSkillMapped(user: UserRow, archive: Uint8Array): Promise<SkillPackageView> {
    try {
      return await this.runtime.skills.importConfirmed(user.id, user.username, archive)
    } catch (error) {
      if (error instanceof FrameworkError && error.code === 'SKILL_EXISTS') {
        throw new FrameworkError(409, 'MARKET_ALREADY_INSTALLED',
          `skill from market entry is already installed for user ${user.username}`)
      }
      // 残留目录是本地异常状态，不是「已安装」：保留独立错误码，界面按它给出处置说明。
      if (error instanceof FrameworkError && error.code === 'SKILL_DIRECTORY_ORPHANED') {
        throw new FrameworkError(409, 'MARKET_DIRECTORY_ORPHANED', error.message)
      }
      throw error
    }
  }

  /** MCP 安装：条目 source 即传输配置来源，stdio/http 参数由条目自带。 */
  private async installMcp(user: UserRow, entry: MarketCatalogRow): Promise<MarketInstallResult> {
    const taken = await this.db.prepare('SELECT id, user_id FROM mcp_servers WHERE name = ?')
      .get<{ id: string; user_id: string | null }>(entry.name)
    if (taken !== undefined) {
      // 名称跨实例唯一（决定模型可见工具前缀），但「别人占用」不等于「你已安装」：
      // 两种状态给不同错误码，界面才能给出正确处置。
      if (taken.user_id !== user.id) {
        throw new FrameworkError(409, 'MCP_NAME_TAKEN',
          `mcp server name ${entry.name} is already registered by another user; pick a different name`)
      }
      throw new FrameworkError(409, 'MARKET_ALREADY_INSTALLED',
        `mcp server ${entry.name} is already registered (mcp server ${taken.id})`)
    }
    const base = {
      name: entry.name,
      description: entry.description,
      author: entry.author,
      tags: JSON.stringify(entry.tags),
      source_type: entry.source,
    }
    let created
    try {
      if (entry.http !== undefined) {
        created = await this.runtime.mcp.create(user.id, {
          ...base,
          transport_type: 'http',
          url: entry.http.url,
          ...entry.http.headers === undefined ? {} : { headers: JSON.stringify(entry.http.headers) },
          ...entry.http.timeout === undefined ? {} : { timeout: entry.http.timeout },
        })
      } else if (entry.stdio !== undefined) {
        created = await this.runtime.mcp.create(user.id, {
          ...base,
          transport_type: 'stdio',
          command: entry.stdio.command,
          ...entry.stdio.args === undefined ? {} : { args: JSON.stringify(entry.stdio.args) },
          ...entry.stdio.env === undefined ? {} : { env: JSON.stringify(entry.stdio.env) },
          ...entry.stdio.working_dir === undefined ? {} : { working_dir: entry.stdio.working_dir },
        })
      } else {
        throw new FrameworkError(422, 'MARKET_ENTRY_INVALID', `market entry ${entry.id} has no transport parameters`)
      }
    } catch (error) {
      // 并发安装同名 MCP：名称唯一约束的冲突归一到「已安装」；名称不合规是目录条目的问题。
      if (error instanceof FrameworkError && error.code === 'MCP_NAME_TAKEN') {
        throw new FrameworkError(409, 'MARKET_ALREADY_INSTALLED',
          `mcp server ${entry.name} is already registered`)
      }
      if (error instanceof FrameworkError && error.code === 'INVALID_MCP_NAME') {
        throw new FrameworkError(422, 'MARKET_ENTRY_INVALID', `market entry ${entry.id} name ${entry.name} is not a valid mcp server name`)
      }
      throw error
    }
    return { id: entry.id, kind: 'mcp', assetId: created.id, name: created.name }
  }
}

/** 递归列出目录下全部文件的绝对路径（排序稳定）。 */
function walkFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) visit(path)
      else out.push(path)
    }
  }
  visit(root)
  return out.sort()
}
