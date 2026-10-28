import fs from 'node:fs';
const PORT = 9366;
const SRC = fs.readFileSync('../tiaoyue-ref-helper.user.js', 'utf8');
await new Promise(r => setTimeout(r, 2000));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, 8000); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description).slice(0, 200)); return r.result.value; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await send('Page.navigate', { url: 'http://127.0.0.1:8765/fake3.html' });
await sleep(900);
await ev(`localStorage.setItem('tyq.guide.v1','true');localStorage.removeItem('tyq.tab.v1');'ok'`);
await ev(SRC + '\n"ok"');
await sleep(1700);

const out = [];
for (const tk of ['图片5', '图片3', '图片4', '图片2']) {
  await ev('__fake.reset(); 1');
  await sleep(150);
  await ev(`__TYQ.jumpToken('${tk}'); 1`);
  await sleep(500);
  const st = await ev('__fake.scrollTop()');
  const box = await ev('JSON.stringify(__fake.flashBox())');
  const b = JSON.parse(box);
  const inView = b ? (b.box[1] >= b.scroller[1] - 4 && b.box[1] + b.box[3] <= b.scroller[1] + b.scroller[3] + 4) : false;
  out.push({ token: tk, scrollTop: Math.round(st), boxTop: b ? b.box[1] : null, scrollerTop: b ? b.scroller[1] : null, boxInScroller: inView });
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
