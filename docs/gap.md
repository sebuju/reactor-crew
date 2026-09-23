# Gaps — the short list, by batch, most important first inside each

One line per open gap between this model and a real machine. This file is the INDEX. The detail,
the figures and the sources live in the `docs/fidelity.md` row or the `docs/backlog.md` line named
in the last column; when the two disagree, that row wins and this line is stale.

**The answer to "is all the physics implemented?" is this file, never "yes".**

Compiled 20/09/26 from: all of `docs/fidelity.md`, all of `docs/backlog.md`, the "Known gaps"
section of `docs/physics.md`, and one run of `node tests/physics/run.js` (627 pass, 31 stated gaps,
0 fail, nothing killed). **Not checked:** the code itself (except the inertia term), the rest of
`docs/physics.md`, anything no test covers. A gap nobody wrote down is not here.

A simulated figure below is a record of one run, not a reference.

**The target is BEHAVIOUR, not a decimal.** This will never simulate a plant one-to-one. A gap whose
only content is the last few per cent of a published figure is not worth closing, and a job that
ends there has failed, not succeeded. Where a line quotes a decimal distance, ask first whether the
published source states a behaviour instead, and judge the gap on that.

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
does not rank: the tables list rows by batch, and inside a batch by importance. A batch may be taken in
part. A batch has two rows or more, all in one table: physics and preset rows never share a letter.
A row with no partner carries `—`. The letters:

| batch | what it is |
|---|---|
| **B** | Room liquid and floor — `eLiqStep()`, the free surface, water on the floor |
| **D** | Heat outside the fuel — the gamma split and the moderator's own temperature |
| **F** | Heat exchange — the stage law, superheat, the film |
| **I** | Neutronics and poisons — group shapes, the solved levels, the axial mesh |
| **J** | Coolant property tables — `COOLANT` and `FLUID` columns |
| **K** | Boiling and DNB — peaking, void, dryout |
| **L** | Network hydraulics — elevation, inertia, discharge, the tank's charge |
| **M** | Bought knobs and levels — one number each, no law behind them |
| **N** | Instruments — what a signal is read off, and whether it can lie |
| **P** | BN-600 — holding its power, the intermediate loop |

**A gap is something that needs work. A deliberate cut is not a gap and is not listed here**; it
lives in `docs/fidelity.md` and nowhere else. A row there that was decided (no burnup, the 100× xenon
clock and what follows from it, the ideal-gas CO2, the sodium aerosol,
the BWR void expression left unfudged ...) owes nothing. The test run counts some of them among its 31
stated gaps (CO2 density at 400 K); they stay out of this file all the same. A row whose work
is done, or that has no target to measure against, leaves this file, and a batch letter left with
one row loses its letter and leaves the batch table.

Class: **MODEL** = the physics is wrong. **BUILD** = the preset's drawing is wrong. **FIT** = a
bought or solved number. **DRIFT** = nobody decided it. **UNKNOWN** = nobody knows why, or nobody
classified it.

Physics comes before presets, always, so the two are separate tables.

## Physics

| importance | size | batch | gap | distance | class | where |
|---|---|---|---|---|---|---|
| HIGH | M | B | The overflow walk squeezes sealed gas pockets: `eLiqLand()` relocates a carried cell's excess at the head of `eLiqStep()`, before the solve and before the limiter, with no pocket accounting. The limiter's own leak is closed (pocket scale, 22/09/26) | 22/09/26, energy judge (`roomgas.js breakhl`, 60 s armed): 143 of 1854 pocket-ticks over the Bagnold bound, worst 44.5× at 16.80 s (1110 kJ against 24.96 kJ); the same run without the pocket scale reads 274 of 1960, worst 29.4×. At 16.80 s the overflow walk moved 0.051 m3 (max 0.079, mean 0.0040 over 1000 ticks), ~334 kJ at the cell's 6.55 MPa; `eFaceTail` re-opens at most 0.0006 m3 of a pocket's excess over the same 60 s, so it is not the pass. That the relocated water landed in the violating pocket is not confirmed. Highest cell 27.97 MPa against an 11.81 MPa drive (a reading); fullest cell 1.0231 against 1.0105, FAIL. `breaksl` 0 of 2991 over | MODEL, pass named, unfixed | fidelity: ...water pushed into a full body |
| MEDIUM | M | B | Dam-break front: the tip runs slow | 22/09/26, one cell deep: 2.07 m/s over the first second = 0.57 of Ritter at the 1 % contour the test detects (1.70·√(g·h₀)), 0.55 of Dressler's band at 2.4-4.8 s, the dam line 12 % deep and 24 % slow. The front scales with √h₀ (`liquid.js deep`, PASS) and the profile at 1 s matches Ritter to 0.048·h₀ RMS (PASS); the miss is the sub-cell tongue past the body. Three leads (the column, a newly stiff cell, the limiter) measured and cleared | MODEL, cause located (the tip), not named | fidelity: water on the floor |
| LOW | L | B | No heat into the floor or the wall under room water | — | DRIFT, not asked | fidelity: ...the water's temperature |
| MEDIUM | L | D | The gamma cell's transfer is Wigner's rational collision probability and a by-area white boundary, which knows no Dancoff shadowing | RBMK graphite **3.69 % against INSAG's 5.5**, −33 % (the old open boundary read +30.5 %); a slab over-collides by 12.8 % at τ 0.5 against the exact E3 escape (`heatsplit.js`, 22/09/26) | MODEL | fidelity: heat deposited outside the fuel |
| MEDIUM | M | D | The blocks run hotter than published at rating | RBMK-1000 hottest block **771 C** against a 650–760 C band (11 K over; its stack mean 501 C matches CAST's ~500); CALDER HALL hottest **420 C** against Magnox's 250–360 C (60 K over) (`moderator.js s5 s7`, 22/09/26) | MODEL (RBMK); unclassified (CALDER) | fidelity: graphite temperature |
| MEDIUM | M | D | The blocks' temperature coefficient has no graphite thermal-scattering term and no expansion | MSRE's law reads **−0.39 pcm/K** against the measured ~−4.3 (outside a factor 2); RBMK's −2.88 against +6.00 is the no-burnup cut, not this line (`moderator.js coef`, 22/09/26) | MODEL, likely (unclassified: the attribution is the benchmark's Serpent split, not measured here) | fidelity: moderator temperature coefficient |
| MEDIUM | L | F | A steam generator raises saturated steam only | a gas-cooled exchanger superheats its steam (Calder Hall's left 116 K over saturation); none here | MODEL | backlog 20/09/26; fidelity: superheated steam |
| MEDIUM | L | F | Steam generator stage against the exact variable-c_p law | 1237 MW against 1267 (−2.4 %); NUSCALE −2.55 % and EPR −2.77 % re-measured 20/09/26, both further out after the water table. Cost weighed: the exact quadrature is 11.3-11.8 ms per stage per tick against the secant's 1.8 µs, i.e. 900-1200 % of a whole 0.9-1.3 ms tick — a direct swap is not viable and a cache, fit or adaptive step is owed instead | MODEL, weighed 20/09/26 | fidelity: Steam generator effectiveness |
| LOW | M | F | A stage's secondary outlet can read above its own hot inlet | flown 20/09/26 (`tools/sandbox/net.js` key `netIhx3`): three in series lay clean and the effectiveness matches the analytic counterflow law to four decimals on all three, so the WALK is sound. But stage 1's secondary outlet read 473.9 K against a 468.0 K hot inlet once, at 60 s, with effectiveness 0.9988 — the formula never claimed it. Looks like a discrete-step overshoot in the node's own mixing. Energy closure along the chain is also not shown: q2 and q3 were still filling at 60 s, which is all the 10 s budget allows | UNCLASSIFIED, both | fidelity: how many exchangers in series |
| MEDIUM | L | I | The axial xenon oscillation the bench warns of has never been seen: the axial mesh is 10 planes, 34 cm, 4.7x the 7.2 cm migration length | the core IS in the unstable regime (H/Lm 47 against a real PWR's 45-54, 135.6 kW/L), so the warning is honest; `cz` is a mesh-resolution ratio standing in for the Randall-St John index; on the 100x clock (22/09/26) 300 s is 8.3 h, under half the ~1 day period an axial xenon oscillation is commonly quoted at, so the window is no longer ruled out: a test needs ~1000 s or more per period | MODEL, the mesh | physics.md: Known gaps |
| LOW | M | I | Leakage `LEAK_K`, fast fission `FAST_RHO`, moderation curve level, displacer worth `tipRho`, hotwell depth | solved or bought levels | FIT | fidelity: Neutronics; a condenser's hotwell |
| MEDIUM | M | J | Non-water density curves read heavy at their operating point | 7–17 % | DRIFT | fidelity: ...and that shape |
| MEDIUM | M | J | Sodium pool burn rate, spray fraction, water reaction rate, wastage rate | bought, unchecked | FIT, low confidence | fidelity: sodium meeting air / water |
| MEDIUM | M | K | The stock PWR's flux peak `F_q` is 2.711, over the 2.50 tech-spec limit and far over the 1.9–2.2 a real PWR runs | measured 20/09/26 (`core.js 0`). The same measurement WITHDREW this line's predecessor, "boil margin uses `Fq` where enthalpy-rise peaking belongs": the `boil` law integrates the node's own channel, `F_dH` 1.532 is what enters it and `F_q` enters nowhere. Not diagnosed | MODEL | fidelity: enthalpy-rise peaking |
| MEDIUM | M | K | Dryout fires on a mass fraction, not on heat flux | corrected 20/09/26: `SX.fWet` is a BINARY GATE, not a linear fade — full duty to 99.9 % dry, then zero. The real collapse is 10-100x (nucleate 2e4-1e5 against film 1e2-1e3 W/m²K) triggered by wall superheat in a 100-150 K band. The error is the trigger, not the sharpness. **Attempted 20/09/26 and stopped:** `fWet` has five readers and four of them ask a MASS question and are right as they stand (the donor gate, the dry count, the piece pressure read, the tank outflow booking). Only `eSrcAdd()` asks a SURFACE question. Splitting them needs a second `SCHEMA` row and its own superheat or CHF trigger — a structural job, not taken | DRIFT | fidelity: heat into a node that has lost its water |
| MEDIUM | M | K | DNB level is bought (`P.dnbrK` on a `COOLANT.dnbr` column) | measured off rest 20/09/26 (`core.js 0`): the stock PWR's raw minimum DNBR is 2.177, inside the 2.0–2.5 a real PWR is given, and the fit buys it down to 1.85 with `dnbrK` 0.850. `dnbrK` is nowhere near 1 on any preset (0.616 NUSCALE to 4.609 BWR/4), so it is not dead code and may not be deleted. **BWR/4 is the outlier**: raw 0.336, i.e. the correlation says that core is already in departure | FIT on PWR, NUSCALE, EPR; **MODEL on BWR/4 and on RBMK-1000** — a boiling core wants a critical-POWER ratio over the boiling length (GEXL, CISE-4), not a local CHF ratio. The RBMK's share is measured 20/09/26: raw minimum DNBR **2.786**, bought to 1.60 with `dnbrK` 0.5745, at a core void of 0.395 and an exit quality of 0.145 — the top of W-3's own ±0.15 window, and its hot channel past it. The RBMK rows no longer wait on this | fidelity: departure from nucleate boiling |
| MEDIUM | M | L | Flashing discharge near the critical pressure | 35 958 kg/s/m² against 40 380 (−11 %) | MODEL (omega's reach) | fidelity: Flashing discharge |
| MEDIUM | M | L | BN-600 `n` moved after the core-inlet change | +1.15 %, named 20/09/26: the FIELD INLET term, not the lag and not the preset's own drift (own drift 0.0155 %, 74x smaller; field held off moves `n` +5.75 %) | MODEL | fidelity: the core inlet, off the field |
| LOW | L | L | Inertia is one lump per run: no travelling wave, no pipe-wall compliance | a surge reads ~20 % high | named | fidelity: ...and the inertia in it |
| MEDIUM | M | M | `COOLANT[].eff` absorbs what a staged bleed would earn, so it is no longer an isentropic efficiency | bleed 33 % against 25–30 % | FIT | fidelity: the feedwater heating |
| MEDIUM | M | M | Turbine moisture erosion between wet and Baumann | a chronically wet machine runs forever; no erosion law between x 0.05 and 0.88 | MODEL | fidelity: a turbine with water in it |
| MEDIUM | L | N | No measurement noise; no instrument can fail | redundant channels protect against nothing | DRIFT | fidelity: the flux signal; an instrument channel |
| LOW | S | N | The low steam-line pressure channel reads the pressure raw, where a real one is rate-lag compensated | crosses its set 3.78 s after a steam-line break against the AP1000's 1.4 s (zero-load case); the containment channel trips first at 0.12 s | MODEL | fidelity: the PWR's containment and steam-line trips |
| LOW | M | N | The subcooling instrument is a search for the hottest liquid node, not a tapping | — | DRIFT | fidelity: where the subcooling instrument reads |
| HIGH | L | K | No collapsed level: a core losing water is wetted at reduced strength over its whole height, never uncovered from the top | written 22/09/26 from the code, not measured | DRIFT | fidelity: a core that loses water uncovers from the top |
| HIGH | M | — | The mass books miss 125.9 kg in a blast cascade after a cold-leg break | 22/09/26, STOCK PWR at 6.38 s; the same on the committed tree; not traced | ERROR | fidelity: the books through a blast cascade |
| HIGH | XL | — | Molten core material stays in its own node: no candling, freezing, blockage or crust | written 22/09/26 from the code, not measured | DRIFT | fidelity: molten core material moves down |
| HIGH | M | — | No Zr melt and no U-Zr-O eutectic: fuel melts only at its own `tmelt` | onset about 900 K late for UO2 in Zircaloy | DRIFT | fidelity: molten Zircaloy dissolves the fuel far below UO2's melting point |
| MEDIUM | XL | — | No corium and no lower head: a melt drains coolant and adds vessel fatigue instead | written 22/09/26 from the code, not measured | DRIFT | fidelity: the vessel's lower head under a melt |
| LOW | L | K | The clad has no heat capacity; its temperature is solved algebraically each tick | about 0.5 s of lag missing, estimated by hand | DRIFT | fidelity: the clad stores heat |

## Preset build defects (BUILD unless stated)

A preset is inspired by its namesake, never a replica: a figure off the namesake's sheet is a
deliberate cut in `docs/fidelity.md` and is not listed here. What is listed is a preset that does
not fly, or does not behave as its family does.

| importance | size | batch | preset | gap | where |
|---|---|---|---|---|---|
| HIGH | M | P | BN-600 | does not hold its power: core heat 0.684 of commissioned and heat balance 1.258 at 120 s, no orders (21/09/26), unclassified; **22/09/26: cannot reach critical** — samarium takes 499 pcm on sodium's `xe` 0.85 against 386 pcm of bank left, rods fully out, 6.6 pcm short; 0.306 of commissioned at 120 s. MODEL (a thermal poison worth carried on a fast core, row "samarium poisoning"), **fixed 22/09/26**; then bank fully in (2362 pcm) against 3696 pcm of excess, +469 pcm at rest. **Later 22/09/26, bank off the drawn absorber:** critical at rest (rods 0.512), core heat 1.000 and heat balance 1.004 at 120 s, no orders; left: PORV OPEN red at 3.30 s, unclassified | fidelity: BN-600 holds its power |
| HIGH | L | P | BN-600 | two circuits: primary sodium in the generator tubes (ERROR); the three-circuit build does not fly | fidelity: BN-600 has an intermediate sodium loop; backlog 07/09/26 |
| HIGH | L | — | BWR/4 | drawn through steam generators, not a direct cycle; carries boron. **22/09/26: no longer holds** — samarium's 587 pcm, held in boron (3029 → 3626 pcm), takes it down to 0.03 of rated inside 25 s, and a burst near 118 s fills the room (dice live; it holds within 5 % with samarium stood down), BUILD on this same line. Re-measured 20/09/26 after the two-phase riser bore landed (its own row): exit quality **0.110** against 0.146 (0.115 before the pellet conductivity law, 0.497 before the riser bore), 120 s void **0.365** inside the published 0.25–0.55 (was 0.786), pump suctions now clear of saturation, all four settle failures gone, the 120 s march fully clean, and the flow ceiling gone (1.10 of rated at its own demand, 2.89 at 5x, line deleted from this file). What the fix EXPOSED: the enlarged riser holds 4× the water and the plant now rings about 40 % of rated over its first 2 s, so its 3 s rest drift went 3.14 → **400 pcm**, and **443 pcm** after the pellet conductivity law landed (measured 20/09/26 against the committed tree, which reads 400; the pellet fix is its own fidelity row and the 11 % is the only thing it moved here). Not diagnosed | BUILD on the drawing; the ring is MODEL or a commissioning seed, unclassified | fidelity: BWR/4 cycle; a BWR gets the coolant flow |
| MEDIUM | M | — | MSRE | graphite in whole L_MOD slots, one in four (13.7 cm), where the MSRE core is ~78 % graphite in 5 cm stringers: graphite share **2.33 %** against ~6 % and **231 K** over the salt against ORNL's +24 K (22/09/26, `heatsplit.js`, `moderator.js s6`) | fidelity: graphite temperature; heat deposited outside the fuel |
