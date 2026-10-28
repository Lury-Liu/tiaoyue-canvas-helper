/* 构建脚本：从 tiaoyue-ref-helper.user.js 生成扩展 content.js，并同步版本号。
 * 用法：node tools/build.mjs [新版本号]
 *   不带参数 → 使用 manifest.json 现有版本号（只重新生成 content.js）
 *   带参数   → 同时提升 manifest.json / version.json / user.js 头部版本号
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'tiaoyue-ref-helper-ext');
const USER_JS = path.join(ROOT, 'tiaoyue-ref-helper.user.js');
const MANIFEST = path.join(EXT, 'manifest.json');
const VERSION_JSON = path.join(EXT, 'version.json');

const newVer = process.argv[2] || null;

// 1. 版本号
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
if (newVer) {
  if (!/^\d+\.\d+\.\d+$/.test(newVer)) {
    console.error('版本号格式应为 x.y.z，例如 1.5.1');
    process.exit(1);
  }
  manifest.version = newVer;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  // user.js 头部 + 运行时版本常量（自更新比对用）
  let u = fs.readFileSync(USER_JS, 'utf8');
  u = u.replace(/(\/\/ @version\s+)\S+/, '$1' + newVer);
  u = u.replace(/(const TYQ_VERSION = ')[^']+(';)/, '$1' + newVer + '$2');
  if (!u.includes(`const TYQ_VERSION = '${newVer}'`)) {
    console.error('未找到 TYQ_VERSION 常量，无法同步版本号');
    process.exit(1);
  }
  fs.writeFileSync(USER_JS, u);
}
const ver = manifest.version;

// 2. version.json
fs.writeFileSync(VERSION_JSON, JSON.stringify({
  version: ver,
  file: 'tiaoyue-ref-helper-ext/content.js',
}, null, 2) + '\n');

// 3. content.js（去掉油猴头部，换成扩展头部注释）
let src = fs.readFileSync(USER_JS, 'utf8');
const cut = src.indexOf('// ==/UserScript==');
if (cut === -1) {
  console.error('未找到 // ==/UserScript== 标记');
  process.exit(1);
}
const body = src.slice(cut + '// ==/UserScript=='.length);
const header =
  '/* 跳跃视界 · 画布引用助手（MV3 扩展 content script，main world，内置兜底版）\n' +
  `   版本：${ver}。在线更新由 loader.js 负责，本文件仅在无网/无更新时使用。 */\n`;
fs.writeFileSync(path.join(EXT, 'content.js'), header + body);

console.log(`已构建 v${ver}`);
console.log('发布：git add -A && git commit -m "v' + ver + '" && git push');
