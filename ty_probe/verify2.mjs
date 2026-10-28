import fs from 'node:fs';
const PORT = 9366;
const SRC = fs.readFileSync('../tiaoyue-ref-helper.user.js', 'utf8');
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, 8000); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '').slice(0, 200)); return r.result.value; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const clickSel = async (sel, idx = 0) => {
  await ev(`(()=>{const e=document.querySelectorAll('${sel}')[${idx}];if(e)e.scrollIntoView({block:'center'});return 1})()`);
  await sleep(150);
  const p = await ev(`(()=>{const e=document.querySelectorAll('${sel}')[${idx}];if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`);
  if (!p) return false;
  const [x, y] = JSON.parse(p); await mouse(x, y); return true;
};
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail); };

const boot = async () => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/fake2.html' });
  await sleep(900);
  await ev(`localStorage.setItem('tyq.guide.v1','true');localStorage.removeItem('tyq.tab.v1');'ok'`);
  await ev(SRC + '\n"ok"');
  await sleep(1600);
};

// ---------- D 用户报告的原路径：光标6 → 点搜索框输入 → 点素材 ----------
await boot();
await ev('localStorage.removeItem("tyq.panel.pos.v1"); __fake.reset(); __fake.setCaret(6); __TYQ.open("asset"); 1');
await sleep(400);
await clickSel('.tyq-input');
await send('Input.insertText', { text: '巴迪' });
await sleep(300);
const dRows = await ev('document.querySelectorAll(".tyq-item").length');
await clickSel('.tyq-item');
await sleep(300);
await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
await sleep(600);
const dText = await ev('__TYQ.serialize(__fake.ed)');
check('D 搜索后仍插在光标处', dText.startsWith('前缀 艾洛文@图片2-') && dRows === 1, `rows=${dRows} text="${dText.slice(0, 26)}"`);

// ---------- E 面板位置跨刷新保留 ----------
await ev('__TYQ.open("asset"); 1');
await sleep(400);
const hp = JSON.parse(await ev('(()=>{const r=document.querySelector(".tyq-head").getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()'));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp[0], y: hp[1], button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hp[0], y: hp[1], button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 4; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp[0] - i * 40, y: hp[1] + i * 20, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hp[0] - 160, y: hp[1] + 80, button: 'left', buttons: 0, clickCount: 1 });
await sleep(400);
const p1 = await ev('(()=>{const r=document.querySelector(".tyq-panel").getBoundingClientRect();return JSON.stringify([Math.round(r.left),Math.round(r.top)])})()');
await boot();
await ev('__TYQ.open("asset"); 1');
await sleep(500);
const p2 = await ev('(()=>{const r=document.querySelector(".tyq-panel").getBoundingClientRect();return JSON.stringify([Math.round(r.left),Math.round(r.top)])})()');
const e1 = JSON.parse(p1), e2 = JSON.parse(p2);
check('E 面板位置记忆', Math.abs(e1[0] - e2[0]) <= 2 && Math.abs(e1[1] - e2[1]) <= 40 && !!p1, `${p1} → ${p2}（右侧下拉内容变高时允许纵向夹紧）`);

// ---------- F 一键转换 + 历史 ----------
await ev('__fake.reset(); __TYQ.open("asset"); 1');
await sleep(500);
await clickSel('.tyq-btn.primary');
await sleep(700);
const fText = await ev('__TYQ.serialize(__fake.ed)');
const fHist = await ev('__TYQ.HIST.list.map(h=>h.label).join(" / ")');
check('F 一键转换', fText.includes('@图片1') && fText.includes('@图片2') && /转引用/.test(fHist), `text="${fText.slice(0, 30)}" hist=${fHist}`);

// ---------- G Ctrl+F 仍可用 ----------
await ev('__TYQ.close(); __fake.setCaret(3); 1');
await sleep(150);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 });
await sleep(500);
const gTab = await ev('document.querySelector(".tyq-tab.on")?.dataset.tab');
const gOpen = await ev('document.querySelector(".tyq-panel").classList.contains("open")');
check('G Ctrl+F 打开查找', gTab === 'find' && gOpen, `tab=${gTab} open=${gOpen}`);

const pass = results.filter(r => r.pass).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
process.exit(pass === results.length ? 0 : 1);
