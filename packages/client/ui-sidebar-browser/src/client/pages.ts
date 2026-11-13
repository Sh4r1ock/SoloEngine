/** Assemble iframe navigation and presentation without platform branches in consumers. */
import type { BrowserPage, BrowserPageOptions } from './browser/BrowserPage.ts'
import { IframeImpl } from './browser/IframeImpl.ts'
import type { BrowserProxy } from './browser/proxy.ts'
import { IframePresentation } from './view/IframePresentation.ts'

/**
 * Assemble an idle iframe provider and its DOM presentation.
 * @param options - saved navigation and callbacks.
 * @param proxy - same-origin route for embedded pages, or undefined to load targets directly.
 * @returns the Web page's navigation and presentation objects.
 */
export function createIframePage(options: BrowserPageOptions, proxy: BrowserProxy | undefined): BrowserPage {
  const presentation = new IframePresentation({
    loaded: (revision, observation) => { frame.handleLoaded(revision, observation) },
    failed: (revision) => { frame.handleLoadFailed(revision) },
    remounted: () => { frame.reload() },
  }, proxy)
  const frame = new IframeImpl(options, presentation)
  return { frame, presentation }
}
