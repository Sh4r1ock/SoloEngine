/**
 * 会话执行世界的公共生命周期（容器 B/C 档与全 VM D 档共用）。
 *
 * 两种后端各自负责创建与路由；暂停与销毁的失败语义完全相同：单条失败只记录，
 * 不阻断其余条目。集中在这里，避免两份逐字相同的循环。
 *
 * @module @soloengine/host/session-worlds
 */

/** 一条会话执行世界（执行器 + 可读名称）。 */
export interface SessionWorldEntry<E> {
  /** 执行器（容器或全 VM）。 */
  executor: E
  /** 路由事实（至少带名称，用于诊断）。 */
  route: { name: string }
}

/** 执行器需要暴露的生命周期操作。 */
export interface SessionWorldExecutor {
  /** 暂停（保留内存与执行态）。 */
  pause(): Promise<void>
  /** 销毁并释放资源（幂等）。 */
  destroy(): Promise<void>
}

/**
 * 暂停一个会话执行世界；未知会话是空操作，失败只记录。
 * @param entries - 会话键 → 执行世界。
 * @param sessionKey - 根会话键。
 * @param label - 诊断用后端名（`container` / `VM`）。
 * @param log - 诊断输出。
 */
export async function pauseSessionWorld<E extends SessionWorldExecutor>(
  entries: ReadonlyMap<string, SessionWorldEntry<E>>,
  sessionKey: string,
  label: string,
  log: (message: string) => void,
): Promise<void> {
  const entry = entries.get(sessionKey)
  if (entry === undefined) return
  try {
    await entry.executor.pause()
    log(`soloengine: session ${label} ${entry.route.name} paused`)
  } catch (error: unknown) {
    log(`soloengine: pausing session ${label} ${entry.route.name} failed: ${String(error)}`)
  }
}

/**
 * 销毁全部会话执行世界；失败逐条记录，不阻断其余销毁。
 * @param entries - 会话键 → 执行世界（条目会被清空）。
 * @param label - 诊断用后端名（`container` / `VM`）。
 * @param log - 诊断输出。
 */
export async function destroySessionWorlds<E extends SessionWorldExecutor>(
  entries: Map<string, SessionWorldEntry<E>>,
  label: string,
  log: (message: string) => void,
): Promise<void> {
  for (const [sessionKey, entry] of [...entries]) {
    entries.delete(sessionKey)
    try {
      await entry.executor.destroy()
    } catch (error: unknown) {
      log(`soloengine: destroying session ${label} ${entry.route.name} failed: ${String(error)}`)
    }
  }
}
