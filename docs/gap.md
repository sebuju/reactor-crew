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
clock and what follows from it, the ideal-gas CO2, the sodium aerosol,
the BWR void expression left unfudged ...) owes nothing. The test run counts some of them among its 31
stated gaps (CO2 density at 400 K); they stay out of this file all the same. A row whose work
is done, or that has no target to measure against, leaves this file, and a batch letter with
no rows left leaves the batch table with it.

Class: **MODEL** = the physics is wrong. **BUILD** = the preset's drawing is wrong. **FIT** = a
bought or solved number. **DRIFT** = nobody decided it. **UNKNOWN** = nobody knows why, or nobody
classified it.

Physics comes before presets, always, so the two are separate tables.

## Physics

| importance | size | batch | gap | distance | class | where |
|---|---|---|---|---|---|---|
| LOW | S | A | `ROOM_TMAX` is still touched on a severed hot leg | re-measured 20/09/26 both sides. COMMITTED tree: 1 514 800 cell-ticks clamped in 60 s on a hot-leg break, 3 962 592 on a steam line, flat on the ceiling at 22–27 MPa — `docs/physics.md` said the guard never acts and that was false. After the donor-temperature cap: **3 cell-ticks on the hot leg, 0 on the steam line**, which peaks at 2046 K. Three ticks is not nothing and nobody has chased which cell or why | MODEL | fidelity: what a jet, a vent or a boiling pool may heat the air TO |
| MEDIUM | M | A | A near-flooded cell reads an enormous pressure | a cell whose gas volume is just above `ROOM_VG_MIN` holds its gas at n·R·T/V_min: measured 225 MPa gauge at 60 s of a hot-leg break, 58 kg of gas in 0.0087 m³. A cell AT the floor takes the ring average and is fine; the discontinuity is at the threshold. Pre-existing — the committed tree shows the same shape at 22 MPa — and it drives blast damage now that the blast path is judged every tick | MODEL, structural | fidelity: the implicit step's front |
| LOW | S | A | A cell squeezed by a liquid takes no compression work | the gas solve's compliance is adiabatic (γ·p) but a volume change announced by a landing liquid is not delivered as work, so that one mechanism reads its bulk modulus as 102.4 kPa where γ·p is 141.9 | MODEL | fidelity: the implicit step's front |
| CRITICAL | M | C | RBMK-1000 with rods frozen at 100 % grows where the real one decays | e-folding **3.25 s** (20/09/26 with the axial pressure profile built; 3.29 s before it, 2.78 s before the redraw). Narrowed 20/09/26: the whole remaining distance is d(void)/d(power), the line below. Size L → M now that the cause is localised | MODEL | fidelity: RBMK stability |
| HIGH | M | C | RBMK-1000 fast power coefficient at 100 % | **+3.965 pcm/%** (20/09/26 with the axial pressure profile built; +3.95 before it) against a band of **−6.40 to +0.96**. The band was wrong on 20/09/26 and is corrected: it is converted on the REAL machine's β_eff 0.005 and 3200 MWt, not on this drawing's own β and rating, which shrank it 4.1×. Letting the inlet follow the power gives −0.93, inside the band | MODEL | fidelity: RBMK stability |
| HIGH | M | K | d(void)/d(power) at a held core inlet is 1.55× too steep | 0.003950 of void per % of rated, flux-weighted, where the band's upper edge allows 0.002544. Ruled out as causes by measurement 20/09/26: the axial quadrature (10 → 80 planes moves it −2.5 %), `aV` (on its published band), Doppler (`aF` inside its published band, fuel rise agrees with the conduction solution), the drift velocity (now built, worth −1 %) and now **the axial pressure profile** — built, flashing worth 2.1 % of exit quality, and the slope moved the WRONG WAY by 0.4 %. The void LEVEL is right: 0.276 against the real ~0.28 | MODEL, **no candidate left named** | fidelity: RBMK stability |
| MEDIUM | M | C | RBMK core inlet carries a third of the pump work the first law requires | 0.96 kJ/kg against the 3.08 an isentropic pump raising 2.37 MPa must leave in the water; 1.8e-3 of the inlet enthalpy. Found 20/09/26; no other preset looked at | MODEL | fidelity: RBMK core inlet pumping |
| MEDIUM | S | I | β 680 pcm against a real β_eff of 480–510 | 1.35×, and it follows from the deliberate "no burnup" cut: every pcm here is worth 1.35× less in dollars than on the machine | MODEL, stated not fixed | fidelity: delayed-neutron fraction against a real beta_eff |
| HIGH | L | D | No gamma transport: heat in a big moderator cell is over-credited; structures, vessel and rods take none | RBMK graphite 9.8 % against 5.5 %; CALDER HALL 206 MWt against 182 | MODEL | fidelity: heat deposited outside the fuel |
| HIGH | M | G | Feed pump NPSH; the cavitation head cutback is not implemented | required 0.17–0.69 MPa, available ≤ 0.13 on every preset | MODEL | fidelity: what a feed pump has to suck against |
| HIGH | S | G | Circulating-water circuit has no resistance of its own | pump passes 1.19× its bought flow | MODEL | fidelity: the circulating water pump |
| MEDIUM | M | K | The stock PWR's flux peak `F_q` is 2.711, over the 2.50 tech-spec limit and far over the 1.9–2.2 a real PWR runs | measured 20/09/26 (`core.js 0`). The same measurement WITHDREW this line's predecessor, "boil margin uses `Fq` where enthalpy-rise peaking belongs": the `boil` law integrates the node's own channel, `F_dH` 1.532 is what enters it and `F_q` enters nowhere. Not diagnosed | MODEL | fidelity: enthalpy-rise peaking |
| HIGH | M | H | Fuel passing `tdmg` takes no damage | nothing until can failure or melt | MODEL | backlog 19/09/26 |
| HIGH | XL | H | Failed clad releases nothing into the water or the room | no activity state at all | MODEL | backlog 19/09/26 |
| LOW | S | G | Seed walk is diode-blind, so a hot node can commission behind a check valve | the 09/09/26 feed-header ring (16.58 MPa, 1.42× the run's rating) is GONE on re-measure 20/09/26: 10.3995 MPa, 0.89× rating, the node subcooled at 309 K. The walk in `eAdvectSeed()` still ignores `edDiode`, so the mechanism survives even though nothing exercises it | MODEL, latent | fidelity: the feed train at commissioning |
| HIGH | M | L | `SC_NAT` swings on a rounding-level input change | ~1 % | UNKNOWN | backlog 18/09/26 |
| MEDIUM | M | I | No samarium-149 | ~−700 pcm at equilibrium, climbs after shutdown | MODEL | backlog 19/09/26 |
| MEDIUM | L | F | A steam generator raises saturated steam only | Calder Hall: 116 K of superheat missing | MODEL | backlog 20/09/26; fidelity: superheated steam |
| MEDIUM | M | E | CALDER HALL MWe / efficiency | 52.3 / 0.253 against 42 / 0.231. SEPARATED 20/09/26: the missing superheat owns NONE of it (its sign is backwards - putting it in moves MWe to 59.3, further from 42). Rating excess 1.133 x efficiency excess 1.095 = 1.243 against a measured 1.245 | efficiency excess 100 % BUILD (the L.P. circuit is not drawn); the rating excess is MODEL on the heat-split row | fidelity: CALDER HALL against the real machine |
| MEDIUM | M | E | CALDER HALL gas flow | 1046 kg/s against 891 | MODEL | same |
| MEDIUM | S | E | CALDER HALL circuit pressure | 0.849 MPa against 0.791: confirmed 20/09/26 that the two are read at DIFFERENT POINTS — `sc[SC_P]` is the core node's own solved pressure, the sheet's 100 psig is `CO2.P0`/`circSetP`, a setpoint. So +7.4 % is not a measured distance | open until a same-point comparison is made; not MODEL | same |
| MEDIUM | M | E | CALDER HALL at rest, rods held, 3 s | 2.13 pcm, 0.46 % heat against 0 | MODEL, cause unconfirmed | fidelity: CALDER HALL at rest |
| MEDIUM | S | E | CALDER HALL states no channel bore, so its fuel slots hold gas where the pile stood | Calder graphite 375 t against ~620 t in the active core. The MODEL half closed 20/09/26 — a fuel slot MAY hold moderator — so what is left is one number on the CALDER HALL drawing | BUILD | fidelity: drawn rod pitch; a fuel slot may hold moderator |
| MEDIUM | L | F | Steam generator stage against the exact variable-c_p law | 1237 MW against 1267 (−2.4 %); NUSCALE −2.55 % and EPR −2.77 % re-measured 20/09/26, both further out after the water table. Cost weighed: the exact quadrature is 11.3-11.8 ms per stage per tick against the secant's 1.8 µs, i.e. 900-1200 % of a whole 0.9-1.3 ms tick — a direct swap is not viable and a cache, fit or adaptive step is owed instead | MODEL, weighed 20/09/26 | fidelity: Steam generator effectiveness |
| MEDIUM | M | L | Flashing discharge near the critical pressure | 35 958 kg/s/m² against 40 380 (−11 %) | MODEL (omega's reach) | fidelity: Flashing discharge |
| MEDIUM | M | H | MSR fuel gets clad burst, pellet melt and a UO2 pin | meaningless there | MODEL, small | fidelity: a molten-salt reactor's fuel |
| MEDIUM | M | D | Graphite has a temperature on RBMK only; MSRE and CALDER HALL blocks have none | their share reaches the coolant at once | MODEL | fidelity: graphite temperature |
| MEDIUM | M | J | Non-water density curves read heavy at their operating point | 7–17 % | DRIFT | fidelity: ...and that shape |
| MEDIUM | M | M | `COOLANT[].eff` absorbs what a staged bleed would earn, so it is no longer an isentropic efficiency | bleed 33 % against 25–30 % | FIT | fidelity: the feedwater heating |
| MEDIUM | M | M | Turbine moisture erosion between wet and Baumann | a chronically wet machine runs forever; no erosion law between x 0.05 and 0.88 | MODEL | fidelity: a turbine with water in it |
| MEDIUM | L | N | No measurement noise; no instrument can fail | redundant channels protect against nothing | DRIFT | fidelity: the flux signal; an instrument channel |
| MEDIUM | M | K | Dryout fires on a mass fraction, not on heat flux | corrected 20/09/26: `SX.fWet` is a BINARY GATE, not a linear fade — full duty to 99.9 % dry, then zero. The real collapse is 10-100x (nucleate 2e4-1e5 against film 1e2-1e3 W/m²K) triggered by wall superheat in a 100-150 K band. The error is the trigger, not the sharpness. **Attempted 20/09/26 and stopped:** `fWet` has five readers and four of them ask a MASS question and are right as they stand (the donor gate, the dry count, the piece pressure read, the tank outflow booking). Only `eSrcAdd()` asks a SURFACE question. Splitting them needs a second `SCHEMA` row and its own superheat or CHF trigger — a structural job, not taken | DRIFT | fidelity: heat into a node that has lost its water |
| MEDIUM | M | J | Sodium pool burn rate, spray fraction, water reaction rate, wastage rate | bought, unchecked | FIT, low confidence | fidelity: sodium meeting air / water |
| MEDIUM | M | A | Blast break pressures (`pburst`) mostly unsourced | no published rung for cabinets, pipe, vessels | DRIFT | fidelity: what a blast breaks |
| MEDIUM | M | A | Blast near field stays in the charge cell; `ROOM_TMAX` caps the dial | region peak 10 kPa off a 5 MPa charge | MODEL, not weighed | fidelity: what the BLAST fault injects |
| MEDIUM | M | K | DNB level is bought (`P.dnbrK` on a `COOLANT.dnbr` column) | measured off rest 20/09/26 (`core.js 0`): the stock PWR's raw minimum DNBR is 2.177, inside the 2.0–2.5 a real PWR is given, and the fit buys it down to 1.85 with `dnbrK` 0.850. `dnbrK` is nowhere near 1 on any preset (0.616 NUSCALE to 4.609 BWR/4), so it is not dead code and may not be deleted. **BWR/4 is the outlier**: raw 0.336, i.e. the correlation says that core is already in departure | FIT on PWR, NUSCALE, RBMK, EPR; **MODEL on BWR/4** — a boiling core wants a critical-POWER ratio over the boiling length (GEXL, CISE-4), not a local CHF ratio. Not measured | fidelity: departure from nucleate boiling |
| MEDIUM | M | L | BN-600 `n` moved after the core-inlet change | +1.15 %, named 20/09/26: the FIELD INLET term, not the lag and not the preset's own drift (own drift 0.0155 %, 74x smaller; field held off moves `n` +5.75 %) | MODEL | fidelity: the core inlet, off the field |
| MEDIUM | M | L | `loopHeadOf()`'s `dpOf()` carries no elevation term | MSRE's 25 % is explained 20/09/26: every leg is off and most cancels; the round-loop hydrostatic residual is +0.051 MPa, the whole miss. Dense salt over a 13-cell rise, hot and cold legs at different densities | MODEL, cause named | fidelity: what the loop costs at rated flow |
| MEDIUM | M | O | BWR/4 cannot be driven to its rated flow | pins at 1162-1168 kg/s, 57 % of a rated 2025, up to 5x demand: more pump speed buys no more core flow. Loop dp at that ceiling 1.517 MPa. Found 20/09/26 | UNCLASSIFIED: BUILD (undersized recirculation loop) or MODEL (two-phase multiplier overstated), not separated | fidelity: what the loop costs at rated flow |
| LOW | S | G | Circulating-water tank settles off its charge pressure at rest | 60.0 → 59.47 % over 170 s: 47.83 kg leaves the tank's one edge into the loop, plant inventory unmoved to 1e-15, pressure relaxes 0.600000 → 0.5929 MPa and is flat by 150 s. A settling transient on three presets, not a leak | MODEL (shared builder; the seeding cause is a hypothesis, unconfirmed) | fidelity: Commissioned plant on its first tick |
| MEDIUM | M | C | RBMK-1000 coolant and feed pump heads against a real machine | re-measured 20/09/26 after the redraw, nothing tuned: MCP 2.498 / 2.373 MPa, **+39 %** over the midpoint of a real 1.5–2.0 where it was +57 %; the feed train still throttles most of its head away | the feed train is BUILD (classed 20/09/26); the MCP heads stay UNKNOWN | fidelity: ...once it IS drawn as a direct cycle |
| MEDIUM | M | O | BWR/4 first tick, worst node | `sg0r` 1.621e-6 and `sg1r` 3.437e-6 against < 1e-6, and still growing each time it is read (8.8e-7, 1.15e-6, 3.437e-6). BN-600, EPR and DUAL sit 6-60x under on the same role, builder, face and tick law | BUILD, BWR/4's drawing | fidelity: Commissioned plant on its first tick |
| LOW | M | N | The subcooling instrument is a search for the hottest liquid node, not a tapping | — | DRIFT | fidelity: where the subcooling instrument reads |
| LOW | S | H | Cathcart-Pawel run past its data | 77 K of extrapolation | DRIFT | fidelity: ...and the correlation's own ceiling |
| LOW | M | I | Leakage `LEAK_K`, fast fission `FAST_RHO`, moderation curve level, displacer worth `tipRho`, release fractions, hotwell depth | solved or bought levels | FIT | fidelity: Neutronics; what a failed pin releases; a condenser's hotwell |
| LOW | L | L | Inertia is one lump per run: no travelling wave, no pipe-wall compliance | a surge reads ~20 % high | named | fidelity: ...and the inertia in it |
| LOW | M | F | A stage's secondary outlet can read above its own hot inlet | flown 20/09/26 (`tools/sandbox/net.js` key `netIhx3`): three in series lay clean and the effectiveness matches the analytic counterflow law to four decimals on all three, so the WALK is sound. But stage 1's secondary outlet read 473.9 K against a 468.0 K hot inlet once, at 60 s, with effectiveness 0.9988 — the formula never claimed it. Looks like a discrete-step overshoot in the node's own mixing. Energy closure along the chain is also not shown: q2 and q3 were still filling at 60 s, which is all the 10 s budget allows | UNCLASSIFIED, both | fidelity: how many exchangers in series |
| LOW | M | F | MSRE fuel time constant / pellet rise | comparator supplied 20/09/26: the salt film estimated by Hausen at Re 2809, Pr 14.4 (transition flow, so not Dittus-Boelter), h 1824 W/m²K, corrected lumped 7.27 s and 630.7 K. Model 4.93 s / 427.9 K, both 32 % under, just inside the 35 % band the correlation's ±25 % and FLiBe's ±20 % viscosity make — indistinguishable, not agreeing | MODEL | fidelity: core heat reaches the water |
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
| MEDIUM | M | D | RBMK-1000 | graphite time constant **0.42 h** against ~2 h (20/09/26, was 188 s). The mass is no longer the cause: 345 kg/MW against ~370 for the real active core. What is left is the conductance — UA 0.355 kW/K per MWt against the real 0.124 — and `aG` +2.76 pcm/K against INSAG's +6.00. FIT, not BUILD | fidelity: graphite temperature |
| MEDIUM | M | Q | MSRE | the real one rejected heat to air; the whole steam cycle is this project's drawing | fidelity: feed pumps drawing straight off a hotwell |
| LOW | S | Q | EPR | steam pressure 6.88 MPa against 7.5, the stock generator | fidelity: EPR steam pressure |
| LOW | S | Q | STOCK PWR | primary pump bought at 1.12 MPa against a real 0.6–0.7 | fidelity: the core states its drop |
| LOW | M | Q | all | sizes borrowed, never chosen (DRIFT): NUSCALE 2.8× big, MSRE 100× big, EPR 1/5 | fidelity: Plant size |
