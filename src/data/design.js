"use strict";
/* design parameters and the derived() model */

/* ═══════════════ DESIGN DATA ═══════════════ */
/* Prompt fission energy fraction: the rest arrives as decay heat, which is why
   DEC_A sums to 6.4 %. One constant, because two copies drift. */
const PROMPT_F=0.935;

/* ── WHAT THE FLUID IS ──
   This used to be ARCH, a REACTOR TYPE: thirteen columns that decided the
   whole feel of the plant, moderation included, off one list row. The three
   columns that said how MODERATED the core is - aM, aV and Lam - have left,
   because moderation is a property of the drawing and derived() measures it
   off the lattice now (modRatio(), lattice.js). What is left is the coolant
   itself: what pressure it wants, where it boils, how well it slows a neutron
   and how much it eats.

   qpp is the surface heat flux this fluid's own law allows at rated flow,
   MW/m2, and it is one of the two ceilings the core is RATED on (latQLim(),
   lattice.js). It replaced a kW/L column: power per litre was bought, so the
   peaking factor measured on the mesh decided nothing. Power density is a
   readout of the rating now. `dens` stays because it is the fluid's own
   density stand-in (rhoDesign(), pipenet.js) and always was.

   modK is moderating power per unit volume against light water, absK the
   same for absorption. They are the only two new columns, and they are what
   makes voiding a graphite core ADD reactivity while voiding a water core
   removes it - one expression, not a hand-typed +1500.

   Tref is what this coolant is PROGRAMMED at and dTf how far a pin sits above
   it at rated power - the PELLET MEAN, so sodium's 500 K and helium's 600 K are
   the same expression answering different fluids. commission() keeps
   saturation as the CEILING on Tref, never as the value, so BWR's 559 against
   559 commissions SATURATED and every high temperature family keeps its own.

   xe and dnbr stay bought on purpose: MSR's 0.15 xenon is online gas
   stripping and SFR's 3.20 DNBR is sodium's boiling margin. Neither is a
   shape you can draw.

   dnbLaw is WHICH LIMIT this fluid actually runs into, because DNB is not one.
   W-3 is stated for 1000-2300 psia and sodium at 0.2 MPa is 29 psia, so a
   clamped W-3 was giving water's pressure shape to a fluid that cannot boil
   at those conditions at all. A real sodium or salt core is limited by margin
   to COOLANT BOILING and a gas core by FUEL TEMPERATURE, so those are the two
   other laws (dnbrOf(), step.js). All three are margin ratios and all three
   are anchored to the dnbr column above by the same P.dnbrK, so no plant's
   rest point moves - only the shape off it.

   oxid says this fluid puts a STEAM ATMOSPHERE on hot clad, so zircaloy
   oxidation is reachable. It is a separate column from dnbLaw on purpose:
   that one names a thermal limit, and one column cannot mean two things.
   Present only where it is true, the way fuelInCoolant is.

   pipeK is what a metre of the PRIMARY is made of, against carbon steel at
   1.00, and it is spent per metre DRAWN (pipeWallK(), pipenet.js) - never as
   a flat lump on this row, which is the ARCH column this table exists to
   tc/pc/rhoc are the fluid's own CRITICAL POINT - K, MPa, kg/m3. Latent heat
   and both saturated densities have to fall to a known value somewhere, and
   until now that somewhere was water's for every fluid: satRvl() priced a
   sodium plant's steam space off 22.06 MPa and rhofOf() off 322 kg/m3. Water,
   sodium and helium are published; FLiBe has never been measured to its
   critical point and these are the usual Guggenheim-relation estimates.

   Sodium is 2.00 because a real sodium line is double-walled with
   trace heating over the guard pipe; salt is 2.40 for Hastelloy N on top of
   that same freeze protection; helium is 2.60 because a gas at 6 kg/m3 needs
   roughly twice the diameter for the same duty and wall area follows
   diameter. runBore() is untouched - a coolant may not move a conductance. */
const COOLANT=[
 {id:"PWR", name:"PRESSURISED WATER", tie:"WESTINGHOUSE / VVER", mass:340,
  P0:15.5,pipeK:1.00,col:"#5aa9d6",tsat:618,hfg:967,cp:5.5,dT0:30,mu:8.6e-5,muV:2.0e-5,vLeg:15,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:583,dTf:320,aF:-2.8,modK:1.00,absK:1.00,dens:100,qpp:1.80,grace:1.0,dnbr:1.85,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.33,solidK:1.4,
  good:"Dense, well understood, strongly self-limiting",
  bad:"15.5 MPa vessel is heavy; a breach depressurises violently"},
 {id:"BWR", name:"BOILING WATER", tie:"GE MARK I", mass:265,
  P0:7.0,pipeK:1.00,col:"#5aa9d6",tsat:559,hfg:1505,cp:5.5,dT0:30,mu:8.6e-5,muV:2.0e-5,vLeg:15,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:559,dTf:320,aF:-2.8,modK:1.00,absK:1.00,dens:95,qpp:1.71,grace:0.9,dnbr:1.55,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.33,solidK:1.5,
  good:"Direct cycle, lighter, power follows flow instantly",
  bad:"Turbine hall is radioactive; margin to dryout is thin"},
 {id:"LWGR",name:"PRESSURE TUBE WATER", tie:"RBMK-1000", mass:250,
  P0:6.9,pipeK:1.00,col:"#5aa9d6",tsat:558,hfg:1512,cp:5.5,dT0:30,mu:8.6e-5,muV:2.0e-5,vLeg:15,mmol:.018,tc:647.096,pc:22.06,rhoc:322,Tref:550,dTf:320,aF:-1.6,modK:1.00,absK:1.00,dens:55,qpp:0.99,grace:1.2,dnbr:1.60,dnbLaw:"w3",oxid:true,xe:1.0,flowMin:.30,eff:.31,solidK:1.5,
  good:"Cheap fuel, refuels online, boils in the channel itself",
  bad:"Lay graphite around it and the water is a poison, not a moderator"},
 {id:"SFR", name:"LIQUID SODIUM", tie:"EBR-II / BN-800", mass:210,
  P0:0.2,pipeK:2.00,col:"#c8b8a0",tsat:1150,hfg:4260,cp:1.25,dT0:170,mu:2.5e-4,muV:2.0e-5,vLeg:8,mmol:.02299,tc:2573,pc:25.6,rhoc:219,Tref:723,dTf:500,aF:-1.2,modK:.05,absK:.15,dens:280,qpp:5.04,grace:6.0,dnbr:3.20,dnbLaw:"boil",xe:0.85,flowMin:.20,eff:.40,solidK:1.4,
  good:"Atmospheric pressure, very light, huge boiling margin",
  bad:"Barely slows a neutron, so a core cooled by it is a FAST core"},
 {id:"MSR", name:"MOLTEN SALT", tie:"MSRE", mass:230,
  P0:0.2,pipeK:2.40,col:"#8fd18a",fuelInCoolant:true,tsat:1700,hfg:4500,cp:2.39,dT0:140,mu:6.0e-3,muV:3.0e-5,vLeg:5,mmol:.0433,tc:4500,pc:160,rhoc:460,Tref:922,dTf:200,aF:-3.5,modK:.35,absK:.18,dens:80,qpp:1.44,grace:9.0,dnbr:3.00,dnbLaw:"boil",xe:0.15,flowMin:.20,eff:.44,solidK:0.5,
  good:"No pressure; gases stripped online, almost no xenon pit",
  bad:"Corrodes continuously; freezes solid if it gets cold"},
 {id:"HTGR",name:"HELIUM GAS", tie:"HTR-PM", mass:260,
  P0:7.0,pipeK:2.60,col:"#c8a8d8",tsat:2000,hfg:20.9,cp:5.19,dT0:250,mu:4.5e-5,muV:4.5e-5,vLeg:60,mmol:.004,satN:.10,tc:5.195,pc:.227,rhoc:69.6,Tref:773,dTf:600,aF:-4.5,modK:0,absK:0,dens:6,qpp:0.108,grace:40,dnbr:2.60,dnbLaw:"temp",xe:1.0,flowMin:.15,eff:.42,solidK:0.009,
  good:"Cannot melt. Grace time in hours, not seconds. Voids into nothing",
  bad:"Moderates nothing at all - draw the moderator or draw a fast core"},
];
/* ── A FLUID'S OWN SATURATION CURVE ──
   satN used to be a typed .10 on every row: one curve shape for water, sodium,
   salt and helium. It is Clausius-Clapeyron about that fluid's own boiling
   point now - dlnT/dlnp = R*T/(hfg*M) - off the hfg and mmol columns beside it.
   satT() is a power law over a decade of pressure rather than the local slope,
   so ONE anchor turns the slope into the exponent, fitted on water against the
   SAT_WATER curve psatSec() already carries. SATN_REF is that curve's own
   point spelled out: 6.9 MPa, 558 K, 1512 kJ/kg, 18 g/mol.
   A row may still carry satN and override the lot. Helium does, because it is
   supercritical everywhere in this game - its tsat is a ceiling saying NEVER,
   not a boiling point, and C-C about a fiction produces a fiction. */
const R_GAS=8.314, SATN_REF={tsat:558,hfg:1512,mmol:.018};
const ccSlope = x => R_GAS*x.tsat/(x.hfg*1000*x.mmol);
const coolSatN = a => a.satN!=null
  ? a.satN : SAT_WATER.n*ccSlope(a)/ccSlope(SATN_REF);
/* ── WHAT YOU PACK BETWEEN THE ASSEMBLIES ──
   A moderator slot is a lattice slot with a block in it instead of fuel, laid
   with the same pen. modK is against light water; dens is what latMass()
   weighs the blocks you drew. aT is the block's own temperature coefficient,
   pcm/K, at full share of a thermal spectrum: graphite in a channel lattice is
   slightly positive, ZrH strongly negative (a TRIGA), BeO about nothing. */
const MODER=[
 {name:"GRAPHITE",modK:.95,dens:1.70,aT:3,
  note:"The classic solid moderator. Slows neutrons well over many collisions, so a graphite core is large and dilute - and the water in it becomes a net absorber, which is what makes a channel-water graphite plant void POSITIVE."},
 {name:"BERYLLIUM OXIDE",modK:1.35,dens:3.00,aT:0,
  note:"Better than graphite per litre and it multiplies neutrons on top, so a smaller core reaches the same spectrum. Heavy for what it is, and it pushes the void coefficient positive the same way the reflector does."},
 {name:"ZIRCONIUM HYDRIDE",modK:1.80,dens:5.60,aT:-12,
  note:"Hydrogen locked into a solid: the densest moderation you can lay, so a very compact thermal core is possible. It is also the heaviest, and hydrogen leaves it if it gets hot enough."},
];
/* tdmg is where THIS fuel starts taking damage, in K, and the RPS trips a
   fixed 100 K above it. It is a property of the fuel, not a fraction of a
   melting point: metal fuel runs cool and fails early, ceramic runs hot.
   tmelt is the PELLET's melting point and is a separate, much higher number -
   real UO2 melts near 3120 K and a U-Zr alloy near 1400 K, so the distance
   between clad failure and pellet melt is enormous on one fuel and almost
   nothing on the other. That distance is what the staged damage field spends.
   alpha is linear expansion, 1/K: a hot column grows and leaks neutrons, and a
   metal fuel grows nearly twice as much as an oxide, which is why the metal
   fuelled fast reactors survived their own unprotected transients. */
const FUEL=[
 {name:"UO2  3.2% LEU",beta:680,excess:6200,densK:.85,condK:1.0,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:0,
  note:"Low enrichment. The most forgiving kinetics you can buy at 680 pcm of delayed neutrons, but a short campaign and modest power density."},
 {name:"UO2  4.9% LEU",beta:650,excess:7200,densK:1.0,condK:1.0,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:8,
  note:"Standard commercial fuel. Balanced across every axis and the baseline everything else is measured against."},
 {name:"UO2 19.7% HEU",beta:640,excess:10200,densK:1.4,condK:1.0,alpha:1.0e-5,tdmg:1500,tmelt:3120,mass:-18,
  note:"Naval-grade enrichment. Far more excess reactivity and power density, so the core is smaller, but you need a lot of rod worth and boron to hold it down."},
 {name:"MOX PLUTONIUM",beta:300,excess:8500,densK:1.6,condK:1.0,alpha:1.1e-5,tdmg:1450,tmelt:3050,mass:-12,
  note:"Dense and hot. Beta collapses to 300 pcm, which halves the distance to prompt criticality. Every reactivity mistake is twice as fast."},
 {name:"U-ZR METALLIC",beta:640,excess:8000,densK:1.85,condK:.55,alpha:1.7e-5,tdmg:1150,tmelt:1400,mass:-25,
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
/* ══ A GENERATOR IS A SHELL AND A TUBE BUNDLE, AND THEY ARE PRICED APART ══
   `mass` was one tonnage per TYPE, so a shell built for 7 MPa and one built
   for 15 weighed the same and buying transfer coefficient was free steel.
   It is two terms now (sgSteelT(), layout.js):

     the SHELL follows its own water charge as a vessel, at the wall its
     design pressure needs - the same Barlow relation every pipe, tank and the
     reactor vessel already pay;
     the TUBE BUNDLE follows the UA it was bought for, the idiom
     IHX_T_PER_UA already uses on the exchanger.

   `tube` is what the BUNDLE weighs, in tonnes, and it stays a flat figure per
   type - see sgTubeT() (layout.js) for the measurement that says why pricing
   it off UA is wrong here. Fitted so an untouched plant weighs exactly what
   the flat figure gave it: 70 t U-tube and 42 t once-through, less each
   shell's own 6.7 t and 0.9 t at the stock design pressure. The two types
   stay as far apart as they were, and the difference now sits where it
   physically is - a once-through does the same duty in a far smaller shell. */
const SGT=[
 {name:"U-TUBE",water:55,tube:63.3,note:"Large secondary water inventory acts as a heat sink for minutes after feedwater is lost. Heavy and slow to respond."},
 {name:"ONCE-THROUGH",water:7,tube:41.1,note:"Very little water in it, so it responds instantly to load changes and boils dry almost as fast. Light."},
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
/* The MEAN over the generators drawn, never the sum: both readers are
   plant-wide flywheel terms over the whole primary, so a four-generator plant
   reading 4.0 would re-price every trip. The WATER half is already per
   instance in hotMass(), so nothing is charged twice. With no generators
   drawn - which the bench must answer - it falls back to the scalar row. */
/* THE REFERENCE IS THE STOCK U-TUBE'S OWN TOTAL, which SGT[0].mass used to
   BE. It is two terms now, so the figure is written here once rather than
   read off a row that no longer carries it - and it is what keeps a stock
   plant reading exactly 1.0, so every trip calibrated against that plant is
   untouched. */
const SG_MASS_REF = 70;
const sgInertiaK = () => { let n=0,m=0;
  for(const p of LAY.parts) if(p.role==="sg"){ m+=sgSteelT(p.id); n++; }
  return (n?m/n:SG_MASS_REF) / SG_MASS_REF; };
const BKP=[
 {name:"NONE",bk:0,mass:0,note:"Lose main power and the coolant pumps stop dead. Only natural circulation remains."},
 {name:"BATTERY BANK",bk:.5,mass:22,note:"Keeps one pump turning at half speed through a blackout."},
 {name:"DIESEL GENERATORS",bk:1.0,mass:58,note:"Full pump power independent of the plant. Heavy, and one more thing to maintain."},
];
COOLANT.forEach(a=>a.note=a.tie+". "+a.good+", but "+a.bad.replace(/^[A-Z]/,c=>c.toLowerCase())+".");
const BUDGET=3000;
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
/* THERE IS NO "IS IT FITTED" FLAG. Whether a containment, a turbine or a
   condenser is on the plant is whether one was PLACED (D.machines, layout.js);
   `cont` still says what TYPE you would buy, so removing one never forgets
   the other. Every box on the board is an instance in a dictionary on D. */
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
/* zoneFuel[z] is the FUEL row the ZONE pen's zone z is loaded with; D.fuel is
   zone 0's fallback, so an unzoned core is every slot in zone 0 and reads
   exactly as it always did. `??`, never `||`, or a legitimate zone 0 fails. */
const zoneFuelOf = z => D.zoneFuel[z] ?? D.fuel;
/* ══ AN ABSENT BAG KEY IS NOT THE DEFAULT WRITTEN DOWN ══
   massWith() (design-bench.js) prices an option row by writing the design and
   putting back what it read, and what it read through a plain {get,set} is the
   RESOLVED default - so merely drawing the rail minted D.zoneFuel[0],
   D.sgType[sg0] and D.radCoat[rad0] and sigFresh() called that a design edit.
   Commission off a URL (?preset=&tab=operate, url.js) and the bake happens
   before any bench frame, so the first visit to the bench moved P.dsig and
   recommissioned a plant nobody had touched. `raw` is the door back out: it
   answers undefined for a key that is not there, and set() deletes on it. */
const bagAcc = (bag,key,read,after) => ({
  get:read, raw:()=>bag[key],
  set:v=>{ if(v===undefined) delete bag[key]; else bag[key]=v; if(after) after(); }});
/* ══ THE DESIGN GENERATION. BUMP IT WHEN YOU EDIT A DESIGN TABLE ══
   The signature strings every layout cache proves itself against (pipeSig() and
   the four beside it, layout.js) are cached against this number, because a tick
   opens its own window and was rebuilding all of them 3000 times a second.
   THE CONTRACT: anything that writes D.pipes, D.ports, D.fittings, D.tanks, a
   FITTABLE flag or a part's x,y calls dTouch(). buildLayout() and moveTo()
   already do, which covers every gesture that goes through them. A direct field
   write from an inspector panel does not - so sigFresh() (layout.js) rebuilds
   every signature raw once a frame and bumps this by itself when it finds a
   change nobody declared. A missed dTouch() therefore costs one frame of stale
   drawing, never a wrong plant. Over-bumping costs a rebuild and nothing else:
   if you are not sure, bump. */
/* ══ THE ROD DRIVES, AS TWO REAL QUANTITIES ══
   ROD_SPD0 is the reference drive: 1.2 % of travel a second, an 83 s stroke.
   ROD_BANK_T is what one bank's gear weighs, and it prices BOTH of the things
   a bank costs - another bank, and a faster motor on every bank there is. The
   second is charged as a DELTA off the reference speed, the same way the bank
   count is charged off four, so an untouched design weighs exactly what it
   always did. */
const ROD_SPD0=0.012, ROD_BANK_T=9;
let DGEN=0;
const dTouch=()=>{ DGEN++; };
const D={cool:0,fuel:1,zoneFuel:{},mod:0,refl:1,poison:400,pitch:1.0,hd:1.0,power:1200,
         chim:.3,sg:0,
         scram:0,chan:1,rodw:2600,foll:0,nbank:4,rps:true,rpsm:.35,autorod:true,
         /* HOW FAST THE DRIVES WALK, fraction of travel per second, and it is a
            REAL QUANTITY like every other machine size on this ship. It was a
            constant in step.js, so every plant got a 83 s stroke whatever it
            was worth to it - and a fast core that answers a rod before you have
            finished moving it wants a faster motor than a graphite pile does.
            A motor that strokes twice as fast is twice the machine, so it costs
            ROD_BANK_T a bank on top of the bank's own gear (mass, below). */
         rodSpd:ROD_SPD0,
         /* How far the temperature controller may walk the bank on its own,
            as fractions inserted. Not a safety limit - it is what stops the
            controller wandering off the position the shutdown margin was
            measured from, so it is a commissioning decision and lives here
            rather than as two constants nobody could see or move. commission()
            carries it to P and resetPlant() to S, like every other tune. */
         arLo:0.10, arHi:0.70,
         /* THE HULL, in grid cells. Dragged from its own edges on the bench
            (gridDrag(), layout.js); GW/GH are these two resolved. */
         gw:60, gh:34,
         bkp:1,fittings:{},
         /* D.mat["x,y"] = {m:<material>, t:<mm>} - PAINTED STRUCTURE, cell-keyed
            and parallel to D.pipes, so a cell may carry both. There is no
            containment object anywhere: a containment is a closed shape in
            here, found by the fill (matRegions(), paint.js). */
         mat:{},
         /* ══ PER-INSTANCE QUANTITIES, IN REAL UNITS, KEYED BY PART ID ══
            EMPTY means "whatever this design suggests" - the suggestion is
            computed off the rest of the plant (layout.js), so an untouched
            design commissions on the figure the old slider midpoint stood for
            without that figure being written down anywhere. A typed number
            sticks: nothing here clamps, reverts or ranges. */
         turbKgs:{},          // kg/s of steam a turbine swallows wide open
         condUA:{}, condDump:{},   // kW/K of condensing duty; kg/s of bypass
         sgUA:{}, ihxUA:{},   // kW/K per transfer stage
         pumpHead:{}, pumpFlow:{}, // MPa developed, at kg/s
         sgType:{},radCoat:{},radArea:{},radUA:{},   // m2 of panel, and kW/K of its coolant side
         sgDesP:{},           // MPa - what each generator's own shell is built to hold
         bore:{},             // mm, per run key - a pipe is a diameter
         wall:{},             // mm, per run key - and it has a thickness, which is its rating and its mass
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
         /* D.machines[id] = {kind, cell:[x,y]} - every machine on the plant,
            the same shape D.tanks and D.fittings already have. A BLANK GRID is
            the default: nothing is on the ship because the code put it there.
            The stock ship is a preset (PLANTPRE, pipenet.js), and it is built
            out of the same gestures the bench hands the player. */
         machines:{}, name:{},
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

/* EVERY PER-INSTANCE FIGURE ON D, IN ONE LIST. A suggestion is BAKED on first
   read (bake(), layout.js), so a figure left behind from the last design
   prices the next plant off the last one's core - and a control position left
   behind commissions it in the last one's hands. Emptied in place, never
   rebuilt: the bags are read through D and a reassignment strands a holder. */
const DBAGS=["turbKgs","condUA","condDump","sgUA","ihxUA","pumpHead","pumpFlow",
             "sgType","radCoat","radArea","radUA","bore","start"];
/* and the scalars, taken before anything can edit them. A whole-plant preset
   states a handful of them, so every one it does not state has to be back at
   its own default or the plant carries the last design's containment, its
   protection setpoints and its rod worth. */
const DSCAL=Object.fromEntries(Object.entries(D).filter(([,v])=>typeof v!=="object"));
/* THE BAGS ALONE. A caller that has just WRITTEN the scalars it wants cannot
   use designForget(), which puts them back - and the derived bags still have to
   go, because bake() will have filled them from a half-built design in the
   meantime. Same emptied-in-place rule: a reassignment strands a holder. */
const designForgetBags=()=>{ for(const b of DBAGS) for(const k in D[b]) delete D[b][k]; };
const designForget=()=>{ designForgetBags(); Object.assign(D,DSCAL); };
/* BACK TO THE BLANK GRID. DSCAL is every scalar as it shipped, so everything
   left is a TABLE and D ships with every one of them empty - which is why this
   needs no list to keep up to date. Emptied in place, like the bags. */
const designClear=()=>{
  for(const k in D) if(typeof D[k]==="object") for(const j in D[k]) delete D[k][j];
  Object.assign(D,DSCAL);
};

/* Gross cycle efficiency. The reactor sets the ceiling - a 1700 K salt loop can
   drive a far better cycle than a 559 K boiler - and the turbine you buy decides
   how much of that ceiling you actually capture. One function, because the bench
   previews it and commission() bakes it; two formulas would drift apart.
   The multiplier is centred on 1.0 so the default turbine delivers exactly the
   architecture's own figure. */
/* COUNTED, and each machine carries its own swallow in kg/s (turbKgs(),
   layout.js); how many there are is read off the grid (turbCount()), so a
   second turbine buys a second machine's swallow rather than nothing at all -
   and no turbine is exactly zero, which is what the bench warning is about.
   Efficiency itself is a property of the STEAM, not of how many machines take
   it, so only the ceilings below are counted. */
/* SWALLOW-WEIGHTED, because efficiency is a property of the STEAM and the
   steam is split by what each machine can take. A big turbine swallows
   proportionally more of it and so carries proportionally more of the
   efficiency; a plain mean would let one tiny machine drag a big one down for
   free. Uniform sizes collapse to today's value exactly. */
const grossEff  = () => { let w=0,e=0;
  for(const p of LAY.parts) if(p.role==="turb"){
    const k=turbKgs(p.id); w+=k; e+=k*turbEffOf(p.id); }
  return COOLANT[D.cool].eff * (w>0 ? e/w : 1); };
/* How much steam the turbine can swallow, and how much the condenser can turn
   back into water. They are separate on purpose: overload past the condenser and
   the output is there but the backpressure eats it. */
/* Both as a share of WHAT THIS PLANT ACTUALLY MAKES - never of the core's
   rating, which the loop may not be able to carry. A matched machine reads
   exactly 1.00 and anything above it is overload somebody bought. The
   quantities themselves are kg/s and kW/K and live on the machines; these two
   are the only place a ratio is taken, and they take it against the same
   reference so condShort_() below compares like with like. */
const loadCeil  = () => totalTurbKgs()/Math.max(1e-9, plantSteam());
/* A RATIO, never a value. condUASuggest() is the UA this plant NEEDS, so this
   asks "does the condenser fitted match the plant it is fitted to" - which is
   a question about fit and is meant to move when either side changes. Nothing
   a machine OWNS is derived here. */
const condCeil  = () => totalCondUA()/Math.max(1e-9, condUASuggest());
/* When the pair is mismatched enough to matter. A condenser is normally sized for
   about full load and a brief overload is bought with backpressure, so a gap is
   not a fault - only a gap wide enough to cost real output is. One
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

   modEta() is the second, and it HAS A PEAK. modTherm() only ever rises, so
   more water was always more reactivity and no lattice could be drawn wrong
   in that direction. modEta is resonance escape times thermal utilisation,
   exp(-A/mr)/(1+B*mr): under-moderated on the left of the peak, over-moderated
   on the right, and the slope changes sign at it. MOD_A and MOD_B are solved
   once, off two stated figures - the peak sits at MR_PEAK and the stock water
   lattice reads ETA_STOCK of the peak - and they are the fit.

   modK() is what excess reactivity is scaled by, and it is the thermal chain
   PLUS a fast route: with no moderator the thermal chain collapses outright
   (exp(-A/mr) -> 0) and a fast core lives on fast fission alone, which is the
   FAST_RHO term over the same (1-mth)^3 weight aV carries. Multiplying the
   hump onto the old critK instead would have counted the same collapse twice
   and left every fast core at zero excess. A stock water lattice reads ~1 and
   buys the fuel it paid for; the best-moderated one reads about 5% more. */
const MOD_HALF=1.0, LAM_FAST=4.0e-7, LAM_TH=8.0e-5;
const AV_MOD=2286, AV_ABS=783, AV_FAST=660, AM_K=432;
/* EXP_RHO is reactivity per unit core strain at a bare fast spectrum, pcm.
   Fitted ONCE: BN-600's isothermal coefficient aM+aS lands near -3 pcm/K, the
   published band for a large oxide sodium core (-1 to -3, radial growth the
   largest term). Weighted by the same (1-mth)^3 aV carries, because leakage is
   most of a fast core's balance and next to nothing of a thermal one's. */
const EXP_RHO=42000;
/* ── IODINE AND XENON, ONE TABLE ──
   The four constants the field integrates (commission(), step.js) and the two
   readouts below are the same chain, so they live here together rather than as
   literals inside P. lam are per second; sigK is the burnout rate at rated
   flux in units of the xenon decay constant. XE_EQ0 is what equilibrium xenon
   is worth in a water core, pcm - the one fitted figure of the set. */
const XE={lamI:Math.LN2/(6.57*3600), lamX:Math.LN2/(9.14*3600),
          gI:.0639, gX:.00237, sigK:3.0};
const XE_EQ0=2700;
/* Xenon after a trip, as a MULTIPLE of the equilibrium it started from: the
   iodine in the core decays into xenon with nothing burning it, so the poison
   climbs for hours before it decays away. Walked once, on the curve's own two
   exponentials - there is a closed form, and the walk is the same arithmetic
   the tick does, which is why it is written this way. */
function xeAfter(hours){
  const li=XE.lamI, lx=XE.lamX, sig=XE.sigK*lx, t=hours*3600;
  const I0=(XE.gI+XE.gX)/li, X0=(XE.gI+XE.gX)/(lx+sig);
  const X=X0*Math.exp(-lx*t)+li*I0*(Math.exp(-li*t)-Math.exp(-lx*t))/(lx-li);
  return X/X0;
}
const XE_PEAK=(function(){ let x=1,h=0;
  for(let i=0;i<=48*4;i++){ const v=xeAfter(i/4); if(v>x){ x=v; h=i/4; } }
  return {x,h}; })();
/* The hours after a trip in which `avail` pcm still covers the xenon standing
   at that hour. Returns null when the pit never closes over the core at all
   (it can be restarted at any time) and 0 when it is shut from the start. */
function xeWindow(avail,xeW){
  if(avail>=xeW*XE_PEAK.x) return null;
  for(let h=0;h<=48;h+=0.25) if(avail<xeW*xeAfter(h)) return h;
  return null;
}
const MR_PEAK=3.2, MR_STOCK=1.6, ETA_STOCK=0.95, FAST_RHO=0.773;
const MOD_A=0.337502, MOD_B=0.036845;
const modTherm = mr => mr/(mr+MOD_HALF);
const modEta = mr => mr>1e-9 ? Math.exp(-MOD_A/mr)/(1+MOD_B*mr) : 0;
const ETA_S=modEta(MR_STOCK);
const modEtaN = mr => modEta(mr)/ETA_S;
/* the hump's own slope, as a fraction of stock eta per fractional change in
   mr. NOT divided by eta(mr): unnormalised it vanishes with the thermal chain,
   so a fast core reads no moderator coefficient rather than an enormous one. */
const modEtaSlope = mr => { const h=1e-6*Math.max(mr,1e-3);
  return mr*(modEta(mr+h)-modEta(mr-h))/(2*h)/ETA_S; };
const modK = (mr,mth) => modEtaN(mr)+FAST_RHO*Math.pow(1-mth,3);

function derived(){
  /* fuelBlend() (lattice.js) is the loading pattern collapsed into one row.
     d.f is exported wholesale, so every downstream reader of beta, excess,
     densK, condK, mass and tdmg follows from this one substitution. */
  const a=COOLANT[D.cool],f=fuelBlend(),rf=REFL[D.refl];
  /* THE PRIMARY'S SETPOINT, MPa, and it belongs to a MACHINE now: whichever
     hold tank stands on the core's circuit states it, and a plant with none
     is suggested its coolant family's own working pressure. D.pdes was a
     dimensionless 0.7-1.25x multiplier - the last hidden-reference span on
     the bench - and one machine's slider set physical properties of every
     other machine on the plant. pdesK is what the terms that genuinely scale
     with "how far above nominal is this design" read instead, so raising the
     setpoint still costs saturation temperature and DNBR margin, off a real
     pressure rather than off a number with no units. */
  const P0=holdSetP(nodeGraph().coreCirc), pdesK=P0/a.P0;
  /* A READOUT, kW/L: what the rating comes to over the core it was measured
     on. It used to be the coolant's own bought column and D.power followed it;
     the arrow runs the other way now (latRating(), lattice.js). */
  const dens=(LM&&LM.vol>1e-9)? D.power/LM.vol : 0;
  const coreMass=(LM?LM.vol:0)*22*(0.8+0.2*D.hd);
  const vesselMass=vesselShellMass(P0,a);
  /* latMass() replaces two table entries that used to stand in for drawn
     things: the reflector's flat catalogue figure, and a rod-worth surcharge
     that priced a number rather than the clusters that made it. Both are now
     weighed - volume times density, ring by ring - and a single ring of real
     steel round a real core comes to rather more than the 28 t the option list
     sold. That gap is a finding, not a rounding error. */
  /* ASKED OF THE FILL, not of a menu row and not of a box. A containment is a
     closed shape in the paint (matRegions(), paint.js), so "is there one" is
     "did a fill come back bounded" and what it holds back is its own wall's
     material. Nobody painted anything: no region, and the release goes
     straight to the crew - which is what NONE always meant and never said. */
  const conts=matRegionsBounded();
  const contRel=conts.length ? Math.min.apply(null, conts.map(g=>contRelAt(null, g.cells[0]%GW, (g.cells[0]/GW)|0))) : 1;
  /* Every pump on the grid costs its own capacity in mass (totalPumpCap(),
     layout.js - sums pumpCapOf() over every pump part, static and placed
     alike), replacing the old flat PUMPS[D.pumps] tier. Every generator on
     the grid costs its OWN type's steel (totalSgMass(), layout.js) - the
     old D.loops*34 flat lump priced neither the pump (totalPumpCap() already
     does) nor the generator (one generator's steel was only ever charged once
     for the whole plant); a 4-loop plant used to carry one generator's steel.
     fittingMass() charges per fitting INSTANCE off its own bore, the same
     way tankMass() charges per tank - a spool piece and a valve body, so a
     tee is not free redundancy and a full-bore one is not free either. */
  /* ══ THE REACTOR IS ONE MACHINE, AND IT IS ON THE BOARD OR IT IS NOT ══
     THE VESSEL WEIGHS ITS OWN WALL. (D.pdes-1)*220 was a delta off a
     dimensionless multiplier - no wall, no diameter, and worth nothing at
     all at the nominal it was measured from. The vessel is a cylinder with
     a real bore and the wall Barlow says it needs at the setpoint it is
     actually held at (wallSuggestMm(), pipenet.js), so raising pressure
     costs steel because steel is what it costs.
     (D.pzr-1)*45 is gone outright: the pressurizer is a tank and tankMass()
     already weighs it.
     The fuel, its cladding, the coolant, the vessel round it, the chimney over
     it, the reflector drawn beside it and the drives on its head are all ONE
     machine - so a ship with no vessel carries none of it. The lattice is a
     DRAWING (latMeasure(), lattice.js) and it exists whether or not anything
     stands on the arrangement grid; a drawing weighs nothing. Automatic rod
     control rides the drives (AUTOSYS.rod, step.js), so it goes with them. */
  const reactorMass = !roleOf("core") ? 0 :
      a.mass + f.mass + SCRAM[D.scram].mass + CHAN[D.chan].mass
    + coreMass + vesselMass + D.chim*38 + latMass()
    + FOLL[D.foll].mass + (D.nbank-4)*ROD_BANK_T
    + D.nbank*ROD_BANK_T*(D.rodSpd/ROD_SPD0-1)
    + (D.autorod?26:0);
  /* EVERY TERM HERE NAMES A BOX ON THE GRID, and now every one of them means
     it. tankMass() charges per tank INSTANCE, off its own vol, so four tanks
     cost four tanks; the protection system is a cabinet at the control
     station and the supply is its own box, so neither is priced with nothing
     drawn behind it. */
  const mass=reactorMass
    /* NO PAINT TERM HERE. layMass (layoutMetrics(), layout.js) already carries
       it - that is the PIPING+SHIELD line - and charging it again here billed
       every ship for its own structure twice. */
    +totalPumpMass()+totalSgMass()
    +(roleOf("bkp")?BKP[D.bkp].mass:0)
    + partMass("catcher") + partMass("vent") + tankMass() + fittingMass()
    + (roleOf("ctrl")&&D.rps?55:0)
    + totalTurbMass() + totalCondMass()
    + totalIhxMass() + totalRadMass()
    + layMass;
  /* MEASURED, not bought. The pitch correction the old line carried
     (aM*(2-D.pitch), aV+900*(D.pitch-1)) is gone because pitch is already
     inside modRatio() - it is how much coolant sits between the assemblies. */
  const mr=modRatio(), mth=modTherm(mr), Lam=LAM_FAST*Math.pow(LAM_TH/LAM_FAST,mth);
  const sh=modShares(), fast=Math.pow(1-mth,3);
  // coolant and blocks each carry their own coefficient over their share of the moderation
  const aM=mth*(-AM_K*modEtaSlope(mr)*sh.cool+MODER[D.mod].aT*sh.block);
  const aV=AV_MOD*(modEtaN(modRatio(true))-modEtaN(mr))+AV_ABS*modAbs()
          +AV_FAST*fast+rf.dV;
  /* Expansion, off materials and geometry. aX: the fuel column lengthens, one
     dimension, on the pellet's own temperature. aS: the grid plate grows in
     AREA (two dimensions) and the rod driveline lengthens and pushes the bank
     in, both on the coolant's temperature. The driveline needs no constant:
     strain over one core height, priced by the bank's own S-curve slope at its
     commissioning position. Its slow opposite, the vessel growing and lifting
     the bank OUT, is not modelled. */
  const driveline=-STEEL_A*D.rodw*(1-Math.cos(2*Math.PI*RODX0));
  const aX=-EXP_RHO*fast*f.alpha;
  const aS=-EXP_RHO*fast*STEEL_A*2+driveline;
  /* MEASURED OFF THE SHAPE, not off a curve in H/D: what the converged flux
     loses through the faces it has (coreLeak(), core2d.js). rf.dRho went with
     the curve - the albedo the same solve reads already puts the reflector in
     the shape, and the two were counted twice. */
  const core=corePredict({dens,rf});
  const leak=core.leak;
  const excess=f.excess*modK(mr,mth)-ZR_ABS*modClad()-D.poison-leak;
  /* peaking is no longer a curve fitted to H/D: it is the peak of the flux
     shape this core actually settles into, solved on the nodal mesh - and it
     is what the core is RATED on, so this is not a readout either */
  const Fq=core.FqCold;
  /* WHICH CEILING RATED THIS CORE, and how far the other one was clear. The
     margin at rated is PEAK_M by construction - that is what rating on the
     limit means - so the old fitted dnbr formula has nothing left to say and
     P.dnbr0 is the coolant's own W-3 level (dnbrOf(), step.js) directly. */
  const bind=latQLim(), dnbr0=a.dnbr;
  /* Same argument as DNBR above: graceK no longer buys 12% per generator for
     free. Grace time is how long the core survives with no primary flow at
     all, which is a property of the coolant family and the SG type, not of
     how many of them are on the grid - deleted, not replaced with a count.
     The SG term is sgInertiaK(), shared with commission(). */
  const graceK=a.grace*sgInertiaK();
  const xeW=XE_EQ0*a.xe;
  /* The bank S-curve, written once: how much worth is bought by inserting to x.
     boronOp and the shutdown margin below both read it, so they cannot drift. */
  const rodS=x=>D.rodw*(x-Math.sin(2*Math.PI*x)/(2*Math.PI));
  const boronOp=-(excess-rodS(RODX0)-xeW);
  /* ── WHERE THE PIT BOTTOMS, AND WHETHER YOU CAN CLIMB OUT OF IT ──
     The row used to be the EQUILIBRIUM worth, which is the poison the plant is
     already commissioned with and the one figure a restart never fights. What
     locks a restart out is the PEAK, hours after the trip, when the iodine
     that was in the core when it stopped has finished decaying into xenon and
     no flux is burning any of it. Both come off the same constants the field
     integrates (XE), so the readout and the tick cannot disagree.
     The WINDOW is the same curve asked the other way: the hours in which the
     core can still be taken critical on what it has - excess, less the bank it
     has to pull out of, against the xenon standing at that hour. */
  const xePit=xeW*XE_PEAK.x;
  const xeWin=xeWindow(excess-rodS(RODX0),xeW);
  /* ── SHUTDOWN MARGIN ──
     Measured against the state a tripped core actually drifts into, not fitted
     to one. Three things move after a scram and then keep moving:
       - the bank travels from its operating position to fully in, which is only
         the worth it had not already spent,
       - the equilibrium xenon the plant was commissioned with decays away, and
         every pcm of that poison comes back as POSITIVE reactivity,
       - the fuel cools from operating temperature down to the coolant, and
         Doppler and the column's own contraction hand that back too.
     The old number was a polynomial in rod worth and the feedback coefficients
     that touched none of this. It sold margin that did not exist: a default PWR
     read +454 pcm and went critical again, bank fully inserted, about three
     minutes after a scram, then wrecked itself.
     Rods alone are not expected to win that argument - on a real plant they do
     not either, which is what the boron system is for. So the honest number is
     reported twice: what the bank holds on its own, and what it holds with the
     chemical system driven to its 6000 pcm limit. The first is a warning, the
     second is the one that decides whether the design is buildable at all. */
  // what the core gives back from zero to full power: every coefficient on the pellet, over its own rise
  const pwrDef=(a.aF+aX)*a.dTf*f.condK;
  const dopBack=-pwrDef;                         // released as the fuel cools to the coolant
  const sdm=rodS(1)-rodS(RODX0)-xeW-dopBack;     // bank only
  const sdmB=sdm+(6000+boronOp);                 // bank plus everything the boron system has left
  const eff=grossEff(), loadMax=loadCeil(), condCap=condCeil(), condShort=condShort_();
  // trip backpressure over where this sink rests at full power: under 1 it trips at rest, under 1/DUMP_COND_K the dump is blocked
  const condMargin=TURB_TRIP_P/Math.max(COND_P0, psatSec(condRest(plantDuty()).condT));
  return {a,f,rf,dens,mass,over:mass>BUDGET,aM,aV,aX,aS,pwrDef,Lam,mr,mth,excess,dnbr0,bind,Fq,xeW,core,contRel,
    nCont:conts.length,
    boronOp,sdm,sdmB,leak,xePit,xeWin,eff,loadMax,condCap,condShort,condMargin,
    grace:graceK*25/Math.sqrt(D.power/1200)*(1+.4*D.chim),
    beta:f.beta,scram:SCRAM[D.scram].rate,P0,
    /* Third element is the component the warning is ABOUT, for the bench's
       per-component warning circle - null when no single component owns it
       (a whole-design figure like mass or shutdown margin). */
    warn:(()=>{const w=[];
      if(mass>BUDGET) w.push(["RED","Over the "+BUDGET+" t mass budget by "+(mass-BUDGET).toFixed(0)+" t.",null]);
      if(sdmB<200) w.push(["RED","Even full boration holds this core down by only "+sdmB.toFixed(0)+" pcm after a trip. Nothing on the plant can shut it down and keep it down - add control bank worth or burnable poison.","rods"]);
      else if(sdm<200) w.push(["SOFT","The bank alone holds this core down by only "+sdm.toFixed(0)+" pcm. Once the xenon decays after a trip the core goes critical again with the bank fully inserted. You must borate after every scram; full boron is worth "+sdmB.toFixed(0)+" pcm of margin.","rods"]);
      if(boronOp<-6000) w.push(["RED","Boron demand "+boronOp.toFixed(0)+" pcm exceeds the 6000 pcm chemical system. Add burnable poison or drop enrichment.","core"]);
      /* THE SAME QUESTION FROM THE OTHER SIDE. boronOp is what the chemical
         system has to hold DOWN to sit critical at the commissioning bank
         position; positive means it would have to hold the core UP, and
         nothing can. A fast core reaches this on low-enriched fuel because
         modK() collapses with the moderation - which is the consequence the
         spectrum was always supposed to carry and never did. */
      else if(boronOp>0) w.push(["RED","This core is "+boronOp.toFixed(0)+" pcm short of critical with the bank at its commissioning position. There is nothing to take out - buy higher enrichment, remove burnable poison, or moderate it.","core"]);
      if(aV>0) w.push(["SOFT","Positive void coefficient ("+aV.toFixed(0)+" pcm). Steam in the core ADDS power. This is the Chernobyl feedback loop.","core"]);
      if(aM>0) w.push(["SOFT","Positive moderator coefficient. Heating the moderator raises power instead of lowering it - an over-moderated lattice, or a graphite stack in one.","core"]);
      if(pwrDef>-100) w.push(["SOFT","Power coefficient only "+pwrDef.toFixed(0)+" pcm from zero to full power. Almost nothing in the fuel pushes back when power rises; the rods and the coolant are all that hold it.","core"]);
      if(f.beta<400) w.push(["SOFT","Beta "+f.beta+" pcm. Prompt criticality is half as far away as with uranium fuel.","core"]);
      /* WHAT THE FILL FOUND, in words. It could never say this before: the old
         line asked a menu index whether a box had been bought, so a wall with a
         hole in it and a wall drawn round the whole plant read the same. */
      const tightPainted=matCells().some(k=>{ const i=k.indexOf(",");
        return matWall(+k.slice(0,i),+k.slice(i+1)); });
      if(!conts.length) w.push(["SOFT", tightPainted
        ? "The gas-tight structure on this ship encloses nothing - every fill round it reaches the hull, so there is no containment. Close the shape, or accept that a release goes straight to the crew."
        : "No containment. Nothing painted on this ship is gas-tight, so any fuel damage releases straight to the crew - paint a closed shape in a gas-tight material to hold it in.",null]);
      else { const weak=conts.map(g=>{ let lo=Infinity, at=null;
               for(const i of g.wall){ const x=i%GW, y=(i/GW)|0, r=matRating(x,y);
                 if(r<lo){ lo=r; at=[x,y]; } }
               return {g,lo,at}; }).sort((a,b)=>a.lo-b.lo)[0];
             if(weak.at && weak.lo < MAT_PDES)
               w.push(["SOFT","The containment is walled for only "+weak.lo.toFixed(2)+" MPa at "+weak.at[0]+","+weak.at[1]+" - the middle of its longest flat side, against a "+MAT_PDES+" MPa design. Thicken the wall there, or draw the enclosure rounder so no cell is in the middle of a long span.",null]); }
      if(D.bkp===0) w.push(["SOFT","No backup power. A blackout stops the pumps entirely.","bkp"]);
      if(!turbCount()) w.push(["SOFT","No turbine on the plant. This design generates no electricity at all.","turb"]);
      else if(!condCount()) w.push(["SOFT","No condenser on the plant. The turbine has nowhere to exhaust steam to, so it does no work either - no electricity.","cond"]);
      if(turbCount() && loadMax<1.10) w.push(["SOFT","The turbine takes "+(loadMax*100).toFixed(0)+"% of the steam this plant raises at full power, so there is almost no overload left in it. In combat the reactor can be pushed past full power and this machine cannot take the extra steam. A bigger swallow buys the reach, and costs mass.","turb"]);
      if(condMargin<1/DUMP_COND_K) w.push([condMargin<1?"RED":"SOFT","The sink rests at "+(TURB_TRIP_P/condMargin).toFixed(4)+" MPa of backpressure against a "+TURB_TRIP_P+" MPa turbine trip"+(condMargin<1?", so the turbine trips before anything has happened":", so the steam dump is blocked at rest: a load drop goes to the shell safeties and the water does not come back")+". Bigger panels or a bigger condenser buy the margin.","cond"]);
      if(condShort) w.push(["SOFT","The condenser handles "+(condCap*100).toFixed(0)+"% of full-load duty but the turbine can draw "+(loadMax*100).toFixed(0)+"%. Past its duty it sits hotter, the exhaust pressure climbs and the turbine gives back part of what it made - continuously, not just in a transient. The reactor goes on making the heat either way.","cond"]);
      if(FOLL[D.foll].tipRho>0 && aV>0) w.push(["SOFT","Graphite followers on a positive-void core. Inserting the bank pushes graphite through the bottom of the core, which ADDS reactivity there before the absorber removes any. A scram from a withdrawn bank is an excursion, not a shutdown.","rods"]);
      if(core.cz<0.35) w.push(["SOFT","Loosely coupled core (axial coupling "+core.cz.toFixed(2)+"). It is tall enough that one end can drift without the other noticing, so xenon can oscillate top to bottom on its own.","core"]);
      if(Fq>3.0) w.push(["SOFT","Peaking factor "+Fq.toFixed(2)+". The hottest spot runs at "+Fq.toFixed(1)+"x the core average, and DNBR is set by that spot, not by the average.","core"]);
      if(!D.rps) w.push(["SOFT","No reactor protection system. Nothing will scram this core for you - not high flux, not low DNBR, not a dry loop. Every trip is yours to call by hand.","ctrl"]);
      /* Buildable, not blocked - same standing as "no RPS" above. Topological
         only (hasHeatSink(), layout.js): Stage 6 is what would let this warning
         read the loop rather than just its wiring. */
      if(!hasHeatSink()) w.push(["SOFT","This design has no heat sink. Nothing wired to the primary loop removes heat from it.",null]);
      /* THE SHIP HAS NO SKY WITHOUT THESE. The bench warns; it never refuses
         - the plant still runs, badly, exactly as it does with no containment.
         radTAt() is the same expression the tick integrates against, so the
         quoted temperature and the plant's own cannot disagree. */
      if(!radCount()) w.push(["RED","No radiator on this ship. Nothing rejects the waste heat, so the condenser will climb until it loses vacuum and the turbine trips.","cond"]);
      else {
        const blind=radIds().filter(id=>!radLive(id));
        for(const id of blind) w.push(["SOFT",partOf(id).name+" cannot see space. A panel with no face on the skin radiates nothing at all - move it against the hull, or it is dead weight and the plant loses the sink it was bought for.",id]);
        const tr=radTRated(eff);
        if(tr>RAD_TDES+1) w.push(["SOFT","The panels are short of rated rejection: at full power they sit at "+tr.toFixed(0)+" K against a design "+RAD_TDES+" K, which puts the condenser near "+psatSec(Math.min(tr+COND_DT0,500)).toFixed(4)+" MPa of backpressure and the turbine gives part of its work back.","cond"]);
      }
      return w;})()};
}

/* Three severities, one predicate each. HARD is the only one that refuses to
   commission - a machine standing where it does not fit answers every other
   question nonsense. RED is a fault the bench draws in red and still builds. */
const warnHard=w=>w[0]==="HARD";
const warnRed=w=>w[0]==="HARD"||w[0]==="RED";
