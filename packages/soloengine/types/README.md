---
description: "Compile and runtime contract types for SoloEngine: canvas data, compiled agent specs, run inputs, routes, projections, and the canvas tool v"
kind: "package-reference"
---

# @soloengine/types

English | [中文](README.zh.md)

## Summary

Compile and runtime contract types for SoloEngine: canvas data, compiled agent specs, run inputs, routes, projections, and the canvas tool vocabulary. The package has no runtime behavior and is the single source of those types.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Imported by the framework, the host, the compiler, and the product pages; the `TOOL_MAP` vocabulary is shared with the canvas editor.

## Model Experience

None, as the package declares compile and runtime contracts only and consumers own every model-facing use.

#### KV Cache effect

No effect: type declarations never reach a request.

## Known Limitations and Deferred Work

- Types are pre-stable and change with their consumers; there is no compatibility layer for older compiled products.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
