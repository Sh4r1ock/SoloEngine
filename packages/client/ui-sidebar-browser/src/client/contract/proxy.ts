/**
 * Same-origin proxy routing for the Web iframe carrier.
 *
 * A composition that serves pages through a local proxy sets `proxyPrefix`;
 * the iframe then loads `prefix/<encoded origin>/<path>` and reads the target
 * back from the frame's own address. Without a prefix the carrier loads
 * targets directly, which is the upstream behaviour.
 */
export interface BrowserProxy {
  /**
   * Proxied iframe source for one validated target.
   * @param url - the validated HTTP(S) address.
   * @returns the same-origin URL the iframe loads.
   */
  readonly sourceOf: (url: string) => string
  /**
   * Target behind a proxied address path.
   * @param pathname - the frame's same-origin pathname.
   * @returns the replayed target, or undefined when the path is not a proxy route.
   */
  readonly targetOf: (pathname: string) => string | undefined
}

/** Reason a same-origin proxy refused to load a target. */
export interface BrowserProxyRefusal {
  readonly code: string
  readonly message: string
}

/**
 * Read a proxy's JSON refusal from the document it rendered.
 *
 * The proxy answers a refused target with `{"ok":false,"error":{"code","message"}}`
 * instead of a page, so the carrier can report the reason rather than showing
 * unreadable JSON.
 * @param text - body text of the loaded document.
 * @returns the reported reason, or undefined when the body is not a refusal.
 */
export function readProxyRefusal(text: string): BrowserProxyRefusal | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return undefined
  const error = parsed.error
  if (typeof error !== 'object' || error === null || !('code' in error) || !('message' in error)) return undefined
  const { code, message } = error
  if (typeof code !== 'string' || typeof message !== 'string') return undefined
  return { code, message }
}

/**
 * Build the proxy route for a configured prefix.
 * @param prefix - proxy mount point; empty or unset leaves direct loading.
 * @returns the route, or undefined when the carrier loads targets directly.
 */
export function browserProxy(prefix: string): BrowserProxy | undefined {
  const base = prefix.replace(/\/+$/u, '')
  if (base === '') return undefined
  return {
    sourceOf: url => `${base}/__open?url=${encodeURIComponent(url)}`,
    targetOf: (pathname) => {
      if (!pathname.startsWith(`${base}/`)) return undefined
      const rest = pathname.slice(base.length + 1)
      const slash = rest.indexOf('/')
      const segment = slash === -1 ? rest : rest.slice(0, slash)
      if (segment === '' || segment.startsWith('__')) return undefined
      try {
        const binary = atob(segment.replace(/-/gu, '+').replace(/_/gu, '/'))
        const origin = new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))
        if (!origin.startsWith('http://') && !origin.startsWith('https://')) return undefined
        return `${origin}${slash === -1 ? '/' : rest.slice(slash)}`
      } catch {
        return undefined
      }
    },
  }
}
