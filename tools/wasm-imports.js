#!/usr/bin/env node
// node tools/wasm-imports.js <file.wasm> — list module.field of the import
// section; exit 1 on anything outside the ABI allow-list (docs/abi-*.md §3).
// Self-test: node tools/wasm-imports.js --selftest (synthetic module, no build).
'use strict';
const fs = require('fs');

const ALLOW = new Set(['env.log_event', 'env.console_warn']);

function readU32LEB(buf, o) {
  let r = 0, s = 0, i = o;
  for (;;) { const b = buf[i++]; r |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break; }
  return [r, i];
}
function importsOf(bytes) {
  const out = [];
  if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('not wasm');
  let o = 8;
  while (o < bytes.length) {
    const id = bytes[o++];
    let [len, p] = readU32LEB(bytes, o); o = p + len;
    if (id !== 2) continue;
    let q = p;
    let [n, r] = readU32LEB(bytes, q); q = r;
    for (let i = 0; i < n; i++) {
      let [ml, a] = readU32LEB(bytes, q); q = a;
      const mod = Buffer.from(bytes.slice(q, q + ml)).toString('utf8'); q += ml;
      let [fl, b] = readU32LEB(bytes, q); q = b;
      const field = Buffer.from(bytes.slice(q, q + fl)).toString('utf8'); q += fl;
      const kind = bytes[q++];
      if (kind === 0) { const [x, c] = readU32LEB(bytes, q); q = c; void x; }
      else if (kind === 1) q += 2;
      else if (kind === 2) { const [x, c] = readU32LEB(bytes, q); q = c; void x; }
      else if (kind === 3) q += 1;
      out.push(mod + '.' + field);
    }
  }
  return out;
}

function leb(n) { const b = []; do { let c = n & 0x7f; n >>>= 7; if (n) c |= 0x80; b.push(c); } while (n); return b; }
function str(s) { const b = Buffer.from(s, 'utf8'); return [...leb(b.length), ...b]; }
// (module (import "env" "log_event" (func)) (import "env" "console_warn" (func)))
function synthetic() {
  const imp = [...str('env'), ...str('log_event'), 0x00, 0x00, ...str('env'), ...str('console_warn'), 0x00, 0x00];
  const sec = [...leb(2), ...imp];
  return Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 2, ...leb(sec.length), ...sec]);
}

if (require.main === module) {
  if (process.argv[2] === '--selftest') {
    const got = importsOf(synthetic());
    const ok = got.length === 2 && got.every(i => ALLOW.has(i));
    console.log((ok ? 'PASS' : 'FAIL') + ' selftest imports=[' + got.join(',') + ']');
    process.exit(ok ? 0 : 1);
  }
  const got = importsOf(fs.readFileSync(process.argv[2]));
  const bad = got.filter(i => !ALLOW.has(i));
  for (const i of got) console.log((ALLOW.has(i) ? 'ok   ' : 'BLOCK') + ' ' + i);
  if (bad.length) { console.error('unlisted imports: ' + bad.join(',')); process.exit(1); }
}

module.exports = { importsOf, ALLOW };
