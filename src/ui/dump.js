"use strict";
/* the debug dumps behind the brand menu */

/* ═══════════════ WHAT A DUMP IS FOR ═══════════════

   Not a save. A save is a named thing the player reopens in the game; a dump is
   a timestamped file a developer opens in a spreadsheet once and deletes. So
   the format is CSV rather than the tagged JSON store.js packs recordings into,
   the numbers are rounded to what a reader can actually use, and `snapshots/`
   is gitignored scratch that PURGE empties.

   CSV cannot carry a design - it is a tree, not a table - so the design rides
   beside every dump as a JSON SIDECAR with the same stem. The pair is the
   dump: the CSV says what the plant was doing, the sidecar says what plant. */

const DUMP_SIG = 6;                 // significant figures kept per number
const DUMP_DIR = "snapshots/";

/* A double is 17 digits of which about six mean anything here, and the other
   eleven are most of the file. */
const dumpNum = v => Number.isFinite(v) ? String(Number(v.toPrecision(DUMP_SIG))) : String(v);

function dumpCell(v){
  if(v === null || v === undefined) return "";
  if(typeof v === "number") return dumpNum(v);
  if(typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* One leaf per row, `a.b[3].c` the path. Typed arrays index like arrays, which
   is the whole reason this is not JSON.stringify. */
function dumpFlat(v, key, out){
  if(v === null || typeof v !== "object"){ out.push([key, v]); return out; }
  if(Array.isArray(v) || ArrayBuffer.isView(v)){
    for(let i = 0; i < v.length; i++) dumpFlat(v[i], key + "[" + i + "]", out);
    return out;
  }
  for(const k in v) dumpFlat(v[k], key ? key + "." + k : k, out);
  return out;
}

const dumpStateCSV = s =>
  "key,value\n" + dumpFlat(s, "", []).map(r => dumpCell(r[0]) + "," + dumpCell(r[1])).join("\n") + "\n";

/* ══ EVERY KEYFRAME THE RECORDER STILL HOLDS ══
   The lineage of the current take, cut at each branch point: a parent keeps
   keyframes past the tick its child forked at, and those belong to a timeline
   this run did not fly. Keyframes are a cache and get thinned (recEvict()), so
   the spacing in the file is whatever survived, which is why the tick is a
   column and not an assumption. */
function dumpFrames(){
  if(typeof REC === "undefined" || !REC.takes.length) return [];
  const line = lineage(REC.cur), out = [];
  line.forEach((t, i) => {
    const end = line[i + 1] ? line[i + 1].tick0 : Infinity;
    for(const k of [{tick:t.tick0, S:t.base}, ...t.keys])
      if(k.tick < end) out.push(k);
  });
  return out.sort((a, b) => a.tick - b.tick);
}

/* Union of keys, first seen first, because a node map (`s.flowBy`) gains and
   loses ids over a run and a column that only exists later is still a column. */
function dumpTimelineCSV(frames){
  const cols = [], seen = new Set(), rows = [];
  for(const f of frames){
    const m = new Map();
    for(const [k, v] of dumpFlat(f.S, "", [])){
      if(!seen.has(k)){ seen.add(k); cols.push(k); }
      m.set(k, v);
    }
    rows.push(m);
  }
  const head = ["tick", ...cols].map(dumpCell).join(",");
  const body = rows.map((m, i) =>
    [frames[i].tick, ...cols.map(c => m.has(c) ? m.get(c) : null)].map(dumpCell).join(","));
  return head + "\n" + body.join("\n") + "\n";
}

/* The recorder's head is already the answer to "which plant is this": D whole,
   where every part stands, and the signature that says whether it still matches
   the bench. packVal() because a lattice plan is a typed array. */
const dumpHeadJSON = () => JSON.stringify(packVal(recHead()), null, 1);

/* ══ THE SERVER WRITES IT, OR THE BROWSER DOES ══
   `file://` cannot write a file, so without the server a dump falls back to a
   download and lands in the browser's download directory instead of
   `snapshots/`. Said out loud in the answer, because a file that quietly went
   somewhere else is worse than one that did not go. */
function dumpDownload(name, body, b64){
  const blob = b64
    ? new Blob([Uint8Array.from(atob(body), c => c.charCodeAt(0))], {type:"image/png"})
    : new Blob([body], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function dumpWrite(name, body, b64){
  if(await snapPut(name, body, b64)) return true;
  dumpDownload(name, body, b64);
  return false;
}

const dumpStem = kind => "rc_" + stampFile(new Date()) + "_" + kind;

/* One report line for a whole dump, so the menu never has to assemble one. */
const dumpSaid = (files, served) =>
  files.join(" + ") + (served ? " to " + DUMP_DIR
    : " DOWNLOADED - no server, so not in " + DUMP_DIR + ". Run  node tools/server.js");

async function dumpState(){
  if(typeof S === "undefined" || !S) return "NO PLANT: commission one first.";
  const stem = dumpStem("state");
  const a = await dumpWrite(stem + ".csv", dumpStateCSV(S));
  const b = await dumpWrite(stem + ".design.json", dumpHeadJSON());
  return dumpSaid([stem + ".csv", stem + ".design.json"], a && b);
}

async function dumpTimeline(){
  if(typeof S === "undefined" || !S) return "NO PLANT: commission one first.";
  const frames = dumpFrames();
  if(!frames.length) return "NO KEYFRAMES YET: run the plant for a few seconds.";
  const stem = dumpStem("timeline");
  const a = await dumpWrite(stem + ".csv", dumpTimelineCSV(frames));
  const b = await dumpWrite(stem + ".design.json", dumpHeadJSON());
  return frames.length + " frames, ticks " + frames[0].tick + "-" + frames[frames.length - 1].tick +
    ": " + dumpSaid([stem + ".csv", stem + ".design.json"], a && b);
}

/* The canvas only - the topbar, the rails and the bench panels are HTML and a
   browser will not hand their pixels to a script. It is the drawing that is
   worth a picture. */
async function dumpImage(){
  const c = document.getElementById("cv");
  if(!c) return "NO CANVAS.";
  const name = dumpStem("view") + ".png";
  const ok = await dumpWrite(name, c.toDataURL("image/png").split(",")[1], true);
  return dumpSaid([name], ok);
}

async function dumpPurge(){
  const n = await snapPurge();
  if(n === null) return "NO SERVER: nothing to purge from here. " + DUMP_DIR + " is on disk only.";
  return n ? "PURGED " + n + " file" + (n === 1 ? "" : "s") + " from " + DUMP_DIR
           : DUMP_DIR + " was already empty.";
}
