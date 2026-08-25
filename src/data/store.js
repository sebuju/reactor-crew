"use strict";
/* the one storage layer, and the two backends under it */

/* ═══════════════ THE SERVER IS OPTIONAL AND THE GAME DOES NOT NEED IT ═══════════════

   `index.html` opens straight off the filesystem and every part of the game
   works there. What `file://` cannot do is write a file, so this is the one
   place that asks whether anybody is listening: `storeProbe()` pings
   `tools/server.js`, and everything below either talks to it or answers "no"
   quietly. NOTHING here throws and nothing here refuses to load - a panel that
   wants to save asks, gets `null`, and prints `storeWhy()`.

   NO TOP-LEVEL SIDE EFFECTS. Not one. This file is concatenated into the
   bundle the three auditors evaluate through `new Function` in Node, where
   `fetch` may not exist at all and `window` is a stub; a probe at load time
   would fire on every audit run and a `fetch` at load time would take the
   whole bundle down with it. The probe is a call the page makes, once, when it
   boots. */

/* `base` is an override and normally stays empty: the page is served by the
   same process on whatever port it was given, so the URL has to be RELATIVE.
   Hard-coding `http://localhost:8017` would be wrong the moment somebody
   passes a port - and wrong in a way that looks like the server being down. */
const STORE = {on:false, base:"", probed:false};
const storeURL = tail => (STORE.base || "api/") + tail;

/* ═══════════════ JSON CANNOT CARRY WHAT A RECORDING IS MADE OF ═══════════════

   A plant state is largely `Float64Array`s - the nodal core's flux, fuel
   temperature and void fields are all flat typed arrays - and a recording is
   many plant states. `JSON.stringify` turns a Float64Array into
   `{"0":1,"1":2,...}`, an object of numbers that parses back as a plain object
   and then reads `.length` as undefined in the solver. So a tagged form on the
   way out and back again on the way in.

   WHY IT LIVES HERE AND NOT IN THE RECORDER. The recorder's own cloner stays
   bit-exact and in-memory: it never leaves the process, so it can keep the
   typed array itself and copy it. This one crosses a PROCESS BOUNDARY, where
   the only thing that survives is text, so it has to be a wider and slower
   format - an array of plain numbers per field, allocated twice. Two different
   jobs; the day they are made one, the in-memory path pays for the text.

   Non-finite numbers go the same way and for the same reason: `stringify`
   turns `Infinity` and `NaN` into `null`, which is 0 the moment anything adds
   to it. `s.perV` - the reactor period - starts at `Infinity` on every reset,
   so this is not hypothetical. */

/* One table, so a tag and its constructor cannot drift apart. Add a kind here
   and both directions know about it. */
const TARR = {__f64:Float64Array, __f32:Float32Array, __i32:Int32Array, __u8:Uint8Array};
const NUMTAG = "__num";
/* An element of a typed array is always a number, so a non-finite one can be
   the bare string without ambiguity. A number sitting loose in an object
   cannot, so that one gets the tag. */
const packNum = n => Number.isFinite(n) ? n : String(n);

function packVal(v){
  if(typeof v === "number") return Number.isFinite(v) ? v : {[NUMTAG]:String(v)};
  if(v && typeof v === "object"){
    for(const tag in TARR)
      if(v instanceof TARR[tag]) return {[tag]:Array.from(v, packNum)};
    if(Array.isArray(v)) return v.map(packVal);
    const o = {};
    for(const k of Object.keys(v)) o[k] = packVal(v[k]);
    return o;
  }
  return v;                                  // string, boolean, null, undefined
}

function unpackVal(v){
  if(!v || typeof v !== "object") return v;
  if(Array.isArray(v)) return v.map(unpackVal);
  const keys = Object.keys(v);
  if(keys.length === 1){
    /* One key only, so a real object that happens to carry a field called
       `__f64` alongside anything else is still read as an object. */
    const k = keys[0];
    if(k === NUMTAG && typeof v[k] === "string") return Number(v[k]);
    if(TARR[k] && Array.isArray(v[k])) return TARR[k].from(v[k], Number);
  }
  const o = {};
  for(const k of keys) o[k] = unpackVal(v[k]);
  return o;
}

/* ═══════════════ IS ANYBODY LISTENING ═══════════════ */

/* Defensive to the point of rudeness, because every way this can fail is a way
   the game still has to start: no `fetch` at all (the auditors, and the bundle
   run through `new Function` in Node), a `fetch` that throws synchronously on
   `file://`, a 404 from something else squatting on the port, and a 200 whose
   body is somebody's HTML rather than our `{ok:true}`. */
async function storeProbe(){
  STORE.probed = true;
  STORE.on = false;
  if(typeof fetch !== "function") return false;
  try{
    const r = await fetch(storeURL("ping"), {cache:"no-store"});
    if(!r.ok) return false;
    const j = await r.json();
    STORE.on = !!(j && j.ok);
  }catch(e){ STORE.on = false; }
  return STORE.on;
}

/* ═══════════════ THE FOUR ACTS ═══════════════

   `kind` is "scenarios" or "recordings". Every one of these RESOLVES on
   failure rather than rejecting, so a caller on `file://` is a `null` and not
   an unhandled rejection halfway through a draw.

   `null` from a list means THERE IS NO STORE; `[]` means the store is empty
   and nothing has been saved yet. A panel prints `storeWhy()` for the first
   and "nothing saved" for the second, so keep them apart. */

const storeOff = () => !STORE.on || typeof fetch !== "function";

async function storeList(kind){
  if(storeOff()) return null;
  try{
    const r = await fetch(storeURL(kind), {cache:"no-store"});
    if(!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  }catch(e){ return null; }
}

async function storeLoad(kind, id){
  if(storeOff()) return null;
  try{
    const r = await fetch(storeURL(kind + "/" + id), {cache:"no-store"});
    if(!r.ok) return null;
    return unpackVal(await r.json());
  }catch(e){ return null; }
}

async function storeSave(kind, id, obj){
  if(storeOff()) return false;
  try{
    const r = await fetch(storeURL(kind + "/" + id), {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(packVal(obj)),
    });
    if(!r.ok) return false;
    const j = await r.json();
    return !!(j && j.ok);
  }catch(e){ return false; }
}

async function storeDelete(kind, id){
  if(storeOff()) return false;
  try{
    const r = await fetch(storeURL(kind + "/" + id), {method:"DELETE"});
    if(!r.ok) return false;
    const j = await r.json();
    return !!(j && j.ok);
  }catch(e){ return false; }
}

/* ══ ONE STRING, ONE PLACE ══
   Two panels will want to explain the same absence, and two panels wording it
   differently is two different accounts of whether anything is broken. It is
   not broken: the game is running exactly as designed and saving is the extra. */
const storeWhy = () =>
  "SAVING IS OFF. The page is running from the filesystem, which cannot write " +
  "files - everything else works. Run  node tools/server.js  and open the " +
  "address it prints to keep scenarios and recordings on disk.";
