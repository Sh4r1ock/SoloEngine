---
description: "PostgreSQL session-search backend: maintains a disposable FTS index in the shared `search` schema through the native `sessionQuery` contract"
kind: "package-reference"
---

# @soloengine/session-query-postgres

English | [中文](README.zh.md)

## Summary

PostgreSQL session-search backend: maintains a disposable FTS index in the shared `search` schema through the native `sessionQuery` contract. It can be replaced by the SQLite or upstream backend by swapping its composition row.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Inserted by the cloud form; the native SQLite search row is disabled in the same overlay.

## Model Experience

None, as the search backend indexes already-logged events and returns hits only to callers.

#### KV Cache effect

No effect: indexed text was already part of earlier requests.

## Known Limitations and Deferred Work

- The index is derived and disposable; switching backends rebuilds it instead of migrating the old index.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
