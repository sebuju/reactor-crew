"use strict";
// node --expose-gc tools/partprobe.js <bench|gas|dam> <mode> [n] [warm] [--src=<particles.js or tree>] [--reps=3] [--k=sub:2,open:2] [--floor] [--vs=<particles.js or tree>]
//   time n warm   ms/step over steps warm..warm+n, min of --reps
//   alloc n warm  bytes/step through measure(); --floor the same around an empty loop
//   heap n warm   heapTop() of step()
//   hash n warm   state hash every 500 steps and at the end
//   stage n warm  us per call of grid, pairs, wallPass, water, wallSum on the state at step warm, positions restored between calls;
//                 --vs: water() (or viscosity() then relax()) of another particles.js from the same state, largest difference against the largest push
const vm = require("vm"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const B = require("./bundle.js");
const pos = process.argv.slice(2).filter(a => !a.startsWith("--"));
const flag = k => { const a = process.argv.find(s => s === "--" + k || s.startsWith("--" + k + "=")); return a === undefined ? null : a.includes("=") ? a.slice(a.indexOf("=") + 1) : ""; };
const [scen, mode] = pos, N = +(pos[2] || 0), WARM = +(pos[3] || 0), REPS = +(flag("reps") || 3), dt = 0.02;
const partSrc = p => { const f = !p ? path.join(B.ROOT, "tools", "particles.js") : fs.statSync(p).isDirectory() ? path.join(p, "tools", "particles.js") : p;
  return fs.readFileSync(f, "utf8"); };

if(flag("floor") !== null){ const [b, nc] = B.measure(() => { for(let k=0;k<N;k++){} }); console.log("floor " + N + " loops " + b + " B  " + (b/N).toFixed(1) + " B/step  (" + nc + " gc)"); process.exit(0); }

B.headless("0");
vm.runInThisContext(B.bundle().replace(/layoutMetrics\(\); layout\(\); requestAnimationFrame\(tick\);/, "layoutMetrics();"), {filename: "bundle.js"});
// the one measured loads as a plain script, as a browser runs it; --vs is wrapped so it loads beside it without redeclaring PART
const loadPart = p => vm.runInThisContext("(() => {" + partSrc(p) + "\nreturn PART; })()", {filename: "particles-vs.js"});
vm.runInThisContext(partSrc(flag("src")), {filename: "particles.js"});
const P = vm.runInThisContext("PART");
for(const kv of (flag("k") || "").split(",").filter(Boolean)){ const [k, v] = kv.split(":"); if(!(k in P.K)) throw new Error("no knob " + k); P.K[k] = +v; }
const GW = vm.runInThisContext("GW"), at = (x, y) => y*GW + x;

function build(Q, boxes, cells){
  const m = {}, put = (x, y) => { m[x + "," + y] = {m:"liner", t:600}; };
  for(const [x0, x1, y0, y1] of boxes){ for(let x=x0;x<=x1;x++){ put(x, y0); put(x, y1); } for(let y=y0;y<=y1;y++){ put(x0, y); put(x1, y); } }
  for(const [x, y] of cells || []) put(x, y);
  vm.runInThisContext("D").mat = m; Q.build();
}
const WALLS = {bench: [[[15, 44, 8, 25]]], gas: [[[15, 44, 8, 25], [44, 58, 12, 25]], [[44, 20], [44, 21], [44, 22]]], dam: [[[6, 37, 8, 25]]]};
if(!WALLS[scen]) throw new Error("scenario: bench, gas or dam");
let k = 0;
const drive = scen === "bench" ? () => {
  if(k === 0){ build(P, ...WALLS.bench); P.inject("fluid", 200000, at(54, 17)); }
  if(!P.L.inj) return; const left = 450000 - P.L.inKg; if(left < 1e-6) P.off(); else if(left < 200000*dt) P.inject("fluid", left/dt, at(54, 17));
} : scen === "gas" ? () => {
  if(k === 0){ build(P, ...WALLS.gas); for(let y=21;y<=24;y++) for(let x=16;x<=43;x++) P.lay(at(x, y), 1); P.inject("steam", 20, at(30, 20)); }
  if(k === 150) P.inject("h2", 2, at(25, 15));
  if(k === 300) P.inject("heat", 5000, at(35, 12));
  if(k === 400) P.blast(at(20, 12), 40);
  if(k === 450) P.inject("fluid", 50000, at(50, 14));
  if(k === 600) P.off();
} : () => {
  if(k === 0){ build(P, ...WALLS.dam); for(let y=22;y<=24;y++) for(let x=7;x<=15;x++) P.lay(at(x, y), 1); }
};
const one = () => { drive(); P.step(dt); k++; };
const restart = () => { k = 0; for(let w=0;w<WARM;w++) one(); };

function digest(){
  const h = crypto.createHash("sha1"), n = P.np;
  for(const a of [P.px, P.py, P.vx, P.vy, P.pm, P.pT, P.pv, P.pfo, P.pst, P.psx, P.psy]) h.update(Buffer.from(a.buffer, 0, n*8));
  for(const a of Object.values(P.rings)) h.update(Buffer.from(a.buffer));
  for(const a of [P.kind, P.burn]) h.update(Buffer.from(a.buffer, 0, n));
  h.update(Buffer.from(P.fill.buffer)); h.update(Buffer.from(P.pc.buffer)); h.update(Buffer.from(P.kP.buffer, 0, P.L.npk*8));
  const t = P.src.tot(); h.update(JSON.stringify(t));
  return h.digest("hex").slice(0, 16) + " np " + n + " npk " + P.L.npk + " split " + P.L.nsplit + " join " + P.L.njoin + " wat " + t.wat.toFixed(6);
}
const hr = () => Number(process.hrtime.bigint())/1e6;
const tag = scen + " " + (flag("k") || "defaults");

if(mode === "time"){ let best = Infinity;
  for(let r=0;r<REPS;r++){ restart(); const t0 = hr(); for(let s=0;s<N;s++) one(); best = Math.min(best, (hr() - t0)/N); }
  console.log(tag + " steps " + WARM + ".." + k + "  " + best.toFixed(3) + " ms/step (min of " + REPS + ")  np " + P.np); }
else if(mode === "alloc"){ restart(); const [b, nc] = B.measure(() => { for(let s=0;s<N;s++) one(); });
  console.log(tag + " steps " + WARM + ".." + k + "  " + b + " B  " + (b/N).toFixed(1) + " B/step  (" + nc + " gc)  np " + P.np); }
else if(mode === "heap"){ restart(); B.heapTop(one, N, 25); }
else if(mode === "hash"){ restart(); for(let s=0;s<N;s++){ one(); if(k % 500 === 0) console.log("step " + k + " " + digest()); } console.log("end  " + k + " " + digest()); }
else if(mode === "stage"){ restart();
  const S = P._stage, n = P.np, keep = ["px", "py", "vx", "vy"].map(a => P[a].slice(0, n));
  const back = () => ["px", "py", "vx", "vy"].forEach((a, i) => P[a].set(keep[i]));
  S.derive(); S.grid();
  if(flag("vs") !== null){ const Q = loadPart(flag("vs"));
    for(const kv of (flag("k") || "").split(",").filter(Boolean)){ const [a, v] = kv.split(":"); Q.K[a] = +v; }
    build(Q, ...WALLS[scen]); Q.step(dt);
    for(const a of ["px", "py", "vx", "vy", "pm", "pT", "pv", "kind"]) Q[a].set(P[a].subarray(0, n));
    Q.L.np = n;
    const cmp = (name, run, arr) => { back(); S.derive(); S.grid(); run(P._stage); const a = arr.map(f => P[f].slice(0, n)); back();
      for(const f of ["px", "py", "vx", "vy"]) Q[f].set(P[f].subarray(0, n)); Q._stage.derive(); Q._stage.grid(); run(Q._stage);
      let big = 0, d = 0; arr.forEach((f, i) => { for(let p=0;p<n;p++){ big = Math.max(big, Math.abs(a[i][p] - keep[["px", "py", "vx", "vy"].indexOf(f)][p])); d = Math.max(d, Math.abs(a[i][p] - Q[f][p])); } });
      console.log(name.padEnd(10) + "largest move " + big.toExponential(3) + "  largest difference " + d.toExponential(3) + "  ratio " + (d/big).toExponential(3)); };
    const own = (s, f) => { if(s.pairs){ s.pairs(); s.wallPass(); } f(s); };
    cmp("water", s => own(s, t => { if(t.water) t.water(); else { t.viscosity(); t.relax(); } }), ["px", "py", "vx", "vy"]);
    process.exit(0); }
  const reps = N || 2000;
  const time = (name, f) => { for(let r=0;r<200;r++){ back(); f(); } back(); let t = 0;
    for(let r=0;r<reps;r++){ back(); const t0 = hr(); f(); t += hr() - t0; }
    console.log(name.padEnd(10) + (t/reps*1000).toFixed(1) + " us"); };
  time("grid", () => S.grid());
  time("pairs", () => S.pairs());
  time("wallPass", () => S.wallPass());
  time("water", () => S.water());
  time("wallSum", () => { for(let p=0;p<n;p++) if(P.kind[p] === 1) S.wallSum(p, P.px[p]|0, P.py[p]|0); });
  console.log(tag + " step " + k + "  np " + n); }
else throw new Error("mode: time, alloc, heap, hash or stage");
