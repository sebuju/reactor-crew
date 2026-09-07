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

/* ══ THE PATH GOES TO THE CLIPBOARD ══
   The whole point of a dump is to open it somewhere else, so the answer to
   "where is it" should be pasteable, not retyped off a menu. The async
   clipboard needs a secure context and `file://` is not one, so the old
   selection-and-copy is the fallback rather than a legacy leftover - it is the
   path the download case actually takes.

   hasFocus() FIRST, and it is not politeness: Chrome does not reject a
   clipboard write from an unfocused document, it never settles the promise at
   all, so awaiting one leaves the menu saying WORKING for the rest of the
   session. Measured - it hung a tab for 45 s. */
async function dumpCopy(text){
  try{
    if(document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(e){ /* denied or not focused: try the old way below */ }
  try{
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }catch(e){ return false; }
}

/* One report line for a whole dump, and the one place the first file's path
   reaches the clipboard - a dump that says where it went and a dump that hands
   you the path are the same event. */
async function dumpDone(files, served){
  await dumpCopy((served ? DUMP_DIR : "") + files[0]);
  return files.join(" + ") + (served ? " to " + DUMP_DIR
    : " DOWNLOADED - no server, so not in " + DUMP_DIR + ". Run  node tools/server.js");
}

async function dumpState(){
  if(typeof S === "undefined" || !S) return "NO PLANT: commission one first.";
  const stem = dumpStem("state");
  const a = await dumpWrite(stem + ".csv", dumpStateCSV(S));
  const b = await dumpWrite(stem + ".design.json", dumpHeadJSON());
  return dumpDone([stem + ".csv", stem + ".design.json"], a && b);
}

async function dumpTimeline(){
  if(typeof S === "undefined" || !S) return "NO PLANT: commission one first.";
  const frames = dumpFrames();
  if(!frames.length) return "NO KEYFRAMES YET: run the plant for a few seconds.";
  const stem = dumpStem("timeline");
  const a = await dumpWrite(stem + ".csv", dumpTimelineCSV(frames));
  const b = await dumpWrite(stem + ".design.json", dumpHeadJSON());
  return frames.length + " frames, ticks " + frames[0].tick + "-" + frames[frames.length - 1].tick +
    ": " + await dumpDone([stem + ".csv", stem + ".design.json"], a && b);
}

/* The canvas only - the topbar, the rails and the bench panels are HTML and a
   browser will not hand their pixels to a script. It is the drawing that is
   worth a picture. */
async function dumpImage(){
  const c = document.getElementById("cv");
  if(!c) return "NO CANVAS.";
  const name = dumpStem("view") + ".png";
  const ok = await dumpWrite(name, c.toDataURL("image/png").split(",")[1], true);
  return dumpDone([name], ok);
}

/* ═══════════════ THE ONE DUMP THAT COMES BACK ═══════════════

   The CSV above is for reading and this is for returning to, and they are not
   the same file: six significant figures is what a chart wants and a plant put
   back from six figures is a DIFFERENT plant, quietly, from the first tick.
   So a snapshot is store.js's tagged JSON - typed arrays and Infinity survive
   it - and it is exact.

   The design still rides in the sidecar, exactly like the CSV dumps, so a
   snapshot pair looks like every other pair in the directory. */

const dumpSnapJSON = () => JSON.stringify(packVal({tick:S.tick, S:snapS(S), log:LOG}));

async function dumpSnapSave(){
  if(typeof S === "undefined" || !S) return "NO PLANT: commission one first.";
  const stem = dumpStem("snap");
  const a = await dumpWrite(stem + ".json", dumpSnapJSON());
  const b = await dumpWrite(stem + ".design.json", dumpHeadJSON());
  return dumpDone([stem + ".json", stem + ".design.json"], a && b);
}

const dumpSnapNames = async () => {
  const all = await snapList();
  return all === null ? null : all.filter(n => /_snap\.json$/.test(n));
};

/* ══ PUTTING A SAVED PLANT BACK ON THE BOARD ══
   The order is the one a prewarm follows and it is not negotiable: the design
   goes on first (recApplyHead() rebuilds D and the board), then commissioning
   derives P from it, and only then does the state land - restoreS() into a P
   built from another design is a plant whose network does not match its own
   state. commission() drains the generator in one go, so the page blocks for
   the second or so the prewarm bar normally covers.

   A new ROOT after it, because what is on the board is not the continuation of
   whatever was being recorded: it is a plant that appeared. The rings go with
   it for the same reason - a strip chart carrying the last plant's history
   under this one's trace is a lie about what just happened. */
function dumpApply(snap, head){
  const matched = recApplyHead(head);
  commission();
  trBench(); trRateFit();                  // the benchmark is part of commissioning
  restoreS(snap.S);
  LOG = Array.isArray(snap.log) ? snap.log.slice() : [];
  recRoot();
  initHist();
  TR.paused = true;                        // a loaded plant waits to be looked at
  screen = "operate"; layout(); uiDirty();
  return matched;
}

async function dumpSnapLoad(name){
  const stem = name.replace(/\.json$/, "");
  const a = await snapGet(name), b = await snapGet(stem + ".design.json");
  if(!a || !b) return "CANNOT READ " + name + (b ? "" : " or its .design.json sidecar") + ".";
  let snap, head;
  try{ snap = unpackVal(JSON.parse(a)); head = unpackVal(JSON.parse(b)); }
  catch(e){ return "BAD SNAPSHOT: " + e.message; }
  const matched = dumpApply(snap, head);
  return "LOADED " + name + " at tick " + S.tick +
    (matched ? "" : " - WARNING: the design signature did not match, so the head is missing " +
                    "something designSig() counts. The plant on the board is the one in the file.");
}

/* No server means no list and no fetch, so the file is handed over instead.
   Both halves at once: the state and its sidecar are one dump in two files. */
function dumpSnapPick(){
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json"; inp.multiple = true;
    inp.onchange = async () => {
      const picked = [...inp.files];
      const hf = picked.find(f => /\.design\.json$/.test(f.name)), sf = picked.find(f => f !== hf);
      if(!hf || !sf) return resolve("PICK BOTH FILES: the _snap.json and its _snap.design.json.");
      try{
        const snap = unpackVal(JSON.parse(await sf.text()));
        const head = unpackVal(JSON.parse(await hf.text()));
        const matched = dumpApply(snap, head);
        resolve("LOADED " + sf.name + " at tick " + S.tick + (matched ? "" : " - DESIGN SIGNATURE MISMATCH"));
      }catch(e){ resolve("BAD SNAPSHOT: " + e.message); }
    };
    inp.click();
  });
}

async function dumpPurge(){
  const n = await snapPurge();
  if(n === null) return "NO SERVER: nothing to purge from here. " + DUMP_DIR + " is on disk only.";
  return n ? "PURGED " + n + " file" + (n === 1 ? "" : "s") + " from " + DUMP_DIR
           : DUMP_DIR + " was already empty.";
}
