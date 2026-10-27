/* popup：显示版本与更新状态；「立即检查更新」会直接拉取并缓存新代码。 */
const REPO = TYQ_REPO;      // 定义在 config.js
const BRANCH = TYQ_BRANCH;
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const K = { code: 'tyq.upd.code', ver: 'tyq.upd.ver', at: 'tyq.upd.at', status: 'tyq.upd.status', online: 'tyq.upd.online' };

const $ = (id) => document.getElementById(id);
const BUNDLED = chrome.runtime.getManifest().version;

function cmp(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');

async function render() {
  const st = await chrome.storage.local.get([K.ver, K.at, K.status, K.online]);
  $('local').textContent = 'v' + BUNDLED;
  $('run').textContent = st[K.ver] && cmp(st[K.ver], BUNDLED) > 0 ? 'v' + st[K.ver] + '（在线更新）' : 'v' + BUNDLED;
  $('online').textContent = st[K.online] ? 'v' + st[K.online] : '-';
  const stEl = $('st');
  const status = st[K.status] || '尚未检查';
  stEl.textContent = status + (st[K.at] ? '（' + fmt(st[K.at]) + '）' : '');
  stEl.className = /失败/.test(status) ? 'err' : (/最新|更新/.test(status) ? 'ok' : '');
}

$('recheck').addEventListener('click', async () => {
  const btn = $('recheck');
  btn.disabled = true; btn.textContent = '检查中…';
  try {
    const meta = await (await fetch(`${BASE}/tiaoyue-ref-helper-ext/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    const online = String(meta.version || '');
    await chrome.storage.local.set({ [K.online]: online, [K.at]: Date.now() });
    if (online && cmp(online, BUNDLED) > 0) {
      const code = await (await fetch(`${BASE}/${meta.file || 'tiaoyue-ref-helper-ext/content.js'}`, { cache: 'no-store' })).text();
      if (code.length < 5000 || !code.includes('__TYQ')) throw new Error('内容校验失败');
      await chrome.storage.local.set({ [K.code]: code, [K.ver]: online, [K.status]: '已下载 v' + online + '，刷新画布页生效' });
    } else {
      await chrome.storage.local.set({ [K.status]: '已是最新 v' + BUNDLED });
    }
  } catch (e) {
    await chrome.storage.local.set({ [K.status]: '检查失败：' + (e.message || e) });
  }
  btn.disabled = false; btn.textContent = '立即检查更新';
  render();
});

render();
