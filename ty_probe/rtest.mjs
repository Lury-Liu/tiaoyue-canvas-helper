import fs from 'node:fs';

const PORT = 9333;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + method)); } }, 8000);
});
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
await new Promise(r => ws.onopen = r);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mouse = async (x, y, cc = 1) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: cc });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: cc });
};
const rect = async (sel) => JSON.parse(await ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`));
const ballRect = () => ev(`(()=>{const b=document.getElementById('ball').getBoundingClientRect();return JSON.stringify([Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)])})()`).then(JSON.parse);

await send('Page.enable');
await send('Page.navigate', { url: 'file:///C:/Users/MECHREVO/WorkBuddy/2026-10-25-17-08-10/ty_probe/replica.html' });
await sleep(1200);
console.log('title:', await ev('document.title'), '| editor:', await ev("!!window.__t"));

// ---------- 场景 A：先点光标 → 点悬浮球开面板 → 点素材 ----------
await ev('__t.reset(); __t.setCaret(6)');
console.log('A0 设置光标后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo()})')));
const [bx, by] = await ballRect();
await mouse(bx, by);
await sleep(300);
console.log('A1 点球后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo(), open:document.getElementById("panel").classList.contains("open")})')));
const [ix, iy] = await rect('.item');
await mouse(ix, iy);
await sleep(300);
console.log('A2 插入结果:', JSON.stringify(await ev('window.__lastInsert')));

// ---------- 场景 B：光标 → Alt+A 开面板 → 点搜索框并输入 → 点素材 ----------
await ev('__t.reset(); __t.close(); __t.setCaret(6)');
await sleep(150);
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 1 });
}
await sleep(250);
console.log('B1 Alt+A 后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo(), open:document.getElementById("panel").classList.contains("open")})')));
const [sx, sy] = await rect('#search');
await mouse(sx, sy);
await sleep(150);
await send('Input.insertText', { text: '艾洛' });
await sleep(250);
console.log('B2 输入搜索后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo(), search:document.getElementById("search").value})')));
const [ix2, iy2] = await rect('.item');
await mouse(ix2, iy2);
await sleep(300);
console.log('B3 插入结果:', JSON.stringify(await ev('window.__lastInsert')));

// ---------- 场景 C：点球开面板 → 再点搜索框输入 → 点素材 ----------
await ev('__t.reset(); __t.close(); __t.setCaret(6)');
const [bx2, by2] = await ballRect();
await mouse(bx2, by2);
await sleep(250);
const [sx2, sy2] = await rect('#search');
await mouse(sx2, sy2);
await send('Input.insertText', { text: '艾洛' });
await sleep(200);
const [ix3, iy3] = await rect('.item');
await mouse(ix3, iy3);
await sleep(300);
console.log('C  全部点完:', JSON.stringify(await ev('window.__lastInsert')));

process.exit(0);
