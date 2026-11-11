// v1.18.x 更新功能端到端验证（独立 Chrome 配置，结束 Browser.close 正常退出）
// 覆盖：安装 → 真机联网检查 → 推送注入 → 同版本去重 → 跨版本只注入一次 → 过期缓存清理 → popup 读运行版本
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.CHROME_PORT || 9333);
const EXT_DIR = process.argv[2];
const PAGE = 'https://www.tiaoyue.com/';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
};

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
console.log('浏览器:', ver.Browser);
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(Object.assign(new Error(m.error.message), { cdp: m.error })) : res(m.result);
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const p = { id, method, params };
  if (sessionId) p.sessionId = sessionId;
  ws.send(JSON.stringify(p));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout: ' + method)); }, 30000);
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalIn = async (sessionId, expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return { __exc: JSON.stringify(r.exceptionDetails).slice(0, 240) };
  return r.result.value;
};
const open = async (url, wait) => {
  const { targetId } = await send('Target.createTarget', { url, background: true });
  await sleep(wait);
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { targetId, sessionId };
};

const BASE_CODE = fs.readFileSync(path.join(EXT_DIR, 'content.js'), 'utf8');
const codeFor = (v) => BASE_CODE.replace(/TYQ_VERSION = '[\d.]+'/, `TYQ_VERSION = '${v}'`);
const setCache = (sid, v) => evalIn(sid, `(async () => {
  await chrome.storage.local.set({ 'tyq.upd.code': ${JSON.stringify(codeFor(v))}, 'tyq.upd.ver': '${v}' });
  return 'ok';
})()`);
const state = (sid) => evalIn(sid, `JSON.stringify({
  version: (window.__TYQ && window.__TYQ.version) || null,
  blobs: document.querySelectorAll('script[src^="blob:"]').length
})`);

/* ① 安装 */
const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT_DIR });
console.log('① 加载扩展 ✓', extId);

/* ② 先清干净上一轮的测试缓存，保证可重复运行 */
const ext = await open(`chrome-extension://${extId}/popup.html`, 1200);
await evalIn(ext.sessionId, `chrome.storage.local.remove(['tyq.upd.code','tyq.upd.ver','tyq.upd.applied','tyq.upd.at','tyq.upd.online','tyq.upd.status']).then(() => 'ok')`);

/* ③ 打开页面：真实联网检查一次 */
const page = await open(PAGE, 9000);
const bundled = await evalIn(ext.sessionId, `chrome.runtime.getManifest().version`);
const st0 = JSON.parse(await state(page.sessionId));
console.log('② 页面初始:', JSON.stringify(st0), '| 内置:', bundled);
ok('② 内置版本已加载', st0.version === bundled, st0.version + ' vs ' + bundled);
const store0 = JSON.parse(await evalIn(ext.sessionId, `(async () => {
  const s = await chrome.storage.local.get(['tyq.upd.online','tyq.upd.status']);
  return JSON.stringify(s);
})()`));
console.log('   存储状态:', JSON.stringify(store0));
// 刚推完 CDN 可能还有旧值，只要「线上不高于内置」且状态为已是最新即可
const vcmp = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
};
ok('② 真实联网检查：线上不高于内置', vcmp(store0['tyq.upd.online'], bundled) <= 0, store0['tyq.upd.online'] + ' vs ' + bundled);
ok('② 状态为已是最新', /已是最新/.test(store0['tyq.upd.status'] || ''), store0['tyq.upd.status']);

/* ③ 推送 9.9.9 */
await setCache(ext.sessionId, '9.9.9');
await sleep(2200);
let st = JSON.parse(await state(page.sessionId));
ok('③ 推送后运行版本变 9.9.9', st.version === '9.9.9', st.version);
ok('③ 注入标签数 = 1', st.blobs === 1, `blobs=${st.blobs}`);

/* ④ 同一版本再写一次：不应重复注入 */
await setCache(ext.sessionId, '9.9.9');
await sleep(1800);
st = JSON.parse(await state(page.sessionId));
ok('④ 同版本重复推送：不重复注入', st.blobs === 1, `blobs=${st.blobs}`);
ok('④ 同版本重复推送：版本不变', st.version === '9.9.9', st.version);

/* ⑤ 推更高版本：旧实例监听应已被 alive 关掉，只注入一次 */
await setCache(ext.sessionId, '9.9.10');
await sleep(2200);
st = JSON.parse(await state(page.sessionId));
ok('⑤ 升级到 9.9.10', st.version === '9.9.10', st.version);
ok('⑤ 只多注入 1 次（旧实例不重复响应）', st.blobs === 2, `blobs=${st.blobs}`);

/* ⑥ 过期缓存清理：写入比内置更旧的版本，新开页面应清掉 */
await evalIn(ext.sessionId, `(async () => {
  await chrome.storage.local.set({ 'tyq.upd.code': 'x'.repeat(6000), 'tyq.upd.ver': '1.0.0' });
  return 'ok';
})()`);
const page2 = await open(PAGE, 8000);
const after = await evalIn(ext.sessionId, `(async () => {
  const s = await chrome.storage.local.get(['tyq.upd.code','tyq.upd.ver']);
  return JSON.stringify({ hasCode: !!s['tyq.upd.code'], ver: s['tyq.upd.ver'] || null });
})()`);
ok('⑥ 过期缓存被清理', JSON.parse(after).hasCode === false && JSON.parse(after).ver === null, after);
const st2 = JSON.parse(await state(page2.sessionId));
ok('⑥ 新页面不会被旧缓存污染', st2.version !== '1.0.0', st2.version);

/* ⑦ popup 读真实运行版本 */
const runtime = await evalIn(ext.sessionId, `(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.tiaoyue.com/*' });
  const out = [];
  for (const t of tabs) {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: () => (window.__TYQ && window.__TYQ.version) || null });
      out.push(r && r.result);
    } catch (e) { out.push('err:' + e.message); }
  }
  return JSON.stringify(out);
})()`);
console.log('⑦ 各标签运行版本:', runtime);
ok('⑦ popup 能读到真实运行版本', /9\.9\.10/.test(runtime) || /1\.18\.1/.test(runtime), runtime);

console.log(`\n通过 ${pass} / ${pass + fail}`);
await send('Browser.close').catch(() => {});
process.exit(fail ? 1 : 0);
