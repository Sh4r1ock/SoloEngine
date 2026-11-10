/**
 * 容器沙箱提供方（W10.7 的沙箱座位）。
 *
 * 在容器执行形态下，执行边界是**每会话容器**：只读根、丢弃 capability、非 root、
 * 默认拒网。真正的包装（`docker exec` + 工作目录映射）发生在子进程接缝
 * （`@soloengine/subprocess-container`），因为只有子进程请求同时携带会话标识、工作目录
 * 与标准输入；本提供方负责的是沙箱座位本身：
 *
 * - 声明该组合的强制力为 `full`（文件效果由容器世界承担，而不是宿主进程沙箱）；
 * - 拒绝**无会话作用域**的调用——没有会话就没有容器，放行等于在宿主机上执行；
 * - 给沙箱消费者一份容器世界的拒绝方言（EACCES/EROFS/EPERM 文本）。
 *
 * 组合约束：必须与按会话路由的容器子进程提供方同时装载（宿主在装载后校验）。
 *
 * @module @soloengine/sandbox-container
 */

import { Context } from '@deepseek-ai/cordis'
import {
  SandboxProvider,
  SandboxUnavailableError,
} from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/** Cordis 插件名。 */
export const name = 'soloengine-sandbox-container'

/** 容器沙箱提供方。 */
export default class ContainerSandboxProvider extends SandboxProvider {
  /**
   * @param ctx - 插件上下文。
   */
  // oxlint-disable-next-line typescript/no-useless-constructor -- keeps the constructor parameter typed at this public boundary
  constructor(ctx: Context) {
    super(ctx)
  }

  /**
   * 声明一次会话执行由容器世界约束；无会话作用域的调用直接拒绝。
   * @param argv - 调用方即将执行的 argv（保持原样，包装在子进程接缝完成）。
   * @param policy - 本次执行的文件效果策略（必须带会话标识）。
   * @param signal - 取消信号。
   * @returns 原样 argv 与容器提供的完全强制力。
   */
  // oxlint-disable-next-line typescript/require-await -- async keeps the guard a rejection, not a synchronous throw
  async confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
    signal?.throwIfAborted()
    if (policy.sessionId === undefined) {
      throw new SandboxUnavailableError(
        policy.mode,
        'the container execution world is per session; an agentless call has no container to run in',
      )
    }
    return {
      argv: [...argv],
      enforcement: 'full',
      denialSignatures: ['permission denied', 'read-only file system', 'operation not permitted'],
      // 容器启动失败是基础设施错误（docker 缺失/守护进程不可达），由子进程接缝的
      // spawn 失败路径报出；这里不声明「运行器未执行」的 stderr 方言。
      runnerFailureRules: [],
    }
  }
}
