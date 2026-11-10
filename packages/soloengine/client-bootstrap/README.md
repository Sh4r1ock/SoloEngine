---
description: "Browser bootstrap for the run panel. It reads the flow and session keys injected by the host, selects the canvas's latest native session, an"
kind: "package-reference"
---

# @soloengine/client-bootstrap

English | [中文](README.zh.md)

## Summary

Browser bootstrap for the run panel. It reads the flow and session keys injected by the host, selects the canvas's latest native session, and retains it through the client connection. It first declares that session to Workspace navigation, so startup restoration opens it instead of connecting — and possibly creating — a draft session. When the addressed flow has no session yet it starts one through the host bridge with the managed working root. It also reconciles Workspaces added during this panel load: once such a Workspace owns a session, the pair (canvas, directory) is registered as a run project so the host can attribute that session. It owns no plugin tree and no model context.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Loaded by the run panel client graph; `/run/:agenticFlowId` supplies the flow, and the bootstrap selects the matching session before the panel renders.

## Model Experience

None, as the browser bootstrap only selects a session and leaves model context to the host composition.

#### KV Cache effect

No effect: selection never changes request content.

## Known Limitations and Deferred Work

- Workspaces that already existed when the panel loaded are not registered: they may belong to another canvas, and the browser cannot tell which flow created them.
- A Workspace is registered only after it owns a session, so a directory the user added but never ran in leaves no run-project row.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
