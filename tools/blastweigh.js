#!/usr/bin/env node
// node tools/blastweigh.js
// docs/fidelity.md row "what the BLAST fault injects": two numbers the row states as unweighed.
// (a) the charge at which ROOM_TMAX (20000 K) starts capping the source cell's post.
// (b) how much of the near-field peak overpressure a 5 MPa charge beside pump0 never leaves the source cell.
const M=require('./bundle').headless(
 '{D:()=>D,LAY:()=>LAY,ST:()=>ST,act,plantPreset,buildLayout,commission,step,'+
 'GW:()=>GW,GH:()=>GH,ROOM_TMAX,ROOM_P0,T_HULL,snapS,restoreS}');

const D=M.D();
M.plantPreset(0);
M.buildLayout();
M.commission();
const s=M.ST();
const SNAP=M.snapS(); // one byte-copy baseline; every test restores from it instead of rebuilding the plant
const fresh=()=>M.restoreS(SNAP);

const GW=M.GW(), GH=M.GH();
const pump=M.LAY().parts.find(p=>p.role==="pump");
const cx=pump.x-3, cy=pump.y+(pump.h>>1), ci=cy*GW+cx;
console.log("source cell "+cx+","+cy+" beside "+pump.id+" (index "+ci+"), grid "+GW+"x"+GH+", ROOM_TMAX="+M.ROOM_TMAX+" K");

/* ---- (a) the charge at which ROOM_TMAX starts binding ---- */
// eRoomBlastCharge/eRoomBang write ST.roomT synchronously in act() itself, no tick needed to read the clip.
function cappedAt(mpa){
  fresh();
  M.act("blast", ci, mpa*1000);
  return s.roomT[ci] >= M.ROOM_TMAX-1e-6;
}
let lo=0.001, hi=1;
while(!cappedAt(hi)) hi*=2;
for(let i=0;i<40;i++){ const mid=(lo+hi)/2; if(cappedAt(mid)) hi=mid; else lo=mid; }
console.log("\n(a) ROOM_TMAX binds at "+hi.toFixed(4)+" MPa on the dial (bisected to 1e-4 MPa; source-cell T hits "+
  M.ROOM_TMAX+" K exactly at/above this charge, before any tick)");

// "delivered peak pressure" = the source cell's own constant-volume worth, ROOM_P0*(T-T_HULL)/T_HULL —
// the same figure the row itself quotes (187.6 kPa, 6813 kPa). Read straight off the post, no tick, no
// network solve: that solve is the isothermal-collapse row's territory, not this one's.
console.log("\n    dial MPa   T src K (pre-tick)   constant-volume worth kPa");
for(const mpa of [hi*0.5, hi*0.9, hi, hi*1.5, hi*3, hi*10, hi*50]){
  fresh();
  M.act("blast", ci, mpa*1000);
  const Tsrc=s.roomT[ci];
  const worth=M.ROOM_P0*(Tsrc-M.T_HULL)/M.T_HULL;
  console.log("    "+mpa.toFixed(3).padStart(8)+"   "+Tsrc.toFixed(0).padStart(14)+"   "+worth.toFixed(1).padStart(20));
}

/* ---- (b) how much of the near-field peak stays in the source cell ---- */
fresh();
const RMAX=8; // Gaussian's own reach, ceil(3*BLAST_SIG)
const ringCells=[]; for(let r=0;r<=RMAX;r++) ringCells.push([]);
for(let dy=-RMAX;dy<=RMAX;dy++) for(let dx=-RMAX;dx<=RMAX;dx++){
  const r=Math.max(Math.abs(dx),Math.abs(dy));
  if(r>RMAX) continue;
  const x=cx+dx, y=cy+dy;
  if(x<0||x>=GW||y<0||y>=GH) continue;
  ringCells[r].push(y*GW+x);
}
M.act("blast", ci, 5000); // 5 MPa, the row's own reading
// the Gaussian's own deposit, at the instant of the act, before any tick or gas solve has run
const deposit=new Array(RMAX+1).fill(0);
for(let r=0;r<=RMAX;r++){ let m=0; for(const idx of ringCells[r]) if(s.roomT[idx]>m) m=s.roomT[idx]; deposit[r]=m; }
const early=new Array(RMAX+1).fill(0), full=new Array(RMAX+1).fill(0);
for(let k=0;k<50;k++){ // 1 s
  M.step(0.02);
  for(let r=0;r<=RMAX;r++){
    let m=0; for(const idx of ringCells[r]) if(s.roomP[idx]>m) m=s.roomP[idx];
    if(m>full[r]) full[r]=m;
    if(k<5 && m>early[r]) early[r]=m; // the tick of the act and the next few (0.1 s)
  }
}
console.log("\n(b) 5 MPa beside "+pump.id+" — by ring (Chebyshev cells from the source):");
console.log("    ring   T at deposit K   peak P first 0.1 s kPa   peak P first 1 s kPa");
for(let r=0;r<=RMAX;r++) console.log("    "+String(r).padStart(3)+"    "+deposit[r].toFixed(0).padStart(12)+
  "     "+early[r].toFixed(2).padStart(16)+"      "+full[r].toFixed(2).padStart(13));
const sumEarly=early.reduce((a,b)=>a+b,0), sumFull=full.reduce((a,b)=>a+b,0);
console.log("\n    source-cell fraction of the summed ring PEAK-PRESSURE, first 0.1 s: "+(early[0]/sumEarly).toFixed(4));
console.log("    source-cell fraction of the summed ring PEAK-PRESSURE, first 1 s:   "+(full[0]/sumFull).toFixed(4));
