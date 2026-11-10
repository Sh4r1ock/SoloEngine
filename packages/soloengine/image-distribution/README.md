---
description: "Image and workspace distribution layer: a local image cache, a standard-OCI layer cache with on-demand fetching and capacity eviction, content-addressed workspace objects with an object-store authority, and environment export with builder/runtime separation"
kind: "package-reference"
---

# @soloengine/image-distribution

English | [中文](README.zh.md)

## Summary

Image and workspace distribution layer: a three-tier local image cache, a standard-OCI-manifest layer cache (on-demand, batch, and full fetching with capacity eviction and hit-rate telemetry), content-addressed workspace objects with an object-store authority plus local copies (filesystem or S3-compatible), and environment export that separates builder and runtime accounts and strips build residue. It moves bytes for cloud sessions and never exposes them to a model.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The cloud node runtime uses it to materialize a session workspace and to publish the final state back to object storage. The layer cache consumes a standard OCI image manifest and fetches only missing layers, so a layer update pulls just the changed layers and repeated sessions share the node cache. `S3ObjectStore` is the cloud authority for AWS S3, MinIO, and S3-compatible endpoints (SigV4, path-style); `FilesystemObjectStore` covers a shared volume. Environment export turns a session checkpoint's workspace into a reusable plain tree plus a record consumed by `verifyEnvironmentExport`.

## Model Experience

None, as image and workspace distribution move bytes without registering anything model-facing.

#### KV Cache effect

No effect: distribution traffic is not part of a model request.

## Known Limitations and Deferred Work

- Object-store credentials and reachability are deployment inputs; a missing store fails the cloud form rather than falling back to local-only data. The S3 adapter signs with AWS Signature V4 and is verified against a signature-enforcing gateway; bucket creation is a deployment bootstrap. Alibaba OSS native API is not covered; use its S3-compatible endpoint.
- The registry adapter supports HTTP Basic credentials and platform image manifests; an image index (multi-architecture) must be resolved before preparing layers.
- Docker sessions still pull whole images through Docker's own image store. Kernel-level lazy layer mounting requires an external snapshotter (SOCI/eStargz/Nydus) registered in the container runtime, which the current Docker daemon does not provide.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
