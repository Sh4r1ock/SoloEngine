---
description: "PostgreSQL session-log backend: appends events to `log.sessions`/`log.session_events` in the shared PG database, keeps headers in a separate"
kind: "package-reference"
---

# @soloengine/session-persistence-postgres

English | [中文](README.zh.md)

## Summary

PostgreSQL session-log backend: appends events to `log.sessions`/`log.session_events` in the shared PG database, keeps headers in a separate row, and implements the native `sessionPersistence` contract. It is the cloud sibling of the SQLite and JSONL backends.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Inserted by the cloud form with the shared `SOLOENGINE_DATABASE_URL`; the JSONL row is disabled in the same overlay.

With `controlUrl` and `nodeId` configured, each write handle records the writer epoch from the control plane when it opens, and every append verifies `(nodeId, epoch)`. A handle whose session was taken over (higher epoch) is fenced out with `SessionWriteFencedError` instead of writing a second copy of the log.

## Model Experience

None, as the session-log backend stores caller-provided events without registering anything model-facing.

#### KV Cache effect

No effect: stored events are replayed into requests by the session layer, not by this backend.

## Known Limitations and Deferred Work

- The cloud form requires `SOLOENGINE_DATABASE_URL`; a missing URL fails startup instead of falling back to a local file.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
