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

## Tick

| date | commit | loop ms/tick | bench ms/tick | TPS | max rate | massres |
|---|---|---|---|---|---|---|
| 22/09/26 | - | 2.861 | 1.474 | 488 | 9.77x | 1.8e-16 |
| 23/09/26 | fbcf02c+ | 2.732 | 1.361 | 529 | 10.58x | 1.8e-16 |

## Per-phase ms/tick

Replays one tick phase by phase in `eStepMarch` order (self-check `MATCH(ST)`).

| phase | 22/09/26 | 23/09/26+ |
|---|---|---|
| eRoomStep | 2.2582 | 2.4739 |
| eNetFlowKA | 0.3714 | 0.4205 |
| eCoreVesselStep | 0.2188 | 0.2442 |
| eAdvectStep | 0.0981 | 0.1107 |
| eCtlPass | 0.0519 | 0.0204 |
| rest (~45 phases, each) | <=0.025 | <=0.03 |
| **sum** | **3.141** | **3.445** |

## Allocation

B/tick, settled. `ret` = retained after trailing gc.

| date | commit | engStep | step | simTick | simTick+recTick | +recTick ret | memwatch |
|---|---|---|---|---|---|---|---|
| 22/09/26 | - | 839 [0] | 391 [0] | 427 [0] | 426 [0] | 176 | 421.2 [0] FAIL |
| 23/09/26 | fbcf02c+ | 870 [0] | 386 [0] | 427 [0] | 426 [0] | 175 | 390.0 [0] FAIL |

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

- Snapshot 2406 kB (state + scratch).
- Keyframe every ~250 ticks, pool capped at 24 MB (~10 keys); ~2.4 MB memcpy
  per keyframe, alloc ~0 once warm.
- SHM double buffer 2 x 2406 kB; full copy only when the tick advanced.
- Trend archive ~73 B/tick retained (37 channels x 8 B + 4 B tick, every 5
  ticks), chunked at 4096 samples.
