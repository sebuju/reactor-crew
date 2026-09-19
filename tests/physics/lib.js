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

/* core c's through-flow off the solved edges: kg/s in, mean inlet and outlet h kJ/kg, mean pressure MPa of the nodes it leaves into */
function coreInflow(G, c){
  const PT = G.PT, ST = G.ST;
  let w = 0, e = 0, out = 0, hOut = 0, pOut = 0;
  for(let j=PT.coreLoop0[c];j<PT.coreLoop0[c+1];j++){ const i = PT.coreLoopNode[j];
    for(let k=PT.adjStart[i];k<PT.adjStart[i+1];k++){ const ed = PT.adjEdge[k], w0 = ST.edW[ed]; if(!w0 || PT.edHole[ed]) continue;
      const wi = PT.edV[ed] === i ? w0 : -w0;
      if(wi > 0){ w += wi; e += wi*ST.hBy[PT.adjOther[k]]; }
      else { out -= wi; hOut -= wi*ST.hBy[i]; pOut -= wi*G.eNodeP(PT.adjOther[k]); } } }
  return {w, hIn:e/w, hOut:hOut/out, pOut:pOut/out}; }

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
const if97 = (p, T) => { const pi = p/16.53, tau = 1386/T; let gp = 0, gt = 0, gtt = 0;
  for(const [I, J, n] of R1){ gp += -n*I*Math.pow(7.1 - pi, I - 1)*Math.pow(tau - 1.222, J);
    gt += n*Math.pow(7.1 - pi, I)*J*Math.pow(tau - 1.222, J - 1);
    gtt += n*Math.pow(7.1 - pi, I)*J*(J - 1)*Math.pow(tau - 1.222, J - 2); }
  return {v: pi*gp*RW*T/(p*1000), h: RW*T*tau*gt, cp: -RW*tau*tau*gtt}; };
/* region 1 inverted by bisection over its own range */
const TofH = (p, h) => { let lo = 273.16, hi = 623.15; for(let k=0;k<80;k++){ const m = (lo + hi)/2; if(if97(p, m).h < h) lo = m; else hi = m; } return (lo + hi)/2; };

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

/* recoverable MeV per U-235 fission, Lamarsh (1975) via INL/EXT-13-29256 Table 1, capture gamma at the middle of its 3-12 */
const FIS = {fn:5/(168 + 5 + 7 + 7.5), fgp:(7 + 7.5)/(168 + 5 + 7 + 7.5), fgd:7/(8 + 7)};
/* shares of prompt and delayed heat outside the pin at void a: neutrons by moderation weight, gammas by mass x mu_en/rho; the law written out a second time */
function heatShareHand(gF, gW, gB, cc, mb, a){ const w = gW*(1 - a), g = gF + w + gB, cw = cc*(1 - a), n = cw + mb;
  const gw = g > 0 ? w/g : 0, gb = g > 0 ? gB/g : 0, nw = n > 0 ? cw/n : 0, nb = n > 0 ? mb/n : 0;
  return {wp:FIS.fn*nw + FIS.fgp*gw, bp:FIS.fn*nb + FIS.fgp*gb, wd:FIS.fgd*gw, bd:FIS.fgd*gb}; }
const coreShareHand = (G, c, a) => { const T = G.PT; return heatShareHand(T.coreHsF[c], T.coreHsW[c], T.coreHsB[c], T.coreHsC[c], T.coreHsM[c], Math.max(0, Math.min(1, a))); };

module.exports = {load, check, commissionPreset, rig, march, coreInflow, colebrook, tsat, psat, if97, TofH, FIS, heatShareHand, coreShareHand,
  if97r2, if97r3, pB23, tB23, if97pT};
