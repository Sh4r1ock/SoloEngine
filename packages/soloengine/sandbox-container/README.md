---
description: "Container sandbox provider: declares the session execution boundary as the per-session container and refuses calls without a session scope. "
kind: "package-reference"
---

# @soloengine/sandbox-container

English | [中文](README.zh.md)

## Summary

Container sandbox provider: declares the session execution boundary as the per-session container and refuses calls without a session scope. It pairs with the container subprocess provider so shell commands cannot escape the session's container.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Composed by the cloud container form; the sandbox seam selects it for every session-scoped execution.

## Model Experience

None, as the sandbox provider declares an execution boundary without registering anything model-facing.

#### KV Cache effect

No effect: confinement does not change request content.

## Known Limitations and Deferred Work

- The provider assumes the container subprocess row is composed in the same profile; a mixed composition fails at load.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
