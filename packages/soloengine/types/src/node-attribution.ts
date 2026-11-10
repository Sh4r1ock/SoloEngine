/**
 * 画布节点归属事件（`soloengine/node-attribution`）声明。
 *
 * 委派子会话的归属（属于哪个画布节点、由哪个父节点委派）是**冷恢复**的重建依据：进程重启后
 * `send_message` 唤醒已持久化子会话时没有启动请求可携带产品组合，只能从子会话自己的日志读出
 * 节点归属，再按归属重放该节点的 persona/工具/技能/MCP/插件与实例作用域。
 *
 * 事件在子会话创建窗口内写一条（与 `subagent/descriptor` 同层，log-only、不进模型历史），
 * 不新建业务表、不落第二副本：画布/运行项目归属仍在 `soloengine/run-context`。
 *
 * `SessionEventMap` 的声明合并是官方明文支持的扩展路径（先例 `compaction/*`、`hook/*`），
 * 未声明的事件类型会被持久化读取路径拒绝重建会话——故本声明必须随包加载。
 *
 * @module @soloengine/types/node-attribution
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

/** 一条委派子会话的画布节点归属（事件数据体，whole-value、纯 JSON）。 */
export interface NodeAttributionRecord {
  /** 画布（agenticflow）标识；冷恢复时与当前运行的画布比对，不一致即拒绝重放。 */
  canvasId: string
  /** 该子会话在编译产物中的节点标识。 */
  agentId: string
  /** 委派该子会话的父节点标识。 */
  parentAgentId: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 一条委派子会话的画布节点归属（log-only：不进模型历史，供冷恢复重放节点组合）。 */
    'soloengine/node-attribution': {
      canvasId: string
      agentId: string
      parentAgentId: string
    }
  }
}

/** 事件表合并后的成员（编译期断言：声明确实随包加载）。 */
export type NodeAttributionEventEntry = SessionEventMap['soloengine/node-attribution']

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /**
     * 子会话的画布节点归属（宿主专用投影，无客户端线值）。
     *
     * 冷恢复读投影状态而不是同步扫描事件历史：投影由会话投影注册表折叠并缓存，
     * 未写入归属时为 null。
     */
    'soloengine.nodeAttribution': NodeAttributionRecord | null
  }
}

/** 投影状态合并后的成员（编译期断言：声明确实随包加载）。 */
export type NodeAttributionProjectionState = SessionProjectionStateMap['soloengine.nodeAttribution']
