/**
 * 响应体落盘：把 fetch 的流式响应写到本地文件。
 *
 * 只做字节搬运与失败清理（父目录创建、背压、半成品删除），供层下载与对象下载共用。
 *
 * @module @soloengine/image-distribution/download
 */

import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { finished } from 'node:stream/promises'
import { DistributionError } from './error.ts'

/**
 * 把响应体写到目标文件；失败时删除半成品并抛出。
 * @param response - 已成功的 fetch 响应（必须带 body）。
 * @param destination - 目标文件路径。
 */
export async function downloadResponseBody(response: Response, destination: string): Promise<void> {
  if (response.body === null) throw new DistributionError('response has no body')
  await mkdir(dirname(destination), { recursive: true })
  const reader = response.body.getReader()
  const file = createWriteStream(destination)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!file.write(Buffer.from(value))) await once(file, 'drain')
    }
    file.end()
    await finished(file)
  } catch (error) {
    file.destroy()
    await rm(destination, { force: true })
    throw error
  }
}
