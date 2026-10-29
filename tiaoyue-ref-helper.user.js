// ==UserScript==
// @name         跳跃视界 · 画布引用助手（@名字转引用 + Ctrl+F 查找替换）
// @namespace    https://tiaoyue.local
// @version      1.10.2
// @description  在跳跃视界画布提示词框里，把图片名字（如「艾洛文-高级职场套装」）一键转成 @图片N 引用；支持已引用素材清单、定位高亮、转换前预览勾选、撤销历史、面板拖动、Ctrl+F 查找替换。
// @author       WorkBuddy
// @match        https://www.tiaoyue.com/aigc/canvas/*
// @match        https://canvas.tiaoyue.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==


(function () {
  'use strict';
  // 加载守卫：正常只注入一次；loader 热更新时会先置 __TYQ_FORCE_ONCE，
  // 这时允许再次执行，并先清掉旧实例的 UI
  if (window.__TYQ_LOADED__) {
    if (!window.__TYQ_FORCE_ONCE) return;
    window.__TYQ_FORCE_ONCE = false;
    try { if (window.__TYQ_DISPOSE__) window.__TYQ_DISPOSE__(); } catch (e) { /* 忽略 */ }
    document.querySelectorAll('.tyq-launch,.tyq-panel,.tyq-guide-mask,.tyq-pin,#tyq-style').forEach((n) => n.remove());
    delete window.__TYQ;
  } else {
    window.__TYQ_LOADED__ = true;
  }

  // 热更新后旧实例的 document 监听仍然存在：统一用 alive 关掉，避免双份响应 / 重复 toast
  let alive = true;
  window.__TYQ_DISPOSE__ = () => { alive = false; teardown(); };

  // 当前运行版本（build.js 发布时与 @version 同步重写；自更新比对用）
  const TYQ_VERSION = '1.10.2';
  // 自更新源（仓库转移时此处与 ext/config.js 一起改）
  const UPD_REPO = 'Lury-Liu/tiaoyue-canvas-helper';
  const UPD_BRANCH = 'main';

  function verCmp(a, b) {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /* 每次进入画布检查一次线上版本：有新版就拉取并注入接管（blob 脚本，
   * __TYQ_FORCE_ONCE 机制清掉本实例）。失败静默——当前版本继续运行。 */
  let updBusy = false;
  async function selfUpdate() {
    if (updBusy || !alive) return;
    updBusy = true;
    try {
      const base = `https://raw.githubusercontent.com/${UPD_REPO}/${UPD_BRANCH}`;
      const meta = await (await fetch(`${base}/tiaoyue-ref-helper-ext/version.json?t=${Date.now()}`, { cache: 'no-store' })).json();
      const online = String(meta.version || '');
      if (!online || verCmp(online, TYQ_VERSION) <= 0) return;
      const code = await (await fetch(`${base}/${meta.file || 'tiaoyue-ref-helper-ext/content.js'}?t=${Date.now()}`, { cache: 'no-store' })).text();
      if (code.length < 5000 || !code.includes('__TYQ')) return;
      toast(`发现新版 v${online}，已自动更新`, 2500);
      const blob = new Blob(['window.__TYQ_FORCE_ONCE=true;\n', code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => URL.revokeObjectURL(url);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 网络失败等：静默，本版本继续 */ } finally {
      updBusy = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * 0. 基础：无界微前端 DOM 访问
   * ------------------------------------------------------------------ */
  const HOST = () => document.querySelector('wujie-app');
  const SHADOW = () => (HOST() && HOST().shadowRoot) || null;
  const EDITOR_SEL = '[class*="_promptEditor_"]';
  const CANVAS_ROUTE = '/aigc/canvas/';   // 画布路由前缀：启停与 open() 守卫共用

  let lastEditor = null;

  function editors() {
    const r = SHADOW();
    return r ? Array.from(r.querySelectorAll(EDITOR_SEL)) : [];
  }

  function isVisibleEditor(e) {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }

  function activeEditor() {
    const r = SHADOW();
    if (!r) return null;
    let ae = r.activeElement;
    while (ae && ae.shadowRoot && ae.shadowRoot.activeElement) ae = ae.shadowRoot.activeElement;
    const all = editors();
    const hit = all.find((e) => e === ae || e.contains(ae));
    if (hit) { lastEditor = hit; return hit; }

    // 多个节点各有一份编辑器时，all[0] 很可能是隐藏的旧节点：
    // 优先上一次的编辑器（且可见），否则取第一个可见的
    const vis = all.filter(isVisibleEditor);
    if (vis.length) return vis.includes(lastEditor) ? lastEditor : vis[0];
    // 全都不可见：多半是节点正在切换，宁可返回 null 让面板显示提示，也不要渲染旧节点数据
    return null;
  }

  // 找到 CanvasRichInput 组件的 fiber（组件名在压缩后仍保留）
  function richFiber(ed) {
    const k = Object.keys(ed).find((x) => x.startsWith('__reactFiber$'));
    let f = k ? ed[k] : null;
    while (f) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object' && 'referenceItems' in p && 'onChange' in p && 'value' in p) return f;
      f = f.return;
    }
    return null;
  }

  function api(ed) {
    if (!ed || !ed.isConnected) ed = activeEditor();
    if (!ed) return null;
    const f = richFiber(ed);
    if (!f) return null;
    const p = f.memoizedProps;
    return {
      el: ed,
      refs: Array.isArray(p.referenceItems) ? p.referenceItems : [],
      props: p,
      maxLength: p.maxLength,
      set: (text) => {
        const f2 = richFiber(ed);
        if (!f2) return false;
        f2.memoizedProps.onChange(text);
        return true;
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * 1. 文本模型：DOM <-> 纯文本（引用芯片序列化为 @图片N）
   * ------------------------------------------------------------------ */
  function serialize(ed, trimTrailingBreak = true) {
    let t = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { t += c.textContent || ''; continue; }
        if (c.nodeType !== 1) continue;
        if (c.classList && c.classList.contains('canvas-mention')) {
          const tk = c.getAttribute('data-mention-token');
          if (tk) t += '@' + tk;
          continue;
        }
        if (c.tagName === 'BR') { t += '\n'; continue; }
        walk(c);
      }
    };
    walk(ed);
    if (trimTrailingBreak && ed.lastChild && ed.lastChild.tagName === 'BR' && t.endsWith('\n')) t = t.slice(0, -1);
    return t;
  }

  function offsetModel(ed) {
    const atoms = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) atoms.push({ node: c, len: (c.textContent || '').length, kind: 'text' });
        else if (c.nodeType === 1) {
          if (c.classList && c.classList.contains('canvas-mention')) {
            const token = c.getAttribute('data-mention-token');
            if (token) atoms.push({ node: c, len: token.length + 1, kind: 'chip' });
          } else if (c.tagName === 'BR') atoms.push({ node: c, len: 1, kind: 'br' });
          else walk(c);
        }
      }
    };
    walk(ed);
    let length = atoms.reduce((sum, atom) => sum + atom.len, 0);
    if (ed.lastChild && ed.lastChild.tagName === 'BR') length--;
    return { atoms, length };
  }

  function rangeFromOffset(ed, start, end, model = offsetModel(ed)) {
    start = Math.max(0, Math.min(start, model.length));
    end = Math.max(start, Math.min(end == null ? start : end, model.length));
    const locate = (off, isEnd) => {
      let acc = 0;
      for (const a of model.atoms) {
        if (off < acc + a.len || (off === acc + a.len && a.kind === 'text')) {
          const rel = off - acc;
          if (a.kind === 'text') return { node: a.node, offset: rel };
          return { node: a.node.parentNode, offset: idxOf(a.node) + (rel > 0 && isEnd ? 1 : 0) };
        }
        acc += a.len;
      }
      return { node: ed, offset: ed.childNodes.length };
    };
    const idxOf = (node) => Array.prototype.indexOf.call(node.parentNode.childNodes, node);

    try {
      const clampOff = (n, off) => {
        const max = n.nodeType === 3 ? (n.nodeValue || '').length : n.childNodes.length;
        return Math.max(0, Math.min(off, max));
      };
      const s = locate(start, false), e = locate(end, true);
      const r = document.createRange();
      r.setStart(s.node, clampOff(s.node, s.offset));
      r.setEnd(e.node, clampOff(e.node, e.offset));
      return r;
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * 2. 素材索引：名字 -> @图片N
   * ------------------------------------------------------------------ */
  const EXT_RE = /\.(png|jpe?g|webp|bmp|gif|mp4|mov|webm|mp3|wav|m4a|pcm|ogg)$/i;
  const stripExt = (s) => (s || '').replace(EXT_RE, '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 通用上传文件名（原名丢失）：image.png / screenshot_1.jpg / 32 位 hash.png 等。
  // 这类名字出现在正文里多半是粘贴脚本自带的占位，不代表想引用该素材，只做标注不跳过。
  const GENERIC_NAME_RE = /^(image|img|screenshot|screen ?shot|untitled|unnamed|file|avatar|封面|截图|屏幕截图|image \(\d+\))[\s_\-]*\d*$/i;
  const HASH_NAME_RE = /^[0-9a-f]{16,}$/i;
  function isGenericName(s) {
    const bare = stripExt(String(s || '').trim());
    return !!bare && (GENERIC_NAME_RE.test(bare) || HASH_NAME_RE.test(bare));
  }

  function buildIndex(refs) {
    const counters = { image: 0, video: 0, audio: 0 };
    const label = { image: '图片', video: '视频', audio: '音频' };
    return refs
      .map((r) => {
        const t = r.type || 'image';
        counters[t] = (counters[t] || 0) + 1;
        const name = r.assetName || r.nodeTitle || r.name || '未命名';
        return {
          raw: r,
          type: t,
          id: r.id || r.assetFileUuid || r.assetFileId,
          name,
          bare: stripExt(name),
          token: (label[t] || '图片') + counters[t],
          cover: r.coverUrl || r.imageUrl || r.assetsUrl || '',
        };
      })
      .filter((x) => x.token);
  }

  // 名字（含/不含扩展名）按长度倒序，避免短名先吃长名
  function nameMap(index) {
    const m = new Map();
    for (const it of index) {
      if (!it.bare || it.bare.length < 2) continue;
      if (!m.has(it.name)) m.set(it.name, it);
      if (!m.has(it.bare)) m.set(it.bare, it);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].length - a[0].length);
  }

  function convertAll(text, index, skippedTokens) {
    const entries = nameMap(index).filter(([, it]) => !skippedTokens || !skippedTokens.has(it.token));
    let out = text;
    const stats = [];
    for (const [nm, it] of entries) {
      if (!nm || nm.length < 2) continue;
      const re = new RegExp(esc(nm), 'g');
      // 紧跟在同一引用的写法后面（如「@图片1 艾洛文…」）时跳过，避免出现重复引用
      const dupRe = new RegExp('@' + esc(it.token) + '[\\s，。、,.；;：:]*$');
      let n = 0;
      out = out.replace(re, (m, off) => {
        const before = out.slice(Math.max(0, off - 10), off);
        if (dupRe.test(before)) return m;
        n++;
        return '@' + it.token;
      });
      if (n) stats.push({ name: it.name, token: it.token, n });
    }
    return { text: out, stats };
  }

  // 扫描所有可转换的名字（长名优先、去重叠），按出现次数倒序
  function scanMatches(text, index) {
    const entries = nameMap(index);
    const taken = new Uint8Array(text.length);
    const out = new Map();
    for (const [nm, it] of entries) {
      if (!nm || nm.length < 2) continue;
      const re = new RegExp(esc(nm), 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        let free = true;
        for (let i = m.index; i < m.index + nm.length; i++) if (taken[i]) { free = false; break; }
        if (!free) continue;
        for (let i = m.index; i < m.index + nm.length; i++) taken[i] = 1;
        const cur = out.get(it.token) || { name: it.name, token: it.token, count: 0, positions: [], label: nm };
        if (nm.length >= cur.label.length) cur.label = nm;
        cur.count++; cur.positions.push(m.index);
        out.set(it.token, cur);
      }
    }
    return Array.from(out.values()).sort((a, b) => b.count - a.count);
  }

  function countMatches(text, index) {
    return scanMatches(text, index).reduce((s, x) => s + x.count, 0);
  }

  /* ------------------------------------------------------------------ *
   * 2.5 写回与历史（每次写回前存快照，可回退到任意一步）
   * ------------------------------------------------------------------ */
  const MAX_HISTORY = 20;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };
  const POS_KEY = 'tyq.pos.v1';
  const PANEL_POS_KEY = 'tyq.panel.pos.v1';
  const TAB_KEY = 'tyq.tab.v1';

  const elIds = new WeakMap();
  let elSeq = 0;
  const elId = (e) => { if (!elIds.has(e)) elIds.set(e, ++elSeq); return elIds.get(e); };

  const HIST = { key: '', list: [], idx: -1 };
  const nodeHistories = new Map();

  function histKey(a) {
    return nodeKey(a);
  }

  function syncHistory(a) {
    const k = histKey(a);
    if (k === HIST.key) return;
    if (HIST.key) nodeHistories.set(HIST.key, { list: HIST.list, idx: HIST.idx });
    const saved = nodeHistories.get(k);
    HIST.key = k;
    HIST.list = saved ? saved.list : [{ text: serialize(a.el), label: '初始内容', time: Date.now() }];
    HIST.idx = saved ? saved.idx : 0;
  }

  function pushHistory(text, label) {
    HIST.list = HIST.list.slice(0, HIST.idx + 1);
    HIST.list.push({ text, label, time: Date.now() });
    if (HIST.list.length > MAX_HISTORY) HIST.list.shift();
    HIST.idx = HIST.list.length - 1;
  }

  function writeText(text, label, expectedKey) {
    const a = api();
    if (!a) { toast('未找到输入框：请先双击节点'); return false; }
    if (expectedKey && editorKey(a) !== expectedKey) {
      render();
      toast('节点或素材已变化，请重新操作');
      return false;
    }
    syncHistory(a);
    const cur = serialize(a.el);
    if (cur === text) return false;
    if (a.maxLength && text.length > a.maxLength) { toast('超出长度上限'); return false; }
    if (HIST.list[HIST.idx].text !== cur) pushHistory(cur, '手动编辑');
    if (!a.set(text)) { toast('写入失败：请重新双击节点后再试'); return false; }
    pushHistory(text, label || '编辑');
    return true;
  }

  function goToHistory(i, expectedKey) {
    const a = api();
    if (!a) return;
    if (expectedKey && histKey(a) !== expectedKey) {
      render();
      toast('节点已切换，请重新操作');
      return;
    }
    syncHistory(a);
    const target = HIST.list[i];
    if (!target) return;
    const cur = serialize(a.el);
    if (cur === target.text) { HIST.idx = i; return; }
    if (cur !== HIST.list[HIST.idx].text) pushHistory(cur, '手动编辑');
    if (!a.set(target.text)) { toast('写入失败：请重新双击节点后再试'); return; }
    const at = HIST.list.indexOf(target);
    if (at === -1) pushHistory(target.text, target.label);
    else HIST.idx = at;
    toast('已回到：' + target.label);
  }

  const undo = () => { captureManualEdit(); goToHistory(HIST.idx - 1); };
  const redo = () => { captureManualEdit(); goToHistory(HIST.idx + 1); };

  /* ------------------------------------------------------------------ *
   * 3. UI
   * ------------------------------------------------------------------ */
  const CSS = `
  .tyq-launch{position:fixed;right:18px;bottom:96px;z-index:2147483000;width:44px;height:44px;border-radius:22px;
    background:linear-gradient(145deg,#3b82f6,#7c3aed);color:#fff;font:600 18px/44px system-ui,-apple-system,'Segoe UI',sans-serif;
    text-align:center;cursor:grab;box-shadow:0 6px 20px rgba(0,0,0,.35);user-select:none;touch-action:none;
    transition:transform .15s,filter .15s}
  .tyq-launch.dragging{cursor:grabbing;transition:none}
  .tyq-launch:hover{transform:translateY(-1px);filter:brightness(1.08)}
  .tyq-launch.dragging:hover{transform:none}
  .tyq-launch .tyq-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;
    color:#fff;font:600 11px/18px system-ui;padding:0 5px;box-sizing:border-box;display:none}
  .tyq-panel{position:fixed;right:18px;bottom:150px;z-index:2147483001;width:372px;max-height:70vh;display:none;flex-direction:column;
    background:#17181c;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);
    color:#e5e7eb;font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden}
  .tyq-panel.open{display:flex}
  .tyq-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move;user-select:none}
  .tyq-head:active{cursor:grabbing}
  .tyq-panel.dragging{user-select:none;box-shadow:0 26px 60px rgba(0,0,0,.65)}
  .tyq-title{font-weight:600;font-size:13px;flex:1}
  .tyq-x{cursor:pointer;color:#9ca3af;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
  .tyq-x:hover{background:rgba(255,255,255,.08);color:#fff}
  .tyq-tabs{display:flex;gap:4px;padding:8px 10px 0}
  .tyq-tab{flex:1;text-align:center;padding:6px 0;border-radius:8px;cursor:pointer;color:#9ca3af;font-size:12px}
  .tyq-tab.on{background:rgba(59,130,246,.16);color:#93c5fd}
  .tyq-body{padding:10px 12px 12px;overflow:auto}
  .tyq-input{width:100%;box-sizing:border-box;background:#0f1013;border:1px solid rgba(255,255,255,.12);border-radius:8px;
    color:#e5e7eb;padding:7px 9px;font-size:13px;outline:none;font-family:inherit}
  .tyq-input:focus{border-color:#3b82f6}
  .tyq-row{display:flex;gap:6px;margin-top:8px}
  .tyq-btn{flex:1;padding:7px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#22242a;color:#e5e7eb;
    font-size:12px;cursor:pointer;white-space:nowrap}
  .tyq-btn:hover{background:#2c2f37}
  .tyq-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
  .tyq-btn.primary:hover{background:#1d4ed8}
  .tyq-hint{color:#9ca3af;font-size:11.5px;margin-top:8px;line-height:1.5}
  .tyq-check{display:flex;align-items:center;gap:6px;margin-top:8px;color:#9ca3af;font-size:12px;cursor:pointer;user-select:none}
  .tyq-check input{accent-color:#3b82f6;margin:0;cursor:pointer}
  .tyq-token{flex:none;font-size:11px;color:#93c5fd;background:rgba(59,130,246,.15);border-radius:6px;padding:1px 6px}
  .tyq-empty{color:#6b7280;font-size:12px;padding:14px 4px;text-align:center}
  .tyq-count{color:#a3e635;font-size:12px}
  .tyq-btn:disabled{opacity:.45;cursor:not-allowed}
  .tyq-sub{font-size:11px;color:#8b94a3;margin:10px 0 4px;letter-spacing:.3px}
  .tyq-matches{max-height:150px;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:8px;
    padding:4px 6px;margin-top:6px;background:rgba(255,255,255,.02)}
  .tyq-match{display:flex;align-items:center;gap:6px;padding:3px 2px;font-size:12px;border-radius:6px}
  .tyq-match:hover{background:rgba(255,255,255,.05)}
  .tyq-match.off{opacity:.42}
  .tyq-match input{accent-color:#3b82f6;margin:0;flex:none;cursor:pointer}
  .tyq-mname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d7dbe2;cursor:pointer}
  .tyq-mname:hover{color:#93c5fd;text-decoration:underline}
  .tyq-mcnt{flex:none;font-size:11px;color:#fbbf24}
  .tyq-preview{width:100%;box-sizing:border-box;margin-top:8px;height:96px;resize:vertical;background:#0f1013;
    border:1px solid rgba(59,130,246,.35);border-radius:8px;color:#c7cdd6;padding:7px 9px;
    font-family:inherit;font-size:11.5px;line-height:1.55;outline:none}
  .tyq-hist{max-height:46vh;overflow:auto;margin-top:4px}
  .tyq-hrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:12px}
  .tyq-hrow:hover{background:rgba(255,255,255,.06)}
  .tyq-hrow.now{background:rgba(59,130,246,.16)}
  .tyq-htime{flex:none;color:#6b7280;font-size:11px;font-variant-numeric:tabular-nums}
  .tyq-hlabel{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d7dbe2}
  .tyq-hnow{flex:none;font-size:10.5px;color:#93c5fd;border:1px solid rgba(147,197,253,.4);border-radius:5px;padding:0 4px}
  .tyq-cited{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .tyq-citem{display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.06);
    border:1px solid rgba(255,255,255,.1);cursor:pointer;font-size:11.5px;max-width:100%}
  .tyq-citem:hover{background:rgba(96,165,250,.16);border-color:rgba(96,165,250,.5)}
  .tyq-cthumb{width:16px;height:16px;border-radius:3px;object-fit:cover;background:#000;flex:none}
  .tyq-cname{max-width:118px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d7dbe2}
  .tyq-pin{position:fixed;pointer-events:none;border:2px solid #60a5fa;border-radius:5px;z-index:2147483004;
    box-shadow:0 0 0 3px rgba(96,165,250,.25),0 0 18px rgba(96,165,250,.6);display:none}
  .tyq-hl{position:fixed;pointer-events:none;border-radius:3px;background:rgba(250,204,21,.30);
    box-shadow:0 0 0 1px rgba(250,204,21,.55);z-index:2147482998;display:none}
  .tyq-hl.now{background:rgba(96,165,250,.40);box-shadow:0 0 0 1px rgba(96,165,250,.95),0 0 10px rgba(96,165,250,.55);z-index:2147482999}
  .tyq-badge{flex:none;font-size:10px;color:#fbbf24;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.35);
    border-radius:5px;padding:0 5px;line-height:16px;cursor:help}
  .tyq-fbox{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:4px 6px;margin-top:6px;
    background:rgba(255,255,255,.02);max-height:132px;overflow:auto}
  .tyq-fmatch{display:flex;align-items:center;gap:6px;padding:3px 2px;font-size:12px;border-radius:6px;cursor:pointer}
  .tyq-fmatch:hover{background:rgba(96,165,250,.12)}
  /* 隐藏画布自带的"跳跃AI"悬浮助手（gc-float 触发钮 + 面板），只保留本插件 */
  .gc-float{display:none!important}
  .tyq-help{flex:none;cursor:pointer;color:#9ca3af;width:18px;height:18px;border-radius:9px;
    border:1px solid rgba(255,255,255,.22);text-align:center;font:600 12px/17px system-ui}
  .tyq-help:hover{color:#fff;border-color:rgba(255,255,255,.6)}
  .tyq-warn{color:#fbbf24;font-size:11.5px;margin-top:8px;line-height:1.55}
  .tyq-warn code{background:rgba(255,255,255,.1);border-radius:4px;padding:0 3px;font-family:ui-monospace,Consolas,monospace;font-size:11px}
  .tyq-guide-mask{position:fixed;inset:0;z-index:2147483005;background:rgba(0,0,0,.55);display:flex;align-items:center;
    justify-content:center;padding:24px;backdrop-filter:blur(2px)}
  .tyq-guide{width:540px;max-width:100%;max-height:86vh;display:flex;flex-direction:column;background:#17181c;
    border:1px solid rgba(255,255,255,.14);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e5e7eb;
    font:13px/1.65 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden}
  .tyq-ghead{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
  .tyq-gtitle{flex:1;font-weight:600;font-size:14px}
  .tyq-gbody{padding:10px 16px 6px;overflow:auto}
  .tyq-gsec{font-size:11.5px;color:#8b94a3;margin:10px 0 2px;letter-spacing:.3px}
  .tyq-gsteps{margin:4px 0 0;padding-left:18px;color:#cfd5de}
  .tyq-gsteps li{margin:4px 0}
  .tyq-gsteps b{color:#fff;font-weight:600}
  .tyq-gwarn{margin:12px 0 2px;padding:10px 12px;border-radius:10px;border:1px solid rgba(245,158,11,.35);
    background:rgba(245,158,11,.09)}
  .tyq-gwarn-t{color:#fbbf24;font-weight:600;font-size:12.5px;margin-bottom:4px}
  .tyq-gwarn p{margin:4px 0;font-size:12.5px;color:#e3d7c3}
  .tyq-gwarn code{background:rgba(255,255,255,.1);border-radius:4px;padding:0 4px;
    font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:#fde68a}
  .tyq-gfoot{display:flex;gap:8px;padding:10px 16px 14px;border-top:1px solid rgba(255,255,255,.08)}
  .tyq-gfoot .tyq-btn{flex:1;padding:8px 10px}
  `;

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function injectStyle() {
    if (document.getElementById('tyq-style')) return;
    const s = document.createElement('style');
    s.id = 'tyq-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  let ui = null;
  let activeTab = 'asset';
  let panelPos = null;     // 手动拖动后的面板位置；null = 跟随悬浮球

  function buildUI() {
    injectStyle();
    const launch = el('div', 'tyq-launch', '＠');
    launch.title = '引用助手（Alt+A）· 可拖动';
    launch.appendChild(el('span', 'tyq-badge', '0'));

    const panel = el('div', 'tyq-panel');
    panel.innerHTML = `
      <div class="tyq-head">
        <span class="tyq-title">引用助手</span>
        <span class="tyq-help" data-act="help" title="查看上手指南">?</span>
        <span class="tyq-x" data-act="close">×</span>
      </div>
      <div class="tyq-tabs">
        <div class="tyq-tab on" data-tab="asset">素材 / 转引用</div>
        <div class="tyq-tab" data-tab="find">查找替换</div>
        <div class="tyq-tab" data-tab="hist">历史</div>
      </div>
      <div class="tyq-body" data-body></div>
    `;

    document.body.appendChild(launch);
    document.body.appendChild(panel);
    ui = { launch, panel, body: panel.querySelector('[data-body]'), badge: launch.querySelector('.tyq-badge') };

    // 还原上次位置
    const pos = LS.get(POS_KEY, null);
    if (pos && typeof pos.left === 'number') {
      launch.style.left = Math.max(6, Math.min(window.innerWidth - 50, pos.left)) + 'px';
      launch.style.top = Math.max(6, Math.min(window.innerHeight - 50, pos.top)) + 'px';
      launch.style.right = 'auto';
      launch.style.bottom = 'auto';
    }
    const savedTab = LS.get(TAB_KEY, activeTab);
    activeTab = ['asset', 'find', 'hist'].includes(savedTab) ? savedTab : 'asset';

    // 拖动悬浮球：位移超过 4px 才算拖动，否则当作点击
    let drag = null;
    launch.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = launch.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      try { launch.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    launch.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      launch.classList.add('dragging');
      const w = launch.offsetWidth || 44, h = launch.offsetHeight || 44;
      launch.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, e.clientX - drag.dx)) + 'px';
      launch.style.top = Math.max(6, Math.min(window.innerHeight - h - 6, e.clientY - drag.dy)) + 'px';
      launch.style.right = 'auto';
      launch.style.bottom = 'auto';
    });
    launch.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      launch.classList.remove('dragging');
      if (!moved) { toggle(); return; }
      const r = launch.getBoundingClientRect();
      LS.set(POS_KEY, { left: Math.round(r.left), top: Math.round(r.top) });
      placePanel();
    });
    launch.addEventListener('pointercancel', () => { drag = null; launch.classList.remove('dragging'); });

    panel.querySelector('[data-act="close"]').addEventListener('click', () => close());
    panel.querySelector('[data-act="help"]').addEventListener('click', () => showGuide());
    panel.querySelectorAll('.tyq-tab').forEach((t) =>
      t.addEventListener('click', () => { activeTab = t.dataset.tab; LS.set(TAB_KEY, activeTab); if (activeTab === 'hist') captureManualEdit(); clearPin(); render(); })
    );

    // 面板拖动：抓标题栏；位置记本地，双击标题栏复位成「跟随悬浮球」
    panelPos = LS.get(PANEL_POS_KEY, null);
    if (!panelPos || typeof panelPos.left !== 'number') panelPos = null;

    const head = panel.querySelector('.tyq-head');
    head.title = '拖动可移动面板 · 双击复位';
    let pdrag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.tyq-x,.tyq-help')) return;
      const r = panel.getBoundingClientRect();
      pdrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    head.addEventListener('pointermove', (e) => {
      if (!pdrag) return;
      if (!pdrag.moved && Math.hypot(e.clientX - pdrag.sx, e.clientY - pdrag.sy) < 3) return;
      pdrag.moved = true;
      panel.classList.add('dragging');
      const w = panel.offsetWidth || 372, h = panel.offsetHeight || 300;
      panel.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, e.clientX - pdrag.dx)) + 'px';
      panel.style.top = Math.max(6, Math.min(window.innerHeight - h - 6, e.clientY - pdrag.dy)) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    head.addEventListener('pointerup', () => {
      if (!pdrag) return;
      const moved = pdrag.moved;
      pdrag = null;
      panel.classList.remove('dragging');
      if (!moved) return;
      const r = panel.getBoundingClientRect();
      panelPos = { left: Math.round(r.left), top: Math.round(r.top) };
      LS.set(PANEL_POS_KEY, panelPos);
    });
    head.addEventListener('pointercancel', () => { pdrag = null; panel.classList.remove('dragging'); });
    head.addEventListener('dblclick', () => {
      panelPos = null;
      LS.del(PANEL_POS_KEY);
      placePanel();
      toast('面板已复位：以后跟随悬浮球摆放');
    });

    refreshBadge();
    watchEditorContent(activeEditor());
    editorMO = new MutationObserver(() => {
      clearTimeout(editorTimer);
      editorTimer = setTimeout(syncPanelToEditor, 80);
    });
    const root = SHADOW();
    if (root) editorMO.observe(root, { childList: true, subtree: true });
  }

  // 面板默认贴着悬浮球摆；手动拖过之后就固定在拖到的位置
  function placePanel() {
    if (!ui || !ui.panel.classList.contains('open')) return;
    const p = ui.panel;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = p.offsetWidth || 372;
    const ph = p.offsetHeight || Math.round(vh * 0.6);
    if (panelPos) {
      p.style.left = Math.max(6, Math.min(vw - pw - 6, panelPos.left)) + 'px';
      p.style.top = Math.max(6, Math.min(vh - ph - 6, panelPos.top)) + 'px';
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      return;
    }
    const b = ui.launch.getBoundingClientRect();
    let left = b.left + b.width / 2 > vw / 2 ? b.left - pw - 12 : b.right + 12;
    left = Math.max(12, Math.min(vw - pw - 12, left));
    let top = b.top + b.height / 2 - ph / 2;
    top = Math.max(12, Math.min(vh - ph - 12, top));
    if (!isFinite(top) || top < 12) top = 12;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.style.right = 'auto';
    p.style.bottom = 'auto';
  }

  /* ---------------- 首次使用引导 ---------------- */
  const GUIDE_KEY = 'tyq.guide.v1';

  function showGuide() {
    if (document.querySelector('.tyq-guide-mask')) return;
    injectStyle();
    const mask = el('div', 'tyq-guide-mask');
    mask.innerHTML = `
      <div class="tyq-guide">
        <div class="tyq-ghead">
          <span class="tyq-gtitle">引用助手 · 上手指南</span>
          <span class="tyq-x" data-act="gx">×</span>
        </div>
        <div class="tyq-gbody">
          <div class="tyq-gsec">怎么用（4 步）</div>
          <ol class="tyq-gsteps">
            <li><b>双击画布上的节点</b>，底部弹出提示词框（输入框在「全部参考」上方）。</li>
            <li>点右下角 <b>＠</b> 或按 <b>Alt+A</b> 打开面板。<b>面板和悬浮球都能拖动</b>，双击面板标题栏回到自动跟随。</li>
            <li>勾选要转的素材 → <b>预览结果</b> 核对 → <b>转换选中项</b> 写回；按 <b>Alt+Z</b> 随时撤销。</li>
            <li>勾选 / 预览 / 转换后，<b>Alt+Z</b> 可撤销；<b>Ctrl+F</b> 查找替换。</li>
          </ol>
          <div class="tyq-gwarn">
            <div class="tyq-gwarn-t">⚠ 先看这条：素材名不一定会保留</div>
            <p>只有通过画布 <b>「添加资源 → 上传」</b>（或节点上的上传入口）进来的素材，才会<b>保留原始文件名</b>，插件才能按名字找到它。</p>
            <p>从其他节点、网页或桌面<b>直接拖入 / 复制粘贴</b>进来的素材，名字会统一变成 <code>image.png</code> 这类默认名 —— 这时<b>按名字转换会失效或指错素材</b>。</p>
            <p>遇到这种情况：重新用「上传」导入一次，让原始文件名保留下来。</p>
          </div>
          <div class="tyq-gsec">两个按钮的区别</div>
          <ul class="tyq-gsteps">
            <li><b>转换选中项（N 处）</b>：改写整段提示词里所有命中的名字。</li>
            <li><b>仅改写选中的文字</b>：只改你在提示词里<b>手动选中</b>的那一小段，适合长提示词局部替换。</li>
          </ul>
        </div>
        <div class="tyq-gfoot">
          <button class="tyq-btn" data-act="gopen">打开面板</button>
          <button class="tyq-btn primary" data-act="gok">知道了，不再自动弹出</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);

    const done = (remember) => {
      if (remember) LS.set(GUIDE_KEY, true);
      mask.remove();
    };
    mask.addEventListener('click', (e) => { if (e.target === mask) done(true); });
    mask.querySelector('[data-act="gx"]').addEventListener('click', () => done(true));
    mask.querySelector('[data-act="gok"]').addEventListener('click', () => done(true));
    mask.querySelector('[data-act="gopen"]').addEventListener('click', () => { done(false); open('asset'); });
  }

  function maybeShowGuide() {
    if (LS.get(GUIDE_KEY, false)) return;
    showGuide();
  }

  function isOpen() { return ui && ui.panel.classList.contains('open'); }

  function open(tab) {
    // 已离开画布路由时，残留的快捷键/悬浮球点击不应再重建面板
    if (!location.pathname.includes(CANVAS_ROUTE)) return;
    if (!ui) buildUI();
    if (tab) { activeTab = tab; LS.set(TAB_KEY, tab); }
    ui.panel.classList.add('open');
    render();
    placePanel();
    requestAnimationFrame(placePanel);
  }

  function close() {
    if (!ui) return;
    clearPin();
    clearFindHL();
    ui.panel.classList.remove('open');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function toast(msg, ms = 2000) {
    if (!ui) return;
    const t = el('div', '', msg);
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483002;background:#111827;color:#fff;' +
      'padding:8px 14px;border-radius:8px;font:12.5px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:.96';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function refreshBadge() {
    if (!ui) return;
    if (!SHADOW()) { ui.launch.style.display = 'none'; ui.panel.classList.remove('open'); return; }
    ui.launch.style.display = 'block';
    const a = api();
    if (!a) { ui.badge.style.display = 'none'; return; }
    const n = countMatches(serialize(a.el), buildIndex(a.refs));
    ui.badge.textContent = n;
    ui.badge.style.display = n > 0 ? 'block' : 'none';
  }

  /* ---------------- 面板渲染 ---------------- */
  let unchecked = new Set();   // 被取消勾选的素材 token
  let uncheckedNodeKey = '';   // 勾选状态所属节点，切节点时清空
  let previewOn = false;
  let jumpState = { token: '', i: 0 };
  let lastRenderKey = '';      // 当前面板内容对应的「编辑器 + 素材」指纹

  function nodeKey(a) {
    const p = (a && a.props) || {};
    const nid = p.nodeId || p.nodeUuid || (p.node && p.node.id) || '';
    return nid ? 'n:' + nid : 'e:' + elId(a.el);
  }

  // 面板内容指纹：节点 id + 参考素材（id/名字）。切节点、增删素材都会变。
  function editorKey(a) {
    if (!a) return '';
    const sig = (a.refs || [])
      .map((r) => (r.id || r.assetFileId || r.assetFileUuid || '') + ':' + (r.assetName || r.nodeTitle || r.name || ''))
      .join('|');
    return nodeKey(a) + '#' + (a.refs || []).length + '#' + sig;
  }

  function render() {
    clearPin();
    clearFindHL();
    findRefreshHook = null;
    if (!ui) return;
    ui.panel.querySelectorAll('.tyq-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === activeTab));
    const body = ui.body;
    body.innerHTML = '';

    const a = api();
    if (!a) {
      lastRenderKey = '';
      body.appendChild(el('div', 'tyq-empty', '未找到提示词输入框：请先在画布上双击一个节点，打开底部提示词面板。'));
      return;
    }
    lastRenderKey = editorKey(a);
    watchEditorContent(a.el);
    const nk = nodeKey(a);
    if (nk !== uncheckedNodeKey) { uncheckedNodeKey = nk; unchecked.clear(); previewOn = false; findState.last = -1; findState.useRef = ''; }
    const index = buildIndex(a.refs);
    if (activeTab === 'asset') renderAsset(body, a, index);
    else if (activeTab === 'hist') renderHistory(body, a);
    else renderFind(body, a, index);
    placePanel();
  }

  // 勾选 / 预览这类面板内重绘：保留滚动位置，别把列表弹回顶部
  function rerenderKeepScroll() {
    if (!ui) return;
    const st = ui.body.scrollTop;
    render();
    ui.body.scrollTop = st;
  }

  // 面板开着时切到别的节点/输入框，立刻换成那个节点的素材列表。
  // 原来只在「重新打开面板」时渲染，所以会出现列表不刷新、要关掉再开的情况。
  function syncPanelToEditor() {
    if (!alive || !ui) return;
    const a = api();
    watchEditorContent(a && a.el);
    if (!isOpen() || editorKey(a) === lastRenderKey) return;
    rerenderKeepScroll();
    refreshBadge();
  }

  function renderAsset(body, a, index) {
    const key = editorKey(a);
    const text = serialize(a.el);
    const matches = scanMatches(text, index);
    const valid = new Set(index.map((x) => x.token));
    Array.from(unchecked).forEach((t) => { if (!valid.has(t)) unchecked.delete(t); });
    const picked = matches.filter((m) => !unchecked.has(m.token));
    const total = picked.reduce((s, x) => s + x.count, 0);

    // —— 概览 ——
    const hint = el('div', 'tyq-hint');
    hint.innerHTML = matches.length
      ? `检出 <span class="tyq-count">${total}</span> 处可转换的名字${unchecked.size ? `（已跳过 ${unchecked.size} 个素材）` : ''}。`
      : '提示词里暂无可识别的素材名字。';
    body.appendChild(hint);

    // —— 已引用素材：正文里已经存在的 @图片N（不管名字还在不在） ——
    const cited = scanCitations(text, index);
    if (cited.length) {
      const citedTotal = cited.reduce((s, c) => s + c.count, 0);
      body.appendChild(el('div', 'tyq-sub', `已引用素材（${cited.length} 个 · ${citedTotal} 处）`));
      const wrap = el('div', 'tyq-cited');
      cited.forEach((c) => {
        const chip = el('span', 'tyq-citem');
        if (c.cover) {
          const im = el('img', 'tyq-cthumb');
          im.src = c.cover; im.loading = 'lazy';
          chip.appendChild(im);
        }
        chip.appendChild(el('span', 'tyq-cname', c.name));
        chip.appendChild(el('span', 'tyq-token', c.token));
        chip.appendChild(el('span', 'tyq-mcnt', '×' + c.count));
        chip.title = `点击定位到正文里的 ${c.token}（重复点击跳下一处）`;
        chip.addEventListener('click', () => jumpToken(c.token));
        wrap.appendChild(chip);
      });
      body.appendChild(wrap);
    }

    // —— 同名素材提醒（拖入/复制的素材会统一叫 image.png） ——
    const byName = new Map();
    index.forEach((it) => {
      if (!byName.has(it.bare)) byName.set(it.bare, []);
      byName.get(it.bare).push(it.token);
    });
    const dupNames = Array.from(byName.entries()).filter(([, arr]) => arr.length > 1).sort((a, b) => b[1].length - a[1].length);
    if (dupNames.length) {
      const w = el('div', 'tyq-warn');
      const code = document.createElement('code');
      code.textContent = dupNames[0][0];
      w.appendChild(document.createTextNode(`有 ${dupNames.length} 组素材同名（如 `));
      w.appendChild(code);
      w.appendChild(document.createTextNode(` 对应 ${dupNames[0][1].join('、')}）：多半不是经「上传」导入，原名已丢；按名字转换会指错，建议重新上传一次保留原名。`));
      body.appendChild(w);
    }

    // —— 检出清单（取消勾选可跳过） ——
    if (matches.length) {
      const box = el('div', 'tyq-matches');
      matches.forEach((m) => {
        const row = el('div', 'tyq-match' + (unchecked.has(m.token) ? ' off' : ''));
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !unchecked.has(m.token);
        cb.title = '取消勾选则跳过这个素材';
        cb.addEventListener('change', () => {
          if (cb.checked) unchecked.delete(m.token); else unchecked.add(m.token);
          rerenderKeepScroll();
        });
        row.appendChild(cb);
        const nm = el('span', 'tyq-mname', m.label);
        nm.title = '点击定位到原文（重复点击跳到下一处）';
        nm.addEventListener('click', () => jumpTo(m));
        row.appendChild(nm);
        if (isGenericName(m.name) || isGenericName(m.label)) {
          const bd = el('span', 'tyq-badge', '通用文件名');
          bd.title = '素材原名已丢失（如 image.png）。正文里同样写法的文字可能不是指这个素材，转换前请核对。';
          row.appendChild(bd);
        }
        row.appendChild(el('span', 'tyq-token', m.token));
        row.appendChild(el('span', 'tyq-mcnt', '×' + m.count));
        box.appendChild(row);
      });
      body.appendChild(box);
    }

    const row1 = el('div', 'tyq-row');
    const convertBtn = el('button', 'tyq-btn primary', total ? `转换选中项（${total} 处）` : '没有可转换的内容');
    convertBtn.disabled = !total;
    const prevBtn = el('button', 'tyq-btn', previewOn ? '收起预览' : '预览结果');
    row1.appendChild(convertBtn); row1.appendChild(prevBtn);
    body.appendChild(row1);

    const row2 = el('div', 'tyq-row');
    const runBtn = el('button', 'tyq-btn', '仅改写选中的文字');
    runBtn.title = '先在提示词里选中一段文字，再点这里：只转换选区内的名字，其他地方不动';
    runBtn.disabled = !matches.length;
    row2.appendChild(runBtn);
    body.appendChild(row2);
    body.appendChild(el('div', 'tyq-hint', '「仅改写选中的文字」= 只处理你在提示词里手动选中的那一小段。'));

    if (previewOn) {
      const ta = document.createElement('textarea');
      ta.className = 'tyq-preview';
      ta.readOnly = true;
      ta.value = convertAll(text, index, unchecked).text;
      body.appendChild(ta);
      body.appendChild(el('div', 'tyq-hint', '预览：上面是写回后的正文，@图片N 即引用。确认无误再点「转换选中项」。'));
    }

    prevBtn.addEventListener('click', () => { previewOn = !previewOn; rerenderKeepScroll(); });

    convertBtn.addEventListener('click', () => {
      const { text: out, stats } = convertAll(serialize(a.el), index, unchecked);
      if (!stats.length) { toast('没有可转换的名字'); return; }
      const n = stats.reduce((s, x) => s + x.n, 0);
      if (!writeText(out, `转引用 ${n} 处`, key)) return;
      previewOn = false;
      toast(`已转换 ${n} 处（${stats.map((s) => s.token).join('、')}），Alt+Z 可撤销`);
    });

    runBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    runBtn.addEventListener('click', () => {
      const ed = a.el;
      const sel = editorSelection(ed);
      if (!sel || !sel.rangeCount || !ed.contains(sel.getRangeAt(0).startContainer) || !ed.contains(sel.getRangeAt(0).endContainer)) { toast('请先在提示词里选中一段文字'); return; }
      const s = caretOffsetRange(ed, sel.getRangeAt(0));
      if (!s || s.start === s.end) { toast('未选中文本'); return; }
      const current = serialize(ed);
      const seg = current.slice(s.start, s.end);
      const { text: outSeg, stats } = convertAll(seg, index, unchecked);
      if (!stats.length) { toast('选区内没有可识别的名字'); return; }
      const out = current.slice(0, s.start) + outSeg + current.slice(s.end);
      if (!writeText(out, '选区转引用', key)) return;
      toast(`选区内已转换 ${stats.reduce((x, y) => x + y.n, 0)} 处，Alt+Z 可撤销`);
    });
  }

  // 正文里已经出现的 @图片N（按出现顺序）
  function scanCitations(text, index) {
    const map = new Map(index.map((x) => [x.token, x]));
    const out = new Map();
    const re = new RegExp('@(图片|视频|音频)(\\d+)', 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const tk = m[1] + m[2];
      const it = map.get(tk);
      const cur = out.get(tk) || { token: tk, name: it ? it.name : '未接入本节点的素材', count: 0, cover: it ? it.cover : '' };
      cur.count++;
      out.set(tk, cur);
    }
    return Array.from(out.values());
  }

  // 编辑器在 wujie 的 shadow 树里：window.getSelection() 拿到的是被重定向到
  // host 的 range（起点不在编辑器内），读选区必须用编辑器所在树的 selection
  function editorSelection(ed) {
    const root = ed.getRootNode();
    return root && root.getSelection ? root.getSelection() : window.getSelection();
  }

  function selectRange(ed, r) {
    try {
      try { ed.focus({ preventScroll: true }); } catch (e2) { ed.focus(); }
      const s = editorSelection(ed);
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) { /* 忽略 */ }
  }

  // 只有目标不在可视区才滚，且用瞬时滚动（smooth 会让高亮框和内容错位、看起来上下跳）
  function isScrollable(el) {
    try {
      const cs = getComputedStyle(el);
      return /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
    } catch (e) { return false; }
  }

  // 会裁掉内容的容器（overflow 非 visible）：高亮框要按它裁剪，不只是可滚动容器
  function isClipper(el) {
    try {
      const cs = getComputedStyle(el);
      return /(auto|scroll|overlay|hidden)/.test(cs.overflowX) || /(auto|scroll|overlay|hidden)/.test(cs.overflowY);
    } catch (e) { return false; }
  }

  // 取 Range 的矩形；折叠 Range / 空文本节点可能拿不到，退一层再试
  function rangeRect(r) {
    let rect = null;
    try { rect = r.getBoundingClientRect(); } catch (e) { rect = null; }
    if (!rect || (!rect.width && !rect.height)) {
      try {
        const rects = r.getClientRects ? r.getClientRects() : null;
        if (rects && rects.length) rect = rects[0];
      } catch (e) { /* 忽略 */ }
    }
    if (!rect || (!rect.width && !rect.height)) {
      const n = r.startContainer && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
      if (n && n.getBoundingClientRect) {
        const nr = n.getBoundingClientRect();
        if (nr && (nr.width || nr.height)) rect = nr;
      }
    }
    return rect;
  }

  // 逐级滚动所有可滚动祖先：应用的提示词区是自绘滚动容器，单靠 scrollIntoView 不一定管用
  function scrollRangeIntoView(r) {
    try {
      let rect = rangeRect(r);
      if (!rect) return;
      const vh = window.innerHeight;

      // 收集祖先，找出所有可滚动容器（由近到远）
      const chain = [];
      let n = r.startContainer && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
      for (let i = 0; i < 6 && n && n !== document.body; i++) { chain.push(n); n = n.parentElement; }
      const scrollers = chain.filter(isScrollable);
      const near = scrollers[0] || null;

      // 可见性要按“最近的滚动容器”来算，不能只看视口：
      // 目标在视口内但被容器裁掉时，旧逻辑会误判成“已可见”而不滚动
      const clip = near ? near.getBoundingClientRect() : { top: 0, bottom: vh };
      const topLimit = Math.max(clip.top, 0) + 12;
      const bottomLimit = Math.min(clip.bottom, vh) - 12;
      if (rect.top >= topLimit && rect.bottom <= bottomLimit) return;

      for (const sc of scrollers) {
        const cr = sc.getBoundingClientRect();
        const delta = (rect.top - cr.top) - sc.clientHeight / 3;
        const next = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + delta));
        if (Math.abs(next - sc.scrollTop) > 1) {
          sc.scrollTop = next;
          rect = rangeRect(r);            // 每滚一层重新量
        }
        if (rect && rect.top >= cr.top + 12 && rect.bottom <= cr.bottom - 12) break;
      }

      // 页面级兜底（滚动容器都处理完还看不见才动页面）
      const r2 = rangeRect(r);
      if (r2 && (r2.top < 0 || r2.bottom > vh)) {
        const host = r2 && r.startContainer.parentElement;
        if (host && host.scrollIntoView) host.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    } catch (e) { /* 忽略 */ }
  }

  // 高亮框逐帧跟随目标，滚动或重排都不会“飞走”
  let pinBox = null;

  // 目标的可见裁剪区：编辑器本体 + 各级滚动容器。文本滚出面板后框要一起消失，
  // 否则会浮在面板外（截图里跑到视频上的那个框）。所有裁剪区都要满足才算可见。
  function pinClipRects(r) {
    const out = [];
    let n = r.startContainer && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
    for (let i = 0; i < 8 && n && n !== document.body; i++) {
      if (n.nodeType === 1 && (n.matches(EDITOR_SEL) || isClipper(n))) {
        const cr = n.getBoundingClientRect();
        if (cr.height > 0) out.push(cr);
      }
      n = n.parentElement;
    }
    return out;
  }

  function followLoop(box, r, onLost) {
    let miss = 0;        // 连续取不到矩形 = 目标已被重渲染拆除
    let hiddenAt = 0;    // 滚出可视区的起始时刻；藏超 5s 就撤掉，别空转 rAF
    const tick = () => {
      if (!box.isConnected) return;
      const rect = r.getBoundingClientRect();
      const hasRect = !!(rect && (rect.width || rect.height));
      const clips = hasRect ? pinClipRects(r) : [];
      const inClip = clips.every((c) => rect.bottom > c.top + 1 && rect.top < c.bottom - 1 &&
        rect.right > c.left + 1 && rect.left < c.right - 1);
      const inView = hasRect && rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth;
      if (hasRect && inClip && inView) {
        miss = 0; hiddenAt = 0;
        box.style.display = 'block';
        box.style.left = (rect.left - 3) + 'px';
        box.style.top = (rect.top - 3) + 'px';
        box.style.width = Math.max(rect.width + 6, 6) + 'px';
        box.style.height = Math.max(rect.height + 6, 6) + 'px';
      } else {
        box.style.display = 'none';
        if (!hasRect) {
          if (++miss > 6) { box.remove(); if (onLost) onLost(); return; }
        } else {
          miss = 0;
          if (!hiddenAt) hiddenAt = performance.now();
          else if (performance.now() - hiddenAt > 5000) { box.remove(); if (onLost) onLost(); return; }
        }
      }
      box.__raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(box.__raf || 0);
    tick();
  }

  // 定位高亮：单例常驻。快速连点只是换目标，不会叠出一堆框
  function setPin(r, cls) {
    if (!pinBox) {
      pinBox = el('div', 'tyq-pin');
      document.body.appendChild(pinBox);
    }
    pinBox.className = 'tyq-pin' + (cls ? ' ' + cls : '');
    pinBox.style.display = 'none';
    followLoop(pinBox, r, () => { pinBox = null; });
  }

  function clearPin() {
    if (pinBox) { cancelAnimationFrame(pinBox.__raf || 0); pinBox.remove(); pinBox = null; }
  }

  // 定位：找 needle 的所有出现，逐次跳转并高亮（重复点击跳下一处）
  function jumpNeedle(needle, label) {
    const a = api();
    if (!a) return;
    if (jumpState.token !== needle) jumpState = { token: needle, i: 0 };
    const text = serialize(a.el);
    const positions = [];
    let i = text.indexOf(needle);
    while (i !== -1) { positions.push(i); i = text.indexOf(needle, i + needle.length); }
    if (!positions.length) { toast('正文里找不到 ' + needle); return; }
    const at = positions[jumpState.i % positions.length];
    jumpState.i++;
    const r = rangeFromOffset(a.el, at, at + needle.length);
    if (!r) return;
    selectRange(a.el, r);
    scrollRangeIntoView(r);
    setPin(r);
    toast(`${label}：第 ${((jumpState.i - 1) % positions.length) + 1}/${positions.length} 处`);
  }

  function jumpTo(m) { jumpNeedle(m.label, m.label); }
  function jumpToken(token) { jumpNeedle('@' + token, token); }
  /* ---------------- 历史 ---------------- */
  // 手动改动（不经插件写回）只在切到历史页时收录，渲染本身不改档
  function captureManualEdit() {
    const a = api();
    if (!a) return;
    syncHistory(a);
    const cur = serialize(a.el);
    if (HIST.idx >= 0 && HIST.list[HIST.idx] && HIST.list[HIST.idx].text !== cur) pushHistory(cur, '当前内容（手动改过）');
  }

  function renderHistory(body, a) {
    syncHistory(a);
    const key = histKey(a);

    const wrap = el('div', 'tyq-hist');
    if (!HIST.list.length) wrap.appendChild(el('div', 'tyq-empty', '还没有操作记录'));
    HIST.list.forEach((h, i) => {
      const row = el('div', 'tyq-hrow' + (i === HIST.idx ? ' now' : ''));
      const t = new Date(h.time);
      const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
      row.appendChild(el('span', 'tyq-htime', hh));
      row.appendChild(el('span', 'tyq-hlabel', h.label));
      if (i === HIST.idx) row.appendChild(el('span', 'tyq-hnow', '当前'));
      row.title = h.text.slice(0, 300);
      row.addEventListener('click', () => goToHistory(HIST.list.indexOf(h), key));
      wrap.appendChild(row);
    });
    body.appendChild(wrap);

    const row = el('div', 'tyq-row');
    const u = el('button', 'tyq-btn', '撤销 Alt+Z');
    const r = el('button', 'tyq-btn', '重做');
    u.disabled = HIST.idx <= 0;
    r.disabled = HIST.idx >= HIST.list.length - 1;
    u.addEventListener('click', undo);
    r.addEventListener('click', redo);
    row.appendChild(u); row.appendChild(r);
    body.appendChild(row);
    body.appendChild(el('div', 'tyq-hint', `${HIST.list.length}/${MAX_HISTORY} 步 · 点任意一条回到该状态 · 每步保存写回前的原文`));
  }

  function caretOffsetRange(ed, range) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(ed);
      pre.setEnd(range.startContainer, range.startOffset);
      const tmp1 = document.createElement('div'); tmp1.appendChild(pre.cloneContents());
      const start = serialize(tmp1, false).length;
      const pre2 = document.createRange();
      pre2.selectNodeContents(ed);
      pre2.setEnd(range.endContainer, range.endOffset);
      const tmp2 = document.createElement('div'); tmp2.appendChild(pre2.cloneContents());
      return { start, end: serialize(tmp2, false).length };
    } catch (e) { return null; }
  }

  let hlLayer = null;
  let hlRaf = 0;
  let hlCleanup = null;
  let findRefreshHook = null;

  function clearFindHL() {
    if (hlCleanup) { hlCleanup(); hlCleanup = null; }
    if (hlRaf) { cancelAnimationFrame(hlRaf); hlRaf = 0; }
    if (hlLayer) { hlLayer.remove(); hlLayer = null; }
  }

  function drawFindHL(ranges, activeIdx, ed) {
    clearFindHL();
    if (!alive || !ranges.length) return;
    const boxes = ranges.map((rg, i) => {
      const b = el('div', 'tyq-hl' + (i === activeIdx ? ' now' : ''));
      b.__range = rg;
      return b;
    });
    const layer = el('div', '');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482998';
    boxes.forEach((b) => layer.appendChild(b));
    document.body.appendChild(layer);
    hlLayer = layer;
    const clipRange = document.createRange();
    clipRange.selectNodeContents(ed);
    const update = () => {
      hlRaf = 0;
      if (!layer.isConnected || !alive) { clearFindHL(); return; }
      const clip = pinClipRects(clipRange).reduce((out, r) => ({
        left: Math.max(out.left, r.left), top: Math.max(out.top, r.top),
        right: Math.min(out.right, r.right), bottom: Math.min(out.bottom, r.bottom),
      }), { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
      const rects = boxes.map((b) => b.__range.getBoundingClientRect());
      boxes.forEach((b, i) => {
        const rect = rects[i];
        const left = Math.max(rect.left - 2, clip.left), top = Math.max(rect.top - 2, clip.top);
        const right = Math.min(rect.right + 2, clip.right), bottom = Math.min(rect.bottom + 2, clip.bottom);
        if (rect.height && right > left && bottom > top) {
          b.style.display = 'block';
          b.style.left = left + 'px';
          b.style.top = top + 'px';
          b.style.width = (right - left) + 'px';
          b.style.height = (bottom - top) + 'px';
        } else b.style.display = 'none';
      });
    };
    const schedule = () => { if (!hlRaf) hlRaf = requestAnimationFrame(update); };
    const root = ed.getRootNode();
    root.addEventListener('scroll', schedule, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(ed);
    if (ed.parentElement) resize.observe(ed.parentElement);
    hlCleanup = () => {
      root.removeEventListener('scroll', schedule, true);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      resize.disconnect();
    };
    schedule();
  }

  /* ---------------- 查找替换 ---------------- */
  let findState = { find: '', rep: '', last: -1, useRef: '', ic: true };

  function renderFind(body, a, index) {
    const key = editorKey(a);
    const f = el('input', 'tyq-input');
    f.placeholder = '查找内容（Ctrl+F 打开时自动带入选中文本）';
    f.value = findState.find;
    body.appendChild(f);

    const r = el('input', 'tyq-input');
    r.style.marginTop = '6px';
    r.placeholder = '替换为…（留空 = 删除）';
    r.value = findState.rep;
    body.appendChild(r);

    const sel = el('select', 'tyq-input');
    sel.style.marginTop = '6px';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '替换为普通文本';
    sel.appendChild(opt0);
    index.forEach((it) => {
      const o = document.createElement('option');
      o.value = it.token; o.textContent = `替换为引用：${it.name}（${it.token}）`;
      sel.appendChild(o);
    });
    sel.value = findState.useRef || '';
    body.appendChild(sel);

    const icRow = el('label', 'tyq-check');
    const ic = document.createElement('input');
    ic.type = 'checkbox';
    ic.checked = findState.ic !== false;
    icRow.appendChild(ic);
    icRow.appendChild(el('span', '', '忽略大小写'));
    body.appendChild(icRow);

    const info = el('div', 'tyq-hint', '');
    body.appendChild(info);

    const assetBox = el('div', '');
    body.appendChild(assetBox);

    const row1 = el('div', 'tyq-row');
    const prev = el('button', 'tyq-btn', '上一个');
    const next = el('button', 'tyq-btn', '下一个');
    const rep1 = el('button', 'tyq-btn', '替换');
    const repAll = el('button', 'tyq-btn primary', '全部替换');
    [prev, next, rep1, repAll].forEach((b) => row1.appendChild(b));
    body.appendChild(row1);

    // 素材名匹配：查的不只是正文，素材名字也能搜到，点一下定位到正文里的引用
    const hitsOf = (q) => {
      if (!q) return [];
      const lq = q.toLowerCase();
      return index
        .filter((it) => it.name.toLowerCase().includes(lq) || it.bare.toLowerCase().includes(lq))
        .slice(0, 8);
    };

    const renderAssetHits = (q) => {
      assetBox.innerHTML = '';
      const hits = hitsOf(q);
      if (!hits.length) return;
      const cited = new Map(scanCitations(serialize(a.el), index).map((c) => [c.token, c.count]));
      assetBox.appendChild(el('div', 'tyq-sub', '素材名匹配（点一下定位到正文里的引用）'));
      const box = el('div', 'tyq-fbox');
      hits.forEach((it) => {
        const row = el('div', 'tyq-fmatch');
        row.appendChild(el('span', 'tyq-token', it.token));
        row.appendChild(el('span', 'tyq-mname', it.name));
        if (isGenericName(it.name)) {
          const bd = el('span', 'tyq-badge', '通用文件名');
          bd.title = '原名已丢失（如 image.png）。正文里同样写法的文字可能不是指这个素材，转换前请核对。';
          row.appendChild(bd);
        }
        const n = cited.get(it.token) || 0;
        row.appendChild(el('span', 'tyq-mcnt', n ? '正文×' + n : '未引用'));
        row.title = n ? `点击定位正文里的 @${it.token}` : `正文里还没有 @${it.token}`;
        row.addEventListener('click', () => {
          if (!cited.get(it.token)) { toast(`正文里还没有引用 @${it.token}，可先到「素材」页转换`); return; }
          jumpToken(it.token);
        });
        box.appendChild(row);
      });
      assetBox.appendChild(box);
    };

    // 统一刷新：计数 + 素材名匹配 + 正文高亮（当前命中加蓝框）
    const refresh = (text) => {
      const t = text != null ? text : serialize(a.el);
      const q = f.value;
      const positions = allPositions(t, q, ic.checked);
      const cur = positions.indexOf(findState.last);
      if (!q) {
        info.textContent = '输入要查找的内容 · 回车跳到下一处';
      } else if (!positions.length) {
        info.innerHTML = '未找到匹配' + (hitsOf(q).length ? '（正文里没有，但有同名素材，见下方）' : '');
      } else {
        info.innerHTML = `共 <span class="tyq-count">${positions.length}</span> 处匹配` +
          (cur >= 0 ? ` · 当前第 <span class="tyq-count">${cur + 1}</span>/${positions.length} 处` : ' · 回车跳到第 1 处');
      }
      renderAssetHits(q);
      const shown = positions.slice(0, 300);
      if (cur >= shown.length) shown[shown.length - 1] = positions[cur];
      const model = offsetModel(a.el);
      const ranges = shown.map((at) => rangeFromOffset(a.el, at, at + q.length, model));
      drawFindHL(ranges, shown.indexOf(findState.last), a.el);
    };
    findRefreshHook = () => refresh();
    refresh();

    const doFind = (dir) => {
      const text = serialize(a.el);
      const q = f.value;
      if (!q) return;
      const positions = allPositions(text, q, ic.checked);
      if (!positions.length) { toast('未找到匹配'); return; }
      let idx;
      if (findState.last === -1 || !positions.includes(findState.last)) {
        idx = dir > 0 ? 0 : positions.length - 1;   // 首次：向下从第 1 处，向上从最后一处
      } else {
        const cur = positions.indexOf(findState.last);
        idx = (cur + dir + positions.length) % positions.length;   // 到末尾回开头，到开头回末尾
        if (dir > 0 && idx === 0) toast(`已到末尾，从开头继续：第 1/${positions.length} 处`);
        else if (dir < 0 && idx === positions.length - 1) toast(`已到开头，从末尾继续：第 ${positions.length}/${positions.length} 处`);
      }
      findState.last = positions[idx];
      const input = document.activeElement === r ? r : f;
      const range = rangeFromOffset(a.el, findState.last, findState.last + q.length);
      if (range) {
        const s = editorSelection(a.el);
        s.removeAllRanges(); s.addRange(range);
        scrollRangeIntoView(range);
      }
      input.focus({ preventScroll: true });
      refresh(text);
    };

    const doReplace = () => {
      const text = serialize(a.el);
      const q = f.value;
      if (!q) return;
      const rep = sel.value ? '@' + sel.value : r.value;
      const positions = allPositions(text, q, ic.checked);
      if (!positions.length) { toast('未找到匹配'); return; }
      let at = findState.last;
      if (!positions.includes(at)) at = positions[0];
      const out = text.slice(0, at) + rep + text.slice(at + q.length);
      if (!writeText(out, '替换 1 处', key)) return;
      const remaining = allPositions(out, q, ic.checked);
      findState.last = remaining.find((pos) => pos >= at + rep.length) ?? remaining[0] ?? -1;
    };

    const doReplaceAll = () => {
      const text = serialize(a.el);
      const q = f.value;
      if (!q) return;
      const rep = sel.value ? '@' + sel.value : r.value;
      const positions = allPositions(text, q, ic.checked);
      const n = positions.length;
      if (!n) { toast('未找到匹配'); return; }
      let out = ''; let pos = 0;
      positions.forEach((at) => { out += text.slice(pos, at) + rep; pos = at + q.length; });
      out += text.slice(pos);
      if (!writeText(out, `替换 ${n} 处`, key)) return;
      findState.last = -1;
      toast(`已替换 ${n} 处，Alt+Z 可撤销`);
    };

    f.addEventListener('input', () => { findState.find = f.value; findState.last = -1; refresh(); });
    r.addEventListener('input', () => { findState.rep = r.value; });
    sel.addEventListener('change', () => { findState.useRef = sel.value; });
    ic.addEventListener('change', () => { findState.ic = ic.checked; findState.last = -1; refresh(); });
    [f, r].forEach((inp) => inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doFind(e.shiftKey ? -1 : 1); }
    }));
    prev.addEventListener('click', () => doFind(-1));
    next.addEventListener('click', () => doFind(1));
    rep1.addEventListener('click', doReplace);
    repAll.addEventListener('click', doReplaceAll);
    setTimeout(() => f.focus(), 30);
  }

  function allPositions(text, q, ic) {
    const out = [];
    if (!q) return out;
    let hay = text; let needle = q;
    if (ic) {
      // 个别字符 toLowerCase 后长度会变（如 İ），偏移会错位，此时退回精确匹配
      const t = text.toLowerCase(); const s = q.toLowerCase();
      if (t.length === text.length && s.length === q.length) { hay = t; needle = s; }
    }
    let i = hay.indexOf(needle);
    while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + needle.length); }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 4. 事件：快捷键 + 选区记忆
   * ------------------------------------------------------------------ */
  function editorFromEvent(e) {
    const path = (e.composedPath && e.composedPath()) || [];
    for (const n of path) {
      if (n && n.nodeType === 1 && n.matches && n.matches(EDITOR_SEL)) return n;
    }
    return null;
  }

  document.addEventListener('keydown', (e) => {
    if (!alive) return;
    const ed = editorFromEvent(e);
    if (ed) lastEditor = ed;

    if (e.key === 'Escape') {
      if (isOpen()) close();
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) redo(); else undo();
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
      e.preventDefault(); e.stopPropagation();
      open('asset');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      if (!ed) return; // 不在提示词框内则保留浏览器原生查找
      e.preventDefault(); e.stopPropagation();
      const sel = editorSelection(ed);
      let picked = '';
      if (sel && sel.rangeCount && ed.contains(sel.getRangeAt(0).startContainer)) {
        picked = sel.toString();
      }
      open('find');
      findState.find = picked;
      findState.last = -1;
      setTimeout(() => render(), 60);
    }
  }, true);

  // 焦点进编辑器 = 可能切了节点：记住它、订阅内容变化，并让面板跟上
  //（focusin 穿透 shadow DOM，比坐标猜测可靠）
  document.addEventListener('focusin', (e) => {
    if (!alive) return;
    const ed = editorFromEvent(e);
    if (!ed) return;
    lastEditor = ed;
    watchEditorContent(ed);
    setTimeout(syncPanelToEditor, 80);
  }, true);

  // 内容变化走 MutationObserver（事件驱动），不再轮询 serialize
  let contentMO = null, moEditor = null, moTimer = 0;
  let editorMO = null, editorTimer = 0;
  function watchEditorContent(ed) {
    if (ed === moEditor) return;
    if (contentMO) contentMO.disconnect();
    clearTimeout(moTimer);
    moEditor = ed;
    if (!ed) return;
    contentMO = new MutationObserver(() => {
      clearTimeout(moTimer);
      moTimer = setTimeout(() => {
        if (!alive || !ui) return;
        if (isOpen() && editorKey(api()) !== lastRenderKey) { syncPanelToEditor(); return; }
        refreshBadge();
        if (isOpen() && activeTab === 'find') { if (findRefreshHook) findRefreshHook(); }
        else if (isOpen()) rerenderKeepScroll();
      }, 250);
    });
    contentMO.observe(ed, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('resize', () => { if (alive) placePanel(); });

  /* ------------------------------------------------------------------ *
   * 5. 启动
   * ------------------------------------------------------------------ */
  /* ---------------- 路由感知启动 ----------------
   * 从项目列表等页面 SPA 跳转到画布时不会刷新页面，content script 不会重新注入，
   * 所以必须：1) manifest 匹配全站 2) 脚本内部按路由 /aigc/canvas/ 自行启停，
   * 并监听 pushState / popstate。 */
  let bootTimer = 0;
  let started = false;

  function teardown() {
    if (!started) return;
    started = false;
    clearInterval(bootTimer);
    clearPin();
    clearFindHL();
    findRefreshHook = null;
    if (contentMO) { contentMO.disconnect(); contentMO = null; }
    if (editorMO) { editorMO.disconnect(); editorMO = null; }
    moEditor = null;
    clearTimeout(moTimer);
    clearTimeout(editorTimer);
    if (ui) { ui.launch.remove(); ui.panel.remove(); ui = null; }
  }

  function onCanvasRoute() {
    if (started) return;
    started = true;
    bootTimer = setInterval(() => {
      if (!location.pathname.includes(CANVAS_ROUTE)) { teardown(); return; }
      if (SHADOW()) {
        clearInterval(bootTimer);
        if (!ui) buildUI();
        setTimeout(maybeShowGuide, 1500);
      }
    }, 1000);
  }

  function onRoute() {
    if (location.pathname.includes(CANVAS_ROUTE)) { onCanvasRoute(); selfUpdate(); }
    else teardown();
  }

  const _push = history.pushState, _replace = history.replaceState;
  history.pushState = function () { const r = _push.apply(this, arguments); if (alive) setTimeout(onRoute, 0); return r; };
  history.replaceState = function () { const r = _replace.apply(this, arguments); if (alive) setTimeout(onRoute, 0); return r; };
  window.addEventListener('popstate', () => { if (alive) setTimeout(onRoute, 0); });
  window.addEventListener('hashchange', () => { if (alive) setTimeout(onRoute, 0); });
  onRoute();

  window.__TYQ = {
    open, close, toggle, serialize, api, activeEditor, buildIndex, convertAll,
    countMatches, scanMatches, writeText, undo, redo, goToHistory,
    HIST, placePanel, jumpTo, jumpToken, scanCitations,
    showGuide, maybeShowGuide, LS, GUIDE_KEY,
    clearFindHL, isGenericName,
    get findState() { return findState; },
    get panelPos() { return panelPos; },
  };
})();
