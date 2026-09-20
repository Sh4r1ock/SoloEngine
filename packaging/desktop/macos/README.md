# macOS 桌面产物：构建配置与脚本（仅交付）

> PRD-11 FR-DEP-006 / NFR-POR-004：**macOS DMG 只交付完整构建配置与脚本，不在本机（Windows）实测**；
> 本目录即该交付物，逐条指向平台里真实存在的配置与脚本（不另写第二套实现）。

## 前置条件（缺一不可，脚本会 fail loud）

| 项 | 说明 | 证据位置 |
|---|---|---|
| macOS 构建主机 | `package:mac:arm64` 需要 Apple Silicon；`package:mac:x64` 需要 Intel macOS 或 Rosetta | `apps/desktop/scripts/package-target.ts`（非 darwin 宿主直接抛错） |
| `DSH_DESKTOP_APP_ID` | 反向 DNS 形式的 appId（如 `com.example.soloengine`） | `apps/desktop/scripts/desktop-release-environment.mjs` |
| 签名身份与私钥 | Developer ID Application 证书 + TeamIdentifier 校验 | `apps/desktop/scripts/verify-macos-signature.mjs` |
| 公证凭据 | `@electron/notarize` 所需的环境（Apple ID / App Store Connect key） | `apps/desktop/scripts/desktop-release-environment.mjs` + `notarize-macos-disk-images.mjs` |
| 内置运行时与离线依赖 | `prepare:runtime` / `prepare:packages` / `prepare:dsh`（与 Windows 同一套，Node 归档按目标平台取） | `apps/desktop/scripts/prepare-*.ts` |

## 构建步骤（在 macOS 主机上执行）

```bash
# 1) 把云实例的打包产物固化进桌面 profile 与预设（同一份 profile，跨平台一致）
node packaging/desktop/prepare-profile.mjs --from <打包产物>/profile --home "$DSH_HOME"

# 2) 准备内置运行时与离线依赖（自带 Node 与 pnpm，目标机器无需开发环境）
pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages
pnpm --filter @deepseek-ai/dsh-desktop run prepare:dsh

# 3) 产出 DMG + zip（签名 → 公证 → staple → 验证，两路产物并发、全部成功才提升）
pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64     # 或 package:mac:x64
node apps/desktop/scripts/verify-macos-signature.mjs <产物.app>   # 可单独复核签名

# 4) 只验不签（无证书时的构建配置自查）
pnpm --filter @deepseek-ai/dsh-desktop run package:mac:arm64:dir  # 仅产出 .app 目录
```

## 交付边界（如实记录）

- 本仓库**不在 Windows 上构建 macOS 产物**：`package-target.ts` 会直接拒绝非 darwin 宿主；
  因此 macOS 的验收记录只包含「配置与脚本齐备 + 与 Windows 共用同一 profile/预设固化路径」，
  **不包含**本机实测的 DMG 与公证结果；该边界在 `test/soloengine/records/` 的验收记录里同样标注。
- 升级（壳 + 运行时 + 离线依赖同一签名单元）在 macOS 侧由 `dmg` + `zip`（更新载荷）+ 公证共同承担；
  差分与自动更新配置见 `apps/desktop/electron-builder.config.mjs`（`publish` 走 `resolveDesktopAutoUpdateConfig`）。
