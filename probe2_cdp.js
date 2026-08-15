// Probe 2: check module apply + slot render + settings entry.
"use strict";
const { spawn } = require('node:child_process');
const path = require('node:path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9231;
const APP = 'http://127.0.0.1:3080/';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-cdp-profile4');
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

    const r = await evalJs(call, `(function(){
      var out = {};
      out.remfsTimer = !!window.__remfsTimer;
      out.remfsHbtn = document.querySelectorAll('.remfs-hbtn').length;
      out.remfsSbar = document.querySelectorAll('.remfs-sbar').length;
      out.remfsAny = document.querySelectorAll('[class*=remfs]').length;
      // any element with text containing 设置 / gear
      var settingsHits = [];
      var all = Array.prototype.slice.call(document.querySelectorAll('*'));
      for (var i = 0; i < all.length && settingsHits.length < 5; i++) {
        var e = all[i];
        var tx = (e.innerText || '').trim();
        var al = (e.getAttribute && e.getAttribute('aria-label')) || '';
        var ti = (e.getAttribute && e.getAttribute('title')) || '';
        if (tx === '设置' || al === '设置' || ti === '设置' || (al && al.indexOf('设置') >= 0)) {
          settingsHits.push({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 50), tx: tx.slice(0, 12), al: al.slice(0, 12) });
        }
      }
      out.settingsHits = settingsHits;
      // header area: dump first 12 elements under any element with class containing 'header'
      var headers = Array.prototype.slice.call(document.querySelectorAll('[class*=header]')).slice(0, 3);
      out.headers = headers.map(function(h){ return { cls: (h.className||'').toString().slice(0,50), txt: (h.innerText||'').trim().slice(0,60) }; });
      return out;
    })()`);
    console.log('result:', JSON.stringify(r.result && r.result.value, null, 2));
    console.log('exception:', JSON.stringify(r.exceptionDetails || null));
    ws.close();
  } finally { try { edge.kill(); } catch {} }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
