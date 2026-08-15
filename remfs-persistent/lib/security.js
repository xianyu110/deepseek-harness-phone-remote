// security.js — application-level authentication and filesystem capability
// helpers for the /remfs channel. Pure Node (no Cordis), so the same code is
// unit-tested by `node --test` and used by the host half.
//
// Trust model:
//   transport (Tailscale / trusted-host)  = WHO can reach the channel
//   pairing + device credentials          = WHO is allowed to USE it
//   allowlist + protected paths           = WHAT they may touch
//
// Only SHA-256 hashes of credentials are persisted. The pairing code is
// one-time and short-lived.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------- constants

export const PAIRING_TTL_MS = 10 * 60 * 1000 // pairing code validity
export const CREDENTIAL_BYTES = 32 // long-term device credential (256-bit)
export const CODE_GROUPS = 8 // display groups for the pairing code
export const CODE_GROUP_CHARS = 4 // hex chars per group (128-bit typable code)

// Protected path segments (any position) and protected file name patterns.
export const DENY_SEGMENTS = new Set([
  'system volume information', '$recycle.bin', 'recovery', 'config.msi', '$sysreset',
  'windows', 'perflogs', 'msocache', 'windows.old', '$winreagent',
  'program files', 'program files (x86)', 'programdata',
  'appdata', 'application data',
  'xwechat_files', 'kingsoftdata', 'wpscloudsvr', 'tencent files',
])
export const DENY_FILE = /(^|[/\\])\.ssh([/\\]|$)|(^|[/\\])\.git([/\\]|$)|(^|[/\\])\.aws([/\\]|$)|(^|[/\\])\.gnupg([/\\]|$)|(^|[/\\])\.config[/\\]gcloud([/\\]|$)|(^|[/\\])\.env(\.[a-z0-9_-]+)?$|(^|[/\\])id_(rsa|ed25519|dsa|ecdsa)(\.pub)?$|\.(pem|key|pfx|p12)$|(^|[/\\])\.credentials\.ya?ml$|(^|[/\\])ntuser\.dat$|^[A-Za-z]:[/\\](sam|system|security)(\.|$)/i

export const ERR = {
  AUTH_REQUIRED: 'auth-required',
  AUTH_INVALID: 'auth-invalid',
  PAIRING_INVALID: 'pairing-invalid',
  PAIRING_EXPIRED: 'pairing-expired',
  PAIRING_USED: 'pairing-used',
  DEVICE_NOT_FOUND: 'device-not-found',
  DEVICE_REVOKED: 'device-revoked',
  ROOT_OUTSIDE: 'root-outside-approved',
  PATH_TRAVERSAL: 'path-traversal',
  PATH_PROTECTED: 'path-protected',
  PATH_OUTSIDE: 'path-outside-allowed',
}

// ------------------------------------------------------------------- paths

/** Normalize for comparison: lowercase, backslashes, no trailing slash. */
export function normPath(p) {
  return String(p || '').replace(/[\\/]+$/, '').toLowerCase()
}

/** True when the raw path contains '..' segments or is a UNC path. */
export function hasTraversal(p) {
  const s = String(p || '')
  if (/^\\\\|^\/\//.test(s)) return true // UNC / network path
  const segs = s.split(/[\\/]/)
  return segs.some((seg) => seg === '..')
}

/** True when normalized `p` is equal to or inside one of `roots`. */
export function isWithin(p, roots) {
  const pn = normPath(p)
  if (!pn) return false
  return roots.some((r) => {
    const rn = normPath(r)
    if (!rn) return false
    return pn === rn || pn.startsWith(rn + '\\')
  })
}

/** True when any path segment is protected, or the name matches DENY_FILE. */
export function segmentsDenied(p) {
  const lower = normPath(p)
  if (!lower) return false
  const segs = lower.split(/[\\/]/).filter(Boolean)
  return segs.some((s) => DENY_SEGMENTS.has(s)) || DENY_FILE.test(String(p))
}

/**
 * Deny decision for a canonical path, with a registered-workspace escape hatch:
 * a path inside a protected area is reachable only when it lies under a
 * registered workspace whose OWN path is inside that protected area.
 * @param p - canonical (realpath) path.
 * @param workspaceRoots - list of registered workspace paths (their `.path`).
 */
export function deniedPath(p, workspaceRoots) {
  const lower = normPath(p)
  if (!lower) return false
  if (!segmentsDenied(lower)) return false
  if (Array.isArray(workspaceRoots)) {
    for (const w of workspaceRoots) {
      const wp = normPath(w)
      if (!wp) continue
      if (segmentsDenied(wp) && (lower === wp || lower.startsWith(wp + '\\'))) return false
    }
  }
  return true
}

/**
 * Capability rule for the allowlist: the phone may only NARROW the approved
 * roots (remove entries or add sub-paths of existing entries). Widening to an
 * unrelated location (e.g. C:\) requires editing .remfs-roots.json on the PC.
 */
export function canSetRoots(next, current) {
  if (!Array.isArray(next) || next.length === 0) return false
  return next.every((r) => isWithin(r, current))
}

// -------------------------------------------------------------------- auth

function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

export function randomToken(bytes) {
  return randomBytes(bytes).toString('hex')
}

/** Human-typable pairing code: 8 groups of 4 hex chars, e.g. A1B2-C3D4-... */
export function formatPairingCode(hex) {
  const groups = []
  for (let i = 0; i < hex.length; i += CODE_GROUP_CHARS) {
    groups.push(hex.slice(i, i + CODE_GROUP_CHARS))
  }
  return groups.join('-')
}

export function parsePairingCode(code) {
  return String(code || '').replace(/-/g, '').replace(/\s+/g, '').toLowerCase()
}

export const securityFile = () => path.join(os.homedir(), '.dsh', 'remfs-security.json')

async function loadStore(file) {
  try {
    await access(file)
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      pairing: parsed.pairing && typeof parsed.pairing === 'object' ? parsed.pairing : null,
    }
  } catch {
    return { devices: [], pairing: null }
  }
}

async function saveStore(file, store) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
  try { await access(tmp); await import('node:fs/promises').then((m) => m.unlink(tmp)) } catch { /* ignore */ }
}

/**
 * Ensure a valid, unexpired pairing code exists; returns its plaintext.
 * Writes the code to `<file>.txt` (PC-local, for the human to read) and the
 * hash + expiry into the store.
 */
export async function ensurePairingCode(file = securityFile()) {
  const store = await loadStore(file)
  const now = Date.now()
  if (store.pairing && store.pairing.expiresAt > now) {
    // pairing code persists; plaintext is only reconstructible via the .txt file
    return null
  }
  const code = randomToken(16) // 128-bit, one-time, TTL-bounded
  const plain = formatPairingCode(code)
  store.pairing = { codeHash: sha256(code), expiresAt: now + PAIRING_TTL_MS }
  await saveStore(file, store)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file + '.txt', plain + '\n' + new Date().toISOString() + '\n', 'utf8')
  } catch { /* display is best-effort */ }
  return plain
}

/**
 * Consume a pairing code: single use + expiry. On success creates a device
 * and returns its { deviceId, credential }.
 */
export async function pairDevice(code, deviceName, file = securityFile()) {
  const store = await loadStore(file)
  const p = store.pairing
  if (!p || !p.codeHash) return { error: ERR.PAIRING_INVALID }
  if (p.expiresAt < Date.now()) return { error: ERR.PAIRING_EXPIRED }
  const given = sha256(parsePairingCode(code))
  if (given !== p.codeHash) return { error: ERR.PAIRING_INVALID }
  // single use
  store.pairing = null
  const deviceId = randomUUID()
  const credential = randomToken(CREDENTIAL_BYTES)
  store.devices.push({
    id: deviceId,
    name: String(deviceName || 'phone').slice(0, 60),
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    credentialHash: sha256(credential),
  })
  await saveStore(file, store)
  return { deviceId, credential }
}

/** Verify a device credential; updates lastSeen on success. */
export async function verifyDevice(deviceId, credential, file = securityFile()) {
  if (typeof deviceId !== 'string' || typeof credential !== 'string' || !deviceId || !credential) {
    return { error: ERR.AUTH_REQUIRED }
  }
  const store = await loadStore(file)
  const dev = store.devices.find((d) => d.id === deviceId)
  if (!dev) return { error: ERR.AUTH_INVALID }
  if (sha256(credential) !== dev.credentialHash) return { error: ERR.AUTH_INVALID }
  dev.lastSeen = new Date().toISOString()
  await saveStore(file, store)
  return { ok: true, device: dev }
}

export async function listDevices(file = securityFile()) {
  const store = await loadStore(file)
  return store.devices.map((d) => ({
    id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen,
  }))
}

export async function revokeDevice(deviceId, file = securityFile()) {
  const store = await loadStore(file)
  const before = store.devices.length
  store.devices = store.devices.filter((d) => d.id !== deviceId)
  if (store.devices.length === before) return { error: ERR.DEVICE_NOT_FOUND }
  await saveStore(file, store)
  return { ok: true }
}

export async function revokeAllDevices(file = securityFile()) {
  const store = await loadStore(file)
  store.devices = []
  store.pairing = null
  await saveStore(file, store)
  return { ok: true }
}
