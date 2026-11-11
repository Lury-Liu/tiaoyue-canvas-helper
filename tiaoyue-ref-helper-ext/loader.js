/* 跳跃视界 · 画布引用助手 —— 自动更新检查器（隔离世界）
 *
 * 分工（实测结论，勿混）：
 *  - 隔离世界创建的 <script>/blob 不会在页面主世界执行，所以本文件不负责注入。
 *  - 本文件只做：对比 GitHub version.json → 记录线上版本与状态，供 popup 展示。
 *  - 真正的热更新由 content.js（MAIN world）内的 selfUpdate 完成：它每进入一次
 *    画布就检查一次，发现新版立刻拉取并接管旧实例（站点无 CSP，blob 可用）。
 *  - 检查频率：每 CHECK_INTERVAL_MS 最多一次，避免每次刷新都打网络。
 *
 * 发布流程（主机方）：
 *  1. node tools/build.js <新版本号>   ← 重新生成 content.js + version.json
 *  2. git push
 *  其他机器：无需任何操作，下次进入画布自动升级。
 */
(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  const REPO = TYQ_REPO;      // 定义在 config.js
  const BRANCH = TYQ_BRANCH;
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;    // 网络检查节流：1 小时

  const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
  const K = { ver: 'tyq.upd.ver', at: 'tyq.upd.at', status: 'tyq.upd.status', online: 'tyq.upd.online' };
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
  };

  // 注意：隔离世界创建的 <script> 不会在页面主世界执行（实测 blob 脚本插入后不运行），
  // 因此这里只负责"发现新版 + 记录状态"，真正的热更新由 content.js 在主世界完成
  // （content.js 内的 selfUpdate 会在进入画布时拉取并接管）。

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  /* ==================== 下载代理 ====================
   * content.js（主世界）→ 本文件（隔离世界）→ background.js（service worker）
   * → chrome.downloads。注意：chrome.downloads 在 content script 里不可用，
   * 必须由 service worker 代下。
   */
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || typeof d !== 'object' || d.__tyq !== 'download' || typeof d.url !== 'string') return;
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
  });

  /* ==================== 主流程 ==================== */
  async function main() {
    const st = await store.get([K.at]);

    // 1) 节流：距上次检查不足 1 小时就到此为止
    if (st[K.at] && Date.now() - st[K.at] < CHECK_INTERVAL_MS) return;

    // 2) 联网检查
    await store.set({ [K.at]: Date.now(), [K.status]: '检查中…' });
    try {
      // 加时间戳穿透 raw.githubusercontent 的 CDN 缓存（刚推送时可能仍返回旧版本）
      const meta = JSON.parse(await fetchText(`${BASE}/tiaoyue-ref-helper-ext/version.json?t=${Date.now()}`));
      const online = String(meta.version || '');
      await store.set({ [K.online]: online });
      if (!online) throw new Error('version.json 缺少 version 字段');

      if (cmp(online, BUNDLED) <= 0) {
        await store.set({ [K.status]: '已是最新 v' + BUNDLED });
        return;
      }

      // 3) 有新版：只记状态，具体升级由 content.js 在主世界自更新完成
      await store.set({ [K.ver]: online, [K.status]: '发现 v' + online + '，下次进入画布自动应用' });
    } catch (e) {
      await store.set({ [K.status]: '检查失败：' + (e && e.message ? e.message : e) });
    }
  }

  main();
})();
