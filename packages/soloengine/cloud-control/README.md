---
description: "Cloud Agent control plane: node registry and health sampling, p2c session placement, session leases, and epoch write fencing. It is the shar"
kind: "package-reference"
---

# @soloengine/cloud-control

English | [中文](README.zh.md)

## Summary

Cloud Agent control plane: node registry and health sampling, p2c session placement, session leases, and epoch write fencing. It is the shared authority for routing a session to one node and for stopping an old writer.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The gateway and cloud node runtime call it; a lease decision is followed by the node's session persistence write fence.

With both `SOLOENGINE_KEYS_DIR` and `SOLOENGINE_DATABASE_URL` set, the gateway also enforces session ownership: it verifies the account access token with the deployment master key and reads `sessions.user_id` from the shared business database. Setting only one of the two fails startup instead of running half-guarded.

With `SOLOENGINE_QUOTA_MAX_ACTIVE` set, the per-user concurrent-session limit is enforced at both placement and lease acquisition; a node that receives a run directly cannot bypass the shared quota.

## Model Experience

None, as the control plane manages nodes, placement, leases, and quotas without registering anything model-facing.

#### KV Cache effect

No effect: placement and lease state never enter a model request.

## Known Limitations and Deferred Work

- The control plane requires a shared repository (PostgreSQL) for multi-node deployments; the in-memory variant is single-node only.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
