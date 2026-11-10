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
const PLUGIN_MANIFEST = join(REPO_ROOT, 'profiles-templates', 'plugins.json')
const INSTANCE_MODULES = join(REPO_ROOT, 'data', 'dsh-home', 'profiles', 'soloengine', 'node_modules')

/**
 * 读插件清单（唯一真源 `profiles-templates/plugins.json`）：第三方版本与固化元数据。
 *
 * 不再从启动器源码正则回读常量：清单是结构化 JSON，启动器与固化脚本读同一份，
 * 新增/升级插件只改这一处。
 * @returns 包名到版本号的映射与每包的上游/档位/消费方式。
 */
function readPluginManifestFile() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(PLUGIN_MANIFEST, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read plugin manifest ${PLUGIN_MANIFEST}: ${String(error)}`)
  }
  const dependencies = parsed?.dependencies
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || Object.keys(dependencies).length === 0) {
    throw new Error(`${PLUGIN_MANIFEST} declares no dependencies`)
  }
  return { pinned: dependencies, vendor: parsed?.vendor ?? {} }
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

const { pinned, vendor } = readPluginManifestFile()
const manifest = { generatedFrom: 'profiles-templates/plugins.json', packages: [] }

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
  const meta = vendor[name] ?? { upstream: '', tier: '第三方复用', consumption: '', modifications: '未记录' }
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
