---
description: "Model-route adapter: every enabled management model configuration becomes one `soloengine-<id>` route, with the decrypted key and base URL r"
kind: "package-reference"
---

# @soloengine/llm-db-adapter

English | [中文](README.zh.md)

## Summary

Model-route adapter: every enabled management model configuration becomes one `soloengine-<id>` route, with the decrypted key and base URL resolved at execution time. A seconds-level poll discovers changes and replaces the route set.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mounted in the product profile; the canvas compiler and run driver reference routes by id, and the adapter keeps them in sync with the management table.

## Model Experience

Indirectly, through the model route it registers, while request assembly and the selected model own the model-visible request.

#### KV Cache effect

No effect: the adapter selects a provider and credentials, not prompt content.

## Known Limitations and Deferred Work

- Route availability follows management configuration; a disabled or deleted row removes the route and the next request fails loudly.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
