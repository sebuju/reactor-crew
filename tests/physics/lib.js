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

module.exports = {load, check, commissionPreset, rig, march, colebrook, tsat, psat};
