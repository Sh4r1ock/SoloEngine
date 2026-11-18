# AGENTS.md

SoloEngine is a harness development system and cloud agent platform built on the Cordis plugin harness. Read the package READMEs before changing `packages/`.

## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer. Follow the version/status contract and the recorded type acknowledgements. Adjacent migration may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite uses monotonic `SCHEMA_VERSION`.

Acknowledge declared persistence-type changes in the same change.

Record each externally perceptible breaking change immediately in an upgrade guide.

**Application launch.** `soloengine-launch/bin.mjs` is the supported SoloEngine entry; inside `packages/`, only `dsh` profiles launch supported Node apps, and package bins, demos, and public SDK argv escapes are forbidden.

## Repository layout

```
vendor/      Vendored Cordis (vendor/README.md)
soloengine-framework/  SoloEngine REST, database, and product modules
soloengine-launch/     SoloEngine build/start/stop/doctor entry (bin.mjs)
soloengine-vendor/     SoloEngine vendored plugin copies
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  soloengine/           @soloengine/* product packages
  core/                 agent/session API
  api/                  remote BFF
  typert/               type graphs
  llm/                  model providers
  shell/                command execution
  subprocess/           child-process management
  ssh/                  SSH execution providers
  terminal/             persistent terminals
  ptc-runtime/          PTC execution
  sandbox/              process confinement
  deliverables/         turn deliverables
  fs/                   filesystem access
  lsp/                  language servers
  skill/                skill loading
  web/                  search/fetch tools
  computer-use/         computer interaction
  browser-use/          browser interaction
  compaction/           context compaction
  context/              request context
  subagent/             delegated agents
  jobs/                 background jobs
  bundle/               profile bundles
  workflow/             workflow execution
  todo/                 todo_write tool
  plan/                 logged planning
  goal/                 session goals
  schedule/             scheduled follow-ups
  preset/               agent composition
  guard/                loop/tool guards
  extensions/           runtime self-modification
  session/              durable sessions
  session-query/        browsing/search/export
  attachment/           binary attachments
  spill/                output spill
  storage/              non-session storage
  workspace/            workspace entities
  feedback/             human feedback
  identity/             anonymous identity
  settings/             user settings
  credentials/          credentials/authorization
  acp/                  automation-only ACP
  interaction/          human interaction
  boot/                 application boot
  sdk/                  JSON-RPC SDK
  host/                 GUI host
  client/               GUI client
  mcp/                  external tools
  experimental/         evaluated capabilities without a product-support commitment
  util/                 zero-dependency utilities
apps/        web product frontend and desktop shell
profiles-templates/  product profile bundles
deploy/      cloud deployment assets
native/      @deepseek-ai/node-addon-system source (native/README.md)
scripts/     gates and generators
```

Package groups: [packages/README.md](packages/README.md). Experimental status is independent of optional delivery; nonexperimental packages need product use or an explicit [classification](scripts/product-package-policy.ts).

## Commands

```sh
pnpm install            # pnpm workspaces, node >=24.9
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # build:artifacts + build:check, concurrently
pnpm run build:artifacts # artifacts: tsc emits lib/types, tsdown bundles runtime, Web
pnpm run build:check    # typecheck the aggregate script program against current build:artifacts output
pnpm run hygiene        # publint + workspace/package/dependency checks + NodeNext consumer check
node soloengine-launch/bin.mjs build|start|stop|status  # SoloEngine build and single-port 8991 runtime
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:ptc -- "task"  # headless PTC mode run (needs key)
pnpm run dev:web | dev:desktop  # build:artifacts, then launch; Web also rebuilds client bundles on edits. start:web | start:desktop skip the build
```

### Host sandbox failures

If a required `gh`, `pnpm`, build, test, or generator command fails because the sandbox blocks credentials, network, IPC, watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation. Require sandbox evidence; never bypass test failures or the product sandbox.

### Verification standard

Acceptance is end-to-end on the real product: start it with `node soloengine-launch/bin.mjs start` on port 8991, click through every affected page, button, form, dialog, and error path in the browser, then confirm that the UI, the runtime logs under `data/`, and the SQLite records agree. Record reproduction steps, screenshots, and logs for every defect, and rerun the same path after the fix.

- Before committing, run `pnpm run typecheck` and `pnpm run build:artifacts`; do not claim completion without their output.
- The repository carries product source and READMEs only. The upstream unit, coverage, snapshot, and CI lanes are archived under `_archive/` and are not versioned.
- Documentation changes are reviewed by reading the affected READMEs.

## Secrets / .env

Windows packaging/signing: [required reading](apps/desktop/windows-signing/README.md).

Demos that call a real provider read `DEEPSEEK_API_KEY` and optional `DEEPSEEK_BASE_URL` from root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays. Never commit credentials.

## Conventions

- Packages use `@deepseek-ai/dsh-<name>`; vendor is rescoped and `private: true`. Harness packages declare `@deepseek-ai/cordis` in `peerDependencies`/`devDependencies`. Workspace dependency sections use DSH `workspace:*`, vendor/native `workspace:~` (rules).
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher. The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range (source-launch contract). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`. Public service methods document parameters and non-void returns. `SessionEventMap` members are required-on-read unless the envelope carries `ignorable: true`. Bump `SESSION_FORMAT_VERSION` only when existing discriminators cannot prevent unsafe interpretation; same-version changes require safe reader behavior (review).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain.
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently.
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests (policy).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **No new assertions to `unknown`** (`as unknown` or `<unknown>`). Preserve or reduce the exact legacy baseline; use typed values or validation for replacements (rule).
- **Source plane vs artifact plane, never mixed.** Static gates resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency.
- **Keep compiler faces explicit.** A package with both Host and Client programs exposes face-specific leaf configs and a solution-only root; repo-wide programs seed a face config, never the root solution.
- **Error handling:** use typed, structured failures and localized, actionable reports. Define handling ownership, containment, and failure guarantees; stop dependent work and visibly report untrusted state or unknown outcomes. Follow dsh-error-handling.
- **An empty `catch` names the error** and why; keep its `try` to one statement.
- **Keep comments local.** Do not restate code, expand unrelated comments, or explain distant behavior without local need (rationale).
- **Ban `prove` + `nance`** (rule).
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Create Agent Notes only for durable decision rationale;** mechanical/local edits are exempt, including local UI changes (scope). Archived notes are frozen: never edit or treat them as current authority (archive policy).
- **Official plugin artwork:** use dsh-official-plugin-artwork for official and official experimental plugin icons; obtain designer approval before landing new glyphs.
- **Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy (decision).
- **Verification policy:** end-to-end on the real product, per the Verification standard above; the repository carries no scripted suite.
- **Design each tool's UI presentation up front.** Host presenters stay pure; Web cards derive from raw events and persisted result metadata.
- **Choose PR history deliberately.** Split independent changes and fix the introducing PR before propagation. Standalone/stack branches may merge-forward or rebase. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; preserve an in-progress merge-forward checkpoint before taking a newer base (rationale).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type (taxonomy).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency.
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Before changing a package surface, remote service, client component or state, conversation or Session behavior, or lifecycle, concurrency, subprocess, and teardown code, read the package READMEs.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Use dsh-prose-standard for decisions. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update the affected package README and JSDoc contracts together. Comments and docs state complete contracts and context, not reasoning transcripts. Current-state prose, one physical line per paragraph, and one home per fact apply to every README.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives; raise a `verify-doc-budgets` ceiling when the required content genuinely needs more space.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run build`.
