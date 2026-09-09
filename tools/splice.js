#!/usr/bin/env node
// node tools/splice.js [kind ...] | --list [--secs=N] [--seed=N] [--dice=on] [--dir=bare|fwd|rev] [--v]
const M = require('./bundle').headless(
 '{commission,step,seedRng,S:()=>S,P:()=>P,D:()=>D,LAY:()=>LAY,LOG:()=>LOG,MACHINE:()=>MACHINE,ROLE:()=>ROLE,'+
 'buildLayout,buildStockPlumbing,buildStockAutomation,mintMachine,mintTank,mintFitting,removePart,removeRun,'+
 'seedPort,seedRun,runErr,portCell,partOf,pipeMap,runBoreMm,netTempAt,pumpIds,pumpHead,ledgerKg,ledgerOut,netSolve,netReadEdges}');

const D = M.D();
const BASE = JSON.parse(JSON.stringify(D));
const FITMODE = {tee:1, throttle:1, relief:1};

/* Which two faces the part is spliced on, asked of ROLE and never of a table here: a declared path first, a turbine's vapour path next, an all-faces fold last, because a vessel whose faces are one node conducts across any two of them. */
function pathOf(role, part){
  const R = M.ROLE()[role]; if(!R) return null;
  const ins = R.internal ? (Array.isArray(R.internal) ? R.internal : [R.internal]) : [];
  if(ins.length) return {a:ins[0].a, b:ins[0].b, n:ins.length};
  if(R.vapPath) return {a:R.vapPath.a, b:R.vapPath.b, n:1};
  const fold = typeof R.fold === "function" ? R.fold(part) : R.fold;
  if(Array.isArray(fold) && fold.length >= 2){
    const lr = fold.indexOf("l") >= 0 && fold.indexOf("r") >= 0;
    return {a:lr ? "l" : fold[0], b:lr ? "r" : fold[1], n:1};
  }
  return null;
}
const roleOfKind = k => FITMODE[k] ? "fitting" : k === "tank" ? "tank" : (M.MACHINE()[k] || {}).role;
/* Why a row is red BY CONSTRUCTION, asked of what the ROLE declares and never of a list of kinds here: a red the drawing already answers is not a defect, and a sweep that calls it one buries the real list. */
function expected(kind, dir){
  const R = M.ROLE()[roleOfKind(kind)]; if(!R || dir === "bare") return null;
  const ins = R.internal ? (Array.isArray(R.internal) ? R.internal : [R.internal]) : [];
  if(dir === "rev" && ins.some(IN => IN.head)) return "the path carries head, so backwards is a different machine";
  if(kind === "relief") return "a relief valve is shut until it lifts";
  if(R.vapPath) return "a vapour path in a liquid leg: the swallow is sized for steam";
  return null;
}
function kinds(){
  const out = [];
  for(const k in M.MACHINE()){ const R = M.MACHINE()[k];
    if(R.rides || !pathOf(R.role, {id:k})) continue;
    out.push(k); }
  out.push("tank");
  for(const m in FITMODE) out.push(m);
  return out;
}

const SPID = k => (FITMODE[k] ? "fit" : k) + "9";
function mint(kind, id, x, y){
  if(kind === "tank") M.mintTank(id, x, y);
  else if(FITMODE[kind]){ M.mintFitting(id, x, y); D.fittings[id].mode = kind; }
  else M.mintMachine(id, kind, x, y);
  M.buildLayout();
}
// every cell the part and whatever rides it stand in, as offsets from the cell it was minted at
function bbox(id, x0, y0){
  const ours = M.LAY().parts.filter(p => p.id === id || (p.pin && p.pin.to === id));
  if(!ours.length) return null;
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for(const p of ours){ a = Math.min(a, p.x - x0); b = Math.min(b, p.y - y0);
                        c = Math.max(c, p.x + p.w - x0); d = Math.max(d, p.y + p.h - y0); }
  return {a, b, c, d};
}
// a free berth for that bbox, nearest the cut, with lanes each side of it for the two runs to land in
const MARGIN = 2;
function berth(box, near){
  let best = null, bd = 1e9;
  const parts = M.LAY().parts;
  const busy = (x, y) => { if(x < 0 || y < 0 || x >= D.gw || y >= D.gh) return true;
    if(D.pipes[x + "," + y]) return true;
    for(const p of parts) if(x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return true;
    return false; };
  for(let y = 0; y < D.gh; y++) for(let x = 0; x < D.gw; x++){
    const dist = Math.abs(x - near[0]) + Math.abs(y - near[1]);
    if(dist >= bd) continue;
    let ok = true;
    for(let i = box.a - MARGIN; i < box.c + MARGIN && ok; i++)
      for(let j = box.b - MARGIN; j < box.d + MARGIN && ok; j++) if(busy(x + i, y + j)) ok = false;
    if(ok){ best = [x, y]; bd = dist; }
  }
  return best;
}
/* A hull is a knob the player drags (gridDrag), so a board with nowhere to stand a reactor is a SMALL BOARD and not a refusal: the deck grows to the right, which is the one direction D.pipes' cell keys survive, until the part has a berth. */
function berthOrGrow(box, near, notes){
  const w0 = D.gw;
  for(let i = 0; i < 8; i++){
    const cell = berth(box, near);
    if(cell){ if(D.gw !== w0) notes.push("hull grown " + w0 + " to " + D.gw + " wide"); return cell; }
    D.gw += Math.max(4, box.c - box.a + 2*MARGIN);
    M.buildLayout();
  }
  D.gw = w0; M.buildLayout();
  return null;
}
// the first nozzle a face will take, walked along it, because a face states a whitelist and not a count
function facePort(id, face){
  const p = M.partOf(id); if(!p) return null;
  const n = (face === "t" || face === "b") ? p.w : p.h;
  for(let i = 0; i < n; i++){
    const dx = face === "l" ? -1 : face === "r" ? p.w : i;
    const dy = face === "t" ? -1 : face === "b" ? p.h : i;
    const pid = M.seedPort(id, dx, dy);
    if(pid != null) return pid;
  }
  return null;
}

/* The stock cold leg cut, with the part put in its place: `rev` installs it the wrong way round, which is a gesture the bench allows and so is a case this sweep owes. */
function build(kind, dir){
  const rev = dir === "rev", bare = dir === "bare";
  Object.assign(D, JSON.parse(JSON.stringify(BASE)));
  M.buildStockPlumbing({loops:1});
  const notes = [];
  if(kind !== "none"){
    let rid = null, pa = null, pb = null;
    for(const pid in D.ports){ const p = D.ports[pid]; if(p.p !== "pump0" || !p.run) continue;
      for(const qid in D.ports){ const q = D.ports[qid];
        if(q.p === "core" && q.run === p.run){ rid = p.run; pa = pid; pb = qid; } } }
    if(rid === null) return {err:"NO COLD LEG"};
    const A = D.ports[pa], B = D.ports[pb];
    const aP = A.p, aD = [A.dx, A.dy], bP = B.p, bD = [B.dx, B.dy];
    const cut = M.portCell(pa);
    M.removeRun(rid);

    const id = SPID(kind);
    mint(kind, id, 0, 0);
    const box = bbox(id, 0, 0);
    if(!box) return {err:"NO PART"};
    M.removePart(id);
    const cell = berthOrGrow(box, cut, notes);
    if(!cell) return {err:"NO ROOM"};
    mint(kind, id, cell[0], cell[1]);
    const p1 = M.seedPort(aP, aD[0], aD[1]), p2 = M.seedPort(bP, bD[0], bD[1]);
    /* the control: the part on the board and nothing plumbed to it, with the leg put back as it was, so a row already red here is the BOARD's and not the splice's */
    if(bare){
      const r = M.seedRun(p1, p2);
      if(r == null || M.runErr(r)) return {err:"RUN REFUSED " + (M.runErr(r) || "no run")};
    } else {
      const pth = pathOf(roleOfKind(kind), M.partOf(id));
      if(pth.n > 1) notes.push(pth.n + " paths, only the first plumbed");
      const tin = facePort(id, rev ? pth.b : pth.a), tout = facePort(id, rev ? pth.a : pth.b);
      if(tin == null || tout == null) return {err:"NO PORT"};
      const r1 = M.seedRun(p1, tin), r2 = M.seedRun(tout, p2);
      const e1 = r1 == null ? "no run" : M.runErr(r1), e2 = r2 == null ? "no run" : M.runErr(r2);
      if(e1 || e2) return {err:"RUN REFUSED " + (e1 || e2)};
    }
  }
  /* the cabinet is part of the plant: without one s.fregBy has no live driver, and a frozen feed valve reads as a plant that cannot hold its own generator level */
  M.buildLayout(); M.buildStockAutomation(); M.commission();
  return {notes};
}

/* What is being carried into the vessel, off node incidence alone. netReadEdges()'s own figure stands a HOT label down, and a part spliced into the cold leg renames the leg that lands on the core - a label a circulation figure may not read. */
function coreKgs(sol){
  const net = sol.net, q = sol.q, tankN = new Set();
  for(const id in (net.tankNode || {})) tankN.add(net.tankNode[id]);
  let kg = 0;
  for(let e = 0; e < net.edges.length; e++){ const ed = net.edges[e];
    if(tankN.has(ed.u) || tankN.has(ed.v)) continue;
    const inU = net.coreSet.has(ed.u), inV = net.coreSet.has(ed.v);
    if(inU === inV) continue;
    const qin = inV ? q[e] : -q[e];
    if(qin > 0) kg += qin;
  }
  return kg;
}

function fly(kind, dir, opt){
  const b = build(kind, dir);
  if(b.err) return {err:b.err};
  const s = M.S();
  M.seedRng(s, opt.seed); s.diceOff = !opt.dice;
  let breach = false;
  /* every kilogram it holds plus every one it has named leaving, against the same sum one tick in: a case whose books do not close has not been measured, whatever its flow reads */
  M.step(0.02);
  const M0 = M.ledgerKg(s) + M.ledgerOut(s);
  for(let i = 1; i < opt.secs * 50; i++){ M.step(0.02); if(s.breach){ breach = true; break; } }
  const res = M.ledgerKg(s) + M.ledgerOut(s) - M0;
  const br = {};
  const sol = M.netSolve(M.P().net, s);
  M.netReadEdges(sol, null, br, null, {});
  const flow = coreKgs(sol);
  let burst = 0;
  for(const k in br) if(/^break:/.test(k) && Math.abs(br[k]) > 1) burst += Math.abs(br[k]);
  if(opt.v) dump(s, sol, br, kind, dir);
  return {flow, P:s.P, Tavg:s.Tavg, burst, breach, res, notes:b.notes};
}
// what the solver itself says about the spliced part, so a red row is attributed and not guessed at
function dump(s, sol, br, kind, dir){
  const id = SPID(kind), net = sol.net;
  console.log("## " + kind + " " + dir + "  inv " + f(s.inv, 1) + "%  breach " + !!s.breach);
  for(const e of M.LOG()) if(e.sev === "alarm") console.log("   t" + f(e.t, 1) + " " + e.msg + " -- " + e.why);
  for(const k in br) if(Math.abs(br[k]) > 1) console.log("   run " + k + "  " + f(br[k], 1) + " kg/s");
  for(let i = 0; i < net.n; i++) if(String(net.name[i]).indexOf(id) === 0)
    console.log("   node " + net.name[i] + "  p " + f(sol.b[i], 3) + "  T " + f(M.netTempAt(s, net.name[i]), 1) +
                "  x " + f(net.F.x[i], 3) + "  wet " + net.F.wet[i] + "  m " + f(s.mBy[net.name[i]], 1));
  for(let e = 0; e < net.edges.length; e++){ const ed = net.edges[e];
    if(String(net.name[ed.u]).indexOf(id) !== 0 && String(net.name[ed.v]).indexOf(id) !== 0) continue;
    console.log("   edge " + ed.kind + " " + (ed.key || "-") + "  " + net.name[ed.u] + " -> " + net.name[ed.v] +
                "  C " + f(ed.C ? ed.C(s) : ed.Cv, 4) + "  q " + f(sol.q[e], 1)); }
  const hi = [];
  for(let i = 0; i < net.n; i++) hi.push([sol.b[i], net.name[i]]);
  hi.sort((a, b) => b[0] - a[0]);
  console.log("   top p  " + hi.slice(0, 5).map(h => h[1] + " " + f(h[0], 2)).join("  "));
  console.log("   pumps  " + M.pumpIds().map(id => id + " " + f(M.pumpHead(id), 2) + " MPa x" + f((s.flowBy && s.flowBy[id]) || 0, 2)).join("  "));
  const PM = M.pipeMap();
  for(const key in PM.byKey){ const r = PM.byKey[key];
    console.log("   run " + key + "  kind " + r.k + "  bore " + f(M.runBoreMm(r), 1) + " mm  L " + f(r.L, 1) + " m"); }
}

/* What "the loop survives" means, and the whole point of the sweep: the core is still being circulated, at a pressure and a temperature the reference plant would recognise, with nothing let go. */
const FLOW_MIN = 0.5, P_TOL = 0.25, T_TOL = 25, LEDGER_TOL = 1;
function verdict(r, base, why0){
  if(r.err) return [r.err === "NO ROOM" ? "SKIP" : "FAIL", r.err];
  const why = [];
  if(r.breach) why.push("breach");
  if(r.burst > 1) why.push("burst " + r.burst.toFixed(0) + " kg/s");
  if(!(r.flow >= FLOW_MIN * base.flow)) why.push("flow " + (100 * r.flow / base.flow).toFixed(0) + "% of stock");
  if(Math.abs(r.P - base.P) > P_TOL * base.P) why.push("P " + r.P.toFixed(2) + " vs " + base.P.toFixed(2));
  if(Math.abs(r.Tavg - base.Tavg) > T_TOL) why.push("Tavg " + r.Tavg.toFixed(0) + " vs " + base.Tavg.toFixed(0));
  if(Math.abs(r.res) > LEDGER_TOL) why.push("books " + r.res.toFixed(0) + " kg out");
  if(!why.length) return ["PASS", ""];
  return [why0 ? "EXPECT" : "FAIL", why0 ? why0 + " (" + why.join(", ") + ")" : why.join(", ")];
}

const args = process.argv.slice(2);
const str = (f, d) => { const a = args.find(x => x.indexOf(f) === 0); return a ? a.split("=")[1] : d; };
const num = (f, d) => { const v = str(f, null); return v === null ? d : +v; };
if(args.indexOf("--list") >= 0){ console.log(kinds().join("\n")); process.exit(0); }
const opt = {secs:num("--secs=", 5), seed:num("--seed=", 1), dice:str("--dice=", "off") !== "off",
             v:args.indexOf("--v") >= 0};
const dir = str("--dir=", "all");
const dirs = dir === "all" ? ["bare", "fwd", "rev"] : [dir];
const pick = args.filter(a => a[0] !== "-");
const list = pick.length ? pick : kinds();

const f = (v, d) => (v === null || v === undefined || Number.isNaN(v)) ? "-" : (+v).toFixed(d);
const W = [10, 5, 8, 8, 8, 8, 9, 8];
const row = (...c) => console.log(c.map((x, i) => String(x).padEnd(W[i] || 0)).join(""));
const base = fly("none", "fwd", opt);
console.log("# splice: seed " + opt.seed + ", dice " + (opt.dice ? "on" : "off") + ", " + opt.secs + " s");
row("kind", "dir", "kg/s", "MPa", "K", "burst", "books", "", "");
row("none", "-", f(base.flow, 0), f(base.P, 2), f(base.Tavg, 1), f(base.burst, 0), f(base.res, 1), "PASS", "");
for(const k of list){
  if(!roleOfKind(k)){ row(k, "-", "-", "-", "-", "-", "-", "FAIL", "no such kind"); continue; }
  let bareRed = false;
  for(const d of dirs){
    const r = fly(k, d, opt);
    const [v, why] = verdict(r, base, expected(k, d));
    if(d === "bare") bareRed = v === "FAIL";
    row(k, d, f(r.flow, 0), f(r.P, 2), f(r.Tavg, 1), f(r.burst, 0), f(r.res, 1), v,
        [why, bareRed && d !== "bare" ? "already red BARE" : "", ...(r.notes || [])].filter(Boolean).join("; "));
  }
}
