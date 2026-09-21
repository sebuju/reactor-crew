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

- 21/09/26 - A snapshot restore on BWR/4 (preset 2) is not the run it came from: `tools/natsplit.js 2 slice rest` splits `holdPBy[2]` (6.8456 vs 6.8466 MPa) 24 ticks after the first restore at tick 250, while presets 0 and 1 stay byte-identical over 3000 ticks. Some state that carries a tick escapes the snapshot on that plant; not traced. Presets 3-8 not run.
- 21/09/26 - The 120 s marches of BN-600 and MSRE (`presets.js 3`, `6`) are not reproducible to rounding: a 2e-16 nudge to HEAD moves BN-600 heat balance 1.112 -> 0.984 and MSRE 1.086 -> 0.999. Their 120 s readings are noise until those plants settle; cause not found. 21/09/26: seeding a part-filled node's flow-work pressure on the tick's own law (a correct fix, every preset) moved MSRE's lowest armed steam-line pressure 0.947 -> 0.481 of design and BN-600's core from 692 to 786 MW at 120 s; MSRE's turbine trips on condenser backpressure 0.10 s after commissioning, no orders given, with and without that fix.
- 20/09/26 - Credit the bleed the expansion work from throttle to extraction pressure and put `COOLANT[].eff` back to a real isentropic efficiency; every preset's MWe moves.
- 20/09/26 - A steam generator shell raises saturated steam only; a gas-cooled plant's exchanger superheats its steam (Calder Hall's H.P. steam left at 313 C and 210 psia, 116 K over saturation).
- 19/09/26 - No samarium-149: a real core carries about -700 pcm of it at equilibrium, and after a shutdown it climbs and never decays away (promethium-149 feeds it, it is stable). The kinetics carry xenon and iodine only.

## Other

- 21/09/26 - Steam-line and feedwater isolation on a secondary break: a real PWR closes its main steam isolation valves and isolates feed on low steam-line pressure or high containment pressure within seconds; the cabinet has no sink that shuts a steam-line valve, and no preset wires either isolation.
- 19/09/26 - The paint-garbage sweep (`tools/framealloc.js`, `tools/paintsig.js`) covered OPERATE on the stock plant only; the design, scenario and help screens have not had it.
- 10/09/26 - BWR/4 as a direct cycle, so the presets show a boiling-core plant without a boron-held two-loop stand-in: its drum is the VESSEL itself, a steam nozzle on the core's own node, which `separates()` already covers - a different node from `drumIds()`, which only answers for a tank.
- 08/09/26 - PUMP RATED FLOW and SG TRANSFER COEFFICIENT are the two figures `designBake()` will not state (`keep`). Pump flow, because `pumpBoxCap()` reads the STORED flow and the box grows under pipework already routed round it: measured on BWR/4 the circulating water pump (12529 kg/s) goes 3x5 to 4x6 (re-trace unchecked); SG UA for a different reason, that commissioning walks an unstated UA onto rated power (`eSettleUA()`) and a stated one stands the trim down (stock: UA 55314 stated vs 45701 walked kW/K, node mass moved 83 kg).
- 07/09/26 - The three-circuit BN-600 preset, so the presets show a sodium plant with its intermediate loop, is written and no preset sets it: `buildStockPlumbing({inter:true})` places the exchanger, the intermediate pump and its expansion tank and forms the circuits with the barrier intact, and at `loops:1` it lays clean and flies 300 s, but the exchanger passes 15-18 MW against a rated 1176, the shell never leaves its 421.5 K seed and the plant makes 0 MWe. At `loops:3` it is 3 runs refused and 6 dangling ends, 0 orphans (re-measured 07/09/26 on the router; it was 4 butted ports and 106 orphaned cells). A chain of stages is already carried by `ihxFeeds()`, `nodeGraph()` and `circName()` unchanged, but nothing on the board will fly one.
