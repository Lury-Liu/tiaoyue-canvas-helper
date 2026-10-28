import fs from 'node:fs';

const PORT = 9366;
const SRC = fs.readFileSync('../tiaoyue-ref-helper.user.js', 'utf8');
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, 8000);
});
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise(r => ws.onopen = r);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '').slice(0, 300));
  return r.result.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
const scrollTo = async (sel, idx = 0) => {
  await ev(`(()=>{const e=document.querySelectorAll('${sel}')[${idx}];if(!e)return 0;e.scrollIntoView({block:'center'});return 1})()`);
  await sleep(180);
};
const clickSel = async (sel, idx = 0) => {
  await scrollTo(sel, idx);
  const p = await ev(`(()=>{const e=document.querySelectorAll('${sel}')[${idx}];const r=e.getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`);
  if (!p) return null;
  const [x, y] = JSON.parse(p);
  await mouse(x, y);
  return [x, y];
};
const rc = async (sel) => {
  const s = await ev(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;const r=e.getBoundingClientRect();if(!r.width&&!r.height)return null;return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])})()`);
  return s ? JSON.parse(s) : null;
};
const load = async () => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/fake2.html' });
  await sleep(900);
  await ev(`localStorage.setItem('tyq.guide.v1','true');localStorage.removeItem('tyq.tab.v1');localStorage.removeItem('tyq.panel.pos.v1');'ok'`);
  const r = await ev(SRC + '\n"ok"');
  await sleep(1600);
  return r;
};
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail); };

await load();
check('注入', await ev('!!document.querySelector(".tyq-launch")'), 'launch=' + await ev('!!document.querySelector(".tyq-launch")'));

// ---------- 1-A 光标中间 -> 点空白 -> 点球 -> 插入 ----------
await ev('__fake.reset(); __fake.setCaret(6); document.querySelector(".tyq-panel")?.classList.remove("open"); 1');
await sleep(200);
const saved0 = await ev('__TYQ.savedCaret');
const blank = await rc('#blank');
await mouse(blank[0], blank[1]);
await sleep(200);
const saved1 = await ev('__TYQ.savedCaret');
const ball = await rc('.tyq-launch');
await mouse(ball[0], ball[1]);
await sleep(500);
const saved2 = await ev('__TYQ.savedCaret');
await clickSel('.tyq-item');
await sleep(300);
await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
await sleep(700);
const tA = await ev('__TYQ.serialize(__fake.ed)');
check('1-A 中间插入', tA.startsWith('前缀 艾洛文@图片1'), `saved ${saved0}→${saved1}→${saved2} | text="${tA.slice(0, 22)}"`);

// ---------- 1-B 光标在开头 ----------
await ev('__fake.reset(); __fake.setCaret(0); 1');
await sleep(200);
await ev('__TYQ.open("asset"); 1');
await sleep(400);
await clickSel('.tyq-item', 0);
await sleep(300);
await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
await sleep(700);
const tB = await ev('__TYQ.serialize(__fake.ed)');
check('1-B 开头插入', tB.startsWith('@图片1'), `text="${tB.slice(0, 20)}"`);

// ---------- 2 面板拖动 ----------
const panelBefore = await ev('(()=>{const r=document.querySelector(".tyq-panel").getBoundingClientRect();return JSON.stringify([Math.round(r.left),Math.round(r.top)])})()');
const head = await rc('.tyq-head');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head[0], y: head[1], button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: head[0], y: head[1], button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 5; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head[0] - i * 60, y: head[1] + i * 30, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: head[0] - 300, y: head[1] + 150, button: 'left', buttons: 0, clickCount: 1 });
await sleep(400);
const panelAfter = await ev('(()=>{const r=document.querySelector(".tyq-panel").getBoundingClientRect();return JSON.stringify([Math.round(r.left),Math.round(r.top)])})()');
const lsPanel = await ev(`localStorage.getItem('tyq.panel.pos.v1')`);
check('2 面板拖动', panelBefore !== panelAfter && !!lsPanel, `${panelBefore} → ${panelAfter} ls=${lsPanel}`);

// 拖动后点页签仍可用
const tabFind = await rc('.tyq-tab[data-tab="find"]');
await mouse(tabFind[0], tabFind[1]);
await sleep(400);
const tabNow = await ev('document.querySelector(".tyq-tab.on")?.dataset.tab');
check('2b 拖动后页签可点', tabNow === 'find', 'activeTab=' + tabNow);

// ---------- 3 已引用素材 + 定位高亮 ----------
await ev('__fake.reset(); __TYQ.close(); 1');
await sleep(200);
await ev('__TYQ.open("asset"); 1');
await sleep(500);
const chips = await ev('__fake.citedChips()');
await clickSel('.tyq-citem');
await sleep(300);
const flash = await ev('!!document.querySelector(".tyq-pin")');
const selText = await ev('window.getSelection().toString()');
check('3 已引用清单+高亮', chips.length > 0 && flash && selText.includes('@图片3'), `chips=${JSON.stringify(chips)} flash=${flash} sel="${selText}"`);

// ---------- 3b 素材列表"已引用"角标 ----------
const badges = await ev('__fake.citedBadges()');
check('3b 已引用角标', badges.length > 0, JSON.stringify(badges));

// ---------- 4a 搜索词不残留 ----------
await clickSel('.tyq-input');
await send('Input.insertText', { text: '巴迪' });
await sleep(300);
const filtered = await ev('__fake.rows().length');
await ev('__TYQ.close(); 1');
await sleep(200);
await ev('__TYQ.open("asset"); 1');
await sleep(400);
const searchVal = await ev('document.querySelector(".tyq-input").value');
const rowsAfter = await ev('__fake.rows().length');
check('4a 搜索词清空', searchVal === '' && filtered < rowsAfter, `过滤后 ${filtered} 行 → 重开 ${rowsAfter} 行, value="${searchVal}"`);

// ---------- 4c 同名素材提示带编号 ----------
const warn = await ev('document.querySelector(".tyq-warn")?.innerText || ""');
check('4c 同名提示含编号', /图片1/.test(warn) && /图片4/.test(warn), warn.slice(0, 80));

// ---------- 1-C 没有任何光标线索时 ----------
await send('Page.navigate', { url: 'http://127.0.0.1:8765/fake2.html' });
await sleep(900);
await ev(`localStorage.setItem('tyq.guide.v1','true');'ok'`);
await ev(SRC + '\n"ok"');
await sleep(1600);
await ev('__TYQ.open("asset"); 1');
await sleep(400);
await clickSel('.tyq-item');
await sleep(300);
await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
await sleep(700);
const tC = await ev('__TYQ.serialize(__fake.ed)');
const toastC = await ev(`[...document.querySelectorAll('div')].map(d=>d.textContent).filter(t=>t&&t.includes('没找到光标位置'))[0]||''`);
check('1-C 无光标线索', tC.endsWith('@图片1') && toastC.includes('没找到光标位置'), `末尾="${tC.slice(-12)}" toast="${toastC}"`);

const pass = results.filter(r => r.pass).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
process.exit(pass === results.length ? 0 : 1);
