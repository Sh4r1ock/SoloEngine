/**
 * 会话容器的命名与环境约定（执行器、出口边车、按会话路由的子进程提供方共用）。
 *
 * @module @soloengine/executor-container/naming
 */

/** 会话容器名缺省前缀。 */
export const DEFAULT_SESSION_CONTAINER_PREFIX = 'soloengine-session-'

/** 会话容器名环境变量：节点为每次 shell 调用注入，执行器据此把命令路由进容器。 */
export const CONTAINER_ENV_KEY = 'DSH_CONTAINER'

/** 会话工作区环境变量（宿主机绝对路径）；容器内映射为 {@link CONTAINER_WORKSPACE}。 */
export const CONTAINER_WORKSPACE_ENV_KEY = 'DSH_CONTAINER_WORKSPACE'

/** 容器内工作区挂载点。 */
export const CONTAINER_WORKSPACE = '/workspace'

/**
 * 由一个会话键推导容器名（节点与会话路由执行器共用同一约定）。
 *
 * 会话键可能含 Docker 名称不允许的字符；统一替换为 `-`，保证两侧得到同一个名字。
 * @param sessionKey - 会话键。
 * @param prefix - 名称前缀。
 * @returns 容器名。
 */
export function sessionContainerName(sessionKey: string, prefix = DEFAULT_SESSION_CONTAINER_PREFIX): string {
  return `${prefix}${sessionKey.replace(/[^A-Za-z0-9_.-]/gu, '-')}`
}
