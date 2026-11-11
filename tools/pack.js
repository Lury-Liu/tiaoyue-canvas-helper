#!/usr/bin/env node
/* 打扩展分发包：tiaoyue-ref-helper-ext/ → tiaoyue-ref-helper-ext.zip
 *
 * 为什么不用 PowerShell 的 Compress-Archive：
 *   它写出的目录条目用反斜杠（icons\icon16.png），不符合 ZIP 规范
 *   （APPNOTE 4.4.17.1 要求 '/'）。部分解压工具会把它当成一个文件名，
 *   结果解压后没有 icons 目录，Chrome 加载时报「无法加载图标」。
 *
 * 用法：node tools/pack.js  → 输出 zip 路径 + sha256
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'tiaoyue-ref-helper-ext');
const OUT = path.join(ROOT, 'tiaoyue-ref-helper-ext.zip');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// 递归收集文件，条目名统一用 '/' 分隔
function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full, size: st.size });
  }
  return out;
}

const files = walk(SRC);
const locals = [];
const centrals = [];
let offset = 0;

for (const f of files) {
  const raw = fs.readFileSync(f.full);
  const crc = crc32(raw);
  const deflated = zlib.deflateRawSync(raw, { level: 9 });
  const nameBuf = Buffer.from(f.rel, 'utf8');

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);           // version needed
  lh.writeUInt16LE(0x0800, 6);       // flag: UTF-8 名
  lh.writeUInt16LE(8, 8);            // method: deflate
  lh.writeUInt16LE(0, 10);           // time
  lh.writeUInt16LE(0x21, 12);        // date（固定值，保证可复现）
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(deflated.length, 18);
  lh.writeUInt32LE(raw.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, nameBuf, deflated);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);           // version made by
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(0, 12);
  ch.writeUInt16LE(0x21, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(deflated.length, 20);
  ch.writeUInt32LE(raw.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);           // extra
  ch.writeUInt16LE(0, 32);           // comment
  ch.writeUInt16LE(0, 34);           // disk
  ch.writeUInt16LE(0, 36);           // internal attr
  ch.writeUInt32LE(0, 38);           // external attr
  ch.writeUInt32LE(offset, 42);
  centrals.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + deflated.length;
}

const cdBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, cdBuf, eocd]);
fs.writeFileSync(OUT, zip);

const sha = crypto.createHash('sha256').update(zip).digest('hex');
console.log('打包完成：' + path.relative(ROOT, OUT));
console.log('文件数：' + files.length + ' | 大小：' + zip.length + ' 字节');
console.log('sha256：' + sha);
for (const f of files) console.log('  ' + f.rel.padEnd(24) + String(f.size).padStart(7));
