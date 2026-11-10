/** Deployment settings shared by the Host and browser halves of the Browser tab. */
import z from '@deepseek-ai/schemastery'

/** Sidebar Browser settings. */
export interface Config {
  /**
   * Same-origin proxy route the Client embeds pages through.
   *
   * Empty loads each target directly, which keeps the frame cross-origin and lets the
   * carrier observe only application-known addresses.
   */
  proxyPrefix: string
}

/** Validated Browser settings; direct loading unless a composition mounts a proxy. */
export const Config: z<{ proxyPrefix?: string }, Config> = z.object({
  proxyPrefix: z.string().default(''),
})
