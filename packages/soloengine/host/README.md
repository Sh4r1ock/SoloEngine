---
description: "SoloEngine's host plugin: mounts the framework REST surface into the native web server, compiles and runs canvases, writes session/event attribution, and wires file changes, previews, MCP, permissions, and cloud runtime."
kind: "package-bundle"
---

# @soloengine/host

English | [中文](README.zh.md)

## Summary

SoloEngine's host plugin. It mounts the framework's Express REST surface into the native `ctx.webServer` on the single product port, compiles a canvas at run time, assembles one harness instance per agenticflow, and creates the main agent. It also writes session and event attribution directly, mounts file-change capture and revert, product settings, preview records, MCP supervision, permission presets, the run-panel deep link, and the optional container or cloud runtimes. The native profile plugin manager is projected into the framework's management REST surface, so instance plugin management stays in the management layer and only `/run/:agenticFlowId` reaches the harness shell.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it in the product profile (the launcher's `cordis.patch.yml` already does). The host is the only seam between the management framework and the harness: every run request is translated into native agent calls, and every model-visible contribution it adds — a node persona system prompt or a delegation tool — is registered on the agent scope, never globally. Configuration is validated at startup; missing services and unknown run modes fail loudly instead of degrading.

## Model Experience

### Node persona system prompt

#### What the model sees

When a compiled canvas node declares a persona, the host writes it verbatim as a system-prompt section named `soloengine:node-persona` at order 1. The rest of the prompt belongs to the composed preset.

##### Node persona section

```markdown
<the canvas node persona text, inserted verbatim at order 1>
```

#### Token effect

The section adds the persona text to every request of that node; its length equals the canvas-authored text.

#### KV Cache effect

The section is stable across turns for a given canvas node, so it preserves the request prefix; editing the persona changes the prefix and invalidates the cache from that point.

### Delegation tools

#### What the model sees

Each delegation edge registers one tool named by the canvas edge (`edge.toolName`) with a description that names the child agent and requires a self-contained task.

##### Delegation tool description

```markdown
Delegate a self-contained task to the "<child name>" agent (canvas node <id>) and return its final answer. The child works in its own session with its own model, prompt and tools; it does not see this conversation, so state everything it needs in the task text.
```

#### Token effect

One tool schema plus its description per outgoing edge; the task argument and child output add per-call tokens.

#### KV Cache effect

Tool schemas are part of the request prefix; adding or removing an edge changes the prefix and invalidates the cache for that node.

## Known Limitations and Deferred Work

- The host is a single large coordination module covering the REST mount, run driver, attribution, previews, MCP, permissions, cloud, and page routing; splitting it by concern is deferred because each surface currently shares the same startup wiring.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
