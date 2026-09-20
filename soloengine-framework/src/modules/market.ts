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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { zipSync } from 'fflate'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError, type UserRow } from './accounts.ts'

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

/** 市场条目（目录文件的行形态）。 */
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
  installs: number
  /** 安装来源：技能为 data 根下的相对目录/zip；MCP 为传输配置来源串。 */
  source: string
  /** MCP stdio 传输参数（kind==='mcp' 且 stdio 传输时必填）。 */
  stdio?: MarketStdioTransport
  /** MCP http 传输参数（kind==='mcp' 且 http 传输时必填）。 */
  http?: MarketHttpTransport
}

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

/** 内置技能条目（4 条）+ 各自的 SKILL.md 正文。 */
const BUILTIN_SKILLS: {
  id: string
  name: string
  description: string
  tags: string[]
  categories: string[]
  featured: boolean
  installs: number
  body: string
}[] = [
  {
    id: 'skill-code-review',
    name: 'code-review',
    description: '按变更集审查代码：正确性、边界条件、可维护性与回归风险逐条给出证据。',
    tags: ['review', 'quality', 'diff'],
    categories: ['engineering'],
    featured: true,
    installs: 128,
    body: 'Review the requested change set. For each finding give file, line, the concrete risk and the smallest fix. Never invent code you did not read.',
  },
  {
    id: 'skill-commit-writer',
    name: 'commit-writer',
    description: '读取真实 diff 后撰写符合仓库风格的提交信息（说明「为什么」而非「改了什么」）。',
    tags: ['git', 'commit', 'workflow'],
    categories: ['engineering'],
    featured: true,
    installs: 96,
    body: 'Read the staged diff and the recent log, then write a commit message that follows the repository style and explains why the change exists.',
  },
  {
    id: 'skill-test-runner',
    name: 'test-runner',
    description: '定位并运行最小相关测试集合，回报真实输出与失败归因。',
    tags: ['test', 'ci', 'verification'],
    categories: ['engineering'],
    featured: false,
    installs: 64,
    body: 'Pick the smallest test set that covers the outgoing change, run it, and report the real output. Do not claim success without observed output.',
  },
  {
    id: 'skill-doc-writer',
    name: 'doc-writer',
    description: '为已有代码补齐面向读者的说明文档，只写代码中真实存在的行为。',
    tags: ['docs', 'writing'],
    categories: ['documentation'],
    featured: false,
    installs: 41,
    body: 'Document behaviour that exists in the code you read. Do not document imagined features or planned work.',
  },
]

/** 内置 MCP 条目（3 条）。 */
const BUILTIN_MCPS: MarketEntry[] = [
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
    installs: 210,
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
    installs: 157,
    source: 'npx -y @modelcontextprotocol/server-github',
    stdio: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    id: 'mcp-remote-http',
    kind: 'mcp',
    name: 'remote-http',
    version: '1.0.0',
    author: 'soloengine',
    description: 'HTTP 传输的远端 MCP 服务器（Streamable HTTP，JSON-RPC initialize 握手）。',
    tags: ['http', 'remote'],
    categories: ['tools'],
    featured: false,
    installs: 23,
    source: 'https://mcp.example.com/mcp',
    http: {
      url: 'https://mcp.example.com/mcp',
      timeout: 30,
    },
  },
]

/** 市场域服务。 */
export class MarketService {
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时（技能/MCP 服务与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
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
  private builtinEntries(): MarketEntry[] {
    const skills: MarketEntry[] = BUILTIN_SKILLS.map(skill => ({
      id: skill.id,
      kind: 'skill',
      name: skill.name,
      version: '1.0.0',
      author: 'soloengine',
      description: skill.description,
      tags: skill.tags,
      categories: skill.categories,
      featured: skill.featured,
      installs: skill.installs,
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
      writeFileSync(join(dir, 'SKILL.md'), frontmatter, 'utf8')
    }
    mkdirSync(join(this.runtime.dataDir, 'market'), { recursive: true })
    writeFileSync(catalogPath, `${JSON.stringify({ entries: this.builtinEntries() }, undefined, 2)}\n`, 'utf8')
  }

  /** 读取并校验目录（缺失即创建；损坏即报错，不静默清空）。 */
  private loadEntries(): MarketEntry[] {
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

  /** 逐列校验一条目录条目（非法即报错）。 */
  private assertEntry(raw: unknown, index: number): MarketEntry {
    const fail = (detail: string): never => {
      throw new FrameworkError(500, 'MARKET_CATALOG_INVALID', `market catalog entry #${String(index)} ${detail}`)
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object')
    const row = raw as Record<string, unknown>
    const text = (key: string): string => {
      const value = row[key]
      if (typeof value !== 'string' || value === '') fail(`is missing a non-empty string ${key}`)
      return value as string
    }
    const kind = row.kind
    if (kind !== 'skill' && kind !== 'mcp') fail('must declare kind skill|mcp')
    const strings = (key: string): string[] => {
      const value = row[key]
      if (!Array.isArray(value)) fail(`must declare a string array ${key}`)
      return (value as unknown[]).map(item => {
        if (typeof item !== 'string') fail(`has a non-string member in ${key}`)
        return item as string
      })
    }
    if (typeof row.featured !== 'boolean') fail('must declare a boolean featured')
    if (typeof row.installs !== 'number') fail('must declare a numeric installs')
    const entry: MarketEntry = {
      id: text('id'),
      kind: kind as MarketKind,
      name: text('name'),
      version: text('version'),
      author: text('author'),
      description: text('description'),
      tags: strings('tags'),
      categories: strings('categories'),
      featured: row.featured as boolean,
      installs: row.installs as number,
      source: text('source'),
    }
    if (entry.kind === 'mcp') {
      const stdio = row.stdio
      const http = row.http
      if (stdio !== undefined && stdio !== null && typeof stdio === 'object' && !Array.isArray(stdio)) {
        const config = stdio as Record<string, unknown>
        if (typeof config.command !== 'string' || config.command === '') fail('has an mcp stdio block without a command')
        const block: MarketStdioTransport = { command: config.command as string }
        if (Array.isArray(config.args)) block.args = (config.args as unknown[]).map(item => String(item))
        if (config.env !== undefined && config.env !== null && typeof config.env === 'object' && !Array.isArray(config.env)) {
          const env: Record<string, string> = {}
          for (const [key, value] of Object.entries(config.env as Record<string, unknown>)) env[key] = String(value)
          block.env = env
        }
        if (typeof config.working_dir === 'string') block.working_dir = config.working_dir
        entry.stdio = block
      }
      if (http !== undefined && http !== null && typeof http === 'object' && !Array.isArray(http)) {
        const config = http as Record<string, unknown>
        if (typeof config.url !== 'string' || config.url === '') fail('has an mcp http block without a url')
        const block: MarketHttpTransport = { url: config.url as string }
        if (config.headers !== undefined && config.headers !== null && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(config.headers as Record<string, unknown>)) headers[key] = String(value)
          block.headers = headers
        }
        if (typeof config.timeout === 'number') block.timeout = config.timeout
        entry.http = block
      }
      if (entry.stdio === undefined && entry.http === undefined) {
        fail('is an mcp entry without stdio or http transport parameters')
      }
    }
    return entry
  }

  /**
   * 列目录（kind/q/category/sort/featured 过滤与排序）。
   * @param query - 原始 query 参数。
   * @returns 条目与总数。
   */
  list(query: MarketQuery): { entries: MarketEntry[]; total: number } {
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

    const entries = this.loadEntries().filter(entry => {
      if (kind !== undefined && kind !== '' && entry.kind !== kind) return false
      if (featuredRaw === 'true' && !entry.featured) return false
      if (featuredRaw === 'false' && entry.featured) return false
      if (category !== '' && !entry.categories.some(item => item.toLowerCase() === category)) return false
      if (keyword !== '') {
        const haystack = [entry.name, entry.description, ...entry.tags].join(' ').toLowerCase()
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
    return { entries, total: entries.length }
  }

  /**
   * 安装一条目录条目（复用既有管线：技能两阶段导入的确认落盘 / MCP 注册）。
   * @param user - 请求级用户。
   * @param entryId - 条目 ID。
   * @returns 落库资产。
   */
  install(user: UserRow, entryId: string): MarketInstallResult {
    const entry = this.loadEntries().find(candidate => candidate.id === entryId)
    if (entry === undefined) {
      throw new FrameworkError(404, 'MARKET_ENTRY_NOT_FOUND', `market entry ${entryId} not found`)
    }
    if (entry.kind === 'skill') return this.installSkill(user, entry)
    return this.installMcp(user, entry)
  }

  /** 技能安装：条目 source 指向的目录/zip → 技能两阶段导入的确认落盘。 */
  private installSkill(user: UserRow, entry: MarketEntry): MarketInstallResult {
    const existing = this.runtime.skills.list(user.id).find(row => row.name === entry.name)
    if (existing !== undefined) {
      throw new FrameworkError(409, 'MARKET_ALREADY_INSTALLED',
        `skill ${entry.name} is already installed for user ${user.username} (skill ${existing.id})`)
    }
    const sourcePath = resolve(this.runtime.dataDir, entry.source)
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
    const skill = this.runtime.skills.importConfirmed(user.id, user.username, archive)
    return { id: entry.id, kind: 'skill', assetId: skill.id, name: skill.name }
  }

  /** MCP 安装：条目 source 即传输配置来源，stdio/http 参数由条目自带。 */
  private installMcp(user: UserRow, entry: MarketEntry): MarketInstallResult {
    const taken = this.runtime.db.raw.prepare('SELECT id FROM mcp_servers WHERE name = ?')
      .get(entry.name) as { id: string } | undefined
    if (taken !== undefined) {
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
    if (entry.http !== undefined) {
      created = this.runtime.mcp.create(user.id, {
        ...base,
        transport_type: 'http',
        url: entry.http.url,
        ...entry.http.headers === undefined ? {} : { headers: JSON.stringify(entry.http.headers) },
        ...entry.http.timeout === undefined ? {} : { timeout: entry.http.timeout },
      })
    } else if (entry.stdio !== undefined) {
      created = this.runtime.mcp.create(user.id, {
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
