/**
 * 运行上下文事件族与投影键声明（产品记录）。
 *
 * 一次运行发起时写一条 `soloengine/run-context` 持久事件（画布/运行项目归属、选定的原生权限
 * 预设名、实时跟随开关）；宿主侧注册 `soloengine.runContext` 投影把它折叠为只读视图；客户端经
 * 标准 `useProjection('soloengine.runContext')` 座位消费（跟随联动读开关）。不新建业务表、不自建
 * 事件通道、不落第二副本。
 *
 * `soloengine/run-context` 是 log-only 事件（不进模型历史）。官方 `SessionEventMap` 的声明
 * 合并是官方明文支持的扩展路径（先例 `compaction/*`、`hook/*`、`tool-workflow/*`），未声明
 * 的事件类型会被持久化读取路径拒绝重建会话——故本声明必须随包加载。
 *
 * @module @soloengine/types/run-context
 */

import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionMap, SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'

/**
 * 画布运行档位 = **原生权限预设名**（PRD-02 FR-CANVAS-015）。
 *
 * 不另立档位名：预设表与语义归平台的 `permission-presets`（白名单档由第三方插件声明）。
 */
export type RunMode = 'workspace-write' | 'approve-for-me' | 'danger-full-access'

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
