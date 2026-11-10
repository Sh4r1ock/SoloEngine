---
description: "Per-flow harness instance assembly. Each agenticflow gets a derived scope and a mountable plugin tree built from DSH scope and loader primit"
kind: "package-reference"
---

# @soloengine/instance-runtime

English | [中文](README.zh.md)

## Summary

Per-flow harness instance assembly. Each agenticflow gets a derived scope and a mountable plugin tree built from DSH scope and loader primitives, so flow-level registrations shadow the baseline, agent scopes inherit them, and disposal removes only that flow's layer.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The run driver acquires an instance per flow, isolates replaced services before mounting, binds each agent scope under the flow, and releases the instance when the last session ends.

## Model Experience

None, as the assembly layer creates scopes and plugin trees while mounted plugins own every model-visible contribution.

#### KV Cache effect

No effect: scope assembly changes where registrations live, not request content.

## Known Limitations and Deferred Work

- A per-flow plugin that replaces a baseline service must declare the service names through `FlowInstance.isolate` before mounting; the runtime cannot infer them from a package.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
