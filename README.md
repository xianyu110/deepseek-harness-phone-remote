# DeepSeek Harness Phone Remote

Control your **DeepSeek Harness Web GUI from your phone** over **Tailscale**, with a built-in **persistent file / workspace plugin**: browse, preview, edit, download and upload PC files from your phone, and start a new agent session in any folder — no system directory-picker required on mobile.

> One-click deploy: `一键部署.cmd` → detects your Tailscale identity → generates launch scripts → enables Tailscale Serve (HTTPS) → installs the persistent plugin → prints the phone URL.

**English** | [中文](README.zh.md)

## Why

- The Harness Web GUI binds `127.0.0.1` only — phones can't reach it directly.
- The GUI's directory picker is a privileged method, loopback-only — phones can't pick folders.
- Sessions normally die with the page — this plugin is a **persistent loader entry**, so the workbench loads on every page automatically, no per-session "run" needed.

## Features

- **One-click deploy** — `install.ps1` auto-detects Tailscale IP / MagicDNS name, writes `start_harness.ps1`, enables `tailscale serve` (HTTPS), installs the persistent plugin.
- **Auto-start on login** — harness + forwarder + keep-awake start automatically.
- **Phone file workbench**:
  - *Session tab*: list existing workspaces and open one, or "start a session here" in any folder;
  - *Files tab*: browse, breadcrumbs, text preview / edit / download, upload, image preview;
  - Manageable allowed-roots allowlist (default `Documents`);
  - Mobile-adapted: collapsible sidebar button, draggable floating ball, toast feedback.
- **Persistent plugin** — `remfs-persistent` is a loader entry: host RPC channel `/remfs` registers at harness start; the client module is served on every page. No re-running after refresh.
- **Bilingual UI** — English / 中文 (auto-detects browser language, toggle in the workbench header, remembered).

## Architecture

```
Phone (any Android / iOS)
  │  Tailscale app (same tailnet)
  ├─ https://<pc-name>.<tailnet>.ts.net      ← Tailscale Serve (HTTPS, recommended)
  └─ http://<TailscaleIP>:3080              ← fallback: TCP forwarder tailscale_forward.js
        │
        ▼
PC (listens on loopback + tailnet only, never 0.0.0.0)
  ├─ 127.0.0.1:3080        dsh web (GUI, loopback only)
  └─ 100.x.y.z:3080        tailscale_forward.js → forwards to 127.0.0.1:3080
```

- GUI binds `127.0.0.1`; the LAN / public internet cannot reach it.
- Phone traffic travels through the **Tailscale WireGuard tunnel**; HTTPS is served with the tailnet certificate.
- The `/api` and plugin RPC go through the browser-trust fence: only loopback and `--trusted-host` authorities pass.

## Tested devices

| Device | Screen | Status |
|---|---|---|
| OPPO Find X8 Ultra | ~1440×3168 | ✅ primary test device |
| More devices / resolutions | — | 🚧 planned |

Layout is fluid (CSS grid / clamp-friendly), but we are validating other resolutions — feel free to open an issue with your device model + screen size and any layout problem you see.

## Requirements

| Item | Notes |
|---|---|
| Windows + Node.js ≥ 18 | runs `dsh web` |
| Tailscale | PC and phone on the same account — [tailscale.com/download](https://tailscale.com/download) |
| HTTPS Certificates | tailnet admin: https://login.tailscale.com/admin/dns → Enable HTTPS Certificates |
| DeepSeek Harness | run `npx dsh web` once (to populate the npx cache) |

## Quick start

1. Double-click **`一键部署.cmd`** on the PC (right-click → Run as administrator if Tailscale IP detection or Serve setup needs it);
2. The script: checks the environment → reads Tailscale identity → writes `%USERPROFILE%\.dsh\launcher\start_harness.ps1` → enables HTTPS Serve → installs the persistent plugin into `%USERPROFILE%\.dsh\profiles\web` → prints the phone URL;
3. Phone: open the Tailscale app (**Connected**) → open the printed `https://...ts.net`;
4. It auto-starts on login afterwards. Manual control:
   - start: `%USERPROFILE%\.dsh\launcher\start_harness.ps1`
   - restart: `%USERPROFILE%\.dsh\launcher\restart_harness_once.ps1`
   - stop: `%USERPROFILE%\.dsh\launcher\stop_harness.ps1` (also stops keep-awake so the PC can sleep)

### What install.ps1 does

- Detects the Tailscale IP (`tailscale ip -4`) and MagicDNS name, fills the template placeholders into `start_harness.ps1`;
- Auto-locates the `dsh` entry in the npx cache (the `_npx` hash dir changes between installs — never hardcoded);
- `tailscale serve --bg http://127.0.0.1:3080` → HTTPS;
- Installs `remfs-persistent` (host RPC channel + browser module) into the web profile:
  - source → `profiles\web\vendor\remfs-persistent\`, linked/copied to `node_modules\@zeta\remfs-persistent`;
  - idempotently writes the loader entry into `profiles\web\cordis.patch.yml` (with `inject: [connection, fs]`);
- Scripts are installed to `%USERPROFILE%\.dsh\launcher\` (**not inside Documents** — see Security).

## ⚠️ Security notes (please read)

- **No login / password / 2FA.** The trust boundary of the GUI and the file plugin is **"any device that can reach your tailnet"**. Any tailnet member can read/write your files and drive the agent without authentication. **Do not share your tailnet, do not add unknown devices, and remove a lost phone from the tailnet admin console immediately.**
- **The allowed-roots allowlist is a UI guard, not a security boundary.** It can be expanded to any path from the workbench.
- **Host-enforced protected paths (cannot be bypassed):** system dirs (`Windows`, `System Volume Information`, `$Recycle.Bin`, `Program Files`, `ProgramData`, …), credential/key files (`.credentials.yaml`, `.ssh`, `id_rsa`, `*.pem/.key/.pfx`, `ntuser.dat`, system hive files on the C: root), and private data dirs (`xwechat_files`, `KingsoftData`, `WPSCloudSvr`, `Tencent Files`). These stay blocked even if the allowlist is expanded to `C:\`. Registered workspaces located inside a protected area remain reachable.
- **DeepSeek API key** is stored in plaintext at `%USERPROFILE%\.dsh\.credentials.yaml` — protected by the deny list; never put that file anywhere that gets uploaded.
- New sessions default to restricted permissions (`workspace-write` + confirmation for writes); keep it that way.
- The plain-HTTP fallback (`http://<IP>:3080`) is tailnet-only (WireGuard already encrypts); prefer HTTPS.

## Repository layout

```
dsh-remote/
├─ 一键部署.cmd              one-click deploy entry
├─ install.ps1               deploy script (detect / generate / install)
├─ start_harness.template.ps1  launcher template (placeholders filled by install.ps1)
├─ tailscale_forward.js      TCP forwarder (tailnet IP → 127.0.0.1:3080)
├─ restart_harness.ps1       restart (kill :3080 listeners, relaunch)
├─ stop_harness.ps1          stop harness + forwarder + keep-awake
├─ keep_awake.ps1            keep-awake (ES_SYSTEM_REQUIRED loop)
└─ remfs-persistent/         the persistent plugin (host RPC + browser workbench)
   ├─ package.json           dsh.client manifest + exports
   ├─ lib/host.js            /remfs RPC channel (trust fence + allowlist + protected paths)
   └─ lib/client.js          phone workbench UI (session/files tabs, toast, floating ball)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone can't open the page | Phone Tailscale **Connected**? PC harness running (`start_harness.ps1`, :3080 listening)? |
| 403 on the phone | Host header not in the trust list — HTTPS: use `<pc-name>.<tailnet>.ts.net`; HTTP: the PC's Tailscale IP |
| HTTPS certificate error | Enable HTTPS Certificates in the tailnet admin, then re-run install.ps1 |
| Some folders not browsable on phone | Not in the allowlist (add via "manage allowed dirs"); system/credential/private dirs are hard-blocked |
| Plugin missing after refresh | Refresh again — the persistent module loads with every page (no "run" needed) |
| Launch fails after a dsh upgrade | The npx cache path changed — re-run `一键部署.cmd` to re-detect |

## Roadmap

- [x] Tailscale HTTPS + forwarder access
- [x] Persistent plugin (no per-session run)
- [x] Bilingual UI (EN / 中文)
- [x] Host-enforced protected-path deny list
- [ ] More device resolutions validation
- [ ] Tailscale ACL hardening guide
- [ ] English README polish / screenshots

## License

MIT
