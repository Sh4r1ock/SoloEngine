#!/usr/bin/env bash
# macOS 桌面产物构建脚本（PRD-11 FR-DEP-006）：只在 macOS 主机上执行。
#
# 用法：
#   DSH_DESKTOP_APP_ID=com.example.soloengine \
#   DSH_HOME="$HOME/.dsh" \
#   packaging/desktop/macos/build-macos.sh <打包产物的 profile 目录> [arm64|x64]
#
# 逐步 fail loud：任何一步失败立即退出，不产出半成品可用状态（与桌面壳的
# 「失败保留半成品、明确报错、可重试、不做任何形式的自动回滚」一致）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

PROFILE_FROM="${1:-}"
TARGET_ARCH="${2:-arm64}"

if [[ -z "$PROFILE_FROM" ]]; then
  echo "build-macos: usage: packaging/desktop/macos/build-macos.sh <打包产物的 profile 目录> [arm64|x64]" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos: this script requires a macOS build host (apps/desktop/scripts/package-target.ts rejects non-darwin hosts)" >&2
  exit 1
fi
if [[ -z "${DSH_DESKTOP_APP_ID:-}" ]]; then
  echo "build-macos: DSH_DESKTOP_APP_ID is required (reverse-DNS app id, e.g. com.example.soloengine)" >&2
  exit 1
fi

echo "build-macos: 1/4 固化 profile 与 agent 预设"
node packaging/desktop/prepare-profile.mjs --from "$PROFILE_FROM" --home "${DSH_HOME:-$HOME/.dsh}"

echo "build-macos: 2/4 内置运行时与离线依赖"
pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages
pnpm --filter @deepseek-ai/dsh-desktop run prepare:dsh

echo "build-macos: 3/4 产出 DMG + zip（签名 → 公证 → staple → 验证）"
pnpm --filter @deepseek-ai/dsh-desktop run "package:mac:${TARGET_ARCH}"

echo "build-macos: 4/4 复核签名与公证"
APP_PATH="$(find apps/desktop/.desktop-build/artifacts -maxdepth 2 -name '*.app' -print -quit || true)"
if [[ -n "$APP_PATH" ]]; then
  node apps/desktop/scripts/verify-macos-signature.mjs "$APP_PATH"
fi

echo "build-macos: done; artifacts under apps/desktop/.desktop-build/artifacts"
