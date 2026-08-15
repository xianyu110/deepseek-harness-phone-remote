// Capture remfs workbench screenshots via CDP (headless Edge).
// Path A: click "新会话" -> conversation header -> .remfs-hbtn -> workbench panel.
// Path B (fallback): click "设置" -> embedded workbench in settings section.
"use strict";
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.argv[2] || 'screenshots';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9229;
const APP = 'http://127.0.0.1:3080/';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-cdp-profile2');

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
        }
      });
      resolve({ ws, call });
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}

async function evalJs(call, expr) {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r && r.result ? r.result.value : undefined;
}

async function clickText(call, text, idx = 0) {
  return evalJs(call, `(function(){
    var els = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], a, [class*=item]'));
    var hits = els.filter(function(e){ return (e.innerText||'').trim() === ${JSON.stringify(text)} || (e.innerText||'').trim().indexOf(${JSON.stringify(text)}) === 0; });
    if (hits[idx]) { hits[idx].click(); return true; }
    return false;
  })()`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'
  ], { stdio: 'ignore' });

  try {
    await waitForEndpoint('http://127.0.0.1:' + PORT + '/json/version');
    let res = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
    const target = await res.json();
    const { ws, call } = await connect(target.webSocketDebuggerUrl);
    await call('Page.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: APP });
    await sleep(8000);

    const shot = async (name) => {
      await sleep(1400);
      const r = await call('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('saved ' + name + ' (' + fs.statSync(file).size + ' bytes)');
    };

    let mode = 'none';

    // Path A: open a conversation via 新会话
    const clicked = await clickText(call, '新会话');
    console.log('clicked 新会话:', clicked);
    await sleep(4000);
    const hbtn = await evalJs(call, "document.querySelectorAll('.remfs-hbtn').length");
    console.log('remfs-hbtn count after new session:', hbtn);
    if (hbtn > 0) {
      mode = 'header';
      await shot('01-conversation-header.png');
      await evalJs(call, "document.querySelector('.remfs-hbtn').click()");
      await shot('02-workbench-session.png');
      await evalJs(call, "var t=document.querySelectorAll('.remfs-tab'); if(t.length>1) t[1].click()");
      await shot('03-workbench-files.png');
      await call('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.75, mobile: true });
      await shot('04-workbench-files-mobile.png');
    }

    if (mode === 'none') {
      // Path B: settings embedded workbench
      console.log('fallback: opening settings');
      await clickText(call, '设置');
      await sleep(4000);
      const block = await evalJs(call, "document.querySelectorAll('.remfs-block').length");
      console.log('remfs-block count in settings:', block);
      if (block > 0) {
        await shot('01-settings-workbench.png');
        await evalJs(call, "var t=document.querySelectorAll('.remfs-block .remfs-tab'); if(t.length>1) t[1].click()");
        await shot('02-settings-workbench-files.png');
        await call('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.75, mobile: true });
        await shot('03-settings-workbench-mobile.png');
        mode = 'settings';
      }
    }

    if (mode === 'none') throw new Error('workbench not reachable (header nor settings)');
    ws.close();
  } finally {
    try { edge.kill(); } catch { /* */ }
  }
  console.log('DONE mode=' + mode);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
