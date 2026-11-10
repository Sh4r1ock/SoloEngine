---
description: "Browser presentation for the run panel: a session-header seat, chat nodes, and preview cards registered through the native conversation slot"
kind: "package-reference"
---

# @soloengine/ui-conversation

English | [中文](README.zh.md)

## Summary

Browser presentation for the run panel: a session-header seat, chat nodes, and preview cards registered through the native conversation slots. It renders logged state and never contributes model input.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Loaded by the run panel client graph; the header seat and keyed chat nodes register into the native conversation slots.

## Model Experience

None, as browser-side conversation presentation registers nothing model-facing.

#### KV Cache effect

No effect: rendered history is not request content.

## Known Limitations and Deferred Work

- It depends on the native conversation slot contract; an incompatible slot revision leaves the contributions unregistered rather than degrading to a second renderer.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
