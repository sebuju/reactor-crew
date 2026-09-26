"use strict";
const path = require("path"), fs = require("fs"), crypto = require("crypto"), cp = require("child_process");
const B = require(path.join(__dirname, "..", "..", "tools", "bundle.js"));
const {stamp} = require(path.join(__dirname, "..", "..", "tools", "stamp.js"));
const {snapTake} = require(path.join(__dirname, "..", "..", "tools", "snap.js"));
const ROOT = path.join(__dirname, "..", ".."), RESULTS = path.join(__dirname, "results");
const HARNESS = ["run.js", "lib.js", "last.js", "batch.js"];

/* every file a check's answer can depend on: the page's sources, the boot, the sandbox profiles, this harness and the script */
function inputFiles(script){
  const out = ["index.html", "tools/bundle.js", "tools/snap.js", "tools/stamp.js", "tests/physics/lib.js", "tests/physics/" + script + ".js"];
  const walk = d => { for(const e of fs.readdirSync(path.join(ROOT, d), {withFileTypes:true})){
    if(e.isDirectory()) walk(d + "/" + e.name); else out.push(d + "/" + e.name); } };
  walk("src"); walk("tests/physics/plant");
  for(const f of fs.readdirSync(path.join(ROOT, "tools", "sandbox"))) if(f.endsWith(".js")) out.push("tools/sandbox/" + f);
  return out.sort();
}
/* git's own blob id, so a reader can hold a run's tree against any commit's */
function inputHashes(script){
  const h = {};
  for(const f of inputFiles(script)){ const p = path.join(ROOT, f); if(!fs.existsSync(p)) continue;
    const b = Buffer.from(fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"), "utf8");
    h[f] = crypto.createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex"); }
  return h;
}
function gitHead(){
  try { const g = path.join(ROOT, ".git"), h = fs.readFileSync(path.join(g, "HEAD"), "utf8").trim();
    if(!h.startsWith("ref: ")) return h;
    const ref = h.slice(5), f = path.join(g, ref);
    if(fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
    const m = new RegExp("^([0-9a-f]{40}) " + ref + "$", "m").exec(fs.readFileSync(path.join(g, "packed-refs"), "utf8"));
    return m ? m[1] : ""; } catch(e){ return ""; }
}
const treeId = inputs => crypto.createHash("sha1").update(JSON.stringify(Object.keys(inputs).sort().map(f => [f, inputs[f]]))).digest("hex").slice(0, 8);
const resultKey = (script, args) => script + (args.length ? "." + args.join(",").replace(/[^\w.,=+-]/g, "_") : "");
/* every tree a chunk has a result for, newest first */
function resultFiles(key){
  if(!fs.existsSync(RESULTS)) return [];
  return fs.readdirSync(RESULTS).filter(f => f.startsWith(key + ".") && /^[0-9a-f]{8}\.jsonl$/.test(f.slice(key.length + 1)))
    .map(f => ({file:path.join(RESULTS, f), id:f.slice(key.length + 1, -6), mtime:fs.statSync(path.join(RESULTS, f)).mtimeMs}))
    .sort((a, b) => b.mtime - a.mtime);
}
const KEEP_TREES = 10;
/* the `// chunks:` line: one arg list per process run.js spawns */
function chunksOf(file){
  const m = /^\/\/ chunks: (.*)$/m.exec(fs.readFileSync(path.join(__dirname, file), "utf8"));
  return m ? m[1].split(" ").map(a => a.split(",")) : [[]];
}
/* the `// preset:` line: the preset each chunk commissions first, null for none; `n` every chunk, `arg` the first integer of its first argument, or one token per chunk with `-` for none */
function presetsOf(file){
  const chunks = chunksOf(file), m = /^\/\/ preset: (.*)$/m.exec(fs.readFileSync(path.join(__dirname, file), "utf8"));
  if(!m) return chunks.map(() => null);
  const t = m[1].trim().split(/\s+/), num = x => x === "-" ? null : +x;
  if(t.length === 1 && t[0] === "arg") return chunks.map(a => { const n = /\d+/.exec(a[0] || ""); return n ? +n[0] : null; });
  if(t.length === 1) return chunks.map(() => num(t[0]));
  if(t.length !== chunks.length) throw new Error(file + ": // preset: names " + t.length + " chunks, // chunks: " + chunks.length);
  return t.map(num);
}
/* the `// order:` line, `a < b < c`: a chunk (its args comma-joined) run.js starts only after the one before it has ended; key -> the key it waits on */
function orderOf(file){
  const m = /^\/\/ order: (.*)$/m.exec(fs.readFileSync(path.join(__dirname, file), "utf8")), after = {};
  if(!m) return after;
  const t = m[1].split("<").map(s => s.trim());
  for(let i=1;i<t.length;i++) after[t[i]] = t[i-1];
  return after;
}
/* a march longer than one process runs as legs, each its own chunk: a leg hands its state on in results/legs/, keyed on the script's tree */
const LEGS = path.join(RESULTS, "legs");
const legFile = (tag, id) => path.join(LEGS, MAIN + "." + tag + "." + id + ".bin");
function legSave(tag, o){
  const id = treeId(recInputs);
  fs.mkdirSync(LEGS, {recursive:true});
  for(const f of fs.readdirSync(LEGS)) if(f.startsWith(MAIN + "." + tag + ".") && f !== path.basename(legFile(tag, id))) try { fs.unlinkSync(path.join(LEGS, f)); } catch(e){}
  const tmp = legFile(tag, id) + "." + process.pid;
  fs.writeFileSync(tmp, require("v8").serialize(o)); fs.renameSync(tmp, legFile(tag, id));
}
function legLoad(tag){ try { return require("v8").deserialize(fs.readFileSync(legFile(tag, treeId(recInputs)))); } catch(e){ return null; } }

/* results/<script>.<args>.<tree>.jsonl, one per tree so a session on its own edits never overwrites another's clean-tree result */
const mainFile = require.main ? require.main.filename : globalThis.__MAIN;
const MAIN = mainFile && path.dirname(mainFile) === __dirname && !HARNESS.includes(path.basename(mainFile)) ? path.basename(mainFile, ".js") : null;
/* --plan=<plan file> --why="<question>" come off argv before any script reads it; run.js hands them down in env */
const ASK = {plan:process.env.PHYSICS_PLAN || "", why:process.env.PHYSICS_WHY || ""};
for(let i=process.argv.length-1;i>=2;i--){ const m = /^--(plan|why)=([\s\S]*)$/.exec(process.argv[i]); if(m){ ASK[m[1]] = m[2]; process.argv.splice(i, 1); } }
const NOWHY = 'a run answers a named question: add --why="<the question>", and --plan=<plan file> when a plan asked';
if(MAIN && !ASK.why){ console.error(path.basename(require.main.filename) + ": " + NOWHY); process.exit(2); }
const T0 = +process.env.PHYSICS_T0 || Date.now(), recChecks = [], recArgs = process.argv.slice(2);
let recFd = -1, recErr = "", recKey = "", recInputs = null, recBatch = null;
function rec(o){
  if(recFd < 0){
    fs.mkdirSync(RESULTS, {recursive:true});
    recFd = fs.openSync(path.join(RESULTS, recKey + "." + treeId(recInputs) + ".jsonl"), "w");
    fs.writeSync(recFd, JSON.stringify({script:MAIN, args:recArgs, at:stamp(new Date(T0)), plan:ASK.plan, why:ASK.why, commit:gitHead(), inputs:recInputs, batch:recBatch.id}) + "\n");
    for(const r of resultFiles(recKey).slice(KEEP_TREES)) try { fs.unlinkSync(r.file); } catch(e){}
  }
  fs.writeSync(recFd, JSON.stringify(o) + "\n");
}

const fmt = v => typeof v !== "number" ? String(v) : (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) ? v.toExponential(3) : +v.toPrecision(5) + "";
const stOf = c => c.pass ? "PASS" : c.gap ? "GAP " : "FAIL";
const tolOf = c => c.tol === "" ? "" : c.abs ? "±" + fmt(c.tol) + " " + c.unit : "±" + fmt(c.tol*100) + " %";
function checkLine(c){
  return stOf(c) + " | " + c.name + " | " + fmt(c.measured) + " " + (c.unit || "") + " | " + fmt(c.truth) + " | " + tolOf(c) + " | " + c.source + (c.gap ? " | fidelity: " + c.gap : "") + (c.note ? " | " + c.note : "");
}

const list = (a, n) => a.slice(0, n).join(", ") + (a.length > n ? " and " + (a.length - n) + " more" : "");
const trees = {};
/* the commit a run's inputs sit on, and every input that is not the commit's */
function treeNote(inputs, commit){
  const t = !commit ? {} : (trees[commit] ??= (() => { const o = {};
    const r = cp.spawnSync("git", ["ls-tree", "-r", commit], {cwd:ROOT, encoding:"utf8", maxBuffer:64*1024*1024});
    for(const l of (r.stdout || "").split("\n")){ const m = /^\S+ blob (\S+)\t(.*)$/.exec(l); if(m) o[m[2]] = m[1]; }
    return o; })());
  const edits = Object.keys(inputs).filter(f => t[f] !== inputs[f]).sort();
  return (commit ? commit.slice(0, 7) : "no commit") + (edits.length ? " + edits to " + list(edits, 4) : "");
}

let M = null, BASE = null, EV = null;
function load(src){
  if(!M){ const snap = !src && globalThis.__EV, ev = EV = snap || B.headless("(n => eval(n))", src ? {src} : undefined);
    M = new Proxy({}, {get:(t,k) => typeof k === "string" ? ev(k) : undefined});
    BASE = snap ? globalThis.__BASE : JSON.stringify(M.D); }
  return M;
}

/* rel: tol is a fraction of |truth|; abs: tol is in the value's own unit; gap: the fidelity row that states a known distance */
function check(name, measured, truth, tol, source, opt){
  const o = opt || {};
  const err = o.abs ? Math.abs(measured - truth) : Math.abs(measured - truth)/Math.max(Math.abs(truth), 1e-300);
  const pass = o.pass !== undefined ? !!o.pass : (isFinite(measured) && err <= tol);
  const c = {name, measured, truth, tol, abs:!!o.abs, unit:o.unit || "", source, pass, gap:o.gap || "", note:o.note || ""};
  process.stdout.write("@@CHECK " + JSON.stringify(c) + "\n");
  if(MAIN){ rec(c); recChecks.push(c); }
  return pass;
}

function commissionPreset(i){
  const G = load();
  if(globalThis.__SNAP && snapTake(EV, i)) return G;
  G.plantPreset(i); G.buildLayout(); G.commission();
  return G;
}

/* a blank board and the sandbox's rig gestures: infinite tanks as boundaries, stock runs, the reactor stood down */
function rig(build){
  const G = load(), D = G.D;
  for(const k in D) delete D[k];
  Object.assign(D, JSON.parse(BASE));
  const R = {
    tank(id, x, y, p, cfg){
      G.mintTank(id, x, y);
      Object.assign(G.D.tanks[id], {name:id.toUpperCase(), col:"#8fd18a", vol:100, level:50,
        inf:true, check:false, auto:"always", burst:null, hold:null, gas:{p0:p, frac:0.35}}, cfg || {});
      G.buildLayout(); return id; },
    port(id, dx, dy){ return G.seedPort(id, dx, dy); },
    run(a, b, vias){ return G.seedRun(a, b, vias); },
    joinV(a, b){ return R.run(R.port(a, 0, G.partOf(a).h), R.port(b, 0, -1)); },
    joinH(a, b){ return R.run(R.port(a, G.partOf(a).w, 0), R.port(b, -1, 0)); },
    fit(x, y, mode){ const id = G.addFitting(x, y); G.D.fittings[id].mode = mode || "tee"; G.buildLayout(); return id; },
    machine(kind, x, y){ const id = G.addMachine(kind, x, y); G.buildLayout(); return id; },
    wall(mm){ G.buildLayout(); G.D.wall = G.D.wall || {};
      const m = G.pipeMap().byKey; for(const k in m) G.D.wall[G.runIdOf(m[k])] = mm; },
    bore(mm){ G.buildLayout(); G.D.bore = G.D.bore || {};
      const m = G.pipeMap().byKey; for(const k in m) G.D.bore[G.runIdOf(m[k])] = mm; },
  };
  const note = build(R, G) || {};
  G.buildLayout(); G.commission();
  G.ST.sc[G.SC_DICEOFF] = 1;
  return note;
}

/* core c's through-flow off the solved edges: kg/s in, mean inlet and outlet h kJ/kg, mean pressure MPa of the nodes it leaves into */
function coreInflow(G, c){
  const PT = G.PT, ST = G.ST;
  let w = 0, e = 0, pIn = 0, out = 0, hOut = 0, pOut = 0;
  for(let j=PT.coreLoop0[c];j<PT.coreLoop0[c+1];j++){ const i = PT.coreLoopNode[j];
    for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed]; if(!w0 || PT.edHole[ed]) continue;
      const wi = PT.edV[ed] === i ? w0 : -w0;
      if(wi > 0){ w += wi; e += wi*ST.hBy[PT.adjOther[k]]; pIn += wi*G.eNodeP(PT.adjOther[k]); }
      else { out -= wi; hOut -= wi*ST.hBy[i]; pOut -= wi*G.eNodeP(PT.adjOther[k]); } } }
  return {w, hIn:e/w, pIn:pIn/w, hOut:hOut/out, pOut:pOut/out}; }

/* part a's worst cell excess, what eBlastStep judges */
function blastExcess(G, a){
  const PT = G.PT, GW = G.GW, box = PT.partBox, x = box[a*4], y = box[a*4+1], w = box[a*4+2], h = box[a*4+3];
  let e = 0;
  if(PT.partKind[a] === 0){
    for(let X=Math.max(0,x);X<Math.min(GW,x+w);X++) for(let Y=Math.max(0,y);Y<Math.min(G.GH,y+h);Y++){
      const v = G.eBang(Y*GW + X); if(v > e) e = v; } }
  else { const i = PT.partCell[a]; if(i >= 0) e = G.eBang(i); }
  return e;
}

/* water laid at rest: frac(x, y) of each cell at T K and p MPa (1 atm unless given) on IF97, the gas it displaces taken out, the head under each column; returns a full cell's kg */
function layWater(G, cells, frac, T, p){
  const P = p || 0.1013, s = G.ST, GW = G.GW, cap = G.ROOM_VCELL/if97(P, T).v, h0 = G.hOfTP(G.SAT_WATER, T, P), zf = i => (G.GH - 1 - ((i/GW)|0))*G.MPC;
  for(const i of cells){ const f = frac(i%GW, (i/GW)|0); if(!(f > 0)) continue;
    s.roomWater[i] = f*cap; s.roomWaterE[i] = f*cap*h0; s.roomM[i] *= 1 - f; s.roomO2[i] *= 1 - f; s.roomVap[i] = 0; s.roomH2[i] = 0; }
  for(const i of cells){ if(!(s.roomWater[i] > 0)) continue; let t = i; while(s.roomWater[t - GW] > 0) t -= GW;
    s.roomWP[i] = P*1000 - G.ROOM_P0 + 9.80665*(zf(t) + G.MPC*s.roomWater[t]/cap - zf(i)); }
  return cap;
}

/* the window's drift carried to the horizon, and its spread, against tol; slope:false / spread:false are the detector's own faults */
function stillOf(b, k, dt, ref, tol, left, o){
  const n = b.length, m = (n - 1)/2;
  let sx = 0, lo = Infinity, hi = -Infinity;
  for(let i=0;i<n;i++){ const x = b[(k + 1 + i) % n]; sx += x; if(x < lo) lo = x; if(x > hi) hi = x; }
  let num = 0, den = 0;
  for(let i=0;i<n;i++){ const d = i - m; num += d*(b[(k + 1 + i) % n] - sx/n); den += d*d; }
  const now = b[k % n], slope = o.slope === false ? 0 : num/den/dt;
  return Math.abs(now - ref) + Math.abs(slope)*left <= tol && (o.spread === false || hi - lo <= tol);
}
/* steps until the answer is known: fail() or event() names a reason, every signal is still out to the horizon, or the cap */
function watch(G, o){
  const dt = o.dt || 0.02, step = o.step || (() => G.step(dt)), sig = o.sig || [], H = o.horizon ?? o.cap;
  const N = Math.round(Math.min(o.cap, H)/dt), n = Math.max(2, Math.round((o.window ?? 1)/dt)), buf = sig.map(() => new Float64Array(n));
  const ref = sig.map(s => s.ref ?? s.read()), max = {}, min = {};
  for(const s of sig){ max[s.name] = -Infinity; min[s.name] = Infinity; }
  let k = 0;
  while(k < N){
    step(); k++;
    const t = k*dt;
    if(o.each) o.each(k, t);
    const bad = o.fail && o.fail(t);
    if(bad) return {t, k, end:"fail", why:bad, max, min};
    const ev = o.event && o.event(t);
    if(ev) return {t, k, end:"event", why:ev, max, min};
    for(let j=0;j<sig.length;j++){ const x = sig[j].read(), s = sig[j].name; buf[j][k % n] = x;
      if(x > max[s]) max[s] = x; if(x < min[s]) min[s] = x; }
    if(sig.length && k >= n && sig.every((s, j) => stillOf(buf[j], k, dt, ref[j], s.tol, Math.max(0, H - t), o)))
      return {t, k, end:"still", why:"", max, min};
  }
  return {t:k*dt, k, end:"cap", why:"", max, min};
}
const watchNote = w => w.end + " at " + w.t.toFixed(2) + " s" + (w.why ? ": " + w.why : "");
/* one pass of circuit ci's water at w kg/s: its mass over its flow, floored at 1 s; the core circuit at its own flow unless named */
function transit(G, ci, w){
  const PT = G.PT, ST = G.ST;
  if(ci === undefined){ ci = G.nodeGraph().coreCirc; w = ST.sc[G.SC_FLOWNET]*G.P.netRef; }
  let m = 0;
  for(let i=0;i<PT.nodeCirc.length;i++) if(PT.nodeCirc[i] === ci && ST.mBy[i] === ST.mBy[i]) m += ST.mBy[i];
  return Math.max(1, m/w);
}

/* Colebrook-White by fixed point: the implicit equation itself, not an explicit fit */
function colebrook(Re, rr){
  if(Re < 2300) return 64/Re;
  let x = 0.02;
  for(let i=0;i<60;i++) x = Math.pow(-2*Math.log10(rr/3.7 + 2.51/(Re*Math.sqrt(x))), -2);
  return x;
}

/* IAPWS-IF97 region 4, the saturation line of water: T in K, p in MPa */
const R4 = [1167.0521452767, -724213.16703206, -17.073846940092, 12020.82470247, -3232555.0322333,
  14.91510861353, -4823.2657361591, 405113.40542057, -0.23855557567849, 650.17534844798];
function tsat(p){
  const b = Math.pow(p, 0.25), e = b*b + R4[2]*b + R4[5], f = R4[0]*b*b + R4[3]*b + R4[6], g = R4[1]*b*b + R4[4]*b + R4[7];
  const d = 2*g/(-f - Math.sqrt(f*f - 4*e*g)), s = R4[9] + d;
  return (s - Math.sqrt(s*s - 4*(R4[8] + R4[9]*d)))/2;
}
function psat(T){
  const th = T + R4[8]/(T - R4[9]), A = th*th + R4[0]*th + R4[1], B = R4[2]*th*th + R4[3]*th + R4[4], C = R4[5]*th*th + R4[6]*th + R4[7];
  return Math.pow(2*C/(-B + Math.sqrt(B*B - 4*A*C)), 4);
}

/* IAPWS-IF97 region 1 Gibbs free energy: specific volume (m3/kg) and enthalpy (kJ/kg) off (p MPa, T K); ref.js checks it against the release's verification table */
const R1 = [[0,-2,0.14632971213167],[0,-1,-0.84548187169114],[0,0,-3.756360367204],[0,1,3.3855169168385],[0,2,-0.95791963387872],
  [0,3,0.15772038513228],[0,4,-0.016616417199501],[0,5,8.1214629983568e-4],[1,-9,2.8319080123804e-4],[1,-7,-6.0706301565874e-4],
  [1,-1,-0.018990068218419],[1,0,-0.032529748770505],[1,1,-0.021841717175414],[1,3,-5.283835796993e-5],[2,-3,-4.7184321073267e-4],
  [2,0,-3.0001780793026e-4],[2,1,4.7661393906987e-5],[2,3,-4.4141845330846e-6],[2,17,-7.2694996297594e-16],[3,-4,-3.1679644845054e-5],
  [3,0,-2.8270797985312e-6],[3,6,-8.5205128120103e-10],[4,-5,-2.2425281908e-6],[4,-2,-6.5171222895601e-7],[4,10,-1.4341729937924e-13],
  [5,-8,-4.0516996860117e-7],[8,-11,-1.2734301741641e-9],[8,-6,-1.7424871230634e-10],[21,-29,-6.8762131295531e-19],
  [23,-31,1.4478307828521e-20],[29,-38,2.6335781662795e-23],[30,-39,-1.1947622640071e-23],[31,-40,1.8228094581404e-24],
  [32,-41,-9.3537087292458e-26]];
const RW = 0.461526;
const if97 = (p, T) => { const pi = p/16.53, tau = 1386/T; let gp = 0, gt = 0, gtt = 0;
  for(const [I, J, n] of R1){ gp += -n*I*Math.pow(7.1 - pi, I - 1)*Math.pow(tau - 1.222, J);
    gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1);
    gtt += n*Math.pow(7.1 - pi, I)*J*(J - 1)*Math.pow(tau - 1.222, J - 2); }
  return {v: pi*gp*RW*T/(p*1000), h: RW*T*tau*gt, cp: -RW*tau*tau*gtt}; };
/* x where increasing f(x) = y on [lo, hi], an end when y is past it: Illinois regula falsi, the bracket kept, to 1e-10 in x */
const rootUp = (f, y, lo, hi) => { let a = lo, b = hi, fa = f(a) - y, fb = f(b) - y, side = 0, c = a;
  if(!(fa < 0)) return a; if(!(fb > 0)) return b;
  for(let k=0;k<200 && b - a > 1e-10;k++){ c = (a*fb - b*fa)/(fb - fa); const fc = f(c) - y;
    if(fc === 0) return c;
    if(fc < 0){ a = c; fa = fc; if(side === -1) fb /= 2; side = -1; } else { b = c; fb = fc; if(side === 1) fa /= 2; side = 1; } }
  return c; };
/* region 1 inverted over its own range: Newton on its own c_p, held inside the bracket it narrows, to 1e-10 in T; an end when h is past it */
const TofH = (p, h) => { let lo = 273.16, hi = 623.15, T = Math.min(hi, Math.max(lo, lo + h/4.19));
  for(let k=0;k<200;k++){ const r = if97(p, T), f = r.h - h;
    if(f > 0) hi = T; else lo = T;
    let n = T - f/r.cp; if(!(n > lo && n < hi)) n = (lo + hi)/2;
    if(Math.abs(n - T) <= 1e-10) return n;
    T = n; }
  return T; };

/* IAPWS-IF97 region 2 (tables 10 and 11): ideal part [J, n], residual part [I, J, n] */
const R2_0 = [[0,-9.6927686500217],[1,10.086655968018],[-5,-5.608791128302e-3],[-4,7.1452738081455e-2],[-3,-0.40710498223928],
  [-2,1.4240819171444],[-1,-4.383951131945],[2,-0.28408632460772],[3,2.1268463753307e-2]];
const R2_R = [[1,0,-1.7731742473213e-3],[1,1,-1.7834862292358e-2],[1,2,-4.5996013696365e-2],[1,3,-5.7581259083432e-2],
  [1,6,-5.032527872793e-2],[2,1,-3.3032641670203e-5],[2,2,-1.8948987516315e-4],[2,4,-3.9392777243355e-3],[2,7,-4.3797295650573e-2],
  [2,36,-2.6674547914087e-5],[3,0,2.0481737692309e-8],[3,1,4.3870667284435e-7],[3,3,-3.227767723857e-5],[3,6,-1.5033924542148e-3],
  [3,35,-4.0668253562649e-2],[4,1,-7.8847309559367e-10],[4,2,1.2790717852285e-8],[4,3,4.8225372718507e-7],[5,7,2.2922076337661e-6],
  [6,3,-1.6714766451061e-11],[6,16,-2.1171472321355e-3],[6,35,-23.895741934104],[7,0,-5.905956432427e-18],[7,11,-1.2621808899101e-6],
  [7,25,-3.8946842435739e-2],[8,8,1.1256211360459e-11],[8,36,-8.2311340897998],[9,13,1.9809712802088e-8],[10,4,1.0406965210174e-19],
  [10,10,-1.0234747095929e-13],[10,14,-1.0018179379511e-9],[16,29,-8.0882908646985e-11],[16,50,0.10693031879409],
  [18,57,-0.33662250574171],[20,20,8.9185845355421e-25],[20,35,3.0629316876232e-13],[20,48,-4.2002467698208e-6],
  [21,21,-5.9056029685639e-26],[22,53,3.7826947613457e-6],[23,39,-1.2768608934681e-15],[24,26,7.3087610595061e-29],
  [24,40,5.5414715350778e-17],[24,58,-9.436970724121e-7]];
const if97r2 = (p, T) => { const tau = 540/T, b = tau - 0.5; let g0t = 0, g0tt = 0, grp = 0, grt = 0, grtt = 0;
  for(const [J, n] of R2_0){ g0t += n*J*Math.pow(tau, J - 1); g0tt += n*J*(J - 1)*Math.pow(tau, J - 2); }
  for(const [I, J, n] of R2_R){ grp += n*I*Math.pow(p, I - 1)*Math.pow(b, J);
    grt += n*Math.pow(p, I)*J*Math.pow(b, J - 1); grtt += n*Math.pow(p, I)*J*(J - 1)*Math.pow(b, J - 2); }
  return {v: RW*T*(1 + p*grp)/(p*1000), h: RW*T*tau*(g0t + grt), cp: -RW*tau*tau*(g0tt + grtt)}; };
/* IAPWS R7-97(2012) region 5 (tables 37 and 38), 1073.15-2273.15 K */
const R5_0 = [[0,-13.179983674201],[1,6.8540841634434],[-3,-2.4805148933466e-2],[-2,0.36901534980333],[-1,-3.1161318213925],[2,-0.32961626538917]];
const R5_R = [[1,1,1.5736404855259e-3],[1,2,9.0153761673944e-4],[1,3,-5.0270077677648e-3],[2,3,2.2440037409485e-6],[2,9,-4.1163275453471e-6],[3,7,3.7919454822955e-8]];
const if97r5 = (p, T) => { const tau = 1000/T; let g0t = 0, g0tt = 0, grp = 0, grt = 0, grtt = 0;
  for(const [J, n] of R5_0){ g0t += n*J*Math.pow(tau, J - 1); g0tt += n*J*(J - 1)*Math.pow(tau, J - 2); }
  for(const [I, J, n] of R5_R){ grp += n*I*Math.pow(p, I - 1)*Math.pow(tau, J);
    grt += n*Math.pow(p, I)*J*Math.pow(tau, J - 1); grtt += n*Math.pow(p, I)*J*(J - 1)*Math.pow(tau, J - 2); }
  return {v: RW*T*(1 + p*grp)/(p*1000), h: RW*T*tau*(g0t + grt), cp: -RW*tau*tau*(g0tt + grtt)}; };
/* steam off region 2 to 1073.15 K, region 5 above */
const if97steam = (p, T) => T <= 1073.15 ? if97r2(p, T) : if97r5(p, T);
/* IAPWS-IF97 region 3 (table 30): f(rho, T) = n1 ln(delta) + sum n delta^I tau^J */
const R3_N1 = 1.0658070028513;
const R3 = [[0,0,-15.732845290239],[0,1,20.944396974307],[0,2,-7.6867707878716],[0,7,2.6185947787954],[0,10,-2.808078114862],
  [0,12,1.2053369696517],[0,23,-8.4566812812502e-3],[1,2,-1.2654315477714],[1,6,-1.1524407806681],[1,15,0.88521043984318],
  [1,17,-0.64207765181607],[2,0,0.38493460186671],[2,2,-0.85214708824206],[2,6,4.8972281541877],[2,7,-3.0502617256965],
  [2,22,3.9420536879154e-2],[2,26,0.12558408424308],[3,0,-0.2799932969871],[3,2,1.389979956946],[3,4,-2.018991502357],
  [3,16,-8.2147637173963e-3],[3,26,-0.47596035734923],[4,0,4.39840744735e-2],[4,2,-0.44476435428739],[4,4,0.90572070719733],
  [4,26,0.70522450087967],[5,1,0.10770512626332],[5,3,-0.32913623258954],[5,26,-0.50871062041158],[6,0,-2.2175400873096e-2],
  [6,2,9.4260751665092e-2],[6,26,0.16436278447961],[7,2,-1.3503372241348e-2],[8,26,-1.4834345352472e-2],[9,2,5.7922953628084e-4],
  [9,26,3.2308904703711e-3],[10,0,8.0964802996215e-5],[10,1,-1.6557679795037e-4],[11,26,-4.4923899061815e-5]];
const if97r3 = (rho, T) => { const d = rho/322, t = 647.096/T;
  let fd = R3_N1/d, fdd = -R3_N1/(d*d), ft = 0, ftt = 0, fdt = 0;
  for(const [I, J, n] of R3){ const a = Math.pow(d, I), b = Math.pow(t, J);
    fd += n*I*a/d*b; fdd += n*I*(I - 1)*a/(d*d)*b; ft += n*a*J*b/t; ftt += n*a*J*(J - 1)*b/(t*t); fdt += n*I*J*a/d*b/t; }
  const q = d*fd - d*t*fdt;
  return {p: rho*RW*T*d*fd/1000, h: RW*T*(t*ft + d*fd), cp: RW*(-t*t*ftt + q*q/(2*d*fd + d*d*fdd)),
    dpdr: RW*T*(2*d*fd + d*d*fdd)/1000}; };
/* IF97 section 4: the B23 line between regions 2 and 3 */
const B23 = [348.05185628969, -1.1671859879975, 1.0192970039326e-3, 572.54459862746, 13.91883977887];
const pB23 = T => B23[0] + B23[1]*T + B23[2]*T*T;
const tB23 = p => B23[3] + Math.sqrt((p - B23[4])/B23[2]);
/* region 3 at (p, T): walk rho in from the liquid end (or the vapour end below psat) while p(rho) stays monotone, then bisect */
const r3rho = (p, T) => {
  const liq = T >= 647.096 || p >= psat(T), s = liq ? -0.5 : 0.5;
  let a = liq ? 850 : 1;
  for(;;){ const b = a + s, r = if97r3(b, T);
    if((r.dpdr <= 0 && T < 647.096) || b <= 0.5) return NaN;
    if(liq ? r.p <= p : r.p >= p){ let lo = Math.min(a, b), hi = Math.max(a, b);
      for(let k=0;k<100;k++){ const m = (lo + hi)/2; if(if97r3(m, T).p < p) lo = m; else hi = m; }
      return (lo + hi)/2; }
    a = b; } };
/* IF97 section 4's region choice at (p MPa, T K), 273.15-1073.15 K and up to 100 MPa */
const if97pT = (p, T) => {
  if(T <= 623.15 && p >= psat(T)){ const r = if97(p, T); return {region:1, rho:1/r.v, h:r.h, cp:r.cp}; }
  if(T <= 623.15 || T > 863.15 || p <= pB23(T)){ const r = if97r2(p, T); return {region:2, rho:1/r.v, h:r.h, cp:r.cp}; }
  const rho = r3rho(p, T), r = if97r3(rho, T); return {region:3, rho, h:r.h, cp:r.cp}; };

/* recoverable MeV per U-235 fission, ENDF/B-VIII.0 MF=1 MT=458 at thermal, typed a second time; the capture gamma is the drawing's own */
const FIS = {ef:169.130, en:4.8276 + 0.008074, egp:7.2813, egd:6.330, eb:6.500, fgd:6.330/(6.500 + 6.330)};
/* shares of prompt and delayed heat outside the pin, at void a and rod coverage cov: neutrons (fn of prompt)
   by moderation weight, gammas and captures off the design's own table bilinearly, prompt in columns 0-4
   and decay in 5-9; the law written out a second time. The structures' and the absorber's go to the water,
   as the tick puts them; cp and cd are the control channels'. */
function heatShareHand(tab, cc, mb, cx, fn, a, cov, covMax){
  const g = tab.length/25, at = (i, j, q) => tab[(i*5 + j)*g + q];
  const x = Math.max(0, Math.min(1, a))*4, y = Math.max(0, Math.min(1, cov/covMax))*4;
  const i = Math.min(3, Math.floor(x)), j = Math.min(3, Math.floor(y)), fx = x - i, fy = y - j;
  const lerp = q => (at(i, j, q)*(1 - fy) + at(i, j + 1, q)*fy)*(1 - fx) + (at(i + 1, j, q)*(1 - fy) + at(i + 1, j + 1, q)*fy)*fx;
  const cw = cc*(1 - Math.max(0, Math.min(1, a))), n = cw + mb + cx;
  const nw = n > 0 ? cw/n : 0, nb = n > 0 ? mb/n : 0, nx = n > 0 ? cx/n : 0;
  return {wp:fn*nw + lerp(0) + lerp(2) + lerp(3), bp:fn*nb + lerp(1), cp:fn*nx + lerp(4), wd:lerp(5) + lerp(7) + lerp(8), bd:lerp(6), cd:lerp(9)}; }
const coreShareHand = (G, c, a, cov) => { const T = G.PT, n = 25*G.HS_OUT;
  return heatShareHand(T.coreHsTab.subarray(c*n, c*n + n), T.coreHsC[c], T.coreHsM[c], T.coreHsX[c], T.coreHsFN[c], a, cov || 0, T.coreCovMax[c]); };

/* the drawn moderator's cp kJ/kg/K and k W/m/K at T, and the stack's whole-core conductance kW/K at block
   temperature T and film factor film (the rated flow's, unstated): the tick's own law written out */
const modProp = (G, c, T) => { const io = new Float64Array(3), m = G.MODER[G.PT.coreModRow[c]]; io[0] = T;
  m.cpA(io, 0, 1); m.kA(io, 0, 2); return {cp:io[1], k:io[2]}; };
const stackUA = (G, c, T, film) => { const PT = G.PT, f = film ?? G.pinFilm(PT.coreFlowK[c]);
  return 1/(1000*(PT.coreGRk[c]/modProp(G, c, T).k + PT.coreGRi[c] + PT.coreGRf[c]/f)); };

/* erf by its Maclaurin series, to 1e-10 over |x| < 5 */
const erfS = x => { let s = 0, t = x, n = 0; while(Math.abs(t) > 1e-18*Math.max(1, Math.abs(s)) && n < 200){ s += t/(2*n + 1); n++; t *= -x*x/n; } return 2/Math.sqrt(Math.PI)*s; };
/* each can's own cp J/kg/K and h(T) - h(298.15) kJ/kg, typed a second time: Zircaloy-2 IAEA-TECDOC-1496 sec. 6.2.1.1 eqs. 1-3, Mg the NIST WebBook solid Shomate */
const CLAD_OWN = {
  "ZIRCALOY": (() => { const al = T => 255.66 + 0.1024*T, be = T => 597.1 - 0.4088*T + 1.565e-4*T*T, G = T => T > 1100 && T < 1320 ? 1058.4*Math.exp(-((T - 1213.8)**2)/719.61) : 0;
    const A = T => 255.66*T + 0.1024*T*T/2, B = T => 597.1*T - 0.4088*T*T/2 + 1.565e-4*T**3/3, s = Math.sqrt(719.61);
    const Gi = T => T <= 1100 ? 0 : 1058.4*s*Math.sqrt(Math.PI)/2*(erfS((Math.min(T, 1320) - 1213.8)/s) - erfS((1100 - 1213.8)/s));
    return {cp:T => (T <= 1213.8 ? al(T) : be(T)) + G(T),
      h:T => ((T <= 1213.8 ? A(T) - A(298.15) : A(1213.8) - A(298.15) + B(T) - B(1213.8)) + Gi(T))/1000,
      src:"Zircaloy-2 cp, IAEA-TECDOC-1496 (2006) sec. 6.2.1.1 eqs. 1-3"}; })(),
  "MAGNOX AL80": (() => { const M = 0.024305, F = t => 26.54083*t - 1.533048*t*t/2 + 8.062443*t**3/3 + 0.572170*t**4/4 + 0.174221/t;
    return {cp:T => { const t = T/1000; return (26.54083 - 1.533048*t + 8.062443*t*t + 0.572170*t**3 - 0.174221/(t*t))/M; },
      h:T => (F(T/1000) - F(0.29815))/M, src:"Mg solid, NIST WebBook Shomate 298-923 K"}; })()};

/* runs code inside the bundle, where a function declaration can be rebound for a fault */
const inBundle = code => { load(); return EV(code); };
/* rebinds bundle function name with its first `from` written as `to`; returns the undo */
const swap = (G, name, from, to) => { const keep = G[name].toString(); if(!keep.includes(from)) throw new Error(name + ": no " + from);
  inBundle(name + " = " + keep.replace(from, to).replace(/^function \w+/, "function")); return () => inBundle(name + " = " + keep.replace(/^function \w+/, "function")); };
module.exports = {ASK, NOWHY, HARNESS, RESULTS, inputHashes, gitHead, treeNote, list, treeId, resultKey, resultFiles, chunksOf, presetsOf, orderOf, legSave, legLoad, fmt, stOf, tolOf, checkLine, load, inBundle, swap, check, commissionPreset, rig, layWater, blastExcess, watch, watchNote, stillOf, transit, coreInflow, colebrook, tsat, psat, if97, TofH, rootUp, FIS, heatShareHand, coreShareHand, modProp, stackUA, CLAD_OWN, erfS,
  if97r2, if97r3, if97r5, if97steam, pB23, tB23, if97pT, R1, R2_0, R2_R, RW};

/* batch.js requires this module, so it joins only once the exports above are whole */
if(MAIN){
  const {batchJoin, batchEnd, batchRender, ledgerFile} = require("./batch.js");
  recKey = resultKey(MAIN, recArgs); recInputs = inputHashes(MAIN);
  recBatch = batchJoin({plan:ASK.plan, why:ASK.why, script:MAIN, key:recKey, asked:"node tests/physics/" + MAIN + ".js " + process.argv.slice(2).join(" "),
    at:T0, pid:process.pid, commit:gitHead(), inputs:recInputs});
  fs.writeSync(1, "@@BATCH " + recBatch.id + " " + recBatch.attempt + "\n");
  process.on("uncaughtExceptionMonitor", e => { recErr = String(e && e.stack || e).split("\n").slice(0, 3).join(" | "); });
  process.on("exit", code => {
    const end = code ? "crashed" : "done", ms = Date.now() - T0;
    rec({end, at:stamp(new Date()), code, err:recErr || undefined, ms});
    batchEnd(recBatch.id, process.pid, {end, err:recErr || (code ? "exit " + code : ""), ms, checks:recChecks});
    if(!process.env.PHYSICS_RUNJS){ batchRender(ledgerFile(recBatch.id)); fs.writeSync(1, "report    " + recBatch.report + "\n"); }
  });
}
