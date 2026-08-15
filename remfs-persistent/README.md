# @zetaluolang/remfs-persistent

Persistent phone-remote workbench plugin for **DeepSeek Harness** (`dsh web`): browse / preview / edit / download / upload PC files from your phone, and start a new agent session in any folder — over a trusted RPC channel.

- **Host half** registers the `/remfs` RPC channel (trusted-host authority — the same browser-trust fence as `/api`).
- **Client half** is a persistent loader module — it loads on every page automatically, **no per-session "run" needed**.
- **Mobile-first UI**: two-tab workbench (New Session / Files), breadcrumbs, toast feedback, workspace badges, draggable floating ball, auto-collapsed sidebar, bilingual EN/zh.

> Full setup — one-click deploy built on **Tailscale** (auto-installs Node.js + Tailscale, guides the one-time sign-in, enables HTTPS Serve, auto-start on login) — lives in the GitHub repo:
> https://github.com/zetaluolang-cyber/deepseek-harness-phone-remote

## Requirements

- DeepSeek Harness web profile (`dsh web`)
- For phone access: Tailscale on the PC and on the phone, **same account**

## Install (manual, 3 steps)

```bash
# 1. install the package into your web profile
dsh plugin --profile web add @zetaluolang/remfs-persistent

# 2. register the loader row — REQUIRED. `dsh plugin add` only installs the
#    dependency; without this row the plugin never loads.
#    Append to %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml:
#
#    - insert:
#        - id: remfs-persistent
#          name: '@zetaluolang/remfs-persistent'
#          inject: [connection, fs]

# 3. restart dsh web, then refresh the GUI
```

The `inject: [connection, fs]` row is **not optional**: the host half reads these cross-entry services at apply time — without them the `/remfs` channel silently never registers (a bare `ctx.get()` in `apply` resolves too early).

## Pitfalls (we stepped on these so you don't)

| Symptom | Cause / fix |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy — use `npm.cmd` instead, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once |
| Plugin never appears after install | Skipped step 2 (loader row) or didn't restart `dsh web` |
| Workbench button missing on the page | Open a conversation first — the header button lives in the session header; it also appears under Settings |
| Phone gets 403 | Access via the Tailscale HTTPS name / Tailscale IP, and the GUI must run with `--trusted-host` for those hosts (the one-click deploy does this automatically) |
| `npm view` 404s right after a publish | CDN edge cache — wait a minute or query with `Cache-Control: no-cache`; the publish itself succeeded (PUT 200) |

## Security

No login / password / 2FA — the trust boundary is **tailnet membership**. Host-enforced protected paths block system dirs, credential/key files (`.credentials.yaml`, `.ssh`, `id_rsa`, `*.pem`, …) and private data dirs (WeChat/WPS data) regardless of the user allowlist. Full security notes are in the GitHub README.

## License

MIT
