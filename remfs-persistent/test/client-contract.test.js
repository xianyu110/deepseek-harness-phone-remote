// Client -> RPC payload -> dispatcher contract regression test.
// The browser client cannot be imported, so this test (1) pins the payload
// the client source actually produces for `revoke`, and (2) feeds that exact
// shape through the real dispatcher to prove the protocol lines up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { promises as fsp } from 'node:fs'
import { realpathSync } from 'node:fs'
import { createDispatcher } from '../lib/dispatch.js'
import { ensurePairingCode, pairDevice } from '../lib/security.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(path.join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('client source: revoke sends targetDeviceId (never { id })', () => {
  assert.match(CLIENT_SRC, /rpc\('revoke',\s*\{\s*targetDeviceId:\s*id\s*\}/,
    'client must send { targetDeviceId } for revoke')
  assert.doesNotMatch(CLIENT_SRC, /rpc\('revoke',\s*\{\s*id:/,
    'client must NOT send { id } for revoke')
})

async function setup() {
  const dir = await fsp.mkdtemp(path.join(process.cwd(), '.tmp-contract-'))
  const root = path.join(dir, 'ws')
  await fsp.mkdir(root)
  const workspaces = []
  const adapter = {
    workspaceRoot: () => root,
    policy: () => undefined,
    readAllowedFile: async () => ({ exists: false }),
    writeAllowedFile: async () => {},
    resolvePath: async (p) => ({ target: { key: path.resolve(root, p || ''), display: p } }),
    processPath: (t) => { try { return realpathSync(t.key) } catch { return t.key } },
    stat: async (t) => { const s = await fsp.stat(t.key); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size } },
    listDir: async () => [],
    readText: async () => 'x',
    readBytes: async () => new Uint8Array(),
    writeText: async () => {},
    listWorkspaces: async () => workspaces.slice(),
    resolveWorkspaceByPath: async () => undefined,
    createWorkspace: async (p) => { const w = { id: 'w', path: p }; workspaces.push(w); return w },
  }
  const secFile = path.join(dir, 'sec.json')
  const handler = createDispatcher(adapter, { securityFile: secFile })
  const pair = async (name) => {
    const code = await ensurePairingCode(secFile)
    const res = await pairDevice(code, name, secFile)
    return { deviceId: res.deviceId, credential: res.credential }
  }
  return { dir, secFile, handler, pair }
}

test('dispatcher: the client-shaped revoke payload revokes the TARGET, not the caller', async (t) => {
  const { dir, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const B = await pair('device-b')
    // Exactly what client.js produces after rpc() attaches auth:
    const revokePayload = { targetDeviceId: B.deviceId, deviceId: A.deviceId, credential: A.credential }
    const rev = await handler('revoke', revokePayload)
    assert.equal(rev.ok, true)
    // B dead, A alive
    const b = await handler('list', { deviceId: B.deviceId, credential: B.credential, path: '' })
    assert.equal(b.error.code, 'auth-invalid')
    const a = await handler('list', { deviceId: A.deviceId, credential: A.credential, path: '' })
    assert.equal(a.ok, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('dispatcher: the OLD broken payload ({ id }) is rejected and revokes nothing', async (t) => {
  const { dir, handler, pair } = await setup()
  try {
    const A = await pair('device-a')
    const B = await pair('device-b')
    const bad = await handler('revoke', { id: B.deviceId, deviceId: A.deviceId, credential: A.credential })
    assert.equal(bad.ok, false)
    assert.equal(bad.error.code, 'bad-request')
    const a = await handler('list', { deviceId: A.deviceId, credential: A.credential, path: '' })
    assert.equal(a.ok, true, 'caller must stay authorized')
    const b = await handler('list', { deviceId: B.deviceId, credential: B.credential, path: '' })
    assert.equal(b.ok, true, 'target must stay authorized')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
