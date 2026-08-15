// Persistent host half: exposes the /remfs RPC channel (trusted-host authority)
// with device authentication, pairing, workspace and file operations.
//
// Result envelope follows the Connection RPC contract (serverResponseSchema):
//   ok    -> { ok: true, value: <business data> }
//   error -> { ok: false, error: { code, message, details } }
//
// inject is REQUIRED: cross-entry services (connection, fs) must be declared so
// the loader resolves them before apply runs; a bare ctx.get() in apply
// resolves undefined and the channel never registers.
import {
  hasTraversal, isWithin, deniedPath, canSetRoots,
  ensurePairingCode, pairDevice, verifyDevice, listDevices,
  revokeDevice, revokeAllDevices, ERR,
} from './security.js'

export default {
  inject: ['connection', 'fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) {
      console.log('[remfs-persistent] host apply skipped: fs unavailable')
      return
    }
    const conn = ctx.get('connection')
    if (conn === undefined || !conn.rpc) {
      console.log('[remfs-persistent] host apply skipped: connection.rpc unavailable')
      return
    }

    const MAX_BINARY = 5 * 1024 * 1024

    const err = (code, message, details) => ({ ok: false, error: { code, message, details: details || {} } })

    const workspaceRoot = () => {
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot) return sp.workspaceRoot
      const wr = ctx.get('workspaceRegistry')
      if (wr && typeof wr.list === 'function') {
        const list = wr.list()
        if (list && list.length > 0 && list[0] && list[0].path) return list[0].path
      }
      return 'C:\\'
    }

    const policy = () => {
      const sp = ctx.get('sandboxPolicy')
      if (sp && typeof sp.resolve === 'function') {
        try { return sp.resolve() } catch { /* ignore */ }
      }
      return undefined
    }

    const allowedFile = () => workspaceRoot() + '\\.remfs-roots.json'

    const registeredWorkspacePaths = () => {
      const wr = ctx.get('workspaceRegistry')
      if (!wr || typeof wr.list !== 'function') return []
      try {
        return wr.list().map((w) => String(w.path || '')).filter(Boolean)
      } catch { return [] }
    }

    const readAllowed = async () => {
      try {
        const target = await fs.resolve(allowedFile(), { cwd: workspaceRoot() })
        const text = await fs.readText(target)
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const list = parsed.map(String).filter(Boolean)
          if (list.length > 0) return list
        }
      } catch { /* default */ }
      return [workspaceRoot()]
    }

    const writeAllowed = async (roots) => {
      const target = await fs.resolve(allowedFile(), { cwd: workspaceRoot() })
      await fs.writeText(target, JSON.stringify(roots, null, 2), undefined, undefined, policy())
    }

    // Reject raw payload paths that contain '..' or UNC prefixes before resolving.
    const guardRawPath = (p) => {
      if (hasTraversal(p)) return err(ERR.PATH_TRAVERSAL, 'path traversal is not allowed')
      return null
    }

    const base64Of = (bytes) => {
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      return btoa(bin)
    }

    const parentOf = (p) => {
      if (!p) return null
      const n = p.replace(/[\\/]+$/, '')
      const m = n.match(/^([A-Za-z]:)(.*)$/)
      if (!m) return null
      const drive = m[1]
      const rest = m[2]
      if (!rest) return null
      const idx = rest.lastIndexOf('\\')
      if (idx <= 0) return drive + '\\'
      return drive + rest.slice(0, idx)
    }

    const entryRow = (e) => {
      const row = { name: e.name, type: e.type }
      if (typeof e.size === 'number') row.size = e.size
      return row
    }

    // Authentication gate for every endpoint except `pair`.
    const auth = async (payload) => {
      const res = await verifyDevice(payload && payload.deviceId, payload && payload.credential)
      if (res.error === ERR.AUTH_REQUIRED) return err(ERR.AUTH_REQUIRED, 'device authentication required')
      if (res.error) return err(ERR.AUTH_INVALID, 'device authentication failed — re-pair the device')
      return null
    }

    const handler = async (endpoint, payload) => {
      try {
        // ---- unauthenticated bootstrap: pairing ----
        if (endpoint === 'pair') {
          const code = payload && payload.code
          const name = payload && payload.deviceName
          if (!code || typeof code !== 'string') return err(ERR.PAIRING_INVALID, 'pairing code required')
          const res = await pairDevice(code, name)
          if (res.error === ERR.PAIRING_EXPIRED) return err(ERR.PAIRING_EXPIRED, 'pairing code expired — generate a new one on the PC')
          if (res.error) return err(ERR.PAIRING_INVALID, 'invalid pairing code')
          console.log('[remfs-persistent] device paired: ' + String(name || 'phone'))
          return { ok: true, value: { deviceId: res.deviceId, credential: res.credential } }
        }

        // ---- everything else requires a valid device credential ----
        const authErr = await auth(payload)
        if (authErr) return authErr

        switch (endpoint) {
          case 'devices': {
            const devices = await listDevices()
            return { ok: true, value: { devices } }
          }
          case 'revoke': {
            const id = payload && payload.deviceId
            if (typeof id !== 'string' || !id) return err('bad-request', 'device id required', { issues: [] })
            const res = await revokeDevice(id)
            if (res.error) return err(ERR.DEVICE_NOT_FOUND, 'device not found')
            return { ok: true, value: {} }
          }
          case 'revokeAll': {
            await revokeAllDevices()
            return { ok: true, value: {} }
          }
          case 'allowed': {
            const allowed = await readAllowed()
            return { ok: true, value: { allowed, root: workspaceRoot() } }
          }
          case 'setAllowed': {
            const roots = payload && Array.isArray(payload.roots) ? payload.roots.map(String).filter(Boolean) : []
            if (roots.length === 0) return err('bad-request', 'no roots provided', { issues: [] })
            const current = await readAllowed()
            if (!canSetRoots(roots, current)) {
              return err(ERR.ROOT_OUTSIDE, 'new roots must stay inside approved roots — edit .remfs-roots.json on the PC to add new locations')
            }
            await writeAllowed(roots)
            return { ok: true, value: { allowed: roots } }
          }
          case 'workspaces': {
            const wr = ctx.get('workspaceRegistry')
            if (!wr || typeof wr.list !== 'function') return { ok: true, value: { workspaces: [] } }
            const list = wr.list()
            return {
              ok: true,
              value: {
                workspaces: list.map((w) => ({
                  id: String(w.id),
                  path: String(w.path || ''),
                  title: String(w.title || w.path || '')
                }))
              }
            }
          }
          case 'ensureWorkspace': {
            const raw = payload && payload.path
            if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
            const g = guardRawPath(raw)
            if (g) return g
            const target = await fs.resolve(raw, { cwd: workspaceRoot() })
            const canonical = fs.processPath(target)
            const allowed = await readAllowed()
            if (deniedPath(canonical, registeredWorkspacePaths())) return err(ERR.PATH_PROTECTED, 'path is protected')
            if (!isWithin(canonical, allowed)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
            const wr = ctx.get('workspaceRegistry')
            if (!wr) return err('internal', 'workspace registry unavailable', {})
            const existing = await wr.resolveByPath(canonical)
            if (existing) return { ok: true, value: { workspaceId: String(existing.id), created: false } }
            const created = await wr.create(canonical)
            return { ok: true, value: { workspaceId: String(created.id), created: true } }
          }
          case 'list': {
            const raw = payload && typeof payload.path === 'string' && payload.path ? payload.path : ''
            if (raw) {
              const g = guardRawPath(raw)
              if (g) return g
            }
            const target = await fs.resolve(raw || workspaceRoot(), { cwd: workspaceRoot() })
            const info = await fs.stat(target)
            if (!info) return err('internal', 'path not found: ' + (raw || workspaceRoot()), {})
            if (info.type !== 'directory') return err('internal', 'not a directory: ' + raw, {})
            const allowed = await readAllowed()
            const canonical = fs.processPath(target)
            if (deniedPath(canonical, registeredWorkspacePaths())) return err(ERR.PATH_PROTECTED, 'path is protected')
            if (!isWithin(canonical, allowed)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
            const entries = await fs.listDir(target)
            let parent = parentOf(canonical)
            if (parent && (deniedPath(parent, registeredWorkspacePaths()) || !isWithin(parent, allowed))) parent = null
            return { ok: true, value: { path: canonical, parent, entries: entries.map(entryRow) } }
          }
          case 'read': {
            const raw = payload && payload.path
            if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
            const g = guardRawPath(raw)
            if (g) return g
            const target = await fs.resolve(raw, { cwd: workspaceRoot() })
            const info = await fs.stat(target)
            if (!info) return err('internal', 'not found: ' + raw, {})
            if (info.type !== 'file') return err('internal', 'not a file: ' + raw, {})
            const allowed = await readAllowed()
            const canonical = fs.processPath(target)
            if (deniedPath(canonical, registeredWorkspacePaths())) return err(ERR.PATH_PROTECTED, 'path is protected')
            if (!isWithin(canonical, allowed)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
            if (typeof info.size === 'number' && info.size > MAX_BINARY) {
              return { ok: true, value: { kind: 'too-large', size: info.size } }
            }
            try {
              const text = await fs.readText(target)
              return { ok: true, value: { kind: 'text', text, size: typeof info.size === 'number' ? info.size : text.length } }
            } catch {
              const bytes = await fs.readBytes(target, undefined, MAX_BINARY)
              return { ok: true, value: { kind: 'base64', base64: base64Of(bytes), size: bytes.length } }
            }
          }
          case 'write': {
            const raw = payload && payload.path
            const content = payload && typeof payload.content === 'string' ? payload.content : null
            if (typeof raw !== 'string' || !raw) return err('bad-request', 'missing path', { issues: [] })
            if (content === null) return err('bad-request', 'missing content', { issues: [] })
            const g = guardRawPath(raw)
            if (g) return g
            const target = await fs.resolve(raw, { cwd: workspaceRoot() })
            const allowed = await readAllowed()
            const canonical = fs.processPath(target)
            if (deniedPath(canonical, registeredWorkspacePaths())) return err(ERR.PATH_PROTECTED, 'path is protected')
            if (!isWithin(canonical, allowed)) return err(ERR.PATH_OUTSIDE, 'path outside the allowed roots')
            await fs.writeText(target, content, undefined, undefined, policy())
            return { ok: true, value: { path: canonical } }
          }
          default:
            return err('bad-request', 'unknown endpoint: ' + String(endpoint), { issues: [] })
        }
      } catch (e) {
        return err('internal', String((e && e.message) || e), {})
      }
    }

    conn.rpc.handle('/remfs', handler, { authority: 'trusted-host' })
    // Generate/refresh the pairing code and surface it PC-side.
    ensurePairingCode().then((plain) => {
      if (plain) console.log('[remfs-persistent] pairing code: ' + plain + ' (see ~/.dsh/remfs-pairing.txt)')
    }).catch((e) => {
      console.log('[remfs-persistent] pairing code unavailable: ' + String(e))
    })
    console.log('[remfs-persistent] host applied: /remfs channel registered')
  }
}
