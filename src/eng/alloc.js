"use strict";
let ST = null, SX = null, STBYTES = null;

(function(){ let k = 0;
  for(const r of SCHEMA) if(r[2] === "plant") globalThis["SC_"+r[0].toUpperCase()] = k++;
  globalThis.SC_COUNT = k; })();

const ENG_CTOR = {f64:Float64Array, f32:Float32Array, i32:Int32Array, u8:Uint8Array};
const ENG_SIZE = {f64:8, f32:4, i32:4, u8:1};

function engDimLen(dim, N){
  const v = N[dim];
  if(v === undefined) throw new Error("engAlloc: no count for dim "+dim);
  return v;
}

/* views over one buffer per store, 8-byte aligned; the snapshot is a byte copy of the "s" buffer */
function engLayout(N, store){
  const rows = [];
  let off = 0;
  if(store === "s"){ rows.push(["sc", "f64", SC_COUNT, 0]); off = SC_COUNT*8; }
  for(const r of SCHEMA){
    if((r[4] || "s") !== store || r[2] === "plant") continue;
    off = (off + 7) & ~7;
    const len = engDimLen(r[2], N);
    rows.push([r[0], r[1], len, off]);
    off += len*ENG_SIZE[r[1]];
  }
  return {rows, bytes:(off + 7) & ~7};
}

function engViews(lay, buf){
  const o = {};
  for(const [name, type, len, off] of lay.rows) o[name] = new ENG_CTOR[type](buf, off, len);
  return o;
}

function engAlloc(N){
  const ls = engLayout(N, "s"), lx = engLayout(N, "x");
  const Buf = typeof SharedArrayBuffer === "function" ? SharedArrayBuffer : ArrayBuffer;
  const bs = new Buf(ls.bytes), bx = new ArrayBuffer(lx.bytes);
  ST = engViews(ls, bs); SX = engViews(lx, bx);
  ST.buf = bs; ST.layout = ls;
  STBYTES = new Uint8Array(bs);
  engInit();
  return ST;
}

function engInit(){
  for(const r of SCHEMA){
    const v = r[3] === undefined ? 0 : r[3];
    if((r[4] || "s") !== "s"){ if(v !== 0) SX[r[0]].fill(v); continue; }
    if(r[2] === "plant") ST.sc[globalThis["SC_"+r[0].toUpperCase()]] = v;
    else if(v !== 0) ST[r[0]].fill(v);
  }
}

function eEvent(code, a, b){
  const sc = ST.sc, h = sc[SC_EVHEAD];
  ST.evCode[h] = code; ST.evTick[h] = sc[SC_TICK]; ST.evA[h] = a; ST.evB[h] = b;
  sc[SC_EVHEAD] = (h + 1) % EV_N; sc[SC_EVCOUNT]++;
}

/* a big object built key by key is a hash table; as a prototype V8 lays it out flat, so its doubles load unboxed */
function engFastOf(o){ function F(){} F.prototype = o; const x = new F(); return x.constructor === F ? o : o; }
function engFast(){ engFastOf(P); engFastOf(PT); engFastOf(ST); engFastOf(SX); }

const engSnapNew =() => new Uint8Array(STBYTES.length);
const engSnap = dst => { dst.set(STBYTES); return dst; };
const engRestore = src => { STBYTES.set(src); eNetInvalidate(); };
