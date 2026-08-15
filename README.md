# DeepSeek Harness Phone Remote

Control your **DeepSeek Harness Web GUI from your phone** over **Tailscale**, with a built-in **persistent file / workspace plugin**: browse, preview, edit, download and upload PC files from your phone, and start a new agent session in any folder — no system directory-picker required on mobile.

> One-click deploy, built on **Tailscale**: `一键部署.cmd` → auto-installs missing Node.js / Tailscale (winget) → walks you through the one-time Tailscale sign-in → detects your identity → generates launch scripts → enables Tailscale Serve (HTTPS) → installs the persistent plugin → prints the phone URL. Registering your own Tailscale account is the **only** manual step.

**English** | [中文](README.zh.md)

## Why

- The Harness Web GUI binds `127.0.0.1` only — phones can't reach it directly.
- The GUI's directory picker is a privileged method, loopback-only — phones can't pick folders.
- Sessions normally die with the page — this plugin is a **persistent loader entry**, so the workbench loads on every page automatically, no per-session "run" needed.

## Features

- **One-click deploy (auto-installs prerequisites)** — `install.ps1` installs missing **Node.js** and **Tailscale** via winget (one UAC click), guides the one-time Tailscale sign-in, then auto-detects the Tailscale IP / MagicDNS name, writes `start_harness.ps1`, enables `tailscale serve` (HTTPS) and installs the persistent plugin.
- **Auto-start on login** — harness + forwarder + keep-awake start automatically.
- **Persistent plugin** — `remfs-persistent` is a loader entry: host RPC channel `/remfs` registers at harness start; the client module is served on every page. No re-running after refresh.
- **Bilingual UI** — English / 中文 (auto-detects browser language, toggle in the workbench header, remembered).

### Mobile-first UI (optimized for phone screens)

- **Auto-collapsed sidebar** — on small screens the harness sidebar/details panels collapse and the conversation gets full width; a floating **☰** ball re-expands the sidebar (tap again to collapse). The ball is **draggable** anywhere on screen for one-handed use.
- **Two-tab workbench** — `＋ New Session` / `📁 Files` in one panel, opened from the session header or Settings.
- **Breadcrumb navigation** — tap any path segment to jump; plus a direct absolute-path input with a Go button (the phone cannot open the OS directory picker, so this is the way in).
- **Toast feedback** — every action (save / upload / session start / errors) confirms with a top toast.
- **★ workspace badges** — folders that are registered workspaces are flagged in file lists, and the header shows a badge when the current folder is a workspace.
- **Files dimmed in the Session tab** — tapping a file auto-switches to the Files tab and previews it, so the Session tab stays focused on folders.
- **Hide system dirs** — system-protected dirs are hidden by default with a toggle in the ⋯ menu.
- **Responsive CSS** — side panels collapse at ≤700px; the workbench panel fits narrow screens.

### Read & manage PC local files from the phone

- **Browse** allowlisted roots (default `Documents`) with breadcrumbs.
- **Preview** text and images inline; **download** binary files (5 MB cap).
- **Edit** text files and save back to the PC.
- **Upload** text files from the phone into any allowed folder.
- **Protected paths** — system dirs, credential/key files (`.credentials.yaml`, `.ssh`, `id_rsa`, `*.pem`, …) and private data dirs (WeChat/WPS data) are hard-blocked host-side regardless of the allowlist (see Security).

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
| Windows 10/11 | 64-bit; winget available (built-in on Win11) |
| Node.js ≥ 18 | **auto-installed** by the one-click deploy if missing |
| Tailscale | **auto-installed** by the one-click deploy; you only need your own (free) Tailscale account — [tailscale.com](https://tailscale.com) |
| HTTPS Certificates | tailnet admin: https://login.tailscale.com/admin/dns → Enable HTTPS Certificates |
| DeepSeek Harness | run `npx dsh web` once (to populate the npx cache) |

## Install from npm

The plugin is published on npm as **[@zetaluolang/remfs-persistent](https://www.npmjs.com/package/@zetaluolang/remfs-persistent)**. If you already have a `dsh web` profile:

```bash
# 1. install the package into the web profile
dsh plugin --profile web add @zetaluolang/remfs-persistent

# 2. register it as a loader row (append to %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml)
# - insert:
#     - id: remfs-persistent
#       name: '@zetaluolang/remfs-persistent'
#       inject: [connection, fs]

# 3. restart dsh web, then open the GUI — the workbench appears in the session header
```

Or use the one-click deploy below, which does all of this automatically.

## Quick start

1. Double-click **`一键部署.cmd`** on the PC (right-click → Run as administrator; you will need it for the auto-installs);
2. The script auto-installs **Node.js** and **Tailscale** if missing (click **Yes** on any UAC prompt) — this needs network, give it a minute;
3. If Tailscale is not signed in yet, the script opens the login page and **waits for you**: log in with your own (free) Tailscale account, and also install the Tailscale app on your **phone** with the same account. Press ENTER when done;
4. The script then writes `%USERPROFILE%\.dsh\launcher\start_harness.ps1`, enables HTTPS Serve, installs the persistent plugin into `%USERPROFILE%\.dsh\profiles\web`, and prints the phone URL;
5. Phone: open the Tailscale app (**Connected**) → open the printed `https://...ts.net`;
6. It auto-starts on login afterwards. Manual control:
   - start: `%USERPROFILE%\.dsh\launcher\start_harness.ps1`
   - restart: `%USERPROFILE%\.dsh\launcher\restart_harness_once.ps1`
   - stop: `%USERPROFILE%\.dsh\launcher\stop_harness.ps1` (also stops keep-awake so the PC can sleep)

### What install.ps1 does

- Detects the Tailscale IP (`tailscale ip -4`) and MagicDNS name, fills the template placeholders into `start_harness.ps1`;
- Auto-locates the `dsh` entry in the npx cache (the `_npx` hash dir changes between installs — never hardcoded);
- `tailscale serve --bg http://127.0.0.1:3080` → HTTPS;
- Installs `remfs-persistent` (host RPC channel + browser module) into the web profile:
  - source → `profiles\web\vendor\remfs-persistent\`, linked/copied to `node_modules\@zetaluolang\remfs-persistent`;
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
| Plugin never appears after `dsh plugin add` | You must also append the loader row to `cordis.patch.yml` (`dsh plugin add` only installs the dependency) and restart `dsh web` |
| Workbench button missing | Open a conversation first — the header button lives in the session header; it also appears under Settings |
| `npm.ps1` blocked by execution policy | Use `npm.cmd` instead, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `npm view` 404s right after a publish | CDN edge cache — wait a minute or query with `Cache-Control: no-cache`; the publish itself succeeded (PUT 200) |
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
