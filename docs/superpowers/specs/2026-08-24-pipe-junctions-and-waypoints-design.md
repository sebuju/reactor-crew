# Pipe junctions and waypoint-steered auto-routing

Status: design spec, not yet implemented. Architectural — no code changes have
been made under this spec.

## 1. Context and motivation

The design bench already lets a player fit or remove CONTAINMENT, the
ACCUMULATOR, the TURBINE and the CONDENSER from the grid (`FITTABLE` in
`src/data/layout.js:27-34`, added this session). The next piece is giving the
player a way to buy real flow redundancy between coolant loops — a physical
cross-tie valve — instead of redundancy being an invisible property of the
flow model.

Today it already *is* invisible: every loop shares one flow number (`pumpK` in
`src/sim/step.js:425-426`), so losing one pump out of three quietly costs a
third of total flow everywhere, as if every loop were already perfectly
cross-tied. There is no way to make that better or worse. A cross-tie valve
that the player can fit, and open or close, turns that into a real design and
operating decision: tie two loops and a dead pump on one is propped up by the
other; leave it closed and a leak in one loop cannot drain the other.

A cross-tie needs a pipe connecting it to the loops it bridges. That raised
the second half of this spec: how the pipe gets drawn. The rejected option is
letting the player draw pipes by hand from scratch — raised and set aside
explicitly, on the grounds that hand-rolled pathfinding has a history of never
quite working ("burned many times... they never do"). Everything here is built
to keep the existing two-point router in charge and give the player a way to
*steer* it — a point it must pass through — rather than a way to replace it.

## 2. Current system, precisely

**Routing is a two-point orthogonal router, not a search.** `route(p,sa,q,sb,o)`
(`src/data/layout.js:223-250`) connects exactly one face of one part to one
face of another, with a single bend, and consults a lane registry
(`laneReg()`, `src/data/layout.js:149`) to keep parallel runs from overlapping.
`port(p,side,slot,n,shift)` (`layout.js:114`) finds where on that face the
run's nozzle sits when several runs share a face. `bendAt(a,b,vert,skip,reg)`
(`layout.js:176-202`) picks where same-direction runs bend, penalising a
bend that would cross another component or another pipe. None of this is a
graph search — it is a fixed, deterministic geometric construction, unlike
the A* leader-router the bench plates use for their callouts. That matters
here: a waypoint cannot be "one more open list to search", because there is
no search. It has to be "call the same two-point router twice."

**Topology is declared once per frame, not persisted.** `pipeNetwork()`
(`layout.js:274-323`) rebuilds the whole connection list from `LAY.parts`
every call: a local `link(k,a,sa,b,sb)` pushes `{k,a,sa,b,sb}` onto a `conn`
array (`layout.js:277`), one call per physical run — for example
`link("hot",core,"r",sg,"l")` once per loop (`layout.js:281`). **Every hot leg
across every loop shares the literal kind string `"hot"`.** There is no
per-run id today beyond that shared kind — `net.push({k:c.k,pts})`
(`layout.js:320`) carries nothing else forward. That is fine for the existing
kinds, because they are all either singular (`"exh"`, `"surge"`) or physically
identical across loops (`"hot"`, `"cold"`) and are meant to animate as one.
It is not fine for waypoints, which must attach to one specific physical run.
Section 5 below defines a real per-run key.

Every connection is optional-part-safe already: `if(tb) link("steam",...)`,
`if(tb&&cd) link("exh",...)`, `if(hp&&fitted(hp)) link("hpi",...)`
(`layout.js:284,291,293`). An absent part just drops its link; nothing reads
an undefined part without checking it first. The new cross-tie link follows
the identical shape.

**Flow is one integrated scalar per kind, not per physical run.**
`s.flowPos[k]` (`src/sim/core2d.js` state, initialised at `step.js:301`)
counts up every tick in the pipe-animation block (`step.js:637-659`), e.g.
`d.hot+=sp*feff*1.4` (`step.js:646`). The renderer never invents a rate — it
differentiates this same integral (`pipeRate()`, `src/render/pipes.js:137-151`)
so the packets on screen and the flow-meter needles can never disagree
(`pipeFmt`, `pipeDial`, `src/render/pipes.js:171-175,273-310`). A new kind
needs one more line in that block, gated on whether it is actually flowing.

**Lost-pump flow, today, is plant-wide.**
```
src/sim/step.js:425  let lost=0; for(const k of s.dmgParts) if(k.startsWith("pump")) lost++;
src/sim/step.js:426  const pumpK = Math.max(0,(P.loops-lost)/P.loops);
src/sim/step.js:437  const driven = s.flow * P.flowK * pumpK;
```
`pumpK` is exactly "fraction of loops with a working pump", averaged across
*all* loops unconditionally. Section 3 keeps this exact formula as the
zero-cross-tie special case.

**The add/remove precedent (`FITTABLE`) and the drag-override precedent
(`plateOff`) already exist and are what this design reuses:**
- `FITTABLE` (`layout.js:27-34`) is a table of `{id,label,get,set}`; `fitOf(id)`
  and `fitSig()` (`layout.js:33-34`) read it to gate `buildLayout()`'s `add()`
  calls (e.g. `layout.js:60`) and to know when to rebuild
  (`layoutMetrics()`, `layout.js:367`). The right-click menu
  (`ctxItems()`/`drawCtxMenu()`, `src/screens/design-bench.js:212-233`) is
  generated from this same table.
- `plateOff` (`layout.js:42`) is "auto-packed position, plus whatever offset
  the player dragged it by" — never an absolute point, because the packer
  runs fresh every frame. `type:"plate"` widgets (`src/core/ui.js:381-384`)
  double-click to `delete plateOff[w.id]`, handing the plate back to the
  packer. This is the literal gesture vocabulary Section 5 reuses for pipes:
  auto by default, grab to override, double-click to reset.

## 3. Physics: per-loop flow, cross-tie grouping

Each loop's own pump status becomes its own availability:
```
loopUp[i] = s.dmgParts.includes("pump"+i) ? 0 : 1
```
Two loops with an **open** cross-tie between them are one shared-flow group;
every other loop is a group of one. A group's flow fraction is the average of
`loopUp` over its members — the same formula `pumpK` already uses, just scoped
to the group instead of always being every loop. The blended figure that
replaces `pumpK` is the mean, over all loops, of that loop's own group
fraction:
```
overallPumpK = mean over i of groupFraction(group containing loop i)
```

**This is provably identical to today's formula when no cross-tie is open.**
With zero open ties every group is a singleton, so `groupFraction(loop i) ==
loopUp[i]`, and `overallPumpK == mean(loopUp) == (P.loops - lost) / P.loops`
— algebraically the same `pumpK` on `step.js:426`, not just close to it. This
is a correctness requirement, not a nice-to-have: `tools/audit-physics.js`
asserts specific figures for a default plant at rest (`n≈89.2%`, `Tf≈903K`,
`DNBR≈1.76`, per `CLAUDE.md`'s physics-invariants section), and the default
plant fits zero cross-ties (see Section 4 on default-closed). Those figures
must not move by so much as a rounding digit. The way to verify this is exactly
`node tools/audit-physics.js` before and after — byte-identical output, one
new count line at most, is the same bar the auditor already holds itself to
per its own `CLAUDE.md` documentation.

**Grouping is graph connectivity, nothing fancier.** Model the loops as nodes
0..`D.loops`-1 and each *open, fitted* cross-tie `i` as an edge between loop
`i` and loop `i+1` (adjacent-pair cross-ties only — see Section 4). Connected
components of that graph are the groups. At up to 4 loops that is at most 3
edges; a flood-fill or union-find over an array of 4 elements is not
performance-sensitive and does not need to be clever.

**This does not touch `src/sim/core2d.js`.** The 14×10 nodal core has no
concept of "loop" at all — it is a single lumped `driven`/`feff` figure that
already applies uniformly to the whole core (`step.js:437` and downstream).
`overallPumpK` is a drop-in replacement for `pumpK` at that one call site.
Fuel temperature, DNBR, Doppler, void, peaking — none of it changes shape.
The entire physics surface of this feature is the block around
`step.js:422-437`.

**v1 simplification, flagged on purpose:** an open cross-tie shares flow with
no friction cost of its own — group averaging is exact, not discounted for
the extra pipe run. If playtesting finds two loops trivially bailing each
other out, the follow-up is a small multiplier on `groupFraction` scaled by
how many ties are open in that group, not a redesign.

## 4. The CROSS-TIE VALVE part

**One entry per adjacent loop pair**, count `Math.max(0, D.loops-1)`, ids
`"xtie0".."xtie"+(D.loops-2)`, connecting loop `i` to loop `i+1`. Deliberately
a chain (0–1, 1–2, 2–3), not a full mesh (which would be 6 pairs at 4 loops)
— two loops that are not directly tied can still be bridged transitively by
opening the ties in between. This keeps the right-click list short and scales
linearly with loop count instead of quadratically.

**`FITTABLE` needs to stop being a static array.** Every entry in it today is
fixed; the cross-ties are not — their count depends on `D.loops`, which can
itself change at runtime through the "ADD/REMOVE STEAM GEN LOOP" rows already
in `ctxItems()` (`design-bench.js:214-218`). Turn `FITTABLE` into a function,
e.g. `fittableList()`, that returns the four existing static entries
concatenated with `Math.max(0,D.loops-1)` generated cross-tie entries, and
update the three call sites that currently reference it directly — `fitOf`,
`fitSig` (`layout.js:33-34`) and `buildLayout()`'s `add()` guards
(`layout.js:60-70`) — to call the function instead. `fitSig()` already
existing as "signature of every fit flag, rebuild when it changes"
(`layoutMetrics()`, `layout.js:367`) means a loop-count change already
triggers a rebuild through its own existing `layLoops!==D.loops` check
(`layout.js:367`) — the cross-tie entries simply ride along once `fitSig()`
reads from the same dynamic list. `ctxItems()` needs the same swap, from
`FITTABLE.map(...)` to `fittableList().map(...)`.

**Two separate booleans, matching the pattern already used for containment's
type-vs-fit split.** `D.xtieFit` is a fixed-size array (`[false,false,false]`,
sized for the maximum 4 loops → 3 possible pairs, matching how `s.rodZ` is
already a fixed-size per-bank array rather than dynamically resized) —
design-time presence, read/written by `fittableList()`'s `get`/`set`, default
`false` (a cross-tie costs mass and is not free redundancy by default).
`S.xtieOpen`, same shape, live operating state, always initialised `false` in
`resetPlant()` — closed by default, so fitting one does not silently change
default-plant physics (an unfit or fitted-but-closed tie is identical to no
tie for `overallPumpK`). `commission()` bakes `P.xtieFit=D.xtieFit.slice()`
the same way it already bakes `turbFit`/`condFit`; the live sim reads
`P.xtieFit[i] && S.xtieOpen[i]` to decide whether tie `i` counts as an edge
in Section 3's graph — matching the existing `autoLive()` shape of "fitted at
the bench AND not stood down live", though this is not an `AUTOSYS` bypass
(nothing about a cross-tie is automatic to defeat) and does not belong in
that table.

**Live control:** an OPEN/CLOSED button in the cross-tie's control strip
(`ctlFor()`, `src/render/plant.js:280-333`, following the `{kind:"btn",...}`
shape already used for e.g. bank AUT/MAN at `plant.js:305-307` and BANK
GANG at `plant.js:314-319`) — `on:()=>S.xtieOpen[i]`,
`fn:()=>{S.xtieOpen[i]=!S.xtieOpen[i];}`. Instant, not rate-limited — real
valve travel time is a candidate follow-up, not v1.

**Grid position:** `x=8+i*2, y=6, w=1, h=1` — the cell directly between
`"pump"+i` (`x=7+i*2`) and `"pump"+(i+1)` (`x=7+(i+1)*2=9+i*2`) on the same
row. Checked against every other static `add()` call in `buildLayout()`
(`layout.js:44-75`): nothing else occupies row 6 at `x∈{8,10,12}` for `D.loops`
up to 4, so `i=0,1,2` all land clear.

**Pipe connection:** cold leg, between the two pumps' discharge sides —
`if(fitOf("xtie"+i)) link("xtie"+i, id("pump"+i), "r", id("pump"+(i+1)), "l")`
in `pipeNetwork()`, added next to the existing guarded links (`layout.js:284,
291,293`), same defensive shape. Cold leg rather than hot: the pumps are
where "loop flow" physically originates in this model, and real cross-connect
lines are conventionally on the suction/discharge side rather than tapped
into the hot leg, which is closer in spirit to what a shared-pump-discharge
tie is actually standing in for.

**`pipes.js` needs to treat every `xtie*` kind uniformly, not one table row
each.** `PIPE_NAME`, `PIPE_VAPOUR`, `pipeColours()`, `pipeFullScale()`,
`pipeUnit()` (`src/render/pipes.js:35-46,190-221`) are all small literal
lookup tables keyed by kind. Rather than hardcoding three more keys (which
would need to change again if the maximum loop count ever changes), have each
of these fall back to a shared default whenever `k.startsWith("xtie")` —
one label ("CROSS-TIE"), one colour, one full-scale figure, one unit — while
`S.flowPos` is still keyed by the full `"xtie"+i` string, so each specific
tie still animates independently of the others. **This independence is the
reason cross-ties cannot reuse the `"hot"`/`"cold"` shared-kind pattern**:
those are always all "on" together because the whole plant is already lumped,
but two different cross-ties can be open and closed independently, so each
needs its own `flowPos` entry and its own zero-when-closed rate.

**Pipe-animation rate**, alongside the existing block (`step.js:644-658`),
one line per possible index: `d["xtie"+i] += sp*(S.xtieOpen[i]?1:0)` (a flat
rate while open is enough for v1 — packets simply do not move while closed,
which is the correct read of a shut valve).

## 5. Waypoint-steered routing

**Every pipe run can carry zero or more player-placed waypoints.** The router
is never replaced — a run with `n` waypoints is `n+1` calls to the exact same
`route(p,sa,q,sb,o)`, chained: start→wp1, wp1→wp2, ..., wpn→end. No new
pathfinding algorithm is written anywhere.

**Ordering is automatic, sorted by distance from the run's start point, never
by placement order.** Re-sorting on every read (there are at most a handful
of waypoints on any one run) means the player never manages order by hand and
dragging a point around never requires an explicit re-ordering step — it just
falls out of the sort.

**Runs need a real per-connection identity first.** As established in
Section 2, `net.push({k:c.k,pts})` (`layout.js:320`) carries no id beyond a
kind that is shared across every loop's hot leg. Give `link()` a stable key
derived from both endpoints and both sides, e.g.
`key = c.k+":"+c.a.id+c.sa+"-"+c.b.id+c.sb`, computed once in the `link`
closure (`layout.js:277`) and carried through `conn` into `net` alongside
`pts`. This key is what indexes the waypoint store, what the renderer uses to
find "my" waypoints when drawing a run, and what a drag handle's hit-test
resolves back to.

**Storage: an absolute plant-space point, per run key, not a `plateOff`-style
delta.** `plateOff` is a delta because the packer's *default* position moves
every frame (margins repack). A pipe run's default route also gets
recomputed every frame, but there is no single anchor a delta would be
relative to — the whole point of a waypoint is "pass through this fixed spot
in the room" regardless of how the rest of the run reshapes around it. Store
as `pipeWaypoints[runKey] = [{x,y}, ...]`, unsorted at rest, sorted by
distance-from-start only when read for routing or for handle placement.

**Interaction, reusing the exact `plateOff` gesture vocabulary:**
- Every leg (there are always `waypoints.length+1` of them, minimum one)
  exposes the corner point `route()`'s own `build()` already computes
  internally for that leg as a small drag handle.
- Dragging a leg's **own current auto-corner** (not yet a stored waypoint)
  inserts a new waypoint at the drop point, splitting that leg into two.
- Dragging an **existing waypoint's** handle moves it.
- Double-clicking an existing waypoint's handle removes it from
  `pipeWaypoints[runKey]`, exactly mirroring `delete plateOff[w.id]`
  (`ui.js:384`) — that stretch of pipe goes back to one auto-computed corner.

No separate "add waypoint" affordance exists anywhere; grab-and-drag is the
only gesture, at any waypoint count.

## 6. Open risks and implementation watch-list

- **Hit-testing a drag handle in plant/view space.** The existing precedent is
  `type:"part"` and `type:"plate"` widgets, pushed through `push()` while
  `viewOn` is set so they get tagged `.v=1` and hit-tested through `vPt()`
  (`ui.js:362,381`, and `push()`/`ptIn()` themselves). A pipe-waypoint handle
  is the same shape of widget (a small fixed-size box in plant coordinates,
  pushed during the same draw pass as the pipe), not a new hit-testing
  mechanism — but it needs a new `type` (`"pipewp"` or similar) so the
  pointerdown dispatch in `ui.js` (the `for(let i=ui.prev.length-1;...)` loop
  that currently branches on `w.type`) knows what to do with a hit: start a
  drag that writes into `pipeWaypoints`, and handle the double-click-removes
  case the same way `type:"plate"` does at `ui.js:384`.
- **Design-bench-only, matching component drag.** Component dragging is
  explicitly gated `if(screen==="design" && !w.part.pin)` (`src/core/ui.js:368`).
  Waypoint editing should almost certainly carry the same gate: pipe *topology* is a design-time
  concern (it already feeds `layoutMetrics()`'s mass/friction figures), and
  the control room is for operating the already-committed plant, not
  reshaping it. This spec recommends design-only and treats control-room
  waypoint editing as explicitly out of scope, not silently assumed.
- **What happens to a waypoint when its run's endpoints move far away** —
  a component gets dragged, or a loop is removed and the run's other end no
  longer exists. The honest answer this spec gives: nothing special happens.
  The waypoint is still an absolute point; the two new legs on either side of
  it still route to it; the result may look like an odd detour if the
  endpoints moved a long way, exactly as it would for a real pipe someone
  forgot to re-route after moving equipment. This spec does **not** propose
  auto-clearing waypoints on layout changes — that would fight the "the
  player put it there for a reason" principle the whole feature rests on.
  The one case that must be handled rather than merely tolerated: if a run's
  *kind* stops existing at all (its cross-tie is unfit, or its loop is
  removed), its `pipeWaypoints[runKey]` entry becomes orphaned data — leave it
  in the object (matching how `plateOff` is never proactively swept either)
  rather than adding cleanup code with no player-visible benefit.
- **Lane-registry interaction once a run has more than one bend.** `laneReg()`
  (`layout.js:149`) and the `SLIDES` nudge fallback (`layout.js:219,244-248`)
  currently reason about one bend per run. With `n` waypoints there are `n+1`
  independently-bent legs sharing one run's identity; each leg still goes
  through the same `reg` (lane registry) so parallel-run collision avoidance
  keeps working per-leg, but nothing today deduplicates a lane claim *within*
  one multi-leg run — worth a specific check during implementation rather
  than an assumption either way.
- **Geometry audit coverage.** `tools/audit-geometry.js` asserts zero
  overlapping pipe segments at 1..4 loops today (`CLAUDE.md`'s own summary of
  that auditor). That coverage needs a new case: at least one run with a
  waypoint dragged to a deliberately awkward spot, swept the same way, so a
  waypoint that produces overlapping segments is caught by the auditor
  instead of discovered by looking at the screen.
