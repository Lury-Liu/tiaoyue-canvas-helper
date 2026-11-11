/* popup：显示真实运行版本；「立即检查更新」下载代码并推送给已打开的页面。 */
const REPO = TYQ_REPO;      // 定义在 config.js
const BRANCH = TYQ_BRANCH;
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const K = {
  code: 'tyq.upd.code',
  ver: 'tyq.upd.ver',
  applied: 'tyq.upd.applied',
  at: 'tyq.upd.at',
  status: 'tyq.upd.status',
  online: 'tyq.upd.online',
};

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

/* 读页面里真实运行的版本（主世界的 window.__TYQ.version）。
 * 旧版这里直接显示 BUNDLED，热更新后仍显示内置版本号，看起来像"没升级"。 */
async function runtimeVersion() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(www|canvas)\.tiaoyue\.com\//.test(tab.url || '')) return { state: 'none' };
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => (window.__TYQ && window.__TYQ.version) || null,
    });
    const v = r && r.result;
    return v ? { state: 'ok', version: v } : { state: 'absent' };
  } catch (e) {
    return { state: 'error', err: e.message };
  }
}

async function render() {
  const st = await chrome.storage.local.get([K.ver, K.applied, K.at, K.status, K.online]);
  $('local').textContent = 'v' + BUNDLED;

  const rt = await runtimeVersion();
  if (rt.state === 'ok') {
    $('run').textContent = 'v' + rt.version + (cmp(rt.version, BUNDLED) > 0 ? '（热更新）' : '');
    $('run').className = cmp(rt.version, BUNDLED) >= 0 ? 'ok' : '';
  } else if (rt.state === 'absent') {
    $('run').textContent = '未注入';
  } else if (rt.state === 'error') {
    $('run').textContent = '读取失败';
  } else {
    $('run').textContent = '非画布页';
  }

  $('online').textContent = st[K.online] ? 'v' + st[K.online] : '-';
  $('cached').textContent = st[K.ver] && cmp(st[K.ver], BUNDLED) > 0 ? 'v' + st[K.ver] : '-';

  const stEl = $('st');
  const status = st[K.status] || '尚未检查';
  stEl.textContent = status + (st[K.at] ? '（' + fmt(st[K.at]) + '）' : '');
  stEl.className = /失败/.test(status) ? 'err' : (/最新|已应用|已下载/.test(status) ? 'ok' : '');
}

$('recheck').addEventListener('click', async () => {
  const btn = $('recheck');
  btn.disabled = true;
  btn.textContent = '检查中…';
  try {
    const meta = await (await fetch(`${BASE}/tiaoyue-ref-helper-ext/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    const online = String(meta.version || '');
    await chrome.storage.local.set({ [K.online]: online, [K.at]: Date.now() });

    if (!online || cmp(online, BUNDLED) <= 0) {
      await chrome.storage.local.set({ [K.status]: '已是最新 v' + BUNDLED });
    } else {
      btn.textContent = '下载中…';
      const code = await (await fetch(`${BASE}/${meta.file || 'tiaoyue-ref-helper-ext/content.js'}?t=${Date.now()}`, { cache: 'no-store' })).text();
      if (code.length < 5000 || !code.includes('__TYQ')) throw new Error('更新内容校验失败');
      // 写缓存 → loader 的 storage.onChanged 会把它推给已打开的页面，无需刷新
      await chrome.storage.local.set({ [K.code]: code, [K.ver]: online, [K.status]: '已下载 v' + online + '，正在推送到已打开的页面' });
    }
  } catch (e) {
    await chrome.storage.local.set({ [K.status]: '检查失败：' + (e.message || e) });
  }
  btn.disabled = false;
  btn.textContent = '立即检查更新';
  await render();
  setTimeout(render, 1500);   // 等页面应用后刷新一次状态
});

render();
