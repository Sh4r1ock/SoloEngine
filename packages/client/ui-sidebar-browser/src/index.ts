/** Host companion for the Sidebar Browser Client plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/**
 * Embed validated Browser settings in browser pages.
 * @param ctx - Host context serving browser pages.
 * @param config - Settings the Client adopts when its tab types load.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_BROWSER_PROXY__', value: config })
  })
}
