/**
 * @soloengine/host —— 框架层挂载插件 + 运行驱动。
 *
 * 职责（PRD-01 FR-ARCH-001/050、PRD-06、《SoloEngine 框架设计》§6.1/§6.4）：
 * - 建立框架层运行时（业务库 + 主密钥 + 账号域），并把其 Express 应用以**前缀路由**
 *   挂进 dsh `ctx.webServer` 的同一条 HTTP 服务——单进程、单端口、单 Web 壳；
 * - **运行驱动**：把「框架层的运行请求」翻译为原生 harness 调用——现场编译产物经
 *   `ctx.agentPresets.mount` 挂进 agent scope + `ctx.tools.restrict` 写死可见工具集合，
 *   再由 `ctx.agents.create` 建 mainagent（模型路由取编译产物、cwd 取运行项目目录）；
 * - **归属直写**：会话与事件两表由本插件监听原生 `session/event` 广播直写（唯一写入方）；
 * - 创造模式审计：监听官方 `cordis/*` 事件落 `creator_audit`；
 * - 打印就绪行；启动自检 fail loud（业务库环境不满足即抛错，不带病启动）。
 *
 * 形态纪律：业务逻辑在 `@soloengine/framework`（普通 TS 模块，不进插件树）；本插件是
 * 两者唯一的接缝，且只做「翻译为原生形态 + 归属直写」，不做数据转换层、不做双写。
 *
 * @module @soloengine/host
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z as zod } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// 引入模块声明，使 `ctx.webServer` / `ctx.agents` / `ctx.agentPresets` / `ctx.tools` /
// `ctx.subagents` / `ctx.sessionProjections` / `ctx.connection` 在类型上可见（module augmentation）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type {} from '@deepseek-ai/dsh-settings'
import { FrameworkRuntime, BUSINESS_TABLES, type RunDriver, type RunStartInput, type SessionLedger, type UsageRow } from '@soloengine/framework'
import { mountOperationAreaBridge } from './ops-bridge.ts'
import { mountFileChanges } from './file-changes.ts'
import { PreviewStream, mountPreviewStream } from './preview-stream.ts'
import { mountLedgerRebuild } from './ledger-rebuild.ts'
import { McpMountSupervisor } from './mcp-mount.ts'
import { applyRunModePreset } from './permission-allowlist.ts'
import { hasTokenParameter, isLoopbackAuthority, isLoopbackRequest, requestAuthority, writeTrustBootstrap } from './trust-bootstrap.ts'
import type { AgentSpec, FollowIntentRecord, FollowIntentView, FollowLocation, RunContextRecord, RunMode } from '@soloengine/types'
import { TOOL_MAP } from '@soloengine/types'

/** Cordis plugin name. */
export const name = 'soloengine-host'
/** The framework mount needs the HTTP server seat. */
export const inject = ['webServer']

/** Plugin configuration. */
export interface Config {
  /** 实例根目录（data/ 的父级）；默认取 `SOLOENGINE_ROOT` 或进程工作目录。 */
  root?: string
  /** REST 挂载前缀；默认 `/api/solo`。 */
  prefix?: string
  /** 是否打印就绪行。 */
  printReady?: boolean
  /** 编译产物挂载所用的基线 agent 预设 id；默认 `standard`。 */
  agentPreset?: string
  /** 委派深度上限（PRD-06 FR-ENG-024）；默认 3。 */
  maxDelegationDepth?: number
}

/** 挂载前缀（dsh webServer 的 prefix 路由不匹配带尾斜杠的根路径）。 */
const DEFAULT_PREFIX = '/api/solo'
/** 基线预设：编译产物在此之上经 restrict 收紧为该节点的可见集合。 */
const DEFAULT_AGENT_PRESET = 'standard'
/** 委派深度上限。 */
const DEFAULT_MAX_DEPTH = 3
/** 节点 persona 在系统提示词中的段序（紧随部署 persona 前缀）。 */
const PERSONA_SECTION_ORDER = 1
/** 画布全局运行模式的合法值域（与 `CanvasSettings.run_mode` 同值域）。 */
const RUN_MODES: readonly RunMode[] = ['ask', 'allowlist', 'auto']
/** 画布全局运行模式缺省（画布 schema 默认值，非错误回退）。 */
const DEFAULT_RUN_MODE: RunMode = 'ask'
/** 画布全局「实时跟随」缺省（画布 schema 默认值）。 */
const DEFAULT_LIVE_FOLLOW = true

/**
 * 产品设置桥接的命名空间白名单。
 *
 * 主题与本地化的**机制一份**在 harness 域（`ui-theme` / `locale` 命名空间由 harness 插件注册、
 * 校验、持久化、热生效）；框架层产品页面**被动消费**同一份存储——经本桥接以同一 REST 前缀、
 * 同一鉴权读写，写走设置域自身的版本栅栏。不新建第二套偏好存储。
 */
type ProductSettingsNamespace = 'ui-theme' | 'locale'

/** 允许桥接的命名空间（其余一律结构化拒绝）。 */
const PRODUCT_SETTINGS_NAMESPACES: readonly ProductSettingsNamespace[] = ['ui-theme', 'locale']

/**
 * 判断一个路径参数是否是允许桥接的产品设置命名空间。
 * @param value - 路径参数。
 * @returns 是否在白名单内。
 */
function isProductSettingsNamespace(value: string): value is ProductSettingsNamespace {
  return (PRODUCT_SETTINGS_NAMESPACES as readonly string[]).includes(value)
}

/**
 * 产品页面与运行面板深链的路径根。
 *
 * frontend-static 只服务 dist 根与显式 index 路径（深链一律 404），故这些根以**具名前缀
 * 路由**承接：渲染同一个 dist index（`renderIndex` 注入 + 根锚点），并走同一条浏览器鉴权。
 * 框架层 REST 前缀 `/api/solo` 与插件前缀 `/plugins` 不在其中，互不遮蔽。
 */
const PRODUCT_ROUTE_ROOTS: readonly string[] = [
  // 编辑器是单数 `/canvas/:agenticFlowId`，列表页仍是复数 `/canvases`：前缀匹配按路径段边界
  // 判定，`/canvas` 不覆盖 `/canvases`（实测漏写会让列表页 404），故两行都在。
  '/run', '/login', '/canvas', '/canvases', '/models', '/skills', '/mcp', '/market', '/packaging', '/settings',
]

/**
 * MCP 启停热同步周期（PRD-05 FR-MCP-005）。
 *
 * 与模型路由热同步同量级（1 秒）：启停一次最多 1 秒后对活运行生效，远好于「重启才生效」，
 * 也不至于每秒读爆 `mcp_servers`（一次 SELECT，无连接开销）。
 */
const MCP_SYNC_INTERVAL_MS = 1000

/** 运行上下文的 zod 校验（持久投影缓存先验）。 */
const runContextSchema = zod.object({
  canvasId: zod.string(),
  projectId: zod.string(),
  projectDir: zod.string(),
  runMode: zod.enum(['ask', 'allowlist', 'auto']),
  liveFollow: zod.boolean(),
  at: zod.number(),
})

/** 运行上下文状态/线值同形（宿主权威、客户端只读；未发起运行即 null）。 */
const runContextValueSchema = runContextSchema.nullable()

/** 工具呈现意图的 zod 校验（持久投影缓存先验）。 */
const followIntentSchema = zod.object({
  callId: zod.string(),
  toolName: zod.string(),
  card: zod.enum(['generic', 'terminal', 'diff']),
  locations: zod.array(zod.object({ path: zod.string(), line: zod.number().optional() })),
  turn: zod.number(),
  step: zod.number(),
  at: zod.number(),
})

/** 呈现意图状态/线值同形（宿主权威、客户端只读；无调用即 null）。 */
const followIntentValueSchema = followIntentSchema.nullable()

/**
 * 会话投影单元 `soloengine.runContext`（PRD-07 FR-UI-006）。
 *
 * 折叠 `soloengine/run-context` 事件：后写覆盖先写（同一会话重新发起运行时刷新）。
 * 面板经标准 `useProjection('soloengine.runContext')` 座位消费——宿主权威、客户端只读。
 */
export const runContextProjectionDefinition = {
  key: 'soloengine.runContext',
  stateVersion: 1,
  stateSchema: runContextValueSchema,
  init: () => null,
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'soloengine/run-context') return state
    const data = event.data
    return {
      canvasId: data.canvasId,
      projectId: data.projectId,
      projectDir: data.projectDir,
      runMode: data.runMode,
      liveFollow: data.liveFollow,
      at: event.time,
    }
  },
  wire: {
    viewSchema: runContextValueSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'soloengine.runContext', RunContextRecord | null>

/**
 * 会话投影单元 `soloengine.followIntent`（PRD-08 FR-OPS-011）。
 *
 * 折叠 `soloengine/follow` 事件：后写覆盖先写（面板跟随「最近一次呈现意图」）。
 * 联动层（客户端）经标准 `useProjection('soloengine.followIntent')` 座位消费——
 * 宿主权威、客户端只读；分派依据是工具自己的呈现意图，不是硬编码工具名映射表。
 */
export const followIntentProjectionDefinition = {
  key: 'soloengine.followIntent',
  stateVersion: 1,
  stateSchema: followIntentValueSchema,
  init: () => null,
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'soloengine/follow') return state
    const data = event.data
    return {
      callId: data.callId,
      toolName: data.toolName,
      card: data.card,
      locations: data.locations,
      turn: data.turn,
      step: data.step,
      at: event.time,
    }
  },
  wire: {
    viewSchema: followIntentValueSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'soloengine.followIntent', FollowIntentView | null>

/**
 * 解析画布全局运行模式：缺省取画布 schema 默认值；非法值 fail loud（无静默降级）。
 * @param raw - 编译产物携带的运行模式（可能缺省）。
 * @returns 合法运行模式。
 */
function resolveRunMode(raw: string | undefined): RunMode {
  if (raw === undefined) return DEFAULT_RUN_MODE
  const matched = RUN_MODES.find(mode => mode === raw)
  if (matched === undefined) {
    throw new Error(`soloengine: run mode "${raw}" is not one of ${RUN_MODES.join('|')}`)
  }
  return matched
}

/**
 * 解析实例根目录：显式配置 > `SOLOENGINE_ROOT` > 进程工作目录。
 * @param config - 插件配置。
 * @returns 绝对根目录。
 */
function resolveRoot(config: Config): string {
  if (config.root !== undefined && config.root !== '') return config.root
  const fromEnv = process.env.SOLOENGINE_ROOT
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv
  return process.cwd()
}

/** 一个会话的画布节点归属（编译产物 agent_id 与画布父节点）。 */
interface NodeAttribution {
  agentId: string
  parentAgentId: string | null
}

/**
 * 运行驱动实现：把框架层运行请求翻译为原生 harness 调用。
 * @param ctx - 已注入 `agents`/`sessions`/`agentPresets`/`tools`/`subagents` 的上下文。
 * @param runtime - 框架层运行时（归属台账与模型配置读取）。
 * @param options - 预设 id、深度上限与共享的归属派生索引。
 * @returns 运行驱动。
 */
export function createRunDriver(
  ctx: Context,
  runtime: FrameworkRuntime,
  options: {
    agentPreset: string
    maxDepth: number
    /** 会话 → 画布节点归属（与归属直写器共享同一份派生索引）。 */
    attribution: Map<string, NodeAttribution>
    /** 会话 → 最后一条助手消息 seq（`parent_message_id` 的派生源）。 */
    lastAssistantSeq: Map<string, number>
  },
): RunDriver {
  /** 活会话句柄：sessionKey → handle。 */
  const handles = new Map<string, { dispose: () => Promise<void> }>()
  /** 会话 → 本次运行的归属上下文（子代理子会话按会话树落同一条归属链）。 */
  const runContext = new Map<string, {
    userId: string
    canvasId: string
    projectId: string
    llmConfigId: string | null
  }>()
  const { attribution } = options

  /** 解析一条模型路由对应的模型名（缺失即 fail loud）。 */
  const modelOf = (route: string, nodeId: string): string => {
    const row = runtime.models.byIdUnscoped(route.replace(/^soloengine-/u, ''))
    if (row === undefined) {
      throw new Error(`entry/node ${nodeId} references model route ${route}, whose config row is missing`)
    }
    return row.model_name
  }

  /** MCP 挂载监督器（FR-MCP-005/006/008；在运行域内一份，随插件生命周期）。 */
  const mcpMounts = new McpMountSupervisor(runtime, message => { console.log(message) })

  /**
   * 把一个编译产物节点挂进该 agent 的 scope：基线预设 + persona 段 + 工具收紧 +
   * 出边委派工具（每条边一个 Task 工具，PRD-06 FR-ENG-026）+ **该节点引用的 MCP 服务器**
   * （PRD-05 FR-MCP-006：池外不入工具表）。
   */
  const composeNode = async (
    agentCtx: Context,
    spec: AgentSpec,
    compiled: RunStartInput['compiled'],
    owner: { sessionKey: string; userId: string },
  ): Promise<void> => {
    await ctx.agentPresets.mount(agentCtx, options.agentPreset)
    if (spec.persona !== undefined && spec.persona.trim() !== '') {
      agentCtx.systemPrompt.section({
        name: 'soloengine:node-persona',
        order: PERSONA_SECTION_ORDER,
        text: spec.persona,
        interpolate: false,
      })
    }
    // 委派边 = 父节点工具表里的一个 Task 工具（作用域自己的注册，不受 restrict 影响）。
    for (const edge of compiled.edges) {
      if (edge.from !== spec.agentId) continue
      const child = compiled.agents.find(candidate => candidate.agentId === edge.to)
      if (child === undefined) {
        throw new Error(`delegation edge ${edge.edgeId} points at node ${edge.to}, which the compiled product lacks`)
      }
      const childModel = modelOf(child.modelRoute, child.agentId)
      const childPersona = child.persona !== undefined && child.persona.trim() !== '' ? child.persona : undefined
      agentCtx.tools.register(defineTool({
        name: edge.toolName,
        description:
          `Delegate a self-contained task to the "${child.name}" agent (canvas node ${child.agentId}) and return its final `
          + 'answer. The child works in its own session with its own model, prompt and tools; it does not see this '
          + 'conversation, so state everything it needs in the task text.',
        parameters: {
          task: { type: 'string', required: true, description: 'The complete task for the child agent.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              childSessionId: { type: 'string', required: true },
              stopReason: { type: 'string', required: true },
              output: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: value.output === '' ? `child ${value.childSessionId} finished with ${value.stopReason}` : value.output,
          }],
        },
        async execute(args, exec) {
          const parent = exec.agent
          if (parent === undefined) throw new Error(`${edge.toolName} requires an owning agent session`)
          const run = await ctx.subagents.start('spawn', {
            label: child.name,
            prompt: [{ type: 'text', text: args.task }],
            parent,
            signal: exec.signal,
            agentOptions: { provider: child.modelRoute, model: childModel },
            ...childPersona === undefined ? {} : { persona: childPersona },
            toolFilter: { allow: [...child.tools] },
            maxDepth: options.maxDepth,
          })
          attribution.set(String(run.id), { agentId: child.agentId, parentAgentId: spec.agentId })
          // 子代理子会话按会话树落同一条归属链（PRD-12 FR-STO-005：全部子会话归属到对应画布节点）。
          const parentRun = runContext.get(owner.sessionKey)
          if (parentRun !== undefined) {
            runtime.runs.ledger.ensure({
              session_key: String(run.id),
              user_id: parentRun.userId,
              agentic_flow_id: parentRun.canvasId,
              run_project_id: parentRun.projectId,
              llm_config_id: child.modelRoute.replace(/^soloengine-/u, ''),
            })
            runContext.set(String(run.id), { ...parentRun, llmConfigId: child.modelRoute.replace(/^soloengine-/u, '') })
          }
          const result = await run.result
          const text = result.output
            .filter(block => block.type === 'text')
            .map(block => (block as { text: string }).text)
            .join('')
          return {
            childSessionId: String(run.id),
            stopReason: String(result.stopReason),
            output: text,
          }
        },
      }))
    }
    // 写死该 agent 的可见工具集合（只收紧继承面；本作用域自己的注册——含上面注册的
    // 委派工具——按契约豁免，故允许清单里要剔掉委派工具名，否则 restrict 会把它们
    // 当作「未知全局工具」直接拒绝）。
    const ownToolNames = new Set(
      compiled.edges.filter(edge => edge.from === spec.agentId).map(edge => edge.toolName),
    )
    const inherited = spec.tools.filter(name => !ownToolNames.has(name))
    if (inherited.length > 0) {
      agentCtx.tools.restrict({ allow: inherited })
    } else {
      // 节点只勾选了委派工具：把继承面全部关掉（deny 是唯一能表达「什么都不继承」的形式）。
      agentCtx.tools.restrict({ deny: ctx.tools.schemas().map(schema => schema.name) })
    }
    // FR-SKILL-007（Must）：节点勾选的技能即该 agent 的可见集合，与全局池解耦、编译期写死。
    //
    // 平台现状（实测）：预设组合已经给该作用域挂了一个技能注册表（再发布同名服务会冲突
    // `service "skills" has been registered`），但它的目录是**全量启用技能**，没有按 agent 收紧的
    // 过滤器（`SkillRegistry` 无 restrict，`ToolRestriction` 只作用于全局工具）。
    // 因此这里落实**能落实的那一半**：在作用域内加执行守卫，未勾选的技能在调用期被拒
    // （含参数名，而不是只挡工具本身）；并把本节点的技能范围记入实例日志供诊断。
    // 「目录里根本不出现」需要预设行支持按 agent 的技能过滤（平台接缝），见 docs/07 §六。
    if (spec.skills.length > 0) {
      const declared = new Set(spec.skills)
      console.log(`soloengine: node ${spec.agentId} skill scope restricted to (skills: ${[...declared].join(', ')});`
        + ' other skills are denied at invocation (PRD-04 FR-SKILL-007)')
      agentCtx.tools.guard((execution) => {
        if (execution.name !== 'skill') return undefined
        const requested = String((execution.arguments as { name?: unknown } | undefined)?.name ?? '')
        if (requested !== '' && !declared.has(requested)) {
          return `skill "${requested}" is not in this node's skill list (PRD-04 FR-SKILL-007)`
        }
        return undefined
      })
    }
    // 该节点引用的 MCP 服务器挂进**本作用域**（PRD-05 FR-MCP-006）：只有名单里的服务器出现，
    // 池外的一概不进（同一服务器名可被不同 agent 各自挂载）。
    if (spec.mcpServers.length > 0) {
      await mcpMounts.register({
        agentCtx,
        userId: owner.userId,
        serverNames: spec.mcpServers,
        sessionKey: owner.sessionKey,
        agentId: spec.agentId,
        cwd: spec.cwd,
      })
    }
  }

  return {
    /**
     * MCP 热同步（PRD-05 FR-MCP-005）：把已登记的作用域同步到当前 MCP 行状态。
     * @returns 本次同步的作用域数。
     */
    async syncMcpMounts(): Promise<number> {
      return await mcpMounts.syncAll()
    },
    async start(input) {
      const mainSpec = input.compiled.agents.find(spec => spec.agentId === input.mainAgent.agentId)
      if (mainSpec === undefined) {
        throw new Error(`compiled product has no agent for entry node ${input.mainAgent.agentId}`)
      }
      // 归属必须在建 agent 之前登记：构造期就会落事件（会话种子等），
      // 否则这些行会落到「以会话键兜底」的节点归属上。
      attribution.set(input.sessionKey, { agentId: mainSpec.agentId, parentAgentId: null })
      runContext.set(input.sessionKey, {
        userId: input.userId,
        canvasId: runtime.runs.ledger.byKey(input.sessionKey)?.agentic_flow_id ?? '',
        projectId: runtime.runs.ledger.byKey(input.sessionKey)?.run_project_id ?? '',
        llmConfigId: input.mainAgent.provider.replace(/^soloengine-/u, ''),
      })
      const handle = await ctx.agents.create({
        sessionId: SessionId(input.sessionKey),
        agentOptions: {
          provider: input.mainAgent.provider,
          model: input.mainAgent.model,
          ...input.mainAgent.maxTokens === null ? {} : { maxTokens: input.mainAgent.maxTokens },
        },
        meta: { cwd: input.cwd, agentPreset: options.agentPreset },
        setup: agentCtx => composeNode(agentCtx, mainSpec, input.compiled, {
          sessionKey: input.sessionKey,
          userId: input.userId,
        }),
      })
      handles.set(input.sessionKey, handle)
      // 权限三档（PRD-10 FR-SEC-006）：画布运行模式经权限预设原语写入本会话（落持久权限事件，
      // 重放可见、投影可读，`/permission` 与设置默认行同一张预设表）。
      applyRunModePreset(ctx, handle.agent.session, resolveRunMode(input.settings.run_mode))
      // 运行上下文落日志（PRD-07 FR-UI-006）：面板会话头的「当前项目 / 运行模式」经
      // `soloengine.runContext` 投影叠加呈现——持久事件是唯一真源，客户端只读投影。
      const context = runContext.get(input.sessionKey)
      handle.agent.session.append('soloengine/run-context', {
        canvasId: context?.canvasId ?? '',
        projectId: context?.projectId ?? '',
        projectDir: input.cwd,
        runMode: resolveRunMode(input.settings.run_mode),
        liveFollow: input.settings.live_follow ?? DEFAULT_LIVE_FOLLOW,
      })
      // 就绪行（console：本 profile 未挂 logger-console，故可取证行一律走 console）。
      console.log(
        `soloengine: main agent ready (session=${input.sessionKey}, node=${mainSpec.agentId}, route=${mainSpec.modelRoute}, tools=${String(mainSpec.tools.length)}, edges=${String(input.compiled.edges.length)})`,
      )
      return { mainAgentId: mainSpec.agentId }
    },
    prompt(sessionKey, text) {
      const agent = ctx.agents.get(SessionId(sessionKey))
      if (agent === undefined) {
        throw new Error(`session ${sessionKey} has no live agent in this process`)
      }
      agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), 'next-turn', true)
      return Promise.resolve({ queued: agent.status !== 'idle' })
    },
    async cancel(sessionKey, reason) {
      const agent = ctx.agents.get(SessionId(sessionKey))
      if (agent === undefined) {
        throw new Error(`session ${sessionKey} has no live agent in this process`)
      }
      ctx.logger.info(`soloengine: cancelling session ${sessionKey} (${reason})`)
      agent.cancel({ kind: 'user' })
      await agent.whenIdle()
    },
    live(sessionKey) {
      const agent = ctx.agents.get(SessionId(sessionKey))
      return {
        live: agent !== undefined,
        // 归属 agent 是**画布节点**（编译产物 agent_id），不是会话键（PRD-12 FR-STO-005）。
        agentId: attribution.get(sessionKey)?.agentId ?? null,
        status: agent?.status ?? 'absent',
      }
    },
    async usage(): Promise<UsageRow[]> {
      const rows: UsageRow[] = []
      for (const session of ctx.sessions.list()) {
        if (runtime.runs.ledger.byKey(String(session.id)) === undefined) continue
        let inputTokens = 0
        let outputTokens = 0
        let totalTokens = 0
        let requests = 0
        // oxlint-disable-next-line typescript/no-deprecated -- history read for the usage derivation
        for (const event of session.snapshotEvents()) {
          if (event.type !== 'assistant/message') continue
          const usage = event.data.usage
          if (usage === undefined) continue
          requests += 1
          inputTokens += usage.inputTokens
          outputTokens += usage.outputTokens
          totalTokens += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
        }
        rows.push({ sessionKey: String(session.id), inputTokens, outputTokens, totalTokens, requests })
      }
      return rows
    },
  }
}

/** 归属直写：会话事件 → `events` 表（唯一写入方；非本实例发起的会话不写）。 */
function attachLedgerWriters(
  ctx: Context,
  shared: {
    attribution: Map<string, NodeAttribution>
    lastAssistantSeq: Map<string, number>
    ledger: SessionLedger
  },
): void {
  const { attribution, lastAssistantSeq, ledger } = shared
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const key = String(session.id)
    const ledgerRow = ledger.byKey(key)
    if (ledgerRow === undefined) return
    if (event.type === 'assistant/message') lastAssistantSeq.set(key, Number(event.seq))
    const node = attribution.get(key) ?? {
      agentId: session.header.parentSession === undefined ? key : String(session.header.parentSession),
      parentAgentId: session.header.parentSession === undefined ? null : String(session.header.parentSession),
    }
    try {
      const parentSeq = lastAssistantSeq.get(key)
      ledger.appendEvent(ledgerRow.id, Number(event.seq), {
        agent_id: node.agentId,
        ...node.parentAgentId === null ? {} : { parent_agent_id: node.parentAgentId },
        ...event.type !== 'tool/result' || parentSeq === undefined ? {} : { parent_message_id: parentSeq },
      })
      if (event.type === 'turn/end') {
        const reason = String(event.data.reason.kind ?? event.data.reason)
        ledger.setStatus(ledgerRow.id, reason === 'completed' ? 'completed' : 'stopped', {
          completedAt: Date.now(),
        })
      }
    } catch (error) {
      ctx.logger.error(`soloengine: writing the event ledger row for ${key}#${String(event.seq)} failed`)
      ctx.logger.error(error)
    }
  })
  ctx.on('session/disposed', (session: Session) => {
    const row = ledger.byKey(String(session.id))
    if (row === undefined) return
    if (row.status === 'running' || row.status === 'pending') {
      ledger.setStatus(row.id, 'completed', { completedAt: Date.now() })
    }
  })
}

/**
 * 工具呈现意图派生（PRD-08 FR-OPS-004 / FR-OPS-011）。
 *
 * 官方契约把 `presentCall` / `presentResult` 定位为 **Host-local consumers** 的纯函数
 * （内置 Web Client 不消费它们），故本层在 Host 侧消费工具自己的呈现意图：
 * 监听 `tool/call` → `ctx.tools.get(name)` 取定义 → `presentCall(args)` 得卡片判别联合 →
 * 把「需要跟随到哪里」写成一条 log-only 的 `soloengine/follow` 持久事件。
 *
 * 写入放在事件广播之后（`setImmediate`），避免在广播内重入追加；
 * 分派不依赖任何「工具名 → 面板」映射表，新工具（含第三方 MCP 工具）自带定位元数据即生效。
 *
 * @param ctx - 已注入 `tools` 的上下文。
 */
function attachFollowLayer(ctx: Context): void {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'tool/call') return
    // 工具定义按**调用方作用域**解析（内置工具注册在 agent 作用域，全局视图看不到）；
    // 作用域键取自该会话的活 agent——与执行时 `resolveExecution(name, scope)` 同源，
    // 因此呈现意图与真实执行的是同一份定义。
    const agent = ctx.agents.get(session.id)
    const definition = ctx.tools.get(event.data.name, agent === undefined ? undefined : scopeOf(agent.ctx))
    if (definition?.presentCall === undefined) return
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data.arguments)
    } catch {
      return
    }
    let view: ReturnType<NonNullable<typeof definition.presentCall>>
    try {
      view = definition.presentCall(parsed)
    } catch (error) {
      ctx.logger.error(`soloengine: presentCall for ${event.data.name} threw`)
      ctx.logger.error(error)
      return
    }
    if (view === undefined) return
    const locations: FollowLocation[] = []
    if ('locations' in view && Array.isArray(view.locations)) {
      for (const location of view.locations) locations.push({ path: location.path, ...location.line === undefined ? {} : { line: location.line } })
    }
    if (view.card === 'diff') {
      for (const diff of view.diffs) locations.push({ path: diff.path })
    }
    const record: FollowIntentRecord = {
      callId: String(event.data.callId),
      toolName: event.data.name,
      card: view.card,
      locations,
      turn: Number(event.data.turn),
      step: Number(event.data.step),
    }
    setImmediate(() => {
      try {
        session.append('soloengine/follow', record)
      } catch (error) {
        ctx.logger.error(`soloengine: writing the follow intent for ${record.callId} failed`)
        ctx.logger.error(error)
      }
    })
  })
}

/**
 * 把产品设置命名空间（`ui-theme` / `locale`）以同一 REST 前缀、同一鉴权暴露给框架层产品页面。
 *
 * 这是《SoloEngine 框架设计》§6.4「产品设置 → 设置命名空间 → 设置域（校验 + 版本栅栏写）」
 * 那一行的落地：读走 `settings.describe`（含 revision），写走 `settings.update(ns, patch, revision)`
 * ——revision 不匹配由设置域自身拒绝（`SETTINGS_CONFLICT`），映射为 409。机制一份、被动消费。
 *
 * @param ctx - 已注入 `settings` 的上下文。
 * @param runtime - 框架层运行时（提供 `mountAuthenticated` 原生注入点）。
 */
function mountProductSettings(ctx: Context, runtime: FrameworkRuntime): void {
  /** 读一个命名空间的当前值与版本。 */
  const descriptorOf = (namespace: ProductSettingsNamespace): { value: unknown; revision: number } => {
    const found = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === namespace)
    if (found === undefined) {
      throw new Error(`soloengine-host: settings namespace "${namespace}" is not registered in this composition`)
    }
    return { value: found.value, revision: found.revision }
  }
  /** 白名单拒绝的结构化响应。 */
  const unknownNamespace = (namespace: string): { status: number; body: unknown } => ({
    status: 404,
    body: {
      ok: false,
      error: {
        code: 'SETTINGS_NAMESPACE_UNKNOWN',
        message: `settings namespace "${namespace}" is not one of ${PRODUCT_SETTINGS_NAMESPACES.join('|')}`,
      },
    },
  })
  runtime.mountAuthenticated(
    {
      id: 'settings-read',
      method: 'get',
      path: '/settings/:namespace',
      summary: '读取产品设置命名空间（ui-theme / locale；含版本栅栏 revision）',
    },
    async (req) => {
      const namespace = req.params.namespace ?? ''
      if (!isProductSettingsNamespace(namespace)) return unknownNamespace(namespace)
      const descriptor = descriptorOf(namespace)
      return { body: { ok: true, namespace, value: descriptor.value, revision: descriptor.revision } }
    },
  )
  runtime.mountAuthenticated(
    {
      id: 'settings-write',
      method: 'put',
      path: '/settings/:namespace',
      summary: '写入产品设置命名空间（版本栅栏：并发写拒绝；mode=merge|replace）',
    },
    async (req) => {
      const namespace = req.params.namespace ?? ''
      if (!isProductSettingsNamespace(namespace)) return unknownNamespace(namespace)
      const body = req.body as { value?: unknown; revision?: unknown; mode?: unknown }
      if (body.value === null || typeof body.value !== 'object' || Array.isArray(body.value)) {
        return {
          status: 400,
          body: { ok: false, error: { code: 'SETTINGS_VALUE_INVALID', message: 'value must be a JSON object' } },
        }
      }
      if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: 'SETTINGS_REVISION_REQUIRED', message: 'revision (the descriptor revision you read) is required' },
          },
        }
      }
      if (body.mode !== undefined && body.mode !== 'merge' && body.mode !== 'replace') {
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: 'SETTINGS_MODE_INVALID', message: 'mode must be merge (default) or replace' },
          },
        }
      }
      try {
        // merge = 设置域的 update（只覆盖给定键）；replace = 整体替换用户段
        // （缺省键回落到组合 base 与 schema 默认，即「恢复默认」路径）。
        if (body.mode === 'replace') await ctx.settings.replace(namespace, body.value as object, body.revision)
        else await ctx.settings.update(namespace, body.value as object, body.revision)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'SETTINGS_CONFLICT') {
          return {
            status: 409,
            body: { ok: false, error: { code: 'SETTINGS_CONFLICT', message: String((error as Error).message) } },
          }
        }
        // 其余（schema 校验失败等）结构化报出，不吞不降级。
        return {
          status: 400,
          body: { ok: false, error: { code: 'SETTINGS_WRITE_REJECTED', message: String((error as Error).message) } },
        }
      }
      const descriptor = descriptorOf(namespace)
      return { body: { ok: true, namespace, value: descriptor.value, revision: descriptor.revision } }
    },
  )
  console.log(`soloengine: product settings bridged (${PRODUCT_SETTINGS_NAMESPACES.join(', ')})`)
}

/** 创造模式审计：官方 `cordis/*` 事件 → `creator_audit`（每个动作一条，含失败）。 */
function attachCreatorAudit(ctx: Context, runtime: FrameworkRuntime): void {
  ctx.on('cordis/request-run', request => {
    runtime.runs.recordCreatorAudit({
      kind: 'request-run',
      userId: runtime.runs.ownerOf(String(request.agentId)),
      ok: !request.requiresApproval,
      detail: JSON.stringify({
        requestId: String(request.requestId),
        pluginId: String(request.pluginId),
        packageId: String(request.packageId),
        mode: request.mode,
        name: request.name,
        requiresApproval: request.requiresApproval,
      }),
    })
  })
  ctx.on('cordis/request-run-resolved', resolved => {
    runtime.runs.recordCreatorAudit({
      kind: 'request-run-resolved',
      userId: null,
      ok: resolved.outcome === 'completed',
      detail: JSON.stringify({ requestId: String(resolved.requestId), outcome: resolved.outcome }),
    })
  })
  ctx.on('cordis/dynamic-package', pkg => {
    runtime.runs.recordCreatorAudit({
      kind: 'dynamic-package',
      userId: null,
      ok: true,
      detail: JSON.stringify({
        pluginId: String(pkg.pluginId),
        packageId: String(pkg.packageId),
        pluginRunId: String(pkg.pluginRunId),
        name: pkg.name,
      }),
    })
  })
  ctx.on('cordis/dynamic-retract', retracted => {
    runtime.runs.recordCreatorAudit({
      kind: 'dynamic-retract',
      userId: null,
      ok: true,
      detail: JSON.stringify({
        pluginId: String(retracted.pluginId),
        packageId: String(retracted.packageId),
        pluginRunId: String(retracted.pluginRunId),
      }),
    })
  })
}

/**
 * 画布被删除后的会话收尾：先停掉仍在跑的运行，再清理会话日志目录（画布删除的一部分）。
 *
 * 顺序与理由：会话日志由 harness 持有写句柄——活会话必须先停（停止原因落日志），句柄释放后再删
 * 目录；释放是异步的，故按小步重试。每次动作打印一行，删掉了什么在日志里可见。
 *
 * 停止走 `runs.cancelDetached` 而非 `runs.cancel`：这一步发生在业务行（项目/会话/事件）级联删除
 * **之后**，会话行已不存在，`cancel` 的归属查询必然失败且停不掉活会话。归属由级联自身确立
 * （键集合取自该次删除的返回值，不接受外部输入）。
 *
 * @param ctx - 插件上下文（读 `sessions` 判断活跃）。
 * @param runtime - 框架层运行时（`runs.cancelDetached` 提供停止语义）。
 * @param sessionKeys - 被删除的会话键。
 */
async function retireSessionsAfterCanvasDelete(
  ctx: Context,
  runtime: FrameworkRuntime,
  sessionKeys: readonly string[],
): Promise<void> {
  const home = process.env.DSH_HOME ?? join(process.env.SOLOENGINE_ROOT ?? process.cwd(), 'data', 'dsh-home')
  const root = join(home, 'sessions')
  const live = ctx.get('sessions') as { get?: (id: string) => unknown } | undefined
  const sleep = async (ms: number): Promise<void> => { await new Promise(done => setTimeout(done, ms)) }
  for (const key of sessionKeys) {
    if (live?.get?.(key) !== undefined) {
      try {
        await runtime.runs.cancelDetached(key, 'the canvas was deleted')
        console.log(`soloengine: run stopped because its canvas was deleted (${key})`)
      } catch (error) {
        console.log(`soloengine: stopping the run for ${key} after its canvas was deleted failed (${String(error)})`)
      }
    }
    const dir = findSessionDir(root, key)
    if (dir === undefined) {
      console.log(`soloengine: no session log directory for ${key} (nothing to remove)`)
      continue
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true })
        console.log(`soloengine: session log removed with its canvas (${key})`)
        break
      } catch (error) {
        // Windows 下句柄释放滞后：小步重试；仍失败即如实报出（不静默）。
        if (attempt === 9) console.log(`soloengine: removing the session log for ${key} failed (${String(error)})`)
        else await sleep(300)
      }
    }
  }
}

/**
 * 在会话日志根下按目录名查找一个会话的日志目录（harness 的目录形态是
 * `<root>/<cwd 摘要>/<sessionKey>/session.*`）。
 *
 * @param root - 会话日志根（`<DSH_HOME>/sessions`）。
 * @param sessionKey - 会话键。
 * @returns 目录绝对路径，或 `undefined`。
 */
function findSessionDir(root: string, sessionKey: string): string | undefined {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      if (entry === sessionKey) {
        try {
          if (statSync(path).isDirectory()) return path
        } catch {
          continue
        }
      }
      try {
        if (statSync(path).isDirectory()) stack.push(path)
      } catch {
        continue
      }
    }
  }
  return undefined
}

/**
 * Mount the framework layer's REST surface onto the harness HTTP server.
 * @param ctx - Plugin context (must inject `webServer`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = resolveRoot(config)
  const prefix = config.prefix ?? DEFAULT_PREFIX
  const agentPreset = config.agentPreset ?? DEFAULT_AGENT_PRESET
  const maxDepth = config.maxDelegationDepth ?? DEFAULT_MAX_DEPTH
  const runtime = new FrameworkRuntime({ root })

  // 部署摘要的真实来源（PRD-11 FR-DEP-011）：同进程 webServer 的实际绑定值。两个 getter 转发到
  // 服务自身（监听在启动回调里落定），故就绪后 `/deployment/guide` 报出的是真实主机与端口。
  runtime.deployment = {
    get host(): string { return ctx.webServer.host },
    get port(): number { return ctx.webServer.port },
  }

  // 启动自检（fail loud）：业务库环境不满足即抛错，不带病启动。
  const environment = runtime.db.environment()
  if (environment.missingTables.length > 0) {
    throw new Error(
      `soloengine-host: business database at ${environment.path} is missing tables: ${environment.missingTables.join(', ')}`,
    )
  }
  if (environment.journalMode.toLowerCase() !== 'wal') {
    throw new Error(`soloengine-host: business database journal_mode is ${environment.journalMode}, expected wal`)
  }

  // system 种子账号（超管）：登录名 system / 口令 system。
  const seeded = runtime.accounts.seedSystem()

  // 画布删除的级联到文件系统：业务行（项目/会话/事件）在框架层事务里删，而会话日志是
  // `ctx.sessionPersistence` 的 JSONL 目录——由 host 在事务提交后停掉仍在跑的运行并清理日志；
  // 每次动作打印一行，删掉了什么可见、不静默。
  runtime.canvas.setSessionLogRemover((_userId, keys) => {
    void retireSessionsAfterCanvasDelete(ctx, runtime, keys).catch((error: unknown) => {
      console.log(`soloengine: retiring sessions after a canvas delete failed (${String(error)})`)
    })
  })

  ctx.effect(() => {
    // webServer 只接受 node 请求处理器；Express 应用本身即是 (req, res) => void。
    // 前缀路由把 /api/solo 及其子路径原样交给 Express（Express 内按完整路径匹配）。
    //
    // 信任域（PRD-10 FR-SEC-011 第二款）：框架层 REST 比 harness 的 `/api` 前缀更长，按
    // 「最长前缀胜出」的匹配规则会屏蔽掉原生 `/api` 围栏——故这里显式复用同一条围栏判定的
    // **信任域**结论：Host/Origin 不在回环或部署者声明的可信域内即 403 拒绝（DNS 重绑定
    // 与域外访问一律拒绝）。401（回环但无浏览器会话 cookie）不在此拦截——框架层 REST 的
    // 入口是账号域自己的 Bearer 令牌（PRD-03「统一鉴权」），harness 的令牌门仍只守 RPC 与事件流。
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: prefix,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        // 经 `ctx.get` 读取（本插件未声明 connection 注入，直读会抛错）；逐请求解析，
        // 组合层尚未装载连接插件时退回「不设围栏」——与原生 `/api` 的实际可用性一致。
        const connection = ctx.get('connection') as { requestRejection?: (request: unknown) => number | undefined } | undefined
        if (connection?.requestRejection?.(req) === 403) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(`${JSON.stringify({
            ok: false,
            error: {
              code: 'TRUST_DOMAIN_REJECTED',
              message: 'the request Host is neither loopback nor a host declared in the deployment trust domain (PRD-10 FR-SEC-011)',
            },
          })}\n`)
          return
        }
        runtime.app(req, res)
      },
    })
    return () => {
      dispose()
      runtime.close()
    }
  }, 'soloengine-host.mountFramework')

  // 运行驱动 + 归属直写 + 创造模式审计：等 harness 侧服务就绪后再接线
  // （未就绪时框架层 REST 仍在，/runs 以结构化错误明确拒绝，不静默降级）。
  /** 画布编辑器实时预览的轻量日志缓冲（FR-CANVAS-017；随本插件生命周期，卸载即弃）。 */
  const previewStream = new PreviewStream()

  ctx.effect(() => {
    const fiber = ctx.inject(
      ['agents', 'sessions', 'agentPresets', 'tools', 'subagents', 'sessionProjections', 'skills', 'sessionPersistence'],
      (driverCtx) => {
        const attribution = new Map<string, NodeAttribution>()
        const lastAssistantSeq = new Map<string, number>()
        const ledger = runtime.runs.ledger
        const driver = createRunDriver(driverCtx, runtime, { agentPreset, maxDepth, attribution, lastAssistantSeq })
        runtime.runs.setDriver(driver)
        // FR-CANVAS-014：画布编辑器的工具多选来自 harness 侧的工具集合——
        // **实时注册**（全局注册表；fs/命令类工具注册在各 agent 作用域，全局面不重复出现）
        // 与**编译器画布词汇表**（TOOL_MAP 的画布工具名 + run_command，编译契约的同一张表）
        // 的并集，经原生注入点挂进同一条 REST 前缀（机制一份，前端不另立静态清单）。
        runtime.mountAuthenticated(
          { id: 'tools-list', method: 'get', path: '/tools', summary: 'harness 工具清单（实时注册 ∪ 编译器画布词汇表；FR-CANVAS-014）' },
          async () => {
            const live = driverCtx.tools.schemas().map(schema => ({
              name: schema.name,
              description: (schema as { description?: string }).description ?? '',
            }))
            const byName = new Map(live.map(tool => [tool.name, tool]))
            for (const canvasName of [...Object.keys(TOOL_MAP), 'run_command']) {
              if (byName.has(canvasName)) continue
              byName.set(canvasName, { name: canvasName, description: '' })
            }
            return { body: { ok: true, tools: [...byName.values()] } }
          },
        )
        // 会话 → 画布节点归属：变更台账的 agent_id 归属与运行诊断都问同一处（单一真源）。
        runtime.runs.setAgentResolver(key => attribution.get(key)?.agentId)
        attachLedgerWriters(driverCtx, { attribution, lastAssistantSeq, ledger })
        attachCreatorAudit(driverCtx, runtime)
        attachFollowLayer(driverCtx)
        // 画布编辑器实时预览（FR-CANVAS-017）：与归属直写同源消费原生事件流，只折叠纯文本
        // 与工具状态；运转在本 fiber 内，卸载即撤销。
        mountPreviewStream(driverCtx, runtime, previewStream)
        // 归属台账重建入口（FR-ARCH-012）：sessions/events 是可重建的本地索引，
        // 官方持久化读路径为唯一事实来源；路由挂在同一 REST 前缀与鉴权之下。
        mountLedgerRebuild(driverCtx, runtime)
        // MCP 启停热生效（PRD-05 FR-MCP-005）：周期把活作用域同步到当前行状态——服务器被停用即
        // 卸载（世代回滚）、被启用即挂载、单工具开关就地更新，全程免重启。周期与模型路由热同步同量级。
        const mcpTimer = setInterval(() => {
          void driver.syncMcpMounts().catch(error => {
            console.log(`soloengine: mcp hot sync failed: ${String(error)}`)
          })
        }, MCP_SYNC_INTERVAL_MS)
        driverCtx.effect(() => () => { clearInterval(mcpTimer) })
        // 运行上下文与工具呈现意图两条投影（会话头与操作区叠加的数据源）：
        // 注册即可逆效果，卸载即撤销。
        driverCtx.sessionProjections.register(runContextProjectionDefinition)
        driverCtx.sessionProjections.register(followIntentProjectionDefinition)
        console.log(
          `soloengine: run driver wired (preset=${agentPreset}, maxDelegationDepth=${String(maxDepth)}, projection=soloengine.runContext+soloengine.followIntent)`,
        )
      },
    )
    return () => { void fiber.dispose() }
  }, 'soloengine-host.runDriver()')

  // 产品设置桥接：主题与本地化的偏好存储**只有一份**（harness 设置域），产品页面经同一
  // REST 前缀与同一鉴权被动消费；设置域未就绪时不注册该路由（请求以 404 明确失败，不降级）。
  ctx.effect(() => {
    const fiber = ctx.inject(['settings'], (settingsCtx) => {
      mountProductSettings(settingsCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.productSettings')

  // 文件变更记录与撤回（PRD-09）：写前后抓拍消费 dsh 原生 fs 意图/观测事件（不另埋钩子），
  // 台账落 `file_changes`/`file_content_blobs`；撤回经原生写入路径（守卫 + 补发观测）执行。
  ctx.effect(() => {
    const fiber = ctx.inject(['fs'], (changesCtx) => {
      mountFileChanges(changesCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.fileChanges()')

  // 操作区桥（运行面板侧）：信任门鉴权 + 归属取自运行台账（前端不上报归属），
  // 与产品页面的 `/api/solo/workspace/*`（Bearer 鉴权）共用同一份业务实现与沙箱根判据。
  ctx.effect(() => {
    const fiber = ctx.inject(['connection'], (bridgeCtx) => {
      mountOperationAreaBridge(bridgeCtx, runtime)
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.operationAreaBridge()')

  // 产品页面、运行面板深链与根入口：frontend-static 只服务 dist 根，深链一律 404——故以具名
  // 路由承接同一个 dist index（根路径用 exact，前缀用 prefix），并走同一条浏览器鉴权
  // （信任门：进程令牌换签名 cookie）。本机回环的未认证访问另做信任门引导——authority 别名
  // （localhost ↔ 127.0.0.1 各是一张 cookie）与「全新浏览器首访必须持令牌 URL」两个真实缺口
  // 都在那里补齐；连接面（RPC 与事件流）仍由 ctx.connection 的信任门判定，不因引导放宽。
  const distIndex = join(root, 'apps', 'web', 'dist', 'index.html')
  if (!existsSync(distIndex)) {
    throw new Error(
      `soloengine-host: product page dist is missing at ${distIndex} — build the web application first (pnpm run build:web)`,
    )
  }
  ctx.effect(() => {
    const fiber = ctx.inject(['connection'], (routeCtx) => {
      const render = async (bootstrapScript = ''): Promise<string> => {
        const body = routeCtx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
        // 深链下相对资源 URL 会解析到请求目录，故把资源锚点钉在站点根（与 frontend-static 同法）。
        const anchored = body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
        // 运行面板的会话键由服务端解析后随外壳下发（地址栏只带 agenticflow id），故在 </body>
        // 前插一段引导脚本；无该段时逐字返回原外壳。
        return bootstrapScript === '' ? anchored
          : anchored.includes('</body>')
            ? anchored.replace('</body>', `${bootstrapScript}</body>`)
            : `${anchored}${bootstrapScript}`
      }
      const page = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        const authority = requestAuthority(req)
        if (authority !== undefined && isLoopbackAuthority(authority) && isLoopbackRequest(req)
          && !hasTokenParameter(req) && routeCtx.connection.requestRejection(req) === 401) {
          writeTrustBootstrap(req, res, {
            authority,
            authenticatedUrl: baseUrl => routeCtx.connection.authenticatedUrl(baseUrl),
          })
          console.log(
            `soloengine: trust bootstrap issued for http://${authority} (the process token is exchanged for the signed browser cookie on this authority; the connection fence is unchanged)`,
          )
          return
        }
        if (!routeCtx.connection.authorizeIndex(req, res)) return
        // 运行面板按 **agenticflow** 区分 URL（PRD-01 §实例隔离：`/run/:agenticFlowId`）。
        // 会话键是面板内部的数据归属，不进地址栏：这里把 flow id 解析成该 flow 最近一次运行的
        // 会话键随外壳下发，client-bootstrap 读它做原生会话选择；解析不到即 fail loud 结构化 404
        // （指明 flow id），不静默落到别的页面。
        const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname
        const flowSegment = pathname.startsWith('/run/')
          ? decodeURIComponent(pathname.slice('/run/'.length).split('/')[0] ?? '')
          : ''
        let runBootstrap = ''
        if (flowSegment !== '') {
          const sessionKey = runtime.runs.latestSessionKeyOfFlow(flowSegment)
          if (sessionKey === undefined) {
            res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
            res.end(`${JSON.stringify({ ok: false, error: { code: 'FLOW_SESSION_MISSING', message: `agenticflow ${flowSegment} has no session yet; run it from the canvas first` } })}\n`)
            return
          }
          runBootstrap = `<script>window.__SOLOENGINE_RUN_FLOW__=${JSON.stringify(flowSegment)};window.__SOLOENGINE_RUN_SESSION__=${JSON.stringify(sessionKey)};</script>`
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(await render(runBootstrap))
      }
      const disposers = [
        ...PRODUCT_ROUTE_ROOTS.map(path => routeCtx.webServer.register({ kind: 'prefix', path, handler: page })),
        routeCtx.webServer.register({ kind: 'exact', path: '/', handler: page }),
      ]
      console.log(`soloengine: product surfaces mounted (/, ${PRODUCT_ROUTE_ROOTS.join(', ')})；运行面板按 /run/:agenticFlowId 区分 URL`)
      return () => { for (const dispose of disposers) dispose() }
    })
    return () => { void fiber.dispose() }
  }, 'soloengine-host.productSurfaces')

  ctx.logger?.info?.(
    `soloengine framework mounted at ${prefix} (db=${environment.path}, tables=${String(BUSINESS_TABLES.length)}, masterKey=${runtime.masterKey.created ? 'generated' : 'loaded'}, systemSeed=${seeded.created ? 'created' : 'present'})`,
  )

  if (config.printReady !== false) {
    const address = `http://${ctx.webServer.host}:${String(ctx.webServer.port)}`
    console.log(`soloengine: framework ready at ${address}${prefix}`)
  }
}
