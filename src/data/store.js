"use strict";
/* No top-level side effects: this file is bundled into a `new Function` eval in Node, where `fetch` may not exist. */

/* Relative, never absolute: the page is served by the same process on whatever port it was given. */
const STORE = {on:false, base:"", probed:false};
const storeURL = tail => (STORE.base || "api/") + tail;

/* `JSON.stringify` flattens a typed array to a plain object and turns Infinity/NaN into null; both get tagged. */
const TARR = {__f64:Float64Array, __f32:Float32Array, __i32:Int32Array, __u8:Uint8Array, __i8:Int8Array};
const NUMTAG = "__num";
/* A typed-array element is always a number, so a bare string is unambiguous where a loose one needs the tag. */
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
  return v;
}

function unpackVal(v){
  if(!v || typeof v !== "object") return v;
  if(Array.isArray(v)) return v.map(unpackVal);
  const keys = Object.keys(v);
  if(keys.length === 1){
    /* One key only, so an object that merely carries a `__f64` field alongside others stays an object. */
    const k = keys[0];
    if(k === NUMTAG && typeof v[k] === "string") return Number(v[k]);
    if(TARR[k] && Array.isArray(v[k])) return TARR[k].from(v[k], Number);
  }
  const o = {};
  for(const k of keys) o[k] = unpackVal(v[k]);
  return o;
}

/* `j.ok` too: a 200 may come from something else on the port, and the game still has to start through it. */
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

/* These resolve on failure, never reject; `null` is NO STORE, `[]` is a store with nothing in it. */
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

const storeWhy = () =>
  "SAVING IS OFF. The page is running from the filesystem, which cannot write " +
  "files - everything else works. Run  node tools/server.js  and open the " +
  "address it prints to keep scenarios and recordings on disk.";

/* An XHR body is text, so a PNG goes as base64. */
async function snapPut(name, body, b64){
  if(storeOff()) return false;
  try{
    const r = await fetch(storeURL("snap/" + name) + (b64 ? "?b64=1" : ""), {
      method:"PUT",
      headers:{"Content-Type":"text/plain; charset=utf-8"},
      body,
    });
    if(!r.ok) return false;
    const j = await r.json();
    return !!(j && j.ok);
  }catch(e){ return false; }
}

async function snapList(){
  if(storeOff()) return null;
  try{
    const r = await fetch(storeURL("snap"), {cache:"no-store"});
    if(!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  }catch(e){ return null; }
}

async function snapGet(name){
  if(storeOff()) return null;
  try{
    const r = await fetch(storeURL("snap/" + name), {cache:"no-store"});
    return r.ok ? await r.text() : null;
  }catch(e){ return null; }
}

async function snapPurge(){
  if(storeOff()) return null;
  try{
    const r = await fetch(storeURL("snap"), {method:"DELETE"});
    if(!r.ok) return null;
    const j = await r.json();
    return (j && j.ok) ? (j.n | 0) : null;
  }catch(e){ return null; }
}
