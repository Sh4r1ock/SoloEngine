---
description: "Container execution backend for cloud sessions: one hardened container per session, network denied by default, and pause/resume/destroy life"
kind: "package-reference"
---

# @soloengine/executor-container

English | [中文](README.zh.md)

## Summary

Container execution backend for cloud sessions: one hardened container per session, network denied by default, and pause/resume/destroy lifecycle operations. It replaces host subprocess execution when the cloud executor form is selected.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Selected by `SOLOENGINE_EXECUTOR=container` together with the cloud database form; it requires a container image and a running Docker daemon. `SOLOENGINE_EXECUTOR=microvm` selects the same assembly with an OCI runtime (`SOLOENGINE_CONTAINER_RUNTIME`, default `kata-runtime`), so the guest kernel is provided by that runtime instead of the host.

## Model Experience

None, as the container executor runs shell commands while consumer tools own model rendering.

#### KV Cache effect

No effect: container lifecycle is not model input.

## Known Limitations and Deferred Work

- Requires a container image and a running Docker daemon; the local form never loads it.
- `microvm` requires the selected OCI runtime to be registered with Docker; a missing runtime fails at create instead of falling back to `runc`.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
