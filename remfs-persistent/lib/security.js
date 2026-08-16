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
//
// Concurrency: every store access runs through a per-file mutation lock and
// the store file is replaced atomically (tmp + rename), so concurrent
// verifyDevice/revokeDevice/pairDevice calls cannot resurrect a revoked
// credential or double-consume a pairing code.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises'
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

/**
 * Breadcrumb segments for a path. `path` is captured eagerly per segment (no
 * shared mutable accumulator), so each crumb navigates to ITS OWN prefix.
 * Mirrored in lib/client.js (the browser module cannot import this file).
 */
export function buildCrumbs(p) {
  const segs = String(p || '').split(/[\\/]+/).filter(Boolean)
  let acc = ''
  return segs.map((seg, i) => {
    acc = i === 0 ? seg : acc + '\\' + seg
    return { label: seg, path: acc, last: i === segs.length - 1 }
  })
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

export const pairingTxtFile = (file = securityFile()) =>
  path.join(path.dirname(file), 'remfs-pairing.txt')

// ------------------------------------------------------------------ store

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

/** Atomic replace: write tmp then rename (same volume => atomic on Windows). */
async function saveStore(file, store) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Serialize every store operation per file so read-modify-write cannot race. */
const locks = new Map()
function withStoreLock(file, fn) {
  const prev = locks.get(file) || Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(file, next.then(() => {}, () => {}))
  return next
}

async function writePairingTxt(text) {
  try {
    await mkdir(path.dirname(text.file), { recursive: true })
    await writeFile(text.file, text.body, 'utf8')
  } catch { /* display is best-effort */ }
}

function consumedTxt(file, when) {
  return { file, body: `CONSUMED ${when}\n(restart the harness or run refresh_pairing.ps1 for a new code)\n` }
}

function freshTxt(file, plain, when) {
  return { file, body: plain + '\n' + when + '\n' }
}

/**
 * Ensure a valid, unexpired pairing code exists; regenerates when absent,
 * expired or already consumed. Returns the plaintext of the fresh code, or
 * null when the current code is still valid (its plaintext is only
 * reconstructible from the .txt file).
 */
export async function ensurePairingCode(file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    const now = Date.now()
    if (store.pairing && store.pairing.codeHash && store.pairing.expiresAt > now) {
      return null
    }
    const code = randomToken(16) // 128-bit, one-time, TTL-bounded
    const plain = formatPairingCode(code)
    store.pairing = { codeHash: sha256(code), expiresAt: now + PAIRING_TTL_MS }
    await saveStore(file, store)
    await writePairingTxt(freshTxt(pairingTxtFile(file), plain, new Date().toISOString()))
    return plain
  })
}

/** Read-only pairing status (for PC-side UI/scripts). */
export async function pairingStatus(file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    if (!store.pairing || !store.pairing.codeHash) return { present: false }
    return { present: true, expiresAt: store.pairing.expiresAt, expired: store.pairing.expiresAt < Date.now() }
  })
}

/**
 * Consume a pairing code: strictly single-use + expiry, under the store lock.
 * On success creates a device and returns { deviceId, credential }; the
 * consumed code is marked in the .txt so it cannot mislead the user.
 */
export async function pairDevice(code, deviceName, file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    const p = store.pairing
    if (!p || !p.codeHash) return { error: ERR.PAIRING_USED }
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
    await writePairingTxt(consumedTxt(pairingTxtFile(file), new Date().toISOString()))
    return { deviceId, credential }
  })
}

/** Verify a device credential; updates lastSeen on success (under the lock). */
export async function verifyDevice(deviceId, credential, file = securityFile()) {
  if (typeof deviceId !== 'string' || typeof credential !== 'string' || !deviceId || !credential) {
    return { error: ERR.AUTH_REQUIRED }
  }
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    const dev = store.devices.find((d) => d.id === deviceId)
    if (!dev) return { error: ERR.AUTH_INVALID }
    if (sha256(credential) !== dev.credentialHash) return { error: ERR.AUTH_INVALID }
    dev.lastSeen = new Date().toISOString()
    await saveStore(file, store)
    return { ok: true, device: dev }
  })
}

export async function listDevices(file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    return store.devices.map((d) => ({
      id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen,
    }))
  })
}

export async function revokeDevice(deviceId, file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    const before = store.devices.length
    store.devices = store.devices.filter((d) => d.id !== deviceId)
    if (store.devices.length === before) return { error: ERR.DEVICE_NOT_FOUND }
    await saveStore(file, store)
    return { ok: true }
  })
}

export async function revokeAllDevices(file = securityFile()) {
  return withStoreLock(file, async () => {
    const store = await loadStore(file)
    store.devices = []
    store.pairing = null
    await saveStore(file, store)
    return { ok: true }
  })
}
