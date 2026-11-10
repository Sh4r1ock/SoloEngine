/**
 * 工作区权威对象存储的部署解析（W13）。
 *
 * `SOLOENGINE_WORKSPACE_STORE` 接受两种值：
 * - 文件系统路径（共享卷/单机）→ {@link FilesystemObjectStore}；
 * - `s3://<bucket>/<prefix>` → {@link S3ObjectStore}，端点与凭据来自
 *   `SOLOENGINE_S3_ENDPOINT` / `SOLOENGINE_S3_REGION` / `SOLOENGINE_S3_ACCESS_KEY` /
 *   `SOLOENGINE_S3_SECRET_KEY`（`SOLOENGINE_S3_SESSION_TOKEN` 可选）。
 *
 * 配置不完整或用了不支持的 scheme 时在加载期失败；不在运行时退回本地存储。
 *
 * @module @soloengine/host/object-store-config
 */

import { resolve } from 'node:path'
import { FilesystemObjectStore, S3ObjectStore, type ObjectStore } from '@soloengine/image-distribution'

/**
 * 读取必填环境变量。
 * @param env - 环境变量表。
 * @param key - 变量名。
 * @returns 去空白后的值。
 */
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = (env[key] ?? '').trim()
  if (value === '') throw new Error(`soloengine: SOLOENGINE_WORKSPACE_STORE=s3:// requires ${key}`)
  return value
}

/**
 * 按部署值构造权威对象存储。
 * @param value - `SOLOENGINE_WORKSPACE_STORE` 的取值。
 * @param env - 环境变量表（测试可注入）。
 * @returns 文件系统或 S3 兼容对象存储。
 */
export function objectStoreFromEnv(value: string, env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const raw = value.trim()
  if (raw === '') throw new Error('soloengine: SOLOENGINE_WORKSPACE_STORE is empty')
  if (raw.startsWith('s3://')) {
    const url = new URL(raw)
    const bucket = decodeURIComponent(url.hostname)
    if (bucket === '') throw new Error(`soloengine: S3 workspace store has no bucket: ${raw}`)
    const prefix = url.pathname.replace(/^\/+/u, '').replace(/\/+$/u, '') || 'objects'
    const sessionToken = (env.SOLOENGINE_S3_SESSION_TOKEN ?? '').trim()
    return new S3ObjectStore({
      endpoint: required(env, 'SOLOENGINE_S3_ENDPOINT'),
      bucket,
      region: (env.SOLOENGINE_S3_REGION ?? '').trim() || 'us-east-1',
      accessKeyId: required(env, 'SOLOENGINE_S3_ACCESS_KEY'),
      secretAccessKey: required(env, 'SOLOENGINE_S3_SECRET_KEY'),
      prefix,
      ...sessionToken === '' ? {} : { sessionToken },
    })
  }
  if (raw.includes('://')) {
    throw new Error(`soloengine: unsupported SOLOENGINE_WORKSPACE_STORE scheme: ${raw}`)
  }
  return new FilesystemObjectStore(resolve(raw))
}
