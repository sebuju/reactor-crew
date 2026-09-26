"use strict";
// chunks: preset rig
// preset: 0 -
/* A structure fails on the peak side-on overpressure it sees, WHENEVER it sees it. Until 20/09/26 the
   dynamic term was computed only on a tick something was burning or a charge had just been placed, and
   the latch was cleared every tick, so a front arriving later was never judged at all and the next charge
   judged the whole room on whatever was still ringing. These say the judgement is now per tick and
   per cell: `late` that damage happens when it should, `jet` that it does not happen when it should not.
   preset: late, stale, jet and ramp on the stock plant, each from the same 2 s of rest; rig: charge and cap in an empty liner box. */
const {check, load, commissionPreset, blastExcess, watch, watchNote, rig} = require("./lib.js");
const mode = process.argv[2] || "preset";
const CLANCEY = "Clancey (1972) side-on overpressure damage rungs, as PT.partBlast states them per part";

if(mode === "preset"){
  const G = commissionPreset(0), ST = G.ST, PT = G.PT, GW = G.GW;
  ST.sc[G.SC_DICEOFF] = 1;
  const excess = a => blastExcess(G, a);
  const blastParts = () => { const a = []; for(let k=0;k<PT.n.part;k++) if(PT.partBlast[k]) a.push(k); return a; };
  const name = a => (G.IX.partId[a] || ("part " + a));
  watch(G, {cap:2});
  const rest = G.snapS();

  { /* a charge far from the board's machinery: every part is watched tick by tick, and the tick it is
       wrecked on must be the first tick its own cell excess reached its own limit */
    const parts = blastParts();
    const first = new Int32Array(PT.n.part).fill(-1), hurt = new Int32Array(PT.n.part).fill(-1);
    G.act("blast", 4*GW + 4, 3000);
    watch(G, {cap:4, each:k => { const t = k - 1;
      for(const a of parts){
        if(first[a] < 0 && excess(a) >= PT.partBlast[a]) first[a] = t;
        if(hurt[a] < 0 && ST.dmgBy[a]) hurt[a] = t; } }});
    let n = 0, bad = 0, late = 0, note = "";
    for(const a of parts){
      if(hurt[a] < 0 && first[a] < 0) continue;
      n++;
      if(hurt[a] !== first[a]){ bad++; if(bad < 4) note += name(a) + " wrecked t" + hurt[a] + " limit first met t" + first[a] + "; "; }
      else if(hurt[a] > 0) late++;
    }
    check("every part wrecked on the tick its own cell first met its own limit", bad, 0, 0, CLANCEY,
      {abs:true, unit:"parts out of step", pass:n > 0 && bad === 0,
       note:n + " parts saw or took blast damage, " + late + " of them on a tick AFTER the one the charge was placed on" +
         (note ? "; " + note : "")}); }

  G.restoreS(rest);
  { /* two charges five seconds apart: the second must wreck exactly the set that met its own limit on its
       own tick, and nothing that is merely still ringing from the first */
    G.act("blast", 4*GW + 4, 120);
    watch(G, {cap:5});
    const was = new Uint8Array(PT.n.part);
    for(let a=0;a<PT.n.part;a++) was[a] = ST.dmgBy[a] ? 1 : 0;
    const parts = blastParts().filter(a => !was[a]);
    const first = new Int32Array(PT.n.part).fill(-1), hurt = new Int32Array(PT.n.part).fill(-1);
    { const p2 = G.LAY.parts.find(p => p.role === "pump");
      G.act("blast", (p2.y + (p2.h>>1))*GW + Math.max(0, p2.x - 3), 3000); }
    watch(G, {cap:4, each:k => { const t = k - 1;
      for(const a of parts){
        if(first[a] < 0 && excess(a) >= PT.partBlast[a]) first[a] = t;
        if(hurt[a] < 0 && ST.dmgBy[a]) hurt[a] = t; } }});
    let over = 0, under = 0, n = 0;
    for(const a of parts){
      const h = hurt[a] >= 0, f = first[a] >= 0;
      if(h || f) n++;
      if(h && !f) over++;
      if(f && !h) under++; }
    check("a second charge wrecks exactly what met its own limit, not what is still ringing", over + under, 0, 0,
      CLANCEY + "; a wave is judged where and when it arrives, never on a room-wide latch",
      {abs:true, unit:"parts", pass:over + under === 0,
       note:parts.length + " parts still intact after the first charge, " + n + " involved in the second; " + over + " wrecked without meeting their limit, " + under + " met it without being wrecked"}); }

  G.restoreS(rest);
  { /* A steady release holds one cell above the compartment mean for as long as it runs. A quasi-static
       baseline has to FOLLOW that - it is slower than the board's acoustic traverse and faster than
       anything a plant does - or every steady jet reads as a permanent blast wave. The compartment mean
       cannot follow it by construction, and that is what this measures. */
    const parts = blastParts();
    const was = new Uint8Array(PT.n.part);
    for(const a of parts) was[a] = ST.dmgBy[a] ? 1 : 0;
    const pump = G.LAY.parts.find(p => p.role === "pump");
    const cell = (pump.y + (pump.h >> 1))*GW + Math.max(0, pump.x - 2);
    const N = GW*G.GH, of = PT.cellRegion, nr = PT.n.region;
    const m = new Float64Array(nr), c = new Float64Array(nr);
    G.act("injectOn", 6, 200, cell, -1);
    let over = 0, lag = 0, mean = 0, rise = 0, now = NaN;
    const each = k => { const t = k - 1;
      for(const a of parts) if(!was[a] && ST.dmgBy[a]){ over++; was[a] = 1; }
      if(t < 100) return;
      m.fill(0); c.fill(0);
      for(let i=0;i<N;i++){ const r = of[i]; if(r < 0) continue; m[r] += ST.roomP[i]; c[r]++; }
      for(let r=0;r<nr;r++) if(c[r] > 0) m[r] /= c[r];
      let l1 = 0, r1 = 0;
      for(let i=0;i<N;i++){ const r = of[i]; if(r < 0 || PT.rOcc[i] || PT.rTight[i]) continue;
        const l = ST.roomP[i] - ST.roomPQs[i], g = ST.roomP[i] - m[r];
        if(l > l1) l1 = l; if(ST.roomP[i] > r1) r1 = ST.roomP[i];
        if(t % 5) continue;
        if(l > lag) lag = l;
        if(g > mean) mean = g;
        if(ST.roomP[i] > rise) rise = ST.roomP[i]; }
      now = l1/r1; };
    watch(G, {cap:2, each});
    // one window is the floor: the board's acoustic traverse is under a tenth of a second
    const w = watch(G, {cap:3, horizon:28, window:1, sig:[{name:"excess over rise", read:() => now, ref:0, tol:0.05}], each:k => each(k + 100)});
    check("the dynamic excess a SUSTAINED release leaves, against the static rise it causes", lag/rise, 0, 0.05,
      "a steady source is not a wave: a quasi-static baseline follows it within the board's own acoustic " +
      "traverse, so what is left over is the fluctuation and not the rise",
      {abs:true, unit:"relative", note:"steady 200 kg/s steam release beside the pump, sampled from 2 s to " + (2 + w.t).toFixed(2) + " s (" + watchNote(w) + " of a 30 s release): " +
        "worst cell excess over the quasi-static baseline " + lag.toFixed(4) + " kPa against a static rise of " +
        rise.toFixed(3) + " kPa and a lowest blast limit of 15 kPa on this board; the compartment mean would " +
        "have left " + mean.toFixed(4) + " kPa"});
    check("...and it wrecks nothing on the blast path", over, 0, 0,
      "a sustained squeeze is the crush path's business, never the blast path's",
      {abs:true, unit:"parts", pass:over === 0}); }

  G.restoreS(rest);
  { /* a spatially uniform rise has no front; its rise time is long against a structure's own period, so
       it loads by its pressure difference (dynamic load factor 1) and belongs to the crush path */
    const N = GW*G.GH, of = PT.cellRegion, core = PT.corePart[0], r0 = of[PT.partCell[core]];
    const cells = []; for(let i=0;i<N;i++) if(of[i] === r0 && G.eGasCell(G.eRoomVgas(i))) cells.push(i);
    const parts = blastParts(), was = new Uint8Array(PT.n.part);
    for(const a of parts) was[a] = ST.dmgBy[a] ? 1 : 0;
    const rate = 2000, dt = 0.02, p0 = ST.roomP[cells[0]];
    let blast = 0, crush = 0, worst = 0, at = -1, lo = Infinity, wnote = "";
    for(const a of parts) if(PT.partBlast[a] < lo) lo = PT.partBlast[a];
    watch(G, {cap:0.5, step:() => { for(const i of cells){ G.E_RR[G.RR_BANG] = rate*dt; G.eRoomBangP(i); G.eRoomBang(i); } G.step(dt); },
      each:() => { for(const a of parts){
        if(!was[a] && ST.dmgBy[a]){ was[a] = 1; if(ST.dmgWhy[a] === G.E_WHY_BLAST){ blast++; if(blast < 4) wnote += name(a) + "; "; } else crush++; }
        if(ST.dmgBy[a]) continue;
        const e = excess(a); if(e > worst){ worst = e; at = a; } } }});
    const rise = ST.roomP[cells[0]] - p0;
    check("blast-path wrecks under a uniform 2 MPa/s rise of the core's compartment", blast, 0, 0,
      "Biggs 1964, Introduction to Structural Dynamics: a ramp load long against the structure's period has dynamic load factor 1, a pressure difference and no front",
      {abs:true, unit:"parts", pass:blast === 0,
       note:cells.length + " gas cells, rise " + rise.toFixed(0) + " kPa over 0.5 s; " + crush + " crushed; worst corrected excess " +
         worst.toFixed(2) + " kPa at " + (at >= 0 ? name(at) + " (limit " + PT.partBlast[at] + ")" : "-") + ", lowest blast limit " + lo + " kPa" +
         (wnote ? "; blast: " + wnote : "")}); }
}

if(mode === "rig"){
  /* an empty sealed liner box, nothing in it to break */
  const G = load(), X0 = 8, X1 = 51, Y0 = 3, Y1 = 30;
  rig((R, GG) => { const D = GG.D; D.mat = D.mat || {}; const L = {m:"liner", t:3000};
    for(let x=X0-1;x<=X1+1;x++){ D.mat[x + "," + (Y0-1)] = L; D.mat[x + "," + (Y1+1)] = L; }
    for(let y=Y0;y<=Y1;y++){ D.mat[(X0-1) + "," + y] = L; D.mat[(X1+1) + "," + y] = L; } });
  const s = G.ST, gw = G.GW, cells = [];
  for(let y=Y0;y<=Y1;y++) for(let x=X0;x<=X1;x++) cells.push(y*gw + x);
  watch(G, {cap:0.1});
  const cx = (X0 + X1) >> 1, cy = (Y0 + Y1) >> 1, ci = cy*gw + cx, k2 = 1/(2*G.BLAST_SIG*G.BLAST_SIG), R3 = Math.ceil(3*G.BLAST_SIG);
  const U = () => { let u = 0; for(const i of cells){ G.eRoomGasA(i); u += G.E_RR[G.RR_UC]; } return u; };
  const brode = kPa => { let b = 0;
    for(const i of cells){ const dx = i%gw - cx, dy = ((i/gw)|0) - cy; if(Math.abs(dx) > R3 || Math.abs(dy) > R3) continue;
      G.eRoomGasA(i); b += kPa*Math.exp(-(dx*dx + dy*dy)*k2)*G.eRoomVgas(i)*G.E_RR[G.RR_CVC]/G.E_RR[G.RR_MR]; }
    return b; };
  const BRODE = "Brode 1959: a gas volume at p1 holds (p1 - p0) V/(gamma - 1) over ambient; summed over the charge's own Gaussian, cut at 3 sigma as the tool cuts it, at each cell's own c_v/R";
  const snap = G.snapS();

  { const kPa = 5000, b = brode(kPa);
    const U0 = U(), p0 = (G.ROOM_P0 + s.roomP[ci])*1000;
    G.act("blast", ci, kPa);
    const dU = U() - U0;
    check("a 5 MPa charge puts its constant-volume energy into the room", dU, b, 1e-9,
      BRODE, {unit:"kJ"});
    // Baker 1983: the shock-tube relation between the charge's gas and the air round it
    G.eRoomGasA(ci); const T1 = s.roomT[ci], g1 = G.E_RR[G.RR_CPC]/G.E_RR[G.RR_CVC], g0 = G.GAM_AIR;
    const p1 = p0 + kPa*1000, a = Math.sqrt(g1*T1/(g0*G.T_HULL));
    const ratio = x => x*Math.pow(1 - (g1 - 1)*(x - 1)/(a*Math.sqrt(2*g0*(2*g0 + (g0 + 1)*(x - 1)))), -2*g1/(g1 - 1));
    let lo = 1, hi = p1/p0; for(let k=0;k<100;k++){ const m = (lo + hi)/2; if(ratio(m) < p1/p0) lo = m; else hi = m; }
    const ps = (lo - 1)*p0/1000, r = Math.round(2*G.BLAST_SIG) + 1;
    let peak = 0;
    watch(G, {cap:1, each:() => { const p = s.roomP[cy*gw + cx + r]; if(p > peak) peak = p; }});
    check("the charge's starting shock, one cell outside its 1/e2 radius", peak, ps, 0.25,
      "Baker et al. 1983, Explosion Hazards and Evaluation: shock-tube starting shock of a burst, source gas at the charge's own T and gamma",
      {unit:"kPa", gap:"what the BLAST fault injects", note:"p1/p0 " + (p1/p0).toFixed(1) + ", source " + T1.toFixed(0) + " K; cell " + r + " from the centre"}); }

  const peakOf = {};
  for(const MPa of [20, 100]){
    G.restoreS(snap);
    const kPa = MPa*1000, ask = brode(kPa), U0 = U();
    G.act("blast", ci, kPa);
    const dU = U() - U0;
    check("a " + MPa + " MPa charge puts the dial's whole Brode energy into the room", dU, ask, 1e-9,
      BRODE + "; past the source cell's cap the charge widens at the same energy (Sachs scaling), walls or no walls",
      {unit:"kJ", note:"landed/asked " + (dU/ask).toFixed(9)});
    let peak = 0;
    watch(G, {cap:1, each:() => { for(const i of cells) if(s.roomP[i] > peak) peak = s.roomP[i]; }});
    peakOf[MPa] = peak;
  }
  check("the box's peak overpressure over the first second rises from 20 to 100 MPa", peakOf[100] - peakOf[20], 0, 0,
    "Hopkinson-Cranz scaling: the peak at a fixed station rises with charge energy",
    {abs:true, unit:"kPa", pass:peakOf[100] > peakOf[20], note:"20 MPa " + peakOf[20].toFixed(1) + " kPa, 100 MPa " + peakOf[100].toFixed(1) + " kPa"});
}
