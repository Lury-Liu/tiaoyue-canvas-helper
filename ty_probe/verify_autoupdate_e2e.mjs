/* 端到端：扩展内置 v1.11.3 + 远端 v1.11.4 → 进入画布应自动升级。
 * 判据：window.__TYQ.version 从 undefined 变成 1.11.4，且只有一个面板。
 */
import { connect, send, sleep, close } from './lib.mjs';

const URL_CANVAS = 'https://www.tiaoyue.com/aigc/canvas/projectCanvas/01a1a034c74479978e8945604199d4db/01a1a6465e567b8f8dbbebc21a0c88bf';

await connect();
const { targetId } = await send('Target.createTarget', { url: URL_CANVAS, background: true });

const probe = async (sid, tag) => {
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      v: (window.__TYQ && window.__TYQ.version) || null,
      panels: document.querySelectorAll('.tyq-panel').length,
      launchers: document.querySelectorAll('.tyq-launch').length,
      loaded: !!window.__TYQ_LOADED__,
      blob: document.querySelectorAll('script[src^="blob:"]').length
    })`,
    returnByValue: true,
  }, sid);
  console.log(tag, r.result.value);
  return JSON.parse(r.result.value);
};

await sleep(2500);
let { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await probe(sessionId, '2.5s (升级前):');

await sleep(6000);
const after = await probe(sessionId, '8.5s (升级后):');

console.log(after.v === '1.11.4'
  ? '\n✓ 自动更新成功：运行版本已升到 1.11.4'
  : `\n✗ 未升级，当前运行版本 = ${after.v}`);

await send('Target.closeTarget', { targetId }).catch(() => {});
close();
