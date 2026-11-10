/**
 * SoloEngine 框架层入口（供 `@soloengine/host` 消费）。
 * @module @soloengine/framework
 */

export { SoloDatabase, BUSINESS_TABLES, type DatabaseEnvironment, type DatabaseOptions } from './db/index.ts'
export { FRAMEWORK_VERSION } from './version.ts'
export { MasterKey, MasterKeyError, encryptSecret, decryptSecret, maskSecret, safeEqual, MASTER_KEY_BYTES } from './crypto/index.ts'
export { hashPassword, verifyPassword, TokenService, newId, newUserId, type TokenPayload } from './auth/index.ts'
export { FrameworkRuntime, type FrameworkOptions } from './runtime.ts'
export { AccountService, FrameworkError, toView, type UserRow, type UserView } from './modules/accounts.ts'
export { createRouter, type RouteDescriptor, type RouterBundle } from './modules/router.ts'
export { CHANGES_OPS, WORKSPACE_OPS, type OpsInput, type OpsOutcome, type OpsRoute } from './modules/ops.ts'
export {
  LlmConfigService, classifyHttpFailure,
  type LlmConfigRow, type LlmConfigView, type LlmConfigInput,
  type ConnectivityResult, type ConnectivityFailureKind,
} from './modules/models.ts'
export { UserDirectoryService, safeDirectoryName } from './tenancy.ts'
export {
  SkillService,
  type SkillPackageRow, type SkillPackageView, type SkillMetadata,
  type SkillImportPreview, type SkillFileEntry, type SkillPreviewFile,
} from './modules/skills.ts'
export {
  McpService, MCP_NAME_PATTERN,
  type McpServerRow, type McpServerView, type McpStdioRow, type McpHttpRow, type McpServerInput,
  type McpToolInfo, type McpResourceInfo, type McpTestResult, type McpFailureKind,
} from './modules/mcp.ts'
export {
  CanvasService,
  type CanvasNode, type CanvasEdge, type CanvasSettings, type CanvasData,
  type CanvasRow, type CanvasView, type RunProjectRow,
} from './modules/canvas.ts'
export {
  RunService,
  type RunDriver, type RunStartInput, type RunSessionView, type UsageRow,
} from './modules/runs.ts'
export { SessionLedger, type SessionLedgerRow, type EventLedgerRow } from './modules/sessions.ts'
export {
  MarketService,
  type MarketEntry, type MarketKind, type MarketQuery, type MarketInstallResult,
  type MarketStdioTransport, type MarketHttpTransport,
} from './modules/market.ts'
export {
  PackagingService,
  type PackagingPreview, type PackagingRun, type PackagingStage, type PackagingLayer, type DeploymentGuide,
  type PackagingDesktop, type PackagingDesktopOptions,
} from './modules/packaging.ts'
export {
  SessionExportService, type SessionExportManifest, type SessionLogReadHandle, type SessionLogSource,
} from './modules/export.ts'
export {
  PluginService, type PluginRow, type LivePluginRow, type PluginInventorySource,
  type UnresolvedPluginRow, type PluginBundleCount,
  type ManagedBundleRow, type ManagedChangeResult, type ManagedInspection, type PluginManagerSource,
} from './modules/plugins.ts'
export { parsePatchDocument, isJsExpression, type PatchRow, type JsExpression } from './cordis-patch.ts'
export {
  buildClosureManifest, closureCredentialHits, materializeDependencies, measureNodeModules, packageResolver,
  rootPackageName, verifyClosureManifest, writeClosureManifest,
  type ClosureManifest, type ClosurePackage, type MaterializedDependencies, type MaterializedPackage, type PackageResolver,
} from './modules/packaging-assets.ts'
export {
  WorkspaceService,
  type WorkspaceEntry, type WorkspaceListing, type WorkspaceText, type WorkspaceStat, type WorkspaceWriteResult,
} from './modules/workspace.ts'
export {
  ChangeLedgerService,
  type ChangeHunk, type ChangeOperation, type ChangeOrigin, type ChangeStatus, type ChangeQuery,
  type ChangeRecordInput, type FileChangeView, type ReviewInput, type RevertPlan, type RevertRestore, type RevertSkip,
  type RevertExecutionInput, type RevertExecutionResult, type TurnViewEntry,
} from './modules/changes.ts'
export { gateWorkspacePath, isLoopback, type WorkspaceGateOptions, type WorkspaceGateResult } from './sandbox/workspace-gate.ts'
