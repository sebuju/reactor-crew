"use strict";
/* CSV cannot carry a design, so one rides beside every dump as a JSON sidecar with the same stem */

const DUMP_SIG = 6;                 // significant figures kept per number
const DUMP_DIR = "snapshots/";

const dumpNum = v => Number.isFinite(v) ? String(Number(v.toPrecision(DUMP_SIG))) : String(v);

function dumpCell(v){
  if(v === null || v === undefined) return "";
  if(typeof v === "number") return dumpNum(v);
  if(typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* one leaf per row, `a.b[3].c` the path; typed arrays index like arrays, which JSON.stringify does not do */
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

/* the lineage cut at each branch point: a parent's keyframes past the fork belong to a timeline this run did not fly */
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

/* union of keys, first seen first: a node map gains and loses ids over a run */
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

/* packVal() because a lattice plan is a typed array */
const dumpHeadJSON = () => JSON.stringify(packVal(recHead()), null, 1);

/* `file://` cannot write a file, so without the server a dump falls back to a download */
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

/* hasFocus() first: Chrome never settles a clipboard write from an unfocused document, and the fallback is what `file://` takes */
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

/* the canvas only: a browser will not hand a script the HTML rails' pixels */
async function dumpImage(){
  const c = document.getElementById("cv");
  if(!c) return "NO CANVAS.";
  const name = dumpStem("view") + ".png";
  const ok = await dumpWrite(name, c.toDataURL("image/png").split(",")[1], true);
  return dumpDone([name], ok);
}

/* exact, unlike the CSV above: a plant put back from six figures is a different plant */

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

/* the order is not negotiable: head rebuilds D, commission() derives P, then the state lands */
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
  /* handed the state this thread just landed, so both start on the same plant rather than on the same seed */
  simRestart({snap:snapS(S), log:LOG.slice()});
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

/* no server means no list and no fetch, so both halves are handed over by hand */
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
