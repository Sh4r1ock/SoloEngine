/**
 * 产品面接缝：设置桥与创造模式审计（《SoloEngine 框架设计》§6.4；PRD-06 创造模式）。
 *
 * 两件事都只做「原生机制 → 产品可见面」的翻译：设置走设置域的版本栅栏读写（产品页面
 * 自身的偏好存浏览器 localStorage，本桥接供第三方与部署方读取原生设置域），
 * 审计走官方 `cordis/*` 事件落 `creator_audit`。机制一份，不另建状态。
 *
 * @module @soloengine/host/product-surfaces
 */

import type { Context } from '@deepseek-ai/cordis'
// 模块声明：`ctx.settings` 与 `cordis/*` 事件在类型上可见。
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type { FrameworkRuntime } from '@soloengine/framework'
import {
  PRODUCT_SETTINGS_NAMESPACES,
  isProductSettingsNamespace,
  type ProductSettingsNamespace,
} from './config.ts'

/**
 * 把产品设置命名空间（`ui-theme` / `locale`）以同一 REST 前缀、同一鉴权暴露给调用方。
 *
 * 读走 `settings.describe`（含 revision），写走 `settings.update(ns, patch, revision)`
 * ——revision 不匹配由设置域自身拒绝（`SETTINGS_CONFLICT`），映射为 409。
 *
 * @param ctx - 已注入 `settings` 的上下文。
 * @param runtime - 框架层运行时（提供 `mountAuthenticated` 原生注入点）。
 */
export function mountProductSettings(ctx: Context, runtime: FrameworkRuntime): void {
  /** 读一个命名空间的当前值与版本。 */
  const descriptorOf = (namespace: ProductSettingsNamespace): { value: unknown; revision: number } => {
    const found = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === namespace)
    if (found === undefined) {
      throw new Error(`soloengine-host: settings namespace "${namespace}" is not registered in this composition`)
    }
    return { value: found.value, revision: found.revision }
  }
  /** 白名单拒绝的结构化响应。 */
  const unknownNamespace = (namespace: string): { status: number; body: unknown } => ({
    status: 404,
    body: {
      ok: false,
      error: {
        code: 'SETTINGS_NAMESPACE_UNKNOWN',
        message: `settings namespace "${namespace}" is not one of ${PRODUCT_SETTINGS_NAMESPACES.join('|')}`,
      },
    },
  })
  runtime.mountAuthenticated(
    {
      id: 'settings-read',
      method: 'get',
      path: '/settings/:namespace',
      summary: '读取产品设置命名空间（ui-theme / locale；含版本栅栏 revision）',
    },
    (req) => {
      const namespace = req.params.namespace ?? ''
      if (!isProductSettingsNamespace(namespace)) return Promise.resolve(unknownNamespace(namespace))
      const descriptor = descriptorOf(namespace)
      return Promise.resolve({ body: { ok: true, namespace, value: descriptor.value, revision: descriptor.revision } })
    },
  )
  runtime.mountAuthenticated(
    {
      id: 'settings-write',
      method: 'put',
      path: '/settings/:namespace',
      summary: '写入产品设置命名空间（版本栅栏：并发写拒绝；mode=merge|replace）',
    },
    async (req) => {
      const namespace = req.params.namespace ?? ''
      if (!isProductSettingsNamespace(namespace)) return unknownNamespace(namespace)
      const body = req.body as { value?: unknown; revision?: unknown; mode?: unknown }
      if (body.value === null || typeof body.value !== 'object' || Array.isArray(body.value)) {
        return {
          status: 400,
          body: { ok: false, error: { code: 'SETTINGS_VALUE_INVALID', message: 'value must be a JSON object' } },
        }
      }
      if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: 'SETTINGS_REVISION_REQUIRED', message: 'revision (the descriptor revision you read) is required' },
          },
        }
      }
      if (body.mode !== undefined && body.mode !== 'merge' && body.mode !== 'replace') {
        return {
          status: 400,
          body: {
            ok: false,
            error: { code: 'SETTINGS_MODE_INVALID', message: 'mode must be merge (default) or replace' },
          },
        }
      }
      try {
        // merge = 设置域的 update（只覆盖给定键）；replace = 整体替换用户段。
        if (body.mode === 'replace') await ctx.settings.replace(namespace, body.value, body.revision)
        else await ctx.settings.update(namespace, body.value, body.revision)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'SETTINGS_CONFLICT') {
          return {
            status: 409,
            body: { ok: false, error: { code: 'SETTINGS_CONFLICT', message: (error as Error).message } },
          }
        }
        // 其余（schema 校验失败等）结构化报出，不吞不降级。
        return {
          status: 400,
          body: { ok: false, error: { code: 'SETTINGS_WRITE_REJECTED', message: (error as Error).message } },
        }
      }
      const descriptor = descriptorOf(namespace)
      return { body: { ok: true, namespace, value: descriptor.value, revision: descriptor.revision } }
    },
  )
  console.log(`soloengine: product settings bridged (${PRODUCT_SETTINGS_NAMESPACES.join(', ')})`)
}

/**
 * 创造模式审计：官方 `cordis/*` 事件 → `creator_audit`（每个动作一条，含失败）。
 * @param ctx - 插件上下文（`cordis/*` 事件）。
 * @param runtime - 框架层运行时（审计落库与归属解析）。
 */
export function attachCreatorAudit(ctx: Context, runtime: FrameworkRuntime): void {
  ctx.on('cordis/request-run', (request) => {
    void (async () => {
      await runtime.runs.recordCreatorAudit({
        kind: 'request-run',
        userId: await runtime.runs.ownerOf(String(request.agentId)),
        ok: !request.requiresApproval,
        detail: JSON.stringify({
          requestId: String(request.requestId),
          pluginId: String(request.pluginId),
          packageId: String(request.packageId),
          mode: request.mode,
          name: request.name,
          requiresApproval: request.requiresApproval,
        }),
      })
    })()
  })
  ctx.on('cordis/request-run-resolved', (resolved) => {
    void (async () => {
      await runtime.runs.recordCreatorAudit({
        kind: 'request-run-resolved',
        userId: null,
        ok: resolved.outcome === 'completed',
        detail: JSON.stringify({ requestId: String(resolved.requestId), outcome: resolved.outcome }),
      })
    })()
  })
  ctx.on('cordis/dynamic-package', (pkg) => {
    void (async () => {
      await runtime.runs.recordCreatorAudit({
        kind: 'dynamic-package',
        userId: null,
        ok: true,
        detail: JSON.stringify({
          pluginId: String(pkg.pluginId),
          packageId: String(pkg.packageId),
          pluginRunId: String(pkg.pluginRunId),
          name: pkg.name,
        }),
      })
    })()
  })
  ctx.on('cordis/dynamic-retract', (retracted) => {
    void (async () => {
      await runtime.runs.recordCreatorAudit({
        kind: 'dynamic-retract',
        userId: null,
        ok: true,
        detail: JSON.stringify({
          pluginId: String(retracted.pluginId),
          packageId: String(retracted.packageId),
          pluginRunId: String(retracted.pluginRunId),
        }),
      })
    })()
  })
}
