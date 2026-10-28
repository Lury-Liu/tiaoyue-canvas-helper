/* 查找面板验证：多命中高亮 / 回车循环 / 素材名匹配 / 通用文件名标注
 * 用法：node verify_find.mjs
 * 依赖：本机 Edge（或 Chrome），无需联网。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'tiaoyue-ref-helper.user.js'), 'utf8');
const PORT = 8765;
const DBG = 9377;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  // 页面必须挂在 /aigc/canvas/ 下（脚本的路由守卫），文件仍从 ty_probe/ 取
  const clean = decodeURIComponent(req.url.split('?')[0]).replace(/^\/aigc\/canvas\//, '/');
  const p = path.join(__dirname, clean);
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) { console.error('未找到 Edge/Chrome'); server.close(); process.exit(1); }
const profile = path.join(__dirname, '.verify-profile');
const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
  } catch (e) { /* 等浏览器起来 */ }
}
if (!page) { console.error('浏览器未就绪'); proc.kill(); server.close(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + m)); } }, 8000);
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
await new Promise((r) => { ws.onopen = r; });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300));
  return r.result.value;
};

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail); };

// 页面路径里必须有 /aigc/canvas/，否则 open() 会被路由守卫拦掉
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/aigc/canvas/fake2.html` });
await sleep(900);
await ev(`localStorage.setItem('tyq.guide.v1','true'); localStorage.removeItem('tyq.panel.pos.v1'); localStorage.removeItem('tyq.tab.v1'); 'ok'`);
await ev(SRC + '\n"ok"');
await sleep(1200);

const typeFind = async (q) => {
  await ev(`(()=>{const i=document.querySelectorAll('.tyq-input')[0];i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await sleep(250);
};
const pressEnter = async (shift = false) => {
  await ev(`(()=>{const i=document.querySelectorAll('.tyq-input')[0];i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:${shift},bubbles:true,cancelable:true}));return 1})()`);
  await sleep(200);
};
const infoText = () => ev(`document.querySelectorAll('.tyq-hint')[0].textContent`);
const bodyText = () => ev(`document.body.innerText`);

// ---------- T1 多命中高亮 ----------
await ev(`__fake.render('艾洛文-高级职场套装 A 艾洛文-高级职场套装 B 艾洛文-高级职场套装 C 结尾'); __TYQ.findState.find=''; __TYQ.open('find'); 1`);
await sleep(400);
await typeFind('艾洛文');
const hl = await ev(`(()=>{const b=[...document.querySelectorAll('.tyq-hl')];return JSON.stringify({n:b.length,shown:b.filter(x=>x.style.display==='block').length})})()`);
const t1 = JSON.parse(hl);
check('T1 三次出现三个高亮框', t1.n === 3 && t1.shown === 3, JSON.stringify(t1) + ' info=' + await infoText());

// ---------- T2 回车逐个向下 ----------
await pressEnter();
const s2 = await ev(`window.getSelection().toString()`);
const now2 = await ev(`document.querySelectorAll('.tyq-hl.now').length`);
check('T2 回车到第 1 处并高亮当前', s2 === '艾洛文' && now2 === 1 && /第 1\/3/.test(await infoText()), `sel=${s2} now=${now2} info=${await infoText()}`);

// ---------- T3 到末尾回开头 ----------
await pressEnter(); await pressEnter();
const s3 = await ev(`window.getSelection().toString()`);
const at3 = await infoText();
check('T3 连按两次到第 3 处', /第 3\/3/.test(at3), at3);
await pressEnter();
const bt = await bodyText();
const s4 = await infoText();
check('T4 第 3 处再回车回到开头并提示', /第 1\/3/.test(s4) && /已到末尾/.test(bt), s4 + ' | toast=' + /已到末尾/.test(bt));

// ---------- T5 往回滚到末尾 ----------
await pressEnter(true);
const s5 = await infoText();
check('T5 Shift+回车从开头回末尾并提示', /第 3\/3/.test(s5) && /已到开头/.test(await bodyText()), s5);

// ---------- T6 素材名匹配 + 点击定位 ----------
await ev(`__TYQ.findState.find=''; __fake.render('前缀 @图片2 巴迪在跑，结尾'); __TYQ.render ? 1 : 1; __TYQ.open('find'); 1`);
await sleep(400);
await typeFind('巴迪');
const hit = await ev(`(()=>{const r=document.querySelectorAll('.tyq-fmatch');return JSON.stringify({n:r.length,txt:r[0]?r[0].innerText.replace(/\\s+/g,' '):''})})()`);
const hitObj = JSON.parse(hit);
check('T6 搜素材名列出图片2与引用次数', hitObj.n === 1 && /图片2/.test(hitObj.txt) && /正文×1/.test(hitObj.txt), JSON.stringify(hitObj));
await ev(`document.querySelectorAll('.tyq-fmatch')[0].click(); 1`);
await sleep(400);
const s6 = await ev(`window.getSelection().toString()`);
check('T7 点素材名定位到正文引用', s6 === '@图片2', 'sel=' + s6);

// ---------- T8 通用文件名标注 ----------
await ev(`(()=>{__fake.referenceItems.push({id:'a9',type:'image',assetName:'image.png',coverUrl:''}); __fake.render('粘贴脚本里带着 image.png 占位'); __TYQ.findState.find=''; __TYQ.open('find'); return 1})()`);
await sleep(500);
await typeFind('image');
const badgeFind = await ev(`document.querySelectorAll('.tyq-fbox .tyq-badge').length`);
check('T8 查找结果标注通用文件名', badgeFind === 1, 'badges=' + badgeFind);

// ---------- T9 关闭面板清高亮 ----------
await ev(`__TYQ.close(); 1`);
await sleep(200);
const left = await ev(`document.querySelectorAll('.tyq-hl').length`);
check('T9 关闭面板后高亮清除', left === 0, 'left=' + left);

// ---------- R1 回归：转换 + 撤销 ----------
await ev(`__fake.referenceItems.pop(); __fake.render(__fake.base); __TYQ.open('asset'); 1`);
await sleep(500);
const convBtn = await ev(`(()=>{const b=document.querySelector('.tyq-btn.primary'); if(!b) return null; b.click(); return 1})()`);
await sleep(600);
const convText = await ev(`__TYQ.serialize(__fake.ed)`);
check('R1 一键转换仍正常', convBtn === 1 && convText.includes('@图片1') && convText.includes('@图片2'), 'text=' + String(convText).slice(0, 40));
await ev(`__TYQ.undo(); 1`);
await sleep(500);
const undone = await ev(`__TYQ.serialize(__fake.ed)`);
check('R2 撤销恢复原文', undone === await ev(`__fake.base`), 'text=' + String(undone).slice(0, 30));

// ---------- R3 回归：已引用 chip 定位 ----------
await ev(`__TYQ.open('asset'); 1`);
await sleep(400);
const chip = await ev(`(()=>{const c=document.querySelectorAll('.tyq-citem'); if(!c.length) return null; c[0].click(); return 1})()`);
await sleep(400);
const chipSel = await ev(`window.getSelection().toString()`);
check('R3 已引用清单定位仍正常', chip === 1 && /^@(图片|视频|音频)\d+$/.test(chipSel), 'sel=' + chipSel);

// ---------- R4 素材页标注通用文件名 ----------
await ev(`(()=>{__fake.referenceItems.push({id:'a9',type:'image',assetName:'image.png',coverUrl:''}); __fake.render('粘贴脚本里带着 image.png 占位'); __TYQ.open('asset'); return 1})()`);
await sleep(600);
const badges = await ev(`document.querySelectorAll('.tyq-matches .tyq-badge').length`);
check('R4 素材清单标注通用文件名', badges >= 1, 'badges=' + badges);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
proc.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(failed.length ? 1 : 0);
