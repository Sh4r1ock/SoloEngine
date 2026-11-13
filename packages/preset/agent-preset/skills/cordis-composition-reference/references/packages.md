# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## api

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@deepseek-ai/dsh-api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@deepseek-ai/dsh-api-remote-access` | no | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot |
| `@deepseek-ai/dsh-api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@deepseek-ai/dsh-api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@deepseek-ai/dsh-api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@deepseek-ai/dsh-api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@deepseek-ai/dsh-api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@deepseek-ai/dsh-api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, live metadata, and workspace-confined human mutations over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-attachment-local` | yes | Private content-addressed DSH_HOME attachment storage |

## boot

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@deepseek-ai/dsh-hmr` | yes | Coordinated module and profile configuration hot reload |
| `@deepseek-ai/dsh-plugin-manager` | yes | Current-profile plugin and bundle management shared by dsh CLI, Web and agent tools |
| `@deepseek-ai/dsh-plugin-market` | yes | Configured plugin market indexes for the Web Discover page and the plugin_market agent tool |

## bundle

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-headless` | yes | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |
| `@deepseek-ai/dsh-web-app` | yes | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist serving, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@deepseek-ai/dsh-client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@deepseek-ai/dsh-client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@deepseek-ai/dsh-client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@deepseek-ai/dsh-client-modules` | no | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@deepseek-ai/dsh-client-product-analytics` | yes | Desktop product event collection and authenticated Host reporting |
| `@deepseek-ai/dsh-client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@deepseek-ai/dsh-client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@deepseek-ai/dsh-client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@deepseek-ai/dsh-client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@deepseek-ai/dsh-client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@deepseek-ai/dsh-client-ui-brand-official` | no | Official DeepSeek Harness brand occupants for the Web client's sidebar slots |
| `@deepseek-ai/dsh-client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@deepseek-ai/dsh-client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@deepseek-ai/dsh-client-ui-context-menu` | no | Typed, plugin-extensible context menus with captured targets and shared Web presentation |
| `@deepseek-ai/dsh-client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` | no | Temporary 1017 release badge for official DeepSeek Flash model labels |
| `@deepseek-ai/dsh-client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@deepseek-ai/dsh-client-ui-file-actions` | no | Original-file saving and image clipboard actions for Web and Desktop |
| `@deepseek-ai/dsh-client-ui-file-drag` | no | Application-owned file drag transfers and localized failure feedback |
| `@deepseek-ai/dsh-client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@deepseek-ai/dsh-client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@deepseek-ai/dsh-client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@deepseek-ai/dsh-client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@deepseek-ai/dsh-client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@deepseek-ai/dsh-client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@deepseek-ai/dsh-client-ui-open-in-app` | no | Web "Open In..." controls: the Session-header split button opening the workspace directory in an installed application, and the document preview's default-application controls for one file |
| `@deepseek-ai/dsh-client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@deepseek-ai/dsh-client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@deepseek-ai/dsh-client-ui-plugin-manager` | yes | Plugin management for the dsh web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@deepseek-ai/dsh-client-ui-reference` | no | Unified Web @file and @session reference source |
| `@deepseek-ai/dsh-client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@deepseek-ai/dsh-client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@deepseek-ai/dsh-client-ui-secret-mask` | no | Web display masking for recognized credentials in sent user text |
| `@deepseek-ai/dsh-client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@deepseek-ai/dsh-client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@deepseek-ai/dsh-client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@deepseek-ai/dsh-client-ui-settings-agent-loop` | no | Settings page of the agent loop on the dsh web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@deepseek-ai/dsh-client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@deepseek-ai/dsh-client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | no | Built-in plugins settings section for the dsh web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@deepseek-ai/dsh-client-ui-settings-session-log` | no | General settings control for Session-log upload with DeepSeek API requests |
| `@deepseek-ai/dsh-client-ui-settings-shell` | no | Settings page of the shell executor on the dsh web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@deepseek-ai/dsh-client-ui-settings-subagent` | no | Settings page of Subagent delegation on the dsh web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@deepseek-ai/dsh-client-ui-settings-web-search` | no | Settings page of the DeepSeek web-search provider on the dsh web client's Plugins page: its API key, endpoint, and per-request search budget |
| `@deepseek-ai/dsh-client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@deepseek-ai/dsh-client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@deepseek-ai/dsh-client-ui-sidebar-browser` | yes | Sandboxed Web browser tabs for the right Sidebar |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@deepseek-ai/dsh-client-ui-sidebar-files` | no | Workspace file tree tab type for the right Sidebar: lazy directory listing over the workspaceFiles Remote namespace, opening files into the Sidebar |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@deepseek-ai/dsh-client-ui-sidebar-terminal` | no | Line-oriented agent terminal tabs for the right Sidebar: attaches to the Session's platform terminals |
| `@deepseek-ai/dsh-client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@deepseek-ai/dsh-client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@deepseek-ai/dsh-client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; DOM-free ThemeRuntime for light/dark/system state; --dsw-* token styles and Appearance settings row |
| `@deepseek-ai/dsh-client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@deepseek-ai/dsh-client-ui-trajectory` | yes | Trajectory event ledger with an interactive timing overview: pure-consumer plugin registering into the conversation ViewMap (no service) |
| `@deepseek-ai/dsh-client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@deepseek-ai/dsh-client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for dsh web |
| `@deepseek-ai/dsh-client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## compaction

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-compact` | no | Human-facing slash command for explicit session compaction |
| `@deepseek-ai/dsh-compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## context

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@deepseek-ai/dsh-file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@deepseek-ai/dsh-harness-dev-context` | no | Model context naming the DeepSeek Harness checkout and Web GUI URL without letting either change the system prompt |
| `@deepseek-ai/dsh-session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@deepseek-ai/dsh-time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@deepseek-ai/dsh-tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent` | no | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@deepseek-ai/dsh-agent-loop` | yes | The concrete agent loop plugin for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-tool-presentation` | yes | Deprecated tool presentation selector; use dsh-tool-executor-native or dsh-tool-executor-ptc directly |
| `@deepseek-ai/dsh-session` | no | Event-sourced session store for the DeepSeek Harness |
| `@deepseek-ai/dsh-system-prompt` | yes | System prompt assembly registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-executor-native` | no | Native tool execution plugin |
| `@deepseek-ai/dsh-tool-executor-ptc` | yes | PTC program execution, tool bindings, and generated SDK prompts |
| `@deepseek-ai/dsh-tools` | no | Tool registry and execution pipeline for the DeepSeek Harness |

## credentials

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@deepseek-ai/dsh-credentials-local` | yes | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the DeepSeek Harness |
| `@deepseek-ai/dsh-deepseek-account` | yes | Read account state and resolve official API credentials |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-present` | yes | Explicit workspace file delivery declarations for the DeepSeek Harness |
| `@deepseek-ai/dsh-workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for the DeepSeek Harness |

## document

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-office-kit` | yes | Shared Office rendering, conversion, and recalculation with bounded queues and caching |
| `@deepseek-ai/dsh-office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |

## experimental

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@deepseek-ai/dsh-tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |

## extensions

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@deepseek-ai/dsh-cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@deepseek-ai/dsh-cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@deepseek-ai/dsh-tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@deepseek-ai/dsh-message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-fs-local` | yes | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-fs-observation-policy` | no | File-context policy plugin for the DeepSeek Harness — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@deepseek-ai/dsh-fs-sandbox` | yes | Sandbox-enforcing implementation of the DeepSeek Harness filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@deepseek-ai/dsh-tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@deepseek-ai/dsh-tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## goal

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@deepseek-ai/dsh-goal` | yes | Event-sourced same-session goal state and lifecycle service for the DeepSeek Harness |
| `@deepseek-ai/dsh-goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@deepseek-ai/dsh-tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## host

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@deepseek-ai/dsh-host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@deepseek-ai/dsh-host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@deepseek-ai/dsh-host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@deepseek-ai/dsh-host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@deepseek-ai/dsh-host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts |

## interaction

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-commands` | no | Plugin-owned human command registry for DeepSeek Harness UIs |
| `@deepseek-ai/dsh-permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the DeepSeek Harness: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@deepseek-ai/dsh-tool-ask-user` | yes | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@deepseek-ai/dsh-user-approval` | yes | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@deepseek-ai/dsh-user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-jobs-local` | yes | Process-local implementation of the DeepSeek Harness background job registry seam |
| `@deepseek-ai/dsh-tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## llm

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-deepseek-llm-api-extensions` | no | Additive request-field registry for the official DeepSeek LLM API adapter |
| `@deepseek-ai/dsh-llm` | no | Provider-neutral LLM service interface for the DeepSeek Harness |
| `@deepseek-ai/dsh-llm-deepseek-account` | yes | DeepSeek account provider authentication and discovery |
| `@deepseek-ai/dsh-llm-deepseek-api-key` | yes | DeepSeek api-key provider authentication and discovery |
| `@deepseek-ai/dsh-llm-pi-ai` | yes | pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek) |
| `@deepseek-ai/dsh-llm-retry` | yes | Provider-routed LLM request retry policy for the DeepSeek Harness |
| `@deepseek-ai/dsh-plugin-package-inventory-deepseek` | yes | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |
| `@deepseek-ai/dsh-token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for the DeepSeek Harness |

## lsp

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-lsp` | no | Abstract LSP capability seam (ctx.lsp) for the DeepSeek Harness — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@deepseek-ai/dsh-lsp-stdio` | yes | Generic stdio language-server provider for the DeepSeek Harness LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@deepseek-ai/dsh-tool-lsp` | yes | Model-facing lsp tool over the DeepSeek Harness LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@deepseek-ai/dsh-mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## plan

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@deepseek-ai/dsh-agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@deepseek-ai/dsh-persona` | yes | Composition-authored deployment persona section for the DeepSeek Harness |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-ptc-runtime-node` | yes | Node PTC execution with per-call sandboxed processes or in-memory REPL state |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-sandbox-local` | yes | Local process-sandbox backends for the DeepSeek Harness sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@deepseek-ai/dsh-sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-schedule` | yes | Host-wide durable reminders with shared management and original-Session delivery |
| `@deepseek-ai/dsh-tool-schedule` | no | Model-facing reminder management tools (schedule_create, schedule_list, schedule_update, schedule_delete) over the Host ctx.schedule service |

## session

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-message-quotes` | no | Selected-text quotation and Markdown blockquote presentation |
| `@deepseek-ai/dsh-session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@deepseek-ai/dsh-session-log-deepseek` | yes | Incremental lossless session-log request extension for the official DeepSeek LLM API |
| `@deepseek-ai/dsh-session-persistence-jsonl` | yes | JSONL durable session persistence backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@deepseek-ai/dsh-session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@deepseek-ai/dsh-session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-telemetry-otel` | yes | Feedback-authorized Session logs over byte-bounded OpenTelemetry HTTP requests |
| `@deepseek-ai/dsh-session-title` | yes | Log-backed session title service and provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | yes | First-message LLM provider plugin for DeepSeek Harness session titles |
| `@deepseek-ai/dsh-session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-working-directory` | no | Read and change the active Session working directory |
| `@deepseek-ai/dsh-working-directory` | yes | Session working directories with durable changes and model context |

## session-query

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-session-log-export` | yes | Web Session-log export command and shared download dialog |
| `@deepseek-ai/dsh-session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |

## settings

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-settings` | no | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |

## shell

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-bash-local` | yes | Local-subprocess implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-bash-sandbox` | yes | Sandbox-consuming implementation of the DeepSeek Harness bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-pwsh-local` | yes | Local PowerShell implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-pwsh-sandbox` | yes | Sandbox-consuming implementation of the DeepSeek Harness PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-shell-env` | yes | Tool-independent managed DSH_* shell environment registry |
| `@deepseek-ai/dsh-tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@deepseek-ai/dsh-tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@deepseek-ai/dsh-tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-skill` | yes | Agent skill provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill-filesystem` | yes | Local filesystem skill provider for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and LibreOffice Kit operations |
| `@deepseek-ai/dsh-tool-skill` | yes | Model-facing skill loading tool for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## soloengine

| Package | Config | Description |
|---|---|---|
| `@soloengine/browser-proxy` | yes | SoloEngine 浏览器同源代理（Host 面）：catch-all 持续代理 + SSRF 五条防线 + Location/HTML 重写 + hop-by-hop 头剔除 + WebSocket upgrade 转发。 |
| `@soloengine/client-bootstrap` | no | SoloEngine URL 直达会话与启动接线（自研客户端）：/run/:agenticFlowId → 该画布最近一次运行的原生会话选择。 |
| `@soloengine/host` | yes | SoloEngine 框架挂载：把框架层 Express REST 挂进 dsh host-webserver 的同一条 HTTP 服务（唯一端口），并负责就绪输出与业务库自检。 |
| `@soloengine/llm-db-adapter` | yes | SoloEngine 模型路由适配器：把管理层每条启用中的模型配置暴露为一条 soloengine-<id> 路由，执行时向管理层要已解密密钥与地址，秒级轮询发现变更并全量替换。 |
| `@soloengine/open-preview` | no | SoloEngine 预览记录（Host 面）：soloengine/preview 事件族声明 + 会话投影（去重置顶、上限 50）。 |
| `@soloengine/sandbox-container` | no | SoloEngine 的容器沙箱提供方（W10.7）：把会话执行边界声明为由每会话容器承担，配合按会话路由的容器子进程提供方；无会话作用域的调用直接拒绝。 |
| `@soloengine/session-persistence-postgres` | yes | SoloEngine 的 PostgreSQL 会话日志后端：把事件日志与头信息写进同一个 PG 库的 log schema，与 JSONL 后端同契约、可整组替换。 |
| `@soloengine/session-persistence-sqlite` | yes | SoloEngine 的 SQLite 会话日志后端：把事件日志与头信息写进单机业务库（与业务表同库、表分割），与 JSONL/PG 后端同契约、可整组替换。 |
| `@soloengine/session-query-postgres` | yes | SoloEngine 的 PostgreSQL 会话检索后端：在同一个 PG 库的 search schema 里维护可丢弃派生索引，与 SQLite 检索后端同契约、可整组替换。 |
| `@soloengine/storage-postgres` | yes | SoloEngine 的 PostgreSQL 键值后端：注册为 storage 后端 postgres，与 SQLite 后端同契约、可单独替换。 |
| `@soloengine/subprocess-container` | yes | SoloEngine 的按会话执行世界子进程提供方（W10.7）：把 shell 命令放进该会话的容器（docker exec）或全 VM（ssh）里执行，工作区映射到 /workspace；无会话路由的命令仍走本机。 |
| `@soloengine/tools` | no | SoloEngine 特有工具（Host 面）：运行诊断 get_diagnostics。 |
| `@soloengine/ui-conversation` | no | SoloEngine 会话头座位与对话节点与预览卡片（自研客户端）：经 conversation.session.header.* 座位与键控 conversation.chat.node 注册。 |
| `@soloengine/ui-document-editor` | no | SoloEngine 编辑器/文档面板（自研客户端）：在官方 documentpreviews 注册表上补文本编辑能力（保存写回项目目录）；Office/表格文档交官方 office/excel 渲染器，不自建解析器。 |
| `@soloengine/ui-operation-area` | no | SoloEngine 操作区联动层与变更面板（自研客户端）：呈现意图 → openResource/openTab 自动跟随，变更台账面板。 |
| `@soloengine/ui-theme` | no | SoloEngine 设计语言阶梯 token（--se-space/radius/z）——运行面板与产品页面共用的单一真源。 |

## spill

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-spill-local` | yes | Local-filesystem implementation of the DeepSeek Harness spill storage seam (private session-scoped files) |
| `@deepseek-ai/dsh-spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## storage

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |
| `@deepseek-ai/dsh-storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness |
| `@deepseek-ai/dsh-storage-json` | yes | JSON file KV storage backend for the DeepSeek Harness storage hub |
| `@deepseek-ai/dsh-storage-sqlite` | yes | SQLite storage backend (kv facet) for the DeepSeek Harness storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@deepseek-ai/dsh-subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@deepseek-ai/dsh-tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@deepseek-ai/dsh-tool-subagent-control` | yes | Shared messaging, interruption, and child discovery tools for subagents |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-subprocess-local` | no | Local-subprocess implementation of the DeepSeek Harness subprocess seam |

## team

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent-team` | yes | Shared task DAG and change waits for subagent trees |
| `@deepseek-ai/dsh-tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |

## telemetry

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-otel` | no | Cordis service for independent ordinary-event and byte-bounded Session-log OTLP channels |

## terminal

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-terminal` | no | Persistent PTY session seam for the DeepSeek Harness — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@deepseek-ai/dsh-terminal-bash` | yes | Persistent shell PTY backend over the DeepSeek Harness subprocess terminal primitive |

## test-support

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-todo` | yes | Model-facing todo_write tool over the DeepSeek Harness event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web` | yes | Abstract web access capability seam (ctx.web) for the DeepSeek Harness — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@deepseek-ai/dsh-web-deepseek-api` | yes | DeepSeek Search and Fetch API providers for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-fetch-http` | yes | Anonymous public HTTP(S) fetch provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-deepseek` | yes | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-exa` | yes | Exa-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-perplexity` | yes | Perplexity-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |

## workflow

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@deepseek-ai/dsh-workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness |
