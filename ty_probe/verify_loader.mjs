/* 自动更新分发器回归：直接跑真实的 tiaoyue-ref-helper-ext/loader.js
 * 用沙箱伪造 chrome.storage / chrome.storage.onChanged / fetch / window。
 * 分工：loader 负责下载与下发；content.js（主世界）负责注入。
 * 用法：node ty_probe/verify_loader.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'tiaoyue-ref-helper-ext');
const CONFIG = fs.readFileSync(path.join(EXT, 'config.js'), 'utf8');
const LOADER = fs.readFileSync(path.join(EXT, 'loader.js'), 'utf8');
const BUNDLED = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;

let pass = 0, fail = 0;
const lines = [];
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push(e || new Error('unknown')));
function ok(name, cond, extra = '') {
  if (cond) { pass++; lines.push(`  ✓ ${name}`); }
  else { fail++; lines.push(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
}

const GOOD_CODE = '__TYQ ' + 'x'.repeat(6000);

async function run({ storage = {}, remote = {}, httpFail = false } = {}) {
  const store = { ...storage };
  const fetched = [];
  const pushed = [];
  let msgHandler = null;
  let changeHandler = null;

  const chrome = {
    runtime: { getManifest: () => ({ version: BUNDLED }) },
    storage: {
      local: {
        get: async (keys) => {
          // 模拟 Chrome：keys 必须是 string / string[] / object，数组里不能有 undefined
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            if (typeof k !== 'string') throw new TypeError("Error at parameter 'keys': Value did not match any choice.");
          }
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => { Object.assign(store, obj); },
      },
      onChanged: { addListener: (fn) => { changeHandler = fn; } },
    },
  };

  const fetch = async (url) => {
    fetched.push(url);
    if (httpFail) return { ok: false, status: 500, text: async () => '' };
    if (url.includes('version.json')) {
      if (remote.meta === undefined) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(remote.meta) };
    }
    return { ok: true, status: 200, text: async () => (remote.code ?? '') };
  };

  const ctx = vm.createContext({
    chrome, fetch, console, Date, JSON, String, parseInt, setTimeout,
    window: {
      addEventListener: (type, fn) => { if (type === 'message') msgHandler = fn; },
      postMessage: (data) => { pushed.push(data); },
    },
  });
  vm.runInContext(CONFIG, ctx);
  vm.runInContext(LOADER, ctx);
  await new Promise((r) => setTimeout(r, 100));

  return {
    store, fetched, pushed,
    message: async (data) => { if (msgHandler) msgHandler({ data }); await new Promise((r) => setTimeout(r, 60)); },
    change: async (changes) => { if (changeHandler) changeHandler(changes, 'local'); await new Promise((r) => setTimeout(r, 60)); },
  };
}

const HOUR = 60 * 60 * 1000;
const now = Date.now();

console.log(`\n== 自动更新分发器回归（内置 v${BUNDLED}）==\n`);

/* A. 远端有新版 → 下载代码 + 入库 + 推给页面 */
{
  const r = await run({ remote: { meta: { version: '9.9.9', file: 'tiaoyue-ref-helper-ext/content.js' }, code: GOOD_CODE } });
  ok('A 有新版：记录线上版本', r.store['tyq.upd.online'] === '9.9.9', r.store['tyq.upd.online']);
  ok('A 有新版：入库新代码', (r.store['tyq.upd.code'] || '').length > 5000);
  ok('A 有新版：记录版本', r.store['tyq.upd.ver'] === '9.9.9', r.store['tyq.upd.ver']);
  ok('A 有新版：状态为已下载', /已下载 v9\.9\.9/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
  ok('A 有新版：请求 version.json + content.js', r.fetched.length === 2, `fetched=${r.fetched.length}`);
  ok('A 有新版：请求带时间戳穿透缓存', r.fetched.every((u) => u.includes('?t=')));
  ok('A 有新版：向主世界推送新代码', r.pushed.some((p) => p.__tyq === 'apply-code' && p.ver === '9.9.9'));
}

/* B. 同版本 → 已是最新，不下载 */
{
  const r = await run({ remote: { meta: { version: BUNDLED } } });
  ok('B 同版本：不写新代码', r.store['tyq.upd.code'] === undefined);
  ok('B 同版本：状态已是最新', /已是最新/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
  ok('B 同版本：只请求一次', r.fetched.length === 1, `fetched=${r.fetched.length}`);
  ok('B 同版本：不推送', r.pushed.length === 0, `pushed=${r.pushed.length}`);
}

/* C. 远端更旧 → 不误报 */
{
  const r = await run({ remote: { meta: { version: '1.10.2' } } });
  ok('C 远端更旧：状态已是最新', /已是最新/.test(r.store['tyq.upd.status'] || ''));
  ok('C 远端更旧：记录线上版本', r.store['tyq.upd.online'] === '1.10.2');
  ok('C 远端更旧：不写新代码', r.store['tyq.upd.code'] === undefined);
}

/* D. 1 小时内已检查且无缓存 → 不打网络、不推送 */
{
  const r = await run({ storage: { 'tyq.upd.at': now - 5 * 60 * 1000 }, remote: { meta: { version: '9.9.9' } } });
  ok('D 节流：无任何请求', r.fetched.length === 0, `fetched=${r.fetched.length}`);
  ok('D 节流：无推送', r.pushed.length === 0);
}

/* E. 超 1 小时 → 重新检查 */
{
  const r = await run({
    storage: { 'tyq.upd.at': now - HOUR - 1000 },
    remote: { meta: { version: '9.9.9' }, code: GOOD_CODE },
  });
  ok('E 超时：重新联网', r.fetched.length === 2, `fetched=${r.fetched.length}`);
  ok('E 超时：入库新版', r.store['tyq.upd.ver'] === '9.9.9');
}

/* F. 节流期内但有缓存 → 不联网，仍把缓存推给页面 */
{
  const r = await run({
    storage: { 'tyq.upd.code': GOOD_CODE, 'tyq.upd.ver': '9.9.8', 'tyq.upd.at': now - 1000 },
    remote: { meta: { version: '9.9.9' } },
  });
  ok('F 有缓存：不联网', r.fetched.length === 0, `fetched=${r.fetched.length}`);
  ok('F 有缓存：启动即推送', r.pushed.some((p) => p.__tyq === 'apply-code' && p.ver === '9.9.8'));
}

/* G. 网络 500 */
{
  const r = await run({ httpFail: true });
  ok('G 网络失败：状态记录失败', /检查失败/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
}

/* H. version.json 缺 version 字段 */
{
  const r = await run({ remote: { meta: { file: 'x.js' } } });
  ok('H 缺字段：状态记录失败', /检查失败/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
}

/* I. 节流时间被写入 */
{
  const r = await run({ remote: { meta: { version: BUNDLED } } });
  ok('I 检查后写入时间戳', typeof r.store['tyq.upd.at'] === 'number' && r.store['tyq.upd.at'] > now - 5000);
}

/* J. 代码过短 → 拒绝入库 */
{
  const r = await run({ remote: { meta: { version: '9.9.9' }, code: 'too short' } });
  ok('J 代码异常：不入库', r.store['tyq.upd.code'] === undefined);
  ok('J 代码异常：状态报失败', /检查失败/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
}

/* K. 主世界 want-code 握手 → 回推缓存 */
{
  const r = await run({
    storage: { 'tyq.upd.code': GOOD_CODE, 'tyq.upd.ver': '9.9.8', 'tyq.upd.at': now },
    remote: {},
  });
  const before = r.pushed.length;
  await r.message({ __tyq: 'want-code' });
  ok('K 握手：有缓存则回推', r.pushed.length > before && r.pushed.at(-1).ver === '9.9.8');
}

/* L. 主世界 code-applied → 记录已应用 */
{
  const r = await run({ storage: { 'tyq.upd.at': now }, remote: {} });
  await r.message({ __tyq: 'code-applied', ver: '9.9.8' });
  ok('L 回执：记录应用版本', r.store['tyq.upd.applied'] === '9.9.8', r.store['tyq.upd.applied']);
  ok('L 回执：状态为已应用', /已应用 v9\.9\.8/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
}

/* M. popup 写缓存 → storage.onChanged 立刻推送 */
{
  const r = await run({ storage: { 'tyq.upd.at': now }, remote: {} });
  await r.change({ 'tyq.upd.code': { newValue: GOOD_CODE }, 'tyq.upd.ver': { newValue: '9.9.9' } });
  ok('M 存储变更：推送给页面', r.pushed.some((p) => p.__tyq === 'apply-code' && p.ver === '9.9.9'));
}

/* N. 全程无未捕获的 Promise 拒绝 */
{
  ok('N 无未捕获异常', rejections.length === 0, rejections.map((e) => e && e.message).join('; '));
}

console.log(lines.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
