# General part placement, and pipe junctions

Status: design spec, implemented same session. Supersedes the cross-tie
design at `2026-08-24-pipe-junctions-and-waypoints-design.md` for
Sections 3-4 of that doc (the fixed 3-slot cross-tie chain and the
`PUMPS[D.pumps]` dial). Section 5 of that doc (waypoints) is unchanged
and this feature reuses its machinery directly.

## 1. Why this exists

Every optional part built earlier tonight - CONTAINMENT, the ACCUMULATOR,
the TURBINE, the CONDENSER, then the cross-tie valve - was the same
shape: one fixed slot, on or off. That shape is wrong for two things
the player actually asked for, twice, independently: a cross-tie
network with "unlimited junctions at any point", and pump redundancy
built by "adding pumps as components" rather than picking a tier off a
dropdown. Both want the same underlying capability - place as many of a
part as you like, wherever there is room for it - and neither is well
served by adding one more fixed slot.

This spec replaces two things outright rather than extending them:

- `PUMPS[D.pumps]` (`src/data/design.js`) - a three-tier dropdown that
  bought a flat mass and a flat trip-floor bonus, disconnected from any
  physical pump on the grid.
- The fixed `xtie0`/`xtie1`/`xtie2` chain (`fittableList()` in
  `src/data/layout.js`) - three pre-positioned valve slots between
  adjacent loops only.

Both are deleted, not deprecated - this is a prototype under active
development, and a dead dial sitting next to its replacement is a
second implementation of the same question.

## 2. Two different things, one placement idiom

**A spare pump is a visible component.** It occupies a grid cell, has a
symbol (`drawSym()` already draws anything whose id starts with `pump`,
`src/render/plant.js:67`), and can be repaired or destroyed like any
other part.

**A junction is not a component at all - confirmed explicitly.** It is
an invisible point where a pipe run gains a branch. No box, no grid
cell, no symbol.

Both are placed the same way: right-click empty space or an existing
run, get an "ADD X HERE" menu, click it, done. Both are removed the
same way: right-click the thing itself, "REMOVE". Neither reuses
`plateOff`'s delta-from-packed-position idea, because neither one has a
packed position to be a delta from - a placed part's position is
exactly and only where the player put it, forever, like a waypoint.

## 3. Surviving `buildLayout()`

`buildLayout()` regenerates `LAY.parts` from nothing every time its
trigger fires (`layLoops!==D.loops||layFit!==fitSig()`,
`layoutMetrics()`). That is deliberate for the static, formula-driven
parts - CLAUDE.md documents changing loop count as resetting every
dragged position on purpose. A player-placed pump must not share that
fate just because the player also happened to unfit CONTAINMENT in the
same session.

`placedParts` is a new, separate, persistent array - never touched by
`buildLayout()`'s own construction, only appended after:

```js
function buildLayout(){
  const A=[], add=...;
  ... every existing add() call, unchanged ...
  for(const p of placedParts)
    if(groupFits([{q:p,x:p.x,y:p.y}])) A.push(p);
  LAY={parts:A}; layLoops=D.loops; layFit=fitSig();
}
```

A placed part that no longer fits (something else now occupies its
cell) is silently dropped from `LAY.parts` for that rebuild rather than
overlapping or crashing - the same non-fatal handling a component
walled in on every side already gets elsewhere. It stays in
`placedParts` and reappears the moment the conflict clears, exactly the
way an unfit `FITTABLE` part's own D-flag survives being unfit.

Placing or removing a part calls `buildLayout()` directly from the
context-menu action, rather than waiting for the generic trigger -
`fitSig()` has no way to know a part was added, because nothing about
`D` changed.

## 4. Pumps

**Id scheme.** The one static pump per loop keeps its id (`"pump"+i`).
A placed spare gets `"pumpX"+n` off a module counter - both start with
`"pump"`, so `drawSym()`, the `ctlFor()` control strip, and every
`id.startsWith("pump")` check already in the codebase picks up a spare
for free. Nothing about rendering, control mounting or damage targeting
needed to change.

**Sizing, decoupled from fit - same split as CONTAINMENT's type vs
fit.** `D.pumpSize` is a plain object keyed by pump id, default `0.5`
when absent (`pumpSizeOf = id => D.pumpSize[id] ?? 0.5`). Every pump,
static or placed, gets its own `TURBINE SIZE`-style slider
(`sliderF()`, already used for the turbine and condenser) on its own
plate. `paramsFor()`'s pump branch is un-ganged: it used to be one
shared `PUMP REDUNDANCY` plate for the whole set
(`B.gang="pump"`, `src/render/inspector.js`); now each pump is its own
decision, so it gets its own plate, matching how each cross-tie was
already its own plate rather than a ganged one.

**Capacity.** `pumpCap(size) = 0.7 + 0.6*size` - centred so the default
size (0.5) is exactly 1.0, the same centring trick `grossEff()` already
uses for the turbine multiplier. A pump at default size delivers
exactly what the old always-fitted single pump delivered; sizing it up
or down moves it either way.

**Mass.** Every pump on the grid costs `pumpCap(size)*PUMP_MASS` t
(`PUMP_MASS=50`). This replaces `PUMPS[D.pumps].mass` outright - the
default one-pump-per-loop plant now costs 50t for its one pump instead
of a flat 60t for "one spare" nobody could see. Mass is a budget input,
not a physics one (`derived().mass` never reaches `step()`), so this
change cannot move the DOCUMENTED BEHAVIOUR figures - verified in
Section 7, not assumed.

**Trip floor.** `P.flowMin` used to be `PUMPS[D.pumps].floor` - a flat
number per tier. It is now derived from how much pump capacity is
actually on the grid: `flowMin = clamp(0.30 + 0.15*(totalCap-P.loops),
0.15, 0.75)`, where `totalCap` sums `pumpCap()` over every pump
currently fitted. At the exact old default (one pump per loop, default
size) `totalCap==P.loops`, so `flowMin==0.30` - the old NO SPARE
figure, not the old default of 0.45. This is a genuine, intentional
behaviour change: the true baseline (bought nothing extra) now reads as
the true baseline trip floor, rather than inheriting a floor that
assumed a spare nobody had to place. It does not touch the DOCUMENTED
BEHAVIOUR "PWR at rest" figures, because those describe a plant with no
damage, where the trip *threshold* is never consulted at all - only
`pumpCap` at full health matters there, and that is unchanged at 1.0.

**Placement.** Right-click empty grid space (design screen only, same
gate as everything else in this menu) offers "ADD SPARE PUMP HERE" when
the clicked cell is empty and inside the grid (`groupFits` on a 1x1 at
that cell). Right-click on a placed spare (never on the one static pump
a loop always has - that one is structural) offers "REMOVE SPARE PUMP".

## 5. Junctions

**Topology, not a component.** `D.junc` is an object keyed by a
generated id (`"j"+n`), each entry `{loopA, loopB, x, y}` - the two
loops it bridges and the plant-space point on loop A's cold leg it taps
into. `S.juncOpen`, same keys, booleans, always false out of
`resetPlant()` - closed by default, same reasoning as the old cross-tie
valve defaulting shut. `commission()` bakes `P.junc = {...D.junc}`, a
plain snapshot, the same shape `P.xtieFit` used to be.

**Placement, generalised from the old fixed chain.** Right-clicking a
loop's cold-leg run (identified by regexing the loop index out of that
run's `key`, e.g. `key.match(/(?:sg|pump)(\d+)/)`, against the
`pipeNetwork()` output at the clicked point via the already-existing
`nearestOn()`, `layout.js:325`) offers one row per OTHER loop that
currently exists: "ADD JUNCTION TO LOOP n+1". Any two loops, not just
adjacent ones, and the same pair can be bridged more than once at
different points along the run if the player wants to - nothing caps
the count, and nothing requires the tap point to be a fixed midpoint.
Right-clicking near an existing junction's stored point (within a small
tolerance) offers "REMOVE JUNCTION" instead.

**Routing needs no new machinery.** `route()` already accepts a bare
point in place of a component+face on EITHER end
(`o.pa`/`o.pb`/`o.va`/`o.vb`, added earlier tonight for waypoints,
`layout.js:251`). A junction's branch is one `route()` call: the tapped
point on loop A as a bare `pa`, the target loop's pump component as the
normal `q,sb` end. No pathfinding was written for this feature, exactly
as none was written for waypoints - the same two-point router the whole
game already trusts is called once more.

**Kind string reuses the existing `xtie` rendering fallback on
purpose.** Every junction's pipe kind is `"xtie:"+id` rather than a new
`"junc:"` prefix, specifically so `pipes.js`'s existing
`k.startsWith("xtie")` fallbacks for name, colour, full-scale and unit
(added for the fixed cross-ties earlier tonight) cover it with zero
further changes. `S.flowPos` is still keyed by the full `"xtie:"+id`
string, so every junction still animates and reports independently.

**No visible box, but it is not invisible when it matters.** At design
time a faint dot marks a placed junction's tap point, dim enough not to
compete with real components, purely so the player can find it again to
remove it. In the control room the same point carries the reused
`bowtie()` valve glyph (the identical drawing the pressurizer relief
valve and the old fixed cross-tie both already use) as a small,
directly clickable open/closed toggle - not mounted in any component's
control strip, because there is no component, but the same shape and
the same gesture (click toggles `S.juncOpen[id]`) as every other valve
in the game.

**Flow physics generalises from a fixed chain to a general graph.** The
old `loopFlowK()` walked a linear chain of `xtieLive(j-1)` between
adjacent loops. The replacement builds an undirected graph over loops
`0..P.loops-1` - one edge per junction where `P.junc[id]` exists and
`S.juncOpen[id]` is true - and finds connected components by a small
flood-fill (at most 4 loops; this is not a performance-sensitive
structure). Within a component the flow math is unchanged from
tonight's earlier cross-tie work: a group of loops with total pump
capacity `up` (now summing real per-pump `pumpCap()`, not a flat
plant-wide share number) delivers `min(groupSize, up)` between them.
**Zero open junctions still collapses to exactly the old
`(loops-lost)/loops`, algebraically**, for the identical reason it did
before: every group is then a singleton, and `min(1, up)` for a
single, undamaged, default-size pump is exactly `1`.

## 6. What a junction placed somewhere other than a cold leg does

Nothing, currently, beyond existing as a drawn pipe. The flow-sharing
graph in Section 5 only looks at junctions whose `loopA`/`loopB` were
resolved from a cold-leg tap - that is the only case the placement menu
currently offers, so this is not a reachable gap yet, only a boundary
worth stating: if a future junction type taps a different kind of line
(steam, feed), it needs its own physics interpretation before the
placement menu offers it there. Nothing in this spec blocks that; it
simply is not built.

## 7. Verification

- `node tools/audit-text.js && node tools/audit-geometry.js && node tools/audit-physics.js`,
  all three clean.
- `audit-physics.js`'s DOCUMENTED BEHAVIOUR block (PWR at rest,
  scram+120s, boron dump, RBMK/HTGR abuse, split-mode block) unchanged
  from the run captured before this spec's changes - proves the mass
  and flow-floor formula changes in Section 4 do not reach live
  physics at the default, undamaged state.
- The old `=== CROSS-TIE VALVES ===` block's *shape* is preserved
  (shut-collapses-exactly, opening buys real flow, an open tie on a
  fully healthy plant changes nothing) but rewritten against placed
  spares and junctions instead of `D.pumps`/`D.xtieFit`, since those
  fields no longer exist.
