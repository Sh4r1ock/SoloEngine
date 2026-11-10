---
description: "Validates a canvas, orders its nodes, and materializes each node into a complete standard agent preset plus delegation bindings. It runs ins"
kind: "package-reference"
---

# @soloengine/agent-compiler

English | [中文](README.zh.md)

## Summary

Validates a canvas, orders its nodes, and materializes each node into a complete standard agent preset plus delegation bindings. It runs inside the run and packaging paths, fails loudly on unknown tools, missing models, or contradictory presets, and produces no intermediate files. The compiler is the single definition of the canvas-to-agent contract.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The run driver and the packaging service call the compiler; the compiled `AgentSpec` list feeds `createRunDriver` and the profile writer. A canvas edit never produces a second compiled artifact on disk.

## Model Experience

Indirectly, through the compiled agent preset, whose plugin rows own every model-visible prompt, schema, and result.

#### KV Cache effect

No direct effect: compilation selects existing plugin rows; those rows own the request shape and cache stability.

## Known Limitations and Deferred Work

- Compilation happens on every run and packaging request; a canvas change is not projected into an already-running session.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
