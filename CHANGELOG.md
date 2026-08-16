# Changelog

All notable changes to `@zetaluolang/remfs-persistent` and the deploy package.

## [1.1.2] — 2026-08 (regression-fix pass, CI green)

- **Revoke protocol** — client now sends `targetDeviceId`; added a true
  client-source → RPC payload → dispatcher contract test.
- **No maintainer paths** — launcher/template derive profile paths from
  `$env:USERPROFILE`; CI scans for `C:\Users\<name>` literals.
- **stop_harness** — ownership-verified (harness-common); a foreign :3080
  listener survives.
- **start_harness** — missing/broken `harness-common.ps1` is fatal (no
  fail-open fallback, no forwarder without ownership checks).
- **restart_harness** — derives the owned forwarder IP from the launcher
  (was an empty list); restart-kill regression test added.
- **CI** — `node --check` on every lib file (incl. dispatch.js), all
  `*.test.js` run via glob (directory form was broken), path-scan step.
- **Store corruption** — `loadStore` distinguishes ENOENT (fresh) from
  corruption/permission errors; corrupt stores are backed up
  (`<file>.corrupt-<ts>`), kept in place, and fail closed with
  `store-corrupt` instead of silently resetting device/pairing state.
- **refresh_pairing.ps1** — implemented and deployed (pairing code rotation
  without a harness restart); instruction in dispatch errors is now real.
- **Docs** — README/SECURITY clarify: Harness stays loopback-only (LAN
  exposure only via opt-in forwarders); pairing protects `/remfs`, not the
  native `/api`.

## [1.1.1] — 2026-08 (bug-fix pass)

### Fixes
- **Deploy ships the whole `lib/`** — install.ps1 now copies the `lib`
  directory recursively (security.js/dispatch.js were missing from the old
  per-file list); added a deployment smoke test.
- **Revoke protocol** — host reads `targetDeviceId` (the caller's `deviceId` is
  the auth identity); added an A-revokes-B integration test.
- **Store concurrency** — all security-store operations are serialized per file
  and persisted via atomic tmp+rename; concurrent verify/revoke can no longer
  resurrect a revoked credential; pairing is strictly single-use under the lock.
- **Pairing lifecycle** — consumed codes are marked `CONSUMED` in
  `remfs-pairing.txt`; a fresh code is regenerated after use/expiry; distinct
  `pairing-used` / `pairing-expired` errors.
- **Allowlist fail-closed** — a corrupt/unreadable `.remfs-roots.json` now
  denies access instead of silently expanding to the workspace root.
- **Walk-on-LAN is opt-in** — off by default (`%USERPROFILE%\.dsh\lan-on` or
  `DSH_REMFS_LAN=1`); docs updated.
- **Launcher process ownership** — "3080 listening" is no longer treated as
  "our harness running": every check/kill matches the owning process's command
  line (`harness-common.ps1`); foreign 3080 services are never exposed or
  killed; added a dummy-:3080 regression test.
- **DNSName honesty** — install.ps1 re-reads `tailscale status --json` after
  sign-in and never fabricates `COMPUTERNAME.tailnet.ts.net` as a trusted host.
- **Node version validated** — the installer checks `node --version` against
  `^22.19.0 || >=24.0.0` (upstream requirement), not just the executable's
  existence.
- **Breadcrumb closure** — each crumb captures its own prefix path.

### Tests
- `test/dispatch.test.js` (protocol/integration, temp-dir fs adapter),
  `test/install-smoke.ps1` (deployment), `test/launcher-ownership.ps1`
  (dummy :3080). CI now runs a Windows job for the PowerShell tests.

## [1.1.0] — 2026-08 (security release)

### Security
- **Device authentication for `/remfs`** — every endpoint except `pair` now
  requires a per-device credential. `trusted-host` remains the transport fence;
  application authentication is now device credentials.
- **Pairing flow** — one-time 128-bit pairing code (10-minute TTL, single use),
  SHA-256 hashed at rest; long-term device credentials are 256-bit and stored
  only as hashes.
- **Device management** — list / revoke / revoke all devices.
- **Capability-bounded allowlist** — remote clients can only *narrow* the
  approved roots; widening (`C:\`, new drives) requires editing
  `.remfs-roots.json` on the PC.
- **Path hardening** — `..` and UNC paths rejected before resolution;
  symlink/junction escapes already fail the realpath-based allowlist check;
  protected paths extended (`.env`, `.aws`, `.gnupg`, `.config/gcloud`, AppData).

### Features
- **Walk-on-LAN** — a second forwarder binds the PC's LAN IP, the harness trusts
  it, and the launcher prints the LAN URL; the phone on the same Wi-Fi can skip
  Tailscale. `/remfs` stays device-authenticated.
- Bilingual UI; pairing and device-management screens in the workbench.

### Tests
- `test/security.test.js` — path traversal, absolute-path bypass, credential
  protection, allowlist capability, pairing single-use/expiry, auth/revocation
  (12 cases, `node --test`).

### Docs / CI
- Architecture audit, positioning, threat model, CONTRIBUTING, SECURITY.
- GitHub Actions CI (syntax, security tests, package smoke).

## [1.0.1] — 2026-08
- npm package README with install steps and a pitfalls table.
- Renamed scope to `@zetaluolang/remfs-persistent`.

## [1.0.0] — 2026-08
- Initial release: persistent loader plugin, `/remfs` RPC channel, phone
  workbench (session + files), Tailscale one-click deploy, protected paths.
