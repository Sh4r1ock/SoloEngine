/**
 * SoloEngine 框架层运行时：拥有业务库、主密钥、令牌服务与全部业务模块。
 *
 * 形态纪律（PRD-01 FR-ARCH-003）：本模块是普通 TS 模块，**不注册进 cordis 插件树**；
 * 它只被 `@soloengine/host` 挂载进 dsh 的 `ctx.webServer`（同进程、同 HTTP 服务）。
 *
 * @module @soloengine/framework/runtime
 */

import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { SoloDatabase, openBusinessDatabase, resolveDatabaseForm, type BusinessDatabase } from './db/index.ts'
import { MasterKey, MasterKeyError } from './crypto/index.ts'
import { TokenService } from './auth/index.ts'
import { AccountService } from './modules/accounts.ts'
import { LlmConfigService } from './modules/models.ts'
import { SkillService } from './modules/skills.ts'
import { McpService } from './modules/mcp.ts'
import { CanvasService } from './modules/canvas.ts'
import { RunService } from './modules/runs.ts'
import { MarketService } from './modules/market.ts'
import { PackagingService } from './modules/packaging.ts'
import { SessionExportService, type SessionLogSource } from './modules/export.ts'
import { PluginService } from './modules/plugins.ts'
import { WorkspaceService } from './modules/workspace.ts'
import { ChangeLedgerService } from './modules/changes.ts'
import { createRouter, type RouteDescriptor, type RouterBundle } from './modules/router.ts'
import { UserDirectoryService } from './tenancy.ts'

/** 框架层运行时参数。 */
export interface FrameworkOptions {
  /** 仓库/实例根目录（决定 data/ 的落点）。 */
  root: string
  /** 业务库文件路径；默认 `<root>/data/database/soloengine.db`。 */
  databasePath?: string
  /** 数据库形态；省略时读 `SOLOENGINE_DB_FORM`（缺省 single）。 */
  databaseForm?: 'single' | 'cloud'
  /** PostgreSQL 连接串；云形态省略时读 `SOLOENGINE_DATABASE_URL`。 */
  databaseUrl?: string
  /** 主密钥目录；默认 `<root>/data/home/keys`。 */
  keysDir?: string
  /** 数据根；默认 `<root>/data`。 */
  dataDir?: string
  /**
   * 启动器给的 profile 目录（产物/桌面形态里是 `$DSH_HOME/profiles/<名字>`）。
   * 省略时取 `<dataDir>/dsh-home/profiles/soloengine`（仓库检出的实例布局）。
   */
  profileDir?: string
  /**
   * 执行形态（`SOLOENGINE_EXECUTOR`）：`local` 在宿主进程执行，`container` / `microvm` /
   * `full-vm` 在每会话隔离环境执行（容器镜像或 guest OS 是执行世界）。画布编译把
   * `run_command` 映射到执行世界的命令工具，因此该事实必须由部署给出，不能取宿主 `process.platform`。
   */
  executor?: 'local' | 'container' | 'microvm' | 'full-vm'
}

/** 框架层运行时：一次进程内唯一。 */
export class FrameworkRuntime {
  /** 业务库（部署形态可切换的连接端口；单机为 SQLite 实现）。 */
  readonly db: BusinessDatabase
  /** 主密钥（缺失时首次生成；非法/长度错阻断启动）。 */
  readonly masterKey: MasterKey
  /** 令牌服务。 */
  readonly tokens: TokenService
  /** 账号域服务（注册/登录/资料/启停/超管/种子）。 */
  readonly accounts: AccountService
  /** 模型配置服务（密钥加密/掩码/连通测试/默认互斥）。 */
  readonly models: LlmConfigService
  /** 技能服务（两阶段导入防穿越/文件编辑/启停）。 */
  readonly skills: SkillService
  /** MCP 服务器服务（三表/枚举/试运行/热挂载翻译）。 */
  readonly mcp: McpService
  /** 画布与运行项目服务（含项目沙箱根门禁）。 */
  readonly canvas: CanvasService
  /** 运行域服务（编译 / 归属台账 / 用量派生 / 创造模式审计）。 */
  readonly runs: RunService
  /** 市场域服务（技能/MCP 目录与安装）。 */
  readonly market: MarketService
  /** 打包与部署域服务（编译预览 / 产物落盘与读回 / 部署指引）。 */
  readonly packaging: PackagingService
  /** 会话导出域服务（日志文件与归属行的清单/ZIP）。 */
  readonly sessionExport: SessionExportService
  /** 组合与插件清单域服务。 */
  readonly plugins: PluginService
  /** 工作区文件域服务（人写入走产品自己的接口 + 沙箱根约束）。 */
  readonly workspace: WorkspaceService
  /** 文件变更台账域服务（读路径；写路径在阶段 7 落地到同一模块）。 */
  readonly changes: ChangeLedgerService
  /** 用户目录隔离服务（三层隔离的第 2 层）。 */
  readonly userDirs: UserDirectoryService
  /** 实例根目录（`data/` 的父级；组合层与 packages/ 的定位基准）。 */
  readonly root: string
  /** 数据根（用户目录/技能目录/项目目录的父级）。 */
  readonly dataDir: string
  /** 当前运行面的 profile 目录（组合清单与 patch 层的真源）。 */
  readonly profileDir: string
  /** 业务库文件路径（部署摘要如实报出它）。 */
  readonly databasePath: string
  /**
   * 执行世界的平台：`container` 形态的执行世界是容器镜像（Linux），其余为宿主平台。
   * 画布编译据此把 `run_command` 映射到真实存在的命令工具。
   */
  readonly executionPlatform: NodeJS.Platform
  /** 数据库形态（single/cloud）；决定项目目录的租户边界。 */
  readonly databaseForm: 'single' | 'cloud'
  /**
   * 部署摘要（同一进程的真实运行值，由 host 插件在挂载时绑定——只读转发到服务 getter，
   * 故就绪后读到的永远是真实监听值与真实启动参数）。
   * 未绑定时 `/deployment/guide` 以结构化错误拒绝，不给默认值。
   */
  deployment?: {
    readonly host: string
    readonly port: number
    /** 连接层信任域的声明主机（`--trusted-host`，与 Host/Origin 围栏同一份）。 */
    readonly trustedHosts: readonly string[]
  }
  /**
   * harness 实时注册的工具名（画布工具多选的同一份数据源，FR-CANVAS-014）。
   * 由 host 插件在驱动就绪时绑定；未绑定时画布编译只接受编译器词汇表（无 host 的形态）。
   */
  toolVocabulary: (() => readonly string[]) | undefined = undefined
  /**
   * 会话日志只读来源（`ctx.sessionPersistence`，由 host 在挂载时绑定）。
   * 未绑定时会话导出退回 JSONL 目录扫描——那只是旧形态，不是默认通路。
   */
  sessionLogSource: SessionLogSource | undefined = undefined
  /**
   * 浏览器会话用户绑定（host 挂载时接到 Connection 载体的签名 cookie 上）。
   *
   * 登录成功时把该账号写进浏览器 cookie：原生 RPC 的会话归属判定据此知道
   * 「当前连接属于谁」。未绑定时（直接构造运行时的单测/脚本形态）不写 cookie。
   * @param request - 登录请求（只读请求头：Host/Origin 与既有 cookie 由此读取）。
   * @param response - 承接续签 cookie 的响应。
   * @param userId - 登录已证实的账号 id。
   * @returns 是否写入了 cookie。
   */
  bindBrowserUser?: (
    request: { readonly headers: Readonly<Record<string, string | readonly string[] | undefined>> },
    response: { setHeader(name: string, value: string): unknown },
    userId: string,
  ) => boolean
  /** 注册的 REST 路由描述表（供 `/api/solo/routes` 取证）。 */
  readonly routes: RouteDescriptor[]
  /** Express 应用（由 host 插件挂进 ctx.webServer）。 */
  readonly app: ReturnType<typeof createRouter>['app']
  /** 原生注入点（host 插件把 harness 侧能力挂进同一条 REST 前缀）。 */
  readonly mountAuthenticated: RouterBundle['mountAuthenticated']

  /**
   * 打开业务库并构造运行时（云形态需要异步打开 PostgreSQL）。
   * @param options - 根目录与可选路径覆盖。
   * @returns 已就绪的运行时。
   */
  static async create(options: FrameworkOptions): Promise<FrameworkRuntime> {
    const dataDir = options.dataDir ?? join(options.root, 'data')
    const databasePath = options.databasePath ?? join(dataDir, 'database', 'soloengine.db')
    const db = await openBusinessDatabase({
      path: databasePath,
      ...(options.databaseForm === undefined ? {} : { form: options.databaseForm }),
      ...(options.databaseUrl === undefined ? {} : { url: options.databaseUrl }),
    })
    return new FrameworkRuntime(options, db)
  }

  /**
   * @param options - 根目录与可选路径覆盖。
   * @param db - 已打开的业务库；省略时按单机 SQLite 打开。
   */
  constructor(options: FrameworkOptions, db?: BusinessDatabase) {
    this.root = options.root
    this.dataDir = options.dataDir ?? join(options.root, 'data')
    this.profileDir = options.profileDir ?? join(this.dataDir, 'dsh-home', 'profiles', 'soloengine')
    const databasePath = options.databasePath ?? join(this.dataDir, 'database', 'soloengine.db')
    this.databasePath = databasePath
    // 与 `openBusinessDatabase` 同一判据（含 `SOLOENGINE_DB_FORM`）：形态决定项目目录的租户边界，
    // 只读显式配置会让「环境变量配置的云节点」按单机规则放行任意宿主机目录。
    this.databaseForm = resolveDatabaseForm(options.databaseForm)
    this.executionPlatform = (options.executor ?? 'local') === 'local' ? process.platform : 'linux'
    const keysDir = options.keysDir ?? join(this.dataDir, 'home', 'keys')
    mkdirSync(this.dataDir, { recursive: true })

    try {
      this.masterKey = new MasterKey(join(keysDir, 'master.key'))
    } catch (error) {
      // 启动自检把类别写明（invalid / length），不把「密钥坏了」笼统报成打开失败。
      if (error instanceof MasterKeyError) {
        console.log(`soloengine: master key ${error.kind} — ${error.message}`)
      }
      throw error
    }
    this.db = db ?? new SoloDatabase({ path: databasePath })
    this.tokens = new TokenService(this.masterKey)
    this.userDirs = new UserDirectoryService(this.dataDir)
    this.accounts = new AccountService(this)
    this.models = new LlmConfigService(this)
    this.skills = new SkillService(this)
    this.mcp = new McpService(this)
    this.canvas = new CanvasService(this)
    this.runs = new RunService(this)
    this.market = new MarketService(this)
    this.packaging = new PackagingService(this)
    this.sessionExport = new SessionExportService(this)
    this.plugins = new PluginService(this)
    this.workspace = new WorkspaceService(this)
    this.changes = new ChangeLedgerService(this)

    const router = createRouter(this)
    this.app = router.app
    this.routes = router.routes
    this.mountAuthenticated = router.mountAuthenticated
  }

  /**
   * 绑定/解绑会话日志只读来源（host 挂载时把 `ctx.sessionPersistence` 接进来）。
   * @param source - 持久化会话日志来源；`undefined` 表示卸载。
   */
  bindSessionLogSource(source: SessionLogSource | undefined): void {
    this.sessionLogSource = source
  }

  /** 关闭运行时（业务库连接）。 */
  async close(): Promise<void> {
    await this.db.close()
  }
}
