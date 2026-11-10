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
/** dsh home（多节点/并行实例可用 `SOLOENGINE_DSH_HOME` 指向独立目录）。 */
const DSH_HOME = process.env.SOLOENGINE_DSH_HOME === undefined || process.env.SOLOENGINE_DSH_HOME === ''
  ? join(ROOT, 'data', 'dsh-home')
  : resolve(process.env.SOLOENGINE_DSH_HOME)
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

/**
 * 数据库形态：`single`（单机 SQLite，缺省）或 `cloud`（云 PostgreSQL）。二选一，不做运行时切换。
 *
 * 形态是启动配置，不是插件开关：它决定叠加哪一份形态覆盖（`cordis.form-*.patch.yml`），
 * 也决定管理层业务库走哪个引擎。非法取值立即失败，不猜默认。
 */
const DB_FORM = (process.env.SOLOENGINE_DB_FORM ?? 'single').trim()
if (DB_FORM !== 'single' && DB_FORM !== 'cloud') {
  throw new Error(`SOLOENGINE_DB_FORM must be "single" or "cloud", got "${DB_FORM}"`)
}
/** 云形态的 PostgreSQL 连接串（单机形态必须留空，避免把数据写进错误的介质）。 */
const DATABASE_URL = (process.env.SOLOENGINE_DATABASE_URL ?? '').trim()
if (DB_FORM === 'cloud' && DATABASE_URL === '') {
  throw new Error('SOLOENGINE_DB_FORM=cloud requires SOLOENGINE_DATABASE_URL')
}
if (DB_FORM === 'single' && DATABASE_URL !== '') {
  throw new Error('SOLOENGINE_DB_FORM=single conflicts with SOLOENGINE_DATABASE_URL; unset the connection string or switch to cloud')
}
/** 当前形态的插件覆盖文件（键值后端 / 会话日志 / 会话检索三件同进同退）。 */
const FORM_PATCH_PATH = join(ROOT, 'packages', 'soloengine', 'host', `cordis.form-${DB_FORM}.patch.yml`)

/**
 * 执行后端形态：`local`（缺省，本机进程）、`container`（每会话一容器）、`microvm`
 * （同一容器装配，OCI 运行时提供独立内核隔离）、`full-vm`（每会话一台 QEMU 全 VM）。
 * 后三档仅云形态。
 *
 * 与数据库形态同属启动配置：决定是否叠加执行后端覆盖（把本机子进程提供方换成按会话
 * 路由到容器的提供方）。容器镜像由 `SOLOENGINE_CONTAINER_IMAGE` 给出（部署值）；
 * C 档的 OCI 运行时由 `SOLOENGINE_CONTAINER_RUNTIME` 给出（缺省 `kata-runtime`）；
 * D 档的基础镜像 / 状态目录 / 私钥由 `SOLOENGINE_VM_IMAGE` / `SOLOENGINE_VM_STATE_DIR` /
 * `SOLOENGINE_VM_SSH_KEY` 给出。
 */
const EXECUTORS = ['local', 'container', 'microvm', 'full-vm']
const EXECUTOR = (process.env.SOLOENGINE_EXECUTOR ?? 'local').trim()
if (!EXECUTORS.includes(EXECUTOR)) {
  throw new Error(`SOLOENGINE_EXECUTOR must be one of ${EXECUTORS.join(', ')}, got "${EXECUTOR}"`)
}
if (EXECUTOR !== 'local' && DB_FORM !== 'cloud') {
  throw new Error(`SOLOENGINE_EXECUTOR=${EXECUTOR} requires SOLOENGINE_DB_FORM=cloud`)
}
/** C 档的 OCI 运行时（容器档为空 = Docker 默认运行时）。 */
const CONTAINER_RUNTIME = (
  process.env.SOLOENGINE_CONTAINER_RUNTIME
  ?? (EXECUTOR === 'microvm' ? 'kata-runtime' : '')
).trim()
if (EXECUTOR === 'microvm' && CONTAINER_RUNTIME === '') {
  throw new Error('SOLOENGINE_CONTAINER_RUNTIME is required when SOLOENGINE_EXECUTOR=microvm')
}
/** D 档的部署值：基础镜像、每会话状态目录与平台私钥（缺一即启动失败）。 */
const VM_IMAGE = (process.env.SOLOENGINE_VM_IMAGE ?? '').trim()
const VM_STATE_DIR = (process.env.SOLOENGINE_VM_STATE_DIR ?? '').trim()
const VM_SSH_KEY = (process.env.SOLOENGINE_VM_SSH_KEY ?? '').trim()
const VM_ACCEL = (process.env.SOLOENGINE_VM_ACCEL ?? '').trim()
if (EXECUTOR === 'full-vm') {
  if (VM_IMAGE === '') throw new Error('SOLOENGINE_VM_IMAGE is required when SOLOENGINE_EXECUTOR=full-vm')
  if (VM_STATE_DIR === '') throw new Error('SOLOENGINE_VM_STATE_DIR is required when SOLOENGINE_EXECUTOR=full-vm')
  if (VM_SSH_KEY === '') throw new Error('SOLOENGINE_VM_SSH_KEY is required when SOLOENGINE_EXECUTOR=full-vm')
  if (VM_ACCEL !== '' && VM_ACCEL !== 'kvm' && VM_ACCEL !== 'tcg') {
    throw new Error(`SOLOENGINE_VM_ACCEL must be "kvm" or "tcg", got "${VM_ACCEL}"`)
  }
}
/** 当前执行后端的插件覆盖文件（C 档与容器档共用容器装配；D 档用全 VM 装配）。 */
const EXECUTOR_OVERLAY = EXECUTOR === 'local' ? 'local' : EXECUTOR === 'full-vm' ? 'vm' : 'container'
const EXECUTOR_PATCH_PATH = join(ROOT, 'packages', 'soloengine', 'host', `cordis.executor-${EXECUTOR_OVERLAY}.patch.yml`)
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

/**
 * 插件清单唯一真源（`profiles-templates/plugins.json`）：第三方依赖版本与工作区包链接。
 * 启动器、`soloengine-vendor/refresh.mjs` 与文档计数共读这一份；缺失/畸形即启动前报错。
 */
function readPluginManifest() {
  const path = join(TEMPLATE_DIR, 'plugins.json')
  if (!existsSync(path)) fail(`plugin manifest ${path} does not exist`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`plugin manifest ${path} is not valid JSON: ${String(error)}`)
  }
  const dependencies = parsed?.dependencies
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || Object.keys(dependencies).length === 0) {
    fail(`plugin manifest ${path} declares no dependencies`)
  }
  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') {
      fail(`plugin manifest ${path} carries a malformed dependency entry`)
    }
  }
  const links = parsed?.links
  if (!Array.isArray(links) || links.length === 0) fail(`plugin manifest ${path} declares no workspace links`)
  const normalized = links.map(entry => {
    if (typeof entry?.name !== 'string' || entry.name === ''
      || typeof entry?.path !== 'string' || entry.path === '') {
      fail(`plugin manifest ${path} carries a malformed link entry`)
    }
    return [entry.name, join(ROOT, entry.path)]
  })
  return { dependencies, links: normalized }
}

const PLUGIN_MANIFEST = readPluginManifest()

/** 第三方插件依赖（profile 根配置每次重写，故在插件清单里声明）。 */
const PLUGIN_DEPENDENCIES = PLUGIN_MANIFEST.dependencies

/**
 * 精确版本豁免（`<profile>/compatibility.json`）：插件清单的兼容区间未覆盖当前 DSH 版本，
 * 但该版本的功能与接口已按本产品组合实测。只对列出的精确版本生效，升级插件或 DSH 即失效。
 */
const PLUGIN_VERSION_EXEMPTIONS = []

/** 当前 DSH 运行时版本（app-boot 的版本即平台判定的运行时版本）。 */
function dshRuntimeVersion() {
  const manifest = join(ROOT, 'packages', 'boot', 'app-boot', 'package.json')
  const version = JSON.parse(readFileSync(manifest, 'utf8'))?.version
  if (typeof version !== 'string' || version.trim() === '') fail(`${manifest} declares no version`)
  return version.trim()
}

/** 写入当前运行时所需的精确版本豁免（幂等；只增不减，撤销走平台 CLI）。 */
function ensureVersionExemptions() {
  if (PLUGIN_VERSION_EXEMPTIONS.length === 0) return
  const runtime = dshRuntimeVersion()
  const file = join(PROFILE_DIR, 'compatibility.json')
  let exemptions = {}
  if (existsSync(file)) {
    try {
      exemptions = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      fail(`${file} is not valid JSON; repair it before exemptions can be written (${String(error)})`)
    }
  }
  let changed = false
  for (const entry of PLUGIN_VERSION_EXEMPTIONS) {
    const versions = Array.isArray(exemptions[entry.packageVersion]) ? exemptions[entry.packageVersion] : []
    if (versions.includes(runtime)) continue
    exemptions[entry.packageVersion] = [...versions, runtime]
    changed = true
    log(`granted exact-version exemption ${entry.packageVersion} on dsh ${runtime}: ${entry.reason}`)
  }
  if (changed) writeFileSync(file, `${JSON.stringify(exemptions, undefined, 2)}\n`, { mode: 0o600 })
}

/** 以工作区包为源、在 profile 的 node_modules 里建立 junction 链接（清单来自 plugins.json）。 */
const PROFILE_LINKS = PLUGIN_MANIFEST.links

/** 读 profile 内已安装插件版本；未安装或清单不可读时为 undefined。 */
function installedPluginVersion(packageName) {
  try {
    const version = JSON.parse(readFileSync(join(PROFILE_DIR, 'node_modules', packageName, 'package.json'), 'utf8'))?.version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

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
    SOLOENGINE_DB_FORM: DB_FORM,
    SOLOENGINE_DATABASE_URL: DATABASE_URL,
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

/**
 * 等端口真正释放：kill 只是投递，进程退出与句柄回收滞后；立刻 spawn 新实例会撞
 * EADDRINUSE 后静默退出，健康检查反而命中尚未退出的旧进程。
 * @param {number} port - 监听的端口。
 * @param {number} timeoutMs - 最长等待。
 * @returns {Promise<boolean>} 端口在超时内变为可绑定。
 */
async function waitPortFree(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portFree(port)) return true
    await new Promise(done => setTimeout(done, 200))
  }
  return false
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
  ensureVersionExemptions()
  if (!(await portFree(PORT))) {
    freePort(PORT)
    if (!(await waitPortFree(PORT))) {
      throw new Error(`port ${String(PORT)} is still held after killing its owner; refusing to start a second instance`)
    }
  }
  // 变更账本陈旧状态先行隔离：陈旧命名空间会让主干在该工作区持续 fail loud
  // （Git worktree identity changed），而它对本产品自己的台账与撤回毫无影响。
  quarantineStaleLedgerState(scanStaleLedgerState())
  mkdirSync(LOG_DIR, { recursive: true })
  rotateHostLog()
  const args = [
    '--import', 'tsx/esm', join(ROOT, 'apps', 'cli', 'src', 'bin.ts'),
    '--profile', PROFILE,
    // 数据库形态覆盖：三件流程级插件（键值后端 / 会话日志 / 会话检索）同进同退，
    // 与 profile 里已装的两套插件一一对应，启动时只激活这一套。
    // 必须排在 --host/--port 之前：启动器的选项在第一个未知参数处结束，之后全部交给应用。
    '--patch', FORM_PATCH_PATH,
    ...EXECUTOR === 'local' ? [] : ['--patch', EXECUTOR_PATCH_PATH],
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
  log(`database form: ${DB_FORM}${DB_FORM === 'cloud' ? ' (PostgreSQL)' : ' (SQLite)'}`)
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
    if (DB_FORM === 'single') {
      const { DatabaseSync } = await import('node:sqlite')
      mkdirSync(dirname(DB_PATH), { recursive: true })
      const db = new DatabaseSync(DB_PATH)
      db.exec('PRAGMA journal_mode = WAL')
      db.close()
    } else {
      // 连接串合法性在这里先判；真正的连通性由启动时的 PostgreSQL 适配器 fail loud。
      try {
        new URL(DATABASE_URL)
      } catch {
        findings.push(`SOLOENGINE_DATABASE_URL is not a valid connection URL: ${DATABASE_URL}`)
      }
    }
  } catch (error) {
    findings.push(`business database is not creatable: ${String(error)}`)
  }
  if (!existsSync(FORM_PATCH_PATH)) {
    findings.push(`database form overlay ${FORM_PATCH_PATH} is missing (SOLOENGINE_DB_FORM=${DB_FORM})`)
  }
  if (EXECUTOR !== 'local' && !existsSync(EXECUTOR_PATCH_PATH)) {
    findings.push(`executor overlay ${EXECUTOR_PATCH_PATH} is missing (SOLOENGINE_EXECUTOR=${EXECUTOR})`)
  }
  if ((EXECUTOR === 'container' || EXECUTOR === 'microvm')
    && (process.env.SOLOENGINE_CONTAINER_IMAGE ?? '').trim() === '') {
    findings.push(`SOLOENGINE_CONTAINER_IMAGE is required when SOLOENGINE_EXECUTOR=${EXECUTOR}`)
  }
  if (CONTAINER_RUNTIME !== '') {
    const dockerBin = (process.env.SOLOENGINE_DOCKER ?? 'docker').trim()
    const runtimes = spawnSync(dockerBin, ['info', '--format', '{{json .Runtimes}}'], { encoding: 'utf8' })
    if (runtimes.status !== 0) {
      findings.push(`docker info failed while checking OCI runtime ${CONTAINER_RUNTIME}: ${(runtimes.stderr ?? '').trim()}`)
    } else if (!(runtimes.stdout ?? '').includes(`"${CONTAINER_RUNTIME}"`)) {
      findings.push(`docker runtime ${CONTAINER_RUNTIME} is not registered (SOLOENGINE_EXECUTOR=${EXECUTOR})`)
    }
  }
  if (EXECUTOR === 'full-vm') {
    if (VM_IMAGE === '') findings.push('SOLOENGINE_VM_IMAGE is required when SOLOENGINE_EXECUTOR=full-vm')
    else if (!existsSync(VM_IMAGE)) findings.push(`VM base image ${VM_IMAGE} does not exist`)
    if (VM_STATE_DIR === '') findings.push('SOLOENGINE_VM_STATE_DIR is required when SOLOENGINE_EXECUTOR=full-vm')
    if (VM_SSH_KEY === '') findings.push('SOLOENGINE_VM_SSH_KEY is required when SOLOENGINE_EXECUTOR=full-vm')
    else if (!existsSync(VM_SSH_KEY)) findings.push(`VM SSH key ${VM_SSH_KEY} does not exist`)
    if (VM_ACCEL === 'kvm' && !existsSync('/dev/kvm')) {
      findings.push('SOLOENGINE_VM_ACCEL=kvm requires /dev/kvm on this node')
    }
    const qemuBin = (process.env.SOLOENGINE_QEMU ?? 'qemu-system-x86_64').trim()
    const qemuImgBin = (process.env.SOLOENGINE_QEMU_IMG ?? 'qemu-img').trim()
    const sshBin = (process.env.SOLOENGINE_SSH ?? 'ssh').trim()
    for (const [bin, flag] of [[qemuBin, '--version'], [qemuImgBin, '--version'], [sshBin, '-V']]) {
      const probe = spawnSync(bin, [flag], { encoding: 'utf8' })
      if (probe.status !== 0) findings.push(`${bin} is required when SOLOENGINE_EXECUTOR=full-vm`)
    }
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
  for (const [packageName, target] of PROFILE_LINKS) {
    // 逐条核对链接目标（不只查 @soloengine/host）：任何一条工作区包缺失，profile 装载都会在运行期才炸。
    if (!existsSync(join(target, 'package.json'))) {
      findings.push(`workspace link target for ${packageName} is missing: ${target} (run: node soloengine-launch/bin.mjs init)`)
    }
  }
  // 第三方插件层（改造复用的实现主干）必须已在 profile 内：缺失即报出具体项与修复命令。
  for (const [packageName, version] of Object.entries(PLUGIN_DEPENDENCIES)) {
    const installed = installedPluginVersion(packageName)
    if (installed !== version) {
      findings.push(`plugin ${packageName}@${version} is not installed (found ${installed ?? 'none'}); run: node soloengine-launch/bin.mjs install`)
    }
  }
  // 变更账本陈旧状态（工作树身份已变/工作树不存在/身份副本丢失/孤儿 claim）：报出具体项与修复命令。
  for (const stale of scanStaleLedgerState()) {
    findings.push(
      `change-ledger state is stale for ${stale.workspace} (${stale.reason}); run: node soloengine-launch/bin.mjs repair (then restart)`,
    )
  }
  // 关键配置摘要（PRD-11 FR-DEP-011：就绪输出给出访问地址与关键配置摘要）。
  log(`doctor: config host=${HOST} port=${String(PORT)} profile=${PROFILE} form=${DB_FORM} bundles=${readBundlesForReport().join(', ')}`
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
    .filter(([packageName, version]) => installedPluginVersion(packageName) !== version)
  if (missing.length === 0) {
    log(`install: profile plugin layers already present (${Object.keys(PLUGIN_DEPENDENCIES).join(', ')})`)
    return
  }
  log(`install: installing profile plugin layers (${missing.map(([name, version]) => `${name}@${version}`).join(', ')})`
    + `; profile pin ${String(JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))?.packageManager)}`)
  // 豁免必须先于安装写入：平台的安装路径在装完包后会立刻按兼容门判定并回滚。
  ensureVersionExemptions()
  // 直接以 node + tsx 载入 CLI（与 start 同一入口、同一份环境）：不能经 `pnpm exec tsx`——那样
  // `--profile` 会被 pnpm 自己吃掉；不带 `childEnvironment()` 则会被平台解析到 `~/.dsh` 下的另一个 profile。
  run('node', [
    '--import', 'tsx/esm', join(ROOT, 'apps', 'cli', 'src', 'bin.ts'),
    // 插件的 pnpm 参数原样转发；版本升级会改写 profile 清单，锁文件必须允许更新。
    'plugin', '--profile', PROFILE, 'install', '--no-frozen-lockfile',
  ], { env: childEnvironment() })
  const stillMissing = Object.entries(PLUGIN_DEPENDENCIES)
    .filter(([packageName, version]) => installedPluginVersion(packageName) !== version)
  if (stillMissing.length > 0) {
    fail(`profile plugin layers are still missing after install: ${stillMissing.map(([name]) => name).join(', ')}`)
  }
  ensureVersionExemptions()
}

// ── dispatch ─────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? 'status'
switch (command) {
  case 'init': init(); break
  case 'install': install(); break
  // 产品构建按 official 客户端档位出包：品牌名/图标走 `ui-brand-official`，
  // 标题取 `OFFICIAL_CLIENT_BUILD_ENVIRONMENT.DSH_CLIENT_TITLE=SoloEngine`。
  case 'build': run('corepack', ['pnpm', 'run', 'build'], {
    env: { ...process.env, DSH_BUILD_CLIENT_PROFILE: 'official' },
  }); break
  case 'start': await start(); break
  case 'stop': stop(); break
  case 'status': status(); break
  case 'doctor': await doctor(); break
  case 'repair': repair(); break
  default:
    process.stderr.write(`soloengine: unknown command ${command} (expected init|install|build|start|stop|status|doctor|repair)\n`)
    process.exitCode = 2
}
