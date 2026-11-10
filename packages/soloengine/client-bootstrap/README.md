---
description: "Browser bootstrap for the run panel. It reads the flow and session keys injected by the host, selects the canvas's latest native session, an"
kind: "package-reference"
---

# @soloengine/client-bootstrap

English | [中文](README.zh.md)

## Summary

Browser bootstrap for the run panel. It reads the flow and session keys injected by the host, selects the canvas's latest native session, and retains it through the client connection. It first declares that session to Workspace navigation, so startup restoration opens it instead of connecting a draft session. With no session it starts one through the host bridge with the managed working root. It also registers Workspaces added during this panel load as run projects before any session exists, so the account scope can show their new sessions. It owns no plugin tree and no model context.

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
- A Workspace the user added but never ran in keeps an empty run-project row.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
