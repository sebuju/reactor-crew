"use strict";
/* ══ STRUCTURE IS PAINTED, NOT PLACED ══
   A shield and a containment wall were both MACHINE rows - a 3x3 block and a
   6x3 box with a global menu index behind it - and neither was the thing it
   named. A wall is a SHAPE the player draws, cell by cell, and everything a
   containment does follows from that shape: what a ray crosses, what gas may
   not cross, whether the fill comes back bounded, and where the flat span is
   long enough to be the cell that lets go first.

   D.mat["x,y"] = {m:<material id>, t:<wall mm, or absent for the suggestion>}
   Cell-keyed and parallel to D.pipes, so a cell may carry both: a pipe through
   a gas-tight cell is a PENETRATION - water crosses, gas does not. */

/* ══ ONE TABLE, ONE ROW PER MATERIAL ══
   mu is the ray attenuation per cell of chord that radRay() already integrates
   (lower attenuates harder), rho is kg/m3 so mass follows from thickness and
   cell count, tsurv is the ROLE.tsurv idiom and null means "a temperature is
   not how this fails", tight is whether gas crosses, rel is the share of a
   release that gets out of a region walled in it, t0 is the thickness this
   material SHIPS at in mm - a shielding material has no pressure job at all,
   so a Barlow suggestion would have priced a reactor shield as a 10 mm plate -
   agg is whether its hatch carries aggregate, and S is its ALLOWABLE STRESS in MPa, which is the whole of what makes a
   concrete wall a different machine from a steel one. Read off STEEL_S alone,
   a 1.8 m concrete containment rated 22 MPa: a bunker nothing could ever
   burst, priced at 1 900 t. Concrete carries almost no tension and its own
   figure says so.
   STEEL is exactly the old MACHINE.shield (mu 0.18) and CONCRETE exactly the
   old containment box (mu 0.30), so a plant that paints what it used to place
   reads what it used to read. */
const MAT=[
 {id:"steel", name:"STEEL SHIELD",  mu:0.18, rho:7850, tsurv:null, tight:false, rel:1, t0:300, S:138,
  col:"#6d8f98",
  tip:"Dense plate. It stops rays and nothing else - gas walks straight through it, so a box drawn in this is shielding and never a containment."},
 {id:"conc",  name:"CONCRETE",      mu:0.30, rho:2400, tsurv:null, tight:false, rel:1, t0:900, S:3, agg:true,
  col:"#8a8578",
  tip:"Bulk shielding. Lighter per cell than steel and weaker per cell too, and it is not gas-tight either."},
 {id:"liner", name:"STEEL LINER",   mu:0.35, rho:7850, tsurv:700,  tight:true,  rel:0.10, t0:20,  S:138,
  col:"#8fa9ae",
  tip:"A welded gas-tight plate. It is what makes a closed shape a CONTAINMENT: gas, heat and hydrogen stop at it, and so does most of a release. It has a temperature it fails at, because a liner and its seals are what go long before the structure cares."},
 {id:"lined", name:"LINED CONCRETE",mu:0.16, rho:3600, tsurv:700,  tight:true,  rel:0.04, t0:400, S:8, agg:true,
  col:"#9fb6a0",
  tip:"Concrete with a liner behind it: gas-tight AND the best shielding on the table. It is also the heaviest thing you can paint, per cell, by a long way."},
];
const MAT_BY = (()=>{ const o={}; for(const m of MAT) o[m.id]=m; return o; })();
const MAT_DEF = "liner";
// what a painted cell is worth to a ray if its own row went missing
const matRow = id => MAT_BY[id] || MAT[0];

const matKey = (x,y) => x+","+y;
const matCell = (x,y) => D.mat ? D.mat[matKey(x,y)] : undefined;
const matOf = (x,y) => { const c=matCell(x,y); return c ? matRow(c.m) : null; };
const matIds = () => { const out=[]; for(const k in (D.mat||{})) out.push("mat:"+k); return out; };
const matCells = () => Object.keys(D.mat||{});
// a painted cell is a target and a repair job, so it is a thing that can be wrecked
const matWrecked = (s,x,y) => partWrecked(s, "mat:"+matKey(x,y));
/* ══ A WALL IS A SEPARATOR; A BREACH IS A HOLE IN ONE ══
   These were one predicate and that was the whole of why a containment could
   not blow down: `tight` went false when a cell was wrecked, the next fill
   merged the two sides into ONE volume, and there was no longer a boundary for
   anything to flow across. A shot wall is still a wall - it is a wall with a
   hole in it, and the hole is what the two sides talk through.
   matWall() is a fact about the MATERIAL, so the fill is a design fact and
   nothing about damage enters its cache. matOpen() is the live half. */
const matWall = (x,y) => { const m=matOf(x,y); return !!(m && m.tight); };
const matOpen = (s,x,y) => matWall(x,y) && !!s && matWrecked(s,x,y);

/* EVERY PAINTED CELL, in key order - the pipeSig() argument about cell-keyed
   data, one table over. Joined into laySrcSig() so painting invalidates
   buildLayout()'s occupancy the same way laying a pipe does. */
const matSig = sigMemo(()=>{ let out="";
  for(const k in (D.mat||{})){ const c=D.mat[k]; out += "|"+k+":"+c.m+":"+(c.t===undefined?"-":c.t); }
  return out; });

/* ══ THE FILL: A REGION IS DERIVED, NEVER AUTHORED ══
   A region is a connected component of cells reachable without crossing a
   gas-tight cell - the move nodeGraph() already makes for circuits. Every lie
   the old CONT table told goes away here at once: a wrecked cell opens the
   fill and the containment is visibly gone, two enclosures are two regions,
   and overwhelming a suppression pool is pressure against a real volume.

   WHICH COMPONENT IS THE SHIP is asked, not assumed. "A fill that reaches the
   hull is not a region" was the first rule and it is wrong twice over: the
   hull is SEALED METAL - roomDiffuse() says so and takes no flux through it -
   so a compartment walled on three sides and closed by the skin on the fourth
   is a real sealed compartment, and a ship cut in half by a wall has two of
   them. It also made the reference plant's own containment impossible to draw:
   the rod drives stand ON the deckhead, so no wall can ever be painted over
   the reactor, and shifting the island one row down to make room breaks every
   run on every preset (measured - the main steam line stops routing and the
   turbine trips on tick one).
   The SHIP is the component touching the hull ring at the MOST cells; every
   other component is a region. With nothing painted there is one component, it
   is the ship, and there are no regions - which is the answer that has to come
   out and does, by construction.
   Memoised on the paint and the hull ALONE. Damage is not in the key and must
   not be: a wall that has been shot still separates, and what changed is that
   the two volumes now have an orifice between them (matHoles(), below). */
let matRegCache=null, matRegSig="";
function matRegions(){
  const sig = matSig()+gridSig();
  if(matRegCache && matRegSig===sig) return matRegCache;
  const N=GW*GH, of=new Int32Array(N).fill(-1), tight=new Uint8Array(N);
  for(const k in (D.mat||{})){ const i=k.indexOf(","), x=+k.slice(0,i), y=+k.slice(i+1);
    if(x<0||x>=GW||y<0||y>=GH) continue;
    if(matWall(x,y)) tight[y*GW+x]=1; }
  const regions=[], q=new Int32Array(N);
  for(let i0=0;i0<N;i0++){
    if(tight[i0] || of[i0]>=0) continue;
    const idx=regions.length, cells=[];
    let head=0, tail=0, ring=0;
    q[tail++]=i0; of[i0]=idx;
    while(head<tail){
      const i=q[head++]; cells.push(i);
      const X=i%GW, Y=(i/GW)|0;
      if(X===0||X===GW-1||Y===0||Y===GH-1) ring++;
      if(X>0)    { const j=i-1;  if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(X<GW-1) { const j=i+1;  if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(Y>0)    { const j=i-GW; if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
      if(Y<GH-1) { const j=i+GW; if(!tight[j]&&of[j]<0){ of[j]=idx; q[tail++]=j; } }
    }
    regions.push({idx, cells, ring, bounded:false, wall:[]});
  }
  /* THE SHIP IS THE ONE WITH THE MOST SKIN, and everything else is enclosed.
     Ties go to the earlier component, which is board order, so this is
     deterministic without anybody sorting anything. */
  let ship=-1, best=-1;
  for(const g of regions) if(g.ring>best){ best=g.ring; ship=g.idx; }
  for(const g of regions) g.bounded = g.idx !== ship;
  /* THE WALL BELONGS TO WHAT IT ENCLOSES, so a tight cell is walked once and
     handed to every region it touches - a shared wall between two enclosures
     is a wall of both, which is what it is. */
  const wallOf={};
  for(let i=0;i<N;i++){
    if(!tight[i]) continue;
    const X=i%GW, Y=(i/GW)|0, seen={};
    const put=j=>{ const r=of[j]; if(r>=0 && !seen[r]){ seen[r]=1; regions[r].wall.push(i);
      if(regions[r].bounded) (wallOf[i] || (wallOf[i]=[])).push(r); } };
    if(X>0) put(i-1); if(X<GW-1) put(i+1);
    if(Y>0) put(i-GW); if(Y<GH-1) put(i+GW);
  }
  /* ══ AND THE WALL ITSELF IS ONE THING ══
     A region's `wall` is only what TOUCHES the volume, so the corners of a
     painted box are in no region's wall at all and a thickness applied by the
     ring left them at whatever they were painted at. A SEAL is the connected
     component of gas-tight cells - corners included, and two enclosures that
     share a wall are one seal, which is what one welded boundary is. */
  const seal=new Int32Array(N).fill(-1), seals=[];
  for(let i0=0;i0<N;i0++){
    if(!tight[i0] || seal[i0]>=0) continue;
    const idx=seals.length, cells=[];
    let head=0, tail=0;
    q[tail++]=i0; seal[i0]=idx;
    while(head<tail){
      const i=q[head++]; cells.push(i);
      const X=i%GW, Y=(i/GW)|0;
      if(X>0)    { const j=i-1;  if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(X<GW-1) { const j=i+1;  if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(Y>0)    { const j=i-GW; if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
      if(Y<GH-1) { const j=i+GW; if(tight[j]&&seal[j]<0){ seal[j]=idx; q[tail++]=j; } }
    }
    seals.push(cells);
  }
  matRegCache={of, tight, regions, wallOf, seal, seals}; matRegSig=sig;
  return matRegCache;
}
// the BOUNDED region a cell is in, or null - a cell in the ship at large is in
// no region, and so is a cell inside the wall itself
function matRegionAt(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH) return null;
  const R=matRegions(), r=R.of[y*GW+x];
  if(r<0) return null;
  const g=R.regions[r];
  return g.bounded ? g : null;
}
/* ══ THE SEAL IS THE THING, NOT THE CELL ══
   A gas-tight cell is in NO region of its own - it is the wall - so every
   reader that asked matRegionAt() about the cell the hand was on got null and
   fell back to per-cell figures: one cell of a boundary took a thickness the
   other twenty did not, and the panel said the wall enclosed nothing. The seal
   a wall cell belongs to is the region it walls, and a shared wall speaks for
   the first of the two it separates. */
function matWallRegionAt(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH) return null;
  const rs=matRegions().wallOf[y*GW+x];
  return rs && rs.length ? matRegions().regions[rs[0]] : null;
}
// the region a painted cell speaks for: what it walls, else what it stands in
const matSealAt = (x,y) => matWall(x,y) ? matWallRegionAt(x,y) : matRegionAt(x,y);
// every cell of the one welded boundary this cell is part of, or null
function matSealCells(x,y){
  if(x==null||x<0||x>=GW||y==null||y<0||y>=GH || !matWall(x,y)) return null;
  const R=matRegions(), i=R.seal[y*GW+x];
  return i>=0 ? R.seals[i] : null;
}
const matRegionsBounded = () => matRegions().regions.filter(g=>g.bounded);
// every bounded region's wall cell, once - the set the damage sweeps walk
function matRegionOf(p){ return p ? matRegionAt(p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : null; }

/* ══ EVERY HOLE IN EVERY WALL, AND WHAT IT JOINS ══
   A breached wall cell is an ORIFICE between the two volumes it separates. One
   cell face is its area, so ten cells shot out is ten times the hole and one is
   one - which is the whole of what "does it blow down harder" means and is what
   a fixed relief time constant could never say.
   Returned as edges rather than hung on a region, because a hole belongs to
   BOTH sides equally and neither owns it. The pair is read off the fill's own
   component map, so a cell whose two sides are the same volume (a wall stub
   with nothing behind it) is no hole at all and is simply absent. */
const HOLE_A = () => MPC*ROOM_DEPTH;          // m2, one cell face of compartment
function matHoles(s){
  if(!s || !s.dmgParts || !s.dmgParts.length) return [];
  const R = matRegions(), out = [];
  for(const id of s.dmgParts){
    if(typeof id !== "string" || id.indexOf("mat:") !== 0) continue;
    const j = id.indexOf(","), x = +id.slice(4,j), y = +id.slice(j+1);
    if(!matWall(x,y)) continue;
    const seen = [];
    const put = (X,Y) => { if(X<0||X>=GW||Y<0||Y>=GH) return;
      const r = R.of[Y*GW+X];
      if(r>=0 && seen.indexOf(r)<0) seen.push(r); };
    put(x-1,y); put(x+1,y); put(x,y-1); put(x,y+1);
    for(let a=0;a<seen.length;a++) for(let b=a+1;b<seen.length;b++)
      out.push({x, y, a:seen[a], b:seen[b], area:HOLE_A()});
  }
  return out;
}
// is this region still closed - no hole anywhere in its own wall
const matSealed = (s,g) => !matHoles(s).some(h=>h.a===g.idx||h.b===g.idx);

/* ══ WHAT A REGION IS, IN REAL QUANTITIES ══ */
const matRegVol = g => g.cells.length*MPC*MPC*ROOM_DEPTH;
// the equivalent diameter of the enclosure, m - a circle of the same plan area,
// which is the figure the wall thickness suggestion is taken against
const matRegEqD = g => Math.sqrt(4*g.cells.length*MPC*MPC/Math.PI);
const matRegPerim = g => g.wall.length*MPC;
/* WHAT THE REGION IS HELD AT, MPa absolute. P.Pcont is the ship's own
   compartment pressure and s.roomP is the overpressure field - so a cell in no
   region reads the ship, and a cell in a bounded one reads what that region has
   been driven to, because roomStep() writes the region's own gas law into every
   cell of it. This is the whole of decision 7: where a run is ROUTED decides
   which of the two a break discharges into. */
function regionP(s,x,y){
  const base = (typeof P!=="undefined" && P && P.Pcont) ? P.Pcont : 0.15;
  if(!s || !s.roomP || x==null || x<0||x>=GW||y==null||y<0||y>=GH) return base;
  return base + s.roomP[y*GW+x]/1000;
}
// the same question asked of a PART - it discharges where it stands
const regionPAt = (s,p) => p ? regionP(s, p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : regionP(s,null,null);

/* ══ HOW MUCH OF A RELEASE GETS OUT, AND FROM WHERE ══
   P.contRel was one scalar off a menu row, scaling exactly one of the five
   charges. This is the same question asked at the CELL the activity escaped
   from: bounded and intact behind a gas-tight wall, or loose in the ship. The
   weakest material on that region's own wall decides, because a release leaves
   through the poorest part of the boundary. */
/* AND A BOUNDARY WITH A HOLE IN IT HOLDS BACK NOTHING. What escapes leaves
   through the hole, at the hole, into the ship - so the wall is not standing
   between the release and the crew any more, whatever it is made of. */
function regionRel(s,g){
  if(!g || !g.wall.length || !matSealed(s,g)) return 1;
  let rel = 0;
  for(const i of g.wall){ const m=matOf(i%GW,(i/GW)|0); if(m) rel=Math.max(rel, m.rel); }
  return rel || 1;
}
const contRelAt = (s,x,y) => regionRel(s, matRegionAt(x,y));
const contRelPart = (s,p) => p ? contRelAt(s, p.x+((p.w/2)|0), p.y+((p.h/2)|0)) : 1;

/* ══ WHAT A WALL CELL CAN TAKE IS A PROPERTY OF THE SHAPE ══
   A pipe's hoop stress is the same the length of the run. A painted wall is the
   opposite case: stress is p*R/t, so what a cell can take depends on the LOCAL
   RADIUS, and on a painted enclosure the local radius is something the player
   drew. matSpan() walks the wall in both directions until it turns, and the
   effective radius is half that flat span. A long flat wall is weak in the
   middle, a corner braces itself, and a round enclosure has no weak cell at
   all - which is why real containments are round, discovered by drawing one. */
/* IT WALKS THE BOUNDARY, NOT THE PAINT. A span is how far the PRESSURE
   BOUNDARY runs flat, and a block of shielding butted against a containment
   wall holds nothing - walked as if it did, the stock ship's own shield ran the
   span of a test enclosure from 11 cells to 19 and moved the weakest cell four
   places off the mid-side where it belongs. Same tightness, or the run ends. */
const matWalk = (x,y,dx,dy) => { const t=!!(matOf(x,y)||{}).tight;
  let n=0, X=x+dx, Y=y+dy;
  while(X>=0&&X<GW&&Y>=0&&Y<GH&&matCell(X,Y)&&!!(matOf(X,Y)||{}).tight===t
        &&n<=Math.max(GW,GH)){ n++; X+=dx; Y+=dy; }
  return n; };
// the FLAT LENGTH this cell lies in, cells - what the panel and the log quote
function matSpan(x,y){
  if(!matCell(x,y)) return 1;
  return Math.max(1+matWalk(x,y,-1,0)+matWalk(x,y,1,0),
                  1+matWalk(x,y,0,-1)+matWalk(x,y,0,1));
}
/* ══ AND THE RADIUS THE STRESS ACTUALLY SEES ══
   TWICE THE DISTANCE TO THE NEARER TURN, not half the flat span. Half the span
   is the right figure AT MID-SPAN and it is the same number there - but taken
   flat it makes every cell of a straight side equally weak, and the whole point
   of decision 21 is that a big rectangular containment fails at the CENTRE of
   its longest side. A turn is a support: a cell beside one has almost no lever
   arm, a cell in the middle has the whole half-span, and a round enclosure
   turns every cell and so has no weak cell at all. Measured on a 13x13 square
   against a circle of the same area: the square ties on its four mid-side
   cells, the circle is 2.6x stronger at its own weakest. */
function matSpanEff(x,y){
  if(!matCell(x,y)) return 1;
  const arm=(dx,dy)=>{ const a=matWalk(x,y,dx,dy), b=matWalk(x,y,-dx,-dy);
    return 1+2*Math.min(a,b); };
  return Math.max(arm(1,0), arm(0,1));
}
// mm. Barlow against that radius, which is the same inversion runRating() and
// tankRating() already are.
const matSpanD = (x,y) => matSpanEff(x,y)*MPC*1000;
/* WHAT THIS CELL SHIPS AT, mm. A gas-tight cell has a pressure to hold, so it
   is Barlow against its own local span (matSpan(), below) - never thinner than
   the material ships at. A shielding cell has no pressure job whatever, and
   Barlow on one priced a reactor shield as a 10 mm plate. */
/* THE MATERIAL'S OWN ALLOWABLE, through the hook wallSuggestMm() already has:
   pipeK is a PENALTY ON STRESS, so STEEL_S/S is exactly this material read as a
   fraction of steel. One relation, four materials. */
const matStressK = m => ({pipeK: STEEL_S/m.S});
const matThickSuggest = (x,y) => { const m=matOf(x,y); if(!m) return 0;
  return m.tight ? Math.max(m.t0, wallSuggestMm(matSpanD(x,y), MAT_PDES, matStressK(m))) : m.t0; };
const matThick = (x,y) => { const c=matCell(x,y);
  return (c && c.t !== undefined) ? c.t : matThickSuggest(x,y); };
/* WHAT A REGION IS BUILT TO HOLD, MPa DIFFERENTIAL. Not a knob: a compartment
   boundary is held at whatever the region's own air gets driven to, above the
   ship outside it, and a real containment is designed for a few times ambient.
   Stated once, here, so the suggestion, the burst and the review read one
   figure. */
const MAT_PDES = 0.5;
/* ══ AND A WALL IS JUDGED ON THE DIFFERENCE ACROSS IT ══
   Hoop stress is driven by the pressure DIFFERENCE, never by the absolute: the
   ship's own 0.15 MPa stands on both sides of the wall at rest, and compared
   against an absolute a long thin wall read as burst on tick one. */
/* THE WORST CELL IN THE REGION, not the first one. s.roomP is a gauge field, so
   the difference across the wall IS that field - and taking it at the worst
   cell is what lets a deflagration INSIDE a region be the same event to the
   wall as a slow squeeze, judged by one sweep with one die rather than by a
   second board-order pass that would always beat it to the weakest cell. */
function regionDP(s,g){
  if(!s || !s.roomP) return 0;
  let v=0; for(const i of g.cells) if(s.roomP[i]>v) v=s.roomP[i];
  return v/1000;
}
const matRating = (x,y) => { const m=matOf(x,y); if(!m) return 0;
  return 2*m.S*Math.max(matThick(x,y)-WALL_CORR,0)/Math.max(matSpanD(x,y),1); };
const matBurstP = (x,y) => matRating(x,y)*PIPE_BURST_K;
// t, off the paint at its own thickness - a real volume of a real material
const matCellMass = (x,y) => matThick(x,y)/1000*MPC*ROOM_DEPTH*matRow((matCell(x,y)||{}).m).rho/1000;
function matMass(){ let m=0;
  for(const k in (D.mat||{})){ const i=k.indexOf(","); m+=matCellMass(+k.slice(0,i), +k.slice(i+1)); }
  return m; }

/* ══ AND A PAINTED CELL IS A TARGET ══
   combatHit() refused a shield outright, which was defensible while a shield
   was a block of scenery and is not defensible for a containment wall: shooting
   the wall IS the threat model. One cell, so one target at the per-cell rate and
   one small repair job - the pseudo-part shape pipeCellPart() and portCellPart()
   already use, so the dispatcher, the dose rate, the damage card and the repair
   party need no fourth code path. */
function matCellPart(x,y){
  const c=matCell(x,y); if(!c) return null;
  const cells=[[x,y]], stand=pipeStandCells(cells);
  return {id:"mat:"+matKey(x,y), name:matRow(c.m).name, w:1, h:1,
          access: stand.length>0, cells, stand, isRun:true, isMat:true};
}
// WHERE THE PAINT GIVES UP TO HEAT, K, or null - a shielding material declares
// none and keeps exactly today's behaviour; a gas-tight one states a real
// figure, because a liner and its seals go long before the structure cares.
const matTsurv = (x,y) => { const m=matOf(x,y); return m ? m.tsurv : null; };

/* ══ THE TWO GESTURES, AND THEY ARE pipeLay()'s OWN ══
   Painting is a drag that fills cells and a right-sweep that lifts them, so
   these are the two calls the tool makes and the same two buildStockPlumbing()
   makes - the reference ship's shielding IS the gesture the player would make.
   A cell already carrying a machine, a port or a tank is not painted: one thing
   per cell, the invariant D.pipes already keeps. A PIPE is the exception, and
   that is decision 4 - a pipe through a gas-tight cell is a penetration. */
function matPaint(x,y,m){
  if(x<0||y<0||x>=GW||y>=GH) return false;
  const g=occupied(null,{pipes:false, mat:false});
  if(g[y][x]) return false;
  D.mat[matKey(x,y)]={m: m||MAT_DEF};
  return true;
}
function matLift(x,y){ const k=matKey(x,y);
  if(!D.mat[k]) return false;
  delete D.mat[k];
  return true;
}

/* ══ AND WATER DISCHARGED INTO A REGION COLLECTS IN IT ══
   It used to leave through s.massOut and be gone, which is why ledgerKg()
   closed and also why a break inside a containment left the water nowhere. A
   region keeps its own sump: the SAME kilograms, booked to the region instead
   of out of the book, so the ledger still closes and the water is somewhere.
   KEYED BY THE REGION'S LOWEST CELL INDEX, never by a region index - an index
   is derived and renumbers the moment the paint changes, and a cell does not.
   It is the same argument the "mat:x,y" selection id makes. */
const regionKey = g => { let lo=g.cells[0];
  for(const i of g.cells) if(i>lo) lo=i;          // the highest index IS the lowest row
  return lo; };
const regionSump = (s,g) => (s && s.sump && s.sump[regionKey(g)]) || 0;
// the widest the water can spread, in cells - the footprint the line stands on
const regionSpanX = g => { let x0=GW, x1=0;
  for(const i of g.cells){ const X=i%GW; if(X<x0) x0=X; if(X>x1) x1=X; }
  return x1-x0+1; };
/* ══ AND A COMPARTMENT CANNOT HOLD MORE THAN IT IS ══
   Its own volume, in kilograms. Without it the book was closed and the picture
   was not: measured, 57.9 t collected in a region 2.1 m tall and the FLOODING
   layer drew 6.2 m of water standing above the deckhead. What will not fit
   never enters the sump at all (sumpStep(), step.js), so it stays where every
   kilogram leaving this plant already went and no book has to be unwound. */
const regionSumpCap = g => matRegVol(g)*1000;
/* HOW DEEP IT STANDS, m. The ship is drawn in SECTION, so this is a horizontal
   line and the footprint it fills is the region's own width by the compartment
   depth - the same ROOM_DEPTH every other volume on this grid is priced with. */
function regionFloodM(s,g){
  const kg = regionSump(s,g); if(!(kg>0)) return 0;
  return kg/1000/Math.max(0.01, regionSpanX(g)*MPC*ROOM_DEPTH);
}
// which cells the water is standing in, for the drowning sweep
function regionFlooded(s,g){
  const d=regionFloodM(s,g); if(!(d>0)) return null;
  let bot=-1;
  for(const i of g.cells){ const Y=(i/GW)|0; if(Y>bot) bot=Y; }
  return {bot, rows: d/MPC, d};
}

/* WHERE THE WATER SURFACE IS OVER A GIVEN PART, in ROWS from the top, or null.
   One door, so the FLOODING layer's own line, the panel's HOLDS row and the
   wash a half-submerged machine wears cannot disagree about which machines are
   in the water. */
function regionFloodLine(s,p){
  if(!p) return null;
  const g = matRegionOf(p); if(!g) return null;
  const f = regionFlooded(s,g); if(!f) return null;
  const line = f.bot + 1 - f.rows;
  return (p.y + p.h > line) ? line : null;
}
