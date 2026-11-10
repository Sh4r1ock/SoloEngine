---
description: "Per-session execution-world subprocess provider. Shell commands run inside the session's container (`docker exec`) or full VM (`ssh`) with the workspace mapped to `/workspace`; comm"
kind: "package-reference"
---

# @soloengine/subprocess-container

English | [中文](README.zh.md)

## Summary

Per-session execution-world subprocess provider. Shell commands run inside the session's container (`docker exec`) or full VM (`ssh`) with the workspace mapped to `/workspace`; commands without a session route continue on the host so diagnostics stay available.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Composed by the cloud container form (`SOLOENGINE_EXECUTOR=container|microvm`) or the full-VM form (`full-vm`) in place of `@deepseek-ai/dsh-subprocess-local`; the shell tools route through the subprocess seam unchanged. In the full-VM form, `vmStateDir` / `vmSshKey` / `vmSshUser` let terminal requests read the per-session SSH route from the node state file.

## Model Experience

None, as the per-session subprocess provider routes commands while shell tools own model rendering.

#### KV Cache effect

No effect: command routing is not request content.

## Known Limitations and Deferred Work

- Without `requireSessionRoute`, a missing session route silently falls back to the host process; the container and full-VM forms enable the guard at startup.
- Container and full-VM worlds are mutually exclusive: a configured `vmStateDir` disables the container terminal fallback.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
