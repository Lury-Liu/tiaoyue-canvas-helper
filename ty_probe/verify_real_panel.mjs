/* 真实提示词面板验证 v1.11.0 查找页改动；写回后立即撤销并校验与原文逐字一致 */
import { connect, attach, ev, send, close } from './lib.mjs';
import fs from 'node:fs';

const SRC = fs.readFileSync('../tiaoyue-ref-helper-ext/content.js', 'utf8');

await connect();
const tgt = (await send('Target.getTargets')).targetInfos.find((x) => x.type === 'page' && x.url.includes('01a1a6465e567b8f8dbbebc21a0c88bf'));
if (!tgt) { console.log('目标画布页未打开'); process.exit(0); }
const s = await attach(tgt.targetId);
const ORIG = await ev(s, '__TYQ.serialize(__TYQ.api().el)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); };
const txt = () => ev(s, '__TYQ.serialize(__TYQ.api().el)');
const info = () => ev(s, `document.querySelector('.tyq-panel .tyq-hint').textContent`);

// 0) 注入最新构建（清旧实例，不动正文）
await ev(s, `(()=>{document.querySelectorAll('.tyq-launch,.tyq-panel,.tyq-guide-mask,.tyq-pin,.tyq-pmark,.tyq-hl').forEach(n=>n.remove());
  document.querySelectorAll('#tyq-style').forEach(n=>n.remove());delete window.__TYQ_LOADED__;delete window.__TYQ;
  localStorage.setItem('tyq.guide.v1','true');try{localStorage.removeItem('tyq.tab.v1')}catch(e){};return 1})()`);
await ev(s, SRC + '\n"ok"');
await sleep(1800);
const cur = await txt();
check('注入后正文未变', cur === ORIG, `${cur.length}/${ORIG.length}`);

// 1) 打开查找页
await ev(s, `__TYQ.open('find'); 1`);
await sleep(600);
const typeFind = async (v) => {
  await ev(s, `(()=>{const i=document.querySelectorAll('.tyq-panel input.tyq-input')[0]; i.focus(); i.select(); return 1})()`);
  await send('Input.insertText', { text: v }, s);
  await sleep(350);
};

// 2) 计数与高亮：用正文里真实出现的词
const q = '维多利亚';
const expectCount = ORIG.split(q).length - 1;
await typeFind(q);
check(`计数与原文一致（${expectCount} 处）`, (await info()).includes(`共 ${expectCount} 处匹配`), await info());
check('高亮框数量与命中一致', (await ev(s, `document.querySelectorAll('.tyq-hl').length`)) === Math.min(expectCount, 300), String(await ev(s, `document.querySelectorAll('.tyq-hl').length`)));
check('全部替换按钮带数量', (await ev(s, `[...document.querySelectorAll('.tyq-panel .tyq-btn')].map(b=>b.textContent).join('|')`)).includes(`全部替换 (${expectCount})`), await ev(s, `[...document.querySelectorAll('.tyq-panel .tyq-btn')].map(b=>b.textContent).join('|')`));

// 3) 素材选择器：真实素材名可搜索
await ev(s, `document.querySelector('.tyq-pickbtn').click(); 1`);
await sleep(250);
const rowsAll = await ev(s, `[...document.querySelectorAll('.tyq-pickrow')].map(r=>r.textContent).join('|')`);
check('选择器列出真实素材（6 个）', (await ev(s, `document.querySelectorAll('.tyq-pickrow').length`)) === 7 && /克洛伊-精致便装/.test(rowsAll), rowsAll.slice(0, 80));
await ev(s, `(()=>{const i=document.querySelector('.tyq-pickbox input.tyq-input'); i.focus(); return 1})()`);
await send('Input.insertText', { text: '维多利亚' }, s);
await sleep(300);
const rowsFiltered = await ev(s, `[...document.querySelectorAll('.tyq-pickrow')].map(r=>r.textContent).join('|')`);
check('选择器按名过滤', rowsFiltered.includes('维多利亚') && !rowsFiltered.includes('克洛伊'), rowsFiltered.slice(0, 60));

// 4) 选中素材 → 单条替换 → 自动前进 → 撤销恢复
await ev(s, `(()=>{const r=[...document.querySelectorAll('.tyq-pickrow')].find(x=>x.textContent.includes('维多利亚')); r.click(); return 1})()`);
await sleep(300);
check('按钮回显选中素材', /替换为引用：维多利亚/.test(await ev(s, `document.querySelector('.tyq-pickbtn').textContent`)), await ev(s, `document.querySelector('.tyq-pickbtn').textContent`));

await ev(s, `(()=>{const b=[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(x=>x.textContent.trim()==='替换'); b.click(); return 1})()`);
await sleep(1000);
const afterRep = await txt();
const repToken = (afterRep.match(/@图片\d/) || [''])[0];
check('替换为引用生效', !!repToken && afterRep.length === ORIG.length - q.length + repToken.length,
  `len ${ORIG.length} → ${afterRep.length}，替换为 ${repToken}（${repToken.length} 字符）`);
if (expectCount > 1) {
  check('替换后自动前进到下一处', /当前第 1\/\d+ 处|还剩 \d+ 处/.test(await info() + (await ev(s, `document.body.innerText.slice(-60)`))), await info());
}
await ev(s, `__TYQ.undo(); 1`);
await sleep(900);
check('撤销后与原文逐字一致', (await txt()) === ORIG, `${(await txt()).length}/${ORIG.length}`);

// 5) 全部替换 → 撤销恢复
await ev(s, `(()=>{const i=document.querySelectorAll('.tyq-panel input.tyq-input')[1]; i.disabled=false; return 1})()`);
await ev(s, `__TYQ.open('find'); 1`);
await sleep(400);
await typeFind('全程');
const beforeAll = await txt();
await ev(s, `(()=>{const b=[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(x=>/^全部替换/.test(x.textContent.trim())); b.click(); return 1})()`);
await sleep(1200);
const afterAll = await txt();
const tokAll = (afterAll.match(/@图片\d/) || [''])[0];
const cntBefore = beforeAll.split(tokAll).length - 1;
const cntAfter = afterAll.split(tokAll).length - 1;
const expectedLen = beforeAll.length + expectCount * (tokAll.length - q.length);
// 原文里本来就有 @图片4，不能用「反推全部 token」比对；改为：增量为命中数、长度符合、关键词清零
check('全部替换生效且不残留',
  !!tokAll && cntAfter - cntBefore === expectCount && afterAll.length === expectedLen && afterAll.split(q).length - 1 === 0,
  `${beforeAll.length} → ${afterAll.length}（预期 ${expectedLen}），${tokAll} ${cntBefore}→${cntAfter}，「${q}」${beforeAll.split(q).length - 1}→${afterAll.split(q).length - 1}`);
await ev(s, `__TYQ.undo(); 1`);
await sleep(900);
check('全部替换撤销后与原文一致', (await txt()) === ORIG, `${(await txt()).length}/${ORIG.length}`);

// 6) 收尾：保留用户面板，关闭插件面板
await ev(s, `(()=>{__TYQ.close(); document.querySelectorAll('.tyq-hl,.tyq-pin').forEach(n=>n.remove()); return 1})()`);

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
close();
process.exit(pass === results.length ? 0 : 1);
