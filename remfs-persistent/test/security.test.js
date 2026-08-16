// Filesystem + authentication security tests for the /remfs bridge.
// Run: node --test test/security.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  normPath, hasTraversal, isWithin, segmentsDenied, deniedPath, canSetRoots,
  ensurePairingCode, pairDevice, verifyDevice, listDevices, revokeDevice,
  revokeAllDevices, parsePairingCode, formatPairingCode, securityFile, buildCrumbs,
} from '../lib/security.js'

const DOCS = path.join(os.homedir(), 'Documents')
const ROOT = DOCS // typical workspace root

async function tempFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remfs-sec-'))
  return path.join(dir, 'security.json')
}

// --------------------------------------------------------------- path tests

test('path traversal: rejects .. segments', () => {
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents\\..\\..\\Windows'), true)
  assert.equal(hasTraversal('../../etc/passwd'), true)
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents\\sub\\..\\x'), true)
  assert.equal(hasTraversal('C:\\Users\\zeta\\Documents'), false)
})

test('path traversal: rejects UNC / network paths', () => {
  assert.equal(hasTraversal('\\\\server\\share\\file.txt'), true)
  assert.equal(hasTraversal('//server/share'), true)
})

test('isWithin: absolute-path bypass blocked', () => {
  assert.equal(isWithin('C:\\Windows\\System32', [ROOT]), false)
  assert.equal(isWithin('C:\\Users\\zeta\\.ssh\\id_rsa', [ROOT]), false)
  assert.equal(isWithin(ROOT + '\\sub', [ROOT]), true)
  assert.equal(isWithin(ROOT, [ROOT]), true)
})

test('isWithin: case-insensitive matching', () => {
  // Platform-independent: pure string comparison (no os.homedir involved).
  assert.equal(isWithin('C:\\USERS\\zeta\\DOCUMENTS\\file.txt', ['C:\\Users\\zeta\\Documents']), true)
  assert.equal(isWithin('c:\\users\\zeta\\documents\\sub\\x', ['C:\\Users\\zeta\\Documents']), true)
  assert.equal(isWithin('C:\\Users\\zeta\\Other', ['C:\\Users\\zeta\\Documents']), false)
})

test('protected credential access is denied', () => {
  const wp = [] // no registered workspace escape
  for (const p of [
    ROOT + '\\.credentials.yaml',
    ROOT + '\\.ssh\\id_rsa',
    ROOT + '\\proj\\keys.pem',
    ROOT + '\\proj\\.env',
    'C:\\Users\\zeta\\.aws\\credentials',
    'C:\\Windows\\System32',
    'C:\\Users\\zeta\\Documents\\xwechat_files\\data',
    'C:\\Users\\zeta\\Documents\\KingsoftData\\x',
  ]) {
    assert.equal(deniedPath(p, wp), true, 'should be denied: ' + p)
  }
})

test('registered workspace inside protected area stays reachable', () => {
  const wp = ['C:\\Users\\zeta\\Documents\\xwechat_files\\wxid_x\\business\\01']
  assert.equal(deniedPath(wp[0], wp), false)
  assert.equal(deniedPath(wp[0] + '\\notes.txt', wp), false)
  // sibling inside the protected area but outside the workspace: still denied
  assert.equal(deniedPath('C:\\Users\\zeta\\Documents\\xwechat_files\\other', wp), true)
  // normal workspace root (Documents) does NOT lift the deny
  assert.equal(deniedPath(ROOT + '\\xwechat_files\\data', [ROOT]), true)
})

test('allowlist: phone can only narrow roots, never widen', () => {
  const cur = [ROOT]
  assert.equal(canSetRoots([ROOT + '\\sub'], cur), true) // narrow to a sub-path
  assert.equal(canSetRoots([ROOT], cur), true) // unchanged
  assert.equal(canSetRoots([], cur), false) // cannot empty it
  assert.equal(canSetRoots(['C:\\'], cur), false) // cannot widen to C:\
  assert.equal(canSetRoots(['C:\\Users\\zeta'], cur), false) // cannot widen
  assert.equal(canSetRoots(['D:\\media', ROOT], cur), false) // no unrelated roots
})

// ------------------------------------------------------------ auth tests

test('pairing code: single use, valid once', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    assert.ok(code && code.includes('-'))
    const parsed = parsePairingCode(code)
    assert.equal(parsed.length, 32)
    assert.equal(formatPairingCode(parsed), code)

    const a = await pairDevice(code, 'test-phone', f)
    assert.ok(a.deviceId && a.credential)
    // reuse must fail (single use)
    const b = await pairDevice(code, 'second', f)
    assert.equal(b.error, 'pairing-used')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('pairing code: wrong code rejected, expiry honored', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const bad = await pairDevice('deadbeef-deadbeef-deadbeef-deadbeef', 'x', f)
    assert.equal(bad.error, 'pairing-invalid')
    // simulate expiry
    const { securityFile: _sf, ...rest } = await import('../lib/security.js')
    void rest
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
    raw.pairing.expiresAt = Date.now() - 1000
    await (await import('node:fs/promises')).writeFile(f, JSON.stringify(raw), 'utf8')
    const expired = await pairDevice(code, 'x', f)
    assert.equal(expired.error, 'pairing-expired')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('device credential: valid auth, invalid auth, revoked auth', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const { deviceId, credential } = await pairDevice(code, 'phone-a', f)
    assert.equal((await verifyDevice(deviceId, credential, f)).ok, true)
    assert.equal((await verifyDevice(deviceId, 'wrong', f)).error, 'auth-invalid')
    assert.equal((await verifyDevice('nope', credential, f)).error, 'auth-invalid')
    assert.equal((await verifyDevice(null, credential, f)).error, 'auth-required')

    const devices = await listDevices(f)
    assert.equal(devices.length, 1)
    assert.equal(devices[0].name, 'phone-a')
    // hash only — plaintext credential must not be stored
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
    assert.ok(!JSON.stringify(raw).includes(credential))

    await revokeDevice(deviceId, f)
    assert.equal((await verifyDevice(deviceId, credential, f)).error, 'auth-invalid')
    assert.equal((await listDevices(f)).length, 0)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('revoke all: all devices invalidated, pairing cleared', async () => {
  const f = await tempFile()
  try {
    const c1 = await ensurePairingCode(f)
    const d1 = await pairDevice(c1, 'a', f)
    await ensurePairingCode(f) // fresh code for second device
    const c2 = await (await import('../lib/security.js')).ensurePairingCode ? null : null
    // ensurePairingCode returns null when a valid code already exists; generate one
    const code2 = await freshCode(f)
    const d2 = await pairDevice(code2, 'b', f)
    assert.equal((await verifyDevice(d1.deviceId, d1.credential, f)).ok, true)
    assert.equal((await verifyDevice(d2.deviceId, d2.credential, f)).ok, true)
    await revokeAllDevices(f)
    assert.equal((await verifyDevice(d1.deviceId, d1.credential, f)).error, 'auth-invalid')
    assert.equal((await verifyDevice(d2.deviceId, d2.credential, f)).error, 'auth-invalid')
    assert.equal((await listDevices(f)).length, 0)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

async function freshCode(f) {
  // securityFile() default collides with the real one; use the temp store directly
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(f, 'utf8'))
  raw.pairing = null
  await (await import('node:fs/promises')).writeFile(f, JSON.stringify(raw), 'utf8')
  return ensurePairingCode(f)
}

test('default store location is under the DSH home', () => {
  assert.ok(securityFile().startsWith(path.join(os.homedir(), '.dsh')))
  assert.ok(!securityFile().includes('Documents'))
})

test('buildCrumbs: each crumb captures its own prefix (no shared accumulator)', () => {
  const crumbs = buildCrumbs('C:\\Users\\zeta\\Documents\\proj')
  assert.deepEqual(crumbs.map((c) => c.path), [
    'C:',
    'C:\\Users',
    'C:\\Users\\zeta',
    'C:\\Users\\zeta\\Documents',
    'C:\\Users\\zeta\\Documents\\proj',
  ])
  assert.deepEqual(crumbs.map((c) => c.last), [false, false, false, false, true])
  assert.deepEqual(buildCrumbs(''), [])
})

test('pairing txt: consumed code is marked so it cannot mislead', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    await pairDevice(code, 'phone', f)
    const txt = path.join(path.dirname(f), 'remfs-pairing.txt')
    const body = await (await import('node:fs/promises')).readFile(txt, 'utf8')
    assert.ok(/CONSUMED/.test(body))
    // regeneration after consumption returns a fresh plaintext code
    const code2 = await ensurePairingCode(f)
    assert.ok(code2 && code2 !== code)
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('concurrent verify/revoke: revoked credential never resurrects', async () => {
  const f = await tempFile()
  try {
    const code = await ensurePairingCode(f)
    const { deviceId, credential } = await pairDevice(code, 'phone', f)
    await Promise.all([
      verifyDevice(deviceId, credential, f),
      verifyDevice(deviceId, credential, f),
      revokeDevice(deviceId, f),
      verifyDevice(deviceId, credential, f),
    ])
    const after = await verifyDevice(deviceId, credential, f)
    assert.equal(after.error, 'auth-invalid')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('corrupt store: fails closed with a backup, never silently resets', async () => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    await fsp.writeFile(f, '{ not json', 'utf8')
    const v1 = await verifyDevice('x', 'y', f)
    assert.equal(v1.error, 'store-corrupt')
    // a backup of the bad content exists and the original is NOT overwritten
    const dir = path.dirname(f)
    const base = path.basename(f)
    const backups = (await fsp.readdir(dir)).filter((n) => n.indexOf(base + '.corrupt-') === 0)
    assert.ok(backups.length >= 1, 'corrupt store must be backed up')
    assert.equal(await fsp.readFile(f, 'utf8'), '{ not json', 'original must not be silently overwritten')
    assert.equal(await fsp.readFile(path.join(dir, backups[0]), 'utf8'), '{ not json')
    // state is NOT reset: a second operation still fails closed
    const v2 = await verifyDevice('x', 'y', f)
    assert.equal(v2.error, 'store-corrupt')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})

test('permission/read error on the store fails closed', async (t) => {
  const f = await tempFile()
  const fsp = await import('node:fs/promises')
  try {
    // A directory where the store file should be: readFile fails (EISDIR).
    await fsp.mkdir(f)
    const v = await verifyDevice('x', 'y', f)
    assert.equal(v.error, 'store-corrupt')
  } finally { await rm(path.dirname(f), { recursive: true, force: true }) }
})
