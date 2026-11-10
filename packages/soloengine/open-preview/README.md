---
description: "SoloEngine preview records: declares the soloengine/preview session event family, a deduplicating projection capped at fifty records, and the open_preview tool."
kind: "package-reference"
---

# @soloengine/open-preview

English | [中文](README.zh.md)

## Summary

SoloEngine preview records on the host side. The package declares the `soloengine/preview` session event family, registers a projection that deduplicates records and keeps the latest fifty, and exposes the `open_preview` tool so an agent can record a previewable artifact for the current session. Records are log-only and client-facing; they do not enter later model requests.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mounted by the product profile; the projection is registered through `ctx.sessionProjections.register` and the tool through the native tool runtime. The run panel reads the projection, not the raw event log.

## Model Experience

### Preview tool

#### What the model sees

`open_preview` records a previewable artifact for the current session and returns the stored record; it does not read the artifact back into the conversation.

#### Token effect

The tool schema and one result per call; preview records themselves stay in the session log.

#### KV Cache effect

The schema is stable for a given composition; results append after the request prefix and do not invalidate it.

## Known Limitations and Deferred Work

- The projection keeps only the latest fifty records; older previews remain in the session log but are not shown in the panel.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
