#!/usr/bin/env node
/**
 * 第三方 DSH 插件的**源码固化**与许可清单生成（plan 目录结构 `soloengine-vendor/`）。
 *
 * 为什么要固化：交付物里第三方层是从 npm 装进 profile 的，机器一换、registry 一抖，装到的东西
 * 就可能不是当初验收的那份。故把**发布包原件**留一份快照 + 记录每包的版本/许可/内容哈希，
 * 让「装出来的东西是否还是那一份」成为可核验的事实（而不是凭印象）。
 *
 * 纪律：本目录是**存档**，不是运行期来源——运行时用的仍是 profile `node_modules` 里的发布包
 * （唯一副本）；固化区只做许可合规与漂移检测，不参与解析，因此不会形成第二个实现。
 *
 * 用法：node soloengine-vendor/refresh.mjs
 *
 * @module soloengine-vendor/refresh
 */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const LAUNCHER = join(REPO_ROOT, 'soloengine-launch', 'bin.mjs')
const INSTANCE_MODULES = join(REPO_ROOT, 'data', 'dsh-home', 'profiles', 'soloengine', 'node_modules')

/**
 * 第三方包的上游与许可标识（许可标识取自包内 LICENSE 的正文判定，见 `detectLicense`）。
 *
 * 这里只写**事实**：包名、上游地址、档位、以及 SoloEngine 对它的消费方式。`modifications`
 * 记录是否改过源码——本产品对这三个包一律**不改源码**，只经组合层（bundle + patch/config）使用；
 * 若将来真的改了源码，必须在这一栏写清改了哪几处。
 */
const UPSTREAM = {
  '@anionex/dsh-turn-rewind': {
    upstream: 'https://github.com/anionex/dsh-turn-rewind',
    tier: '第三方复用（实现主干）',
    consumption: 'bundle 层 + 组合层 config（turnCheckpointMode 由本产品按工作区边界切 auto）',
    modifications: '无源码改动',
  },
  'dsh-permission-rules': {
    upstream: 'https://www.npmjs.com/package/dsh-permission-rules',
    tier: '第三方复用（白名单三缝隙之一）',
    consumption: 'bundle 层；四档预设表由组合层整行重述覆写',
    modifications: '无源码改动',
  },
  'dsh-approve-for-me': {
    upstream: 'https://www.npmjs.com/package/dsh-approve-for-me',
    tier: '第三方复用（审批应答器）',
    consumption: 'bundle 层 + 组合层 config（sandbox/approval/名称与说明）',
    modifications: '无源码改动',
  },
}

/**
 * 从包清单里读出被固化的第三方依赖（真源＝启动器的 `PLUGIN_DEPENDENCIES`）。
 *
 * 不在这里另写一份包版本：启动器的那份是安装时真正用的版本，写两份必然分叉。
 * @returns 包名到版本号的映射。
 */
function readPinnedVersions() {
  const source = readFileSync(LAUNCHER, 'utf8')
  const block = /const PLUGIN_DEPENDENCIES = \{([\s\S]*?)\n\}/u.exec(source)?.[1]
  if (block === undefined) throw new Error(`cannot read PLUGIN_DEPENDENCIES from ${LAUNCHER}`)
  const pinned = {}
  for (const match of block.matchAll(/'([^']+)':\s*'([^']+)'/gu)) pinned[match[1]] = match[2]
  if (Object.keys(pinned).length === 0) throw new Error(`PLUGIN_DEPENDENCIES in ${LAUNCHER} is empty`)
  return pinned
}

/**
 * 判定包内许可（按 LICENSE 正文里的关键句判，不猜）。
 * @param dir - 包目录。
 * @returns SPDX 标识与许可文件名（找不到即如实报 unknown）。
 */
function detectLicense(dir) {
  const candidates = readdirSync(dir).filter(name => /^(LICENSE|LICENSE\.md|LICENSE\.txt|COPYING)$/iu.test(name))
  for (const name of candidates) {
    const text = readFileSync(join(dir, name), 'utf8')
    if (/MIT License|Permission is hereby granted, free of charge/iu.test(text)) return { spdx: 'MIT', file: name }
    if (/Apache License\s*Version 2\.0/iu.test(text)) return { spdx: 'Apache-2.0', file: name }
    if (/BSD 3-Clause|Redistribution and use in source and binary forms/iu.test(text)) return { spdx: 'BSD-3-Clause', file: name }
    return { spdx: 'UNKNOWN', file: name }
  }
  return { spdx: 'UNKNOWN', file: null }
}

/**
 * 对一个目录求「与遍历顺序无关」的内容指纹。
 *
 * 逐文件 sha256 后按**相对路径排序**再合并，故结果只取决于文件集合与内容，不取决于磁盘顺序。
 * @param dir - 目录。
 * @returns 文件数与指纹。
 */
function fingerprint(dir) {
  const entries = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.isFile()) continue
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
      entries.push(`${relative(dir, path).replaceAll('\\', '/')}\u0000${hash}`)
    }
  }
  walk(dir)
  entries.sort()
  return {
    files: entries.length,
    sha256: createHash('sha256').update(entries.join('\n')).digest('hex'),
    bytes: entries.reduce((total, entry) => total + statSync(join(dir, entry.split('\u0000')[0])).size, 0),
  }
}

const pinned = readPinnedVersions()
const manifest = { generatedFrom: 'soloengine-launch/bin.mjs PLUGIN_DEPENDENCIES', packages: [] }

for (const [name, version] of Object.entries(pinned)) {
  const source = join(INSTANCE_MODULES, name)
  if (!existsSync(source)) throw new Error(`${name} is pinned to ${version} but is not installed at ${source}; run: node soloengine-launch/bin.mjs install`)
  const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (installed.version !== version) {
    throw new Error(`${name}: installed version ${String(installed.version)} != pinned ${version} (refusing to freeze an unverified build)`)
  }
  const target = join(HERE, name.replace(/^@[^/]+\//u, ''))
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true, dereference: true })
  const license = detectLicense(target)
  const prints = fingerprint(target)
  const meta = UPSTREAM[name] ?? { upstream: '', tier: '第三方复用', consumption: '', modifications: '未记录' }
  manifest.packages.push({
    name,
    version,
    license: license.spdx,
    licenseFile: license.file,
    upstream: meta.upstream,
    tier: meta.tier,
    consumption: meta.consumption,
    modifications: meta.modifications,
    vendoredPath: relative(REPO_ROOT, target).replaceAll('\\', '/'),
    files: prints.files,
    bytes: prints.bytes,
    sha256: prints.sha256,
  })
  process.stdout.write(`frozen ${name}@${version} (${license.spdx}, ${String(prints.files)} files, ${String(Math.round(prints.bytes / 1024))} KB)\n`)
}

writeFileSync(join(HERE, 'MANIFEST.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
process.stdout.write(`wrote ${join('soloengine-vendor', 'MANIFEST.json')}\n`)
