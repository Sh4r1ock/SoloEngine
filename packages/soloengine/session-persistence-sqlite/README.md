---
description: "SQLite session-log backend for SoloEngine's single-machine form: the native sessionPersistence contract stored in the business database's session_logs/session_log_events tables."
kind: "package-reference"
---

# @soloengine/session-persistence-sqlite

English | [中文](README.zh.md)

## Summary

SQLite session-log backend for SoloEngine's single-machine form. It implements the native `ctx.sessionPersistence` contract — append-only contiguous events, single-writer ownership, lazy materialization, and a durable flush barrier — in the business database's `session_logs` and `session_log_events` tables, recording its version in the shared `schema_versions`. The upstream JSONL plugin stays installed and can be restored by swapping its composition row.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this plugin in place of `@deepseek-ai/dsh-session-persistence-jsonl` and point `path` at `SOLOENGINE_DB`. The single-machine overlay (`packages/soloengine/host/cordis.form-single.patch.yml`) does this by disabling the JSONL row and inserting this one; the cloud overlay uses `@soloengine/session-persistence-postgres` instead. Events are appended by `(session_id, seq)`, never rewritten; a created but never-written session is visible in-process and disappears on close, exactly like the upstream backend. `flush()` materializes an empty session and confirms durability; SQLite transaction commit is the crash barrier.

## Model Experience

None, as the backend stores caller-provided session events and registers no prompt, tool, schema, or model-visible event of its own.

#### KV Cache effect

No effect: the backend changes where an already-assembled log is stored, not request content or ordering.

## Known Limitations and Deferred Work

- The backend keeps its tables in the business SQLite file; switching to JSONL or PostgreSQL does not migrate existing logs, because the two media are independent by design and the requirement forbids a migration tool.
- Table names are `session_logs` and `session_log_events` rather than `sessions`/`events`, because SQLite has no schema partition and the business ownership tables already use those names.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
