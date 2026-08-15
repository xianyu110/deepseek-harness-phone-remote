# Project Positioning

## Tagline

> **Secure Remote Workspace & Filesystem Bridge for DeepSeek Harness.**

Short hero line for the README first screen:

> **Your DeepSeek Harness, anywhere — the native web UI, over a secure network,
> with authenticated RPC and a capability-bounded filesystem.**

## What this project is

DeepSeek Harness deliberately binds `127.0.0.1` and treats "who is allowed to
reach the GUI" as a deployment decision. This project keeps that decision
conservative and adds a *remote work environment* on top:

- **Native UI, no replacement frontend.** We do not reimplement the chat UI.
  The phone opens the real DeepSeek Harness web UI over Tailscale. A plugin
  bridge fills the two gaps a browser cannot close remotely: starting/resuming
  an agent in an arbitrary folder, and reading/writing files on the host.
- **Secure network first.** Tailscale (WireGuard) + HTTPS via `tailscale serve`.
  The GUI never binds beyond loopback + a local forwarder.
- **Application-level authentication (being built).** `trusted-host` and the
  tailnet are *transport/network* trusts, not *user* authentication. Device
  pairing (one-time token) → per-device credentials → revocation is the app
  boundary.
- **Filesystem capability model.** The allowlist is the primary file-permission
  boundary; the phone cannot widen it over the wire; protected paths and
  path-escape guards are enforced host-side and tested.

## What this project is NOT

- Not a mobile UI/skin replacement (see `dsh-web-ui` — different direction).
- Not exposing the harness to the public internet.
- Not a Tailscale alternative — Tailscale is the transport we integrate with.
