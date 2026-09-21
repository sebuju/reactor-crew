## Architecture

All testing is against real-world physics, never against a number a simulation once printed (see
`.claude/CLAUDE.md`).

**The canvas draws the plant. Everything else is HTML + CSS.** Canvas: grid, `drawSym()` symbols,
pipes and packets, `coreField()`, damage marks, control strips, lattice plan, core section, strip
chart. Pan/zoom via `VIEW`.

- Screens build DOM **once** (`xBuild()`) and sync only what changed (`xSync()`). Never per frame.
- Screen visibility is one dataset write: `layout()` sets `document.body.dataset.screen`.
- `#scr-operate` / `#scr-design` / `#scr-scenario` are mount points. Append; never write `innerHTML`.
- Canvas covers `y = TOPBAR_H..H`. `resize()` offsets the transform, `local()` undoes it.
- Panels dock in **rails** beside the plant; clicking a component brings its panel up.

### Plant view layers

`LAYERS` (`src/render/layers.js`) is every overlay on the plant grid — one row per layer
(`label`, `tip`, `seam`, `data`, `live`, `on`, `draw`). Switches, tooltips and draw passes are all
generated from it: **adding a layer is adding a row.**

- **A LAYER MUST NOT SOLVE.** No solve entry point may appear in a layer file at all.
  `drawPlant()` refreshes the field once a frame (`pipeFieldRefresh()`, `pipes.js`); PRESSURE and
  SUBCOOLING just read it.
- `seam: "under"` = a field in the room (drawn before the component loop, so it never lands on a
  value tag and shows only cells a repair party can stand in). `seam: "over"` = annotates one
  component.
- `data` is a memo key — layers sharing an id share one solve per frame. `live` marks a layer that
  needs `S`; the bench skips it.
- **`on` is the shipping default.** Radiation, the three room layers, `press`, `subc` and `flow` all start off; a layer that ships on says so in its row.
- Row geometry is `rowTop()`, which is a flat `GY+Y*CELL` on both screens: a machine declares the cells its own controls need, so no row is stretched and `BANDS` is gone.

### The engine (`src/eng/`)

The sim is one state buffer, a set of plant tables, and a tick that reads one and writes the other.

- **State.** `SCHEMA` (`src/eng/schema.js`) declares every field once: name, element type, dimension,
  initial value, and whether it is state or tick scratch. `engAlloc(PT.n)` lays the state rows out in
  one `ArrayBuffer` (a `SharedArrayBuffer` where the page allows it) and exposes them as typed views on
  `ST`; plant scalars are slots of `ST.sc` named `SC_<NAME>`. Scratch rows live in `SX`, in their own
   buffer. A snapshot is a byte copy of the state buffer plus the scratch buffer
   (`engSnap()`/`engRestore()` cover `ST` and `SX`; 21/09/26: scratch holds CG guesses and
   mark counters that steer rounding paths, and without them a resumed run diverges
   chaotically from a straight one), so a recording keyframe, `P.snap0` and a dump are the
   same thing.
- **Plant tables.** Commissioning's design half (`commissionGen()`: layout, `netBuild()`) runs on the
  drawing. `engBuild()` then compiles `P`, `P.net`, `LAY` and `D` into `PT`:
  kind lists, per-kind columns, the network as node and edge columns with every edge that could ever
  exist, room geometry, core constants, the cabinet as columns. `IX` maps ids to indices for the UI and
  for `act()`. Nothing in the tick sees a string.
- **Reference solves.** `eNetRef()` (`src/eng/ref.js`) solves the design point on the engine's own
  steady solve (`eSettleSteady()`): nominal bores (`P.netRef`), drawn bores (`P.netRefByRun`, the feed-valve
  fit `P.fregRef` off `eFeedFit()`, `P.cwRefBy`) and every pump turning (back-fill). Commissioning builds first on the
  design's own ask, solves, then rebuilds on the answers; the rebuild may not move `PT.n`.
- **Settle and tick.** `engSettle()` finds the commissioned rest point with the tick's own functions
  (rest settle, tube fit, shell pressures, condenser, feed valves, boron). Every steady field it and the
  references stand on is `eSettleSteady()`: held, direct factorisation, solved until still. `engStep(dt)` marches one
  tick in a fixed order: cabinet, rods and core, network solve, transport and books, pumps, stages and
  shells, turbines and panels, kinetics and melt, room, damage, events, ledger. `engReset()` restores the
  commissioned buffer.
- **Allocation.** Tick code allocates nothing: no literals, closures or strings, and doubles cross
  non-inlined calls through fixed `Float64Array` registers rather than as return values.
- **Events.** The tick writes `(code, tick, a, b)` rows into a ring on the state; `logDrain()` turns them
  into log lines on the UI side.
- **UI.** Screens and renderers read `ST` directly or through `src/eng/read.js` (`ui*`, ids in, values
  out). Every order goes through `act()` by index; `actId()` resolves the ids.
- **Worker.** `shm.js` moves one byte copy of the state buffer per frame; the viewer's buffer layout
  must match the worker's. The trend ring is a second shared buffer the page reads in place, `HIST_GUARD`
  samples short of the writer; without shared memory the packet carries the new samples packed, the whole ring on a jump.
