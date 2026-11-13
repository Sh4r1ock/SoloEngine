/** Iframe DOM and revision-tagged load observations. */
import { readProxyRefusal, type BrowserProxy, type BrowserProxyRefusal } from '../browser/proxy.ts'
import type { BrowserTarget } from '../browser/url.ts'
import type { BrowserPresentation } from './BrowserPresentation.ts'
import css from './Browser.module.css'

/** Fixed iframe policy; top navigation and downloads are not granted directly. */
export const WEB_BROWSER_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'

interface IframeDocument {
  readonly target: BrowserTarget
  readonly revision: number
  readonly sandboxed: boolean
}

/** What one controlled load revealed about the frame it rendered. */
export interface IframeObservation {
  /** The address the frame actually shows, when the carrier can read it. */
  readonly address?: string
  /** The local proxy refused the target; the frame contains its JSON refusal. */
  readonly rejection?: BrowserProxyRefusal
}

/** Reports only what an iframe can observe without inspecting cross-origin content. */
export interface IframePresentationEvents {
  readonly loaded: (revision: number, observation: IframeObservation) => void
  readonly failed: (revision: number) => void
  readonly remounted: () => void
}

/** Owns the iframe element; navigation and history remain in IframeImpl. */
export class IframePresentation implements BrowserPresentation {
  private host: HTMLElement | undefined
  private element: HTMLIFrameElement | undefined
  private document: IframeDocument | undefined
  private rendered = false

  /**
   * @param events - provider-owned load and remount callbacks.
   * @param proxy - same-origin route, or undefined to load targets directly.
   */
  constructor(private readonly events: IframePresentationEvents, private readonly proxy: BrowserProxy | undefined) {}

  /** @param viewportId - mounted placeholder. @returns removes only the iframe presentation. */
  mount(viewportId: string): () => void {
    const host = document.getElementById(viewportId)
    if (host === null) throw new Error('iframe presentation: viewport is not mounted')
    this.element?.remove()
    this.element = undefined
    this.host = host
    if (this.rendered) this.events.remounted()
    else this.render()
    return () => {
      if (this.host !== host) return
      this.element?.remove()
      this.element = undefined
      this.host = undefined
    }
  }

  /**
   * Retain the prepared document and render it when a container is mounted.
   * @param value - prepared document and event generation.
   */
  show(value: IframeDocument): void {
    this.document = value
    this.render()
  }

  /** Remove the owned DOM and retained presentation data. */
  dispose(): void {
    this.element?.remove()
    this.element = undefined
    this.host = undefined
    this.document = undefined
  }

  /**
   * Read what a same-origin frame reveals about its load.
   * @param element - the iframe whose document just loaded.
   * @returns the observed target address, a proxied refusal, or nothing.
   */
  private observe(element: HTMLIFrameElement): IframeObservation {
    const frameWindow = element.contentWindow
    if (frameWindow === null) return {}
    let pathname: string
    try {
      pathname = frameWindow.location.pathname
    } catch {
      // Cross-origin without a proxy: the address stays application-known, as upstream.
      return {}
    }
    // 跨源 iframe 的 contentDocument 在运行期是 null（DOM 类型未建模该事实）。
    const document: Document | null = element.contentDocument
    // Only JSON documents are inspected: the proxy answers a refused target with a
    // `{ok:false}` body and never with HTML, so page content is not scanned.
    if (document?.contentType === 'application/json') {
      const rejection = readProxyRefusal(document.body.textContent)
      if (rejection !== undefined) return { rejection }
    }
    if (this.proxy === undefined) return {}
    const target = this.proxy.targetOf(pathname)
    return target === undefined ? {} : { address: target }
  }

  private render(): void {
    const current = this.document
    const host = this.host
    if (current === undefined || host === undefined) return
    this.element?.remove()
    const element = document.createElement('iframe')
    element.className = css.frame as string
    element.src = this.proxy?.sourceOf(current.target.url) ?? current.target.url
    element.title = current.target.title
    element.referrerPolicy = 'no-referrer'
    element.dataset.sidebarBrowserFrame = 'iframe'
    if (current.sandboxed) element.setAttribute('sandbox', WEB_BROWSER_SANDBOX)
    element.addEventListener('load', () => {
      if (this.element === element) this.events.loaded(current.revision, this.observe(element))
    })
    element.addEventListener('error', () => {
      if (this.element === element) this.events.failed(current.revision)
    })
    this.element = element
    this.rendered = true
    host.append(element)
  }
}
