/** Row-motion capability the Chat viewport exposes to the rows it renders. */

/** Row-local operations supplied by the containing viewport. */
export interface FlowMotionRows {
  /** @param element - visible row. @param done - commits hidden state before idle callbacks run. */
  collapse(element: HTMLElement, done: () => void): void
  /** @param element - newly visible row to grow to its natural size. */
  reveal(element: HTMLElement): void
  /** @param element - row whose active transition should be cancelled without hiding it. */
  cancelMotion(element: HTMLElement): void
}
