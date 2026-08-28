"use strict";
/* design parameters and the derived() model */

/* ═══════════════ DESIGN DATA ═══════════════ */
/* ── WHAT THE FLUID IS ──
   This used to be ARCH, a REACTOR TYPE: thirteen columns that decided the
   whole feel of the plant, moderation included, off one list row. The three
   columns that said how MODERATED the core is - aM, aV and Lam - have left,
   because moderation is a property of the drawing and derived() measures it
   off the lattice now (modRatio(), lattice.js). What is left is the coolant
   itself: what pressure it wants, where it boils, how much heat a litre of
   the core makes, how well it slows a neutron and how much it eats.

   modK is moderating power per unit volume against light water, absK the
   same for absorption. They are the only two new columns, and they are what
   makes voiding a graphite core ADD reactivity while voiding a water core
   removes it - one expression, not a hand-typed +1500.

   Tref is what this coolant is PROGRAMMED at and dTf how far a pin sits above
   it at rated power - a film question, so sodium's 150 K and helium's 600 K are
   the same expression answering different fluids. commission() keeps
   tsat0-35 as the CEILING on Tref, never as the value, or every high
   temperature family runs at water's 583 K.

   xe and dnbr stay bought on purpose: MSR's 0.15 xenon is online gas
   stripping and SFR's 3.20 DNBR is sodium's boiling margin. Neither is a
   shape you can draw.

   pipeK is what a metre of the PRIMARY is made of, against carbon steel at
   1.00, and it is spent per metre DRAWN (pipeWallK(), pipenet.js) - never as
   a flat lump on this row, which is the ARCH column this table exists to
   remove. Sodium is 2.00 because a real sodium line is double-walled with
   trace heating over the guard pipe; salt is 2.40 for Hastelloy N on top of
   that same freeze protection; helium is 2.60 because a gas at 6 kg/m3 needs
   roughly twice the diameter for the same duty and wall area follows
   diameter. runBore() is untouched - a coolant may not move a conductance. */
const COOLANT=[
 {id:"PWR", name:"PRESSURISED WATER", tie:"WESTINGHOUSE / VVER", mass:340,
  P0:15.5,pipeK:1.00,tsat:618,satN:.10,Tref:583,dTf:320,aF:-2.8,modK:1.00,absK:1.00,dens:100,grace:1.0,dnbr:1.85,xe:1.0,flowMin:.30,eff:.33,
  good:"Dense, well understood, strongly self-limiting",
  bad:"15.5 MPa vessel is heavy; a breach depressurises violently"},
 {id:"BWR", name:"BOILING WATER", tie:"GE MARK I", mass:265,
  P0:7.0,pipeK:1.00,tsat:559,satN:.10,Tref:559,dTf:320,aF:-2.8,modK:1.00,absK:1.00,dens:95,grace:0.9,dnbr:1.55,xe:1.0,flowMin:.30,eff:.33,
  good:"Direct cycle, lighter, power follows flow instantly",
  bad:"Turbine hall is radioactive; margin to dryout is thin"},
 {id:"LWGR",name:"PRESSURE TUBE WATER", tie:"RBMK-1000", mass:250,
  P0:6.9,pipeK:1.00,tsat:558,satN:.10,Tref:550,dTf:320,aF:-1.6,modK:1.00,absK:1.00,dens:55,grace:1.2,dnbr:1.60,xe:1.0,flowMin:.30,eff:.31,
  good:"Cheap fuel, refuels online, boils in the channel itself",
  bad:"Lay graphite around it and the water is a poison, not a moderator"},
 {id:"SFR", name:"LIQUID SODIUM", tie:"EBR-II / BN-800", mass:210,
  P0:0.2,pipeK:2.00,tsat:1150,satN:.10,Tref:723,dTf:150,aF:-1.2,modK:.05,absK:.15,dens:280,grace:6.0,dnbr:3.20,xe:0.85,flowMin:.20,eff:.40,
  good:"Atmospheric pressure, very light, huge boiling margin",
  bad:"Barely slows a neutron, so a core cooled by it is a FAST core"},
 {id:"MSR", name:"MOLTEN SALT", tie:"MSRE", mass:230,
  P0:0.2,pipeK:2.40,fuelInCoolant:true,tsat:1700,satN:.10,Tref:922,dTf:200,aF:-3.5,modK:.35,absK:.18,dens:80,grace:9.0,dnbr:3.00,xe:0.15,flowMin:.20,eff:.44,
  good:"No pressure; gases stripped online, almost no xenon pit",
  bad:"Corrodes continuously; freezes solid if it gets cold"},
 {id:"HTGR",name:"HELIUM GAS", tie:"HTR-PM", mass:260,
  P0:7.0,pipeK:2.60,tsat:2000,satN:.10,Tref:773,dTf:600,aF:-4.5,modK:0,absK:0,dens:6,grace:40,dnbr:2.60,xe:1.0,flowMin:.15,eff:.42,
  good:"Cannot melt. Grace time in hours, not seconds. Voids into nothing",
  bad:"Moderates nothing at all - draw the moderator or draw a fast core"},
];
/* ── WHAT YOU PACK BETWEEN THE ASSEMBLIES ──
   A moderator slot is a lattice slot with a block in it instead of fuel, laid
   with the same pen. modK is against light water; dens is what latMass()
   weighs the blocks you drew. */
const MODER=[
 {name:"GRAPHITE",modK:.95,dens:1.70,
  note:"The classic solid moderator. Slows neutrons well over many collisions, so a graphite core is large and dilute - and the water in it becomes a net absorber, which is what makes a channel-water graphite plant void POSITIVE."},
 {name:"BERYLLIUM OXIDE",modK:1.35,dens:3.00,
  note:"Better than graphite per litre and it multiplies neutrons on top, so a smaller core reaches the same spectrum. Heavy for what it is, and it pushes the void coefficient positive the same way the reflector does."},
 {name:"ZIRCONIUM HYDRIDE",modK:1.80,dens:5.60,
  note:"Hydrogen locked into a solid: the densest moderation you can lay, so a very compact thermal core is possible. It is also the heaviest, and hydrogen leaves it if it gets hot enough."},
];
/* tdmg is where THIS fuel starts taking damage, in K, and the RPS trips a
   fixed 100 K above it. It is a property of the fuel, not a fraction of a
   melting point: metal fuel runs cool and fails early, ceramic runs hot. */
const FUEL=[
 {name:"UO2  3.2% LEU",beta:680,excess:4200,densK:.85,condK:1.0,tdmg:1500,mass:0,
  note:"Low enrichment. The most forgiving kinetics you can buy at 680 pcm of delayed neutrons, but a short campaign and modest power density."},
 {name:"UO2  4.9% LEU",beta:650,excess:5200,densK:1.0,condK:1.0,tdmg:1500,mass:8,
  note:"Standard commercial fuel. Balanced across every axis and the baseline everything else is measured against."},
 {name:"UO2 19.7% HEU",beta:640,excess:8200,densK:1.4,condK:1.0,tdmg:1500,mass:-18,
  note:"Naval-grade enrichment. Far more excess reactivity and power density, so the core is smaller, but you need a lot of rod worth and boron to hold it down."},
 {name:"MOX PLUTONIUM",beta:300,excess:6500,densK:1.6,condK:1.0,tdmg:1450,mass:-12,
  note:"Dense and hot. Beta collapses to 300 pcm, which halves the distance to prompt criticality. Every reactivity mistake is twice as fast."},
 {name:"U-ZR METALLIC",beta:640,excess:6000,densK:1.85,condK:.55,tdmg:1150,mass:-25,
  note:"Metal fuel conducts heat roughly twice as well as ceramic, so fuel runs far cooler for the same power. Melts at a lower temperature though."},
];
/* dens is what latMass() weighs the drawn band with. The old flat `mass`
   figure is gone: a reflector is a thickness you give a face now, so what it
   weighs depends on how much of it you asked for. */
const REFL=[
 {name:"NONE",dRho:0,dV:0,dens:0,note:"Neutrons that leak out are lost. Simplest and lightest option, because there is nothing there."},
 {name:"STEEL",dRho:250,dV:0,dens:7.9,note:"Reflects some leakage back into the core, worth about 250 pcm at one ring of thickness. Dense, so a thick band is expensive."},
 {name:"BERYLLIUM",dRho:750,dV:120,dens:1.85,note:"The best reflector available, worth 750 pcm, and light enough to use thickly. Its (n,2n) reaction also pushes the void coefficient in the positive direction."},
 {name:"GRAPHITE",dRho:520,dV:60,dens:1.7,note:"Good reflector, cheap and light, with a mild positive shift to the void coefficient."},
];
const SCRAM=[
 {name:"GRAVITY DROP",rate:.45,mass:20,note:"Fail-safe on loss of power, but slow, and it slows further under hull acceleration."},
 {name:"SPRING ASSISTED",rate:.90,mass:45,note:"Twice as fast. Its accumulators must be kept charged to work."},
 {name:"BORON INJECTION",rate:2.5,mass:30,note:"Near instant. Irreversible: the loop stays poisoned for the rest of the mission."},
];
const FOLL=[
 {name:"WATER",tipRho:0,tipLen:0,mass:0,
  note:"Nothing below the absorber but coolant. Inserting the bank only ever removes reactivity, all the way in. The dull, safe, correct answer."},
 {name:"GRAPHITE DISPLACER",tipRho:1200,tipLen:8.0,mass:-14,
  note:"A graphite follower keeps water out of the channel below the absorber, so the core wastes fewer neutrons on coolant and the bank is lighter and quicker. It also means the first thing a scram does is drive graphite through the BOTTOM of the core, adding reactivity down there before any absorber arrives. This is the Chernobyl scram."},
 {name:"BORATED STEEL",tipRho:-420,tipLen:4.0,mass:34,
  note:"A poisoned follower. The bank bites early and there is no positive excursion anywhere in its travel, at the price of carrying that poison all campaign - and of the mass."},
];
const CHAN=[
 {name:"SINGLE CHANNEL",noise:1.0,mass:10,note:"One sensor per parameter. When it lies, nothing contradicts it."},
 {name:"TWO CHANNEL",noise:.45,mass:25,note:"Disagreement is visible, but you cannot tell which of the two is wrong."},
 {name:"THREE CHANNEL VOTE",noise:.10,mass:45,note:"Majority voting rejects a failed sensor outright and the readings hold still."},
];
/* `water` is tonnes of SECONDARY water held by ONE generator at power, and it
   is the whole of the boil-dry mechanic: step()'s mass balance divides the
   steam raised into it. It is not a free constant - it is read off the real
   machines the two rows name, because the note prose was already selling
   those inventories and only graceK was spending them.

   A recirculating U-tube unit (Westinghouse Model F class) carries ~55 t on
   its secondary side at power. A once-through unit (B&W OTSG class) carries
   ~7 t: it is a boiler with almost no standing water, which is exactly why
   TMI-2 had seconds rather than minutes. The ~8x ratio is the point; the
   graceK ratio of 1.47 never was that mechanic, only a stand-in for it.

   Re-derive by measuring boil-dry time at full load, M*H_FG/Q. At four
   generators (Q = 299 MWt each) that is 278 s U-tube and 35 s once-through -
   "minutes" and "almost as fast", the two claims the notes make. */
const SGT=[
 {name:"U-TUBE",water:55,mass:70,note:"Large secondary water inventory acts as a heat sink for minutes after feedwater is lost. Heavy and slow to respond."},
 {name:"ONCE-THROUGH",water:7,mass:42,note:"Very little water in it, so it responds instantly to load changes and boils dry almost as fast. Light."},
];
/* The generator's contribution to the PRIMARY's thermal inertia, and the ONE
   place it is decided: derived() here and commission() in step.js both read
   this, where each used to compute it independently from the same raw inputs -
   so a partial fix succeeded in one file and silently did not in the other.

   It is SGT[].mass now, and the old SGT[].graceK field is GONE. That field was
   a single number standing in for two different things: how much metal there
   is to heat up, and how long the water lasts once the feedwater stops. While
   the level was an algebraic guess only the first could be spent, so one
   number could carry both. Stage 6a made the water real (SGT[].water), and
   keeping graceK would have charged the boil-dry time twice.

   Normalised on the U-TUBE row because the stock plant is U-TUBE: it reads
   exactly 1.0, so every trip and coefficient calibrated against that plant is
   untouched. Only ONCE-THROUGH moves, 0.68 -> 0.60, and it moves onto a figure
   the design already states in tonnes instead of a fitted multiplier. */
const sgInertiaK = () => SGT[D.sg].mass / SGT[0].mass;
const CONT=[
 {name:"NONE",rel:1.0,mass:0,note:"No containment. Any fuel damage releases directly to the environment, and to your crew."},
 {name:"SUPPRESSION POOL",rel:.25,mass:40,note:"Compact pool that condenses released steam. Holds most of a release, and can be overwhelmed by a large break."},
 {name:"LARGE DRY",rel:.05,mass:110,note:"A big heavy volume around the whole plant. Holds essentially everything, at more than twice the mass."},
];
const BKP=[
 {name:"NONE",bk:0,mass:0,note:"Lose main power and the coolant pumps stop dead. Only natural circulation remains."},
 {name:"BATTERY BANK",bk:.5,mass:22,note:"Keeps one pump turning at half speed through a blackout."},
 {name:"DIESEL GENERATORS",bk:1.0,mass:58,note:"Full pump power independent of the plant. Heavy, and one more thing to maintain."},
];
COOLANT.forEach(a=>a.note=a.tie+". "+a.good+", but "+a.bad.replace(/^[A-Z]/,c=>c.toLowerCase())+".");
const BUDGET=1500;
/* Where the control bank stands at commissioning. The plant is boronated to be
   critical here, the shutdown margin is measured from here, and resetPlant()
   starts the bank here - one number, because three copies of it would drift. */
const RODX0=.35;
/* SEVEN OF THESE ARE NO LONGER INPUTS. poison, pitch, hd, power, nbank and
   rodw are written by latMeasure() in src/data/lattice.js from the lattice you
   laid out, and the values below are only what they read before the first
   revolve. Everything still reads them the way it always did; nothing writes
   them but the measurement. refl is still yours - you pick the material, the
   drawing decides how much of it there is. */
/* contFit/turbFit/condFit: is the part on the grid at all - see fittableList()
   in layout.js. Decoupled from cont/turb/condCap, which still say what TYPE
   or how good a one you would buy if you fitted it, so unfitting one never
   forgets the other. pumpSize and fit are not FITTABLE flags at all - a
   pump and a fitting are placed, not toggled, at a spot the player chose
   rather than a fixed slot - see PLACED PARTS and FITTINGS in layout.js. */
/* ═══════════ D.pipes: THE PLANT'S OWN PLUMBING, CELL BY CELL ═══════════
   There is no list of RUNS. A connection between two machines is not authored
   at all - it is TRACED out of the cells and the ports (pipeMap(), layout.js)
   and cached, which is what lets it be coloured when it is complete, listed in
   a rail, and broken by a hit on any single cell along it.

   D.pipes["x,y"] = {s:<shape>, r:<rotation 0..3>}. Cell-keyed, so a pipe cell's
   identity IS its cell: no id allocator, no name, no mode, no stored bore, and
   "one thing per cell" is a plain dictionary invariant. A run's bore is still
   priced off its derived KIND (runBore(), pipenet.js); a fitting carries a real
   per-instance bore, which is a different question.

   A generator, a pump or a spare turbine is a PLACED part wired by hand - it
   gets ports and cells like anything else, and pipeNetwork() skips a
   connection whose part is not on the grid this frame. */
const D={cool:0,fuel:1,mod:0,refl:1,poison:400,pitch:1.0,hd:1.0,power:1200,
         pdes:1.0,pzr:1.0,chim:.3,sg:0,
         scram:0,chan:1,rodw:2600,foll:0,nbank:4,rps:true,rpsm:.35,autorod:true,
         /* How far the temperature controller may walk the bank on its own,
            as fractions inserted. Not a safety limit - it is what stops the
            controller wandering off the position the shutdown margin was
            measured from, so it is a commissioning decision and lives here
            rather than as two constants nobody could see or move. commission()
            carries it to P and resetPlant() to S, like every other tune. */
         arLo:0.20, arHi:0.50,
         cont:1,contFit:true,catcher:false,bkp:1,
         turb:.5,turbFit:true,condCap:.5,condFit:true,pumpSize:{},fittings:{},
         /* NO STOCK PLUMBING DECLARED HERE. The tanks, the fittings and the
            runs are BUILT - buildStockPlumbing() (pipenet.js) lays them
            through the same addTank()/addFitting() calls and the same pipe tool the bench
            hands the player, so the reference plant IS the gestures. Two
            literals describing one plant is how the declared shape and the
            authored shape drift apart. */
         /* D.ports[pid] = {p:<partId>, dx, dy, m:<mode>} - a port is a CELL,
            placed beside its machine, and dx/dy are its offset from that
            machine's origin so it rides the machine for free. The FACE is
            derived from the offset (portFaceOf(), layout.js) and never stored.
            D.start[k] = a control's STARTING POSITION, the value the bench set
            it to and the value resetPlant() seeds from. Absent means "whatever
            resetPlant() hard-codes", which is what keeps an untouched design
            commissioning bit-identically. */
         tanks:{}, pipes:{}, ports:{}, start:{}};

/* WHERE AN ACTUATOR STANDS THE MOMENT THE PLANT IS COMMISSIONED. Absent means
   "whatever resetPlant() hard-codes", which is the whole safety net: an
   untouched design commissions bit-identically, and only a bench control the
   player actually moved changes anything.
   ONE HELPER, read by BOTH the bench's own control cell (benchCell(),
   render/plant.js) and resetPlant() (sim/step.js) - seeded in two places and
   defaulted in neither, the same rule pzrPlumbed()/pzrLive() already follow, or
   the bench shows one starting position and the plant commissions at another.
   Here rather than in the renderer because the SIM reads it and loads no UI. */
const startOf=(k,fallback)=>(D.start && D.start[k]!==undefined) ? D.start[k] : fallback;

/* Gross cycle efficiency. The reactor sets the ceiling - a 1700 K salt loop can
   drive a far better cycle than a 559 K boiler - and the turbine you buy decides
   how much of that ceiling you actually capture. One function, because the bench
   previews it and commission() bakes it; two formulas would drift apart.
   The multiplier is centred on 1.0 so the default turbine delivers exactly the
   architecture's own figure. */
/* COUNTED. D.turb sizes ONE machine; how many of them there are is read off
   the grid (turbCount(), layout.js), so a second turbine buys a second
   machine's swallow rather than nothing at all - and no turbine is exactly
   zero, which is what the bench warning is about. Efficiency itself is a
   property of the STEAM, not of how many machines take it, so only the
   ceilings below are counted. */
const grossEff  = () => COOLANT[D.cool].eff * (0.92 + 0.16*D.turb);
/* How much steam the turbine can swallow, and how much the condenser can turn
   back into water. They are separate on purpose: overload past the condenser and
   the output is there but the backpressure eats it. */
const loadCeil  = () => turbCount() * (1.05 + 0.40*D.turb);
const condCeil  = () => condCount() * (0.85 + 0.35*D.condCap);
/* When the pair is mismatched enough to matter. A condenser is normally sized for
   about full load and a brief overload is bought with backpressure, so a gap is
   not a fault - only a gap wide enough to cost roughly 15% of output is. One
   threshold, read by both the bench warning and the condenser panel prose. */
const condShort_ = () => loadCeil() - condCeil() > 0.26;

/* ══════════ HOW MODERATED THIS CORE IS ══════════
   Three numbers that used to be columns of the REACTOR TYPE list. They are
   measured off the drawing instead, out of the one ratio modRatio()
   (lattice.js) reports: moderating volume over fuel volume.

   modTherm() turns that ratio into how thermal the spectrum is - 0 is a bare
   fast core, 1 is fully thermalised - and everything below hangs off it.

   aV is the prize and it is three terms, not a typed number:
     - voiding takes the COOLANT's share of the moderation away, so the
       spectrum hardens by whatever modTherm() loses. Negative in water.
     - the coolant is also an ABSORBER, and taking an absorber out is
       positive. In a graphite core that term is the whole story, which is
       where RBMK's +1500 comes from.
     - a spectrum that is already fast hardens further on voiding, which is
       positive too and is why a sodium core is positive without any graphite.
   AV_MOD/AV_ABS/AV_FAST are solved together against the PWR, LWGR and SFR
   rows the old table carried; they are the plan's one fitted shape.

   critK is the second: with no moderator the fission cross-section collapses,
   so a fast core needs far more excess reactivity to reach critical. It is
   normalised on CRIT_REF - the moderation a stock water lattice has - so a
   well-moderated core reads exactly 1 and buys the fuel it paid for. */
const MOD_HALF=1.0, LAM_FAST=4.0e-7, LAM_TH=8.0e-5;
const AV_MOD=3715, AV_ABS=783, AV_FAST=660, AM_K=67;
const CRIT_H=0.04, CRIT_REF=2/3;
const modTherm = mr => mr/(mr+MOD_HALF);
const critK = mth => Math.min(1,(mth/(mth+CRIT_H))*((CRIT_REF+CRIT_H)/CRIT_REF));

function derived(){
  const a=COOLANT[D.cool],f=FUEL[D.fuel],rf=REFL[D.refl];
  const dens=a.dens*f.densK*(1.15-0.15*D.pitch);
  const coreMass=D.power/dens*22*(0.8+0.2*D.hd);
  /* latMass() replaces two table entries that used to stand in for drawn
     things: the reflector's flat catalogue figure, and a rod-worth surcharge
     that priced a number rather than the clusters that made it. Both are now
     weighed - volume times density, ring by ring - and a single ring of real
     steel round a real core comes to rather more than the 28 t the option list
     sold. That gap is a finding, not a rounding error. */
  /* A part fittableList() (layout.js) can remove is not on the grid at all when
     unfit, so it charges no mass either - the same "not there" the box on the
     plant already draws. contRel folds the same fallback into the one number
     the warning below and commission()'s contRel both read, so NONE and
     "never fitted" price and warn identically without saying so twice. */
  const contRel=D.contFit?CONT[D.cont].rel:1;
  /* Every pump on the grid costs its own capacity in mass (totalPumpCap(),
     layout.js - sums pumpCap() over every "pump"+ part, static and placed
     alike), replacing the old flat PUMPS[D.pumps] tier. Every generator on
     the grid costs SGT[D.sg].mass of its own (sgCount(), layout.js) - the
     old D.loops*34 flat lump priced neither the pump (totalPumpCap() already
     does) nor the generator (SGT[D.sg].mass was only ever charged once for
     the whole plant); a 4-loop plant used to carry one generator's steel.
     fittingMass() charges per fitting INSTANCE off its own bore, the same
     way tankMass() charges per tank - a spool piece and a valve body, so a
     tee is not free redundancy and a full-bore one is not free either. */
  const mass=a.mass+f.mass+SCRAM[D.scram].mass+CHAN[D.chan].mass
    +totalPumpCap()*PUMP_MASS+sgCount()*SGT[D.sg].mass+(D.contFit?CONT[D.cont].mass:0)+BKP[D.bkp].mass
    +coreMass + (D.pdes-1)*220 + (D.pzr-1)*45 + D.chim*38
    /* Every term here names a BOX on the grid. tankMass() charges per tank
       INSTANCE, off its own vol, so four tanks cost four tanks and there is
       no flag anywhere pricing a system with nothing drawn behind it. */
    + partMass("catcher") + tankMass() + fittingMass()
    + (D.rps?55:0) + FOLL[D.foll].mass + (D.nbank-4)*9
    + (D.autorod?26:0) + turbCount()*D.turb*50 + condCount()*D.condCap*40
    + ihxCount()*IHX_MASS
    + layMass + latMass();
  /* MEASURED, not bought. The pitch correction the old line carried
     (aM*(2-D.pitch), aV+900*(D.pitch-1)) is gone because pitch is already
     inside modRatio() - it is how much coolant sits between the assemblies. */
  const mr=modRatio(), mth=modTherm(mr), Lam=LAM_FAST*Math.pow(LAM_TH/LAM_FAST,mth);
  const aM=-AM_K*mth*modCoolShare();
  const aV=AV_MOD*(modTherm(modRatio(true))-mth)+AV_ABS*modAbs()
          +AV_FAST*Math.pow(1-mth,3)+rf.dV;
  const leak=500*Math.pow(D.hd-1,2)*(D.hd>1?1:.6);
  const excess=f.excess*critK(mth)+rf.dRho-D.poison-leak;
  /* DNBR no longer rises 5.25% per generator for free. Flow is SOLVED (the
     pipe network, pipenet.js), so thermal margin already follows what is
     actually built and piped - a count sitting on top of that would be a
     second, contradictory opinion about the same flow.
     The SCALING is gone (D.loops no longer exists to scale against); the
     0.95 is not a new fit, it is the old formula's own value at the stock
     one-generator baseline (1+.05*(1-2) = 0.95), kept flat so the pinned
     stock figures (derived().dnbr 1.7575, s.dnbr 1.83 at rest) do not move.
     A design with more generators no longer buys anything for free - every
     count now reads the identical 0.95, where the old table gave a 4-loop
     plant 1.10. DNBR is read off s.dnbr (step.js) at run time, off the real
     solved flow, for anything beyond this fitted baseline. */
  const dnbr=a.dnbr*(.55+.45*D.pitch)*Math.pow(D.pdes,.35)*0.95;
  /* peaking is no longer a curve fitted to H/D: it is the peak of the flux
     shape this core actually settles into, solved on the nodal mesh */
  const core=corePredict({dens,rf});
  const Fq=core.FqCold;
  /* Same argument as DNBR above: graceK no longer buys 12% per generator for
     free. Grace time is how long the core survives with no primary flow at
     all, which is a property of the coolant family and the SG type, not of
     how many of them are on the grid - deleted, not replaced with a count.
     The SG term is sgInertiaK(), shared with commission(). */
  const graceK=a.grace*sgInertiaK();
  const xeW=2700*a.xe;
  /* The bank S-curve, written once: how much worth is bought by inserting to x.
     boronOp and the shutdown margin below both read it, so they cannot drift. */
  const rodS=x=>D.rodw*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
  const boronOp=-(excess-rodS(RODX0)-xeW);
  /* ── SHUTDOWN MARGIN ──
     Measured against the state a tripped core actually drifts into, not fitted
     to one. Three things move after a scram and then keep moving:
       - the bank travels from its operating position to fully in, which is only
         the worth it had not already spent,
       - the equilibrium xenon the plant was commissioned with decays away, and
         every pcm of that poison comes back as POSITIVE reactivity,
       - the fuel cools from operating temperature down to the coolant, and
         Doppler hands that back too.
     The old number was a polynomial in rod worth and the feedback coefficients
     that touched none of this. It sold margin that did not exist: a default PWR
     read +454 pcm and went critical again, bank fully inserted, about three
     minutes after a scram, then wrecked itself.
     Rods alone are not expected to win that argument - on a real plant they do
     not either, which is what the boron system is for. So the honest number is
     reported twice: what the bank holds on its own, and what it holds with the
     chemical system driven to its 6000 pcm limit. The first is a warning, the
     second is the one that decides whether the design is buildable at all. */
  const dopBack=Math.abs(a.aF)*320*f.condK;      // Doppler released as the fuel cools
  const sdm=rodS(1)-rodS(RODX0)-xeW-dopBack;     // bank only
  const sdmB=sdm+(6000+boronOp);                 // bank plus everything the boron system has left
  const eff=grossEff(), loadMax=loadCeil(), condCap=condCeil(), condShort=condShort_();
  return {a,f,rf,dens,mass,over:mass>BUDGET,aM,aV,Lam,mr,mth,excess,dnbr,Fq,xeW,core,
    boronOp,sdm,sdmB,leak,eff,loadMax,condCap,condShort,
    grace:graceK*25/Math.sqrt(D.power/1200)*(1+.4*D.chim),
    beta:f.beta,scram:SCRAM[D.scram].rate,P0:a.P0*D.pdes,
    /* Third element is the component the warning is ABOUT, for the bench's
       per-component warning circle - null when no single component owns it
       (a whole-design figure like mass or shutdown margin). */
    warn:(()=>{const w=[];
      if(mass>BUDGET) w.push(["HARD","Over the "+BUDGET+" t mass budget by "+(mass-BUDGET).toFixed(0)+" t.",null]);
      if(sdmB<200) w.push(["HARD","Even full boration holds this core down by only "+sdmB.toFixed(0)+" pcm after a trip. Nothing on the plant can shut it down and keep it down - add control bank worth or burnable poison.","rods"]);
      else if(sdm<200) w.push(["SOFT","The bank alone holds this core down by only "+sdm.toFixed(0)+" pcm. Once the xenon decays after a trip the core goes critical again with the bank fully inserted. You must borate after every scram; full boron is worth "+sdmB.toFixed(0)+" pcm of margin.","rods"]);
      if(boronOp<-6000) w.push(["HARD","Boron demand "+boronOp.toFixed(0)+" pcm exceeds the 6000 pcm chemical system. Add burnable poison or drop enrichment.","core"]);
      /* THE SAME QUESTION FROM THE OTHER SIDE. boronOp is what the chemical
         system has to hold DOWN to sit critical at the commissioning bank
         position; positive means it would have to hold the core UP, and
         nothing can. A fast core reaches this on low-enriched fuel because
         critK collapses with the moderation - which is the consequence the
         spectrum was always supposed to carry and never did. */
      else if(boronOp>0) w.push(["HARD","This core is "+boronOp.toFixed(0)+" pcm short of critical with the bank at its commissioning position. There is nothing to take out - buy higher enrichment, remove burnable poison, or moderate it.","core"]);
      if(aV>0) w.push(["SOFT","Positive void coefficient ("+aV.toFixed(0)+" pcm). Steam in the core ADDS power. This is the Chernobyl feedback loop.","core"]);
      if(aM>0) w.push(["SOFT","Positive moderator coefficient. The lattice is over-moderated: heating the coolant raises power instead of lowering it.","core"]);
      if(dnbr<1.4) w.push(["SOFT","Thermal margin only "+dnbr.toFixed(2)+" DNBR. Very little headroom above rated power.","core"]);
      if(f.beta<400) w.push(["SOFT","Beta "+f.beta+" pcm. Prompt criticality is half as far away as with uranium fuel.","core"]);
      if(contRel>0.5) w.push(["SOFT","No containment. Any fuel damage releases straight to the crew.","cont"]);
      if(D.bkp===0) w.push(["SOFT","No backup power. A blackout stops the pumps entirely.","bkp"]);
      if(!turbCount()) w.push(["SOFT","No turbine on the plant. This design generates no electricity at all.","turb"]);
      else if(!condCount()) w.push(["SOFT","No condenser on the plant. The turbine has nowhere to exhaust steam to, so it does no work either - no electricity.","cond"]);
      if(loadMax<1.10) w.push(["SOFT","The turbine draws at most "+(loadMax*100).toFixed(0)+"% of rated. In combat the reactor will be able to make power this machine cannot take.","turb"]);
      if(condShort) w.push(["SOFT","The condenser handles "+(condCap*100).toFixed(0)+"% but the turbine can draw "+(loadMax*100).toFixed(0)+"%. Overload past the condenser and backpressure takes output back off you, while the reactor goes on making the heat.","cond"]);
      if(FOLL[D.foll].tipRho>0 && aV>0) w.push(["SOFT","Graphite followers on a positive-void core. Inserting the bank pushes graphite through the bottom of the core, which ADDS reactivity there before the absorber removes any. A scram from a withdrawn bank is an excursion, not a shutdown.","rods"]);
      if(core.cz<0.35) w.push(["SOFT","Loosely coupled core (axial coupling "+core.cz.toFixed(2)+"). It is tall enough that one end can drift without the other noticing, so xenon can oscillate top to bottom on its own.","core"]);
      if(Fq>3.0) w.push(["SOFT","Peaking factor "+Fq.toFixed(2)+". The hottest spot runs at "+Fq.toFixed(1)+"x the core average, and DNBR is set by that spot, not by the average.","core"]);
      if(!D.rps) w.push(["SOFT","No reactor protection system. Nothing will scram this core for you - not high flux, not low DNBR, not a dry loop. Every trip is yours to call by hand.","ctrl"]);
      /* Buildable, not blocked - same standing as "no RPS" above. Topological
         only (hasHeatSink(), layout.js): Stage 6 is what would let this warning
         read the loop rather than just its wiring. */
      if(!hasHeatSink()) w.push(["SOFT","This design has no heat sink. Nothing wired to the primary loop removes heat from it.",null]);
      return w;})()};
}
