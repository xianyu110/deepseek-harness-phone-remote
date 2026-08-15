// Probe: robust text-click + eval diagnostics.
"use strict";
const { spawn } = require('node:child_process');
const path = require('node:path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9230;
const APP = 'http://127.0.0.1:3080/';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-cdp-profile3');
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

    const probe = await evalJs(call, `(function(){
      var out = { triv: 1 + 1 };
      var labels = [];
      var all = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], a, li, [class*=item]'));
      all.forEach(function(e){
        var tx = (e.innerText || '').trim();
        if (tx && tx.length < 30) labels.push(tx.slice(0, 24));
      });
      out.labels = labels.slice(0, 30);
      return out;
    })()`);
    console.log('probe result:', JSON.stringify(probe.result, null, 2));
    console.log('exceptionDetails:', JSON.stringify(probe.exceptionDetails || null));

    // robust click by text
    const click = await evalJs(call, `(function(){
      var found = null;
      var all = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], a, li, div, span'));
      for (var i = 0; i < all.length; i++) {
        var tx = (all[i].innerText || '').trim();
        if (tx === '新会话') { found = all[i]; break; }
        if (tx.indexOf('新会话') === 0 && tx.length <= 5) { found = all[i]; break; }
      }
      if (!found) return { ok: false };
      var target = found;
      while (target && target.tagName !== 'BUTTON' && !target.onclick && target.tagName !== 'A' && !target.getAttribute('role')) { target = target.parentElement; }
      var desc = { tag: target.tagName, cls: (target.className || '').toString().slice(0, 60), tx: (target.innerText || '').trim().slice(0, 20) };
      target.click();
      return { ok: true, desc: desc };
    })()`);
    console.log('click result:', JSON.stringify(click.result, null, 2));
    console.log('click exception:', JSON.stringify(click.exceptionDetails || null));

    await sleep(4500);
    const after = await evalJs(call, `(function(){
      return {
        hbtn: document.querySelectorAll('.remfs-hbtn').length,
        body: (document.body.innerText || '').slice(0, 200)
      };
    })()`);
    console.log('after click:', JSON.stringify(after.result, null, 2));
    ws.close();
  } finally { try { edge.kill(); } catch {} }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
