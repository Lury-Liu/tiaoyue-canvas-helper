// CDP 库：单进程内连续操作，避免反复 attach 造成的挂起
import fs from 'node:fs';
import path from 'node:path';

const PORT_FILE = path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/User Data/DevToolsActivePort');
const [portLine, wsPath] = fs.readFileSync(PORT_FILE, 'utf8').trim().split('\n');
const PORT = Number(process.env.CDP_PORT || portLine);
const BROWSER_WS = `ws://127.0.0.1:${PORT}${process.env.CDP_WS || wsPath}`;

let idc = 0;
const pending = new Map();
let ws;

export async function connect() {
  ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(BROWSER_WS);
    s.onopen = () => resolve(s);
    s.onerror = (e) => reject(new Error('ws error'));
    s.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
  return ws;
}

export function send(method, params = {}, sessionId) {
  const id = ++idc;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout: ' + method)); }, 20000);
  });
}

export async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

export async function ev(sessionId, expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '').slice(0, 400));
  return r.result.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在当前焦点元素插入文本（原生输入事件，React 可感知）
export async function insertText(sessionId, text) {
  return send('Input.insertText', { text }, sessionId);
}

export async function clickAt(sessionId, x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
}

export async function key(sessionId, keyName, code, keyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode }, sessionId);
}

export function close() { try { ws.close(); } catch {} }

// 页面侧工具函数（注入到页面上下文复用）
export const PAGE_HELPERS = `
window.__TY = {
  root: () => document.querySelector('wujie-app')?.shadowRoot,
  editors: () => [...(window.__TY.root()?.querySelectorAll('[class*="_promptEditor_"]') || [])],
  activeEditor: () => {
    const all = window.__TY.editors();
    const ae = window.__TY.root()?.activeElement;
    return all.find(e => e === ae || e.contains(ae)) || all[0] || null;
  },
  chips: () => [...(window.__TY.root()?.querySelectorAll('.canvas-mention') || [])],
  nodes: () => [...(window.__TY.root()?.querySelectorAll('.canvas-node-container') || [])],
  names: () => window.__TY.nodes().map(n => (n.innerText || '').trim().split('\\n')[0]),
};
'ok'
`;
