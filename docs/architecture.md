# Architecture

`@zetaluolang/remfs-persistent` is a **persistent Cordis loader plugin** for the
DeepSeek Harness **web profile**. It turns the loopback-only Harness GUI into a
secure remote work environment without replacing the UI.

## Layers

```
Phone / remote device (browser)
  │  opens the REAL DeepSeek Harness web UI
  ▼
Transport (WireGuard / LAN)                 — WHO can reach the channel
  ├─ Tailscale (HTTPS via `tailscale serve`)
  ├─ Tailscale IP  (TCP forwarder, 100.x.x.x:3080)
  └─ LAN IP        (walk-on-LAN forwarder, 192.168.x.x:3080)
  ▼
DeepSeek Harness Web (binds 127.0.0.1)
  └─ /remfs Connection RPC channel (authority: trusted-host)
       ├─ browser-trust fence: Host ∈ {loopback, trusted-hosts}, cross-site blocked
       ├─ device authentication: every endpoint except `pair` requires a
       │    per-device credential (SHA-256 hashed at rest)
       └─ filesystem capability layer
            ├─ allowlist (.remfs-roots.json) — the primary file boundary
            ├─ protected-path deny list (system dirs, credentials, private data)
            ├─ path guards (.., UNC) + realpath-based checks (symlink/junction)
            └─ workspace escape hatch (registered workspaces inside protected areas)
```

## Host half (`lib/host.js`)

- Registers the `/remfs` channel on `ctx.connection.rpc.handle(...)` with
  `{ authority: 'trusted-host' }` — the same browser-trust fence as `/api`.
- Declares `inject: ['connection', 'fs']` on the loader row — REQUIRED.
  Cross-entry services must be injected; a bare `ctx.get()` in `apply` resolves
  too early and the channel silently never registers.
- Endpoints (all but `pair` require a device credential):
  - `pair` — consume a one-time pairing code, issue a device credential.
  - `devices` / `revoke` / `revokeAll` — device management.
  - `allowed` / `setAllowed` — read / narrow the allowlist (never widen).
  - `workspaces` / `ensureWorkspace` — list + create harness workspaces.
  - `list` / `read` / `write` — filesystem operations.
- Result envelope: `{ ok: true, value }` / `{ ok: false, error: { code, message, details } }`
  — the client schema-strips unknown fields, so data MUST live in `value`.

## Client half (`lib/client.js`)

- Loaded on every page via the `dsh.client` module table (persistent — no
  per-session run). Module id = package name.
- Workbench UI: New Session / Files tabs, breadcrumbs, preview/edit/upload/
  download, workspace badges, floating ball, bilingual (EN/zh).
- Device auth: credential stored in `localStorage`; an unpaired device sees the
  pairing screen; `auth-invalid` responses drop the credential and re-show it.
- All RPC payloads carry `{ deviceId, credential }` (except `pair`).

## Security module (`lib/security.js`)

Pure Node (no Cordis) so it is unit-tested by `node --test`:

- **Pairing**: 128-bit one-time code, 10-minute TTL, single use, SHA-256 at rest;
  plaintext shown PC-side in `~/.dsh/remfs-pairing.txt` + the harness log.
- **Devices**: 256-bit credentials, stored only as SHA-256 hashes in
  `~/.dsh/remfs-security.json`; list/revoke/revoke-all.
- **Paths**: `hasTraversal` (rejects `..` and UNC), `isWithin` (case-insensitive),
  `segmentsDenied`/`deniedPath` (protected paths + workspace escape hatch),
  `canSetRoots` (allowlist can only be narrowed remotely).

## Filesystem model

- **Allowlist is the primary boundary.** Default: the workspace root. The phone
  can only *remove* or *narrow* roots over the wire; adding new locations means
  editing `.remfs-roots.json` on the PC (local config = PC confirmation).
- **Protected paths** are a second, non-negotiable layer: system dirs, AppData,
  credential/key files (`.credentials.yaml`, `.ssh`, `.aws`, `.gnupg`,
  `.config/gcloud`, `.env`, `id_rsa`, `*.pem/.key/.pfx`, ...) and private data
  dirs (WeChat/WPS) are denied regardless of the allowlist.
- **Symlink/junction escape**: `fs.processPath()` returns the realpath, so a
  link inside an allowed root that points outside fails the allowlist check.

## Trust model (three independent layers)

1. **Transport** — Tailscale membership / LAN reachability. Not authentication.
2. **Application** — device pairing + credentials. The actual auth boundary.
3. **Capability** — allowlist + protected paths. The file-permission boundary.

`trusted-host` is a transport fence only; it never substitutes for 2 or 3.
