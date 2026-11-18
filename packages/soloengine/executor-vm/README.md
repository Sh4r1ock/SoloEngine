---
description: "Full-VM execution backend for cloud sessions: one QEMU VM per session, a qcow2 overlay, the workspace shared at /workspace, SSH command routing, and QMP pause/resume/destroy."
kind: "package-reference"
---

# @soloengine/executor-vm

English | [中文](README.zh.md)

## Summary

Full-VM execution backend for cloud sessions: one QEMU VM per session, a qcow2 overlay on a read-only base image, the host workspace shared at `/workspace`, commands over SSH, and QMP pause/resume/destroy. It replaces host subprocess execution when the `full-vm` executor form is selected.

## Table of Contents

- [Summary](#summary)
- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Selected by `SOLOENGINE_EXECUTOR=full-vm` together with the cloud database form; it requires a bootable qcow2 base image (`SOLOENGINE_VM_IMAGE`), a per-session state directory (`SOLOENGINE_VM_STATE_DIR`), a private key (`SOLOENGINE_VM_SSH_KEY`), and QEMU on the node. The base image must run sshd with the matching public key and mount the virtio-9p `workspace` tag at `/workspace`.

## Model Experience

None, as the full-VM executor runs shell commands while consumer tools own model rendering.

#### KV Cache effect

No effect: VM lifecycle is not model input.

## Known Limitations and Deferred Work

- Requires QEMU, a bootable base image, and a platform key; the local and container forms never load it.
- Guest egress is denied by default (`restrict=on`): the guest reaches only the explicitly forwarded SSH port.
- `browser-use` and `computer-use` providers are not shipped (D16); the VM exposes a VNC display surface for deployments that install them in the guest.

### Dev Note

Update this file together with any behavior, configuration, or model-visible change; the package README is the contract readers and agents rely on.
