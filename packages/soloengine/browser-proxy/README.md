---
description: "Host-side same-origin browser proxy for the run panel: a catch-all route forwards HTTP and WebSocket traffic, rewrites `Location` and HTML, "
kind: "package-reference"
---

# @soloengine/browser-proxy

English | [中文](README.zh.md)

## Summary

Host-side same-origin browser proxy for the run panel: a catch-all route forwards HTTP and WebSocket traffic, rewrites `Location` and HTML, strips hop-by-hop headers, and blocks SSRF through five checks. The browser tab sees one origin; the proxy is the only network edge.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mounted by `@soloengine/host` on the shared web server; the run panel browser tab uses `/soloengine/proxy` and `/soloengine/proxy-ws`.

## Model Experience

None, as the host proxy relays browser traffic without registering anything model-facing.

#### KV Cache effect

No effect: proxied pages never enter a model request.

## Known Limitations and Deferred Work

- The proxy is an operational surface, not a sandbox; it enforces same-origin and SSRF rules but does not isolate arbitrary page scripts from the browser.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
