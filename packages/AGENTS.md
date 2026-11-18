# AGENTS.md — Harness Packages

These package-specific rules supplement the repo-wide [conventions](../AGENTS.md#conventions).

- **Plugin exports:** service packages default-export their service class; function plugins named-export `name` / `inject` / `Config` / `apply` and have no default export. Mixing the forms makes the Loader discard the function plugin's namespace.
- **Optional services use `ctx.get(name)`.** Reserve `ctx.<name>` for declared injections; the property proxy is topology-sensitive, while strict `ctx.get` reads the global service store.
- **Initiator-owned private chains derive, then capture.** Under `ctx.agents.withInitiator()`, recover the Agent at each orchestration entry, derive `agent.session`, and let operation-local helpers close over it. Keep `Agent` and `Session` explicit at lifecycle, session-log, service, authority, worker/process, persistence, and wire interfaces; do not widen a leaf helper from `Session` to `Context` merely to hide a parameter (rationale).
- **Represent one asynchronous operation with one lifecycle controller or transaction.** Separate readiness, cancellation, disposal, reservation, or sentinel state requires an independent owner or settlement point; otherwise fold it while preserving rollback, callback containment, and quiescence.
- **Design Service Definitions for all current Consumers.** Keep tool-schema, Loader, UI, transport, and provider-specific behavior in the Consumer or provider; do not let one Consumer dictate the service contract (capability-seam rationale). Inverse smell: a public service method with one internal caller — pass a private capability closure instead (`RunCodeBridgeOptions`).
- **Require a current owner and need.** Tie each abstraction, state machine, option, defensive copy, and compatibility path to a current contract or production consumer, and keep behavior in its owning plugin or service.
- **Require evidence for public choices.** Configurability does not justify an unsupported default, public operation set, format, or imported external concept. Use current-consumer evidence or relevant prior art; otherwise require an explicit value or defer the choice.
- **Write model-facing contracts from the model's perspective.** Prompts, tool schemas, results, and diagnostics contain only task-relevant concepts, not UI, transport, or implementation vocabulary. Pin stable model-visible text verbatim and verify dynamic behavior end to end.
- **Enforce a decision in the operation that makes it.** Schema omission, prompt filtering, facades, wrappers, and listener order are not enforcement when direct or alternate callers can bypass them; test denial through the executor.
- **Publish state only at its commit point.** Emit each notification and update derived state only after the operation succeeds; derive caches, prompts, UI echoes, replay, and query views from one authoritative source.
- **Apply bounds to the complete result.** Enforce byte, token, item, and time limits where the complete emitted or retained value, including wrappers and metadata, is known; verify tiny and exact limits, oversized single chunks, and multibyte byte limits.
- **Publish `./invariant` only for diverging observations.** Check an owned relation under the manifest name. Otherwise omit wiring and give the package-specific README reason. Empty companions and ignored reporters fail `verify-package-invariants`.

Naming rules:

- **Package tsconfig:** extends `tsconfig.base.json` (Client: `tsconfig.base.client.json`), sets `rootDir: src` and `outDir: lib/types`, references workspace dependencies, references `runtime-diagnostics/invariants` only when the package publishes `./invariant`, and registers in one aggregate. Packages with distinct Host and Client compiler faces use `tsconfig.host.json` and `tsconfig.client.json` leaves plus a solution-only root; ordinary two-entry Client plugins do not split.
- `src/types.ts` contains only types — no runtime code.
- Update package README and JSDoc contracts in the same commit as behavior, and verify them against code with dsh-prose-standard. Group READMEs declare subsystem ownership through a canonical English page link or justified [exemption](../scripts/verify-subsystem-pages.ts).
- Package READMEs document model, token, and KV-cache effects using the canonical Model Experience format.
- Package READMEs put durable consumer gaps and non-obvious maintainer constraints under `## Known Limitations and Deferred Work`; ordinary cleanup stays in its TODO or Agent Note. Packages with none use a justified [allowlist entry](../scripts/verify-package-readme-limitations.ts).
