/**
 * 运行档位的会话写入（PRD-10 FR-SEC-003/004/006）。
 *
 * **一个功能一个实现**：权限预设表由平台的 `permission-presets` 拥有（原生四档），第四档
 * `approve-for-me` 的规则/复核判定也在同一个原生实现体内；本产品**不重述预设表**、
 * 不另建平行权限服务、不注册第二个应答器。
 *
 * 本模块只做一件事：把画布选定的**原生预设名**经 `ctx.permissionPresets.set(session, name)` 写入
 * 该会话——落持久权限事件（`permission/preset` + 两个旋钮事件），因此重放可见、投影可读，会话内
 * 用平台自己的权限选择器切换走同一张表（FR-SEC-006）。
 *
 * 写入失败的语义是 fail loud：缺失服务或未知预设名在**创建运行前**抛错（`assertRunModeWritable`），
 * `set` 本身抛错也向上抛出——运行模式与权限档位不允许静默不一致。
 *
 * @module @soloengine/host/permission-allowlist
 */

import type { Context } from '@deepseek-ai/cordis'

/** `ctx.permissionPresets` 的最小可用面。 */
interface PermissionPresetFace {
  set?: (session: object, name: string) => void
  resolve?: (name: string) => unknown
}

/** 取平台权限预设服务（缺失即 undefined）。 */
function presetFace(ctx: Context): PermissionPresetFace | undefined {
  return ctx.get('permissionPresets') as PermissionPresetFace | undefined
}

/**
 * 创建运行前检查档位可写（fail loud）：服务缺失或预设名未注册时直接抛错。
 * @param ctx - 插件上下文。
 * @param preset - 画布选定的原生预设名。
 * @throws 权限预设服务缺失，或该名称不在预设表内。
 */
export function assertRunModeWritable(ctx: Context, preset: string): void {
  const face = presetFace(ctx)
  if (face?.set === undefined || face.resolve === undefined) {
    throw new Error(`soloengine: run mode "${preset}" cannot be written: the permission-presets service is absent in this composition`)
  }
  try {
    face.resolve(preset)
  } catch (error) {
    throw new Error(`soloengine: run mode "${preset}" is not a configured permission preset (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * 把画布档位（原生预设名）写入会话的权限预设。
 *
 * 预设名原样透传：可选项与呈现都归平台，产品只在运行发起时选一次默认档。
 * @param ctx - 插件上下文。
 * @param session - 原生会话（事件归属者）。
 * @param preset - 原生权限预设名（`workspace-write` / `approve-for-me` / `danger-full-access`）。
 * @returns 实际写入的预设名。
 * @throws 权限预设服务缺失或写入失败——调用方负责清理半创建的运行并向上抛出。
 */
export function applyRunModePreset(ctx: Context, session: object, preset: string): string {
  const face = presetFace(ctx)
  if (face?.set === undefined) {
    throw new Error(`soloengine: run mode "${preset}" cannot be written: the permission-presets service is absent in this composition`)
  }
  face.set(session, preset)
  console.log(`soloengine: permission preset written (${preset})`)
  return preset
}
