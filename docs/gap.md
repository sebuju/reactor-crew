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

| importance | gap | distance | class | where |
|---|---|---|---|---|
| CRITICAL | `eFaceLimit()` gas call overdraws a cell; the clamp makes mass out of nothing | 0.088 kg | MODEL | backlog 12/09/26 |
| CRITICAL | Room gas is isothermal at a ballasted temperature | 5 MPa charge reads 29 kPa against 188; no wall breaks | MODEL | backlog 11/09/26; fidelity: the implicit step's front |
| CRITICAL | Blast damage is judged only on the tick of the act | a front arriving later breaks nothing; 11 of 24 wreck sets point at the charge | MODEL | backlog 11/09/26 |
| CRITICAL | RBMK-1000 with rods frozen at 100 % grows where the real one decays | e-folding 2.78 s | MODEL | fidelity: RBMK stability |
| HIGH | RBMK-1000 static power coefficient at 100 % | +0.43 pcm/% against a negative design figure | MODEL | fidelity: RBMK stability |
| HIGH | No gamma transport: heat in a big moderator cell is over-credited; structures, vessel and rods take none | RBMK graphite 9.8 % against 5.5 %; CALDER HALL 206 MWt against 182 | MODEL | fidelity: heat deposited outside the fuel |
| HIGH | Feed pump NPSH; the cavitation head cutback is not implemented | required 0.17–0.69 MPa, available ≤ 0.13 on every preset | MODEL | fidelity: what a feed pump has to suck against |
| HIGH | Circulating-water circuit has no resistance of its own | pump passes 1.19× its bought flow | MODEL | fidelity: the circulating water pump |
| HIGH | Boil margin uses flux peaking `Fq` where enthalpy-rise peaking belongs | conservative by ~1.6× | MODEL | fidelity: enthalpy-rise peaking |
| HIGH | Fuel passing `tdmg` takes no damage | nothing until can failure or melt | MODEL | backlog 19/09/26 |
| HIGH | Failed clad releases nothing into the water or the room | no activity state at all | MODEL | backlog 19/09/26 |
| HIGH | Helium and sodium carry dissolved boron | a boron system on a coolant that holds none | MODEL | backlog 20/09/26 |
| HIGH | Feed header rings on the first ticks | 16.58 MPa, 1.42× the run's rating | UNKNOWN | fidelity: the feed train at commissioning |
| HIGH | `SC_NAT` swings on a rounding-level input change | ~1 % | UNKNOWN | backlog 18/09/26 |
| MEDIUM | No samarium-149 | ~−700 pcm at equilibrium, climbs after shutdown | MODEL | backlog 19/09/26 |
| MEDIUM | A steam generator raises saturated steam only | Calder Hall: 116 K of superheat missing | MODEL | backlog 20/09/26; fidelity: superheated steam |
| MEDIUM | CALDER HALL MWe / efficiency | 52.3 / 0.253 against 42 / 0.231 | MODEL and BUILD, not separated | fidelity: CALDER HALL against the real machine |
| MEDIUM | CALDER HALL gas flow | 1046 kg/s against 891 | MODEL | same |
| MEDIUM | CALDER HALL circuit pressure | 0.849 MPa against 0.791 | UNKNOWN | same |
| MEDIUM | CALDER HALL at rest, rods held, 3 s | 2.13 pcm, 0.46 % heat against 0 | MODEL, cause unconfirmed | fidelity: CALDER HALL at rest |
| MEDIUM | A fuel slot cannot hold moderator | Calder graphite 375 t against ~620 t | MODEL | backlog 20/09/26; fidelity: drawn rod pitch |
| MEDIUM | Steam generator stage against the exact variable-c_p law | 1237 MW against 1267 (−2.4 %) | MODEL, not weighed | fidelity: Steam generator effectiveness |
| MEDIUM | Flashing discharge near the critical pressure | 35 958 kg/s/m² against 40 380 (−11 %) | MODEL (omega's reach) | fidelity: Flashing discharge |
| MEDIUM | UO2 c_p above 2000 K | 28 % off against an 8 % band | MODEL | fidelity: fuel heat capacity |
| MEDIUM | Dispersal threshold `E_DISP_H` is UO2's, used on every fuel | metal fuel included | MODEL | backlog 20/09/26 |
| MEDIUM | Helium `gam` falls back to steam's | 1.3 against 1.667 | MODEL | backlog 19/09/26 |
| MEDIUM | MSR fuel gets clad burst, pellet melt and a UO2 pin | meaningless there | MODEL, small | fidelity: a molten-salt reactor's fuel |
| MEDIUM | Graphite has a temperature on RBMK only; MSRE and CALDER HALL blocks have none | their share reaches the coolant at once | MODEL | fidelity: graphite temperature |
| MEDIUM | No drift velocity in the drift-flux void | void −0.04 | MODEL | fidelity: ...and why it will not boil |
| MEDIUM | Non-water density curves read heavy at their operating point | 7–17 % | DRIFT | fidelity: ...and that shape |
| MEDIUM | `COOLANT[].eff` absorbs what a staged bleed would earn, so it is no longer an isentropic efficiency | bleed 33 % against 25–30 % | FIT | fidelity: the feedwater heating |
| MEDIUM | A turbine passing water takes no damage | no water-induction event | DRIFT | fidelity: a turbine with water in it |
| MEDIUM | No measurement noise; no instrument can fail | redundant channels protect against nothing | DRIFT | fidelity: the flux signal; an instrument channel |
| MEDIUM | A tank's gas charge is isothermal, a real one polytropic | a fast discharge holds pressure too long; not measured | DRIFT | fidelity: a tank's gas charge |
| MEDIUM | Dryout fade is linear in liquid fraction | the real collapse is much sharper | DRIFT | fidelity: heat into a node that has lost its water |
| MEDIUM | Sodium pool burn rate, spray fraction, water reaction rate, wastage rate | bought, unchecked | FIT, low confidence | fidelity: sodium meeting air / water |
| MEDIUM | Blast break pressures (`pburst`) mostly unsourced | no published rung for cabinets, pipe, vessels | DRIFT | fidelity: what a blast breaks |
| MEDIUM | The temperature gap across a breached wall | measured against nothing | MODEL | fidelity: what a breached containment does to the heat |
| MEDIUM | Blast near field stays in the charge cell; `ROOM_TMAX` caps the dial | region peak 10 kPa off a 5 MPa charge | MODEL, not weighed | fidelity: what the BLAST fault injects |
| MEDIUM | DNB level is bought (`P.dnbrK` on a `COOLANT.dnbr` column) | level unmeasured off rest | FIT | fidelity: departure from nucleate boiling |
| MEDIUM | Feed temperature 490 K on RBMK against ~438 K | subcooling ~6 K short | DRIFT | fidelity: a boiling core's rated flow |
| MEDIUM | BN-600 `n` moved after the core-inlet change | +1.15 %, unexplained | UNKNOWN | fidelity: the core inlet, off the field |
| MEDIUM | MSRE loop head against its guess | 25 % off, unexplained | UNKNOWN | fidelity: what the loop costs at rated flow |
| MEDIUM | STOCK circulating-water tank falls at rest | 60.0 → 59.47 % over 170 s, nobody looked | UNKNOWN | fidelity: Commissioned plant on its first tick |
| MEDIUM | After a BN-600 turbine trip with dry shells | 115 MPa turbine node, both radiators wreck | UNKNOWN | backlog 10/09/26 |
| MEDIUM | Four MSR-lattice sweep groups cook their compartment | inside 600 s | UNKNOWN | backlog 07/09/26 |
| MEDIUM | RBMK-1000 coolant and feed pump heads against a real machine | MCP ~40 % over; feed train throttles two thirds away | UNKNOWN | fidelity: ...once it IS drawn as a direct cycle |
| MEDIUM | BWR/4 first tick, worst node | 1.15e-6 of its mass against < 1e-6 | UNKNOWN | fidelity: Commissioned plant on its first tick |
| LOW | First-tick mass ledger | ~2 kg on 300 t | UNKNOWN | fidelity: ...on the first tick |
| LOW | `FLUID.temp` is labelled display-only but seeds a tank's enthalpy | — | MODEL | backlog 19/09/26 |
| LOW | A plutonium core carries U-235's delayed-neutron group shape | a few % to tens of % on long periods; no preset uses it | DRIFT | fidelity: delayed-neutron shape |
| LOW | Rod drive speed | ~2× fast | DRIFT | fidelity: rod drive speed |
| LOW | Turbine bypass 0.5 of rated steam | 25 % over a PWR, 2× a BWR | DRIFT | fidelity: a turbine bypass |
| LOW | Radiator panels oversized for the duty | loop rides ~13 K under design | DRIFT | fidelity: the radiator panels against the duty |
| LOW | The subcooling instrument is a search for the hottest liquid node, not a tapping | — | DRIFT | fidelity: where the subcooling instrument reads |
| LOW | Hydrogen autoignition taken at the low end of its band | 773 K of 773–858 | DRIFT | fidelity: hydrogen autoignition |
| LOW | Cathcart-Pawel run past its data | 77 K of extrapolation | DRIFT | fidelity: ...and the correlation's own ceiling |
| LOW | Leakage `LEAK_K`, fast fission `FAST_RHO`, moderation curve level, displacer worth `tipRho`, release fractions, hotwell depth | solved or bought levels | FIT | fidelity: Neutronics; what a failed pin releases; a condenser's hotwell |
| LOW | Pump coastdown friction constant | a guess; sets the tail's length only | low confidence | fidelity: a pump coasting after a trip |
| LOW | Pressurizer heaters | ~15 % light | — | fidelity: pressurizer heaters |
| LOW | Inertia is one lump per run: no travelling wave, no pipe-wall compliance | a surge reads ~20 % high | named | fidelity: ...and the inertia in it |
| LOW | Exchangers in series never flown | never measured | DRIFT | fidelity: how many exchangers in series |
| LOW | BWR 8×8 cell, heat outside the fuel | 2.97 % against ~4 %, the real figure unsourced | UNKNOWN | fidelity: heat deposited outside the fuel |
| LOW | MSRE fuel time constant / pellet rise | 4.93 s / 426 K against 4.09 / 353; salt film not estimated | UNKNOWN | fidelity: core heat reaches the water |
| LOW | Steady solve: cause of the pump-edge 2-cycle | costs passes, not physics | UNKNOWN | fidelity: steady solve |
| LOW | WINDSCALE's sink on the `COND_P0` floor, not re-measured | — | UNKNOWN | fidelity: Commissioned plant on its first tick |
| LOW | The axial xenon oscillation the bench warns of has never been seen | — | UNKNOWN | physics.md: Known gaps |
| LOW | Dam-break front; a gas-loaded passage under a wall holds; `LIQ_V_MAX` binds on films | front at 0.68 of √(gh) | not weighed | fidelity: water on the floor |
| LOW | Water does not feel the metal's weight; no heat into floor or wall; the flash split stands on the circuit's curve | — | not asked | fidelity: ...two liquids in one cell; ...the water's temperature |

## Presets that are not their real machine (BUILD unless stated)

| importance | preset | gap | where |
|---|---|---|---|
| HIGH | BN-600 | two circuits: primary sodium in the generator tubes (ERROR); the three-circuit build does not fly | fidelity: BN-600 has an intermediate sodium loop; backlog 07/09/26 |
| HIGH | BWR/4 | drawn through steam generators, not a direct cycle: exit quality 0.497 against 0.146, void 0.79 against 0.40, pump suctions at saturation, 3.67 pcm drift at rest, carries boron | fidelity: BWR/4 cycle; a BWR gets the coolant flow |
| MEDIUM | NUSCALE | the stock PWR coolant row and generator: 15.5 MPa / 583 K / 6.90 MPa against 12.75 / 557 / 3.5 | fidelity: NUSCALE primary and steam |
| MEDIUM | BN-600 | steam pressure 16.99 MPa against 13.5 | fidelity: BN-600 steam pressure |
| MEDIUM | RBMK-1000 | graphite time constant 150 s against ~2 h (15 kg/MW against 530) | fidelity: graphite temperature |
| MEDIUM | MSRE | the real one rejected heat to air; the whole steam cycle is this project's drawing | fidelity: feed pumps drawing straight off a hotwell |
| LOW | EPR | steam pressure 6.88 MPa against 7.5, the stock generator | fidelity: EPR steam pressure |
| LOW | STOCK PWR | primary pump bought at 1.12 MPa against a real 0.6–0.7 | fidelity: the core states its drop |
| LOW | all | sizes borrowed, never chosen (DRIFT): NUSCALE 2.8× big, MSRE 100× big, EPR 1/5 | fidelity: Plant size |
