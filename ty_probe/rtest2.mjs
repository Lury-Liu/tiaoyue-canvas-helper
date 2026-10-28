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
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const rc = async (sel) => JSON.parse(await ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`));

await send('Page.navigate', { url: 'file:///C:/Users/MECHREVO/WorkBuddy/2026-10-25-17-08-10/ty_probe/replica.html' });
await sleep(1000);

// D：光标放在最开头（offset 0）再插入
await ev('__t.reset(); __t.close(); __t.setCaret(0)');
console.log('D0 caret0:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo()})')));
const [ix, iy] = await rc('.item');
await mouse(ix, iy);
await sleep(200);
console.log('D1 插入:', JSON.stringify(await ev('window.__lastInsert')));

// E：光标在第 6 位 -> 点击页面空白（模拟焦点/选区丢失）-> 打开面板 -> 插入
await ev('__t.reset(); __t.close(); __t.setCaret(6)');
await mouse(80, 420);           // 点空白处
await sleep(200);
console.log('E1 点空白后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo()})')));
const [bx, by] = await rc('#ball');
await mouse(bx, by);
await sleep(250);
console.log('E2 打开面板后:', JSON.stringify(await ev('({saved:__t.saved, sel:__t.selInfo()})')));
const [ix2, iy2] = await rc('.item');
await mouse(ix2, iy2);
await sleep(200);
console.log('E3 插入:', JSON.stringify(await ev('window.__lastInsert')));
process.exit(0);
