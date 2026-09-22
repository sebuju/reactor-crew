# Performance

The continuously running sim only: stock plant (`STOCK PWR`, preset 0, n267/e268),
steady operation, operate screen. Commissioning, damage transients and other
screens are out of scope.

Machine: AMD64 Family 25 Model 97, 31 GB, node v22.14.0, win32.

## How to add a measurement

- One row per run, appended at the bottom of each table, newest last. Never edit an old row.
- `commit` = HEAD at the run, `+` if the tree had uncommitted edits, `-` unknown.
- A cell not measured in that run is `-`.
- A new phase in the per-phase table gets a new row; a new run gets a new column.
- `[n]` after a byte figure = garbage collections in the window.

## Method

- Entries: `engStep` = physics; `step` = engStep + `logDrain`; `simTick` =
  scnDue + step + `sample` every 5th tick; `+recTick` = keyframe book.
- JIT settling takes ~3000 ticks; the first windows read 5-30x high. Measure
  settled: warm 2000-3000 ticks, then a 1000-2000 tick window.
- Alloc = `heapUsed` delta plus GC-profiler freed, triple-gc first
  (`cmeasure`, `tools/stepbreak.js`). Floor ~+-400 B/tick.
- Timing: loop-mean ms/tick (includes GC, what the player feels) and
  `trBench` best-of-5 (sustainable TPS = 12 ms budget / best).

| table | command |
|---|---|
| Tick | `node --expose-gc tools/stepbreak.js 0 steady --ticks=500` |
| Per-phase | `node --expose-gc tools/stepbreak.js 0 steady --split --ticks=500` |
| Allocation | `stepbreak.js` settled chain; `node --expose-gc tools/memwatch.js 0 --ticks=2000 --warm=4000` |
| Paint | `node --expose-gc tools/framealloc.js operate 0 300 run` (and `pause`) |
| Worker link | `node --expose-gc tools/pktalloc.js 0 25 20` (and `--shm=off`) |
| Room split | `WARM=1500 node tools/stepbreak.js 0 steady --roomsplit --ticks=500`; burst `WARM=100 ... 0 burst --roomsplit --ticks=200` |

## Tick

| date | commit | loop ms/tick | bench ms/tick | TPS | max rate | massres |
|---|---|---|---|---|---|---|
| 22/09/26 | - | 2.861 | 1.474 | 488 | 9.77x | 1.8e-16 |
| 23/09/26 | fbcf02c+ | 2.732 | 1.361 | 529 | 10.58x | 1.8e-16 |

## Per-phase ms/tick

Replays one tick phase by phase in `eStepMarch` order (self-check `MATCH(ST)`).

| phase | 22/09/26 | 23/09/26+ | 22/09/26 91bcfdf+ |
|---|---|---|---|
| eRoomStep | 2.2582 | 2.4739 | 1.1822 |
| eNetFlowKA | 0.3714 | 0.4205 | 0.3736 |
| eCoreVesselStep | 0.2188 | 0.2442 | 0.2137 |
| eAdvectStep | 0.0981 | 0.1107 | 0.0980 |
| eCtlPass | 0.0519 | 0.0204 | 0.0121 |
| rest (~45 phases, each) | <=0.025 | <=0.03 | <=0.022 |
| **sum** | **3.141** | **3.445** | **2.008** |

Column `22/09/26 91bcfdf+`: `WARM=1500 ... --split`, 200-tick window (the settled alloc half overruns 10 s and was killed).

## Allocation

B/tick, settled. `ret` = retained after trailing gc.

| date | commit | engStep | step | simTick | simTick+recTick | +recTick ret | memwatch |
|---|---|---|---|---|---|---|---|
| 22/09/26 | - | 839 [0] | 391 [0] | 427 [0] | 426 [0] | 176 | 421.2 [0] FAIL |
| 23/09/26 | fbcf02c+ | 870 [0] | 386 [0] | 427 [0] | 426 [0] | 175 | 390.0 [0] FAIL |
| 22/09/26 | 91bcfdf | - | - | - | - | - | 875.4 [0] FAIL (warm 2500, 1000 ticks) |
| 22/09/26 | 91bcfdf+ | - | - | - | - | - | 568.8 [0], 587.2 [0] FAIL (warm 2500, 1000 ticks) |
| 22/09/26 | 1e476e6+ evict fix | - | - | - | - | - | 592.9 [0], 586.8 [0] FAIL (warm 2500, 1000 ticks) |
| 22/09/26 | 1e476e6+ evict fix, no `clamp` in `src/eng/` | - | - | - | - | - | 844.4 [0], 782.5 [0] FAIL (warm 2500, 1000 ticks); state digest identical. Cause: `eRodApply` grew past V8's 460-byte inlining limit (`--max-inlined-bytecode-size`; it sat at exactly 460) and stopped inlining into `eSinkApply` |
| 22/09/26 | 1e476e6+ as above, split-bank step moved to `eRodSplitStep()` | - | - | - | - | - | 554.8 [0], 532.3 [0], 619.6 [0] FAIL (warm 2500, 1000 ticks) against the row-before tree re-read 628.8, 626.4, 586.9; `eRodApply` 432 bytes, inlined again; digest identical |

The two 22/09/26 memwatch rows use warm 2500 / 1000 ticks, since the 4000 / 2000 default does not fit a 10 s run;
at 2000 warm the same tree reads 1237 B/tick, so these are not comparable with the rows above.

engStep above step is noise (same snapshot, same physics). `+recTick` retained
is take book-keeping. memwatch target is eps=0.

Per-phase suspects (`--phasealloc`, frozen state, ranks only), B/call:

| phase | 22/09/26 |
|---|---|
| eCtlPass | 699 |
| eCoreVesselStep | 305 |
| eActFollow | 200 |
| eBoronFollow | 120 |
| eAdvectStep | 33 |
| rest (each) | <=19 |

## Room split

ms/tick inside `eRoomStep`, each named function timed in the bundle text (self time). `live` = ticks the gas
pressure solve ran; `CG it` = mean conjugate-gradient iterations on those ticks.

| date | commit | scen | simTick | eCgSolve | eRoomAdvect | ePhiFill | eRoomMolFill | eRoomStep incl | live | CG it |
|---|---|---|---|---|---|---|---|---|---|---|
| 22/09/26 | 91bcfdf | steady | 2.706 | 0.9834 | 0.1925 | 0.1062 | 0.0625 | 1.9478 | 135/500 | 85.3 |
| 22/09/26 | 91bcfdf+ | steady | 1.919 | 0.3032 | 0.0468 | 0.1101 | 0.0420 | 1.1324 | 135/500 | 11.1 |
| 22/09/26 | 91bcfdf | burst | 14.137 | 4.3167 | - | - | - | 12.8478 | 200/200 | 63.1 |
| 22/09/26 | 91bcfdf+ | burst | 10.555 | 1.7831 | - | - | - | 9.2654 | 200/200 | 9.5 |

## Paint (operate screen)

60 warm frames. run = ticks + paint; pause = paint only.

| date | commit | run ms/frame | run B/frame | pause ms/frame | pause B/frame |
|---|---|---|---|---|---|
| 22/09/26 | - | 4.10 | 46874 [0] | 0.83 | 35062 [0] |

## Worker link

500 ticks in 20 frames, 3000 warm, 37 channels.

| date | commit | path | worker B/tick | packet B/frame | page clone B/frame | page apply B/frame |
|---|---|---|---|---|---|---|
| 22/09/26 | - | shm | 939.7 | 2178 | 3360 | 875 |
| 22/09/26 | - | clone | 920.5 | 2880 | 4087 | 849 |
| 23/09/26 | fbcf02c+ | shm | 798.0 | 2173 | 3360 | 875 |

## Copies

Sizes, not trends; update in place when the layout changes.

- Snapshot 2554 kB (state 455 + scratch 2099, of which the room solve's coarse Cholesky band `SX.cgL` is 148 kB).
- Keyframe every ~250 ticks, pool capped at 24 MB (~9 keys); ~2.5 MB memcpy
  per keyframe, alloc ~0 once warm.
- SHM double buffer 2 x 2554 kB; full copy only when the tick advanced.
- Trend archive ~73 B/tick retained (37 channels x 8 B + 4 B tick, every 5
  ticks), chunked at 4096 samples.
