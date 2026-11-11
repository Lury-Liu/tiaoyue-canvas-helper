/* popup：显示版本与更新状态；「立即检查更新」会直接拉取并缓存新代码。 */
const REPO = TYQ_REPO;      // 定义在 config.js
const BRANCH = TYQ_BRANCH;
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const K = { ver: 'tyq.upd.ver', at: 'tyq.upd.at', status: 'tyq.upd.status', online: 'tyq.upd.online' };

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
  // 运行版本无法从隔离世界读取，能确定的只有"内置版"和"线上是否更新"
  $('run').textContent = 'v' + BUNDLED + (st[K.ver] && cmp(st[K.ver], BUNDLED) > 0 ? '（待升级 v' + st[K.ver] + '）' : '');
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
      // 不在这里下载代码：主世界的 content.js 会在进入画布时自行拉取并热更新
      await chrome.storage.local.set({ [K.ver]: online, [K.status]: '发现 v' + online + '，刷新画布页自动应用' });
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
