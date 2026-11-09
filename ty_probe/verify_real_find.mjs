/* 真实画布页验证 find 页 1-5 项改动（合成编辑器，不碰用户内容） */
import { connect, attach, ev, send, close } from './lib.mjs';
import fs from 'node:fs';

const T = fs.readFileSync('find_real_target.txt', 'utf8').trim();
const SRC = fs.readFileSync('../tiaoyue-ref-helper-ext/content.js', 'utf8');
const SYNTH = fs.readFileSync('synth_editor.js', 'utf8');

await connect();
const s = await attach(T);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); };

// 1) 注入最新脚本（清掉旧实例）
await ev(s, `(()=>{document.querySelectorAll('.tyq-launch,.tyq-panel,.tyq-guide-mask,.tyq-pin,.tyq-pmark,.tyq-hl').forEach(n=>n.remove());document.querySelectorAll('#tyq-style').forEach(n=>n.remove());delete window.__TYQ_LOADED__;delete window.__TYQ;localStorage.setItem('tyq.guide.v1','true');try{localStorage.removeItem('tyq.tab.v1')}catch(e){};return 1})()`);
await ev(s, SRC + '\n"ok"');
await sleep(1800);
check('注入 v1.11 脚本', await ev(s, `!!document.querySelector('.tyq-launch')`), 'launch');

// 2) 造合成编辑器
console.log('synth:', await ev(s, SYNTH));
await sleep(400);
check('合成编辑器可被 api() 识别', await ev(s, `!!window.__TYQ && !!__TYQ.api()`), '');
check('素材索引 11 个', await ev(s, `__TYQ.api().refs.length`) === 11, String(await ev(s, `__TYQ.api() ? __TYQ.api().refs.length : -1`)));

// 3) 打开查找页
await ev(s, `__TYQ.open('find'); 1`);
await sleep(500);
const typeFind = async (v) => {
  await ev(s, `(()=>{const i=document.querySelectorAll('.tyq-panel input.tyq-input')[0]; i.focus(); i.select(); return 1})()`);
  await send('Input.insertText', { text: v }, s);
  await sleep(300);
};
const infoText = () => ev(s, `document.querySelector('.tyq-panel .tyq-hint').textContent`);
await typeFind('艾洛文');
await sleep(300);
check('计数正确（2 处）', /共 2 处匹配/.test(await infoText()), await infoText());
check('高亮框 2 个', (await ev(s, `document.querySelectorAll('.tyq-hl').length`)) === 2, '');
check('全部替换按钮显示数量', (await ev(s, `[...document.querySelectorAll('.tyq-panel .tyq-btn')].map(b=>b.textContent).join('|')`)).includes('全部替换 (2)'), await ev(s, `[...document.querySelectorAll('.tyq-panel .tyq-btn')].map(b=>b.textContent).join('|')`));

// 4) 素材匹配：11 个 image.png → 应提示"还有 N 个"
await typeFind('png');   // 11 个素材名都含 png，超过 8 条上限
await sleep(300);
const assetPanelText = await ev(s, `document.querySelector('.tyq-panel').innerText`);
check('素材匹配超过 8 条给出提示', /还有 3 个匹配素材/.test(assetPanelText) && (await ev(s, `document.querySelectorAll('.tyq-fmatch').length`)) === 8, assetPanelText.split('\n').slice(-3).join(' / '));

// 5) 替换为引用：可搜索选择器
await ev(s, `document.querySelector('.tyq-pickbtn').click(); 1`);
await sleep(200);
const pickRows = await ev(s, `[...document.querySelectorAll('.tyq-pickrow')].map(r=>r.textContent).join('|')`);
check('选择器打开并列出候选', /改用普通文本/.test(pickRows) && /艾洛文/.test(pickRows), pickRows.slice(0, 90));
await ev(s, `(()=>{const i=document.querySelector('.tyq-pickbox input.tyq-input'); i.focus(); return 1})()`);
await send('Input.insertText', { text: '巴迪' }, s);
await sleep(300);
const filtered = await ev(s, `[...document.querySelectorAll('.tyq-pickrow')].map(r=>r.textContent).join('|')`);
check('选择器可搜索过滤', filtered.includes('巴迪') && !filtered.includes('玛拉'), filtered);

// 6) 选中素材 → 替换（替换为引用 + 自动前进）
await ev(s, `(()=>{const r=[...document.querySelectorAll('.tyq-pickrow')].find(x=>x.textContent.includes('巴迪')); if(r) r.click(); return !!r})()`);
await sleep(300);
check('选定后按钮显示引用名', /替换为引用：巴迪-狗形态/.test(await ev(s, `document.querySelector('.tyq-pickbtn').textContent`)), await ev(s, `document.querySelector('.tyq-pickbtn').textContent`));

await typeFind('艾洛文');
await sleep(300);
// 点"替换"：应替换第一处为 @图片2，并跳到下一处
await ev(s, `(()=>{const b=[...document.querySelectorAll('.tyq-panel .tyq-btn')].find(x=>x.textContent.trim()==='替换'); b.click(); return 1})()`);
await sleep(900);
const after = await ev(s, `__TYQ.serialize(__TYQ.api().el)`);
check('替换为引用生效', /开头 @图片2/.test(after), after.slice(0, 40));
check('替换后信息切到第 2 处', /当前第 2\/2 处|还剩 1 处/.test(await infoText() + ' ' + (await ev(s, `document.body.innerText.slice(-80)`))), await infoText());

// 7) 全部替换 + 撤销
await ev(s, `__TYQ.undo(); 1`);
await sleep(700);
check('撤销回到原文', /开头 艾洛文/.test(await ev(s, `__TYQ.serialize(__TYQ.api().el)`)), (await ev(s, `__TYQ.serialize(__TYQ.api().el)`)).slice(0, 30));

// 8) 清理
await ev(s, `(()=>{__TYQ.close(); const sy=window.__TYQ_SYNTH__; if(sy){sy.host.remove(); delete window.__TYQ_SYNTH__;} document.querySelectorAll('.tyq-hl,.tyq-pin').forEach(n=>n.remove()); return 1})()`);
check('清理完成', await ev(s, `!document.getElementById('tyq-synth')`), '');

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
close();
process.exit(pass === results.length ? 0 : 1);
