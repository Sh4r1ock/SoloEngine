/**
 * `@soloengine/tools` —— SoloEngine 特有工具（完全自研，Host 面）。
 *
 * 依据 PRD-06 FR-ENG-031 与《SoloEngine Harness插件体系完整介绍》§五 tools：
 * 注册 dsh 工具面没有的运行诊断工具 `get_diagnostics`——查看当前运行时状态
 * （归属 agent、模型路由、会话规模、核心工具注册概况），全部取自真实运行时数据。
 *
 * 注册走官方 `ctx.tools.register(defineTool(...))`（effect-based，卸载即注销），
 * 呈现意图为纯函数；不改造任何 dsh 原生工具。
 *
 * @module @soloengine/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'soloengine-tools'
export const inject = ['tools', 'llm']

/** 诊断结果（模型可见的 canonical JSON；无值字段用空串/0 表示缺省）。 */
interface DiagnosticsValue {
  agent: {
    id: string
    parentId: string
    cwd: string
    depth: number
  }
  model: {
    provider: string
    model: string
    reasoningEffort: string
    maxTokens: number
  }
  session: {
    key: string
    lastSeq: number
    inheritedEvents: number
    events: number
  }
  tools: {
    visible: number
    names: string[]
  }
  route: {
    registered: boolean
    providerCount: number
  }
}

/**
 * 注册 SoloEngine 特有工具。
 * @param ctx - 插件上下文（必须注入 `tools`）。
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'get_diagnostics',
    description:
      'Report the current SoloEngine runtime state for THIS agent: owning agent identity, the model route it runs on, '
      + 'session size, and the set of tools it can currently see. Read-only; use it to check your own execution '
      + 'environment before assuming a capability is available.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              id: { type: 'string', required: true },
              parentId: { type: 'string', required: true },
              cwd: { type: 'string', required: true },
              depth: { type: 'integer', required: true },
            },
          },
          model: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              provider: { type: 'string', required: true },
              model: { type: 'string', required: true },
              reasoningEffort: { type: 'string', required: true },
              maxTokens: { type: 'integer', required: true },
            },
          },
          session: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              key: { type: 'string', required: true },
              lastSeq: { type: 'integer', required: true },
              inheritedEvents: { type: 'integer', required: true },
              events: { type: 'integer', required: true },
            },
          },
          tools: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              visible: { type: 'integer', required: true },
              names: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          route: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              registered: { type: 'boolean', required: true },
              providerCount: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `agent: ${value.agent.id}${value.agent.parentId === '' ? '' : ` (parent ${value.agent.parentId})`} depth=${String(value.agent.depth)} cwd=${value.agent.cwd === '' ? '(none)' : value.agent.cwd}`,
          `model: ${value.model.provider}/${value.model.model}${value.model.reasoningEffort === '' ? '' : ` effort=${value.model.reasoningEffort}`}${value.model.maxTokens === 0 ? '' : ` maxTokens=${String(value.model.maxTokens)}`}`,
          `session: ${value.session.key} lastSeq=${String(value.session.lastSeq)} events=${String(value.session.events)} inherited=${String(value.session.inheritedEvents)}`,
          `tools: ${String(value.tools.visible)} visible (${value.tools.names.join(', ')})`,
          `routes: ${value.route.registered ? 'registered' : 'not registered'} providers=${String(value.route.providerCount)}`,
        ].join('\n'),
      }],
    },
    execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('get_diagnostics requires an owning agent session')
      }
      const scope = scopeOf(agent.ctx)
      const visible = ctx.tools.schemas(scope).map(schema => schema.name).sort()
      const session = agent.session
      // 会话树深度按真实父链向上走：固定「有父 = 1」在孙级会话上会报错。
      const sessions = ctx.get('sessions') as {
        get?: (id: string) => { header: { parentSession?: string } } | undefined
      } | undefined
      const visited = new Set<string>()
      let depth = 0
      let cursor = session.header.parentSession === undefined ? undefined : String(session.header.parentSession)
      while (cursor !== undefined && !visited.has(cursor)) {
        visited.add(cursor)
        depth += 1
        cursor = sessions?.get?.(cursor)?.header.parentSession
      }
      const providers = ctx.llm.listProviders()
      const provider = agent.options.provider ?? ''
      const value: DiagnosticsValue = {
        agent: {
          id: String(session.id),
          parentId: session.header.parentSession === undefined ? '' : String(session.header.parentSession),
          cwd: session.header.cwd ?? '',
          depth,
        },
        model: {
          provider: agent.options.provider ?? '(unset)',
          model: agent.options.model ?? '(unset)',
          reasoningEffort: agent.options.reasoningEffort === undefined ? '' : String(agent.options.reasoningEffort),
          maxTokens: agent.options.maxTokens ?? 0,
        },
        session: {
          key: String(session.id),
          lastSeq: Number(session.seq),
          inheritedEvents: Number(session.inheritedEventCount),
          events: Number(session.seq) + 1,
        },
        tools: {
          visible: visible.length,
          names: visible,
        },
        route: {
          // 「已注册」= 该 agent 正在用的 provider 出现在 LLM 路由表里；不能用「有可见工具」冒充。
          registered: providers.some(entry => entry.id === provider),
          providerCount: providers.length,
        },
      }
      return Promise.resolve(value)
    },
  }))
}
