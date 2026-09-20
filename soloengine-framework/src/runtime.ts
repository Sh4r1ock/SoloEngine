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
import { SoloDatabase } from './db/index.ts'
import { MasterKey } from './crypto/index.ts'
import { TokenService } from './auth/index.ts'
import { AccountService } from './modules/accounts.ts'
import { LlmConfigService } from './modules/models.ts'
import { SkillService } from './modules/skills.ts'
import { McpService } from './modules/mcp.ts'
import { CanvasService } from './modules/canvas.ts'
import { RunService } from './modules/runs.ts'
import { MarketService } from './modules/market.ts'
import { PackagingService } from './modules/packaging.ts'
import { SessionExportService } from './modules/export.ts'
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
  /** 主密钥目录；默认 `<root>/data/home/keys`。 */
  keysDir?: string
  /** 数据根；默认 `<root>/data`。 */
  dataDir?: string
}

/** 框架层运行时：一次进程内唯一。 */
export class FrameworkRuntime {
  /** 业务库。 */
  readonly db: SoloDatabase
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
  /** 业务库文件路径（部署摘要如实报出它）。 */
  readonly databasePath: string
  /**
   * 部署地址（同一进程的 webServer 实际绑定值，由 host 插件在挂载时绑定——
   * 只读转发到服务 getter，故就绪后读到的永远是真实监听值）。
   * 未绑定时 `/deployment/guide` 以结构化错误拒绝，不给默认值。
   */
  deployment?: { readonly host: string; readonly port: number }
  /** 注册的 REST 路由描述表（供 `/api/solo/routes` 取证）。 */
  readonly routes: RouteDescriptor[]
  /** Express 应用（由 host 插件挂进 ctx.webServer）。 */
  readonly app: ReturnType<typeof createRouter>['app']
  /** 原生注入点（host 插件把 harness 侧能力挂进同一条 REST 前缀）。 */
  readonly mountAuthenticated: RouterBundle['mountAuthenticated']

  /**
   * @param options - 根目录与可选路径覆盖。
   */
  constructor(options: FrameworkOptions) {
    this.root = options.root
    this.dataDir = options.dataDir ?? join(options.root, 'data')
    const databasePath = options.databasePath ?? join(this.dataDir, 'database', 'soloengine.db')
    this.databasePath = databasePath
    const keysDir = options.keysDir ?? join(this.dataDir, 'home', 'keys')
    mkdirSync(this.dataDir, { recursive: true })

    this.masterKey = new MasterKey(join(keysDir, 'master.key'))
    this.db = new SoloDatabase({ path: databasePath })
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

  /** 关闭运行时（业务库连接）。 */
  close(): void {
    this.db.close()
  }
}
