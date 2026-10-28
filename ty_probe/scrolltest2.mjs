import fs from 'node:fs';
const PORT = 9333;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, 8000); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description).slice(0, 300)); return r.result.value; };
console.log(await ev(`(()=>{
  const f = __fake, sc = f.scroller, ed = f.ed;
  const txt = __TYQ.serialize(ed);
  const i4 = txt.indexOf('@图片4'), i2 = txt.indexOf('@图片2');
  return JSON.stringify({
    len: txt.length,
    sc: { sh: sc.scrollHeight, ch: sc.clientHeight, st: sc.scrollTop, ov: getComputedStyle(sc).overflowY },
    ed: { h: Math.round(ed.getBoundingClientRect().height), sh: ed.scrollHeight },
    i4, i2,
    lines: txt.split('\\n').length
  });
})()`));
console.log(await ev(`(()=>{
  const r = __TYQ.api().el;
  const txt = __TYQ.serialize(r);
  const i = txt.indexOf('@图片4');
  return JSON.stringify({ found: i, ctx: txt.slice(Math.max(0,i-8), i+10) });
})()`));
close();
process.exit(0);
