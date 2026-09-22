# Performance

Stock plant only (`STOCK PWR`, preset 0, n267/e268). Continuous paths only:
`simTick`/`step`/`engStep`, `simFrame`+`recTick`, paint, trend/record, worker link.
Commissioning is one-time and listed for context, not optimized.

Machine: AMD64 Family 25 Model 97, 31 GB, node v22.14.0, win32.
All commands need `node --expose-gc`. Dates are dd/mm/yy.

## Method (read before quoting a number)

- Entries: `engStep` = physics only; `step` = engStep + `logDrain`;
  `simTick` = scnDue + step + `sample` every 5th tick; `+recTick` = keyframe book.
- JIT settling takes thousands of ticks: the first ~3000 invocations of an entry
  measure 5-30x higher than settled (e.g. engStep 13426 -> 7008 -> 3835 B/tick
  over three identical 500-tick windows). Alloc figures below are settled unless
  marked early-window: own-warm 2000-3000 ticks, then a 1000-2000 tick window.
- `measure()` (tools/bundle.js) counts `heapUsed` delta plus GC-profiler freed.
  One pre-gc leaves freed-during-window contamination (+98 kB/tick seen); the
  tools here triple-gc first (`cmeasure` in tools/stepbreak.js).
- Timing has two figures: loop-mean ms/tick (includes GC stalls, what the player
  feels) and `trBench` best-of-5 ms/tick (sustainable TPS = 12 ms budget / best).
- Damage states evolve: burst/shut/h2 numbers are window-local. WARM = ticks
  marched after the damage before measuring; settled warm/measurement windows
  follow. Same scenario at different ticks can differ 10x - see shut early/late.
- Headless runs the full bundle; workerRealm (pktalloc) runs the sim subset.
- `drain`/`smp`/`rec` columns are sub-ms subtraction noise unless stated.

## Tick overview (stock, 22/09/26)

`node --expose-gc tools/stepbreak.js 0 <scen> --ticks=500`
(SWARM=3000/SMEAS=2000 settled alloc; burst full-window row; shut-late/h2-late
are separate runs, see notes)

| scen | commiss | snap | loop ms/tick | bench ms/tick | TPS | max rate | alloc simTick | alloc engStep | massres |
|---|---|---|---|---|---|---|---|---|---|
| steady | 993 ms | 2406 kB | 2.861 | 1.474 | 488 | 9.77x | 426 B/t [0] | 420 B/t [0] | 1.8e-16 |
| burst (pipe:18,16) | 923 ms | 2406 kB | 17.055 | 15.550 | 46 | 0.93x | 2588 B/t [5] | 2572 B/t [4] | 1.4e-16 |
| shut-early (~500t) | - | 2406 kB | ~3.8 | - | - | - | 14200 B/t [13] | 268578 B/t [16] | - |
| shut-late (3000+t) | 920 ms | 2406 kB | 10.846 | 9.593 | 75 | 1.50x | 317 B/t [0] | 1308 B/t [0] | 4.3e-16 |
| h2-early (~500t) | - | 2406 kB | ~5.6 | - | - | - | 643 B/t [0] | 1078 B/t [0] | - |
| h2-late (3000+t) | 1046 ms | 2406 kB | 4.532 | 4.499 | 160 | 3.20x | 92004 B/t [161] | 11515 B/t [22] | 3.5e-16 |

Notes:

- Burst cannot hold 1x: 46 TPS sustainable, and a reduced-window run
  (SWARM=800/SMEAS=600) measured 16.967 ms/tick with simTick alloc 162461 B/t
  [94 GCs] - the damage state was further evolved. Burst numbers are the least
  stable in this file.
- `drain` (logDrain over engStep) reads ~0 steady but 0.213 ms/tick h2-late:
  event storms cost real time, not just bytes.
- `+recTick` over simTick reads ~0 ms/tick everywhere (keyframe memcpy
  amortized) but retains ~150-190 B/tick (take book-keeping).
- ticktime (22/09/26): `node --expose-gc tools/ticktime.js 0 3000` ->
  commission 928 ms, tick 2.969 ms, heap +582 kB over 3000 ticks
  (~194 B/tick retained).

## Per-phase ms/tick (stock, 22/09/26)

`node --expose-gc tools/stepbreak.js 0 <scen> --split --ticks=<N>` replicates
one tick phase by phase in `eStepMarch` order and times each over 200 ticks.
Self-check `phased-vs-straight MATCH(ST)`: straight and replicated runs agree
bit-exactly over the state region for 60 ticks. (Scratch disagrees on ~15 SX
bytes even straight-vs-straight from one restored snapshot - see plan-perf
P11. WARM=200 for early tables, WARM=3000 for shut-late.)

### steady (sum 3.141 ms)

| phase | ms/tick | share |
|---|---|---|
| eRoomStep | 2.2582 | 71.9% |
| eNetFlowKA | 0.3714 | 11.8% |
| eCoreVesselStep | 0.2188 | 7.0% |
| eAdvectStep | 0.0981 | 3.1% |
| eCtlPass | 0.0519 | 1.7% |
| eEvLatchStep | 0.0242 | 0.8% |
| eBlastStep | 0.0173 | 0.6% |
| eRadDose | 0.0081 | 0.3% |
| eBurstDice | 0.0078 | 0.2% |
| eCookStep | 0.0073 | 0.2% |
| eMachPreSolve | 0.0056 | 0.2% |
| eSgHeatStep | 0.0055 | 0.2% |
| eCoreMeltStep | 0.0053 | 0.2% |
| eMarginStep | 0.0052 | 0.2% |
| eSumpStep | 0.0051 | 0.2% |
| eTurbStep | 0.0048 | 0.2% |
| eShellStep / eLedgerA1 / eInvStep / eOverpressureStep / eLedgerA0 | ~0.003 | 0.1% each |
| eSgtrStep / eCavStep / eRadPanelStep / rest (33 phases) | <=0.003 | <=0.1% each |

### burst (sum 12.543 ms, pipe:18,16)

| phase | ms/tick | share |
|---|---|---|
| eRoomStep | 11.4296 | 91.1% |
| eNetFlowKA | 0.4384 | 3.5% |
| eCoreVesselStep | 0.2795 | 2.2% |
| eAdvectStep | 0.1149 | 0.9% |
| eCtlPass | 0.0600 | 0.5% |
| eSumpStep | 0.0530 | 0.4% |
| eEvLatchStep | 0.0284 | 0.2% |
| rest | <=0.02 | <=0.2% each |

### shut-early (sum 3.805 ms, port prt0)

eRoomStep 2.7298 (71.7%), eNetFlowKA 0.3837 (10.1%), eCoreVesselStep 0.3680
(9.7%), eAdvectStep 0.1113 (2.9%), eCtlPass 0.0550 (1.4%), rest <=0.03.

### shut-late, WARM=3000 (sum 10.769 ms)

eRoomStep 9.5800 (89.0%), eNetFlowKA 0.4512 (4.2%), eCoreVesselStep 0.3404
(3.2%), eAdvectStep 0.1209 (1.1%), rest <=0.07. The room step grows ~7 ms
between early and late with no extra allocation (chain: engStep 1308 B/t
[0]) - pure compute growth, likely solver iterations (SC_LIQCGIT /
SC_ROOMCGIT unrecorded - plan-perf P0).

### h2-early (sum 5.574 ms)

eRoomStep 4.4357 (79.6%), eNetFlowKA 0.4494 (8.1%), eCoreVesselStep 0.2660
(4.8%), eAdvectStep 0.1251 (2.2%), eCtlPass 0.0726 (1.3%), eEvLatchStep 0.0492
(0.9%), rest <=0.021.

## Allocation (stock, 22/09/26)

### Settled per entry, steady (warm 2000 + window 1000, triple-gc)

| entry | B/tick | collections | retained B/tick |
|---|---|---|---|
| engStep | 839 | 0 | 2 |
| step | 391 | 0 | 5 |
| simTick | 427 | 0 | 6 |
| simTick+recTick | 426 | 0 | 176 |

engStep reading above step is measurement noise (identical physics from one
snapshot; floor ~+-400 B). Retained is trailing-gc. simTick retained reads
low when no trend-archive chunk boundary lands in-window; +recTick retained is
take book-keeping (keyframe buffers are pooled, ~0 amortized once warm).

### Settled per entry, off-steady (same method)

| scen | engStep | step | simTick | +recTick |
|---|---|---|---|---|
| burst | 78277 [4] / ret 143 | 4916 [4] / ret 8 | 4954 [4] / ret 18 | 4977 [4] / ret 162 |
| shut-early | 268578 [16] / ret 27 | 15184 [15] / ret 10 | 14200 [13] / ret 7 | 14115 [13] / ret 173 |
| shut-late | 1308 [0] / ret 23 | 457 [0] / ret -9 | 317 [0] / ret -12 | 363 [0] / ret 187 |
| h2-early | 1078 [0] / ret 9 | 541 [0] / ret 10 | 643 [0] / ret 18 | 616 [0] / ret 154 |

The engStep-first row inflates (method artifact under study); the ordering
still ranks: crisis windows allocate 10-270 kB/tick, settled damage ~0.3-5
kB/tick, steady ~0.4 kB/tick.

### Per-phase alloc locator, steady (`--phasealloc`, frozen state)

300 phased warm ticks, then 500 direct calls per phase. Frozen-state calls
over/understate live (no tick advance), so this ranks suspects, it does not
attribute. Floor ~0.5, tool overhead ~70 on tickHead/kinIn (M-access).

| phase | B/call |
|---|---|
| eCtlPass | 699.4 |
| eCoreVesselStep | 304.5 |
| eActFollow | 199.7 |
| eBoronFollow | 120.0 |
| eAdvectStep | 32.5 |
| eRadDose | 19.1 |
| rest | <=8 |

### Per-phase alloc locator, burst

| phase | B/call |
|---|---|
| eRoomStep | 112634.1 [54 GCs] |
| eCoreVesselStep | 4496.5 [2] |
| eCtlPass | 927.6 |
| eActFollow | 199.7 |
| eBoronFollow | 120.0 |
| rest | <=80 |

### Per-phase alloc locator, shut-early

eCoreVesselStep 334310.0 [162 GCs]; eCtlPass 704.1; rest <=200. The vessel
step's void/dryout branches allocate enormously in a narrow transient window
(roomsub4 at +400 ticks measured eCoreStep 4437 B/call vs 334 kB/call at the
crisis tick - same scenario, different tick).

### eRoomStep bisection, burst (in-memory patched bundles, disk untouched)

Cumulative prefixes, frozen-state, 200 calls each:

| prefix | B/call |
|---|---|
| head (gas+phi+parts+rseg) | 998 |
| +relief/vent/h2/openings (plumes) | 5315 |
| +fire (eFireStep, incl 2x eLiqStep) | 29890 |
| full (tail: fans, stencil, eddy, exchange, structure, eH2Step, eFpRoomStep, eCondense) | 266881 [3] |

Sub-probes: eLiqStep0 (water body) 373425 [4], eLiqStep1 22,
eScarStep 11010, eLqWriteP 6613, eLqSurfA 188, eH2Step/eCondense/eFpRoomStep/
eGasStep/ePhiFill/eLqBind/eRoomLive ~20. eFireStep standalone measured
370312 [71] (fire grows unboundedly without sibling steps - harness-inflated,
live figure is the 25 kB prefix delta). The tail's 237 kB is unlocalized to a
line: every helper inspected (plume, spreaders, CG, faces, advect, gas, mix,
tables) is register-clean - plan-perf P2 tracks the exact site.

### Early-window allocprobe (existing tool, WARM=200 + 1000 ticks, 22/09/26)

`node --expose-gc tools/allocprobe.js 0 <N> <scen>` - JIT-unsettled, records
the first seconds after damage, not the settled plant:

| scen | B/tick |
|---|---|
| steady | 10489.3 [0] |
| burst | 84462.9 [5] |
| shut | 148603.0 [8] |
| h2 | 10604.1 [0] |

### Gate: memwatch (22/09/26)

`node --expose-gc tools/memwatch.js 0 --ticks=2000 --warm=500` -> FAIL:
9114264 B over 2000 ticks = 4557.1 B/tick, 0 collections, eps=0. The gate's
warm (500) never reaches JIT settle (~3000+); against the settled 427 B/tick
it fails on warm-up, not on the plant. Plan-perf P9.

## Paint (stock, 22/09/26)

`node --expose-gc tools/framealloc.js <screen> 0 <N> <mode>` (N=300 operate,
200 design/scenario; 60 warm frames; ms/frame added this pass):

| screen | mode | ms/frame | B/frame |
|---|---|---|---|
| operate | pause | 0.83 | 35062 [0] |
| operate | run | 4.10 | 46874 [0] |
| operate | burst | 11.91 | 90547 [1] |
| design | pause | 0.43 | 52662 [0] |
| design | run | 0.49 | 53817 [0] |
| scenario | pause | 0.00 | 2622 [0] |
| scenario | run | 2.82 | 16599 [0] |

run advances the wall clock (ticks + paint); pause is paint only. Design
paints cheap (0.43 ms) but allocates the most paused (53 kB/frame).
Operate-burst paints 12 ms and 90 kB/frame. Scenario-pause paints ~nothing.

## Worker link (stock, 22/09/26)

`node --expose-gc tools/pktalloc.js 0 25 20` (500 ticks in 20 frames, 3000
warm; all ring checks PASS, 37 channels):

| path | worker B/tick | packet B/frame | page clone B/frame | page apply B/frame |
|---|---|---|---|---|
| shared memory | 939.7 | 2178 | 3360 | 875 |
| clone (`--shm=off`) | 920.5 | 2880 | 4087 | 849 |

Packet = worker-side build, clone = `structuredClone` on the page, apply =
`simApply`. Trend ring verified sample-exact worker-vs-page across
live/seek/branch.

## Copies (stock, 22/09/26)

- Snapshot 2406 kB (state + scratch; was state-only before 21/09/26).
- Keyframe every ~250 ticks into a pool capped at 24 MB (~10 keys stock);
  pool-warm amortized alloc ~0, memcpy ~2.4 MB per keyframe.
- SHM double buffer 2 x 2406 kB; `shmPush` copies the full snapshot per
  packet (per paint) - at 60 fps that is ~144 MB/s memcpy (plan-perf P7).
- Trend archive ~73 B/tick retained (37 channels x 8 B + 4 B tick, every 5
  ticks); chunked (4096 samples) so short windows straddling a boundary read
  kB/tick - a measurement lump, not a cost.
- `P.snap0` one more snapshot per commission.

## Coverage and repairs this pass (22/09/26)

- New `tools/stepbreak.js`: settled ms/tick matrix, per-phase timing with
  MATCH(ST) self-check, per-phase alloc locator, settled per-entry chain.
- `tools/framealloc.js`: prints ms/frame beside B/frame.
- `tools/pktalloc.js` was broken (snapshot now covers state+scratch, shm and
  clone paths still sent state-only -> every packet threw; live worker mode
  and `simFrame` past 250 ticks were broken the same way). Fixed with
  `engSnapLen()` (src/eng/alloc.js) used by keyframe pool (src/sim/record.js),
  shm push/pull (src/sim/shm.js), worker packet (src/sim/runworker.js) and
  snapshot load (src/ui/dump.js). Verified: 600 simTick+recTick, pktalloc both
  paths PASS.
- Covered, continuous: simTick/step/engStep x steady/burst/shut/h2(+pipe:),
  per-phase timing+alloc, paint x operate/design/scenario x pause/run/burst,
  worker x shm/clone, memwatch gate, ticktime, allocprobe.
- Not continuous, not covered: commissioning (one-time), scenario drain
  (transient), design-bench edits (on demand).
