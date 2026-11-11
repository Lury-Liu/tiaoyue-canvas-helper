/* 自动更新检查器回归：直接跑真实的 tiaoyue-ref-helper-ext/loader.js
 * 用沙箱伪造 chrome.storage / fetch / document。
 * 分工：loader 只检查并记录状态；热更新由 content.js 在主世界完成。
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

async function run({ storage = {}, remote = {}, httpFail = false } = {}) {
  const store = { ...storage };
  const fetched = [];

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
    chrome, fetch, console,
    document: { createElement: () => ({}), head: null, documentElement: { appendChild: () => {} } },
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Date, JSON, String, parseInt, setTimeout,
  });
  vm.runInContext(CONFIG, ctx);
  vm.runInContext(LOADER, ctx);
  await new Promise((r) => setTimeout(r, 80));
  return { store, fetched };
}

const HOUR = 60 * 60 * 1000;
const now = Date.now();

console.log(`\n== 自动更新检查器回归（内置 v${BUNDLED}）==\n`);

/* A. 远端有新版 → 只记录，不下载代码 */
{
  const r = await run({ remote: { meta: { version: '9.9.9', file: 'tiaoyue-ref-helper-ext/content.js' }, code: 'x' } });
  ok('A 有新版：记录线上版本', r.store['tyq.upd.online'] === '9.9.9', r.store['tyq.upd.online']);
  ok('A 有新版：记录待升级版本', r.store['tyq.upd.ver'] === '9.9.9', r.store['tyq.upd.ver']);
  ok('A 有新版：状态提示自动应用', /发现 v9\.9\.9/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
  ok('A 有新版：不拉代码（只请求 version.json）', r.fetched.length === 1, `fetched=${r.fetched.length}`);
  ok('A 有新版：请求带时间戳穿透缓存', (r.fetched[0] || '').includes('?t='));
}

/* B. 同版本 → 已是最新 */
{
  const r = await run({ remote: { meta: { version: BUNDLED } } });
  ok('B 同版本：不写待升级版本', r.store['tyq.upd.ver'] === undefined);
  ok('B 同版本：状态已是最新', /已是最新/.test(r.store['tyq.upd.status'] || ''), r.store['tyq.upd.status']);
}

/* C. 远端更旧（当前常见） → 不误报 */
{
  const r = await run({ remote: { meta: { version: '1.10.2' } } });
  ok('C 远端更旧：状态已是最新', /已是最新/.test(r.store['tyq.upd.status'] || ''));
  ok('C 远端更旧：记录线上版本', r.store['tyq.upd.online'] === '1.10.2');
  ok('C 远端更旧：不写待升级版本', r.store['tyq.upd.ver'] === undefined);
}

/* D. 1 小时内已检查 → 不打网络 */
{
  const r = await run({ storage: { 'tyq.upd.at': now - 5 * 60 * 1000 }, remote: { meta: { version: '9.9.9' } } });
  ok('D 节流：无任何请求', r.fetched.length === 0, `fetched=${r.fetched.length}`);
}

/* E. 超 1 小时 → 重新检查 */
{
  const r = await run({ storage: { 'tyq.upd.at': now - HOUR - 1000 }, remote: { meta: { version: '9.9.9' } } });
  ok('E 超时：重新联网', r.fetched.length === 1, `fetched=${r.fetched.length}`);
  ok('E 超时：记录新版', r.store['tyq.upd.ver'] === '9.9.9');
}

/* F. 节流期内即使有旧缓存也不联网 */
{
  const r = await run({
    storage: { 'tyq.upd.ver': '9.9.8', 'tyq.upd.at': now - 1000 },
    remote: { meta: { version: '9.9.9' } },
  });
  ok('F 节流期内：不联网', r.fetched.length === 0, `fetched=${r.fetched.length}`);
  ok('F 节流期内：状态不被篡改', r.store['tyq.upd.status'] === undefined);
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

/* I. 节流时间被写入（避免每次刷新重复请求） */
{
  const r = await run({ remote: { meta: { version: BUNDLED } } });
  ok('I 检查后写入时间戳', typeof r.store['tyq.upd.at'] === 'number' && r.store['tyq.upd.at'] > now - 5000);
}

/* J. 全程无未捕获的 Promise 拒绝（chrome.storage.get 参数非法会在这里暴露） */
{
  ok('J 无未捕获异常', rejections.length === 0, rejections.map((e) => e && e.message).join('; '));
}

console.log(lines.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
