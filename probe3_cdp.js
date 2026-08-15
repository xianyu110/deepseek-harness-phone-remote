// Probe 3: click a session item in the list, then check header button.
"use strict";
const { spawn } = require('node:child_process');
const path = require('node:path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9232;
const APP = 'http://127.0.0.1:3080/';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-cdp-profile5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(url, tries = 40) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(500); }
  throw new Error('endpoint not up');
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('open', () => {
      const call = (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id; pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
      ws.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
        if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
      });
      resolve({ ws, call });
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}
async function evalJs(call, expr) {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r;
}

async function main() {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });
  try {
    await waitForEndpoint('http://127.0.0.1:' + PORT + '/json/version');
    const res = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
    const target = await res.json();
    const { ws, call } = await connect(target.webSocketDebuggerUrl);
    await call('Page.enable'); await call('Runtime.enable');
    await call('Page.navigate', { url: APP });
    await sleep(9000);

    const before = await evalJs(call, `(function(){
      var out = { body: (document.body.innerText || '').slice(0, 250) };
      // session-like clickable items
      var cands = [];
      var all = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], [class*=session], [class*=Session], [class*=item]'));
      var seen = {};
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        var tx = (e.innerText || '').trim();
        if (tx && tx.length < 40 && !seen[tx]) { seen[tx] = 1; cands.push({ tag: e.tagName, cls: (e.className||'').toString().slice(0,40), tx: tx.slice(0, 30) }); }
      }
      out.cands = cands.slice(0, 25);
      return out;
    })()`);
    console.log('BEFORE:', JSON.stringify(before.result && before.result.value, null, 2));

    // click the first element whose text contains 助手 or 远程控制 (a session title)
    const clicked = await evalJs(call, `(function(){
      var all = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], [class*=session], [class*=Session], [class*=item], div, span'));
      for (var i = 0; i < all.length; i++) {
        var tx = (all[i].innerText || '').trim();
        if (tx.indexOf('助手') >= 0 || tx.indexOf('远程控制') >= 0) {
          var el = all[i];
          while (el && el.tagName !== 'BUTTON' && el.tagName !== 'A' && !(el.className || '').toString().match(/session|Session|item/) && el.parentElement) { el = el.parentElement; }
          var desc = { tag: el.tagName, cls: (el.className||'').toString().slice(0, 50) };
          el.click();
          return { ok: true, desc: desc };
        }
      }
      return { ok: false };
    })()`);
    console.log('CLICK:', JSON.stringify(clicked.result && clicked.result.value, null, 2));

    await sleep(5000);
    const after = await evalJs(call, `(function(){
      return { hbtn: document.querySelectorAll('.remfs-hbtn').length, body: (document.body.innerText || '').slice(0, 150) };
    })()`);
    console.log('AFTER:', JSON.stringify(after.result && after.result.value, null, 2));
    ws.close();
  } finally { try { edge.kill(); } catch {} }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
