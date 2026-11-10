/**
 * 画布节点引用的 MCP 服务器 → agent 作用域的原生挂载（PRD-05 FR-MCP-005 / FR-MCP-006 / FR-MCP-008）。
 *
 * 形态：**复用平台的 MCP 连接器**（`@deepseek-ai/dsh-mcp-client`，与 ACP 会话侧同一实现），
 * 把框架层的行翻译成它的原生 config 后 `agentCtx.plugin(McpClient, config)` —— 不另写 MCP 客户端、
 * 不架协议转换层。翻译口径按 PRD-05 §6：stdio 的 `command/args/env/working_dir` → `command/args/env/cwd`；
 * HTTP 的 `url/headers` → `url/headers`。
 *
 * 三条纪律在代码里落实为：
 * - **FR-MCP-006 池外不入工具表**：只有该节点 `mcp_servers` 里列到的服务器才会挂进它的作用域，
 *   其余服务器一概不出现（同一服务器名可被不同 agent 各自挂载，作用域语义由 cordis 承担）。
 * - **FR-MCP-005 启用/停用热生效**：`is_active !== 1` 的服务器不挂；已挂的按周期同步卸载
 *   （`fiber.dispose()` → 平台连接器自己做世代回滚），全程免重启。
 * - **FR-MCP-008 单工具启停**：停用的工具在**注册前**就从连接器的工具清单里排除
 *   （`disabledTools`），模型可见集合与可调用集合同时收紧；另在**执行管道**保留一道守卫，
 *   覆盖「停用清单在挂载后变化」的窗口。启停变更会重挂该服务器的连接器 fiber 使注册生效。
 *
 * @module @soloengine/host/mcp-mount
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { FrameworkRuntime } from '@soloengine/framework'

/** 一条待挂载的会话作用域。 */
interface ScopeTarget {
  /** agent 作用域（挂载点，同时是登记的键——一次运行里主 agent 与各子 agent 各有自己的作用域）。 */
  agentCtx: Context
  /** 归属用户（解析服务器行时按它做归属过滤，不跨越用户）。 */
  userId: string
  /** 该节点引用的服务器名（编译产物携带）。 */
  serverNames: readonly string[]
  /** 会话键（日志用：同一会话可有多个作用域，故它不是键）。 */
  sessionKey: string
  /** 画布节点 id（日志用）。 */
  agentId: string
  /** 运行项目目录（stdio 的 cwd 兜底）。 */
  cwd: string
}

/** 一个作用域当前的挂载状态。 */
interface ScopeState {
  target: ScopeTarget
  /** 服务器名 → 已装载的连接器 fiber。 */
  mounted: Map<string, Fiber>
  /** 停用的工具（`<serverName>` → 原始工具名集合），由守卫在调用时读取。 */
  disabledTools: Map<string, Set<string>>
}

/** 工具的模型可见名前缀（平台契约：`mcp__<serverName>__<rawName>`）。 */
const TOOL_PREFIX = 'mcp__'

/**
 * 解析 JSON 数组文本（失败返回空数组；不抛错——数据形态问题不该在这里炸）。
 * @param text - 文本。
 * @returns 字符串数组。
 */
function parseJsonArray(text: string | null): string[] {
  if (text === null || text.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * 解析 JSON 对象文本（失败返回空对象）。
 * @param text - 文本。
 * @returns 字符串字典。
 */
function parseJsonObject(text: string | null): Record<string, string> {
  if (text === null || text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
  } catch {
    return {}
  }
}

/** MCP 挂载与热同步的执行器（一次运行一份，随运行域生命周期）。 */
export class McpMountSupervisor {
  /** 以**作用域对象**为键：一次运行里主 agent 与各子 agent 是彼此独立的作用域。 */
  private readonly scopes = new Map<Context, ScopeState>()

  /**
   * @param runtime - 框架层运行时（读 `mcp_servers` 行）。
   * @param log - 日志出口（实例日志）。
   */
  constructor(
    private readonly runtime: FrameworkRuntime,
    private readonly log: (message: string) => void,
  ) {}

  /**
   * 登记一个 agent 作用域并立即挂载它应当有的服务器。
   *
   * 登记时就在作用域上装**一道**守卫（作用域内唯一），它按当前停用清单判定调用是否放行；
   * 清单变化只需改 `disabledTools`，不必重装守卫。
   * @param target - 作用域目标。
   */
  async register(target: ScopeTarget): Promise<void> {
    const state: ScopeState = { target, mounted: new Map(), disabledTools: new Map() }
    this.scopes.set(target.agentCtx, state)
    // 作用域销毁即摘除登记（连接器 fiber 是它的子 fiber，随父一起卸载）。
    target.agentCtx.effect(() => () => { this.scopes.delete(target.agentCtx) })
    target.agentCtx.tools.guard((execution) => {
      for (const [serverName, disabled] of state.disabledTools) {
        if (disabled.size === 0) continue
        const prefix = `${TOOL_PREFIX}${serverName}__`
        if (!execution.name.startsWith(prefix)) continue
        const raw = execution.name.slice(prefix.length)
        if (disabled.has(raw)) {
          return `tool ${raw} of MCP server ${serverName} is disabled in this agent scope (PRD-05 FR-MCP-008)`
        }
      }
      return undefined
    })
    await this.syncOne(state)
  }

  /**
   * 同步**全部**已登记作用域（热启停的驱动口：周期调用即可让启停与工具开关生效）。
   *
   * @returns 本次同步的作用域数。
   */
  async syncAll(): Promise<number> {
    let count = 0
    for (const state of [...this.scopes.values()]) {
      try {
        await this.syncOne(state)
        count += 1
      } catch (error) {
        // 单个作用域的引用不一致（例如节点引用了已删除的服务器）不能中断其它作用域的热同步：
        // 这个周期任务每秒跑一次，一次抛出会让全实例的启停/工具开关全部停摆。
        this.log(`soloengine: mcp hot sync failed for ${state.target.agentId}@${state.target.sessionKey}: ${String(error)}`)
      }
    }
    return count
  }

  /**
   * 把一个作用域同步到「按当前行状态应当挂载的集合」。
   *
   * 停用的服务器被卸载（世代回滚由平台连接器完成）；新启用的被挂载；工具启停清单就地更新。
   * @param state - 作用域状态。
   */
  private async syncOne(state: ScopeState): Promise<void> {
    const { target } = state
    const label = `${target.agentId}@${target.sessionKey}`
    const desired = new Map<string, { config: McpClient.Config; disabled: Set<string> }>()
    for (const name of target.serverNames) {
      const row = await this.runtime.mcp.byNameScoped(target.userId, name)
      if (row === undefined) {
        // 编译产物引用了本用户看不到的服务器：这是组合不一致，按无回退纪律直接报出。
        throw new Error(`agent scope ${label} references MCP server "${name}", which is not visible to this user`)
      }
      if (row.is_active !== 1) continue // 停用即不挂（PRD-05 §5：该服务器工具世代回滚）。
      const disabled = new Set(await this.runtime.mcp.disabledTools(row.id))
      desired.set(name, {
        config: await this.buildConfig(name, row.id, target.cwd, [...disabled]),
        disabled,
      })
    }

    // 卸载不再应有的（含被停用与被删除的）。
    for (const [name, fiber] of [...state.mounted]) {
      if (desired.has(name)) continue
      void fiber.dispose()
      state.mounted.delete(name)
      state.disabledTools.delete(name)
      this.log(`soloengine: mcp server ${name} unmounted from ${label} (disabled or no longer referenced)`)
    }

    // 挂载新出现的；停用清单变了的重挂一次，让「注册前排除」对已有连接生效。
    for (const [name, entry] of desired) {
      const previous = state.disabledTools.get(name)
      if (previous !== undefined && state.mounted.has(name) && !sameToolSet(previous, entry.disabled)) {
        void state.mounted.get(name)?.dispose()
        state.mounted.delete(name)
        this.log(`soloengine: mcp server ${name} remounted into ${label} after its enabled-tool set changed`)
      }
      state.disabledTools.set(name, entry.disabled)
      if (state.mounted.has(name)) continue
      try {
        const fiber = await target.agentCtx.plugin(McpClient, entry.config)
        state.mounted.set(name, fiber)
        this.log(`soloengine: mcp server ${name} mounted into ${label} (tools appear as ${TOOL_PREFIX}${name}__<tool>)`)
      } catch (error) {
        // 服务器起不来不该拖垮整次运行（PRD-05 §5：崩溃/断线由连接器退避重连、调用期报结构化错误）。
        this.log(`soloengine: mcp server ${name} failed to mount into ${label}: ${String(error)}; the agent runs without its tools`)
      }
    }
  }

  /**
   * 把一行 MCP 记录翻译成连接器的原生 config。
   * @param name - 服务器名（模型可见名前缀）。
   * @param id - 服务器 ID（取传输子表用）。
   * @param cwd - 运行项目目录（stdio 的 cwd 兜底）。
   * @param disabledTools - 该服务器当前停用的原始工具名（注册前排除）。
   * @returns 连接器 config。
   */
  private async buildConfig(name: string, id: string, cwd: string, disabledTools: readonly string[]): Promise<McpClient.Config> {
    const row = await this.runtime.mcp.byIdRaw(id)
    if (row.transport_type === 'http') {
      const http = await this.runtime.mcp.http(id)
      const url = (http?.url ?? '').trim()
      if (url === '') throw new Error(`mcp server ${name} is HTTP but has no url`)
      const httpTimeoutMs = toolCallTimeoutMs(http?.timeout)
      return McpClient.Config({
        transport: 'streamable-http',
        serverName: name,
        url,
        headers: parseJsonObject(http?.headers ?? null),
        disabledTools: [...disabledTools],
        ...(httpTimeoutMs === undefined ? {} : { toolCallTimeoutMs: httpTimeoutMs }),
        // 起不来不拦运行：退避重连 + 调用期结构化错误（PRD-05 §5）。
        failOnStartupError: false,
      })
    }
    const stdio = await this.runtime.mcp.stdio(id)
    const command = (stdio?.command ?? '').trim()
    if (command === '') throw new Error(`mcp server ${name} is stdio but has no command`)
    const stdioTimeoutMs = toolCallTimeoutMs(stdio?.timeout)
    return McpClient.Config({
      transport: 'stdio',
      serverName: name,
      command,
      args: parseJsonArray(stdio?.args ?? null),
      env: parseJsonObject(stdio?.env ?? null),
      cwd: (stdio?.working_dir ?? stdio?.folder_path ?? '').trim() === '' ? cwd : String(stdio?.working_dir ?? stdio?.folder_path),
      disabledTools: [...disabledTools],
      ...(stdioTimeoutMs === undefined ? {} : { toolCallTimeoutMs: stdioTimeoutMs }),
      failOnStartupError: false,
    })
  }
}

/**
 * 把存储的秒级超时换算成连接器要求的毫秒值。
 *
 * `null`/缺省表示沿用连接器默认（60s）；其余按存储区间 1–600 秒换算，
 * 下限仍夹到 1 秒，避免历史脏值把超时压到 0。
 * @param timeout - 子表里的超时秒数。
 * @returns 毫秒超时；缺省时为 undefined。
 */
export function toolCallTimeoutMs(timeout: number | null | undefined): number | undefined {
  return timeout === null || timeout === undefined ? undefined : Math.max(1000, timeout * 1000)
}

/**
 * 比较两个停用工具集合是否相同。
 * @param left - 旧集合。
 * @param right - 新集合。
 * @returns 是否相同。
 */
function sameToolSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) if (!right.has(item)) return false
  return true
}
