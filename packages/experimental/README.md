---
description: "Pre-stable prototypes for session retrieval and persistent terminal tools."
kind: "package-group"
---

# experimental/ — pre-stable prototypes

English | [中文](README.zh.md)

## Summary

Packages in this group carry complete public contracts that remain under evaluation: behavior or APIs may change, and a capability may be withdrawn. Engineering, security, documentation, testing, and released-data obligations still apply. Release packages and apps outside this group must not depend on them ([policy](../../scripts/experimental-package-policy.ts)).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-session-query`](tool-session-query/README.md) | Workspace-authorized model session search, trace, and event reads | — |
| [`tool-terminal`](tool-terminal/README.md) | Persistent terminal tools | — |

<a id="related-documentation"></a>
## Related documentation

- Session query subsystem — the retrieval services these tools project.
- Terminal subsystem — owner-scoped persistent PTY sessions.
- [Experimental package policy](../../scripts/experimental-package-policy.ts) — publication defaults and private exceptions.

<a id="dev-note"></a>
## Dev Note

None.
