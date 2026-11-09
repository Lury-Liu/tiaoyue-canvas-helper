/* 在真实画布页的 shadow 树里造一个合成编辑器（带假 React fiber），
 * 用于在真实环境验证 find 页改动；不触碰用户真实节点内容。 */
(() => {
  if (window.__TYQ_SYNTH__) return 'exists';
  const r = document.querySelector('wujie-app').shadowRoot;

  const host = document.createElement('div');
  host.id = 'tyq-synth';
  host.style.cssText = 'position:fixed;left:40px;top:120px;width:420px;height:200px;z-index:2147482000;' +
    'background:#14151a;border:1px solid #2a2d35;border-radius:8px;overflow:auto;padding:10px';

  const ed = document.createElement('div');
  ed.className = '_promptEditor_synth';
  ed.setAttribute('contenteditable', 'true');
  ed.style.cssText = 'min-height:170px;outline:none;color:#e5e7eb;font:13px/1.7 system-ui;white-space:pre-wrap';

  const props = { value: '', onChange: null, referenceItems: [], maxLength: 5000, nodeId: 'synth-node' };
  props.onChange = (v) => { props.value = v; render(v); };
  ed['__reactFiber$synth'] = { memoizedProps: props, return: null };

  const BIN = /@(图片|视频|音频)(\d+)/g;
  function render(text) {
    ed.textContent = '';
    const frag = document.createDocumentFragment();
    BIN.lastIndex = 0;
    let last = 0, m;
    while ((m = BIN.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const sp = document.createElement('span');
      sp.className = 'canvas-mention';
      sp.setAttribute('data-mention-token', m[1] + m[2]);
      sp.textContent = '@' + m[1] + m[2];
      frag.appendChild(sp);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    ed.appendChild(frag);
    props.value = text;
  }

  props.referenceItems = [
    { type: 'image', id: 'a1', assetName: '艾洛文-高级职场套装.png', coverUrl: '' },
    { type: 'image', id: 'a2', assetName: '巴迪-狗形态.png', coverUrl: '' },
    { type: 'image', id: 'a3', assetName: '玛拉-便装.png', coverUrl: '' },
    { type: 'image', id: 'a4', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a5', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a6', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a7', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a8', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a9', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a10', assetName: 'image.png', coverUrl: '' },
    { type: 'image', id: 'a11', assetName: 'image.png', coverUrl: '' },
  ];

  render('开头 艾洛文-高级职场套装 中间 巴迪-狗形态 结尾 @图片3 已有引用 艾洛文-高级职场套装 再来一次');
  host.appendChild(ed);
  r.appendChild(host);

  window.__TYQ_SYNTH__ = { host, ed, props, render };
  return 'ok';
})()
