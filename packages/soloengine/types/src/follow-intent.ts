/**
 * 工具呈现意图事件族与投影键声明（PRD-08 FR-OPS-011 / FR-OPS-004）。
 *
 * 「工具跟随联动」的事实源是**工具自己的呈现意图**（`ToolDefinition.presentCall` / `presentResult`），
 * 不是前端硬编码的「工具名 → 面板」映射表。官方契约把 `presentCall`/`presentResult` 定位为
 * **Host-local consumers** 的纯函数（内置 Web Client 不消费它们），故本层在 Host 侧消费：
 *
 * 1. 宿主监听 `tool/call`（携带 callId/name/arguments）→ `ctx.tools.get(name)` 取定义 →
 *    调 `presentCall(args)` 得到卡片判别联合（`generic` 含 `locations{path,line?}` / `terminal` / `diff`）；
 * 2. 把派生结果写成一条 `soloengine/follow` 持久事件（log-only）；
 * 3. 注册 `soloengine.followIntent` 投影折叠为只读视图；
 * 4. 客户端联动层读投影 → `ctx.sidebarRight.openResource/openTab` 打开或聚焦对应面板并定位。
 *
 * 新工具类型（含第三方 MCP 工具）只要自带定位元数据即自动生效——无需登记任何映射表。
 *
 * @module @soloengine/types/follow-intent
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

/** 呈现意图的卡片判别（与官方 `ToolCallView.card` 同值域）。 */
export type FollowCard = 'generic' | 'terminal' | 'diff'

/** 一个文件定位（与官方 `FileLocation` 同形）。 */
export interface FollowLocation {
  /** 文件路径（相对工作目录或绝对）。 */
  path: string
  /** 行号（可选）。 */
  line?: number | undefined
}

/** 一次工具调用的呈现意图（`soloengine/follow` 事件的数据体，whole-value、纯 JSON）。 */
export interface FollowIntentRecord {
  /** 工具调用标识（`tool/call` 的 callId）。 */
  callId: string
  /** 工具名（面板呈现用；**不是**分派依据）。 */
  toolName: string
  /** 呈现意图的卡片判别。 */
  card: FollowCard
  /** 需要定位的文件位置（可为空数组）。 */
  locations: FollowLocation[]
  /** 该调用发生在第几轮 / 第几步（面板定位到回合用）。 */
  turn: number
  step: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 一次工具调用的呈现意图（log-only：不进模型历史，仅供操作区联动）。 */
    'soloengine/follow': {
      callId: string
      toolName: string
      card: FollowCard
      locations: FollowLocation[]
      turn: number
      step: number
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** 最近一次呈现意图（后写覆盖先写；无调用即缺省为 null）。 */
    'soloengine.followIntent': FollowIntentView | null
  }
  interface SessionProjectionMap {
    /** 客户端只读视图：与宿主状态同形（宿主权威）。 */
    'soloengine.followIntent': FollowIntentView | null
  }
}

/** 投影视图：呈现意图 + 记录时刻（宿主权威、客户端只读）。 */
export interface FollowIntentView extends FollowIntentRecord {
  /** 记录时刻（毫秒时间戳，取自事件 time）。 */
  at: number
}

/** 事件表合并后的成员（编译期断言：声明确实随包加载）。 */
export type FollowEventEntry = SessionEventMap['soloengine/follow']

/** 投影状态合并后的成员。 */
export type FollowProjectionState = SessionProjectionStateMap['soloengine.followIntent']

/** 投影线值合并后的成员（客户端只读座位读到的类型）。 */
export type FollowProjectionView = SessionProjectionMap['soloengine.followIntent']
