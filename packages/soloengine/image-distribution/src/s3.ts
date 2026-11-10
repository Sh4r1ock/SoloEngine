/**
 * S3 兼容对象存储（W13）：工作区对象权威存储的部署适配器。
 *
 * 与 {@link FilesystemObjectStore} 同一 {@link ObjectStore} 三个方法，因此工作区同步
 * （本地副本 + 远端权威）不需要改动即可切到云端对象存储。签名按 AWS Signature V4
 * （S3 服务），默认 path-style 寻址，兼容 AWS S3、MinIO 与提供 S3 兼容端点的对象存储。
 *
 * 凭据是部署输入，缺失或鉴权失败直接报错（不静默降级到本地存储）。对象键为
 * `<prefix>/<digest>`，内容寻址语义与本地缓存一致。
 *
 * @module @soloengine/image-distribution/s3
 */

import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { downloadResponseBody } from './download.ts'
import { DistributionError } from './error.ts'
import type { ObjectStore } from './object-store.ts'

/** 空载荷的 SHA-256（GET/HEAD 与建桶请求使用）。 */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** S3 兼容对象存储配置。 */
export interface S3ObjectStoreOptions {
  /** 服务端点（如 `http://127.0.0.1:9000` 或 `https://s3.us-east-1.amazonaws.com`）。 */
  endpoint: string
  /** 桶名。 */
  bucket: string
  /** 区域（SigV4 作用域；MinIO 可用 `us-east-1`）。 */
  region: string
  /** 访问密钥 id。 */
  accessKeyId: string
  /** 访问密钥 secret。 */
  secretAccessKey: string
  /** 对象键前缀（默认 `objects`）。 */
  prefix?: string
  /** 临时凭据的会话令牌（可选）。 */
  sessionToken?: string
}

/**
 * 计算字符串的 SHA-256 十六进制摘要。
 * @param value - 输入。
 * @returns 十六进制摘要。
 */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * HMAC-SHA256。
 * @param key - 密钥。
 * @param value - 输入。
 * @returns 摘要字节。
 */
function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

/** S3 兼容对象存储（SigV4、path-style）。 */
export class S3ObjectStore implements ObjectStore {
  private readonly endpoint: string
  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly prefix: string
  private readonly sessionToken: string | undefined

  /**
   * @param options - 端点、桶、区域与凭据。
   */
  constructor(options: S3ObjectStoreOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/u, '')
    this.bucket = options.bucket
    this.region = options.region
    this.accessKeyId = options.accessKeyId
    this.secretAccessKey = options.secretAccessKey
    this.prefix = options.prefix ?? 'objects'
    this.sessionToken = options.sessionToken
  }

  /**
   * 幂等创建桶（部署引导；已存在视为成功）。
   */
  async ensureBucket(): Promise<void> {
    const response = await this.send('PUT', undefined, new Uint8Array(0), EMPTY_SHA256)
    if (response.status === 200 || response.status === 409) return
    throw new DistributionError(`S3 bucket ${this.bucket} could not be created (${String(response.status)})`, await response.text())
  }

  async has(digest: string): Promise<boolean> {
    const response = await this.send('HEAD', this.keyOf(digest), undefined, EMPTY_SHA256)
    if (response.status === 200) return true
    if (response.status === 404) return false
    throw new DistributionError(`S3 HEAD ${this.keyOf(digest)} failed (${String(response.status)})`, await response.text())
  }

  async get(digest: string, destination: string): Promise<void> {
    const response = await this.send('GET', this.keyOf(digest), undefined, EMPTY_SHA256)
    if (response.status === 404) {
      throw new DistributionError(`object ${digest} is not in the S3 bucket ${this.bucket}`)
    }
    if (!response.ok) {
      throw new DistributionError(`S3 GET ${this.keyOf(digest)} failed (${String(response.status)})`, await response.text())
    }
    if (response.body === null) throw new DistributionError(`S3 GET ${this.keyOf(digest)} returned no body`)
    await downloadResponseBody(response, destination)
  }

  async put(digest: string, source: string): Promise<void> {
    const body = new Uint8Array(await readFile(source))
    const payloadHash = digest.startsWith('sha256:')
      ? digest.slice('sha256:'.length)
      : createHash('sha256').update(body).digest('hex')
    const response = await this.send('PUT', this.keyOf(digest), body, payloadHash)
    if (!response.ok) {
      throw new DistributionError(`S3 PUT ${this.keyOf(digest)} failed (${String(response.status)})`, await response.text())
    }
  }

  /**
   * 对象键。
   * @param digest - 内容摘要。
   * @returns `<prefix>/<digest>`。
   */
  private keyOf(digest: string): string {
    return `${this.prefix}/${digest}`
  }

  /**
   * 发送一次签名请求。
   * @param method - HTTP 方法。
   * @param key - 对象键；省略时对桶本身操作。
   * @param body - 请求体。
   * @param payloadHash - 载荷 SHA-256 十六进制。
   * @returns 响应。
   */
  private async send(
    method: string,
    key: string | undefined,
    body?: Uint8Array<ArrayBuffer>,
    payloadHash = EMPTY_SHA256,
  ): Promise<Response> {
    const segments = key === undefined ? [this.bucket] : [this.bucket, ...key.split('/')]
    const path = `/${segments.map(segment => encodeURIComponent(segment)).join('/')}`
    const url = new URL(`${this.endpoint}${path}`)
    const headers = this.sign(method, url, payloadHash)
    const requestHeaders: Record<string, string> = { ...headers }
    delete requestHeaders['host']
    return await fetch(url, {
      method,
      headers: requestHeaders,
      ...body === undefined ? {} : { body },
    })
  }

  /**
   * 生成 SigV4 头（含 Authorization）。
   * @param method - HTTP 方法。
   * @param url - 目标地址。
   * @param payloadHash - 载荷 SHA-256 十六进制。
   * @returns 待发送头（含 host 与 authorization）。
   */
  private sign(method: string, url: URL, payloadHash: string): Record<string, string> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/gu, '')
    const dateStamp = amzDate.slice(0, 8)
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }
    if (this.sessionToken !== undefined) headers['x-amz-security-token'] = this.sessionToken
    const names = Object.keys(headers).sort()
    const canonicalHeaders = names.map(name => `${name}:${headers[name] as string}\n`).join('')
    const signedHeaders = names.join(';')
    const canonicalRequest = `${method}\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretAccessKey}`, dateStamp), this.region), 's3'),
      'aws4_request',
    )
    const signature = hmac(signingKey, stringToSign).toString('hex')
    return {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    }
  }
}
