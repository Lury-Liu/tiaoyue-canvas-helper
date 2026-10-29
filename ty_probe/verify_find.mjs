/* 本地模拟回归：node ty_probe/verify_find.mjs；仅需本机 Edge/Chrome。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(DIR, '..', 'tiaoyue-ref-helper.user.js'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(DIR, 'fake2.html'));
const ROUTE = '/aigc/canvas/fake2.html';
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${!pass && detail ? ' | ' + detail : ''}`);
};
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({ actual, expected }));
const scenario = async (name, run) => {
  try { await run(); } catch (error) { check(name, false, error.stack || String(error)); }
};

// 只暴露这一份模拟 HTML；CSP 阻止被测脚本自更新或访问外网。
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== ROUTE) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'",
  });
  res.end(FIXTURE);
});
let profile, proc, exited, send, sessionId, pageLoaded;
const pending = new Map();

try {
  const exe = CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!exe) throw new Error('未找到 Edge/Chrome');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}${ROUTE}`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tyq-verify-find-'));
  // 私有 CDP 管道，不连接已有浏览器，也不开放调试端口或 WebSocket。
  proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const rejectPending = (error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  exited = new Promise((resolve) => {
    proc.once('error', (error) => { rejectPending(error); resolve({ error }); });
    proc.once('exit', (code, signal) => { rejectPending(new Error('浏览器已退出')); resolve({ code, signal }); });
  });
  proc.stdio[3].on('error', rejectPending);
  proc.stdio[4].on('error', rejectPending);
  let id = 0, buffer = '';
  send = (method, params = {}, session) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 8000);
    pending.set(requestId, { resolve, reject, timer });
    proc.stdio[3].write(JSON.stringify({ id: requestId, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
  });
  proc.stdio[4].setEncoding('utf8');
  proc.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      if (message.method === 'Page.loadEventFired' && message.sessionId === sessionId) pageLoaded?.();
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  const pageSend = (method, params = {}) => send(method, params, sessionId);
  await pageSend('Page.enable');
  await pageSend('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const response = await pageSend('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const fresh = async (text, tab = 'asset') => {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('模拟页加载超时')), 8000);
      pageLoaded = () => { clearTimeout(timer); resolve(); };
    });
    await Promise.all([loaded, pageSend('Page.navigate', { url })]);
    pageLoaded = null;
    await ev(`localStorage.clear(); localStorage.setItem('tyq.guide.v1','true'); __fake.render(${JSON.stringify(text)});`);
    await ev(SRC);
    await ev(`__fake.ed.blur(); __fake.ed.focus(); __TYQ.open(${JSON.stringify(tab)});`);
    await pause(450);
  };
  const typeInput = async (index, value) => {
    await ev(`(()=>{const input=document.querySelectorAll('input.tyq-input')[${index}]; input.focus(); input.select();})()`);
    await pageSend('Input.insertText', { text: value });
    await pause(150);
  };
  const typeFind = (value) => typeInput(0, value);
  const pressEnter = async (shift = false) => {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: shift ? 8 : 0 };
    await pageSend('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r', unmodifiedText: '\r' });
    await pageSend('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await pause(150);
  };
  const click = async (elementExpression) => {
    const point = await ev(`(()=>{const element=${elementExpression};
      if(!element || element.disabled) throw new Error('操作控件不存在或已禁用');
      element.scrollIntoView({block:'nearest'}); const r=element.getBoundingClientRect();
      if(!r.width || !r.height) throw new Error('操作控件不可见');
      return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await pageSend('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await pageSend('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await pageSend('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await pause(450);
  };
  const clickButton = (label) => click(`[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(b=>b.textContent===${JSON.stringify(label)})`);
  const convert = () => click(`document.querySelector('.tyq-panel .tyq-btn.primary')`);
  const switchNode = (node) => click(`document.getElementById('fake-node-${node}')`);
  const history = async (method) => { await ev(`__TYQ.${method}()`); await pause(450); };
  const state = (node = 'A') => ev(`(()=>{const n=__fake.nodes[${JSON.stringify(node)}];return {text:__TYQ.serialize(n.ed),value:n.props.value,html:n.ed.innerHTML};})()`);
  const text = async (node = 'A') => (await state(node)).text;
  const expectText = async (name, expected, node = 'A') => {
    const actual = await state(node);
    equal(name, { text: actual.text, value: actual.value }, { text: expected, value: expected });
  };
  const infoText = () => ev(`document.querySelector('.tyq-panel .tyq-hint').textContent`);
  const selection = () => ev(`window.getSelection().toString()`);
  const visibleHL = () => ev(`({all:document.querySelectorAll('.tyq-hl').length,shown:[...document.querySelectorAll('.tyq-hl')].filter(e=>getComputedStyle(e).display!=='none').length,now:[...document.querySelectorAll('.tyq-hl.now')].filter(e=>getComputedStyle(e).display!=='none').length})`);
  const highlightAt = (offset, length) => ev(`(()=>{
    const boxes=[...document.querySelectorAll('.tyq-hl.now')];
    if(boxes.length!==1 || getComputedStyle(boxes[0]).display==='none') return false;
    const range=document.createRange(); range.setStart(__fake.ed.firstChild,${offset}); range.setEnd(__fake.ed.firstChild,${offset + length});
    const r=range.getBoundingClientRect(), b=boxes[0].getBoundingClientRect();
    return r.width>0 && Math.abs(b.left-r.left)<=5 && Math.abs(b.top-r.top)<=5 && Math.abs(b.right-r.right)<=5;
  })()`);

  await scenario('查找高亮与真实焦点回车', async () => {
    await fresh('艾洛文-高级职场套装 A 艾洛文-高级职场套装 B 艾洛文-高级职场套装 C 结尾', 'find');
    await typeFind('艾洛文');
    equal('T1 三次出现三个可见高亮框', await visibleHL(), { all: 3, shown: 3, now: 0 });
    const before = await state();
    for (const [label, shift, current, wrap] of [
      ['T2 Enter 到第一处', false, 1, ''],
      ['T3 连续 Enter 到第二处', false, 2, ''],
      ['T4 连续 Enter 到第三处', false, 3, ''],
      ['T5 Enter 从末尾回开头', false, 1, '已到末尾'],
      ['T6 Shift+Enter 从开头回末尾', true, 3, '已到开头'],
      ['T7 连续 Shift+Enter 到第二处', true, 2, ''],
    ]) {
      await pressEnter(shift);
      const info = await infoText();
      const focused = await ev(`document.activeElement===document.querySelector('input.tyq-input')`);
      const hl = await visibleHL();
      const toast = !wrap || await ev(`document.body.innerText.includes(${JSON.stringify(wrap)})`);
      check(label, info.includes(`第 ${current}/3`) && hl.now === 1 && focused && toast, JSON.stringify({ info, hl, focused, toast }));
      equal(label + ' 不改正文、DOM或模型', await state(), before);
    }
    await ev('__TYQ.close()');
    equal('T8 关闭面板清除高亮', (await visibleHL()).all, 0);
  });

  await scenario('素材定位及旧转换回归', async () => {
    await fresh('前缀 @图片2 巴迪在跑，结尾', 'find');
    await typeFind('巴迪');
    const hits = await ev(`[...document.querySelectorAll('.tyq-fmatch')].map(e=>e.innerText.replace(/\\s+/g,' '))`);
    check('T9 搜素材名列出图片2与引用次数', hits.length === 1 && /图片2/.test(hits[0]) && /正文×1/.test(hits[0]), JSON.stringify(hits));
    await click(`document.querySelector('.tyq-fmatch')`);
    equal('T10 点击素材名定位正文引用', await selection(), '@图片2');

    const base = await ev('__fake.base');
    await fresh(base);
    await convert();
    await expectText('R1 一键转换完整结果', '前缀 @图片1 中间 @图片2 结尾 @图片3 已有引用');
    await history('undo');
    await expectText('R2 撤销恢复原文', base);
    await click(`document.querySelector('.tyq-citem')`);
    equal('R3 已引用清单仍能定位', await selection(), '@图片3');
    await ev(`__fake.referenceItems.push({id:'a9',type:'image',assetName:'image.png',coverUrl:''});
      __fake.render('粘贴脚本里带着 image.png 占位'); __TYQ.open('asset');`);
    await pause(450);
    equal('R4 素材清单标注通用文件名', await ev(`document.querySelectorAll('.tyq-matches .tyq-badge').length`), 1);
    await ev(`__TYQ.open('find')`);
    await pause(100);
    await typeFind('image');
    equal('T11 查找结果标注通用文件名', await ev(`document.querySelectorAll('.tyq-fbox .tyq-badge').length`), 1);
  });

  await scenario('中段选区转换', async () => {
    const prefix = '开头 巴迪-狗形态 @图片3 保留前缀 | ';
    const selected = '艾洛文-高级职场套装 与 巴迪-狗形态';
    const suffix = ' | 保留后缀 艾洛文-高级职场套装';
    const original = prefix + selected + suffix;
    const expected = prefix + '@图片1 与 @图片2' + suffix;
    await fresh(original);
    equal('S1 选区位于引用芯片之后且只含中段', await ev(`__fake.selectText(${prefix.length},${prefix.length + selected.length})`), selected);
    await clickButton('仅改写选中的文字');
    await expectText('S2 仅替换选中段，前后名字和已有引用不变', expected);
    await history('undo');
    await expectText('S3 选区转换可撤销到完整原文', original);
    await history('redo');
    await expectText('S4 选区转换可重做', expected);
  });

  await scenario('查找页跨节点同步', async () => {
    const a = 'A正文 巴迪在跑 @图片2';
    const b = 'B正文 巴迪在跑，巴迪收尾 @图片1';
    await fresh(a, 'find');
    await ev(`__fake.nodes.B.render(${JSON.stringify(b)})`);
    await typeFind('巴迪');
    equal('N1 节点A素材名对应图片2', await ev(`document.querySelector('.tyq-fmatch .tyq-token').textContent`), '图片2');
    const aBefore = await state('A');
    await switchNode('B');
    const options = await ev(`[...document.querySelector('select.tyq-input').options].slice(1).map(o=>({value:o.value,text:o.textContent}))`);
    equal('N2 不重开查找页即刷新为B的独立素材索引', options, [
      { value: '图片1', text: '替换为引用：巴迪-狗形态.png（图片1）' },
      { value: '图片2', text: '替换为引用：B独有-场景.png（图片2）' },
    ]);
    const hits = await ev(`[...document.querySelectorAll('.tyq-fmatch')].map(e=>e.innerText.replace(/\\s+/g,' '))`);
    check('N3 查询保留且素材引用次数来自B', hits.length === 1 && /图片1/.test(hits[0]) && /正文×1/.test(hits[0]) && /共 2 处匹配/.test(await infoText()), JSON.stringify(hits));
    await ev(`(()=>{const select=document.querySelector('select.tyq-input'); select.focus(); select.value='图片2'; select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await clickButton('替换');
    await expectText('N4 单条替换只使用B正文和B素材', 'B正文 @图片2在跑，巴迪收尾 @图片1', 'B');
    equal('N5 单条替换后A的正文、DOM和模型不变', await state('A'), aBefore);
    await history('undo');
    await expectText('N6 B的替换可撤销', b, 'B');
    await clickButton('全部替换');
    await expectText('N7 全部替换也只改B', 'B正文 @图片2在跑，@图片2收尾 @图片1', 'B');
    equal('N8 全部替换后A仍不变', await state('A'), aBefore);
  });

  await scenario('单条替换游标', async () => {
    await fresh('aa aa', 'find');
    await typeFind('aa');
    await typeInput(1, 'aa!');
    await clickButton('替换');
    await expectText('P1 第一次 aa→aa! 只改第一处', 'aa! aa');
    check('P2 替换后活动高亮指向下一原始匹配', /第 2\/2/.test(await infoText()) && await highlightAt(4, 2), await infoText());
    await clickButton('替换');
    await expectText('P3 第二次替换得到 aa! aa!，不重复改新生成的aa', 'aa! aa!');
    await history('undo');
    await expectText('P4 撤销一次只撤销第二次替换', 'aa! aa');
    await history('undo');
    await expectText('P5 撤销两次回到原始正文', 'aa aa');
  });

  await scenario('重复素材名取消勾选', async () => {
    await fresh('前缀 艾洛文-高级职场套装 中间 巴迪-狗形态 结尾 @图片3 已有引用');
    equal('D1 保留图片1与图片4的原有同名素材', await ev(`__fake.referenceItems[0].assetName===__fake.referenceItems[3].assetName`), true);
    await click(`[...document.querySelectorAll('.tyq-match')].find(row=>row.querySelector('.tyq-token').textContent==='图片1').querySelector('input')`);
    equal('D2 图片1取消勾选已反映在界面', await ev(`[...document.querySelectorAll('.tyq-match')].find(row=>row.querySelector('.tyq-token').textContent==='图片1').querySelector('input').checked`), false);
    await convert();
    await expectText('D3 只转换巴迪，同名图片4不能绕过图片1的取消勾选', '前缀 艾洛文-高级职场套装 中间 @图片2 结尾 @图片3 已有引用');
  });

  await scenario('节点独立历史', async () => {
    const a = 'A历史 巴迪-狗形态 原稿', aChanged = 'A历史 @图片2 原稿';
    const b = 'B历史 B独有-场景 原稿', bChanged = 'B历史 @图片2 原稿';
    await fresh(a);
    await ev(`__fake.nodes.B.render(${JSON.stringify(b)})`);
    await convert();
    await expectText('H1 A编辑成功', aChanged);
    await switchNode('B');
    await convert();
    await expectText('H2 B编辑成功', bChanged, 'B');
    const bBeforeUndo = await state('B');
    await switchNode('A');
    await history('undo');
    await expectText('H3 A→B→A后仍能撤销A自己的历史', a);
    equal('H4 撤销A不改变B', await state('B'), bBeforeUndo);
    await history('redo');
    await expectText('H5 返回A后可重做A', aChanged);
    equal('H6 重做A不改变B', await state('B'), bBeforeUndo);
    await switchNode('B');
    await history('undo');
    await expectText('H7 B也保留自己的撤销历史', b, 'B');
    await expectText('H8 撤销B不改变A', aChanged);
  });

  await scenario('手动编辑后的紧前快照', async () => {
    await fresh('初稿 巴迪-狗形态');
    await convert();
    await expectText('M1 建立一次插件编辑历史', '初稿 @图片2');
    const manual = '手动改稿 玛拉-便装 补充内容';
    await ev(`(()=>{__fake.ed.focus(); const range=document.createRange(); range.selectNodeContents(__fake.ed);
      const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);})()`);
    await pageSend('Input.insertText', { text: manual });
    await pause(450);
    await expectText('M2 原生输入更新正文与独立props', manual);
    // 不打开历史页，避免历史页主动抓取手动编辑而掩盖写回问题。
    await convert();
    await expectText('M3 手动改稿后转换新素材', '手动改稿 @图片3 补充内容');
    await history('undo');
    await expectText('M4 撤销回到转换紧前的手动原文', manual);
    await history('redo');
    await expectText('M5 手动编辑后的转换可重做', '手动改稿 @图片3 补充内容');
  });

  await scenario('超过300处的当前高亮', async () => {
    const original = Array(305).fill('aa').join(' ');
    await fresh(original, 'find');
    await typeFind('aa');
    for (let i = 0; i < 5; i++) await clickButton('上一个');
    check('L1 通过UI从末项向前跳到第301/305项', /第 301\/305/.test(await infoText()), await infoText());
    check('L2 第301项仍有可见且位置正确的当前活动高亮', await highlightAt(300 * 3, 2), JSON.stringify(await visibleHL()));
    await expectText('L3 大量命中导航不改变正文', original);
  });

  await scenario('切节点与点击同一事件内发生', async () => {
    await fresh('A正文 aa', 'find');
    await typeFind('aa');
    await typeInput(1, '替换');
    await ev(`__fake.nodes.B.render('B正文 aa')`);
    const beforeA = await state('A'), beforeB = await state('B');
    await ev(`(()=>{const button=[...document.querySelectorAll('.tyq-btn')].find(b=>b.textContent==='替换');
      __fake.switchNode('B'); button.click();})()`);
    equal('E1 尚未来得及重绘的旧按钮不能改写A', await state('A'), beforeA);
    equal('E2 尚未来得及重绘的旧按钮不能把A写入B', await state('B'), beforeB);
  });

  await scenario('引用和换行后的选区边界', async () => {
    await fresh('@图片1\n巴迪-狗形态 后缀');
    await ev(`(()=>{const ed=__fake.ed; ed.replaceChildren(ed.firstChild,document.createElement('br'),document.createTextNode('巴迪-狗形态 后缀'));
      ed.focus(); const r=document.createRange(); r.setStart(ed.lastChild,0); r.setEnd(ed.lastChild,6);
      const s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await clickButton('仅改写选中的文字');
    await expectText('E3 真实BR之后的选区不吞换行或后缀', '@图片1\n@图片2 后缀');
  });

  await scenario('空内容历史与长度上限', async () => {
    await fresh('');
    await ev(`__TYQ.writeText('第一稿','测试')`);
    await history('undo');
    await expectText('E4 第一次写回可撤销为空串', '');
    await history('redo');
    await expectText('E5 空串之后可重做第一稿', '第一稿');
    const before = await state();
    equal('E6 超长写入被拒绝', await ev(`__TYQ.writeText('a'.repeat(5001),'超长')`), false);
    equal('E7 长度校验不改变正文', await state(), before);
  });

  await scenario('高亮按需测量与滚动裁剪', async () => {
    await fresh(Array(40).fill('aa').join('\n'), 'find');
    await ev(`__fake.ed.style.maxHeight='120px'; __fake.ed.style.overflow='auto';`);
    await typeFind('aa');
    await pause(200);
    await ev(`window.__rangeRectOriginal=Range.prototype.getBoundingClientRect; window.__rangeRectCalls=0;
      Range.prototype.getBoundingClientRect=function(){window.__rangeRectCalls++;return window.__rangeRectOriginal.call(this)};`);
    try {
      await pause(250);
      equal('E8 静止时不持续测量高亮坐标', await ev(`window.__rangeRectCalls`), 0);
      await ev(`__fake.ed.scrollTop=__fake.ed.scrollHeight`);
      await pause(150);
      equal('E9 Shadow DOM滚动后首处高亮隐藏', await ev(`getComputedStyle(document.querySelector('.tyq-hl')).display`), 'none');
      check('E10 滚动触发高亮重定位', await ev(`window.__rangeRectCalls>0`));
      await ev(`__fake.ed.scrollTop=0`);
      await pause(150);
      equal('E11 滚回后首处高亮恢复', await ev(`getComputedStyle(document.querySelector('.tyq-hl')).display`), 'block');
    } finally {
      await ev(`Range.prototype.getBoundingClientRect=window.__rangeRectOriginal;delete window.__rangeRectOriginal;delete window.__rangeRectCalls;`);
    }
  });

  await scenario('历史条目跨节点点击', async () => {
    await fresh('A初稿');
    await ev(`__TYQ.writeText('A改稿','A编辑'); __fake.switchNode('B');
      __TYQ.writeText('B改稿','B编辑'); __fake.switchNode('A'); __TYQ.open('hist');`);
    await pause(450);
    const a = await state('A'), b = await state('B');
    await ev(`(()=>{const row=document.querySelector('.tyq-hrow');__fake.switchNode('B');row.click();})()`);
    equal('F1 旧历史条目不会回退新节点B', await state('B'), b);
    equal('F2 旧历史条目不会改写节点A', await state('A'), a);
  });

  await scenario('历史页内手动编辑后跳转', async () => {
    await fresh('历史初稿');
    await ev(`__TYQ.writeText('历史改稿','编辑');__TYQ.open('hist');`);
    await pause(450);
    const manual = '历史页保持打开时的手动改稿';
    await ev(`__fake.selectText(0,__fake.ed.textContent.length)`);
    await pageSend('Input.insertText', { text: manual });
    await pause(450);
    await click(`document.querySelector('.tyq-hrow')`);
    await expectText('F3 点击历史仍回到用户选择的初稿', '历史初稿');
    check('F4 跳转前的手稿被保存', await ev(`__TYQ.HIST.list.some(h=>h.text===${JSON.stringify(manual)})`));
    await click(`[...document.querySelectorAll('.tyq-hrow')].find(row=>row.title===${JSON.stringify(manual)})`);
    await expectText('F5 手动改稿可从历史恢复', manual);
  });

  await scenario('历史容量满时保留跳转目标', async () => {
    await fresh('稿0');
    await ev(`for(let i=1;i<=20;i++) __TYQ.writeText('稿'+i,'编辑'+i);__TYQ.open('hist');`);
    await pause(450);
    await ev(`__fake.selectText(0,__fake.ed.textContent.length)`);
    await pageSend('Input.insertText', { text: '满容量手稿' });
    await pause(450);
    await click(`document.querySelector('.tyq-hrow')`);
    await expectText('F6 补存手稿导致索引移动也仍恢复稿1', '稿1');
    check('F7 容量维持20且保留手稿', await ev(`__TYQ.HIST.list.length===20 && __TYQ.HIST.list.some(h=>h.text==='满容量手稿')`));
    await history('undo');
    await expectText('F8 被移出列表的目标恢复后可撤销到手稿', '满容量手稿');
  });

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  if (proc?.pid && proc.exitCode === null && proc.signalCode === null) {
    try { await send('Browser.close'); } catch (error) { console.error('Browser.close:', error.message); process.exitCode = 1; }
  }
  if (exited) await exited;
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  proc?.stdio[3]?.destroy();
  proc?.stdio[4]?.destroy();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  if (profile) await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
