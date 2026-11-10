---
description: "Per-session egress proxy assets: HTTP CONNECT, SOCKS5, and DNS scripts that run inside the session's network namespace, plus the asset locat"
kind: "package-reference"
---

# @soloengine/egress-proxy

English | [中文](README.zh.md)

## Summary

Per-session egress proxy assets: HTTP CONNECT, SOCKS5, and DNS scripts that run inside the session's network namespace, plus the asset locator the container executor mounts. It confines outbound traffic to the session's policy.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The container executor mounts these assets into the session network namespace; the local executor does not use them.

## Model Experience

None, as the egress proxy confines network traffic without registering anything model-facing.

#### KV Cache effect

No effect: proxied bytes never enter a model request.

## Known Limitations and Deferred Work

- The scripts assume a Linux network namespace and are not exercised by the local single-machine executor.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
