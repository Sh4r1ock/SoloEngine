---
description: "The SoloEngine group map: framework layer, harness host plugin, per-flow instance runtime, product client plugins, and the database, execution and cloud providers of the platform."
kind: "package-group"
---

# packages/soloengine

English | [中文](README.zh.md)

## Summary

Use this group to run SoloEngine. The framework layer (`soloengine-framework/`) owns the business REST surface, accounts and the change ledger; [`host/`](host/README.md) mounts it into the harness web server and drives canvas runs; [`instance-runtime/`](instance-runtime/README.md) composes one harness instance per flow; the `ui-*` packages add product client surfaces; the remaining packages provide database, session persistence, execution and cloud providers. Every provider replaces an upstream capability in place rather than adding a parallel stack.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Area | Packages | Role |
|---|---|---|
| Runtime | [`host/`](host/README.md), [`instance-runtime/`](instance-runtime/README.md), [`agent-compiler/`](agent-compiler/README.md) | harness mounting and runs, per-flow composition, canvas compilation |
| Tools and models | [`tools/`](tools/README.md), [`llm-db-adapter/`](llm-db-adapter/README.md), [`open-preview/`](open-preview/README.md), [`types/`](types/README.md) | product tool rows, database-backed model routes, preview events, shared types |
| Client plugins | [`ui-theme/`](ui-theme/README.md), [`ui-conversation/`](ui-conversation/README.md), [`ui-operation-area/`](ui-operation-area/README.md), [`ui-document-editor/`](ui-document-editor/README.md), [`client-bootstrap/`](client-bootstrap/README.md), [`browser-proxy/`](browser-proxy/README.md) | product surfaces mounted through native slots and tab types |
| Persistence and cloud | `business-db-postgres/`, `storage-postgres/`, `session-persistence-sqlite/`, `session-persistence-postgres/`, `session-query-sqlite/`, `session-query-postgres/` | business database and session log/query providers for the single and cloud forms |
| Execution and distribution | `sandbox-container/`, `subprocess-container/`, `executor-container/`, `executor-vm/`, `egress-proxy/`, `image-distribution/`, `cloud-control/`, `cloud-control-postgres/` | container and full-VM executors, egress policy, image layers, control plane and gateway |

## Related documentation

- [Architecture](../../docs/soloengine/01-架构.md)
- [Composition and plugin inventory](../../docs/soloengine/02-组合与插件全量清单.md)
- [Data layer](../../docs/soloengine/03-数据层.md)
- [REST and account domain](../../docs/soloengine/04-REST与账号域.md)

## Dev Note

The framework layer is plain TypeScript modules; only `host` runs inside the plugin tree. Adding a capability means extending a framework module or a provider package, never forking an upstream plugin.
