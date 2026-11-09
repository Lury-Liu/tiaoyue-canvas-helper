/* 验证 content.js 的主世界自更新接管：注入远端最新代码（带 FORCE_ONCE），
 * 检查旧实例被清理、只剩一个面板、功能正常。
 */
import { connect, send, sleep, close } from './lib.mjs';

const URL_CANVAS = 'https://www.tiaoyue.com/aigc/canvas/projectCanvas/01a1a034c74479978e8945604199d4db/01a1a6465e567b8f8dbbebc21a0c88bf';

await connect();
const { targetId } = await send('Target.createTarget', { url: URL_CANVAS, background: true });
await sleep(7000);
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

const before = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    loaded: !!window.__TYQ_LOADED__,
    panels: document.querySelectorAll('.tyq-panel').length,
    launchers: document.querySelectorAll('.tyq-launch').length,
    hasApi: !!(window.__TYQ && window.__TYQ.open),
    editors: [...(document.querySelector('wujie-app')?.shadowRoot?.querySelectorAll('[class*="_promptEditor_"]') || [])].length
  })`,
  returnByValue: true,
}, sessionId);
console.log('注入前:', before.result.value);

// 拉远端最新 content.js，在主世界以 FORCE_ONCE 注入（与自更新完全相同的路径）
const injectRes = await send('Runtime.evaluate', {
  expression: `(async () => {
    const url = 'https://raw.githubusercontent.com/Lury-Liu/tiaoyue-canvas-helper/main/tiaoyue-ref-helper-ext/content.js?t=' + Date.now();
    const code = await (await fetch(url, {cache:'no-store'})).text();
    if (code.length < 5000) return 'code too short: ' + code.length;
    const blob = new Blob(['window.__TYQ_FORCE_ONCE=true;\\n', code], {type:'text/javascript'});
    const u = URL.createObjectURL(blob);
    const s = document.createElement('script');
    s.src = u;
    s.onload = () => URL.revokeObjectURL(u);
    (document.head || document.documentElement).appendChild(s);
    return 'injected ' + code.length + ' bytes';
  })()`,
  returnByValue: true, awaitPromise: true,
}, sessionId);
console.log('注入:', injectRes.result.value, injectRes.exceptionDetails ? JSON.stringify(injectRes.exceptionDetails).slice(0,200) : '');

await sleep(2500);

const after = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    loaded: !!window.__TYQ_LOADED__,
    forceOnce: !!window.__TYQ_FORCE_ONCE,
    panels: document.querySelectorAll('.tyq-panel').length,
    launchers: document.querySelectorAll('.tyq-launch').length,
    hasApi: !!(window.__TYQ && window.__TYQ.open),
    apiKeys: window.__TYQ ? Object.keys(window.__TYQ).length : 0,
    editors: [...(document.querySelector('wujie-app')?.shadowRoot?.querySelectorAll('[class*="_promptEditor_"]') || [])].length
  })`,
  returnByValue: true,
}, sessionId);
console.log('注入后:', after.result.value);

await send('Target.closeTarget', { targetId }).catch(() => {});
close();
