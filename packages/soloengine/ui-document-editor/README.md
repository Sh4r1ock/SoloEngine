---
description: "Browser document panel: adds text editing and save-back to the native document-preview registry, while Office and spreadsheet files stay wit"
kind: "package-reference"
---

# @soloengine/ui-document-editor

English | [中文](README.zh.md)

## Summary

Browser document panel: adds text editing and save-back to the native document-preview registry, while Office and spreadsheet files stay with the native renderers. It never introduces a second parser.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Registers a text provider into the native `documentPreviews` registry; saves go through the workspace file API.

## Model Experience

None, as browser-side document editing registers nothing model-facing; file contents reach a model only through host tools.

#### KV Cache effect

No effect: editing does not change request content.

## Known Limitations and Deferred Work

- Editing is limited to text files the workspace file API can write; binary or Office documents remain read-only.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
