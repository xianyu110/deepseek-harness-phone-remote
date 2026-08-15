// Persistent client module: the phone remote workbench.
// Loaded on every page via the dsh.client module table (no per-session run needed).
// RPC goes through ctx.connection.rpc.call('/remfs', method, payload).
window.__ModuleLoader__.load({
  id: '@zeta/remfs-persistent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `
.remfs-block{background:var(--dsw-specific-sidebar-fill,#202024);color:var(--dsw-alias-label-primary,#eee);display:flex;flex-direction:column;font-size:13px;font-family:system-ui,sans-serif;height:min(640px,74vh);min-height:340px;border:1px solid rgba(128,128,128,.2);border-radius:10px;overflow:hidden}
.remfs-panel{position:fixed;right:0;top:0;bottom:0;width:min(430px,96vw);background:var(--dsw-specific-sidebar-fill,#202024);color:var(--dsw-alias-label-primary,#eee);z-index:120;box-shadow:-8px 0 24px rgba(0,0,0,.35);display:flex;flex-direction:column;font-size:13px;font-family:system-ui,sans-serif}
.remfs-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:119}
.remfs-head{padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.25);display:flex;align-items:center;gap:8px}
.remfs-head .p{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-tabs{display:flex;gap:6px;padding:8px 12px 0;border-bottom:1px solid rgba(128,128,128,.2)}
.remfs-tab{background:transparent;border:none;color:var(--dsw-alias-label-secondary,#999);font-size:13px;padding:6px 12px;cursor:pointer;border-bottom:2px solid transparent;border-radius:0}
.remfs-tab.on{color:var(--dsw-alias-label-primary,#eee);border-bottom-color:#4a6cf7}
.remfs-body{flex:1;display:flex;flex-direction:column;min-height:0}
.remfs-crumb{display:flex;gap:4px;padding:6px 12px 0;align-items:center;overflow-x:auto;flex:none}
.remfs-crumb .remfs-chip{flex:none}
.remfs-chip.cur{opacity:.7;cursor:default}
.remfs-path{display:flex;gap:6px;padding:8px 12px;align-items:center}
.remfs-path input{flex:1;background:rgba(128,128,128,.15);border:1px solid rgba(128,128,128,.3);border-radius:6px;color:inherit;padding:6px 8px;font-size:12px;min-width:0}
.remfs-roots{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;align-items:center}
.remfs-chip{border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:3px 10px;cursor:pointer;font-size:12px;background:transparent;color:inherit;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-hidebox{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;user-select:none}
.remfs-manage{background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:6px;color:inherit;font-size:11px;padding:3px 8px;cursor:pointer}
.remfs-manage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-moremenu{display:flex;gap:12px;padding:6px 12px 8px;align-items:center;border-bottom:1px solid rgba(128,128,128,.15)}
.remfs-list{flex:1;overflow:auto;padding:4px 0}
.remfs-row{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer}
.remfs-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.15))}
.remfs-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-row .s{color:var(--dsw-alias-label-secondary,#999);font-size:11px}
.remfs-row.file-dim{cursor:default;opacity:.55}
.remfs-row.file-dim:hover{background:transparent}
.remfs-wsbadge{border:1px solid rgba(74,108,247,.5);background:rgba(74,108,247,.12);color:#7d97ff;border-radius:4px;font-size:10px;padding:1px 5px;flex:none}
.remfs-prev{padding:10px 12px;border-top:1px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:8px;max-height:45%;min-height:0}
.remfs-prev pre{margin:0;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;background:rgba(0,0,0,.25);border-radius:6px;padding:8px;font-size:12px}
.remfs-prev img{max-width:100%;border-radius:6px}
.remfs-btn{border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:4px 10px;cursor:pointer;background:transparent;color:inherit;font-size:12px}
.remfs-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-btn.primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
.remfs-btn:disabled{opacity:.4;cursor:default}
.remfs-err{color:#ff8a8a;padding:6px 12px;font-size:12px}
.remfs-err.lock{color:#ffb86b}
.remfs-tools{display:flex;gap:6px;flex-wrap:wrap}
.remfs-close{margin-left:auto;font-size:13px;padding:6px 12px}
.remfs-upload{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.remfs-wsbtn{background:#4a6cf7;border:1px solid #4a6cf7;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;width:100%;text-align:center}
.remfs-wsbtn:hover{filter:brightness(1.1)}
.remfs-wsbtn:disabled{opacity:.5;cursor:default}
.remfs-hbtn{background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:8px;color:inherit;font-size:13px;height:34px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.remfs-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-hbtn.open{border-color:#4a6cf7}
.remfs-manager{padding:10px 12px;border-top:1px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:8px}
.remfs-manager textarea{width:100%;box-sizing:border-box;min-height:110px;font-family:monospace;font-size:12px;background:rgba(0,0,0,.2);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:8px}
.remfs-wssec{padding:8px 12px 4px;display:flex;flex-direction:column;gap:6px}
.remfs-wssec .lbl{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-wschips{display:flex;flex-wrap:wrap;gap:6px}
.remfs-wschip{border:1px solid rgba(74,108,247,.55);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;background:rgba(74,108,247,.12);color:inherit;display:flex;flex-direction:column;gap:1px;align-items:flex-start;max-width:200px}
.remfs-wschip:hover{background:rgba(74,108,247,.2)}
.remfs-wschip .t{font-size:12px}
.remfs-wschip .pt{font-size:10px;color:var(--dsw-alias-label-secondary,#999);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-go{padding:8px 12px 10px}
.remfs-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2000;max-width:88vw;padding:10px 16px;border-radius:10px;font-size:13px;background:var(--dsw-specific-sidebar-fill,rgba(30,30,36,.95));color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.4));box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transition:opacity .22s;pointer-events:none;text-align:center;word-break:break-all}
.remfs-toast-show{opacity:1}
.remfs-toast-success{border-color:rgba(46,125,50,.85)}
.remfs-toast-error{border-color:rgba(224,108,108,.85);color:#e06c6c}
@media (max-width: 700px) {
  .uV2eYG_row { flex-wrap: wrap; row-gap: 8px; }
  .uV2eYG_trailing { flex: 1 1 100%; min-width: 100%; margin-left: 0; }
  ._7KE1Ra_root, ._7KE1Ra_trigger { width: 100%; }
  .uV2eYG_card { padding-bottom: 8px; }
  .pI_x6G_centerCol { position: relative; z-index: 5; }
}
.remfs-sbar{display:none;position:fixed;left:10px;bottom:16px;z-index:1000;width:38px;height:38px;border:1px solid rgba(128,128,128,.35);border-radius:50%;background:rgba(20,20,24,.8);color:var(--dsw-alias-label-primary,#eee);font-size:17px;cursor:grab;align-items:center;justify-content:center;padding:0;touch-action:none;-webkit-user-select:none;user-select:none}
.remfs-sbar:active{cursor:grabbing}
.remfs-sbar:hover{background:rgba(40,40,48,.85)}
@media (max-width: 700px) {
  .pI_x6G_frame { grid-template-columns: 0px 1fr 0px !important; }
  .pI_x6G_centerCol { grid-column: 2 !important; }
  .pI_x6G_sidebarCol { display: none !important; }
  .pI_x6G_detailsCol { display: none !important; }
  .pI_x6G_handle { display: none !important; }
  html.remfs-sidebar-open .pI_x6G_sidebarCol { display: flex !important; position: fixed; left: 0; top: 0; bottom: 0; z-index: 105; box-shadow: 4px 0 20px rgba(0,0,0,.35); }
  .remfs-sbar{display:flex}
}
`

    const join = (dir, name) => (dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + '\\' + name)
    const normPath = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()

    const fmtSize = (n) => {
      if (n === undefined || n === null) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    const ext = (name) => {
      const i = name.lastIndexOf('.')
      return i < 0 ? '' : name.slice(i + 1).toLowerCase()
    }

    const mimeOf = (name) => {
      const m = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
      return m[ext(name)] || 'application/octet-stream'
    }

    const SYSTEM_DIRS = new Set(['system volume information', '$recycle.bin', 'recovery', 'config.msi', '$sysreset', 'windows', 'perflogs', 'msocache', 'windows.old', '$winreagent'])

    const friendlyErr = (msg) => {
      const s = String(msg || '')
      if (/denied|EACCES|EPERM/i.test(s)) return { lock: true, text: '🔒 无权限访问(系统保护目录或其他用户的文件夹)' }
      if (/allowed|范围|outside/i.test(s)) return { lock: true, text: '该路径不在可访问目录内' }
      return { lock: false, text: s }
    }

    function Workbench({ embedded, onClose, conn }) {
      const [tab, setTab] = React.useState('session')
      const [path, setPath] = React.useState('')
      const [parent, setParent] = React.useState(null)
      const [allowed, setAllowed] = React.useState([])
      const [wsList, setWsList] = React.useState([])
      const [entries, setEntries] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [editText, setEditText] = React.useState('')
      const [inputPath, setInputPath] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [hideSystem, setHideSystem] = React.useState(true)
      const [managing, setManaging] = React.useState(false)
      const [manageText, setManageText] = React.useState('')
      const [moreOpen, setMoreOpen] = React.useState(false)

      const rpc = (method, payload) => conn.rpc.call('/remfs', method, payload)

      const load = (p, fallback) => {
        setLoading(true); setError(null); setPreview(null); setEditing(null)
        rpc('list', { path: p }).then((r) => {
          setLoading(false)
          if (r && r.ok) {
            const d = (r && r.value) || {}
            setPath(d.path || '')
            setParent(d.parent || null)
            setEntries(d.entries || [])
            setInputPath(d.path || '')
          } else {
            const fe = friendlyErr((r && r.error && r.error.message) || 'load failed')
            if (fe.lock && fallback) { load(fallback, null) }
            else setError(fe)
          }
        }).catch((e) => { setLoading(false); setError(friendlyErr(String(e))) })
      }

      const refresh = (target) => {
        rpc('allowed', {}).then((r) => {
          const d = (r && r.value) || {}
          if (r && r.ok && Array.isArray(d.allowed) && d.allowed.length > 0) {
            setAllowed(d.allowed)
            load(target || d.allowed[0], null)
          }
        }).catch(() => {})
        rpc('workspaces', {}).then((r) => {
          if (r && r.ok) setWsList((r.value && r.value.workspaces) || [])
        }).catch(() => {})
      }

      React.useEffect(() => { refresh(null) }, [])

      const openFile = (name) => {
        setPreview(null); setError(null)
        rpc('read', { path: join(path, name) }).then((r) => {
          if (r && r.ok) setPreview(Object.assign({ name }, (r && r.value) || {}))
          else setError(friendlyErr((r && r.error && r.error.message) || 'read failed'))
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const saveEdit = () => {
        if (!editing) return
        rpc('write', { path: editing.path, content: editText }).then((r) => {
          if (r && r.ok) {
            setEditing(null); setPreview(null); load(path)
            showToast('✅ 已保存: ' + editing.name, 'success')
          } else setError(friendlyErr((r && r.error && r.error.message) || 'save failed'))
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const upload = (file) => {
        if (!file) return
        file.text().then((text) => {
          rpc('write', { path: join(path, file.name), content: text }).then((r) => {
            if (r && r.ok) { load(path); showToast('✅ 已上传: ' + file.name, 'success') }
            else setError(friendlyErr((r && r.error && r.error.message) || 'upload failed'))
          }).catch((e) => setError(friendlyErr(String(e))))
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const download = () => {
        if (!preview) return
        const a = document.createElement('a')
        if (preview.kind === 'text') {
          a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(preview.text)
        } else if (preview.kind === 'base64') {
          a.href = 'data:' + mimeOf(preview.name) + ';base64,' + preview.base64
        } else return
        a.download = preview.name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }

      const startSessionHere = () => {
        if (!path || busy) return
        setBusy(true); setError(null)
        rpc('ensureWorkspace', { path }).then((r) => {
          if (r && r.ok && r.value && r.value.workspaceId) {
            return ctxWorkspaces.connectWorkspace(r.value.workspaceId).then(() => {
              showToast('✅ 已在此文件夹开始新会话', 'success')
              if (onClose) onClose()
            }).catch((e2) => {
              const fe = friendlyErr(String(e2))
              setError(fe)
              showToast('❌ ' + fe.text, 'error')
            })
          }
          const fe = friendlyErr((r && r.error && r.error.message) || 'failed')
          setError(fe)
          showToast('❌ ' + fe.text, 'error')
        }).catch((e) => {
          const fe = friendlyErr(String(e))
          setError(fe)
          showToast('❌ ' + fe.text, 'error')
        }).then(() => setBusy(false))
      }

      const openWorkspace = (id) => {
        if (busy) return
        setBusy(true)
        Promise.resolve(ctxWorkspaces.connectWorkspace(id)).then(() => {
          showToast('✅ 已打开工作区并开始新会话', 'success')
          if (onClose) onClose()
        }).catch((e) => {
          showToast('❌ ' + String((e && e.message) || e), 'error')
        }).then(() => setBusy(false))
      }

      const saveAllowed = () => {
        const roots = manageText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        rpc('setAllowed', { roots }).then((r) => {
          if (r && r.ok) {
            setManaging(false)
            showToast('✅ 可访问目录已保存(' + roots.length + ' 个)', 'success')
            refresh(null)
          } else {
            setError(friendlyErr((r && r.error && r.error.message) || 'save failed'))
            showToast('❌ 保存失败', 'error')
          }
        }).catch((e) => {
          setError(friendlyErr(String(e)))
          showToast('❌ 保存失败', 'error')
        })
      }

      const sorted = [...entries].sort((a, b) => {
        const ad = a.type === 'directory' ? 0 : 1
        const bd = b.type === 'directory' ? 0 : 1
        if (ad !== bd) return ad - bd
        return a.name.localeCompare(b.name)
      }).filter((e) => !hideSystem || !SYSTEM_DIRS.has(e.name.toLowerCase()))

      const wsPaths = new Set(wsList.map((w) => normPath(w.path)))
      const currentIsWs = path ? wsPaths.has(normPath(path)) : false

      const isImage = preview && preview.kind === 'base64' && /^(png|jpe?g|webp|gif)$/.test(ext(preview.name))

      const segs = path ? path.split(/[\\/]+/).filter(Boolean) : []
      let acc = ''
      const crumbs = segs.map((seg, i) => {
        acc = i === 0 ? seg : acc + '\\' + seg
        const last = i === segs.length - 1
        return React.createElement('button', { key: i, className: 'remfs-chip' + (last ? ' cur' : ''), onClick: () => { if (!last) load(acc) } }, seg)
      })

      const navBar = React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-crumb' },
          React.createElement('button', { className: 'remfs-btn', disabled: !parent, onClick: () => parent && load(parent) }, '↑'),
          crumbs
        ),
        React.createElement('div', { className: 'remfs-path' },
          React.createElement('input', { value: inputPath, onChange: (e) => setInputPath(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load(inputPath) }, placeholder: '绝对路径' }),
          React.createElement('button', { className: 'remfs-btn primary', onClick: () => load(inputPath) }, 'Go')
        )
      )

      const listRows = React.createElement('div', { className: 'remfs-list' },
        loading ? React.createElement('div', { className: 'remfs-row' }, '加载中…') :
        sorted.map((e) => {
          const isDir = e.type === 'directory'
          const click = () => {
            if (isDir) load(join(path, e.name))
            else if (tab === 'files') openFile(e.name)
            else { setTab('files'); openFile(e.name) }
          }
          const dim = !isDir && tab !== 'files'
          const isWs = isDir && wsPaths.has(normPath(join(path, e.name)))
          return React.createElement('div', { key: e.name, className: 'remfs-row' + (dim ? ' file-dim' : ''), onClick: click },
            React.createElement('span', null, isDir ? '📁' : '📄'),
            React.createElement('span', { className: 'n' }, e.name),
            isWs ? React.createElement('span', { className: 'remfs-wsbadge' }, '★ 工作区') : null,
            React.createElement('span', { className: 's' }, fmtSize(e.size))
          )
        })
      )

      const rootsRow = (withTools) => React.createElement('div', { className: 'remfs-roots' },
        allowed.map((r) => React.createElement('button', { key: r, className: 'remfs-chip', onClick: () => load(r) }, r)),
        withTools ? React.createElement('button', { className: 'remfs-manage', onClick: () => setMoreOpen(!moreOpen) }, '⋯') : null
      )

      const moreMenu = moreOpen ? React.createElement('div', { className: 'remfs-moremenu' },
        React.createElement('label', { className: 'remfs-hidebox', title: '隐藏系统保护目录' },
          React.createElement('input', { type: 'checkbox', checked: hideSystem, onChange: (e) => setHideSystem(e.target.checked) }),
          '隐藏系统目录'
        ),
        React.createElement('button', { className: 'remfs-manage', onClick: () => { setMoreOpen(false); setManaging(true); setManageText(allowed.join('\n')) } }, '⚙ 管理可访问目录')
      ) : null

      const errLine = error ? React.createElement('div', { className: 'remfs-err' + (error.lock ? ' lock' : '') }, error.text) : null

      const sessionBody = React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-wssec' },
          React.createElement('span', { className: 'lbl' }, '已有工作区(点击直接开新会话)'),
          React.createElement('div', { className: 'remfs-wschips' },
            wsList.length === 0 ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#999)' } }, '暂无,可从下方目录新建') :
            wsList.map((w) => React.createElement('button', { key: w.id, className: 'remfs-wschip', onClick: () => openWorkspace(w.id) },
              React.createElement('span', { className: 't' }, w.title || w.path),
              React.createElement('span', { className: 'pt' }, w.path)
            ))
          )
        ),
        React.createElement('div', { className: 'remfs-wssec' },
          React.createElement('span', { className: 'lbl' }, '或选择文件夹作为新工作区'),
          rootsRow(false)
        ),
        navBar,
        errLine,
        listRows,
        React.createElement('div', { className: 'remfs-go' },
          React.createElement('button', { className: 'remfs-wsbtn', disabled: !path || loading || busy, onClick: startSessionHere }, busy ? '处理中…' : (currentIsWs ? '🚀 在此继续会话' : '🚀 在这里开始会话'))
        )
      )

      const filesBody = React.createElement(React.Fragment, null,
        rootsRow(true),
        moreMenu,
        navBar,
        errLine,
        listRows,
        editing ? React.createElement('div', { className: 'remfs-prev' },
          React.createElement('div', null, '编辑: ' + editing.name),
          React.createElement('textarea', { value: editText, onChange: (e) => setEditText(e.target.value), style: { minHeight: 140, fontFamily: 'monospace', fontSize: 12, width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,.2)', color: 'inherit', border: '1px solid rgba(128,128,128,.3)', borderRadius: 6 } }),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: saveEdit }, '💾 保存'),
            React.createElement('button', { className: 'remfs-btn', onClick: () => { setEditing(null); setPreview(null) } }, '取消')
          )
        ) :
        preview ? React.createElement('div', { className: 'remfs-prev' },
          React.createElement('div', null,
            React.createElement('b', null, preview.name),
            '  ',
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)' } }, fmtSize(preview.size))
          ),
          preview.kind === 'text' ? React.createElement('pre', null, preview.text) :
          preview.kind === 'base64' && isImage ? React.createElement('img', { src: 'data:' + mimeOf(preview.name) + ';base64,' + preview.base64, alt: preview.name }) :
          preview.kind === 'too-large' ? React.createElement('div', null, '文件超过 5MB,暂不支持预览/下载') :
          React.createElement('div', null, '二进制文件,点击下载查看'),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: download }, '⬇ 下载'),
            preview.kind === 'text' ? React.createElement('button', { className: 'remfs-btn', onClick: () => { setEditing({ path: join(path, preview.name), name: preview.name }); setEditText(preview.text) } }, '✎ 编辑') : null
          )
        ) : null,
        React.createElement('div', { className: 'remfs-prev', style: { borderTop: 'none', paddingTop: 0, maxHeight: 'none' } },
          React.createElement('label', { className: 'remfs-btn remfs-upload' },
            '⬆ 上传文本文件到当前目录',
            React.createElement('input', { type: 'file', accept: '.txt,.md,.json,.js,.ts,.tsx,.py,.html,.css,.yaml,.yml,.csv,.log,.xml,.sh,.ps1,.ini,.env', style: { display: 'none' }, onChange: (e) => { if (e.target.files && e.target.files[0]) upload(e.target.files[0]); e.target.value = '' } })
          )
        )
      )

      return React.createElement('div', { className: embedded ? 'remfs-block' : 'remfs-panel' },
        React.createElement('div', { className: 'remfs-head' },
          React.createElement('b', null, tab === 'session' ? '新建会话' : '文件浏览'),
          React.createElement('span', { className: 'p' }, path || '…'),
          currentIsWs ? React.createElement('span', { className: 'remfs-wsbadge' }, '★ 工作区') : null,
          React.createElement('button', { className: 'remfs-btn remfs-close', onClick: onClose }, '✕ 关闭')
        ),
        React.createElement('div', { className: 'remfs-tabs' },
          React.createElement('button', { className: 'remfs-tab' + (tab === 'session' ? ' on' : ''), onClick: () => setTab('session') }, '＋ 新建会话'),
          React.createElement('button', { className: 'remfs-tab' + (tab === 'files' ? ' on' : ''), onClick: () => setTab('files') }, '📁 文件浏览')
        ),
        managing ? React.createElement('div', { className: 'remfs-manager' },
          React.createElement('div', null, '可访问目录(每行一个,手机端只能浏览这些目录):'),
          React.createElement('textarea', { value: manageText, onChange: (e) => setManageText(e.target.value), placeholder: 'C:\\Users\\zeta\\Documents\nD:\\素材' }),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: saveAllowed }, '💾 保存'),
            React.createElement('button', { className: 'remfs-btn', onClick: () => setManaging(false) }, '取消')
          )
        ) :
        React.createElement('div', { className: 'remfs-body' }, tab === 'session' ? sessionBody : filesBody)
      )
    }

    let open = false
    const listeners = new Set()
    let ctxWorkspaces = null

    const setOpen = (v) => { open = v; listeners.forEach((fn) => fn()) }
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

    function HeaderToggle() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return React.createElement('button', { className: 'remfs-hbtn' + (open ? ' open' : ''), title: open ? '关闭' : '新建会话 / 文件浏览', onClick: () => setOpen(!open) }, open ? '✕ 关闭' : '＋ 新会话')
    }

    function OverlayBridge({ conn }) {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      if (!open) return null
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-backdrop', onClick: () => setOpen(false) }),
        React.createElement(Workbench, { embedded: false, onClose: () => setOpen(false), conn })
      )
    }

    let toastEl = null
    let toastDisposer = null
    function showToast(text, kind) {
      if (!toastEl) return
      toastEl.textContent = text
      toastEl.className = 'remfs-toast remfs-toast-show' + (kind === 'error' ? ' remfs-toast-error' : kind === 'success' ? ' remfs-toast-success' : '')
      if (toastDisposer) { try { toastDisposer() } catch { /* ignore */ } }
      if (window.__remfsTimer && typeof window.__remfsTimer.timeout === 'function') {
        toastDisposer = window.__remfsTimer.timeout(() => {
          if (toastEl) toastEl.className = 'remfs-toast'
        }, 2600)
      } else {
        window.setTimeout(() => {
          if (toastEl) toastEl.className = 'remfs-toast'
        }, 2600)
      }
    }

    const apply = (ctx) => {
      ctxWorkspaces = ctx.get('workspaces') || null
      const conn = ctx.get('connection')
      if (conn === undefined) return
      const timer = ctx.get('timer')
      window.__remfsTimer = timer

      ctx.effect(() => {
        const st = document.createElement('style')
        st.textContent = CSS
        document.head.appendChild(st)
        return () => st.remove()
      })

      ctx.effect(() => {
        toastEl = document.createElement('div')
        toastEl.className = 'remfs-toast'
        document.body.appendChild(toastEl)
        return () => {
          if (toastEl) { toastEl.remove(); toastEl = null }
          if (toastDisposer) { try { toastDisposer() } catch { /* ignore */ } ; toastDisposer = null }
        }
      })

      ctx.effect(() => {
        const btn = document.createElement('button')
        btn.className = 'remfs-sbar'
        btn.textContent = '☰'
        btn.title = '展开侧边栏'
        let sbOpen = false
        let dragging = false
        let moved = false
        let sx = 0, sy = 0, ox = 0, oy = 0
        const applyState = () => {
          btn.textContent = sbOpen ? '✕' : '☰'
          btn.title = sbOpen ? '收起侧边栏' : '展开侧边栏'
          if (sbOpen) document.documentElement.classList.add('remfs-sidebar-open')
          else document.documentElement.classList.remove('remfs-sidebar-open')
        }
        const onDown = (e) => {
          dragging = true
          moved = false
          sx = e.clientX; sy = e.clientY
          const r = btn.getBoundingClientRect()
          ox = r.left; oy = r.top
          try { btn.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          e.preventDefault()
        }
        const onMove = (e) => {
          if (!dragging) return
          const dx = e.clientX - sx, dy = e.clientY - sy
          if (Math.abs(dx) + Math.abs(dy) > 6) moved = true
          if (moved) {
            const bw = btn.offsetWidth, bh = btn.offsetHeight
            const nx = Math.max(4, Math.min(window.innerWidth - bw - 4, ox + dx))
            const ny = Math.max(4, Math.min(window.innerHeight - bh - 4, oy + dy))
            btn.style.left = nx + 'px'
            btn.style.top = ny + 'px'
            btn.style.right = 'auto'
            btn.style.bottom = 'auto'
          }
        }
        const onUp = () => {
          dragging = false
          if (!moved) { sbOpen = !sbOpen; applyState() }
        }
        btn.addEventListener('pointerdown', onDown)
        btn.addEventListener('pointermove', onMove)
        btn.addEventListener('pointerup', onUp)
        btn.addEventListener('click', (e) => { if (moved) e.preventDefault() })
        document.body.appendChild(btn)
        return () => {
          btn.remove()
          document.documentElement.classList.remove('remfs-sidebar-open')
        }
      })

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'remfs.header', order: 20, label: '新会话' },
        () => React.createElement(HeaderToggle, null)
      ))

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'remfs.page', order: 60, label: '＋ 新会话 / 文件浏览' },
        (props) => React.createElement(Workbench, { embedded: true, conn, onClose: props && typeof props.close === 'function' ? props.close : null })
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'remfs.panel' },
        () => React.createElement(OverlayBridge, { conn })
      ))
    }

    const inject = ['slots', 'connection', 'workspaces']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
