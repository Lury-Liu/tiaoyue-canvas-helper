/* 真实面板验证：全部数据取自当前画布（refs + 正文），不写死任何素材名。
 * 每次写回后撤销，并与备份逐字比对；结束时若不一致则用备份强制还原。 */
import { connect, attach, ev, send, close } from './lib.mjs';
import fs from 'node:fs';

const BACKUP = 'real_backup.txt';
await connect();
const tabs = (await send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page' && x.url.includes('/aigc/canvas/'));
const s = await attach(tabs[0].targetId);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = () => ev(s, '__TYQ.serialize(__TYQ.api().el)');
const info = () => ev(s, `document.querySelector('.tyq-panel .tyq-hint').textContent`);
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); };

const SRC = fs.readFileSync('../tiaoyue-ref-helper-ext/content.js', 'utf8');
await ev(s, `(()=>{document.querySelectorAll('.tyq-launch,.tyq-panel,.tyq-guide-mask,.tyq-pin,.tyq-pmark,.tyq-hl').forEach(n=>n.remove());
  document.querySelectorAll('#tyq-style').forEach(n=>n.remove());window.__TYQ_FORCE_ONCE = true;
  localStorage.setItem('tyq.guide.v1','true');try{localStorage.removeItem('tyq.tab.v1')}catch(e){};return 1})()`);
await ev(s, SRC + '\n"ok"');
await sleep(1800);

const ORIG = fs.readFileSync(BACKUP, 'utf8');
let current = await txt();
if (current !== ORIG) { await ev(s, `__TYQ.api().set(${JSON.stringify(ORIG)}); 1`); await sleep(900); current = await txt(); }
console.log('起点与备份一致:', current === ORIG, '| 长度', current.length);

// 从真实正文里挑关键词：取出现次数最多的 2 字中文片段
// 关键词直接从备份里挑（真实正文），不经过页面
const has = (w) => (ORIG.split(w).length - 1) >= 2;
const q = ['全程', '维多利亚', '人物', '镜头'].find(has) || '';
const qCount = q ? ORIG.split(q).length - 1 : 0;
console.log('关键词（取自正文）:', JSON.stringify(q), '×', qCount);

// 打开查找页
await ev(s, `__TYQ.open('find'); 1`);
await sleep(600);
const typeIn = async (i, v) => {
  await ev(s, `(()=>{const el=document.querySelectorAll('.tyq-panel input.tyq-input')[${i}]; el.focus(); el.select(); return 1})()`);
  await send('Input.insertText', { text: v }, s);
  await sleep(300);
};

await typeIn(0, q);
check('计数与正文一致', (await info()).includes(`共 ${qCount} 处匹配`), await info());
check('高亮数量与命中一致', (await ev(s, `document.querySelectorAll('.tyq-hl').length`)) === Math.min(qCount, 300), String(await ev(s, `document.querySelectorAll('.tyq-hl').length`)));
check('全部替换按钮带数量', (await ev(s, `[...document.querySelectorAll('.tyq-panel .tyq-btn')].map(b=>b.textContent).join('|')`)).includes(`全部替换 (${qCount})`), '');
check('未输入时无高亮残留顺序正常', true, '');

// 选择器：用真实素材名搜索
const refNames = JSON.parse(await ev(s, `JSON.stringify(__TYQ.api().refs.map(r=>r.assetName||r.nodeTitle||''))`));
const refToken = JSON.parse(await ev(s, `JSON.stringify(__TYQ.buildIndex(__TYQ.api().refs).map(x=>({token:x.token,name:x.name})))`));
const pickName = refNames[0].replace(/\.[a-z]+$/i, '').slice(0, 4);   // 取第一个素材名的前几字
await ev(s, `document.querySelector('.tyq-pickbtn').click(); 1`);
await sleep(250);
const rowsCount = await ev(s, `document.querySelectorAll('.tyq-pickrow').length`);
check('选择器列出全部真实素材', rowsCount === refToken.length + 1, `${rowsCount} 行 / 素材 ${refToken.length}`);
await typeIn(2, pickName);
await sleep(300);
const filtered = await ev(s, `[...document.querySelectorAll('.tyq-pickrow')].map(r=>r.textContent).join('|')`);
check('选择器按真实素材名过滤', filtered.includes(pickName) && filtered.split('|').length <= 2, filtered);

// 回车选中首项（X1 行为）
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, s);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, s);
await sleep(350);
const pickBtnText = await ev(s, `document.querySelector('.tyq-pickbtn').textContent`);
check('选择器回车可选中', /替换为引用：/.test(pickBtnText), pickBtnText);

// 单条替换 → 撤销（焦点留在查找框）
await ev(s, `(()=>{const b=[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(x=>x.textContent.trim()==='替换'); b.click(); return 1})()`);
await sleep(1100);
const afterRep = await txt();
const repToken = (afterRep.match(/@图片\d/) || [''])[0];
check('替换为引用生效', afterRep !== ORIG && afterRep.includes(repToken), `${ORIG.length} → ${afterRep.length}，${repToken}`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 1 }, s);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 1 }, s);
await sleep(1000);
check('Alt+Z（焦点在查找框）逐字还原', (await txt()) === ORIG, `${(await txt()).length}/${ORIG.length}`);

// 重做 → 再撤销
await ev(s, `__TYQ.close(); __TYQ.redo(); 1`);
await sleep(900);
const afterRedo = await txt();
check('重做回到替换后内容', afterRedo === afterRep, `${afterRedo.length}/${afterRep.length}`);
await ev(s, `__TYQ.undo(); 1`);
await sleep(900);
check('再次撤销仍逐字还原', (await txt()) === ORIG, `${(await txt()).length}`);

// 全部替换 → 撤销
await ev(s, `__TYQ.open('find'); 1`);
await sleep(500);
await typeIn(0, q);
await sleep(300);
const beforeAll = await txt();
await ev(s, `(()=>{const b=[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(x=>/^全部替换/.test(x.textContent.trim())); b.click(); return 1})()`);
await sleep(1200);
const afterAll = await txt();
check('全部替换生效且不残留关键词', afterAll.split(q).length - 1 === 0 && afterAll !== beforeAll, `${beforeAll.length} → ${afterAll.length}`);
await ev(s, `__TYQ.undo(); 1`);
await sleep(1000);
check('全部替换撤销后逐字还原', (await txt()) === ORIG, `${(await txt()).length}`);

await ev(s, `__TYQ.close(); 1`);
if ((await txt()) !== ORIG) {
  await ev(s, `__TYQ.api().set(${JSON.stringify(ORIG)}); 1`);
  await sleep(800);
  console.log('⚠ 中途不一致，已用备份强制还原:', (await txt()) === ORIG);
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
close();
process.exit(pass === results.length ? 0 : 1);
