---
description: "Line-oriented agent terminal tabs in the Web right sidebar: attach to the Session's platform terminals, read bounded scrollback, send one line at a time, and recover the attached terminal across reloads."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-terminal

English | [中文](README.zh.md)

## Summary

Open a terminal tab in the right sidebar to continue the agent terminals of the current Session. The panel attaches to the platform PTY sessions the terminal tools operate, shows their bounded scrollback, and sends one line at a time; ownership is the Session's, so a Session never reaches another Session's terminal. The contract is line-oriented, so full-screen TUI programs are not rendered here. A reload restores the tab onto the same terminal, and after a Host restart the panel replays the output the session log persisted and labels the new terminal as a new generation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `terminal.new` command opens a terminal tab in the focused dock pane, replacing a guide and retaining existing content pages. Windows and macOS Web use the [shortcut service’s platform defaults](../shortcuts/README.md); Linux Web leaves the command unbound by default. The guide card right-aligns the current effective shortcut as unboxed text without a duplicate tooltip.

A tab opened without a `terminalId` reattaches to the terminal it showed before a page reload, else reuses the Session's first agent terminal, or creates one when the Session has none. A tab opened with `{ terminalId }` attaches to that exact terminal, including one the terminal tools created. The chip strip lists the Session's terminals and **New terminal** creates another. A terminal the registry no longer holds reports a localized missing-terminal line instead of a transport message.

The body polls the active terminal's scrollback while the tab is visible and the process runs, pauses while the tab is hidden, and stops once the process exits (the exit code is shown when the registry reports one). Enter or **Send** writes the composer's line; **Interrupt** delivers `SIGINT` to the foreground command. Closing the tab does not kill the terminal, because the agent may still be using it; only the tab's recovery record is dropped.

After a Host restart the terminal is gone but its bounded output is not: `terminal_send` publishes each foreground viewport as tool-result presentation metadata, and the Session log persists it. The panel shows that persisted portion above the live screen and labels the terminal it creates as a new generation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers the `terminal` type with the right sidebar, the guide card, the keyed body under `sidebar.right.pane.tab`, and a static chip title. The body receives an injected face bound to the tab's Session: `list`, `spawn`, `read`, `send`, and `interrupt` call the `remote.terminal` agent-terminal methods (`agentTerminals`, `agentSpawn`, `agentRead`, `agentSend`, `agentSignal`) on [`api-terminal-controller`](../../api/terminal-controller/README.md#agent-terminals); `persisted` reads the same Session's loaded event window through `ctx.sessions` and rebuilds its tool-result viewports without a Host call.

The registry (`ctx.terminals`) is the single source of terminal sessions, so the panel shows exactly what the terminal tools use; ownership is enforced by the registry on the Host, not by the browser. Pages are requested newest-first in bounded counts, and the panel keeps one page in memory rather than a growing buffer. The tab record's abort signal is the lifetime of every call; a rebuilt tab record does not restart the open effect because the signal is read through a ref.

The Sidebar persists tab records without navigation parameters, so the tab's own recovery record (`tab → terminalId`, bounded per browser profile) carries the attachment across reloads. Closing the tab unregisters that record through the Sidebar's close handler; the terminal itself is left alone.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Terminal controller](../../api/terminal-controller/README.md)
- [Terminal registry](../../terminal/terminal/README.md)
- [Right Sidebar](../../client/ui-sidebar-right/README.md)

<a id="model-experience"></a>
## Model Experience

None, as this package handles user terminal interaction without adding model input.

#### KV Cache effect

None; terminal output travels only between the browser and Host.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Line contract only.** Full-screen TUI programs are not rendered; the panel shows the registry's retained lines.
- **One scrollback page.** Older retained output beyond the requested page is not paged in yet.
- **No rename or resize.** A terminal keeps the name its creator gave it, and the panel does not resize a PTY.
- **History is bounded.** The feature does not send terminal output to the Agent and does not restore processes after a Host restart; it replays only the bounded output the session log still holds through tool results.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
