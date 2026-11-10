---
description: "SoloEngine design tokens for spacing, radius, and z-index, shared by the run panel and product pages. Radius delegates to the native `--dsw-"
kind: "package-reference"
---

# @soloengine/ui-theme

English | [中文](README.zh.md)

## Summary

SoloEngine design tokens for spacing, radius, and z-index, shared by the run panel and product pages. Radius delegates to the native `--dsw-radius-*` scale so there is no second geometry.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Injected by the run panel and imported by the product pages; colors and typography stay with the native theme package.

The host half injects one body script that applies the browser preference (`localStorage['soloengine.preferences']`: theme preference and content font size) to the run-panel document, so the management plane and the run panel share one browser-scoped preference without writing a server settings namespace. The browser half re-resolves the three contrast-correction tokens for that preference's scheme, because the native presenter writes them inline from the server theme. Content font size is clamped to the product range 12–20 before it reaches the document, so a tampered or stale stored value cannot resize the panel beyond its contract.

## Model Experience

None, as browser-side design tokens register nothing model-facing.

#### KV Cache effect

No effect: styling never changes a request.

## Known Limitations and Deferred Work

- Only tokens the native theme does not abstract are defined here; colors and typography stay with the native theme package.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
