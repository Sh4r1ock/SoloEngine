/**
 * 权威对象存储的注入面（工作区对象）。
 *
 * @module @soloengine/image-distribution/object-store
 */

/** 权威对象存储（远端）的注入面。 */
export interface ObjectStore {
  /** 对象是否已在权威存储中。 */
  has(digest: string): Promise<boolean>
  /** 从权威存储下载到本地路径。 */
  get(digest: string, destination: string): Promise<void>
  /** 把本地文件写入权威存储。 */
  put(digest: string, source: string): Promise<void>
}
