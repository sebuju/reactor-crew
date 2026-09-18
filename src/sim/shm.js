"use strict";
/* The viewer's copy of the state, in memory both threads hold: two slots, one copy of the state buffer each
   way per frame. The writer never fills the slot the reader was last told to empty. */
const SHM_ON = typeof SharedArrayBuffer === "function" && !urlOff("shm");
const SHM_HEAD = 8;                       // int32 header slots; [0] is the published sequence
const SHM_HEAD_B = SHM_HEAD*4;

function shmBind(sab, bytes){
  return {sab, bytes, ctrl:new Int32Array(sab, 0, SHM_HEAD), seq:0,
          slot:[new Uint8Array(sab, SHM_HEAD_B, bytes), new Uint8Array(sab, SHM_HEAD_B + bytes, bytes)]};
}
const shmNew = bytes => shmBind(new SharedArrayBuffer(SHM_HEAD_B + 2*bytes), bytes);
const shmAttach = sab => shmBind(sab, (sab.byteLength - SHM_HEAD_B)/2);

/* false when the plant's layout is no longer the buffer's, and the caller remakes it */
function shmPush(sh){
  if(sh.bytes !== STBYTES.length) return false;
  sh.slot[sh.seq & 1].set(STBYTES);
  sh.seq++;
  Atomics.store(sh.ctrl, 0, sh.seq);
  return true;
}
/* the sequence the packet names, never a slot the writer may be in */
function shmPull(sh, seq){
  if(sh.bytes !== STBYTES.length) throw new Error("shm: the viewer's plant is not the worker's ("+STBYTES.length+" vs "+sh.bytes+" bytes)");
  engRestore(sh.slot[(seq - 1) & 1]);
}
