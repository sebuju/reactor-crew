"use strict";
const path = require("path");
const B = require(path.join(__dirname, "..", "..", "tools", "bundle.js"));

let M = null, BASE = null;
function load(){
  if(!M){ const ev = B.headless("(n => eval(n))");
    M = new Proxy({}, {get:(t,k) => typeof k === "string" ? ev(k) : undefined});
    BASE = JSON.stringify(M.D); }
  return M;
}

/* rel: tol is a fraction of |truth|; abs: tol is in the value's own unit; gap: the fidelity row that states a known distance */
function check(name, measured, truth, tol, source, opt){
  const o = opt || {};
  const err = o.abs ? Math.abs(measured - truth) : Math.abs(measured - truth)/Math.max(Math.abs(truth), 1e-300);
  const pass = o.pass !== undefined ? !!o.pass : (isFinite(measured) && err <= tol);
  process.stdout.write("@@CHECK " + JSON.stringify({name, measured, truth, tol, abs:!!o.abs, unit:o.unit || "",
    source, pass, gap:o.gap || "", note:o.note || ""}) + "\n");
  return pass;
}

function commissionPreset(i){
  const G = load();
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

function march(secs, each){
  const G = load(), n = Math.round(secs/0.02);
  for(let i=0;i<n;i++){ if(each) each(i); G.step(0.02); }
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
const if97 = (p, T) => { const pi = p/16.53, tau = 1386/T; let gp = 0, gt = 0;
  for(const [I, J, n] of R1){ gp += -n*I*Math.pow(7.1 - pi, I - 1)*Math.pow(tau - 1.222, J);
    gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1); }
  return {v: pi*gp*RW*T/(p*1000), h: RW*T*tau*gt}; };
/* region 1 inverted by bisection over its own range */
const TofH = (p, h) => { let lo = 273.16, hi = 623.15; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(if97(p, m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };

module.exports = {load, check, commissionPreset, rig, march, colebrook, tsat, psat, if97, TofH};
