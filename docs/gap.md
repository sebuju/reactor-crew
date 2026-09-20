# Gaps — the short list, most important first

One line per open gap between this model and a real machine. This file is the INDEX. The detail,
the figures and the sources live in the `docs/fidelity.md` row or the `docs/backlog.md` line named
in the last column; when the two disagree, that row wins and this line is stale.

**The answer to "is all the physics implemented?" is this file, never "yes".**

Compiled 20/09/26 from: all of `docs/fidelity.md`, all of `docs/backlog.md`, the "Known gaps"
section of `docs/physics.md`, and one run of `node tests/physics/run.js` (627 pass, 31 stated gaps,
0 fail, nothing killed). **Not checked:** the code itself (except the inertia term), the rest of
`docs/physics.md`, anything no test covers. A gap nobody wrote down is not here.

A simulated figure below is a record of one run, not a reference.

**Importance is a judgement made 20/09/26, not a measurement.** The rule used:

- **CRITICAL** — conservation is broken, or the model does the opposite of the real machine.
- **HIGH** — the model is wrong by a large measured distance, or a term is missing that changes how
  an accident plays out, or something is wrong on every plant and nobody knows why.
- **MEDIUM** — a bounded, measurable distance on one feature; a bought number nobody checked; an
  unexplained reading that hurts nothing yet.
- **LOW** — a small distance, or a case no preset reaches.

**Size is a judgement made 20/09/26, not a measurement either**, and it is the size of the JOB, not
the size of the gap — a CRITICAL gap can be an S and a LOW one an L. The rule used:

- **S** — one number, curve, table column or knob; one file, no new state, nothing else moves.
- **M** — one term, gate or solver added inside the structure that already exists; a few files, and
  a diagnosis job whose answer is not yet known sits here until it is.
- **L** — new state or a new law: `SCHEMA` rows, a new pass in the tick, or a rewrite of how one
  subsystem works. Several files, and the presets have to be re-flown.
- **XL** — a subsystem that does not exist yet, reaching state, tick, UI and every preset.

Where two rows share one root cause, each carries the size of ITS OWN remaining work: the root gets
the L, the follower gets the S or M left over once the root lands.

**Batch is a letter, and it is a judgement made 20/09/26 too.** Rows sharing a letter share the
same file, the same law or the same re-fly, so taking them in one job costs little more than taking
one of them — the reading, the sourcing and the preset march are paid once. A letter groups, it
does not order: inside a batch the rows still land in importance order, and a batch may be taken in
part. The letters:

| batch | what it is |
|---|---|
| **A** | Room gas and blast — the gas pass in `src/eng/room.js`, the blast front, what it breaks |
| **B** | Room liquid and floor — `eLiqStep()`, the free surface, water on the floor |
| **C** | RBMK-1000 — its feedback, its pumps, its feed |
| **D** | Heat outside the fuel — the gamma split and the moderator's own temperature |
| **E** | CALDER HALL — its drawing and its drift |
| **F** | Heat exchange — the stage law, superheat, the film |
| **G** | Feed train and pump suction — NPSH, circuit resistance, commissioning's seed |
| **H** | Fuel damage and release — past `tdmg`, clad, pellet, what comes out |
| **I** | Neutronics and poisons — samarium, group shapes, the solved levels, the axial mesh |
| **J** | Coolant property tables — `COOLANT` and `FLUID` columns |
| **K** | Boiling and DNB — peaking, void, dryout |
| **L** | Network hydraulics — elevation, inertia, discharge, the tank's charge |
| **M** | Bought knobs and levels — one number each, no law behind them |
| **N** | Instruments — what a signal is read off, and whether it can lie |
| **O** | BWR/4 — the direct cycle and everything waiting on it |
| **P** | BN-600 — the intermediate loop and its steam |
| **Q** | Preset drawings and sizes — pressures, cycles, machine sizes |

**A gap is something that needs work. A deliberate cut is not a gap and is not listed here**; it
lives in `docs/fidelity.md` and nowhere else. A row there that was decided (no burnup, the 400× xenon
clock and what follows from it, the ×50 air heat capacity, the ideal-gas CO2, the sodium aerosol,
the BWR void expression left unfudged ...) owes nothing. The test run counts some of them among its 31
stated gaps (CO2 density at 400 K); they stay out of this file all the same.

Class: **MODEL** = the physics is wrong. **BUILD** = the preset's drawing is wrong. **FIT** = a
bought or solved number. **DRIFT** = nobody decided it. **UNKNOWN** = nobody knows why, or nobody
classified it.

Physics comes before presets, always, so the two are separate tables.

## Physics

| importance | size | batch | gap | distance | class | where |
|---|---|---|---|---|---|---|
| CRITICAL | L | A | Room gas is isothermal at a ballasted temperature | 5 MPa charge reads 29 kPa against 188; no wall breaks | MODEL | backlog 11/09/26; fidelity: the implicit step's front |
| CRITICAL | L | A | Blast damage is judged only on the tick of the act | a front arriving later breaks nothing; 11 of 24 wreck sets point at the charge | MODEL | backlog 11/09/26 |
| CRITICAL | L | C | RBMK-1000 with rods frozen at 100 % grows where the real one decays | e-folding 2.78 s | MODEL | fidelity: RBMK stability |
| HIGH | M | C | RBMK-1000 static power coefficient at 100 % | +0.43 pcm/% against a negative design figure | MODEL | fidelity: RBMK stability |
| HIGH | L | D | No gamma transport: heat in a big moderator cell is over-credited; structures, vessel and rods take none | RBMK graphite 9.8 % against 5.5 %; CALDER HALL 206 MWt against 182 | MODEL | fidelity: heat deposited outside the fuel |
| HIGH | M | G | Feed pump NPSH; the cavitation head cutback is not implemented | required 0.17–0.69 MPa, available ≤ 0.13 on every preset | MODEL | fidelity: what a feed pump has to suck against |
| HIGH | S | G | Circulating-water circuit has no resistance of its own | pump passes 1.19× its bought flow | MODEL | fidelity: the circulating water pump |
| HIGH | S | K | Boil margin uses flux peaking `Fq` where enthalpy-rise peaking belongs | conservative by ~1.6× | MODEL | fidelity: enthalpy-rise peaking |
| HIGH | M | H | Fuel passing `tdmg` takes no damage | nothing until can failure or melt | MODEL | backlog 19/09/26 |
| HIGH | XL | H | Failed clad releases nothing into the water or the room | no activity state at all | MODEL | backlog 19/09/26 |
| HIGH | S | J | Helium and sodium carry dissolved boron | a boron system on a coolant that holds none | MODEL | backlog 20/09/26 |
| LOW | S | G | Seed walk is diode-blind, so a hot node can commission behind a check valve | the 09/09/26 feed-header ring (16.58 MPa, 1.42× the run's rating) is GONE on re-measure 20/09/26: 10.3995 MPa, 0.89× rating, the node subcooled at 309 K. The walk in `eAdvectSeed()` still ignores `edDiode`, so the mechanism survives even though nothing exercises it | MODEL, latent | fidelity: the feed train at commissioning |
| HIGH | M | L | `SC_NAT` swings on a rounding-level input change | ~1 % | UNKNOWN | backlog 18/09/26 |
| MEDIUM | M | I | No samarium-149 | ~−700 pcm at equilibrium, climbs after shutdown | MODEL | backlog 19/09/26 |
| MEDIUM | L | F | A steam generator raises saturated steam only | Calder Hall: 116 K of superheat missing | MODEL | backlog 20/09/26; fidelity: superheated steam |
| MEDIUM | M | E | CALDER HALL MWe / efficiency | 52.3 / 0.253 against 42 / 0.231. SEPARATED 20/09/26: the missing superheat owns NONE of it (its sign is backwards - putting it in moves MWe to 59.3, further from 42). Rating excess 1.133 x efficiency excess 1.095 = 1.243 against a measured 1.245 | efficiency excess 100 % BUILD (the L.P. circuit is not drawn); the rating excess is MODEL on the heat-split row | fidelity: CALDER HALL against the real machine |
| MEDIUM | M | E | CALDER HALL gas flow | 1046 kg/s against 891 | MODEL | same |
| MEDIUM | S | E | CALDER HALL circuit pressure | 0.849 MPa against 0.791: confirmed 20/09/26 that the two are read at DIFFERENT POINTS — `sc[SC_P]` is the core node's own solved pressure, the sheet's 100 psig is `CO2.P0`/`circSetP`, a setpoint. So +7.4 % is not a measured distance | open until a same-point comparison is made; not MODEL | same |
| MEDIUM | M | E | CALDER HALL at rest, rods held, 3 s | 2.13 pcm, 0.46 % heat against 0 | MODEL, cause unconfirmed | fidelity: CALDER HALL at rest |
| MEDIUM | L | E | A fuel slot cannot hold moderator | Calder graphite 375 t against ~620 t | MODEL | backlog 20/09/26; fidelity: drawn rod pitch |
| MEDIUM | L | F | Steam generator stage against the exact variable-c_p law | 1237 MW against 1267 (−2.4 %); NUSCALE −2.55 % and EPR −2.77 % re-measured 20/09/26, both further out after the water table. Cost weighed: the exact quadrature is 11.3-11.8 ms per stage per tick against the secant's 1.8 µs, i.e. 900-1200 % of a whole 0.9-1.3 ms tick — a direct swap is not viable and a cache, fit or adaptive step is owed instead | MODEL, weighed 20/09/26 | fidelity: Steam generator effectiveness |
| MEDIUM | M | L | Flashing discharge near the critical pressure | 35 958 kg/s/m² against 40 380 (−11 %) | MODEL (omega's reach) | fidelity: Flashing discharge |
| MEDIUM | S | H | UO2 c_p above 2000 K | 28 % off against an 8 % band | MODEL | fidelity: fuel heat capacity |
| MEDIUM | S | H | Dispersal threshold `E_DISP_H` is UO2's, used on every fuel | metal fuel included | MODEL | backlog 20/09/26 |
| MEDIUM | S | J | Helium `gam` falls back to steam's | 1.3 against 1.667 | MODEL | backlog 19/09/26 |
| MEDIUM | M | H | MSR fuel gets clad burst, pellet melt and a UO2 pin | meaningless there | MODEL, small | fidelity: a molten-salt reactor's fuel |
| MEDIUM | M | D | Graphite has a temperature on RBMK only; MSRE and CALDER HALL blocks have none | their share reaches the coolant at once | MODEL | fidelity: graphite temperature |
| MEDIUM | M | K | No drift velocity in the drift-flux void | void −0.04 | MODEL | fidelity: ...and why it will not boil |
| MEDIUM | M | J | Non-water density curves read heavy at their operating point | 7–17 % | DRIFT | fidelity: ...and that shape |
| MEDIUM | M | M | `COOLANT[].eff` absorbs what a staged bleed would earn, so it is no longer an isentropic efficiency | bleed 33 % against 25–30 % | FIT | fidelity: the feedwater heating |
| MEDIUM | S | M | A turbine passing water takes no damage | no water-induction event | DRIFT | fidelity: a turbine with water in it |
| MEDIUM | L | N | No measurement noise; no instrument can fail | redundant channels protect against nothing | DRIFT | fidelity: the flux signal; an instrument channel |
| HIGH | S | L | A tank's gas charge is isothermal, a real one polytropic | measured 20/09/26 on a 13.08 s STOCK blowdown: at n=1.4 the model holds 48.2 % more pressure and delivers 60.6 % more water; at n=1.2, 20.2 % and 28.0 %. A safety injection over-delivers by a quarter to a half | MODEL (promoted off DRIFT) | fidelity: a tank's gas charge |
| MEDIUM | M | K | Dryout fires on a mass fraction, not on heat flux | corrected 20/09/26: `SX.fWet` is a BINARY GATE, not a linear fade — full duty to 99.9 % dry, then zero. The real collapse is 10-100x (nucleate 2e4-1e5 against film 1e2-1e3 W/m²K) triggered by wall superheat in a 100-150 K band. The error is the trigger, not the sharpness | DRIFT | fidelity: heat into a node that has lost its water |
| MEDIUM | M | J | Sodium pool burn rate, spray fraction, water reaction rate, wastage rate | bought, unchecked | FIT, low confidence | fidelity: sodium meeting air / water |
| MEDIUM | M | A | Blast break pressures (`pburst`) mostly unsourced | no published rung for cabinets, pipe, vessels | DRIFT | fidelity: what a blast breaks |
| HIGH | L | A | A breached wall mixes on a fixed linear conductance, not on buoyancy | target derived 20/09/26 from Brown & Solvason (1962) vertical-opening exchange flow: a 2.80 x 4.00 m six-cell breach passing 443.2 kW of decay heat should hold **62.4 K**; the model holds **4.5 K**, 57.9 K cold. `ROOM_MIX`'s fixed ~84 kW/K per open cell-pair (~500 kW/K over six) swamps the real ΔT^1.5 buoyancy term at any plant-relevant gap | MODEL, structural | fidelity: what a breached containment does to the heat |
| MEDIUM | M | A | Blast near field stays in the charge cell; `ROOM_TMAX` caps the dial | region peak 10 kPa off a 5 MPa charge | MODEL, not weighed | fidelity: what the BLAST fault injects |
| MEDIUM | M | K | DNB level is bought (`P.dnbrK` on a `COOLANT.dnbr` column) | level unmeasured off rest | FIT | fidelity: departure from nucleate boiling |
| MEDIUM | S | C | Feed temperature 490 K on RBMK against ~438 K | subcooling ~6 K short | DRIFT | fidelity: a boiling core's rated flow |
| MEDIUM | M | L | BN-600 `n` moved after the core-inlet change | +1.15 %, named 20/09/26: the FIELD INLET term, not the lag and not the preset's own drift (own drift 0.0155 %, 74x smaller; field held off moves `n` +5.75 %) | MODEL | fidelity: the core inlet, off the field |
| MEDIUM | M | L | `loopHeadOf()`'s `dpOf()` carries no elevation term | MSRE's 25 % is explained 20/09/26: every leg is off and most cancels; the round-loop hydrostatic residual is +0.051 MPa, the whole miss. Dense salt over a 13-cell rise, hot and cold legs at different densities | MODEL, cause named | fidelity: what the loop costs at rated flow |
| MEDIUM | M | O | BWR/4 cannot be driven to its rated flow | pins at 1162-1168 kg/s, 57 % of a rated 2025, up to 5x demand: more pump speed buys no more core flow. Loop dp at that ceiling 1.517 MPa. Found 20/09/26 | UNCLASSIFIED: BUILD (undersized recirculation loop) or MODEL (two-phase multiplier overstated), not separated | fidelity: what the loop costs at rated flow |
| LOW | S | G | Circulating-water tank settles off its charge pressure at rest | 60.0 → 59.47 % over 170 s: 47.83 kg leaves the tank's one edge into the loop, plant inventory unmoved to 1e-15, pressure relaxes 0.600000 → 0.5929 MPa and is flat by 150 s. A settling transient on three presets, not a leak | MODEL (shared builder; the seeding cause is a hypothesis, unconfirmed) | fidelity: Commissioned plant on its first tick |
| MEDIUM | M | C | RBMK-1000 coolant and feed pump heads against a real machine | MCP ~40 % over; feed train throttles two thirds away | UNKNOWN | fidelity: ...once it IS drawn as a direct cycle |
| MEDIUM | M | O | BWR/4 first tick, worst node | `sg0r` 1.621e-6 and `sg1r` 3.437e-6 against < 1e-6, and still growing each time it is read (8.8e-7, 1.15e-6, 3.437e-6). BN-600, EPR and DUAL sit 6-60x under on the same role, builder, face and tick law | BUILD, BWR/4's drawing | fidelity: Commissioned plant on its first tick |
| LOW | S | J | `FLUID.temp` is labelled display-only but seeds a tank's enthalpy | — | MODEL | backlog 19/09/26 |
| LOW | S | I | A plutonium core carries U-235's delayed-neutron group shape | a few % to tens of % on long periods; no preset uses it | DRIFT | fidelity: delayed-neutron shape |
| LOW | S | M | Rod drive speed | ~2× fast | DRIFT | fidelity: rod drive speed |
| LOW | S | M | Turbine bypass 0.5 of rated steam | 25 % over a PWR, 2× a BWR | DRIFT | fidelity: a turbine bypass |
| LOW | S | M | Radiator panels oversized for the duty | loop rides ~13 K under design | DRIFT | fidelity: the radiator panels against the duty |
| LOW | M | N | The subcooling instrument is a search for the hottest liquid node, not a tapping | — | DRIFT | fidelity: where the subcooling instrument reads |
| LOW | S | A | Hydrogen autoignition taken at the low end of its band | 773 K of 773–858 | DRIFT | fidelity: hydrogen autoignition |
| LOW | S | H | Cathcart-Pawel run past its data | 77 K of extrapolation | DRIFT | fidelity: ...and the correlation's own ceiling |
| LOW | M | I | Leakage `LEAK_K`, fast fission `FAST_RHO`, moderation curve level, displacer worth `tipRho`, release fractions, hotwell depth | solved or bought levels | FIT | fidelity: Neutronics; what a failed pin releases; a condenser's hotwell |
| LOW | S | G | Pump coastdown friction constant | a guess; sets the tail's length only | low confidence | fidelity: a pump coasting after a trip |
| LOW | S | M | Pressurizer heaters | ~15 % light | — | fidelity: pressurizer heaters |
| LOW | L | L | Inertia is one lump per run: no travelling wave, no pipe-wall compliance | a surge reads ~20 % high | named | fidelity: ...and the inertia in it |
| LOW | M | F | A stage's secondary outlet can read above its own hot inlet | flown 20/09/26 (`tools/sandbox/net.js` key `netIhx3`): three in series lay clean and the effectiveness matches the analytic counterflow law to four decimals on all three, so the WALK is sound. But stage 1's secondary outlet read 473.9 K against a 468.0 K hot inlet once, at 60 s, with effectiveness 0.9988 — the formula never claimed it. Looks like a discrete-step overshoot in the node's own mixing. Energy closure along the chain is also not shown: q2 and q3 were still filling at 60 s, which is all the 10 s budget allows | UNCLASSIFIED, both | fidelity: how many exchangers in series |
| LOW | S | D | BWR 8×8 cell, heat outside the fuel | 2.97 % against NOTHING: searched 20/09/26 and no BWR figure exists to measure it against, so the gap has no target. The ~4 % it was written against was never sourced | NO TARGET | fidelity: heat deposited outside the fuel |
| LOW | M | F | MSRE fuel time constant / pellet rise | comparator supplied 20/09/26: the salt film estimated by Hausen at Re 2809, Pr 14.4 (transition flow, so not Dittus-Boelter), h 1824 W/m²K, corrected lumped 7.27 s and 630.7 K. Model 4.93 s / 427.9 K, both 32 % under, just inside the 35 % band the correlation's ±25 % and FLiBe's ±20 % viscosity make — indistinguishable, not agreeing | MODEL | fidelity: core heat reaches the water |
| LOW | S | M | WINDSCALE's sink on the `COND_P0` floor, not re-measured | — | UNKNOWN | fidelity: Commissioned plant on its first tick |
| MEDIUM | L | I | The axial xenon oscillation the bench warns of has never been seen: the axial mesh is 10 planes, 34 cm, 4.7x the 7.2 cm migration length | the core IS in the unstable regime (H/Lm 47 against a real PWR's 45-54, 135.6 kW/L), so the warning is honest; `cz` is a mesh-resolution ratio standing in for the Randall-St John index; the 400x xenon clock already gives 1-2 periods in 300 s, so the window is ruled out | MODEL, the mesh | physics.md: Known gaps |
| MEDIUM | M | B | Dam-break front; a gas-loaded passage under a wall holds; `LIQ_V_MAX` binds on films | front 1.46 m/s = 0.34 of Ritter's 2·√(gh) and 0.39-0.44 of Dressler's measured band: **2.3-2.6x slow**, re-targeted 20/09/26 (the old 0.68 was against half the right number) | MODEL, cause named | fidelity: water on the floor |
| LOW | L | B | Water does not feel the metal's weight; no heat into floor or wall; the flash split stands on the circuit's curve | — | not asked | fidelity: ...two liquids in one cell; ...the water's temperature |

## Presets that are not their real machine (BUILD unless stated)

| importance | size | batch | preset | gap | where |
|---|---|---|---|---|---|
| HIGH | L | P | BN-600 | two circuits: primary sodium in the generator tubes (ERROR); the three-circuit build does not fly | fidelity: BN-600 has an intermediate sodium loop; backlog 07/09/26 |
| HIGH | L | O | BWR/4 | drawn through steam generators, not a direct cycle: exit quality 0.497 against 0.146, void 0.79 against 0.40, pump suctions at saturation, 3.67 pcm drift at rest, carries boron | fidelity: BWR/4 cycle; a BWR gets the coolant flow |
| MEDIUM | S | Q | NUSCALE | the stock PWR coolant row and generator: 15.5 MPa / 583 K / 6.90 MPa against 12.75 / 557 / 3.5 | fidelity: NUSCALE primary and steam |
| MEDIUM | S | P | BN-600 | steam pressure 16.99 MPa against 13.5 | fidelity: BN-600 steam pressure |
| MEDIUM | M | D | RBMK-1000 | graphite time constant 150 s against ~2 h (15 kg/MW against 530) | fidelity: graphite temperature |
| MEDIUM | M | Q | MSRE | the real one rejected heat to air; the whole steam cycle is this project's drawing | fidelity: feed pumps drawing straight off a hotwell |
| LOW | S | Q | EPR | steam pressure 6.88 MPa against 7.5, the stock generator | fidelity: EPR steam pressure |
| LOW | S | Q | STOCK PWR | primary pump bought at 1.12 MPa against a real 0.6–0.7 | fidelity: the core states its drop |
| LOW | M | Q | all | sizes borrowed, never chosen (DRIFT): NUSCALE 2.8× big, MSRE 100× big, EPR 1/5 | fidelity: Plant size |
