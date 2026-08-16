# Changelog

All notable changes to `@zetaluolang/remfs-persistent` and the deploy package.

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
