/**
 * 运行上下文事件族与投影键声明（PRD-07 FR-UI-006）。
 *
 * 运行面板会话头的产品信息层级（当前项目、运行模式）以**原生形态**叠加：一次运行发起时
 * 写一条 `soloengine/run-context` 持久事件；宿主侧注册 `soloengine.runContext` 投影把它
 * 折叠为只读视图；客户端经标准 `useProjection('soloengine.runContext')` 座位消费。
 * 不新建业务表、不自建事件通道、不落第二副本。
 *
 * `soloengine/run-context` 是 log-only 事件（不进模型历史）。官方 `SessionEventMap` 的声明
 * 合并是官方明文支持的扩展路径（先例 `compaction/*`、`hook/*`、`tool-workflow/*`），未声明
 * 的事件类型会被持久化读取路径拒绝重建会话——故本声明必须随包加载。
 *
 * @module @soloengine/types/run-context
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

/** 画布全局运行模式（PRD-02 FR-CANVAS-015；与权限三档同值域）。 */
export type RunMode = 'ask' | 'allowlist' | 'auto'

/** 一次运行的上下文（`soloengine/run-context` 事件的数据体，whole-value、纯 JSON）。 */
export interface RunContextRecord {
  /** 画布（agenticflow）标识。 */
  canvasId: string
  /** 运行项目标识。 */
  projectId: string
  /** 运行项目目录（agent cwd 与沙箱工作区根）。 */
  projectDir: string
  /** 画布全局运行模式。 */
  runMode: RunMode
  /** 画布全局「实时跟随」开关。 */
  liveFollow: boolean
  /** 记录时刻（毫秒时间戳，取自事件 time）。 */
  at: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 一次运行的上下文（log-only：不进模型历史，仅供面板呈现）。 */
    'soloengine/run-context': {
      canvasId: string
      projectId: string
      projectDir: string
      runMode: RunMode
      liveFollow: boolean
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** 该会话的运行上下文（后写覆盖先写；未发起过运行即缺省为 null）。 */
    'soloengine.runContext': RunContextRecord | null
  }
  interface SessionProjectionMap {
    /** 客户端只读视图：与宿主状态同形（宿主权威）。 */
    'soloengine.runContext': RunContextRecord | null
  }
}

/** 事件表合并后的成员（编译期断言：声明确实随包加载）。 */
export type RunContextEventEntry = SessionEventMap['soloengine/run-context']

/** 投影状态合并后的成员（编译期断言：声明确实随包加载）。 */
export type RunContextProjectionState = SessionProjectionStateMap['soloengine.runContext']

/** 投影线值合并后的成员（客户端只读座位读到的类型）。 */
export type RunContextProjectionView = SessionProjectionMap['soloengine.runContext']
