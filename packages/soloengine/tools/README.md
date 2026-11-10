---
description: "SoloEngine-only tools for the host: get_diagnostics reports the calling agent's identity, model route, session size, and visible tools."
kind: "package-reference"
---

# @soloengine/tools

English | [中文](README.zh.md)

## Summary

SoloEngine-specific tools for the run host. It registers `get_diagnostics`, a read-only tool that reports the calling agent's identity, model route, session size, and the tools it can currently see. The tool exists so an agent can check its own execution environment before assuming a capability is available. All registrations are effect-based and disappear with the agent scope.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mounted by the product profile's tool row; the tool registers into the agent scope through `ctx.tools.register`, so it follows the normal tool lifecycle and permission pipeline.

## Model Experience

### Diagnostics tool

#### What the model sees

`get_diagnostics` returns the owning agent identity, the model route it runs on, the session size, and the names of the tools currently visible to that agent. The tool is read-only and takes no arguments.

#### Token effect

The tool schema and one small structured result per call; the result is bounded by the agent's visible tool names.

#### KV Cache effect

The schema is stable for a given composition; results append after the request prefix and do not invalidate it.

## Known Limitations and Deferred Work

- The result describes one agent's view; it is not a whole-runtime inventory and deliberately omits other agents' routes and tools.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
