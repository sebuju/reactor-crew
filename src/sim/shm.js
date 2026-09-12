"use strict";
/* The viewer's copy of S, in memory both threads hold. A structured clone a frame was 0.34 MB of garbage
   per painted frame on each side, which is what the collector was stopping the world for. */
const SHM_ON = typeof SharedArrayBuffer === "function";
const SHM_HEAD = 8;                       // int32 header slots; [0] is the published sequence
const SHM_TA = [Float64Array, Float32Array, Int32Array, Uint8Array, Int8Array];
const shmTaOf = v => { for(let i=0;i<SHM_TA.length;i++) if(v instanceof SHM_TA[i]) return i; return -1; };
const shmAlign8 = n => (n + 7) & ~7;

/* One walk, made the same way on both threads, so slot N is the same number on each. `wr` fills the shared
   slot off the state; the reader runs the identical walk to empty it back into its own mirror of S.
   The rolling signature is the check: a key that appeared, an array that grew or a value whose type flipped
   all move it, and a moved signature remakes the buffer rather than writing the wrong slots. */
function shmWalk(sh, root, wr){
  const f = sh.f64, base = sh.base, tv = sh.tv, st = sh.strs, tal = sh.tal;
  let ni = 0, ti = 0, si = 0, sig = 0;
  let dirty = false;
  const w = (v, o, k) => {
    const t = typeof v;
    if(t === "number"){ sig = (sig*31 + 1)|0; if(wr) f[base+ni] = v; else o[k] = f[base+ni]; ni++; return; }
    if(t === "boolean"){ sig = (sig*31 + 2)|0; if(wr) f[base+ni] = v ? 1 : 0; else o[k] = f[base+ni] !== 0; ni++; return; }
    if(t === "string"){ sig = (sig*31 + 3)|0;
      if(wr){ if(st[si] !== v){ st[si] = v; dirty = true; } } else if(si < st.length) o[k] = st[si];
      si++; return; }
    if(v === null || v === undefined){ sig = (sig*31 + 4)|0; return; }
    const ta = shmTaOf(v);
    if(ta >= 0){ sig = (sig*31 + 5 + ta*7 + v.length)|0;
      if(tal) tal.push(ta, v.length);
      const d = tv[ti++]; if(d){ if(wr) d.set(v); else v.set(d); }
      return; }
    if(Array.isArray(v)){ sig = (sig*31 + 8 + v.length)|0;
      for(let i=0;i<v.length;i++) w(v[i], v, i); return; }
    sig = (sig*31 + 9)|0;
    for(const kk in v){ sig = (sig*31 + kk.length*131 + kk.charCodeAt(0))|0; w(v[kk], v, kk); }
  };
  w(root, null, null);
  sh.nNum = ni; sh.nTa = ti; sh.nStr = si; sh.sig = sig; sh.sdirty = dirty;
  return sig;
}

/* the typed arrays ride the same slot as the numbers, each at a fixed offset for the epoch's whole life */
function shmViews(sab, byteBase, tal){
  const out = []; let off = byteBase;
  for(let i=0;i<tal.length;i+=2){
    const T = SHM_TA[tal[i]], n = tal[i+1];
    out.push(new T(sab, off, n));
    off = shmAlign8(off + n*T.BYTES_PER_ELEMENT);
  }
  return out;
}

/* a dry walk prices the state: typed-array writes off the end of a zero-length view are dropped, which is
   what makes the same walk safe to run before there is a buffer to run it into */
function shmNew(root){
  const dry = {f64:new Float64Array(0), base:0, tv:[], strs:[], tal:[]};
  shmWalk(dry, root, true);
  let taB = 0;
  for(let i=0;i<dry.tal.length;i+=2) taB = shmAlign8(taB + dry.tal[i+1]*SHM_TA[dry.tal[i]].BYTES_PER_ELEMENT);
  const slotB = shmAlign8(dry.nNum*8) + taB;
  const headB = shmAlign8(SHM_HEAD*4);
  const sab = new SharedArrayBuffer(headB + 2*slotB);
  return shmBind(sab, headB, slotB, dry.tal);
}

/* the reader builds the same map off its own mirror, so nothing about the layout crosses the wire */
function shmAttach(sab, root){
  const dry = {f64:new Float64Array(0), base:0, tv:[], strs:[], tal:[]};
  shmWalk(dry, root, true);
  let taB = 0;
  for(let i=0;i<dry.tal.length;i+=2) taB = shmAlign8(taB + dry.tal[i+1]*SHM_TA[dry.tal[i]].BYTES_PER_ELEMENT);
  return shmBind(sab, shmAlign8(SHM_HEAD*4), shmAlign8(dry.nNum*8) + taB, dry.tal);
}

const taBytesOf = tal => { let b = 0;
  for(let i=0;i<tal.length;i+=2) b = shmAlign8(b + tal[i+1]*SHM_TA[tal[i]].BYTES_PER_ELEMENT);
  return b; };
function shmBind(sab, headB, slotB, tal){
  const numB = slotB - taBytesOf(tal);
  return {sab, ctrl:new Int32Array(sab, 0, SHM_HEAD), f64:new Float64Array(sab),
          headB, slotB, strs:[], tal:null, base:0, tv:null, seq:0, sdirty:false,
          slotBase:[headB/8, (headB + slotB)/8],
          slotTv:[shmViews(sab, headB + numB, tal), shmViews(sab, headB + slotB + numB, tal)]};
}

/* a keyframe in three objects instead of the ~2700 a snapshot of S costs, which is what a major collection
   walks: the take's own `base` is the template it is poured back into, so a key keeps only the values. */
function shmSig(root){
  const dry = {f64:new Float64Array(0), base:0, tv:[], strs:[], tal:null};
  return shmWalk(dry, root, true);
}
function shmKeySave(root){
  const dry = {f64:new Float64Array(0), base:0, tv:[], strs:[], tal:[]};
  shmWalk(dry, root, true);
  const taB = taBytesOf(dry.tal), buf = new ArrayBuffer(taB), nums = new Float64Array(dry.nNum);
  const k = {nums, buf, tv:shmViews(buf, 0, dry.tal), strs:[], sig:0, bytes:0};
  const sh = {f64:nums, base:0, tv:k.tv, strs:k.strs, tal:null};
  k.sig = shmWalk(sh, root, true);
  k.bytes = nums.byteLength + taB + 32 + 24*k.strs.length;
  return k;
}
/* the target must be a clone of the take's base, which is what makes the walks line up */
function shmKeyLoad(k, root){
  const sh = {f64:k.nums, base:0, tv:k.tv, strs:k.strs, tal:null};
  return shmWalk(sh, root, false) === k.sig;
}

/* writer: the slot alternates, so the reader is never emptying the one being filled */
function shmPush(sh, root){
  const slot = sh.seq & 1;
  sh.base = sh.slotBase[slot]; sh.tv = sh.slotTv[slot]; sh.tal = null;
  const sig = shmWalk(sh, root, true);
  if(sh.sigWas !== undefined && sig !== sh.sigWas) return false;
  sh.sigWas = sig;
  sh.seq++;
  Atomics.store(sh.ctrl, 0, sh.seq);
  return true;
}
/* reader: the sequence the packet names, never a slot the writer may be in */
function shmPull(sh, root, seq){
  const slot = (seq - 1) & 1;
  sh.base = sh.slotBase[slot]; sh.tv = sh.slotTv[slot]; sh.tal = null;
  shmWalk(sh, root, false);
}
