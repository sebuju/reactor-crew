/* Scratch probe for the hydrogen combustion work. Not an auditor: it prints
   what the plant reads so a figure can be measured rather than eyeballed. */
const {headless} = require('./bundle.js');

const H = headless(`({S:()=>S, P:()=>P, D, LAY, ARCHPRE, archPreset, commission, resetPlant,
  simTick, roomH2Frac, roomO2Frac, roomAt, GW, GH, MPC, ROOM_MOL, H2_MMOL, O2_MMOL,
  ROOM_O2_0, snapS, restoreS, combatHit, ACT, act, buildLayout, layoutMetrics,
  ROOM_CAIR, ROOM_C, H2_LFL, partSkin, partPburst, PIPE_PBURST, H2_UP, mwE, condP, partTsurv,
  radTMax})`);

const arg = process.argv[2] || "rest";

function boot(preset){
  if(preset && preset !== "PWR") H.archPreset(preset);
  H.layoutMetrics(); H.commission(); H.resetPlant();
  H.S().diceOff = true;
}
function run(sec){ const n = Math.round(sec/0.02); for(let i=0;i<n;i++) H.simTick(); }
const f = (v,d=4) => (typeof v === "number" ? v.toFixed(d) : String(v));

if(arg === "rest"){
  const names = Object.keys(H.ARCHPRE);
  for(const k of names){
    boot(k); run(120);
    const s = H.S(), P = H.P();
    console.log([k, f(s.n), f(s.TfAvg||s.Tf,2), f(s.dnbr), f(s.n*P.rated,1), f(H.mwE(s),1),
      f(s.condT,2), f(H.condP(s),5), f(H.radTMax(s),2), f(s.roomMax,5), f(s.h2,6),
      f(s.roomPMax,6), s.roomBurnOn].join("  "));
  }
}

if(arg === "accum"){
  boot("PWR");
  const s = H.S();
  s.byp.rps = true;
  H.act("flowDem", 0);
  run(20);
  // sever the hot leg: every cell of the first hot run
  const hot = Object.keys(H.P().net.byKey).filter(k=>k.indexOf("hot:")===0)[0];
  for(const [x,y] of H.P().net.byKey[hot].cells) s.dmgParts.push("pipe:"+x+","+y);
  for(let t=0;t<900;t+=30){
    run(30);
    const S = H.S();
    let peak = 0, peakY = -1, tot = 0;
    for(let i=0;i<H.GW*H.GH;i++){ const fr = H.roomH2Frac(S,i); tot += S.roomH2[i];
      if(fr > peak){ peak = fr; peakY = (i/H.GW)|0; } }
    console.log((t+30)+"s  h2loop="+f(S.h2,2)+"  roomkg="+f(tot,3)+
      "  peak="+f(peak*100,2)+"%  row="+peakY+"  burnOn="+S.roomBurnOn+
      "  pmax="+f(S.roomPMax,1)+"  dmg="+S.dmgParts.length);
  }
  const S = H.S();
  let top=0, bot=0, prof=[];
  for(let Y=0;Y<H.GH;Y++){ let r=0; for(let X=0;X<H.GW;X++) r+=S.roomH2[Y*H.GW+X];
    prof.push(f(r,1)); if(Y<5) top+=r; if(Y>=H.GH-5) bot+=r; }
  console.log("top5="+f(top,1)+" kg  bottom5="+f(bot,1)+" kg");
  console.log("rows: "+prof.join(" "));
}

/* put a charge in a block of cells and watch it go */
function charge(cells, frac){
  const S = H.S();
  // kg of H2 that makes this volume fraction against the cell's own air
  const n = H.ROOM_MOL*frac/(1-frac);
  for(const i of cells) S.roomH2[i] = n*H.H2_MMOL;
}
function block(x0,y0,w,h){ const out=[];
  for(let Y=y0;Y<y0+h;Y++) for(let X=x0;X<x0+w;X++) out.push(Y*H.GW+X);
  return out; }

if(arg === "burn"){
  for(const frac of [0.05, 0.10, 0.296, 0.50, 0.70]){
    boot("PWR"); run(5);
    const S = H.S(), cells = block(6,0,40,1);   // ONE deckhead row, so the charge cannot enrich itself
    charge(cells, frac);
    for(const i of cells) S.roomT[i] = 900;      // hot air lights it
    let pk = 0, kg0 = 0, tOut = -1;
    for(const i of cells) kg0 += S.roomH2[i];
    for(let k=0;k<Math.round(60/0.02);k++){
      H.simTick();
      if(S.roomPMax > pk) pk = S.roomPMax;
      if(tOut < 0 && !S.roomBurnOn && k > 5) tOut = k*0.02;
    }
    let left = 0; for(let i=0;i<H.GW*H.GH;i++) left += S.roomH2[i];
    console.log("f="+f(frac,3)+"  charge="+f(kg0,3)+" kg  left="+f(left,3)+
      "  peakP="+f(pk,1)+" kPa  out@"+f(tOut,2)+"s  roomMax="+f(S.roomMax,0)+
      "  took="+JSON.stringify(S.dmgParts));
  }
}

if(arg === "ign"){
  // each source on its own: cold air beside a hot skin, cold air beside a
  // wreck, hot air with no machine near it
  const tests = [
    ["hot skin", s => { const p = H.LAY.parts.find(q=>q.id==="core"); s.partT[p.id] = 900;
                        return block(p.x, p.y, 2, 2); }],
    ["wreck",    s => { const p = H.LAY.parts.find(q=>q.id==="ctrl0")||H.LAY.parts.find(q=>q.role==="ctrl");
                        s.dmgParts.push(p.id); s.partT[p.id] = 300;
                        return block(p.x, p.y, 2, 2); }],
    ["hot air",  s => { const c = block(40,20,3,3); for(const i of c) s.roomT[i] = 900; return c; }],
  ];
  for(const [lab, setup] of tests){
    boot("PWR"); run(5);
    const S = H.S();
    const cells = setup(S);
    charge(cells, 0.20);
    let on = 0;
    for(let k=0;k<Math.round(4/0.02);k++){ H.simTick(); if(S.roomBurnOn > on) on = S.roomBurnOn; }
    let left = 0; for(const i of cells) left += S.roomH2[i];
    console.log(lab+"  peakOn="+on+"  left="+f(left,4)+"  pmax="+f(S.roomPMax,1));
  }
}

if(arg === "o2"){
  boot("PWR"); run(5);
  const S = H.S(), cells = block(0,0,H.GW,H.GH);   // the whole compartment, rich
  charge(cells, 0.40);
  for(let i=0;i<9;i++) S.roomT[block(20,10,3,3)[i]] = 900;
  let o0 = 0; for(const i of cells) o0 += S.roomO2[i];
  let omin = 1;
  for(let k=0;k<Math.round(30/0.02);k++){ H.simTick();
    for(const i of cells){ const fr = H.roomO2Frac(S,i); if(fr < omin) omin = fr; } }
  let left = 0, o1 = 0;
  for(const i of cells){ left += S.roomH2[i]; o1 += S.roomO2[i]; }
  console.log("h2 left="+f(left,4)+" kg  o2 "+f(o0,4)+" -> "+f(o1,4)+
    "  min o2frac="+f(omin*100,2)+"%  burnOn="+S.roomBurnOn+
    "  h2frac="+f(H.roomH2Frac(S,cells[0])*100,2)+"%");
}

if(arg === "skin"){
  boot("PWR"); run(5);
  const S = H.S();
  const p = H.LAY.parts.find(q=>q.role==="pump");
  const cells = block(p.x, p.y, p.w, p.h);
  charge(cells, 0.296);
  const before = H.partSkin(S, p);
  S.roomT[cells[0]] = 900;                       // one spark cell, not a hot room
  let pk = 0, at15 = 0;
  for(let k=0;k<Math.round(2/0.02);k++){ H.simTick();
    if(S.roomPMax > pk) pk = S.roomPMax;
    if(k === 7) at15 = H.partSkin(S, p); }
  console.log("skin "+f(before,2)+" -> "+f(at15,2)+" K at 0.15 s -> "+
    f(H.partSkin(S,p),2)+" K at 2 s  (tsurv "+H.partTsurv(p)+", pburst "+
    H.partPburst(p)+")  peakP="+f(pk,1)+"  took="+JSON.stringify(S.dmgParts));
}

if(arg === "snap"){
  boot("PWR"); run(5);
  const S = H.S(), cells = block(10,4,6,6);
  charge(cells, 0.20);
  for(const i of cells) S.roomT[i] = 900;
  run(0.5);
  const snap = H.snapS(H.S());
  run(3);
  const a = H.snapS(H.S());
  H.restoreS(snap);
  run(3);
  const b = H.snapS(H.S());
  const d = H.sDiff ? H.sDiff(a,b) : null;
  const cmp = (x,y) => { for(let i=0;i<x.length;i++) if(x[i]!==y[i]) return i; return -1; };
  console.log("h2 diff@"+cmp(a.roomH2,b.roomH2)+" o2 diff@"+cmp(a.roomO2,b.roomO2)+
    " flame diff@"+cmp(a.roomFlame,b.roomFlame)+" p diff@"+cmp(a.roomP,b.roomP)+
    " T diff@"+cmp(a.roomT,b.roomT)+(d?" sDiff="+JSON.stringify(d):""));
}

if(arg === "rise"){
  boot("PWR"); run(5);
  const S = H.S();
  const cells = block(28, H.GH-3, 4, 2);          // a small charge low down
  for(const i of cells) S.roomH2[i] = 0.02;
  run(60);
  let prof = [];
  for(let Y=0;Y<H.GH;Y++){ let r=0; for(let X=0;X<H.GW;X++) r+=S.roomH2[Y*H.GW+X];
    prof.push(f(r,3)); }
  let top=0, bot=0;
  for(let Y=0;Y<H.GH;Y++){ const r=+prof[Y]; if(Y<8) top+=r; if(Y>=H.GH-8) bot+=r; }
  console.log("top8="+f(top,3)+"  bottom8="+f(bot,3));
  console.log("rows: "+prof.join(" "));
}

if(arg === "pipe"){
  boot("PWR"); run(5);
  const S = H.S();
  // a charge sitting on the plant rather than at the deckhead
  const cells = block(20,12,14,8);
  charge(cells, 0.296);
  for(const i of cells) S.roomT[i] = 900;
  let pk = 0;
  for(let k=0;k<Math.round(20/0.02);k++){ H.simTick(); if(S.roomPMax > pk) pk = S.roomPMax; }
  console.log("peakP="+f(pk,1)+" kPa  took="+JSON.stringify(S.dmgParts));
}
