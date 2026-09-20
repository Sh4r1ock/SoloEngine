/**
 * 权限三档的会话档位写入（PRD-10 FR-SEC-003/004/006）。
 *
 * **四类档位（PRD-01 纪律）**：审批三档整体以第三方 DSH 插件为**实现主干**，SoloEngine 只做两件事：
 *
 * 1. **组合层**把「沙箱档位 + 审批策略」打包的预设表重述为四档（`read-only` / `workspace-write`
 *    / `approve-for-me` / `danger-full-access`，见 `cordis.patch.yml` 的 `permission` 行）——第三档
 *    由主干 `dsh-approve-for-me` 提供并在其 patch 层声明，本层整行重述以固定出厂取值；
 * 2. **会话档位**由画布运行模式经 `ctx.permissionPresets.set(session, name)` 写入（本模块）——
 *    落持久权限事件（`permission/preset` + 两个旋钮事件），因此重放可见、投影可读，
 *    `/permission` 切换与设置默认行走同一张预设表（FR-SEC-006）。
 *
 * **不另建平行权限服务**（FR-SEC-005）：白名单档的放行判定完全由主干在 `approval/request` 上完成
 * （确定性规则 + 可选审查模型 + 人类兜底），本层不注册第二个应答器；无应答者时由原生审批服务
 * 归一化为不可用并拒绝执行（fail-closed）。
 *
 * @module @soloengine/host/permission-allowlist
 */

import type { Context } from '@deepseek-ai/cordis'

/** 白名单档的预设名（由主干 `dsh-approve-for-me` 的 patch 层声明；主干按此名判定是否接管）。 */
export const ALLOWLIST_PRESET = 'approve-for-me'
/** 每次询问档的预设名（官方出厂表项）。 */
export const ASK_PRESET = 'workspace-write'
/** 自动档的预设名（官方出厂表项：全权沙箱 + 永不询问）。 */
export const AUTO_PRESET = 'danger-full-access'

/**
 * 画布运行模式（PRD-02 §9）→ 权限预设名（PRD-10 FR-SEC-003 三档对齐）。
 * @param runMode - `ask` / `allowlist` / `auto`。
 * @returns 预设名。
 */
export function presetForRunMode(runMode: string): string {
  if (runMode === 'auto') return AUTO_PRESET
  if (runMode === 'allowlist') return ALLOWLIST_PRESET
  return ASK_PRESET
}

/** `ctx.permissionPresets` 的最小可用面。 */
interface PermissionPresetFace {
  set?: (session: object, name: string) => void
}

/**
 * 把画布运行模式写入会话的权限预设（PRD-10 FR-SEC-006：预设选择是仅入日志的用户意图）。
 * @param ctx - 插件上下文。
 * @param session - 原生会话（事件归属者）。
 * @param runMode - 画布运行模式（`ask` / `allowlist` / `auto`）。
 * @returns 实际写入的预设名。
 */
export function applyRunModePreset(ctx: Context, session: object, runMode: string): string {
  const preset = presetForRunMode(runMode)
  const face = ctx.get('permissionPresets') as PermissionPresetFace | undefined
  if (face?.set === undefined) {
    console.log(`soloengine: permission preset ${preset} for run mode ${runMode} was not written: the permission-presets service is absent in this composition`)
    return preset
  }
  try {
    face.set(session, preset)
    console.log(`soloengine: permission preset written (run mode ${runMode} → ${preset})`)
  } catch (error) {
    console.log(`soloengine: writing the permission preset ${preset} failed (${String(error)})`)
  }
  return preset
}
