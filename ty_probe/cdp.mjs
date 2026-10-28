// 极简 CDP 客户端：直连 Edge 的 browser WebSocket（该版本不暴露 /json/* 端点）
// 用法:
//   node cdp.mjs list
//   node cdp.mjs new  <url>
//   node cdp.mjs eval <targetId> <文件路径>
//   node cdp.mjs shot <targetId> <输出png>
//   node cdp.mjs close <targetId>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT_FILE = path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/User Data/DevToolsActivePort');
const [portLine, wsPath] = fs.readFileSync(PORT_FILE, 'utf8').trim().split('\n');
const PORT = Number(process.env.CDP_PORT || portLine);
const BROWSER_WS = `ws://127.0.0.1:${PORT}${process.env.CDP_WS || wsPath}`;

let idc = 0;
const pending = new Map();

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error: ' + (e.message || 'unknown')));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

function send(ws, method, params = {}, sessionId) {
  const id = ++idc;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`timeout: ${method}`)); }, 60000);
  });
}

const [, , cmd, ...rest] = process.argv;
const ws = await connect(BROWSER_WS);

async function evalIn(targetId, expression) {
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const r = await send(ws, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sessionId);
  await send(ws, 'Target.detachFromTarget', { sessionId }).catch(() => {});
  if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
}

if (cmd === 'list') {
  const { targetInfos } = await send(ws, 'Target.getTargets');
  for (const t of targetInfos.filter(t => t.type === 'page')) {
    console.log(`${t.targetId}\t${t.title}\t${t.url.slice(0, 120)}`);
  }
} else if (cmd === 'new') {
  const { targetId } = await send(ws, 'Target.createTarget', { url: rest[0], background: true });
  await new Promise(r => setTimeout(r, 2500));
  console.log(targetId);
} else if (cmd === 'eval') {
  const [targetId, file] = rest;
  const expr = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : file;
  const v = await evalIn(targetId, expr);
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
} else if (cmd === 'call') {
  // node cdp.mjs call <targetId> <Method> '<jsonParams>'
  const [targetId, method, rawParams] = rest;
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const res = await send(ws, method, rawParams ? JSON.parse(rawParams) : {}, sessionId);
  console.log(JSON.stringify(res).slice(0, 2000));
} else if (cmd === 'nav') {
  const [targetId, url] = rest;
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await send(ws, 'Page.enable', {}, sessionId);
  await send(ws, 'Page.navigate', { url }, sessionId);
  await new Promise(r => setTimeout(r, 4000));
  console.log(await send(ws, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId).then(r => r.result.value));
} else if (cmd === 'shot') {
  const [targetId, out] = rest;
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await send(ws, 'Page.enable', {}, sessionId);
  await send(ws, 'Page.bringToFront', {}, sessionId).catch(() => {});
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved', out);
} else if (cmd === 'close') {
  await send(ws, 'Target.closeTarget', { targetId: rest[0] });
  console.log('closed');
}
ws.close();
