/**
 * `open_preview` 工具：校验预览链接并把打开意图记入会话事件（PRD-06 FR-ENG-032）。
 *
 * 校验在工具边界完成（fail loud）：非法链接直接以工具错误返回，不写入会话日志。
 * 记录经官方 `session.append('soloengine/preview', …)`——log-only 事件，不进模型历史。
 *
 * @module @soloengine/open-preview/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'

/** 预览记录结果（模型可见的 canonical JSON）。 */
export interface PreviewToolValue {
  url: string
  title: string
  sessionId: string
  recorded: boolean
}

/**
 * 校验预览链接：必须是带主机名的 http/https 绝对地址。
 * @param raw - 模型给出的链接。
 * @returns 规范化后的 URL 文本。
 * @throws 链接非法（工具错误，直接交回模型）。
 */
export function validatePreviewUrl(raw: string): string {
  const text = raw.trim()
  if (text === '') throw new Error('open_preview requires a non-empty url')
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`open_preview url "${raw}" is not an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`open_preview url "${raw}" must use http or https (got ${parsed.protocol})`)
  }
  if (parsed.hostname === '') throw new Error(`open_preview url "${raw}" has no host`)
  return parsed.toString()
}

/**
 * 注册 `open_preview` 工具。
 * @param ctx - 插件上下文（必须注入 `tools`）。
 */
export function registerOpenPreviewTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'open_preview',
    description:
      'Record a preview link (for example a local service or artifact page you just started) so the run panel shows a '
      + 'clickable preview card. This records the intent only — it does not open a browser. Use it once per distinct link; '
      + 'recording the same link again refreshes it to the top of the list.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'Absolute http(s) URL of the preview.',
      },
      title: {
        type: 'string',
        description: 'Short human-readable title for the preview card.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          recorded: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Recorded preview ${value.url}${value.title === '' ? '' : ` ("${value.title}")`}.`,
      }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('open_preview requires an owning agent session')
      }
      const url = validatePreviewUrl(args.url)
      const title = args.title === undefined || args.title.trim() === '' ? url : args.title.trim()
      const sessionId = String(agent.session.id)
      agent.session.append('soloengine/preview', {
        url,
        title,
        sessionId,
      })
      return Promise.resolve({ url, title, sessionId, recorded: true })
    },
  }))
}
