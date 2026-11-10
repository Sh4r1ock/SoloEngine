---
description: "PostgreSQL key-value backend for the native storage service, registered as `postgres`. It stores caller-provided units in the shared `kv` sc"
kind: "package-reference"
---

# @soloengine/storage-postgres

English | [中文](README.zh.md)

## Summary

PostgreSQL key-value backend for the native storage service, registered as `postgres`. It stores caller-provided units in the shared `kv` schema and can be replaced by the SQLite or JSON backend without changing consumers.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Inserted by the cloud form and selected through `storage-domain` with `backend: postgres`.

## Model Experience

None, as the KV backend stores caller-provided units without registering anything model-facing.

#### KV Cache effect

No effect: stored units are not request content by themselves.

## Known Limitations and Deferred Work

- Units written by one backend are not migrated to another; backend replacement starts from an empty namespace.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
