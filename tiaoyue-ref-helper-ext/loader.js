/* 跳跃视界 · 画布引用助手 —— 自动更新分发器（隔离世界）
 *
 * 分工（实测结论，勿混）：
 *  - 隔离世界创建的 <script>/blob 不会在页面主世界执行，所以本文件不负责注入。
 *  - 本文件负责「下载」：扩展上下文 fetch 不受页面 CORS / 站点策略影响，比在页面里
 *    取更可靠（旧版把 fetch 放在主世界，网络被拦时静默失败，表现为"永远不升级"）。
 *  - 拿到新代码后写进 chrome.storage，并通过 postMessage 交给主世界（content.js）注入。
 *  - 主世界启动时会发 want-code 索取缓存，因此即使断网、即使 loader 先发一步也不会漏。
 *
 * 发布流程（主机方）：
 *  1. node tools/build.js <新版本号>
 *  2. node tools/pack.js
 *  3. git add -A && git commit && git push
 *  其他机器：进入任意 tiaoyue 页面即自动升级（已打开的页面会被就地推送）。
 */
(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  const REPO = TYQ_REPO;      // 定义在 config.js
  const BRANCH = TYQ_BRANCH;
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;    // 网络检查节流：1 小时
  const CODE_MIN_LEN = 5000;                   // 拉到的代码太短视为异常

  const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
  const K = {
    code: 'tyq.upd.code',       // 已下载的新代码
    ver: 'tyq.upd.ver',         // 新代码对应的版本
    applied: 'tyq.upd.applied', // 页面确认已应用的版本
    at: 'tyq.upd.at',
    status: 'tyq.upd.status',
    online: 'tyq.upd.online',
  };
  const BUNDLED = chrome.runtime.getManifest().version;

  /* ==================== 工具 ==================== */
  function cmp(a, b) {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  const store = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (obj) => chrome.storage.local.set(obj),
    remove: (keys) => chrome.storage.local.remove(keys),
  };

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  /* ==================== 向主世界下发代码 ==================== */
  let pushedVer = '';

  // force=true 用于「页面主动索取」：此时必须重发，否则去重会把握手挡掉
  function pushToPage(ver, code, force = false) {
    if (!ver || !code) return;
    if (!force && pushedVer === ver) return;
    pushedVer = ver;
    try { window.postMessage({ __tyq: 'apply-code', ver, code }, '*'); } catch (e) { /* 忽略 */ }
  }

  async function pushCached() {
    const st = await store.get([K.code, K.ver]);
    if (st[K.code] && st[K.ver] && cmp(st[K.ver], BUNDLED) > 0) pushToPage(st[K.ver], st[K.code], true);
  }

  // popup 写完缓存后，本监听会立刻把新代码推给已打开的页面，无需刷新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[K.code] || !changes[K.code].newValue) return;
    const ver = (changes[K.ver] && changes[K.ver].newValue) || '';
    if (ver) pushToPage(ver, changes[K.code].newValue);
  });

  /* ==================== 消息总线 ==================== */
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || typeof d !== 'object') return;

    // 主世界启动握手
    if (d.__tyq === 'want-code') { pushCached(); return; }

    // 主世界确认已应用
    if (d.__tyq === 'code-applied') {
      store.set({ [K.applied]: String(d.ver || ''), [K.status]: '已应用 v' + d.ver });
      store.get([K.online]).then((st) => {
        if (st[K.online] && cmp(st[K.online], String(d.ver || '')) > 0) {
          store.set({ [K.status]: '已应用 v' + d.ver + '，线上还有 v' + st[K.online] });
        }
      });
      return;
    }

    // 下载代理：content.js（主世界）→ 本文件 → background.js → chrome.downloads
    // 注意：chrome.downloads 在 content script 里不可用，必须由 service worker 代下。
    if (d.__tyq === 'download' && typeof d.url === 'string') {
      const rid = d.rid || '';
      const reply = (payload) => {
        try { window.postMessage(Object.assign({ __tyq: 'download-ack', rid }, payload), '*'); } catch (err) { /* 忽略 */ }
      };
      try {
        chrome.runtime.sendMessage({ type: 'tyq:download', url: d.url, filename: d.filename }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) { reply({ ok: false, err: err.message }); return; }
          reply(res || { ok: false, err: 'no-response' });
        });
      } catch (err) {
        reply({ ok: false, err: String(err && err.message ? err.message : err) });
      }
    }
  });

  /* ==================== 主流程 ==================== */
  async function main() {
    const st = await store.get([K.at, K.code, K.ver]);

    // 0) 缓存不比内置版新（例如手动装了新包）→ 清掉，别让旧缓存占着
    if (st[K.code] && st[K.ver] && cmp(st[K.ver], BUNDLED) <= 0) {
      await store.remove([K.code, K.ver]);
      delete st[K.code];
      delete st[K.ver];
    }

    // 1) 先把缓存里的新版本推给页面（断网也能用上已下载的版本）
    if (st[K.code] && st[K.ver] && cmp(st[K.ver], BUNDLED) > 0) pushToPage(st[K.ver], st[K.code]);

    // 2) 节流：距上次检查不足 1 小时就到此为止
    if (st[K.at] && Date.now() - st[K.at] < CHECK_INTERVAL_MS) return;

    // 3) 联网检查
    await store.set({ [K.at]: Date.now(), [K.status]: '检查中…' });
    try {
      // 加时间戳穿透 raw.githubusercontent 的 CDN 缓存（刚推送时可能仍返回旧版本）
      const meta = JSON.parse(await fetchText(`${BASE}/tiaoyue-ref-helper-ext/version.json?t=${Date.now()}`));
      const online = String(meta.version || '');
      await store.set({ [K.online]: online });
      if (!online) throw new Error('version.json 缺少 version 字段');

      const cur = st[K.ver] && cmp(st[K.ver], BUNDLED) > 0 ? st[K.ver] : BUNDLED;
      if (cmp(online, cur) <= 0) {
        await store.set({ [K.status]: '已是最新 v' + cur });
        return;
      }

      // 4) 有新版：下载 + 校验 + 入库 + 推给页面
      const code = await fetchText(`${BASE}/${meta.file || 'tiaoyue-ref-helper-ext/content.js'}?t=${Date.now()}`);
      if (code.length < CODE_MIN_LEN || !code.includes('__TYQ')) throw new Error('更新内容校验失败');
      await store.set({ [K.code]: code, [K.ver]: online, [K.status]: '已下载 v' + online + '，等待页面应用' });
      pushToPage(online, code);   // 已打开的页面立即生效
    } catch (e) {
      await store.set({ [K.status]: '检查失败：' + (e && e.message ? e.message : e) });
    }
  }

  main();
})();
