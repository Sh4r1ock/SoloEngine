/**
 * 运行驱动与产品会话记录投影（R210：从 `index.ts` 拆出）。
 *
 * 运行驱动把框架层的运行请求翻译成原生 harness 调用：每画布一份实例、每节点一个 agent
 * 作用域（persona 段 / 工具收紧 / 出边委派工具 / 该节点的 MCP），会话归属由调用方共享的
 * 派生索引承载。
 *
 * @module @soloengine/host/run-driver
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FlowInstanceRuntime, type FlowInstance } from '@soloengine/instance-runtime'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-skill'
import { FrameworkRuntime, FrameworkError, type RunDriver, type RunStartInput, type UsageRow } from '@soloengine/framework'
import { readStoredUsage } from './usage.ts'
import { McpMountSupervisor } from './mcp-mount.ts'
import { CloudLeaseError, CloudNodeRuntime } from './cloud-node.ts'
import { SessionContainers } from './cloud-containers.ts'
import { SessionVms } from './cloud-vms.ts'
import { WorkspaceSync } from './workspace-sync.ts'
import { applyRunModePreset, assertRunModeWritable } from './permission-allowlist.ts'
import type { AgentSpec, FollowIntentView, RunContextRecord, RunMode } from '@soloengine/types'
import {
  DEFAULT_LIVE_FOLLOW,
  DEFAULT_RUN_MODE,
  LEGACY_RUN_MODES,
  PERSONA_SECTION_ORDER,
  RUN_MODES,
} from './config.ts'

/** 模型路由按需同步面（由 `@soloengine/llm-db-adapter` 提供；未装载时省略）。 */
interface ModelSyncService {
  /** 立即探测并注册新增/变更的模型路由。 */
  syncNow(): Promise<void>
}

/**
 * 校验按需同步服务的最小结构（服务名是本插件与模型适配器之间的内部接缝）。
 * @param value - 注入得到的未知值。
 * @returns 是否可按需同步。
 */
function isModelSyncService(value: unknown): value is ModelSyncService {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'syncNow') === 'function'
}

/** 运行上下文的 zod 校验（持久投影缓存先验）。 */
const runContextSchema = zod.object({
  canvasId: zod.string(),
  projectId: zod.string(),
  projectDir: zod.string(),
  runMode: zod.enum(['workspace-write', 'approve-for-me', 'danger-full-access']),
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
 * 解析画布全局运行档位：缺省取原生默认档；R186 之前的持久化档位名按等价关系迁移，
 * 其余非法值 fail loud（无静默降级）。
 * @param raw - 编译产物携带的档位（可能缺省）。
 * @returns 合法档位（原生预设名）。
 */
export function resolveRunMode(raw: string | undefined): RunMode {
  if (raw === undefined) return DEFAULT_RUN_MODE
  const matched = RUN_MODES.find(mode => mode === raw)
  if (matched !== undefined) return matched
  // 旧画布数据（R186 之前）：ask→工作区可写、allowlist→白名单、auto→完全访问。
  const legacy = LEGACY_RUN_MODES[raw]
  if (legacy !== undefined) {
    console.log(`soloengine: canvas run mode "${raw}" is a legacy name; applying "${legacy}"`)
    return legacy
  }
  throw new Error(`soloengine: run mode "${raw}" is not one of ${RUN_MODES.join('|')}`)
}

/** 一个会话的画布节点归属（编译产物 agent_id 与画布父节点）。 */
export interface NodeAttribution {
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
    /** 云端节点运行时（云形态且配置了控制面时给出；单机形态省略）。 */
    cloud?: CloudNodeRuntime
    /** 会话容器管理器（`SOLOENGINE_EXECUTOR=container` 时给出）。 */
    containers?: SessionContainers
    /** 会话 VM 管理器（`SOLOENGINE_EXECUTOR=full-vm` 时给出）。 */
    vms?: SessionVms
    /** 工作区同步器（云形态且配置了对象存储时给出；W10.12）。 */
    workspace?: WorkspaceSync
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
  const cloud = options.cloud
  const sessionContainers = options.containers
  const sessionVms = options.vms
  const workspaceSync = options.workspace
  /** 会话 → 本地工作区目录（工作区同步的本地副本；子代理子会话按根会话归属）。 */
  const workspaceOfSession = new Map<string, string>()
  /**
   * 用量折叠缓存：会话键 → 持久化 revision + 派生行。
   *
   * revision 是持久化服务自己的变更令牌（同一服务实例内可比）：相等即可复用，
   * 免去每次打开页面都把所有会话日志重读一遍。
   */
  const usageCache = new Map<string, { revision: SessionPersistenceRevision; row: UsageRow }>()

  /**
   * 解析一条模型路由对应的模型名（缺失即 fail loud）。
   * @param userId - 该会话的归属用户：路由只在本人模型配置里解析。
   * @param route - 路由名 `soloengine-<id>`。
   * @param nodeId - 引用该路由的节点（错误信息用）。
   * @returns 模型名。
   */
  const modelOf = async (userId: string, route: string, nodeId: string): Promise<string> => {
    const row = await runtime.models.byId(userId, route.replace(/^soloengine-/u, ''))
    if (row === undefined) {
      throw new Error(`entry/node ${nodeId} references model route ${route}, whose config row is missing for this user`)
    }
    return row.model_name
  }

  /** MCP 挂载监督器（FR-MCP-005/006/008；在运行域内一份，随插件生命周期）。 */
  const mcpMounts = new McpMountSupervisor(runtime, (message) => { console.log(message) })

  /**
   * 每 agenticflow 一份 harness 实例（Plan W2）：实例作用域位于 agent 作用域之上，
   * 组合在实例内装载、随实例卸载级联撤销；基线全局注册不受影响。
   */
  const flows = new FlowInstanceRuntime(ctx)
  /** 会话 → 所属 flow 实例 id（会话销毁时释放该会话的持有）。 */
  const flowOfSession = new Map<string, string>()

  // 会话销毁即释放持有；最后一个持有者释放时实例整体卸载，实例内注册随作用域撤销。
  ctx.on('session/disposed', (session: Session) => {
    const key = String(session.id)
    // 销毁前把工作区最终状态提交到对象存储（W10.12）；恢复时只补缺失文件。
    const workspaceDir = workspaceOfSession.get(key)
    if (workspaceSync !== undefined && workspaceDir !== undefined) {
      workspaceOfSession.delete(key)
      void workspaceSync.save(key, workspaceDir).catch((error: unknown) => {
        ctx.logger.warn(`soloengine: saving the workspace for session ${key} failed: ${String(error)}`)
      })
    }
    // 暂停（W10.11）保留租约：同一会话的下一条提示仍由本节点冷恢复，不被其他节点接管。
    if (cloud !== undefined && !cloud.isPaused(key)) void cloud.release(key)
    if (sessionContainers !== undefined) void sessionContainers.pause(key)
    if (sessionVms !== undefined) void sessionVms.pause(key)
    const flowId = flowOfSession.get(key)
    if (flowId === undefined) return
    flowOfSession.delete(key)
    void flows.release(flowId).catch((error: unknown) => { ctx.logger.warn(error) })
  })

  if (workspaceSync !== undefined) {
    // 持久化屏障即提交点：随回合把工作区异步提交到对象存储（同一会话的连续提交自动合并）。
    ctx.on('session/flush', (session: Session) => {
      const key = rootSessionKey(ctx, session)
      const workspaceDir = workspaceOfSession.get(key)
      if (workspaceDir === undefined) return
      void workspaceSync.saveSoon(key, workspaceDir).catch((error: unknown) => {
        ctx.logger.warn(`soloengine: committing the workspace for session ${key} failed: ${String(error)}`)
      })
    })
  }

  if (sessionContainers !== undefined) {
    // 每次 shell 调用按会话注入容器事实；子代理子会话路由到根会话的容器。
    ctx.shellEnv.register({
      name: 'soloengine:session-container',
      variables: {
        DSH_CONTAINER: { description: 'Docker container executing this session (SoloEngine container executor).' },
        DSH_CONTAINER_WORKSPACE: {
          description: 'Host workspace path mounted at /workspace inside the session container.',
        },
      },
      resolve: (execution) => {
        const session = execution.agent?.session
        if (session === undefined) return {}
        const route = sessionContainers.route(rootSessionKey(ctx, session))
        return route === undefined
          ? {}
          : { DSH_CONTAINER: route.name, DSH_CONTAINER_WORKSPACE: route.workspace }
      },
    })
  }

  if (sessionVms !== undefined) {
    // 每次 shell 调用按会话注入 VM 事实；子代理子会话路由到根会话的 VM。
    ctx.shellEnv.register({
      name: 'soloengine:session-vm',
      variables: {
        DSH_VM_SSH_PORT: { description: 'Loopback SSH port forwarding to this session VM (SoloEngine full-VM executor).' },
        DSH_VM_SSH_KEY: { description: 'Private key used to enter this session VM.' },
        DSH_VM_SSH_USER: { description: 'Guest login user for this session VM.' },
        DSH_VM_WORKSPACE: { description: 'Host workspace path shared at /workspace inside the session VM.' },
      },
      resolve: (execution) => {
        const session = execution.agent?.session
        if (session === undefined) return {}
        const route = sessionVms.route(rootSessionKey(ctx, session))
        return route === undefined
          ? {}
          : {
            DSH_VM_SSH_PORT: String(route.sshPort),
            DSH_VM_SSH_KEY: route.sshKey,
            DSH_VM_SSH_USER: route.sshUser,
            DSH_VM_WORKSPACE: route.workspace,
          }
      },
    })
  }

  if (cloud !== undefined) {
    // 空闲暂停/驱逐的落点：断开该会话的 agent 句柄；区别只在租约——暂停保留、驱逐释放。
    const detach = async (sessionKey: string): Promise<boolean> => {
      const handle = handles.get(sessionKey)
      if (handle === undefined) return false
      handles.delete(sessionKey)
      await handle.dispose()
      return true
    }
    cloud.setEvictor(detach)
    cloud.setPauser(detach)
    // 最近活跃时间：会话事件是唯一真源，不另设心跳。
    ctx.on('session/event', (session: Session, event) => {
      cloud.noteActivity(String(session.id), Date.now())
      // 计量（W10.10）：provider 的一次回复对应一条 `assistant/message`，token 只取它上报的值。
      // 子代理子会话的用量归属根会话（一个画布运行 = 一个计费会话）。
      if (event.type !== 'assistant/message' || event.data.usage === undefined) return
      const usage = event.data.usage
      const tokens = usage.totalTokens ?? usage.inputTokens + usage.outputTokens
      if (!Number.isFinite(tokens) || tokens <= 0) return
      void cloud.reportUsage(rootSessionKey(ctx, session), tokens, Number(event.seq))
    })
  }

  /**
   * 把一个编译产物节点挂进该 flow 实例下的 agent scope：实例组合 + persona 段 + 工具收紧 +
   * 出边委派工具（每条边一个 Task 工具，PRD-06 FR-ENG-026）+ **该节点引用的 MCP 服务器**
   * （PRD-05 FR-MCP-006：池外不入工具表）。
   */
  const composeNode = async (
    agentCtx: Context,
    spec: AgentSpec,
    compiled: RunStartInput['compiled'],
    owner: { sessionKey: string; userId: string },
    flow: FlowInstance,
  ): Promise<void> => {
    // agent 作用域挂到本 flow 实例之下：实例层注册（工具/技能/提示词/MCP）对本次运行可见，
    // 各 flow 实例互不影响，基线全局注册保持原样（PRD-01 §实例隔离、Plan W2）。
    flow.bind(agentCtx)
    // 节点级插件：只挂进该 agent 作用域，随 agent 作用域撤销；流程级插件不在这里。
    if (spec.plugins.length > 0) {
      await flow.mountAgentEntries(agentCtx, spec.plugins.map(row => ({
        id: row.id,
        name: row.name,
        ...(row.config === undefined ? {} : { config: row.config }),
      })))
      console.log(`soloengine: node ${spec.agentId} mounted ${String(spec.plugins.length)} node-level plugin(s): `
        + spec.plugins.map(row => row.name).join(', '))
    }
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
      const childModel = await modelOf(owner.userId, child.modelRoute, child.agentId)
      // rc.2 起本地子级组合由所选 Agent Preset 提供（persona 与工具集都在 preset 内），
      // 委派 seam 不再接受逐次调用的 persona/toolFilter；此处只传模型路由与深度上限。
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
          const activation = await ctx.subagents.startActivation({
            provider: 'spawn',
            label: child.name,
            request: {
              prompt: [{ type: 'text', text: args.task }],
              parent,
              agentOptions: { provider: child.modelRoute, model: childModel },
            },
            signal: exec.signal,
            delivery: 'parent',
          })
          const childSessionId = String(activation.childId)
          attribution.set(childSessionId, { agentId: child.agentId, parentAgentId: spec.agentId })
          // 子代理子会话按会话树落同一条归属链（PRD-12 FR-STO-005：全部子会话归属到对应画布节点）。
          const parentRun = runContext.get(owner.sessionKey)
          if (parentRun !== undefined) {
            void runtime.runs.ledger.ensure({
              session_key: childSessionId,
              user_id: parentRun.userId,
              agentic_flow_id: parentRun.canvasId,
              run_project_id: parentRun.projectId,
              llm_config_id: child.modelRoute.replace(/^soloengine-/u, ''),
            }).catch((error: unknown) => {
              // 子会话归属行缺失只影响台账列举，子代理本身照常推进；失败必须可见。
              ctx.logger.error(`soloengine: writing the ledger row for subagent session ${childSessionId} failed`, error)
            })
            runContext.set(childSessionId, { ...parentRun, llmConfigId: child.modelRoute.replace(/^soloengine-/u, '') })
          }
          const result = await activation.result
          const text = result.output
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join('')
          return {
            childSessionId,
            stopReason: result.stopReason,
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
    // 画布工具目录是产品侧清单，组合才是可用工具的真源：不认识的名字在创建运行前以结构化错误
    // 点名（restrict 的原生报错带完整清单，这里只换成 422 的失败码，否则会变成一句 500）。
    try {
      if (inherited.length > 0) {
        agentCtx.tools.restrict({ allow: inherited })
      } else {
        // 节点只勾选了委派工具：把继承面全部关掉（deny 是唯一能表达「什么都不继承」的形式）。
        agentCtx.tools.restrict({ deny: ctx.tools.schemas().map(schema => schema.name) })
      }
    } catch (error) {
      throw new FrameworkError(
        422,
        'NODE_TOOLS_UNKNOWN',
        `node ${spec.agentId} selects tools this composition does not provide: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    // FR-SKILL-007（Must）：节点勾选的技能即该 agent 的可见集合，与全局池解耦。
    //
    // 目录与调用是同一个判据：原生 `SkillRegistry.restrict()` 把本作用域的模型可见目录
    // 收窄到勾选集合，`snapshot()/list()` 不出现未勾选项，`get()` 也拒绝它们——
    // 不再另加一层调用期 guard（同一功能只保留一个实现）。
    if (spec.skills.length > 0) {
      // 作用域 ctx 未把 skills 列入 inject（它由预设组合挂载），这里取绑定到本作用域的服务句柄。
      const skills = agentCtx.get('skills')
      if (skills === undefined) {
        throw new FrameworkError(500, 'NODE_SKILLS_UNAVAILABLE',
          `node ${spec.agentId} selects skills but this composition provides no skills service`)
      }
      console.log(`soloengine: node ${spec.agentId} skill scope restricted to (skills: ${[...spec.skills].join(', ')});`
        + ' the model-visible catalog and skill loader are both limited to this set (PRD-04 FR-SKILL-007)')
      agentCtx.effect(() => skills.restrict(spec.skills), 'soloengine:node-skill-scope')
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

  /**
   * 建/恢复一次运行的 mainagent：按画布实例装载组合，节点差异落 agent 作用域。
   *
   * `create` 新建会话；`resume` 从持久化会话日志冷恢复（进程重启、另一节点接管）。
   * 云形态下两者都先取得该会话的写租约——取不到即拒绝，不写别人的会话。
   * @param input - 驱动输入。
   * @param mode - 新建还是冷恢复。
   * @returns 入口 agent 标识。
   */
  const openSession = async (input: RunStartInput, mode: 'create' | 'resume'): Promise<{ mainAgentId: string }> => {
    // 模型路由按需同步：刚创建的模型不能落在 1 秒轮询的空窗里（首个模型调用会 NO_ADAPTER）。
    const modelSync: unknown = ctx.get('soloengineModelSync')
    if (isModelSyncService(modelSync)) await modelSync.syncNow()
    const mainSpec = input.compiled.agents.find(spec => spec.agentId === input.mainAgent.agentId)
    if (mainSpec === undefined) {
      throw new Error(`compiled product has no agent for entry node ${input.mainAgent.agentId}`)
    }
    if (cloud !== undefined) {
      // 节点本地准入（W10.3/W10.10）：容量/配额拒绝以 429/503 明确报出，不做静默排队。
      const admission = cloud.admit(input.sessionKey, input.userId)
      if (!admission.ok) {
        throw new FrameworkError(
          admission.code === 'OVERLOADED' ? 503 : 429,
          admission.code,
          admission.code === 'OVERLOADED'
            ? `node ${cloud.nodeId} is at capacity; retry after ${String(admission.retryAfterSeconds)}s`
            : `quota exceeded for user ${input.userId} (${admission.reason}); retry after ${String(admission.retryAfterSeconds)}s`,
        )
      }
      try {
        await cloud.acquire(input.sessionKey)
      } catch (error) {
        // 取不到租约：本次准入立即归还，不占用节点配额。
        await cloud.release(input.sessionKey)
        throw error
      }
    }
    if (workspaceSync !== undefined) {
      try {
        // 工作区权威副本（W10.12）：本地缺失的文件从对象存储补回；本地已有的一律保留。
        workspaceOfSession.set(input.sessionKey, input.cwd)
        await workspaceSync.restore(input.sessionKey, input.cwd)
      } catch (error) {
        if (cloud !== undefined) await cloud.release(input.sessionKey)
        throw error
      }
    }
    if (sessionContainers !== undefined) {
      try {
        // 每会话一容器（W10.7）：命令经按会话路由的子进程提供方进入该容器。
        await sessionContainers.ensure(input.sessionKey, input.cwd)
      } catch (error) {
        if (cloud !== undefined) await cloud.release(input.sessionKey)
        throw error
      }
    }
    if (sessionVms !== undefined) {
      try {
        // 每会话一台全 VM（D 档）：命令经 SSH 进入 guest。
        await sessionVms.ensure(input.sessionKey, input.cwd)
      } catch (error) {
        if (cloud !== undefined) await cloud.release(input.sessionKey)
        throw error
      }
    }
    // 运行档位（PRD-10 FR-SEC-006）：先解析并在创建运行前确认可写（fail loud），
    // 再把画布选定的原生预设名经权限预设原语写入本会话。
    const runMode = resolveRunMode(input.settings.run_mode)
    assertRunModeWritable(ctx, runMode)
    // 归属必须在建 agent 之前登记：构造期就会落事件（会话种子等），
    // 否则这些行会落到「以会话键兜底」的节点归属上。
    attribution.set(input.sessionKey, { agentId: mainSpec.agentId, parentAgentId: null })
    const ledgerRow = await runtime.runs.ledger.byKey(input.sessionKey)
    const canvasId = ledgerRow?.agentic_flow_id ?? ''
    runContext.set(input.sessionKey, {
      userId: input.userId,
      canvasId,
      projectId: ledgerRow?.run_project_id ?? '',
      llmConfigId: input.mainAgent.provider.replace(/^soloengine-/u, ''),
    })
    // 台账缺少画布归属时退回会话自身的实例，绝不让不同来源的会话共用一份实例。
    const flowId = canvasId === '' ? `session:${input.sessionKey}` : canvasId
    // 实例新增的宿主行（Plan W3）：该 flow 自己的插件，挂进实例作用域；客户端新增行由运行面板装载（W4）。
    // 这些行声明的「替换基线服务」在装载任何插件之前按 flow 隔离（Plan W2/R140）：同名服务在
    // 两个 flow 各有一份实现时互不撞「重复注册」，未列出的服务照旧继承基线。
    const instanceRows = input.instancePlugins
      .filter(row => row.origin === 'add' && row.kind === 'host' && !row.disabled)
    const additions = instanceRows
      .map(row => ({ id: row.id, name: row.name, ...(row.config === undefined ? {} : { config: row.config }) }))
    const isolateNames = [...new Set(instanceRows.flatMap(row => row.isolate ?? []))]
    const flow = flows.acquire(flowId, JSON.stringify({ preset: options.agentPreset, additions, isolateNames }))
    flowOfSession.set(input.sessionKey, flowId)
    let handle: Awaited<ReturnType<typeof ctx.agents.create>>
    try {
      // 隔离必须先于任何插件装载：预设与新增行都从这里派生，已激活的插件读不到后设的隔离。
      flow.isolate(isolateNames)
      // 该 flow 的组合基线只挂一次：同一画布的并发会话共享实例，preset 绑定按 flowKey 去重。
      await ctx.agentPresets.mount(flow.ctx, options.agentPreset)
      // 实例新增行随实例装载一次；装载失败（导入/激活）即拒绝本次运行，不静默降级。
      if (additions.length > 0 && flow.tree === undefined) await flow.mountEntries(additions)
      const agentOptions = {
        provider: input.mainAgent.provider,
        model: input.mainAgent.model,
        ...input.mainAgent.maxTokens === null ? {} : { maxTokens: input.mainAgent.maxTokens },
      }
      const setup = (agentCtx: Context): Promise<void> => composeNode(agentCtx, mainSpec, input.compiled, {
        sessionKey: input.sessionKey,
        userId: input.userId,
      }, flow)
      handle = mode === 'create'
        ? await ctx.agents.create({
          sessionId: SessionId(input.sessionKey),
          agentOptions,
          meta: { cwd: input.cwd, agentPreset: options.agentPreset },
          setup,
        })
        : await ctx.agents.resume({
          resumeSessionId: SessionId(input.sessionKey),
          agentOptions,
          setup,
        })
    } catch (error) {
      flowOfSession.delete(input.sessionKey)
      await flows.release(flowId)
      if (cloud !== undefined) await cloud.release(input.sessionKey)
      throw error
    }
    // 运行档位写入失败必须可见：撤掉半创建的 agent 与实例并向上抛出，
    // 不允许运行模式与权限档位静默不一致。
    try {
      applyRunModePreset(ctx, handle.agent.session, runMode)
    } catch (error) {
      flowOfSession.delete(input.sessionKey)
      await handle.dispose()
      await flows.release(flowId)
      if (cloud !== undefined) await cloud.release(input.sessionKey)
      throw error
    }
    handles.set(input.sessionKey, handle)
    // 运行上下文落日志（产品记录）：承载「实时跟随」开关与运行归属事实，供跟随联动在
    // 刷新/重启后重建（`soloengine.runContext` 投影，客户端只读）。
    const context = runContext.get(input.sessionKey)
    handle.agent.session.append('soloengine/run-context', {
      canvasId: context?.canvasId ?? '',
      projectId: context?.projectId ?? '',
      projectDir: input.cwd,
      runMode,
      liveFollow: input.settings.live_follow ?? DEFAULT_LIVE_FOLLOW,
    })
    // 就绪行（console：本 profile 未挂 logger-console，故可取证行一律走 console）。
    console.log(
      `soloengine: main agent ${mode === 'create' ? 'ready' : 'resumed'}`
      + ` (session=${input.sessionKey}, node=${mainSpec.agentId}, route=${mainSpec.modelRoute},`
      + ` tools=${String(mainSpec.tools.length)}, edges=${String(input.compiled.edges.length)})`,
    )
    return { mainAgentId: mainSpec.agentId }
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
      return await openSession(input, 'create')
    },
    async resume(input) {
      return await openSession(input, 'resume')
    },
    prompt(sessionKey, text) {
      // 云形态先确认本节点仍持有写租约：被接管/续约失败的节点不再接受推进请求
      // （写入侧另有 PG 后端的租约围栏兜底）。
      if (cloud !== undefined && !cloud.holds(sessionKey)) {
        throw new CloudLeaseError(
          sessionKey,
          'LEASE_HELD',
          `session ${sessionKey} is not leased to node ${cloud.nodeId}; refusing to prompt it`,
        )
      }
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
    async retire(sessionKey) {
      // 句柄只属于创建者：销毁即「停循环 → 冲持久化屏障 → 移除会话 → 触发 session/disposed」，
      // 此后框架层的实例持有也会随释放计数归零而卸载。
      const handle = handles.get(sessionKey)
      if (handle === undefined) return
      handles.delete(sessionKey)
      await handle.dispose()
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
    async usage(sessionKeys) {
      // 历史会话从持久化日志折叠（`ctx.sessions.list()` 只含本进程活会话，重启后会让
      // 历史用量凭空消失）。缓存按持久化 revision 失效：revision 不变即日志未变。
      const wanted = new Set(sessionKeys)
      const rows: UsageRow[] = []
      for (const snapshot of await ctx.sessionPersistence.list()) {
        const key = String(snapshot.header.id)
        if (!wanted.has(key)) continue
        const cached = usageCache.get(key)
        if (cached !== undefined && cached.revision === snapshot.revision) {
          rows.push(cached.row)
          continue
        }
        const row = await readStoredUsage(ctx.sessionPersistence, key)
        usageCache.set(key, { revision: snapshot.revision, row })
        rows.push(row)
      }
      return rows
    },
  }
}

/**
 * 解析节点标签（`k=v,k2=v2`）。
 * @param raw - 环境变量原文。
 * @returns 标签表。
 */
export function parseNodeLabels(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim() === '') return {}
  const labels: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const [key, value] = pair.split('=')
    if (key === undefined || value === undefined || key.trim() === '') {
      throw new Error(`soloengine: node label "${pair}" must be key=value`)
    }
    labels[key.trim()] = value.trim()
  }
  return labels
}

/**
 * 沿父会话链找到会话树的根：子代理子会话共享根会话的容器（每用户会话一容器）。
 * @param ctx - 带 `sessions` 服务的上下文。
 * @param session - 起始会话。
 * @returns 根会话键。
 */
export function rootSessionKey(ctx: Context, session: Session): string {
  let current = session
  for (let depth = 0; depth < 64; depth += 1) {
    const parent = current.header.parentSession
    if (parent === undefined) return String(current.id)
    const next = ctx.sessions.get(parent)
    if (next === undefined) return String(current.id)
    current = next
  }
  return String(current.id)
}
