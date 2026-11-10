---
description: "Browser operation-area layer: renders follow intents and opens the matching resource or tab, plus the file-change ledger panel"
kind: "package-reference"
---

# @soloengine/ui-operation-area

English | [中文](README.zh.md)

## Summary

Browser operation-area layer: renders follow intents and opens the matching resource or tab, plus the file-change ledger panel. It presents host records and registers nothing model-facing. The browser tab belongs to the shipped Sidebar Browser package, which loads pages through `@soloengine/browser-proxy`; this package registers no second browser panel.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Registered in the run panel operation area; follow intents and file-change records come from host projections.

## Model Experience

None, as browser-side operation-area panels register nothing model-facing.

#### KV Cache effect

No effect: panels render host records without changing requests.

## Known Limitations and Deferred Work

- Auto-follow depends on the host's persisted intent records; a session without them opens no panel automatically.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
