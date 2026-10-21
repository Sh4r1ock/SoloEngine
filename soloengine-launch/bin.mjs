#!/usr/bin/env node
/**
 * SoloEngine 启动器。
 *
 * 子命令：
 *   init     初始化实例（目录、profile、bundle 链接、技能目录）
 *   install  安装依赖（pnpm install --no-frozen-lockfile --ignore-scripts）
 *   build    完整构建（native-system → lib 双面 → web）
 *   start    以唯一端口 8991 启动（端口被占用则 kill 占用进程后重启，严禁换端口；启动前隔离变更账本陈旧状态）
 *   stop     停止实例
 *   status   报告实例状态（进程 / 端口 / 就绪行 / 业务库 / 可访问地址）
 *   doctor   启动前自检（端口占用、数据目录可写、数据库可创建或迁移、信任域合法、插件层在位、变更账本状态陈旧）
 *   repair   隔离变更账本的陈旧命名空间与孤儿 worktree claim（移动不删除，可人工复核）
 *
 * 端口归属与进程命令行按平台取系统真实来源（Windows `Get-NetTCPConnection`/Win32_Process，
 * Linux `/proc`，macOS `lsof`/`ps`）——容器（Linux）里没有 powershell，判据不能建立在它身上。
 *
 * 依据 PRD-11 FR-DEP-002 / FR-DEP-011 与 NFR-REL-006（失败可见、错误可定位、不静默降级）。
 *
 * @module @soloengine/launch
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根目录（soloengine-launch 的父级）。 */
const ROOT = resolve(HERE, '..')
/** 唯一服务端口（严禁改动）。 */
const PORT = Number(process.env.SOLOENGINE_PORT ?? 8991)
/** 监听主机（dsh 拒绝 0.0.0.0）。 */
const HOST = process.env.SOLOENGINE_HOST ?? '127.0.0.1'
/** dsh home。 */
const DSH_HOME = join(ROOT, 'data', 'dsh-home')
/** profile 名。 */
const PROFILE = 'soloengine'
/** profile 目录。 */
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
/** 业务库。 */
const DB_PATH = join(ROOT, 'data', 'database', 'soloengine.db')
/** 主密钥目录（DB 密钥模型适配器执行时解密用）。 */
const KEYS_DIR = join(ROOT, 'data', 'home', 'keys')
/** 框架层技能目录（技能发现的自定义根）。 */
const SKILLS_DIR = join(ROOT, 'data', 'skills')
/** 启动日志（只承载**当前这一轮**实例的 stdout/stderr，见 `rotateHostLog`）。 */
const LOG_DIR = join(ROOT, 'test', 'logs')
const LOG_PATH = join(LOG_DIR, 'soloengine-host.log')
/** 上一轮实例日志的存档路径。 */
const LOG_PREV_PATH = join(LOG_DIR, 'soloengine-host.prev.log')

/**
 * profile 初始化模板目录（bundles 清单 + 三层配置模板）。
 *
 * bundle 清单**唯一真源**就在模板里（`profiles-templates/bundles.json`）：启动器不再自带第二份
 * 常量列表——两份清单迟早会分叉，而分叉的症状是「profile 少装一层却不报错」（NFR-MNT-003 单一真源）。
 */
const TEMPLATE_DIR = join(ROOT, 'profiles-templates')

/** 读模板里的 bundle 层清单（顺序即层序；缺失或为空即报错，不猜默认值）。 */
function readBundlesTemplate() {
  const templatePath = join(TEMPLATE_DIR, 'bundles.json')
  if (!existsSync(templatePath)) fail(`profile template ${templatePath} does not exist`)
  const parsed = JSON.parse(readFileSync(templatePath, 'utf8'))
  const bundles = parsed?.bundles
  if (!Array.isArray(bundles) || bundles.length === 0) {
    fail(`profile template ${templatePath} declares no bundles`)
  }
  return { bundles: bundles.map(String), patchReload: String(parsed.patchReload ?? 'live') }
}

/** 读模板文件原文（profile 的配置层由模板写出；模板缺失即报错）。 */
function readTemplateFile(name) {
  const templatePath = join(TEMPLATE_DIR, name)
  if (!existsSync(templatePath)) fail(`profile template ${templatePath} does not exist`)
  return readFileSync(templatePath, 'utf8')
}

/** 第三方插件依赖（profile 根配置每次重写，故在此声明；缺失即启动前自检报出具体项）。 */
const PLUGIN_DEPENDENCIES = {
  '@anionex/dsh-turn-rewind': '0.3.8',
  'dsh-permission-rules': '0.7.4',
  'dsh-approve-for-me': '0.2.4',
}

/** 以工作区包为源、在 profile 的 node_modules 里建立 junction 链接。 */
const PROFILE_LINKS = [
  ['@soloengine/host', join(ROOT, 'packages', 'soloengine', 'host')],
  ['@soloengine/framework', join(ROOT, 'soloengine-framework')],
  ['@soloengine/llm-db-adapter', join(ROOT, 'packages', 'soloengine', 'llm-db-adapter')],
  ['@soloengine/tools', join(ROOT, 'packages', 'soloengine', 'tools')],
  ['@soloengine/open-preview', join(ROOT, 'packages', 'soloengine', 'open-preview')],
  ['@soloengine/types', join(ROOT, 'packages', 'soloengine', 'types')],
  ['@soloengine/ui-theme', join(ROOT, 'packages', 'soloengine', 'ui-theme')],
  ['@soloengine/ui-brand', join(ROOT, 'packages', 'soloengine', 'ui-brand')],
  ['@soloengine/ui-conversation', join(ROOT, 'packages', 'soloengine', 'ui-conversation')],
  ['@soloengine/client-bootstrap', join(ROOT, 'packages', 'soloengine', 'client-bootstrap')],
  ['@soloengine/terminal-bridge', join(ROOT, 'packages', 'soloengine', 'terminal-bridge')],
  ['@soloengine/browser-proxy', join(ROOT, 'packages', 'soloengine', 'browser-proxy')],
  ['@soloengine/ui-terminal-owner', join(ROOT, 'packages', 'soloengine', 'ui-terminal-owner')],
  ['@soloengine/ui-sidebar-files', join(ROOT, 'packages', 'soloengine', 'ui-sidebar-files')],
  ['@soloengine/ui-document-editor', join(ROOT, 'packages', 'soloengine', 'ui-document-editor')],
  ['@soloengine/ui-operation-area', join(ROOT, 'packages', 'soloengine', 'ui-operation-area')],
]

/** 打印一行诊断。 */
function log(message) {
  process.stdout.write(`[soloengine] ${message}\n`)
}

/** 失败即抛（fail loud，不静默继续）。 */
function fail(message) {
  throw new Error(message)
}

/**
 * 子进程环境：把本实例的数据根与路径钉死后交给 dsh 子进程、也交给 profile 插件安装那次 CLI 调用。
 *
 * 必须共用同一份：平台按 `DSH_HOME` 解析 profile 目录（`resolveDshHome()`），不带它就会落到
 * `~/.dsh`——插件会被装到另一个 profile 上，本实例的 profile 一个包都不动（容器里实测到
 * `dsh: initialized profile soloengine at /root/.dsh/profiles/soloengine`）。
 */
function childEnvironment() {
  return {
    ...process.env,
    DSH_HOME,
    SOLOENGINE_ROOT: ROOT,
    SOLOENGINE_DB: DB_PATH,
    SOLOENGINE_KEYS_DIR: KEYS_DIR,
    SOLOENGINE_SKILLS_DIR: SKILLS_DIR,
  }
}

/**
 * 运行一条命令，继承 stdio。
 *
 * Windows 下 `corepack` / `pnpm` 是 `.cmd` 垫片，`shell: false` 无法直接执行
 * （`spawnSync corepack ENOENT`，本机实测）；仅这两个命令交给平台 shell 解析，
 * 其余命令（node 等真实可执行文件）保持直接 spawn，参数不做 shell 插值。
 */
function run(command, args, options = {}) {
  const viaShell = PLATFORM === 'win32' && (command === 'corepack' || command === 'pnpm')
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: viaShell, ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

/** 运行平台（端口归属与进程命令行的来源按平台选，见 `portOwners`）。 */
const PLATFORM = process.platform

/** 同步等待（POSIX 终止进程时等待其退出用；不引外部命令）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 把命令输出的进程号列表规整成去重数组。 */
function parsePidList(text) {
  return [...new Set(String(text ?? '').split(/[\s,]+/u).filter(value => /^\d+$/u.test(value)))]
}

/** Windows：按监听端口取持有进程。 */
function win32PortOwners(port) {
  const output = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-NetTCPConnection -LocalPort ${String(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`,
  ], { encoding: 'utf8' })
  return parsePidList(output.stdout)
}

/**
 * Linux：从 `/proc/net/tcp{,6}` 取该端口的监听 socket inode，再在各进程的 fd 表里反查持有者。
 *
 * 只读内核暴露的真相，不依赖 `ss`/`lsof`——容器基础镜像不保证它们在位，而端口归属是
 * 「kill 占用进程并以要求端口重启」这条硬约束的判据，判据不能建立在不保证存在的命令上。
 * @param port - 端口。
 * @returns 持有该监听端口的进程号。
 */
function linuxPortOwners(port) {
  const wanted = port.toString(16).toUpperCase().padStart(4, '0')
  const inodes = new Set()
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let lines
    try {
      lines = readFileSync(table, 'utf8').split('\n')
    } catch {
      continue
    }
    for (const line of lines.slice(1)) {
      const fields = line.trim().split(/\s+/u)
      // st === '0A' 即 LISTEN；local_address 形如 `0100007F:2323`（地址与端口都是十六进制）。
      if (fields.length < 10 || fields[3] !== '0A' || !fields[1].endsWith(`:${wanted}`)) continue
      inodes.add(fields[9])
    }
  }
  if (inodes.size === 0) return []
  const pids = new Set()
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/u.test(entry)) continue
    let fds
    try {
      fds = readdirSync(`/proc/${entry}/fd`)
    } catch {
      continue // 别的 uid 的进程读不到 fd 表——不是缺陷，如实跳过。
    }
    for (const fd of fds) {
      let target
      try {
        target = readlinkSync(`/proc/${entry}/fd/${fd}`)
      } catch {
        continue
      }
      const match = /^socket:\[(\d+)\]$/u.exec(target)
      if (match !== null && inodes.has(match[1])) {
        pids.add(entry)
        break
      }
    }
  }
  return [...pids]
}

/** 列出占用指定端口的进程 ID。 */
function portOwners(port) {
  if (PLATFORM === 'win32') return win32PortOwners(port)
  if (PLATFORM === 'linux') return linuxPortOwners(port)
  // 其余 POSIX（macOS）：lsof 随系统自带。
  const output = spawnSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  return parsePidList(output.stdout)
}

/** 终止一个进程（Windows 硬终止；POSIX 先 SIGTERM，3 秒内没退出再 SIGKILL）。 */
function killPid(pid) {
  if (PLATFORM === 'win32') {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force`], { stdio: 'inherit' })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return // 已经退出了。
  }
  for (let waited = 0; waited < 3000; waited += 100) {
    sleepSync(100)
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 竞态：刚好在此刻退出。
  }
}

/** 取一个进程的完整命令行（用于区分「本仓库实例」与「外来进程」）。 */
function processCommandLine(pid) {
  if (PLATFORM === 'win32') {
    const output = spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`,
    ], { encoding: 'utf8' })
    return String(output.stdout ?? '').trim()
  }
  if (PLATFORM === 'linux') {
    try {
      return readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8').split('\0').join(' ').trim()
    } catch {
      return ''
    }
  }
  const output = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
  return String(output.stdout ?? '').trim()
}

/**
 * 端口持有者是否就是本仓库启动的实例。
 *
 * `start` 以 `node --import tsx/esm <ROOT>/apps/cli/src/bin.ts --profile … --port 8991` 启动；
 * 判定同时要求「本仓库的 CLI 入口」与「本端口」两个事实，故别的实例（别的检出/桌面产物/外部服务）
 * 仍被如实报为占用者。
 * @param pid - 端口持有进程。
 * @returns 是本仓库实例时为 true。
 */
function isThisInstance(pid) {
  const line = processCommandLine(pid).replaceAll('\\', '/')
  const entry = `${ROOT.replaceAll('\\', '/')}/apps/cli/`
  return (line.includes(`${entry}src/bin.ts`) || line.includes(`${entry}lib/bin.js`))
    && line.includes(`--port ${String(PORT)}`)
}

/** 端口是否可绑定（就绪前置判定）。 */
function portFree(port) {
  return new Promise(resolvePort => {
    const probe = createServer()
    probe.once('error', () => { resolvePort(false) })
    probe.once('listening', () => { probe.close(() => { resolvePort(true) }) })
    probe.listen(port, HOST)
  })
}

/** 杀掉占用端口的进程（硬约束：只 kill 占用者，严禁换端口）。 */
function freePort(port) {
  const owners = portOwners(port)
  for (const pid of owners) {
    log(`port ${String(port)} is held by pid ${pid}; killing it and restarting on the same port`)
    killPid(pid)
  }
  return owners
}

// ── 变更账本陈旧状态（PRD-09/PRD-11 FR-DEP-011）───────────────────────────────
//
// 主干 @anionex/dsh-turn-rewind 把每个工作树的恢复点持久化在
// `<DSH_HOME>/change-ledger/v1` 下，并按「Git 工作树身份」（工作树内
// `.git/dsh-turn-rewind/worktree-id` 的随机 id，随 `.git` 重建而重新签发）绑定命名空间。
// 工作树目录被删除重建（或 `.git` 被重新初始化）后，旧命名空间的绑定与身份不再匹配：
// 主干按设计 fail loud 抛 `[STATE_CORRUPT] Git worktree identity changed`——它的恢复点
// 对当前工作树**已不可达**（旧对象随旧 `.git` 一起消失），但该错误会一直悬在
// 该工作区的 rewind/manage 面上（表现为面板里的原始 JSON 报错）。
//
// 处置：把陈旧命名空间与陈旧 worktree claim **整目录移到隔离区**（移动不删除，可人工复核），
// 主干启动后按当前身份重建命名空间；本产品自己的变更台账（file_changes）与按轮次撤回
// 完全不受影响（它们不依赖主干恢复点）。

/** 变更账本状态根（主干存储的版本目录）。 */
const LEDGER_DIR = join(DSH_HOME, 'change-ledger', 'v1')
/** 陈旧状态的隔离区（保留原样可人工复核）。 */
const LEDGER_QUARANTINE_DIR = join(DSH_HOME, 'change-ledger', 'quarantine')

/** 读一份工作树身份副本；缺失返回 undefined，内容非法返回 'malformed'。 */
function readIdentityCopy(path) {
  try {
    const value = readFileSync(path, 'utf8').trim()
    return /^[0-9a-f]{32}$/u.test(value) ? value : 'malformed'
  } catch {
    return undefined
  }
}

/**
 * 判定一个命名空间绑定是否陈旧（与主干 `ensureWorktreeId` 同法**只读**比对身份副本）。
 * @returns 陈旧原因，或 undefined 表示健康。
 */
function staleReasonOf(binding) {
  if (binding === null || typeof binding !== 'object') return 'malformed-binding'
  const { workspace, commonDir, gitDir, worktreeId } = binding
  if (typeof workspace !== 'string' || typeof commonDir !== 'string'
    || typeof gitDir !== 'string' || typeof worktreeId !== 'string') return 'malformed-binding'
  if (!existsSync(workspace)) return 'workspace-missing'
  const copies = new Set()
  for (const name of ['worktree-id', 'worktree-id.backup', 'worktree-id.initialized']) {
    const value = readIdentityCopy(join(gitDir, 'dsh-turn-rewind', name))
    if (value !== undefined) copies.add(value)
  }
  const centralName = `${createHash('sha256').update(gitDir).digest('hex')}.id`
  const central = readIdentityCopy(join(commonDir, 'dsh-turn-rewind-worktree-identities', centralName))
  if (central !== undefined) copies.add(central)
  // 身份副本全部丢失：主干下一次读取会重新签发一个新 id，旧命名空间必然不匹配。
  if (copies.size === 0) return 'worktree-identity-missing'
  for (const value of copies) if (value !== worktreeId) return 'worktree-identity-changed'
  return undefined
}

/** 扫描变更账本状态，返回陈旧条目（命名空间、陈旧命名空间的 claim、孤儿 claim 三类）。 */
function scanStaleLedgerState() {
  const findings = []
  const workspacesDir = join(LEDGER_DIR, 'workspaces')
  const claimsDir = join(LEDGER_DIR, 'worktree-claims')
  const liveKeys = new Set()
  const staleKeys = new Set()
  if (existsSync(workspacesDir)) {
    for (const key of readdirSync(workspacesDir)) {
      const bindingPath = join(workspacesDir, key, 'workspace-binding.json')
      if (!existsSync(bindingPath)) continue
      let binding
      try {
        binding = JSON.parse(readFileSync(bindingPath, 'utf8'))
      } catch {
        staleKeys.add(key)
        findings.push({ kind: 'workspace', key, workspace: key, worktreeId: '', reason: 'unreadable-binding' })
        continue
      }
      liveKeys.add(key)
      const reason = staleReasonOf(binding)
      if (reason !== undefined) {
        staleKeys.add(key)
        findings.push({
          kind: 'workspace',
          key,
          workspace: typeof binding.workspace === 'string' ? binding.workspace : key,
          worktreeId: typeof binding.worktreeId === 'string' ? binding.worktreeId : '',
          reason,
        })
      }
    }
  }
  if (existsSync(claimsDir)) {
    for (const file of readdirSync(claimsDir)) {
      let claim
      try {
        claim = JSON.parse(readFileSync(join(claimsDir, file), 'utf8'))
      } catch {
        continue
      }
      const key = typeof claim.workspaceKey === 'string' ? claim.workspaceKey : undefined
      // 归属命名空间仍存活：陈旧命名空间的 claim 一并隔离（否则它会独占 Git 目录、挡住新身份），
      // 健康的命名空间则由该命名空间的结论决定。
      if (key !== undefined && liveKeys.has(key)) {
        if (!staleKeys.has(key)) continue
        findings.push({
          kind: 'claim',
          key: file,
          workspace: typeof claim.commonDir === 'string' ? claim.commonDir : file,
          worktreeId: typeof claim.worktreeId === 'string' ? claim.worktreeId : '',
          reason: 'stale-workspace-claim',
        })
        continue
      }
      // 没有归属命名空间的 claim：它会阻塞同仓库的新身份，属孤立状态。
      findings.push({
        kind: 'claim',
        key: file,
        workspace: typeof claim.commonDir === 'string' ? claim.commonDir : file,
        worktreeId: typeof claim.worktreeId === 'string' ? claim.worktreeId : '',
        reason: 'orphan-claim',
      })
    }
  }
  return findings
}

/**
 * 隔离扫描发现的陈旧条目（移动不删除）。
 * @param findings - `scanStaleLedgerState` 的结果。
 * @returns 隔离的条目数。
 */
function quarantineStaleLedgerState(findings) {
  if (findings.length === 0) return 0
  const stamp = String(Date.now())
  const root = join(LEDGER_QUARANTINE_DIR, stamp)
  mkdirSync(join(root, 'workspaces'), { recursive: true })
  mkdirSync(join(root, 'worktree-claims'), { recursive: true })
  for (const finding of findings) {
    if (finding.kind === 'workspace') {
      const from = join(LEDGER_DIR, 'workspaces', finding.key)
      if (!existsSync(from)) continue
      renameSync(from, join(root, 'workspaces', finding.key))
      log(`quarantined change-ledger namespace for ${finding.workspace} (${finding.reason}); its restore points are unreachable after the worktree identity change — the file_changes ledger carries the revert`)
    } else {
      const from = join(LEDGER_DIR, 'worktree-claims', finding.key)
      if (!existsSync(from)) continue
      renameSync(from, join(root, 'worktree-claims', finding.key))
      log(`quarantined orphan change-ledger worktree claim ${finding.key} (${finding.reason}); a stale claim would block a fresh identity for ${finding.workspace}`)
    }
  }
  log(`change-ledger quarantine kept at ${root} (nothing deleted; remove it after review)`)
  return findings.length
}

// ── init ─────────────────────────────────────────────────────────────────────

/**
 * 仓库声明的包管理器（`packageManager`，形如 `pnpm@11.7.0`）。
 *
 * profile 自己也是 pnpm 工程，且平台的插件转发器会在 profile 目录里 spawn `pnpm`——corepack 从
 * **最近的** package.json 解析版本，profile 若不声明就落到「最新」（容器里实测解析到 pnpm 12，
 * 对全新 profile 直接报 `Already up to date` 而一个包也不装）。故把仓库钉的版本写进 profile 清单。
 */
function repositoryPackageManager() {
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))?.packageManager
  if (typeof declared !== 'string' || declared.trim() === '') {
    fail('root package.json declares no packageManager; the launcher pins the profile to it')
  }
  return declared.trim()
}

/** 建立实例目录、profile 与 bundle 链接。 */
function init() {
  for (const dir of [join(ROOT, 'data'), join(ROOT, 'data', 'database'), join(ROOT, 'data', 'home'), SKILLS_DIR, DSH_HOME, PROFILE_DIR, LOG_DIR]) {
    mkdirSync(dir, { recursive: true })
  }

  const manifestPath = join(PROFILE_DIR, 'package.json')
  const { bundles, patchReload } = readBundlesTemplate()
  const manifest = {
    name: `dsh-profile-${PROFILE}`,
    private: true,
    packageManager: repositoryPackageManager(),
    dependencies: { ...PLUGIN_DEPENDENCIES },
    dsh: { profile: { bundles, patchReload } },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

  // 三层配置模板整份来自 `profiles-templates/`（清单每次重写；配置层只在缺失时写，
  // 不覆盖部署方自己的 patch 与 workspace 设置）。
  const patchPath = join(PROFILE_DIR, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, readTemplateFile('cordis.patch.yml'))
  const cordisPath = join(PROFILE_DIR, 'cordis.yml')
  if (!existsSync(cordisPath)) writeFileSync(cordisPath, readTemplateFile('cordis.yml'))
  const workspacePath = join(PROFILE_DIR, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, readTemplateFile('pnpm-workspace.yaml'))

  // 工作区包以 junction 链入 profile 的 node_modules：包源码零改动、不发布也能解析。
  const modulesDir = join(PROFILE_DIR, 'node_modules')
  for (const [packageName, target] of PROFILE_LINKS) {
    const link = join(modulesDir, packageName)
    mkdirSync(dirname(link), { recursive: true })
    rmSync(link, { recursive: true, force: true })
    symlinkSync(target, link, 'junction')
    log(`linked ${packageName} -> ${target}`)
  }
  log(`initialized profile ${PROFILE_DIR}`)
}

// ── start / stop / status ────────────────────────────────────────────────────

/**
 * 启动日志按轮转：每轮启动前把上一轮的日志存档为 `soloengine-host.prev.log`。
 *
 * 日志是**追加**写入的，不轮转就会跨重启无界增长（本机实测一轮会话后 65.8 MB / 25.6 万行），
 * 而且「本轮启动无错误」这条判据会被历史轮次里的旧错误永久污染——判据必须能各自归属到
 * 具体一轮。归档只保留上一轮（更早的已无诊断价值）。
 */
function rotateHostLog() {
  if (!existsSync(LOG_PATH)) return
  rmSync(LOG_PREV_PATH, { force: true })
  renameSync(LOG_PATH, LOG_PREV_PATH)
}

/** 启动实例：先释放端口，再以 8991 启动并等待就绪行。 */
async function start() {
  init()
  if (!(await portFree(PORT))) freePort(PORT)
  // 变更账本陈旧状态先行隔离：陈旧命名空间会让主干在该工作区持续 fail loud
  // （Git worktree identity changed），而它对本产品自己的台账与撤回毫无影响。
  quarantineStaleLedgerState(scanStaleLedgerState())
  mkdirSync(LOG_DIR, { recursive: true })
  rotateHostLog()
  const args = [
    '--import', 'tsx/esm', join(ROOT, 'apps', 'cli', 'src', 'bin.ts'),
    '--profile', PROFILE,
    '--host', HOST, '--port', String(PORT),
  ]
  // PRD-11 FR-DEP-002：一键部署 → 就绪 → 浏览器访问。默认由 dsh web 用**带进程令牌的
  // 可访问地址**打开默认浏览器（令牌换签名 cookie，信任门不被绕过）；无头/自动化运行以
  // SOLOENGINE_NO_OPEN=1 关闭该动作，就绪行仍照常落盘与打印。
  if (process.env.SOLOENGINE_NO_OPEN === '1') args.push('--no-open')
  const out = spawn('node', args, {
    cwd: ROOT,
    env: childEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  const chunks = []
  let announced = false
  const collect = chunk => {
    const text = String(chunk)
    chunks.push(text)
    process.stdout.write(text)
    // 日志实时落盘：就绪行必须可被取证脚本在进程存活期间读到。
    appendFileSync(LOG_PATH, text)
    // 部署引导的就绪输出：把「浏览器可直接打开」的地址再打印一行（就绪行只在启动时出现一次）。
    if (!announced) {
      const ready = readyUrlOf(chunks.join(''))
      if (ready !== undefined) {
        announced = true
        log(`ready; open this address in the browser: ${ready}`)
      }
    }
  }
  out.stdout.on('data', collect)
  out.stderr.on('data', collect)
  out.on('exit', code => {
    if (code !== 0) log(`instance exited with ${String(code)}`)
  })
  log(`starting on ${HOST}:${String(PORT)} (pid ${String(out.pid ?? 0)}), log ${LOG_PATH}`)
}

/** 从启动输出里取最后一条可访问地址（含进程令牌，可直接在浏览器打开）。 */
function readyUrlOf(text) {
  const matches = [...text.matchAll(/dsh web: (https?:\/\/\S+)/gu)]
  const last = matches.at(-1)
  return last === undefined ? undefined : last[1]
}

/** 停止实例：杀掉占用端口的进程。 */
function stop() {
  const owners = freePort(PORT)
  log(owners.length === 0 ? `nothing listening on ${String(PORT)}` : `stopped ${owners.join(', ')}`)
}

/** 报告状态。 */
function status() {
  const owners = portOwners(PORT)
  const self = owners.filter(pid => isThisInstance(pid))
  const foreign = owners.filter(pid => !isThisInstance(pid))
  const holder = owners.length === 0
    ? 'free'
    : [
        self.length === 0 ? '' : `held by this instance (pid ${self.join(', ')})`,
        foreign.length === 0 ? '' : `held by another process (pid ${foreign.join(', ')})`,
      ].filter(Boolean).join(' and ')
  log(`port ${String(PORT)}: ${holder}`)
  log(`dsh home: ${DSH_HOME}`)
  log(`profile: ${PROFILE_DIR}`)
  log(`database: ${DB_PATH} ${existsSync(DB_PATH) ? '(present)' : '(missing)'}`)
  log(`bundles: ${readBundlesForReport().join(', ')}`)
  if (existsSync(LOG_PATH)) {
    // PRD-11 FR-DEP-011：状态输出给出**可访问地址**（含进程令牌，浏览器可直接打开）。
    const ready = readyUrlOf(readFileSync(LOG_PATH, 'utf8'))
    log(`open this address in the browser: ${ready ?? '(no ready line in the log yet)'}`)
  } else {
    log(`open this address in the browser: (no log at ${LOG_PATH})`)
  }
}

/** 启动前自检（PRD-11 FR-DEP-011）：端口持有者、数据目录可写、数据库可创建或迁移、信任域合法、变更账本状态、第三方插件层。 */
async function doctor() {
  const findings = []
  const owners = portOwners(PORT)
  const free = owners.length === 0
  if (!free) {
    // 本实例已在运行不是缺陷：就绪输出与可访问地址由 status 给出；只有**别的进程**占用端口才需要报出。
    const foreign = owners.filter(pid => !isThisInstance(pid))
    for (const pid of foreign) {
      findings.push(`port ${String(PORT)} is occupied by another process (pid ${pid}); start will kill it and restart on the same port`)
    }
  }
  try {
    const probe = join(ROOT, 'data', '.write-probe')
    mkdirSync(join(ROOT, 'data'), { recursive: true })
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
  } catch (error) {
    findings.push(`data directory is not writable: ${String(error)}`)
  }
  try {
    const { DatabaseSync } = await import('node:sqlite')
    mkdirSync(dirname(DB_PATH), { recursive: true })
    const db = new DatabaseSync(DB_PATH)
    db.exec('PRAGMA journal_mode = WAL')
    db.close()
  } catch (error) {
    findings.push(`business database is not creatable: ${String(error)}`)
  }
  if (!/^127\.0\.0\.1$|^0\.0\.0\.0$/.test(HOST)) findings.push(`trust domain host ${HOST} is not a legal bind address`)
  // 通配地址：平台的 web 命令按安全设计**拒绝** `--host 0.0.0.0`（会把远程代码执行暴露到网络）。
  // 走到启动才报错太晚，故在自检里直接拦下并给出受支持的取值与容器形态的做法。
  if (HOST === '0.0.0.0') {
    findings.push(
      'host 0.0.0.0 is refused by the platform web command (it would expose remote code execution to the network);'
      + ' use SOLOENGINE_HOST=127.0.0.1 — containers reach it with `docker run --network=host` (loopback is then the host loopback)',
    )
  }
  for (const [packageName] of PROFILE_LINKS) {
    if (!existsSync(join(ROOT, 'packages', 'soloengine', 'host', 'package.json')) && packageName === '@soloengine/host') {
      findings.push('@soloengine/host package is missing')
    }
  }
  // 第三方插件层（改造复用的实现主干）必须已在 profile 内：缺失即报出具体项与修复命令。
  for (const [packageName, version] of Object.entries(PLUGIN_DEPENDENCIES)) {
    const installed = join(PROFILE_DIR, 'node_modules', packageName, 'package.json')
    if (!existsSync(installed)) {
      findings.push(`plugin ${packageName}@${version} is not installed; run: dsh plugin --profile ${PROFILE} add ${packageName}@${version}`)
    }
  }
  // 变更账本陈旧状态（工作树身份已变/工作树不存在/身份副本丢失/孤儿 claim）：报出具体项与修复命令。
  for (const stale of scanStaleLedgerState()) {
    findings.push(
      `change-ledger state is stale for ${stale.workspace} (${stale.reason}); run: node soloengine-launch/bin.mjs repair (then restart)`,
    )
  }
  // 关键配置摘要（PRD-11 FR-DEP-011：就绪输出给出访问地址与关键配置摘要）。
  log(`doctor: config host=${HOST} port=${String(PORT)} profile=${PROFILE} bundles=${readBundlesForReport().join(', ')}`
    + ` dsh-home=${DSH_HOME} database=${DB_PATH} (${existsSync(DB_PATH) ? 'present' : 'missing'})`)
  if (findings.length === 0) {
    log(`doctor: all checks passed (port ${String(PORT)} ${free ? 'free' : `held by this instance: pid ${owners.join(', ')}`},`
      + ' data writable, database creatable, trust domain legal, change-ledger consistent, plugin layers present)')
    return
  }
  for (const finding of findings) log(`doctor: FAIL ${finding}`)
  process.exitCode = 1
}

/** 读 profile 的组合清单（缺失即报错，不猜默认值）。 */
function readBundlesForReport() {
  const manifestPath = join(PROFILE_DIR, 'package.json')
  if (!existsSync(manifestPath)) fail(`dsh profile manifest ${manifestPath} does not exist; run: node soloengine-launch/bin.mjs init`)
  const bundles = JSON.parse(readFileSync(manifestPath, 'utf8'))?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length === 0) fail(`dsh profile manifest ${manifestPath} declares no dsh.profile.bundles`)
  return bundles.map(String)
}

/** 隔离变更账本的陈旧状态（启动前自动执行；也可单独运行）。 */
function repair() {
  const findings = scanStaleLedgerState()
  if (findings.length === 0) {
    log('repair: change-ledger state is consistent (no stale namespace, no orphan worktree claim)')
    return
  }
  for (const finding of findings) {
    log(`repair: stale ${finding.kind} ${finding.key} for ${finding.workspace} (${finding.reason})`)
  }
  quarantineStaleLedgerState(findings)
  log('repair: done; restart the instance (start) so the trunk rebinds the live worktree identities')
}

// ── install ──────────────────────────────────────────────────────────────────

/**
 * 安装依赖（一键部署的准备步）。
 *
 * 两件事：仓库工作区依赖（`corepack pnpm install`，与本地开发同一命令），以及 **profile 的第三方
 * 插件层**。后者必须真落盘：`init` 只把依赖写进 profile 清单，若不安装，`start` 会以
 * `cannot resolve profile bundle "@anionex/dsh-turn-rewind"` 失败——这一步在全新机器与容器里都会遇到。
 * 安装走平台的 profile 插件转发器（`dsh plugin --profile <name> <pnpm args>`，在 profile 目录跑 pnpm
 * 并回写 `dsh.profile.bundles`），已装则跳过（幂等，且无网也能重复执行）。
 */
function install() {
  run('corepack', ['pnpm', 'install', '--no-frozen-lockfile', '--ignore-scripts'])
  init()
  const missing = Object.entries(PLUGIN_DEPENDENCIES)
    .filter(([packageName]) => !existsSync(join(PROFILE_DIR, 'node_modules', packageName, 'package.json')))
  if (missing.length === 0) {
    log(`install: profile plugin layers already present (${Object.keys(PLUGIN_DEPENDENCIES).join(', ')})`)
    return
  }
  log(`install: installing profile plugin layers (${missing.map(([name, version]) => `${name}@${version}`).join(', ')})`
    + `; profile pin ${String(JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))?.packageManager)}`)
  // 直接以 node + tsx 载入 CLI（与 start 同一入口、同一份环境）：不能经 `pnpm exec tsx`——那样
  // `--profile` 会被 pnpm 自己吃掉；不带 `childEnvironment()` 则会被平台解析到 `~/.dsh` 下的另一个 profile。
  run('node', [
    '--import', 'tsx/esm', join(ROOT, 'apps', 'cli', 'src', 'bin.ts'),
    'plugin', '--profile', PROFILE, 'install',
  ], { env: childEnvironment() })
  const stillMissing = Object.entries(PLUGIN_DEPENDENCIES)
    .filter(([packageName]) => !existsSync(join(PROFILE_DIR, 'node_modules', packageName, 'package.json')))
  if (stillMissing.length > 0) {
    fail(`profile plugin layers are still missing after install: ${stillMissing.map(([name]) => name).join(', ')}`)
  }
}

// ── dispatch ─────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? 'status'
switch (command) {
  case 'init': init(); break
  case 'install': install(); break
  case 'build': run('corepack', ['pnpm', 'run', 'build']); break
  case 'start': await start(); break
  case 'stop': stop(); break
  case 'status': status(); break
  case 'doctor': await doctor(); break
  case 'repair': repair(); break
  default:
    process.stderr.write(`soloengine: unknown command ${command} (expected init|install|build|start|stop|status|doctor|repair)\n`)
    process.exitCode = 2
}
