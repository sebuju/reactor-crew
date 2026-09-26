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

**Importance (`prio`) is a judgement made 20/09/26, not a measurement.** The rule used:

- **CRIT** — conservation is broken, or the model does the opposite of the real machine.
- **HIGH** — the model is wrong by a large measured distance, or a term is missing that changes how
  an accident plays out, or something is wrong on every plant and nobody knows why.
- **MED** — a bounded, measurable distance on one feature; a bought number nobody checked; an
  unexplained reading that hurts nothing yet.
- **LOW** — a small distance, or a case no preset reaches.

**Size is a judgement made 20/09/26, not a measurement either**, and it is the size of the JOB, not
the size of the gap — a CRIT gap can be •◦◦◦ and a LOW one •••◦. The rule used:

- **•◦◦◦** — one number, curve, table column or knob; one file, no new state, nothing else moves.
- **••◦◦** — one term, gate or solver added inside the structure that already exists; a few files, and
  a diagnosis job whose answer is not yet known sits here until it is.
- **•••◦** — new state or a new law: `SCHEMA` rows, a new pass in the tick, or a rewrite of how one
  subsystem works. Several files, and the presets have to be re-flown.
- **••••** — a subsystem that does not exist yet, reaching state, tick, UI and every preset.

Where two rows share one root cause, each carries the size of ITS OWN remaining work: the root gets
•••◦, the follower gets the •◦◦◦ or ••◦◦ left over once the root lands.

**Batch is a letter, and it is a judgement made 20/09/26 too** (Q added 23/09/26). Rows sharing a letter share the
same file, the same law or the same re-fly, so taking them in one job costs little more than taking
one of them — the reading, the sourcing and the preset march are paid once. A letter groups, it
does not rank: the tables list rows by batch, and inside a batch by importance. A batch may be taken in
part. A batch has two rows or more, all in one table: physics and preset rows never share a letter.
A row with no partner carries `—`. The letters:

| batch | what it is |
|---|---|
| **I** | Neutronics and poisons — the flux solver and its shape, the solved levels, the axial mesh |
| **J** | Coolant property tables — `COOLANT` and `FLUID` columns |
| **M** | Bought knobs and levels — one number each, no law behind them |
| **P** | BN-600 — holding its power, the intermediate loop |

**A gap is something that needs work. A deliberate cut is not a gap and is not listed here**; it
lives in `docs/fidelity.md` and nowhere else. A row there that was decided (no burnup, the 100× xenon
clock and what follows from it, the ideal-gas CO2, the sodium aerosol,
the BWR void expression left unfudged ...) owes nothing. The test run counts some of them among its 31
stated gaps (CO2 density at 400 K); they stay out of this file all the same. A row whose work
is done, or that has no target to measure against, leaves this file, and a batch letter left with
one row loses its letter and leaves the batch table.

**A plan that addresses a gap adds no new row here.** What it finds left over — the next missing
term, the residual it could not close — goes into a new follow-up plan that covers it if it is worth
chasing, and into a `docs/fidelity.md` row if it is not.

Class: **MODEL** = the physics is wrong. **BUILD** = the preset's drawing is wrong. **FIT** = a
bought or solved number. **DRIFT** = nobody decided it. **UNKNOWN** = nobody knows why, or nobody
classified it.

Physics comes before presets, always, so the two are separate tables.

## Physics

| prio | size | batch | gap | distance | class | where |
|---|---|---|---|---|---|---|
| MED | ••◦◦ | — | The RBMK's hottest block runs over the published band | RBMK-1000 hottest block **870 C** against a 650–760 C band (110 K over) now its graphite stops 5.2 % of the heat (INSAG 5.5); its stack mean **554 C** against CAST's ~500 (PASS 15 %). Heat spreading between nodes through the stack landed and took 14 K off it. The fuel channel's gas gap carried 223 of the fuel columns' 273 K mean rise before that, and the published ring gaps move it little; no reflector cooling channels (`moderator.js s5 spread`, 23/09/26) | MODEL (the channel count's ~11 K is BUILD) | fidelity: graphite temperature |
| MED | ••◦◦ | I | The axial xenon oscillation reads over-damped | STOCK PWR decays at −0.11 /h without turning and a tall COMPACT rings once at 35 h and damps at −0.08 /h, where a 12-ft PWR was measured at −0.041 to −0.014 /h, 27–32 h, near zero by 12 GWd/t (AP1000 DCD 4.3.2.7.4) | BUILD (rated flux), MODEL cut (burnup shape held at the cold core) | fidelity: the axial xenon oscillation |
| LOW | ••◦◦ | I | A condenser's hotwell depth | a bought level | FIT | fidelity: a condenser's hotwell |
| MED | ••◦◦ | J | Non-water density curves read heavy at their operating point | 7–17 % | DRIFT | fidelity: ...and that shape |
| MED | ••◦◦ | J | Sodium pool burn rate and spray fraction | burn rate 40 kg/m²/h against the one located test's 17.3; in-flight fraction 0.40 against 0.70 in air | FIT, low confidence | fidelity: sodium meeting air / water |
| LOW | •••◦ | — | Inertia is one lump per run: no travelling wave, no pipe-wall compliance | a surge reads ~20 % high | named | fidelity: ...and the inertia in it |
| MED | ••◦◦ | M | `COOLANT[].eff` absorbs what a staged bleed would earn, so it is no longer an isentropic efficiency | bleed 33 % against 25–30 % | FIT | fidelity: the feedwater heating |
| MED | ••◦◦ | M | Turbine moisture erosion between wet and Baumann | a chronically wet machine runs forever; no erosion law between x 0.05 and 0.88 | MODEL | fidelity: a turbine with water in it |
| HIGH | •◦◦◦ | — | A sealed gas pocket is still squeezed past what the drive and the water can give it after a hot-leg break, once in 60 s, and the pass is not named. The gas-free sub-floor room planning named is 4.8 % of that tick's loss, so it is not the pass | 23/09/26 (room-structure, with the plate's real surfaces and the water's V·Δp, swell and κ_s): `roomgas.js breakhl` 60 s armed, 1 of 2989 pocket-ticks over the Bagnold bound, 1.49× at 17.42 s (211 kJ against 142 kJ, 6.55 MPa pocket, 3.86 MPa drive); fullest cell 1.0052, PASS; highest cell 9.70 MPa against 11.58. Before: 56 over, fullest 1.0125 FAIL. `roomgas.js pocket` fails its air-hold read at 1.5 s (0.16 kg under the rim for 7 ticks, back after), a borderline `eLqSwap()` trigger since the water's energy landed | MODEL, pass not named | fidelity: ...water pushed into a full body |
| HIGH | •••◦ | — | The control absorber never melts | Ag-In-Cd melts at about 800 °C, first in the core, fails its clad and runs down; here a bank keeps its place and its worth through any melt | MODEL | fidelity: the control absorber melts first; backlog 25/09/26 |

## Preset build defects (BUILD unless stated)

A preset is inspired by its namesake, never a replica: a figure off the namesake's sheet is a
deliberate cut in `docs/fidelity.md` and is not listed here. What is listed is a preset that does
not fly, or does not behave as its family does.

| prio | size | batch | preset | gap | where |
|---|---|---|---|---|---|
| HIGH | ••◦◦ | P | BN-600 | does not hold its power: core heat 0.684 of commissioned and heat balance 1.258 at 120 s, no orders (21/09/26), unclassified; **22/09/26: cannot reach critical** — samarium takes 499 pcm on sodium's `xe` 0.85 against 386 pcm of bank left, rods fully out, 6.6 pcm short; 0.306 of commissioned at 120 s. MODEL (a thermal poison worth carried on a fast core, row "samarium poisoning"), **fixed 22/09/26**; then bank fully in (2362 pcm) against 3696 pcm of excess, +469 pcm at rest. **Later 22/09/26, bank off the drawn absorber:** critical at rest (rods 0.512), core heat 1.000 and heat balance 1.004 at 120 s, no orders; left: PORV OPEN red at 3.30 s, unclassified. **23/09/26, short again on the published fuel k∞:** −9 532 pcm with the bank fully out against a 32 982 pcm leak, 0.030 of commissioned by 120 s, PORV OPEN at 2.30 s: MODEL, the fast migration area. **23/09/26, on its own steel-clad 6.9 mm pin (batch Q phase 2):** rated 869 → 1647 MWt off the smaller pins, rest excess −9 311 pcm before and after (the pin did not move it), 0.030 of commissioned by 120 s, TURB TRIP at 0.10 s: class unchanged, MODEL | fidelity: BN-600 holds its power; ...the excess the leakage now eats |
| HIGH | •••◦ | P | BN-600 | two circuits: primary sodium in the generator tubes (ERROR); the three-circuit build does not fly | fidelity: BN-600 has an intermediate sodium loop; backlog 07/09/26 |
| HIGH | •••◦ | — | BWR/4 | **26/09/26, plan-bwr-bank: its bank now holds at hot rest (bank fully in −15876 pcm, bench rest 0.803 (0.575 since plan-bank-curve), 44 GE B4C blades, batch gadolinia) but the engine rests it at 0.000 of travel, 6765 pcm subcritical with the bank out, on the core void 0.54 its settle lands (BUILD, "BWR/4 cycle"); since plan-bank-law the cell worth is priced on the law (the PWR lattice +18 %/+2 % on VERA, no BWR lattice read) and its bench bank on the curve fell 4755 → 3797 pcm on the curve's slope measure and reads 11685 pcm on the eigenvalue's own change since plan-bank-curve (MODEL, fidelity "the bank's integral worth curve"); its commission's settle went 1.5 → 4.5 s and `rodworth.js 3` is killed at 10 s, so its engine figures are not measured.** drawn through steam generators, not a direct cycle; since 23/09/26 rod-held, no boron; on the burnt excess at its linear-reactivity burnup (fidelity "burnup", 17.13 MWd/kgHM, 4 batches) it rests at 0.359 of its 5 064 pcm bank, bank fully in −5 027 pcm, and sags to 0.886 of commissioned heat at 120 s, heat balance 1.010, unclassified (23/09/26, the nucleate film referenced to saturation: 0.957, heat balance 1.005, class unchanged) (on the fresh k∞ it was supercritical by +9 176 pcm with the bank fully in). **22/09/26: no longer holds** — samarium's 587 pcm, held in boron (3029 → 3626 pcm), takes it down to 0.03 of rated inside 25 s, and a burst near 118 s fills the room (dice live; it holds within 5 % with samarium stood down), BUILD on this same line. Re-measured 20/09/26 after the two-phase riser bore landed (its own row): exit quality **0.110** against 0.146 (0.115 before the pellet conductivity law, 0.497 before the riser bore), 120 s void **0.365** inside the published 0.25–0.55 (was 0.786), pump suctions now clear of saturation, all four settle failures gone, the 120 s march fully clean, and the flow ceiling gone (1.10 of rated at its own demand, 2.89 at 5x, line deleted from this file). What the fix EXPOSED: the enlarged riser holds 4× the water and the plant now rings about 40 % of rated over its first 2 s, so its 3 s rest drift went 3.14 → **400 pcm**, and **443 pcm** after the pellet conductivity law landed (measured 20/09/26 against the committed tree, which reads 400; the pellet fix is its own fidelity row and the 11 % is the only thing it moved here). Not diagnosed | BUILD on the drawing; the ring is MODEL or a commissioning seed, unclassified | fidelity: BWR/4 cycle; a BWR gets the coolant flow; BWR/4's bank does not hold its excess |
| HIGH | •••◦ | — | RBMK-1000 | flies again 23/09/26 on its rods (1 000 pcm operating margin, 12.21 MWd/kgHM, rest 0.624), but its rating reads 467 MWt on the hot rest (24/09/26): average linear power 9.4 kW/m against the real channel's 14.2, hot F_q 3.11 (`rbmk.js coef` FAIL, unclassified); its lattice k∞ 1.189 sits under the published RBMK cells' 1.229–1.370, and it burns 9 585 pcm from 2 to 20 MWd/kgHM against a published cell's 26 289 (MODEL) | MODEL; rating unclassified | fidelity: RBMK-1000 at rated power; ...the excess the leakage now eats |
| MED | ••◦◦ | — | MSRE | graphite in whole L_MOD slots, one in four (13.7 cm), where the MSRE core is ~78 % graphite in 5 cm stringers: graphite share **2.49 %** against ~6 % and **218 K** over the salt against ORNL's +24 K, and its blocks' coefficient **−0.37 pcm/K** where the same law on a real-size MSRE cell reads −4.32 against the measured −4.3 (23/09/26, `heatsplit.js`, `moderator.js s6 coef`) | fidelity: graphite temperature; heat deposited outside the fuel; moderator temperature coefficient |
| HIGH | ••◦◦ | — | CALDER HALL | does not fly (`presets.js 7`): 26/09/26, after plan-bank-curve, 0.869 of commissioned at 120 s, balance 1.062, gas outlet −9.9 K (0.806, 1.139, −11.9 K on the tree before); 24/09/26, rated 100 MWt on the hot rest and at rest by `calder.js`, it still sags to 0.937 of commissioned by 120 s (balance 1.033, gas outlet −4.6 K), the rod regulator not answering the outlet error; before that, 23/09/26, on HEAD and after batch D: on HEAD the power ran past 58x by 60 s (HI FLUX at 30 s); after batch D the bank rests at 0.106 of travel, runs onto its 0.100 end stop, and the power drifts to 0.30 of commissioned by 120 s while xenon builds. At rest its core gas stands at 210–406 C against its own 140 → 336 C programme, which is also what holds its hottest block over the Magnox band (the real brick on the same law sits 2.5 K over its gas). `calder.js`'s two fault checks (store flow-work, load cut 10 %) do not fail, on HEAD too. Unclassified | fidelity: CALDER HALL against the real machine; graphite temperature |
