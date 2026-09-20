/**
 * 预览记录的事件族与投影键声明（PRD-06 FR-ENG-032）。
 *
 * `soloengine/preview` 是**非 surface 事件**：官方 `SessionEventMap` 的声明合并是
 * 官方明文支持的扩展路径（先例 `compaction/*`、`hook/*`、`tool-workflow/*`），
 * 未声明的事件类型会被持久化读取路径拒绝重建会话——故本声明必须随包加载。
 *
 * @module @soloengine/open-preview/types
 */

/** 一条预览记录（`soloengine/preview` 事件的数据体，whole-value、纯 JSON）。 */
export interface PreviewRecord {
  /** 预览链接（模型为其启动的本地服务或产物页面）。 */
  url: string
  /** 可读标题（事件未带标题时以 URL 兜底，故恒为非空字符串）。 */
  title: string
  /** 记录该预览的会话标识。 */
  sessionId: string
  /** 记录时刻（毫秒时间戳，取自事件 time）。 */
  at: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** 一次预览打开意图（log-only：不进模型历史，仅供面板呈现）。 */
    'soloengine/preview': { url: string; title?: string; sessionId: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** 该会话的预览列表（新到旧、同链接去重置顶、上限 50 条）。 */
    'soloengine.openPreview': PreviewRecord[]
  }
  interface SessionProjectionMap {
    /** 客户端只读视图：与宿主状态同形（宿主权威）。 */
    'soloengine.openPreview': PreviewRecord[]
  }
}
