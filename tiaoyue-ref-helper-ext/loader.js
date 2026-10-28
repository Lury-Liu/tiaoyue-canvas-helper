/* 跳跃视界 · 画布引用助手 —— 自动更新 loader（隔离世界）
 *
 * 原理：
 *  - manifest 里的 content.js 是"内置兜底版"（MAIN world，断网可用）。
 *  - 本文件在隔离世界运行，每次页面加载时对比 GitHub 上的 version.json：
 *    有新版本就拉取新 content.js 存进 chrome.storage，并以 blob <script>
 *    注入页面（站点无 CSP，可行；注入时置 __TYQ_FORCE_ONCE 让新代码接管旧实例）。
 *  - 检查频率：每 CHECK_INTERVAL_MS 最多一次，避免每次刷新都打网络。
 *
 * 发布流程（主机方）：
 *  1. node tools/build.js <新版本号>   ← 重新生成 content.js + version.json
 *  2. git push
 *  其他机器：无需任何操作，1 小时内自动更新（或重开页面立即生效）。
 */
(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  const REPO = TYQ_REPO;      // 定义在 config.js
  const BRANCH = TYQ_BRANCH;
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;    // 网络检查节流：1 小时
  const CODE_MIN_LEN = 5000;                   // 拉到的代码太短视为异常，拒绝注入

  const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
  const K = { code: 'tyq.upd.code', ver: 'tyq.upd.ver', at: 'tyq.upd.at', status: 'tyq.upd.status', online: 'tyq.upd.online' };
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

  // 把代码注入页面 MAIN world（blob <script>，站点无 CSP）
  function inject(code) {
    try {
      const blob = new Blob(['window.__TYQ_FORCE_ONCE=true;\n', code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => URL.revokeObjectURL(url);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 页面极早期无 head，兜底版会接管 */ }
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  /* ==================== 主流程 ==================== */
  async function main() {
    const st = await store.get([K.code, K.ver, K.at]);

    // 1) 已有缓存的更新且比内置新 → 直接注入
    if (st[K.code] && st[K.ver] && cmp(st[K.ver], BUNDLED) > 0) {
      inject(st[K.code]);
    }

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
        await store.set({ [K.status]: '已是最新 v' + BUNDLED });
        return;
      }

      // 4) 有新版：拉代码、校验、入库、注入
      const code = await fetchText(`${BASE}/${meta.file || 'tiaoyue-ref-helper-ext/content.js'}`);
      if (code.length < CODE_MIN_LEN || !code.includes('__TYQ')) {
        throw new Error('更新内容校验失败');
      }
      await store.set({ [K.code]: code, [K.ver]: online, [K.status]: '已更新到 v' + online });
      inject(code);
    } catch (e) {
      await store.set({ [K.status]: '检查失败：' + (e && e.message ? e.message : e) });
    }
  }

  main();
})();
