# Backlog

**NOTHING IS ADDED WITHOUT BEING ASKED FOR. ANYWHERE.** A line here, a row in `fidelity.md`, a
knob, a block, a file, a section, a rule: if nobody asked for it, it is not written. Say what you
would add, in the reply, and wait. This holds even when the addition is obviously correct, even
when it only records something true, and even when it is one line. Adding it and reporting it
afterwards is not asking.

Two groups. **Physics** is always picked up before anything in **Other**: a job whose defect is in
the physics (a law, a property, conservation, a solver) goes under Physics; a preset, a build, a
tool or a screen goes under Other. One line each, starting with the date it was added. No prose,
no cross-references, no successors. A line becomes a plan only when it is picked up. A line that
turns out to be a distance from a real machine rather than a job belongs in `fidelity.md` instead.

Newest date first within each group. Dates are `dd/mm/yy`.

A figure in a line below that the simulation produced is a record, not a reference. Every job is
tested against real-world physics only, never against a previously saved simulation number.


## Physics

- 20/09/26 - Credit the bleed the expansion work from throttle to extraction pressure and put `COOLANT[].eff` back to a real isentropic efficiency; every preset's MWe moves.
- 20/09/26 - plan-batch-m landed (pressurizer 35 kW/m3, per-coolant bypass, 190 s rod reference, SINK_MARGIN 1.0, turbine water damage); open consequences live in the fidelity rows: BN-600/MSRE trip at tick 0 on the suggested sink, CALDER HALL no longer holds rated on the published drive.
- 20/09/26 - Helium and sodium still carry dissolved boron: only CO2 states `boron: false`, so an HTGR or BN-600 core is commissioned borated and its boron system still acts on a coolant that cannot hold boron.
- 20/09/26 - A steam generator shell raises saturated steam only; Calder Hall superheated its H.P. steam to 313 C at 210 psia, and the missing superheat is part of CALDER HALL's MWe miss.
- 20/09/26 - A fuel slot cannot hold moderator, so the gas between the bars in a slot stands where Calder Hall had graphite: the drawn core carries 375 t of graphite against ~620 t estimated for the real active core.
- 20/09/26 - The dispersal threshold `E_DISP_H` (280 cal/g) is a UO2 figure and is applied to every fuel, metal included.
- 20/09/26 - CALDER HALL drifts at rest with rods held: 2.13 pcm and 0.46 % of heat in 3 s (20/09/26), T-avg 1.1 K over its commissioned value on tick 1; likely the core seeding its gas on the row's one c_p while the loop runs on Shomate, unconfirmed.
- 19/09/26 - Nothing damages fuel for passing `tdmg`: only the RPS trip and the gas margin read it, so a U metal core past its 942 K alpha-beta change, or a UO2 core past 1500 K, loses nothing until the can fails or the fuel melts.
- 19/09/26 - Helium's `gam` falls back to steam's 1.3 (`GAM_VAP`) because the HTGR row states none; real helium is 1.667, and the choked-gas discharge reads it.
- 19/09/26 - `FLUID.temp` is labelled display-only but seeds a tank's enthalpy at commissioning.
- 19/09/26 - No samarium-149: a real core carries about -700 pcm of it at equilibrium, and after a shutdown it climbs and never decays away (promethium-149 feeds it, it is stable). The kinetics carry xenon and iodine only.
- 19/09/26 - Failed cladding releases nothing: the `FUEL DAMAGE` alarm text says fission products enter the coolant, but no state carries an activity in the water or the room.
- 18/09/26 - `ST.sc[SC_NAT]` (the thermosiphon walk, `eNetNat()`) swings about 1 % between two preset-0 runs whose inputs differ only at rounding level (6.3e-3 worst over 3000 ticks) while every other state field stays within 1e-6, well past its own `E_NAT_TOL` 1e-3. Chased 20/09/26 (`tools/natsplit.js`): NOT REPRODUCED on the clean tree. Two engines forced byte-identical then split by exactly 1 ulp in one node's `ST.hBy`, replayed pass by pass through a blackout to 3000 ticks: worst split `SC_NAT` 3.377e-10, `Tavg` 1.167e-11, `P` 1.149e-10, six orders inside `E_NAT_TOL` and never more than 3x the other fields'. The amplifying branch is named and is live - `eNetCoreLoop()`'s convergence test (`net.js:807`) stops `eNetNat()`'s 8-pass fixed point the instant it passes, so a run landing on the far side of the threshold on one pass instead of the next takes a less-relaxed answer; the pass count did move 4-5-6-5-4 across the transient, but both runs took the identical count at all 120 recompute events. Not checked: other perturbation sites, other presets, multi-loop or two-phase transients, or whether the original two runs differed by something other than a rounding-level input.
- 11/09/26 - The room's gas is isothermal at a ballasted cell temperature, so a concentrated charge's static pressure collapses as its gas spreads: 5 MPa BLAST in the stock containment reads 29 kPa at 1 s against a constant-volume 188 and breaks no wall; a gas temperature of its own, relaxing to the ballast, is the job, and it needs deciding first. Model defect.
- 11/09/26 - The BLAST tool's damage is judged only on the tick of the act (`ST.sc[SC_ROOMBANG]` is zeroed every tick): a 2000 kPa charge three cells from `pump0` reads 18.5 kPa inside it on that tick and wrecks 2 parts, and the next charge's tick judges the whole room on what is still ringing and wrecks 225, so a front that arrives after its own tick never breaks anything and 11 of 24 wreck sets point toward the charge; a model defect, not a preset reading.

## Other

- 19/09/26 - The paint-garbage sweep (`tools/framealloc.js`, `tools/paintsig.js`) covered OPERATE on the stock plant only; the design, scenario and help screens have not had it.
- 10/09/26 - BWR/4 as a direct cycle: its drum is the VESSEL itself, a steam nozzle on the core's own node, which `separates()` already covers - a different node from `drumIds()`, which only answers for a tank.
- 08/09/26 - PUMP RATED FLOW and SG TRANSFER COEFFICIENT are the two figures `designBake()` will not state (`keep`). Pump flow, because `pumpBoxCap()` reads the STORED flow and the box grows under pipework already routed round it: measured on BWR/4 the circulating water pump (12529 kg/s) goes 3x5 to 4x6 (re-trace unchecked); SG UA for a different reason, that commissioning walks an unstated UA onto rated power (`eSettleUA()`) and a stated one stands the trim down (stock: UA 55314 stated vs 45701 walked kW/K, node mass moved 83 kg).
- 07/09/26 - The three-circuit BN-600 preset is written and no preset sets it: `buildStockPlumbing({inter:true})` places the exchanger, the intermediate pump and its expansion tank and forms the circuits with the barrier intact, and at `loops:1` it lays clean and flies 300 s, but the exchanger passes 15-18 MW against a rated 1176, the shell never leaves its 421.5 K seed and the plant makes 0 MWe. At `loops:3` it is 3 runs refused and 6 dangling ends, 0 orphans (re-measured 07/09/26 on the router; it was 4 butted ports and 106 orphaned cells). A chain of stages is already carried by `ihxFeeds()`, `nodeGraph()` and `circName()` unchanged, but nothing on the board will fly one.
