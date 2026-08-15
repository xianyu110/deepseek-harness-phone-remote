// Diagnostic: dump what the harness page shows in headless Edge.
"use strict";
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9228;
const APP = 'http://127.0.0.1:3080/';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-cdp-profile-diag');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok) return; } catch { /* */ }
    await sleep(500);
  }
  throw new Error('endpoint not up');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => {
      const call = (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id);
          msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
        } else if (msg.method) {
          events.push(msg.method + ': ' + JSON.stringify(msg.params).slice(0, 300));
        }
      });
      resolve({ ws, call, events });
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}

async function evalJs(call, expr) {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result && r.result.value;
}

async function main() {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'
  ], { stdio: 'ignore' });
  try {
    await waitForEndpoint('http://127.0.0.1:' + PORT + '/json/version');
    let res = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
    const target = await res.json();
    const { ws, call, events } = await connect(target.webSocketDebuggerUrl);
    await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: APP });
    await sleep(10000);

    const diag = await evalJs(call, `(function(){
      var out = { title: document.title, boot: !!window.__DSH_BOOT__,
        bootHasPlugin: !!(window.__DSH_BOOT__ && JSON.stringify(window.__DSH_BOOT__).indexOf('remfs-persistent') >= 0),
        remfsTimer: !!window.__remfsTimer,
        remfsHbtn: document.querySelectorAll('.remfs-hbtn').length,
        remfsPanel: document.querySelectorAll('.remfs-panel, .remfs-block').length,
        bodyText: (document.body.innerText || '').slice(0, 400),
        buttons: Array.prototype.slice.call(document.querySelectorAll('button')).slice(0, 20).map(function(b){ return (b.innerText||'').trim().slice(0,20) }),
        frame: document.querySelectorAll('[class*="frame"]').length,
        iframeCount: document.querySelectorAll('iframe').length
      };
      return out;
    })()`);
    console.log('DIAG:', JSON.stringify(diag, null, 2));
    console.log('EVENTS (last 12):');
    events.slice(-12).forEach((e) => console.log('  ' + e));

    const r = await call('Page.captureScreenshot', { format: 'png' });
    const file = path.join(process.cwd(), 'diag-page.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('saved ' + file + ' (' + fs.statSync(file).size + ' bytes)');
    ws.close();
  } finally {
    try { edge.kill(); } catch { /* */ }
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
