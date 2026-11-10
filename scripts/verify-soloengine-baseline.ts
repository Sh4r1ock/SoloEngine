/**
 * SoloEngine cordis 基线的零改动审计（Plan W1 / 框架设计 §四、§八）。
 *
 * 基线 = `packages/**` 中除 `packages/soloengine/**` 以外的包：出厂一份、永不被改动、
 * 是派生各 agenticflow 实例的「源」。冻结清单
 * `soloengine-framework/baseline/manifest.json` 记录每个包的决策、上游来源与内容摘要；
 * 本门禁逐包重算摘要，与清单比对，报告新增包、缺失包与被改动的包。
 *
 * 三个刻意的例外面（清单里显式记录，不靠约定）：
 * - **GENERATED 文件**：由 `gen-*` 脚本产出，改动的合法性由对应 `verify-*` 的复现性门禁裁决，
 *   不参与逐字比对（`generated` 字段）。
 * - **构建残留**：`src/` 下的 `.js` / `.d.ts`、sourcemap 与 tsbuildinfo 是构建产物，
 *   不参与比对；`node_modules`、`lib`、`dist` 等依赖/产物目录不遍历。
 * - **改造复用包**：`decision: "adapted"` 的包在清单里写明裁剪/文档改编的具体差异；
 *   `decision: "reuse"` 的包冻结时已与上游逐字一致。
 *
 * 用法：
 * - `pnpm run verify-soloengine-baseline`：默认校验，漂移即失败。
 * - `pnpm run verify-soloengine-baseline -- --record`：在**有意**变更基线包之后重算摘要
 *   （只更新已登记包的摘要与文件数；新增/删除包必须先改清单与台账）。
 *
 * @module scripts/verify-soloengine-baseline
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** 冻结清单的相对路径（相对仓库根）。 */
export const MANIFEST_PATH = 'soloengine-framework/baseline/manifest.json'

/** 产品自研包所在的顶层分组：不属于基线，不参与零改动比对。 */
export const PRODUCT_GROUP = 'soloengine'

/**
 * GENERATED 文件：内容由仓库内生成器产出，合法性由对应 `verify-*` 的复现性门禁裁决。
 *
 * 这些文件必须能在不读 `deepseek_harness` 的前提下由生成器复现；清单只登记路径，
 * 不冻结内容。
 */
export const GENERATED_FILES: readonly string[] = [
  'packages/core/session/src/known-event-types.ts',
  'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
  'packages/extensions/tool-cordis/src/api-catalog.ts',
  'packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md',
]

/** 不遍历的目录名（依赖、构建产物、缓存与版本库元数据）。 */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'lib',
  'dist',
  'coverage',
  '.turbo',
  '.git',
  '.dsh-build',
  '.cache',
])

/** 不参与比对的文件后缀（sourcemap、增量构建信息）。 */
export const IGNORED_SUFFIXES: readonly string[] = ['.map', '.tsbuildinfo']

/** 不参与比对的文件名（操作系统噪声）。 */
export const IGNORED_FILES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db'])

/** 基线包的一条冻结记录。 */
export interface BaselinePackageRecord {
  /** 仓库相对目录（POSIX 分隔符），如 `packages/api/gateway`。 */
  readonly dir: string
  /** 包名。 */
  readonly name: string
  /** 包版本。 */
  readonly version: string
  /** 处置决策：`reuse`（完全复用，冻结时与上游逐字一致）或 `adapted`（改造复用，差异见 `note`）。 */
  readonly decision: 'reuse' | 'adapted'
  /** 上游来源与版本（只作台账，审计不读取上游）。 */
  readonly upstream: string
  /** 与上游差异的说明；`reuse` 包为空。 */
  readonly note: string
  /** 参与摘要计算的文件数。 */
  readonly fileCount: number
  /** 文件集内容摘要：`sha256:` 前缀。 */
  readonly digest: string
}

/** 一个未进入基线的包（D1/D16 明确不带）。 */
export interface DroppedPackageRecord {
  /** 上游目录。 */
  readonly dir: string
  /** 包名。 */
  readonly name: string
  /** 版本。 */
  readonly version: string
  /** 处置依据（条款编号与理由）。 */
  readonly reason: string
}

/** 冻结清单。 */
export interface BaselineManifest {
  /** 清单结构版本。 */
  readonly version: 1
  /** 冻结日期（ISO 日期）。 */
  readonly frozenAt: string
  /** 上游发行版本（基线来源）。 */
  readonly upstreamRelease: string
  /** 上游来源说明（冻结时只读使用，之后可删除，不影响审计）。 */
  readonly upstreamSource: string
  /** GENERATED 文件（仓库相对路径，POSIX 分隔符）。 */
  readonly generated: readonly string[]
  /** 基线包（按目录排序）。 */
  readonly packages: readonly BaselinePackageRecord[]
  /** 产品自研包目录（不属于基线）。 */
  readonly product: readonly string[]
  /** 明确不带的包。 */
  readonly dropped: readonly DroppedPackageRecord[]
}

/** 一条审计问题。 */
export interface BaselineViolation {
  /** 问题类别。 */
  readonly kind: 'unregistered' | 'missing' | 'changed' | 'dropped-present' | 'product-missing' | 'product-unregistered'
  /** 涉及的包目录。 */
  readonly dir: string
  /** 面向操作者的说明。 */
  readonly detail: string
}

/**
 * 递归列出包目录内参与摘要的文件（仓库相对 POSIX 路径，已排序）。
 *
 * 跳过依赖/产物目录、GENERATED 文件、构建残留与 sourcemap；不跟随符号链接。
 * @param root - 仓库根目录。
 * @param dir - 包目录（仓库相对路径）。
 * @param generated - GENERATED 文件的仓库相对路径集合。
 * @returns 参与摘要的包内相对路径。
 */
export function listBaselineFiles(root: string, dir: string, generated: ReadonlySet<string>): string[] {
  const files: string[] = []
  const packageDir = join(root, dir)
  const walk = (absolute: string): void => {
    let entries
    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(absolute, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (IGNORED_FILES.has(entry.name)) continue
      const repoPath = relative(root, full).replaceAll('\\', '/')
      if (generated.has(repoPath)) continue
      if (IGNORED_SUFFIXES.some(suffix => repoPath.endsWith(suffix))) continue
      // `src/` 下的 .js/.d.ts 是历史 tsc 直排残留，不是包源。
      const inPackage = relative(packageDir, full).replaceAll('\\', '/')
      if (inPackage.startsWith('src/') && (inPackage.endsWith('.js') || inPackage.endsWith('.d.ts'))) continue
      files.push(inPackage)
    }
  }
  walk(packageDir)
  return files.sort()
}

/**
 * 计算一个包的内容摘要。
 *
 * 摘要 = sha256（按包内相对路径排序后逐行 `路径\0文件sha256\n` 拼接）。路径用 POSIX 分隔符，
 * 与操作系统无关；文件内容按字节读取，不做换行归一。
 * @param root - 仓库根目录。
 * @param dir - 包目录（仓库相对路径）。
 * @param generated - GENERATED 文件的仓库相对路径集合。
 * @returns 文件数与 `sha256:` 摘要。
 */
export function digestBaselinePackage(
  root: string,
  dir: string,
  generated: ReadonlySet<string>,
): { fileCount: number; digest: string } {
  const files = listBaselineFiles(root, dir, generated)
  const hash = createHash('sha256')
  for (const file of files) {
    const content = createHash('sha256').update(readFileSync(join(root, dir, file))).digest('hex')
    hash.update(`${file}\u0000${content}\n`)
  }
  return { fileCount: files.length, digest: `sha256:${hash.digest('hex')}` }
}

/**
 * 发现磁盘上的基线包与产品包目录。
 * @param root - 仓库根目录。
 * @returns 基线包目录与产品包目录（均按目录排序）。
 */
export function discoverPackages(root: string): { baseline: string[]; product: string[] } {
  const packagesRoot = join(root, 'packages')
  const baseline: string[] = []
  const product: string[] = []
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDir = join(packagesRoot, group.name)
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!existsSync(join(groupDir, entry.name, 'package.json'))) continue
      const dir = `packages/${group.name}/${entry.name}`
      if (group.name === PRODUCT_GROUP) product.push(dir)
      else baseline.push(dir)
    }
  }
  return { baseline: baseline.sort(), product: product.sort() }
}

/**
 * 读取冻结清单。
 * @param root - 仓库根目录。
 * @returns 清单对象。
 * @throws 当清单缺失或不是合法 JSON 时。
 */
export function loadManifest(root: string = ROOT): BaselineManifest {
  return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')) as BaselineManifest
}

/**
 * 校验当前工作树对冻结清单。
 * @param root - 仓库根目录。
 * @param manifest - 冻结清单。
 * @returns 全部问题；空数组表示零偏差。
 */
export function verifyBaseline(root: string, manifest: BaselineManifest): BaselineViolation[] {
  const generated = new Set(manifest.generated)
  const { baseline, product } = discoverPackages(root)
  const recorded = new Map(manifest.packages.map(entry => [entry.dir, entry]))
  const violations: BaselineViolation[] = []

  for (const dir of baseline) {
    const entry = recorded.get(dir)
    if (entry === undefined) {
      violations.push({
        kind: 'unregistered',
        dir,
        detail: 'package exists in the tree but is absent from the baseline manifest; record its decision and upstream source in the asset ledger and the manifest',
      })
      continue
    }
    const actual = digestBaselinePackage(root, dir, generated)
    if (actual.digest !== entry.digest) {
      violations.push({
        kind: 'changed',
        dir,
        detail: `baseline package content changed (frozen ${String(entry.fileCount)} files ${entry.digest}, now ${String(actual.fileCount)} files ${actual.digest}); restore the upstream content, or record the intended deviation as decision "adapted" with its note and re-freeze`,
      })
    }
  }
  for (const entry of manifest.packages) {
    if (!baseline.includes(entry.dir)) {
      violations.push({
        kind: 'missing',
        dir: entry.dir,
        detail: 'baseline package recorded in the manifest is missing from the tree',
      })
    }
  }
  for (const dir of product) {
    if (!manifest.product.includes(dir)) {
      violations.push({
        kind: 'product-unregistered',
        dir: dir,
        detail: 'product package is absent from the manifest product list; register it so the baseline/product split stays explicit',
      })
    }
  }
  for (const dir of manifest.product) {
    if (!product.includes(dir)) {
      violations.push({
        kind: 'product-missing',
        dir,
        detail: 'product package recorded in the manifest product list is missing from the tree',
      })
    }
  }
  for (const record of manifest.dropped) {
    if (existsSync(join(root, record.dir))) {
      violations.push({
        kind: 'dropped-present',
        dir: record.dir,
        detail: `package is recorded as dropped (${record.reason}) but exists on disk`,
      })
    }
  }
  return violations
}

/**
 * 按当前工作树重算已登记基线包的摘要（有意变更后的冻结更新）。
 *
 * 不新增、不删除条目：新增包必须先补台账与清单，删除包必须改成 `dropped`。
 * @param root - 仓库根目录。
 * @param manifest - 冻结清单。
 * @returns 更新后的清单（`packages` 保持原有顺序）。
 */
export function recordBaseline(root: string, manifest: BaselineManifest): BaselineManifest {
  const generated = new Set(manifest.generated)
  const packages = manifest.packages.map((entry) => {
    const actual = digestBaselinePackage(root, entry.dir, generated)
    return { ...entry, fileCount: actual.fileCount, digest: actual.digest }
  })
  return { ...manifest, packages }
}

/** CLI 入口：默认校验；`--record` 重算摘要并写回清单。 */
function main(): void {
  const record = process.argv.includes('--record')
  const manifest = loadManifest(ROOT)
  if (record) {
    const violations = verifyBaseline(ROOT, manifest).filter(item => item.kind !== 'changed')
    if (violations.length > 0) {
      for (const item of violations) console.error(`  ${item.dir}: ${item.detail}`)
      console.error('verify-soloengine-baseline: reconcile the manifest inventory before recording digests.')
      process.exit(1)
    }
    const updated = recordBaseline(ROOT, manifest)
    writeFileSync(join(ROOT, MANIFEST_PATH), `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    console.log(`verify-soloengine-baseline: recorded ${String(updated.packages.length)} baseline package digests.`)
    return
  }
  const violations = verifyBaseline(ROOT, manifest)
  if (violations.length === 0) {
    console.log(
      `verify-soloengine-baseline: ${String(manifest.packages.length)} baseline packages match the frozen manifest`
      + ` (${String(manifest.generated.length)} GENERATED files excluded, ${String(manifest.product.length)} product packages).`,
    )
    return
  }
  console.error('verify-soloengine-baseline: baseline drift detected.\n')
  for (const item of violations) console.error(`  [${item.kind}] ${item.dir}: ${item.detail}`)
  console.error('\nThe cordis baseline is factory-frozen: restore upstream content, or record the deviation in the manifest and the asset ledger.')
  process.exit(1)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
