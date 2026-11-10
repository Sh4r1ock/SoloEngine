#!/usr/bin/env node
/**
 * patch 命中审计（《SoloEngine 框架设计》§2.2 组合硬纪律 5）。
 *
 * 平台的「patch 未命中」只**告警**不报错：`cordis.patch.yml` 里写错一个 id、或写对一个 id 但把
 * config 写成不会被应用的样子，启动一切正常，只是那行改动**静默地没生效**。这类静默失效靠读文件
 * 看不出来，必须拿**组合后的真实结果**比。
 *
 * 审计做法（两个真实组合，全部由平台自己解析）：
 * - **有本层**：`dsh --profile <合成profile> --dump-config`（bundles = 交付清单）
 * - **无本层**：同一份清单**去掉 `@soloengine/host`** 再 dump（= 只剩基线与第三方层）
 *
 * 判定（每条都以「组合结果」为准，不读源码语义）：
 * 1. **insert 行**：必须出现在「有本层」里；且必须**不出现**在「无本层」里（否则是重复注册）。
 * 2. **patch 行**：必须**同时**出现在两侧（证明它确实在覆写一条已有行，而不是插了个新行）。
 * 3. **patch 真的生效**：本层声明的 `disabled` 必须与组合结果一致（`!!js` 表达式在 dump 里保留原文、
 *    不求值，故只校验该键仍是布尔位或表达式）；本层声明的 `config` 必须与组合结果**整体相等**
 *    （patch 是整行替换，不做深合并）。`!!js` 表达式在组合结果里已被求值，故只校验键位存在
 *    （值由表达式决定，不能字面比较）。
 *
 * 退出码：有任一判定不成立即 1（fail loud）。
 *
 * 用法：node profiles-templates/audit-patch-hits.mjs [--json]
 *
 * @module profiles-templates/audit-patch-hits
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isJsExpr, loadCordisYaml } from '../scripts/cordis-yaml.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
/** 被审计的本层 patch 文件（组合层的代码真源）。 */
/**
 * 被审计的本层 patch 文件。
 *
 * 默认是交付层的真源；`SOLOENGINE_PATCH_AUDIT_FILE` 允许指向另一份文件，供**反向对照**使用
 * （拿一份故意写错 id 的副本喂进来，审计必须报 MISS 并非零退出——审计没有反向对照就等于没审计）。
 */
const LAYER_PATCH = process.env.SOLOENGINE_PATCH_AUDIT_FILE ?? join(REPO_ROOT, 'packages', 'soloengine', 'host', 'cordis.patch.yml')
/** bundle 清单模板（唯一真源）。 */
const BUNDLES_TEMPLATE = join(HERE, 'bundles.json')
/** 审计用的临时 home（跑完即删；不碰实例 home）。 */
const WORK_HOME = join(REPO_ROOT, 'test', 'logs', 'patch-audit-home')
/** 承载本层的 bundle 名：去掉它即得到「无本层」基线。 */
const LAYER_BUNDLE = '@soloengine/host'
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts')

/**
 * 读一个 profile 的 bundle 清单。
 * @returns bundle 名数组与 patchReload 取值。
 */
function readBundlesTemplate() {
  const parsed = JSON.parse(readFileSync(BUNDLES_TEMPLATE, 'utf8'))
  if (!Array.isArray(parsed?.bundles) || parsed.bundles.length === 0) {
    throw new Error(`${BUNDLES_TEMPLATE} declares no bundles`)
  }
  return { bundles: parsed.bundles.map(String), patchReload: String(parsed.patchReload ?? 'live') }
}

/**
 * 解析本层 patch 文件，分出 insert 行与 patch 行。
 *
 * YAML 读取与 `!!js` 语义复用 `scripts/cordis-yaml.mjs`（与 TS 门禁同一份实现，
 * 组合文件里的 `!!js` 是合法语法，审计必须能**读全**它而不是报未知标签）。
 * @returns `{ inserts, patches }`，各自为行对象数组。
 */
function readLayerPatch() {
  const parsed = loadCordisYaml(readFileSync(LAYER_PATCH, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error(`${LAYER_PATCH} must be a YAML array`)
  const inserts = []
  const patches = []
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') continue
    if (Array.isArray(entry.insert)) inserts.push(...entry.insert)
    else if (entry.id !== undefined) patches.push(entry)
  }
  return { inserts, patches }
}

/**
 * 建一个临时 profile 并让 bundle 可解析（junction 链入，不复制）。
 * @param name - profile 名。
 * @param bundles - bundle 清单。
 * @param patchReload - patchReload 取值。
 */
function writeProfile(name, bundles, patchReload) {
  const dir = join(WORK_HOME, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    packageManager: JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).packageManager,
    dsh: { profile: { bundles, patchReload } },
  }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
}

/** 把工作区包与第三方层链入临时 home 的 `profiles/node_modules`（与实例同形）。 */
function wireLinks() {
  const modules = join(WORK_HOME, 'profiles', 'node_modules')
  mkdirSync(modules, { recursive: true })
  const soloengine = ['host', 'llm-db-adapter', 'tools', 'open-preview', 'types', 'agent-compiler',
    'ui-theme', 'ui-conversation', 'client-bootstrap', 'browser-proxy',
    'ui-document-editor', 'ui-operation-area']
  for (const name of soloengine) {
    const target = name === 'agent-compiler'
      ? join(REPO_ROOT, 'packages', 'soloengine', name)
      : join(REPO_ROOT, 'packages', 'soloengine', name)
    if (!existsSync(target)) continue
    const link = join(modules, '@soloengine', name)
    mkdirSync(dirname(link), { recursive: true })
    rmSync(link, { recursive: true, force: true })
    symlinkSync(target, link, 'junction')
  }
  const instanceModules = join(REPO_ROOT, 'data', 'dsh-home', 'profiles', 'soloengine', 'node_modules')
  for (const name of ['@anionex/dsh-turn-rewind']) {
    const target = join(instanceModules, name)
    if (!existsSync(target)) continue
    const link = join(modules, name)
    mkdirSync(dirname(link), { recursive: true })
    rmSync(link, { recursive: true, force: true })
    symlinkSync(target, link, 'junction')
  }
}

/**
 * 跑一次平台自己的组合解析。
 * @param name - profile 名。
 * @returns 组合结果（行数组）与原始输出。
 */
function dumpConfig(name) {
  const result = spawnSync('node', ['--import', 'tsx/esm', CLI_ENTRY, '--profile', name, '--dump-config'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DSH_HOME: WORK_HOME,
      SOLOENGINE_ROOT: REPO_ROOT,
      SOLOENGINE_DB: join(REPO_ROOT, 'data', 'database', 'soloengine.db'),
      SOLOENGINE_KEYS_DIR: join(REPO_ROOT, 'data', 'home', 'keys'),
      SOLOENGINE_SKILLS_DIR: join(REPO_ROOT, 'data', 'skills'),
      DSH_TELEMETRY_DISABLED: '1',
    },
    encoding: 'utf8',
    timeout: 180_000,
  })
  if (result.status !== 0) {
    throw new Error(`dump-config failed for profile ${name} (exit ${String(result.status)}): ${result.stderr.trim().split(/\r?\n/u).slice(-4).join(' | ')}`)
  }
  // 平台输出可能带 UTF-8 BOM（经 shell 管道时尤其常见）；YAML 解析器会把 BOM 当正文而报
  // 「end of the stream or a document separator is expected」，故先剥掉（只剥首个字符）。
  const rows = loadCordisYaml(result.stdout.replace(/^\uFEFF/u, ''))
  if (!Array.isArray(rows)) throw new Error(`dump-config output for ${name} is not a YAML array`)
  return rows
}

/**
 * 判断本层声明的一个值是否与组合结果一致。
 *
 * `!!js` 表达式在组合结果里已被求值：只校验键位存在（表达式结果由运行时环境决定，
 * 拿源码与求值结果做字面比较没有意义，也会误判）。
 * @param declared - 本层声明的值。
 * @param actual - 组合结果里的值。
 * @param path - 当前键路径（用于报错定位）。
 * @returns 差异描述数组（空数组即一致）。
 */
function compare(declared, actual, path) {
  if (isJsExpr(declared)) {
    return actual === undefined ? [`${path}: 组合结果缺少该键（本层声明为 !!js 表达式）`] : []
  }
  if (Array.isArray(declared)) {
    if (!Array.isArray(actual)) return [`${path}: 期望数组，组合结果为 ${JSON.stringify(actual)}`]
    const diffs = []
    // 数组里可能含 !!js 元素：逐个比较，长度不等即差异。
    if (declared.length !== actual.length) {
      diffs.push(`${path}: 元素数 ${String(declared.length)} != ${String(actual.length)}`)
    }
    const length = Math.min(declared.length, actual.length)
    for (let index = 0; index < length; index += 1) {
      diffs.push(...compare(declared[index], actual[index], `${path}[${String(index)}]`))
    }
    return diffs
  }
  if (declared !== null && typeof declared === 'object') {
    if (actual === null || typeof actual !== 'object') return [`${path}: 期望对象，组合结果为 ${JSON.stringify(actual)}`]
    const diffs = []
    for (const key of Object.keys(declared)) {
      diffs.push(...compare(declared[key], actual[key], `${path}.${key}`))
    }
    return diffs
  }
  return declared === actual ? [] : [`${path}: 期望 ${JSON.stringify(declared)}，组合结果为 ${JSON.stringify(actual)}`]
}

const { bundles, patchReload } = readBundlesTemplate()
const { inserts, patches } = readLayerPatch()
const findings = []
const summary = { inserts: inserts.length, patches: patches.length }

rmSync(WORK_HOME, { recursive: true, force: true })
mkdirSync(WORK_HOME, { recursive: true })
wireLinks()
writeProfile('audit-composed', bundles, patchReload)
writeProfile('audit-baseline', bundles.filter(name => name !== LAYER_BUNDLE), patchReload)

const composedRows = dumpConfig('audit-composed')
const baselineRows = dumpConfig('audit-baseline')
const composed = new Map(composedRows.map(row => [String(row?.id ?? ''), row]))
const baseline = new Map(baselineRows.map(row => [String(row?.id ?? ''), row]))
summary.composedRows = composed.size
summary.baselineRows = baseline.size

// 判定 1：insert 行必须只在「有本层」出现。
for (const row of inserts) {
  const id = String(row.id ?? '')
  if (id === '') { findings.push('insert 行缺少 id'); continue }
  if (!composed.has(id)) findings.push(`insert ${id}: 组合结果里没有这一行（未生效）`)
  if (baseline.has(id)) findings.push(`insert ${id}: 基线（无本层）里已存在同名行——重复注册风险`)
}

// 判定 2/3：patch 行必须覆写到一条两侧都有的行，且声明内容真的落进组合结果。
for (const row of patches) {
  const id = String(row.id ?? '')
  if (id === '') { findings.push('patch 行缺少 id'); continue }
  if (!baseline.has(id)) {
    findings.push(`patch ${id}: 基线里没有这条 id——它其实是个 insert（patch 静默未命中）`)
    continue
  }
  if (!composed.has(id)) { findings.push(`patch ${id}: 组合结果里丢掉了这条 id`); continue }
  const actual = composed.get(id)
  if (row.disabled !== undefined) {
    if (isJsExpr(row.disabled)) {
      // `--dump-config` 保留表达式原文、不求值：源码与结果无可比性，只要求该键仍是布尔位或表达式。
      if (typeof actual.disabled !== 'boolean' && !isJsExpr(actual.disabled)) {
        findings.push(`patch ${id}: disabled 声明为 !!js 表达式，组合结果却是 ${JSON.stringify(actual.disabled)}`)
      }
    } else if (actual.disabled !== row.disabled) {
      findings.push(`patch ${id}: disabled 期望 ${JSON.stringify(row.disabled)}，组合结果为 ${JSON.stringify(actual.disabled)}`)
    }
  }
  if (row.config !== undefined) {
    // 整行替换语义：组合结果里该行的 config 必须与本层声明**整体相等**。
    const diffs = compare(row.config, actual.config ?? null, `${id}.config`)
    findings.push(...diffs)
  }
}

// 清单：给文档与取证用（机器生成，不手抄——手抄的清单必然与组合结果分叉）。
const inventory = {
  /** 基线（无本层）里被本层覆写的行 id。 */
  patched: patches.map(row => String(row.id ?? '')),
  /** 本层新增的行 id。 */
  inserted: inserts.map(row => String(row.id ?? '')),
  /** 基线的完整行清单（id + 包名），即「原生与第三方层提供的全部能力」。 */
  baselineRows: [...baseline.values()].map(row => ({ id: String(row?.id ?? ''), name: String(row?.name ?? '') })),
  /** 基线里未被本层覆写、也未被禁用的行数（完全复用面）。 */
  untouchedRows: [...baseline.keys()].filter(id => !patches.some(row => String(row.id ?? '') === id)).length,
}

/**
 * 生成「完全复用全量清单」的 markdown（供 `docs/02` 直接嵌入）。
 *
 * 不按人为分类归组：分类是主观的，清单必须是客观的——直接列**基线里未被本层触碰的行**，
 * 按 id 排序，标注包名。谁要归组由读者自己来。
 * @returns markdown 文本。
 */
function reuseInventoryMarkdown() {
  const patchedIds = new Set(patches.map(row => String(row.id ?? '')))
  const rows = [...baseline.values()]
    .map(row => ({ id: String(row?.id ?? ''), name: String(row?.name ?? '') }))
    .filter(row => !patchedIds.has(row.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const lines = [
    `<!-- BEGIN reuse-inventory（由 profiles-templates/audit-patch-hits.mjs --markdown 生成，勿手改） -->`,
    `基线 ${String(baseline.size)} 行、被本层覆写 ${String(patchedIds.size)} 行，故**完全复用 = ${String(rows.length)} 行**：`,
    '',
    '| # | 行 id | 包 |',
    '|---|---|---|',
    ...rows.map((row, index) => `| ${String(index + 1)} | \`${row.id}\` | \`${row.name}\` |`),
    '<!-- END reuse-inventory -->',
  ]
  return `${lines.join('\n')}\n`
}

if (process.argv.includes('--markdown')) {
  process.stdout.write(reuseInventoryMarkdown())
} else if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ summary, findings, inventory }, undefined, 2)}\n`)
} else {
  process.stdout.write(`patch 命中审计：本层 ${String(bundles.length)} 个 bundle，`
    + `insert ${String(summary.inserts)} 行 / patch ${String(summary.patches)} 行\n`)
  process.stdout.write(`组合结果：有本层 ${String(summary.composedRows)} 行，无本层 ${String(summary.baselineRows)} 行\n`)
  if (findings.length === 0) {
    process.stdout.write('全部命中：每条 insert 都是新行，每条 patch 都覆写到基线已有行且声明内容已落进组合结果。\n')
  } else {
    for (const finding of findings) process.stdout.write(`MISS ${finding}\n`)
  }
}
process.exit(findings.length === 0 ? 0 : 1)
