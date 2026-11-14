/** Non-default package roles retained outside the experimental group. */

/** Product role that does not require a default runtime mount. */
export type ProductPackageCategory = 'optional' | 'sdk' | 'build' | 'test' | 'web-distribution' | 'declarations'

/** One explicitly maintained package role and its reason. */
export interface ProductPackagePolicy {
  /** Why this package remains outside the experimental group. */
  readonly reason: string
  /** The supported product role checked against its directory. */
  readonly category: ProductPackageCategory
}

/**
 * Exceptions to default runtime reachability, keyed by repository-relative package directory.
 * Optional integrations may be reached by an optional bundle without becoming default capabilities.
 */
export const PRODUCT_PACKAGE_POLICY: Readonly<Record<string, ProductPackagePolicy>> = {
  'packages/lsp/lsp': { category: 'optional', reason: 'Service definition for deployment-configured language servers.' },
  'packages/lsp/lsp-stdio': { category: 'optional', reason: 'Requires an explicit server list and language-server executables.' },
  'packages/lsp/tool-lsp': { category: 'optional', reason: 'Model tools selected together with a configured LSP provider.' },
  'packages/storage/storage-sqlite': { category: 'optional', reason: 'Persistent storage requires an explicit database path and backend selection.' },
  'packages/context/tmux-context': { category: 'optional', reason: 'Context contribution requiring a tmux pane.' },
  'packages/fs/tool-str-replace-editor': { category: 'optional', reason: 'Explicit alternative to the default filesystem editing tools.' },
  // Product surfaces mounted by the SoloEngine composition rather than a shipped DSH profile.
  'packages/mcp/mcp-client': { category: 'optional', reason: 'Connector mounted by the SoloEngine MCP host at runtime.' },
  'packages/skill/skill-office': { category: 'optional', reason: 'Office skill provider selected by the SoloEngine product composition.' },
  'packages/skill/tool-workspace-dependencies': { category: 'optional', reason: 'Workspace dependency tool selected by the SoloEngine product composition.' },
  'packages/util/plugin-market-index': { category: 'optional', reason: 'Index reader used by the plugin market service and its client surface.' },
  'packages/soloengine/agent-compiler': { category: 'optional', reason: 'Compiled into the SoloEngine agent runtime; no default DSH profile mounts it.' },
  'packages/soloengine/browser-proxy': { category: 'optional', reason: 'Mounted by the SoloEngine product composition.' },
  'packages/soloengine/business-db-postgres': { category: 'optional', reason: 'Cloud database form selected by SOLOENGINE_DB_FORM=cloud; not mounted in the single-node default.' },
  'packages/soloengine/cloud-control': { category: 'optional', reason: 'Cloud control plane mounted only by the cloud deployment form.' },
  'packages/soloengine/cloud-control-postgres': { category: 'optional', reason: 'Cloud control-plane store used only by the cloud deployment form.' },
  'packages/soloengine/egress-proxy': { category: 'optional', reason: 'Browser egress-policy executable launched by the product proxy; never imported by product source.' },
  'packages/soloengine/client-bootstrap': { category: 'optional', reason: 'Boots the SoloEngine product client tree.' },
  'packages/soloengine/executor-container': { category: 'optional', reason: 'Container execution backend selected by the cloud deployment form; the single-node default executes in-process.' },
  'packages/soloengine/executor-vm': { category: 'optional', reason: 'Full-VM execution backend selected by SOLOENGINE_EXECUTOR=full-vm; the single-node default executes in-process.' },
  'packages/soloengine/image-distribution': { category: 'optional', reason: 'Node image cache and content-addressed workspace store used only by the cloud deployment form.' },
  'packages/soloengine/host': { category: 'optional', reason: 'SoloEngine composition layer mounted by the product profile.' },
  'packages/soloengine/instance-runtime': { category: 'optional', reason: 'Per-flow harness assembly mounted by the SoloEngine host.' },
  'packages/soloengine/llm-db-adapter': { category: 'optional', reason: 'Model route adapter mounted by the SoloEngine host.' },
  'packages/soloengine/open-preview': { category: 'optional', reason: 'Preview surface mounted by the SoloEngine composition.' },
  'packages/soloengine/sandbox-container': { category: 'optional', reason: 'Container sandbox backend selected by the container execution form.' },
  'packages/soloengine/session-persistence-sqlite': { category: 'optional', reason: 'Session log provider selected by the single-node composition patch; product source never imports it.' },
  'packages/soloengine/session-persistence-postgres': { category: 'optional', reason: 'Session log provider for the cloud database form; the single-node default writes the same tables in the SQLite business database.' },
  'packages/soloengine/session-query-postgres': { category: 'optional', reason: 'Session query provider for the cloud database form; the single-node default uses the SQLite provider.' },
  'packages/soloengine/subprocess-container': { category: 'optional', reason: 'Container/microVM execution backend selected by SOLOENGINE_EXECUTOR=container|microvm; not mounted in the single-node default.' },
  'packages/soloengine/storage-postgres': { category: 'optional', reason: 'Key-value backend for the cloud database form; the single-node default uses the SQLite backend.' },
  'packages/soloengine/tools': { category: 'optional', reason: 'Product tools contributed by the SoloEngine host.' },
  'packages/soloengine/ui-conversation': { category: 'optional', reason: 'Product conversation surface mounted by the SoloEngine client composition.' },
  'packages/soloengine/ui-document-editor': { category: 'optional', reason: 'Product document editor mounted by the SoloEngine client composition.' },
  'packages/soloengine/ui-operation-area': { category: 'optional', reason: 'Product operation area mounted by the SoloEngine client composition.' },
  'packages/typert/generator': { category: 'build', reason: 'Build-time generation of type metadata.' },
  'packages/test-support/agent-loop-testkit': { category: 'test', reason: 'Published agent-loop test harness.' },
  'packages/test-support/client-runtime': { category: 'test', reason: 'Published browser plugin test harness.' },
  'packages/test-support/llm-mock-server': { category: 'test', reason: 'Published model-provider test server.' },
  'packages/test-support/llm-replay': { category: 'test', reason: 'Published recorded-model replay harness.' },
  'packages/test-support/loader-smoke': { category: 'test', reason: 'Published plugin Loader smoke-test harness.' },
  'packages/test-support/remote-mock': { category: 'test', reason: 'Published typed Remote test proxies.' },
  'packages/test-support/session-snapshot': { category: 'test', reason: 'Published Session snapshot replay harness.' },
  'packages/client/web': { category: 'web-distribution', reason: 'Browser boot kernel bundled into the Web distribution.' },
  'packages/client/ui-dockkit': { category: 'web-distribution', reason: 'Layout library bundled into the Web distribution.' },
  'packages/util/package-manifest': { category: 'declarations', reason: 'Shared package metadata declarations have no runtime mount.' },
}
