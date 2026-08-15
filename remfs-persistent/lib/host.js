// Persistent host half: exposes the /remfs RPC channel (trusted-host authority)
// with allowed-roots, workspace, and file operations.
// Result envelope follows the Connection RPC contract (serverResponseSchema):
//   ok    -> { ok: true, value: <business data> }
//   error -> { ok: false, error: { code, message, details } }
// inject is REQUIRED: cross-entry services (connection, fs) must be declared so
// the loader resolves them before apply runs; a bare ctx.get() in apply
// resolves undefined and the channel never registers.
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

    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()

    const withinAllowed = (p, allowed) => allowed.some((r) => {
      const rn = norm(r)
      const pn = norm(p)
      if (!rn) return false
      return pn === rn || pn.startsWith(rn + '\\') || pn.startsWith(rn + '/')
    })

    // ── protected-path deny list ─────────────────────────────────────────────
    // Enforced on the HOST, independent of the allowed roots: expanding the
    // allowlist (setAllowed) can never expose system dirs, private data dirs
    // or credential/key files. Registered workspaces stay reachable even when
    // they sit inside a denied dir (e.g. a WeChat-files workspace).
    const DENY_SEGMENTS = new Set([
      'system volume information', '$recycle.bin', 'recovery', 'config.msi', '$sysreset',
      'windows', 'perflogs', 'msocache', 'windows.old', '$winreagent',
      'program files', 'program files (x86)', 'programdata',
      'xwechat_files', 'kingsoftdata', 'wpscloudsvr', 'tencent files'
    ])
    const DENY_FILE = /(^|[/\\])\.ssh([/\\]|$)|(^|[/\\])\.git([/\\]|$)|(^|[/\\])id_(rsa|ed25519|dsa|ecdsa)(\.pub)?$|\.(pem|key|pfx|p12)$|(^|[/\\])\.credentials\.ya?ml$|(^|[/\\])ntuser\.dat$|^[A-Za-z]:[/\\](sam|system|security)(\.|$)/i

    const segmentsDenied = (lower) => {
      const segs = lower.split(/[\\/]/).filter(Boolean)
      return segs.some((s) => DENY_SEGMENTS.has(s)) || DENY_FILE.test(String(lower))
    }

    const deniedPath = (p) => {
      const lower = norm(p)
      if (!lower) return false
      if (!segmentsDenied(lower)) return false
      // Escape hatch: a path inside a protected area is reachable when it lies
      // under a REGISTERED workspace whose own path is itself inside that
      // protected area (e.g. a WeChat-files workspace). A normal workspace root
      // (like Documents) does NOT lift the deny for its descendants.
      const wr = ctx.get('workspaceRegistry')
      if (wr && typeof wr.list === 'function') {
        try {
          const list = wr.list()
          for (const w of list) {
            const wp = norm(w.path)
            if (!wp) continue
            if (segmentsDenied(wp) && (lower === wp || lower.startsWith(wp + '\\'))) return false
          }
        } catch { /* fall through to deny */ }
      }
      return true
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

    const handler = async (endpoint, payload) => {
      try {
        switch (endpoint) {
          case 'allowed': {
            const allowed = await readAllowed()
            return { ok: true, value: { allowed, root: workspaceRoot() } }
          }
          case 'setAllowed': {
            const roots = payload && Array.isArray(payload.roots) ? payload.roots.map(String).filter(Boolean) : []
            if (roots.length === 0) return err('bad-request', 'no roots provided', { issues: [] })
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
            const path = payload && payload.path
            if (typeof path !== 'string' || !path) return err('bad-request', 'missing path', { issues: [] })
            const allowed = await readAllowed()
            if (deniedPath(path)) return err('internal', 'path is protected', {})
            if (!withinAllowed(path, allowed)) return err('internal', 'path outside the allowed roots', {})
            const wr = ctx.get('workspaceRegistry')
            if (!wr) return err('internal', 'workspace registry unavailable', {})
            const existing = await wr.resolveByPath(path)
            if (existing) return { ok: true, value: { workspaceId: String(existing.id), created: false } }
            const created = await wr.create(path)
            return { ok: true, value: { workspaceId: String(created.id), created: true } }
          }
          case 'list': {
            const path = payload && typeof payload.path === 'string' && payload.path ? payload.path : ''
            const target = await fs.resolve(path || workspaceRoot(), { cwd: workspaceRoot() })
            const info = await fs.stat(target)
            if (!info) return err('internal', 'path not found: ' + (path || workspaceRoot()), {})
            if (info.type !== 'directory') return err('internal', 'not a directory: ' + path, {})
            const allowed = await readAllowed()
            const canonical = fs.processPath(target)
            if (deniedPath(canonical)) return err('internal', 'path is protected', {})
            if (!withinAllowed(canonical, allowed)) return err('internal', 'path outside the allowed roots', {})
            const entries = await fs.listDir(target)
            let parent = parentOf(canonical)
            if (parent && (deniedPath(parent) || !withinAllowed(parent, allowed))) parent = null
            return { ok: true, value: { path: canonical, parent, entries: entries.map(entryRow) } }
          }
          case 'read': {
            const path = payload && payload.path
            if (typeof path !== 'string' || !path) return err('bad-request', 'missing path', { issues: [] })
            const target = await fs.resolve(path, { cwd: workspaceRoot() })
            const info = await fs.stat(target)
            if (!info) return err('internal', 'not found: ' + path, {})
            if (info.type !== 'file') return err('internal', 'not a file: ' + path, {})
            const allowed = await readAllowed()
            if (deniedPath(fs.processPath(target))) return err('internal', 'path is protected', {})
            if (!withinAllowed(fs.processPath(target), allowed)) return err('internal', 'path outside the allowed roots', {})
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
            const path = payload && payload.path
            const content = payload && typeof payload.content === 'string' ? payload.content : null
            if (typeof path !== 'string' || !path) return err('bad-request', 'missing path', { issues: [] })
            if (content === null) return err('bad-request', 'missing content', { issues: [] })
            const target = await fs.resolve(path, { cwd: workspaceRoot() })
            const allowed = await readAllowed()
            if (deniedPath(fs.processPath(target))) return err('internal', 'path is protected', {})
            if (!withinAllowed(fs.processPath(target), allowed)) return err('internal', 'path outside the allowed roots', {})
            await fs.writeText(target, content, undefined, undefined, policy())
            return { ok: true, value: { path: fs.processPath(target) } }
          }
          default:
            return err('bad-request', 'unknown endpoint: ' + String(endpoint), { issues: [] })
        }
      } catch (e) {
        return err('internal', String((e && e.message) || e), {})
      }
    }

    conn.rpc.handle('/remfs', handler, { authority: 'trusted-host' })
    console.log('[remfs-persistent] host applied: /remfs channel registered')
  }
}
