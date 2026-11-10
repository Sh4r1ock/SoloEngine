---
description: "Optional PostgreSQL implementation of SoloEngine's business database port. It creates the same fourteen management tables in one PG schema, "
kind: "package-reference"
---

# @soloengine/business-db-postgres

English | [中文](README.zh.md)

## Summary

Optional PostgreSQL implementation of SoloEngine's business database port. It creates the same fourteen management tables in one PG schema, records versions in the shared `schema_versions`, and keeps the framework core free of a `pg` dependency. The single-machine form uses the SQLite sibling instead.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Selected by `SOLOENGINE_DB_FORM=cloud`; the framework imports it dynamically so the single-machine form never loads `pg`.

## Model Experience

None, as the business database adapter stores management rows without registering anything model-facing.

#### KV Cache effect

No effect: management rows are not part of a model request.

## Known Limitations and Deferred Work

- The PostgreSQL DDL is a hand-maintained sibling of the SQLite schema; a column or constraint change must update both.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
