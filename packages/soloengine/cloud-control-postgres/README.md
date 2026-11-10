---
description: "PostgreSQL repository for the cloud control plane. It implements the control-plane `ControlRepository` over a shared ownership database so m"
kind: "package-reference"
---

# @soloengine/cloud-control-postgres

English | [中文](README.zh.md)

## Summary

PostgreSQL repository for the cloud control plane. It implements the control-plane `ControlRepository` over a shared ownership database so multiple gateway replicas see the same nodes, leases, and placement decisions.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Composed by the cloud control plane; the framework dynamically resolves it when the cloud form uses PostgreSQL.

## Model Experience

None, as the control-plane store persists placement state without registering anything model-facing.

#### KV Cache effect

No effect: stored placement state is not model input.

## Known Limitations and Deferred Work

- Schema changes must be applied before starting a control plane that expects the new columns.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
