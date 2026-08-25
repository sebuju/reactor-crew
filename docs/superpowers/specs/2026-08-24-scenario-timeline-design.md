# The scenario bench becomes a timeline editor

24/08/26

## What is wrong with the screen today

The scenario bench is a stack of panels with a small timeline in it. It should be a
timeline with the panels folded into it. Four faults, all of them the same fault:

1. **The authoring tools were behind keys on the bottom bar.** That bar exists to
   protect a plant view, and this screen draws no plant. What an overlay hid here was
   the timeline itself.
2. **The event pips were dead.** `scnTimeline()` pushed the pips and then pushed a
   full-width playhead catcher over them; `ui.js` scans widgets last-pushed-first, so
   the catcher ate every click. *(Fixed already.)*
3. **Opening the tab ran the plant.** `scenario` is in `SIMSCREEN` and `TR.paused`
   starts false. *(Fixed already: the tab sets `TR.paused = true`.)*
4. **The timeline says nothing about duration.** Every event is a 6px square whatever
   it does, so a 60 s load ramp and an instant scram draw identically.

## What it becomes

```
 0 .. 44    top bar (tabs)
44 .. 66    transport strip          shared, unchanged
66 .. 88    HEAD strip               name | secs | RUN | PRESETS | SAVE | verdict
88 ..  R    TIMELINE                 ruler + lanes, zooms and pans
 R ..  C    CHART                    demand against delivered, same x-axis
 C ..  H    INSPECTOR strip          whatever is selected, and its controls
            no bottom bar
```

Nothing you author with is behind a key. There is one selection in the screen and one
strip that edits it.

### Heights

| Band | Height |
|---|---|
| `SCN_HEAD_H` | 22 |
| ruler | 14 |
| a lane | 18 |
| a limit row | 14 |
| `SCN_INSP_H` | 26 |
| chart | the rest, capped at `SCN_CH_MAX` 132 |

The timeline takes what the lane and limit counts need. The chart is the panel that
gives way, because it already has a ceiling and the timeline does not.

## The timeline

### Lanes come from the gesture table, never from a second list

Every `GEST` row gains two fields. A fourteenth gesture then declares its own lane and
its own duration rule, and nothing in the renderer needs editing — the same rule
`AUTOSYS`, `DICE` and `ACT` already follow.

- `lane` — which lane it draws in.
- `span` — how wide its block is: `"hold"`, `"ramp"`, `"latch"` or `"point"`.

`SCNLANE` is the one ordered list of lanes, each with a label and the gesture a click on
empty lane adds.

| Lane | Gestures | Click adds |
|---|---|---|
| LOAD | `loadStep` `loadRamp` | `loadStep` |
| PUMPS | `flowStep` | `flowStep` |
| RODS | `rodStep` `scram` | `rodStep` |
| BORON | `boronStep` | `boronStep` |
| SYSTEMS | `blackout` `byp` `junc` `porvArm` | `byp` |
| DAMAGE | `hit` `repair` | `hit` |
| NOTES | `note` | `note` |

### Width is duration, and duration has four shapes

| `span` | Block runs | Gestures |
|---|---|---|
| `hold` | from its time to the next event in the same lane, else the end of the run | `loadStep` `flowStep` `rodStep` `boronStep` |
| `ramp` | its own `OVER n s` arg drawn as a wedge, then `hold` to the next event | `loadRamp` |
| `latch` | to the next event with the same key **and** the same first argument, else the end of the run | `blackout` `byp` `junc` |
| `point` | a 3-unit marker, label to its right | `scram` `hit` `repair` `porvArm` `note` |

`latch` matches on the first argument because two `byp` events naming different systems
are two different switches, and pairing them by gesture alone would draw one as the end
of the other.

A block carries its label inside it, `fitTxt()`ed to the block width; a block too narrow
for any step of the type scale drops to the marker form. A `hold` block also carries its
value (`80%`, `-500 pcm`) when there is room after the label.

### Gestures on the timeline

| Input | Does |
|---|---|
| click a block | select it |
| drag a block | move in time, snapped to 0.5 s |
| drag its right edge | change `OVER` — only on `ramp`, the one span that owns its length |
| double-click a block | delete it |
| click empty lane | add that lane's default gesture there, and select it |
| click the ruler | move the playhead |

There is no palette, because the lane you clicked already said which gesture you meant.
Changing the gesture afterwards is the inspector's first control, restricted to that
lane's own list — which is also the only route to `loadRamp`, `scram` and `repair`.

This reverses the old rule that adding is never a click on bare timeline. That rule was
right when one lane held every type: the click could not say what you wanted, and it
sat on the surface you were reading. With lanes the click is unambiguous, and the
timeline is no longer a thing you read past — it is the thing you work in.

### Zoom and pan

`scnZoom` (a multiple of fit, ≥ 1) and `scnPan` (seconds at the left edge).

- Wheel over the timeline or the chart zooms about the pointer.
- Right-drag pans. Both are the two gestures the plant view already uses.
- Pan is clamped to `0 .. SCN.secs`, because a scenario has two hard ends and there is
  nothing outside them to look at. *(The plant view is deliberately unclamped; a plant
  has no edges. A timeline does.)*
- A `FIT` key at the top right of the timeline, exactly as the plant view carries one.

`scnX(t)` and `scnTat(x)` stay the single mapping between seconds and page units, and
gain the zoom. Everything already routes through them.

The wheel is free on this screen today: it zooms `VIEW`, which no scenario screen draws.

### The chart shares the axis

`chart()` is given a windowed accessor — `n = i1 - i0`, `at:i => trAt(take, k, i0 + i)`
— so the plot shows exactly the seconds the timeline shows and the two scroll together.
No change to `chart.js`.

A limit whose channel is plotted also draws as a dashed rule at its value. A limit on
any other channel does not, and that is not a gap: the limit rows below say the same
thing in a form that works for every channel.

## Limits and the verdict live on the surface

The `LIMITS` panel and the `VERDICT` panel both go. What replaces them:

- **A limit is a row under the lanes.** Its name sits in the lane gutter. The row is
  painted along the run: green where it held, red where it broke. Before a run it is
  flat and unpainted.
- **Selecting a row** puts the limit in the inspector: channel, `<`/`>`, value, grace,
  remove.
- **`+ LIMIT`** is a key at the end of the group. It adds on the channel the inspector
  is showing.
- **The verdict is a badge in the head strip** — `NOT RUN` / `PASS` / `PASS (ASSISTED)`
  / `FAIL`.
- **The break detail is in the inspector** when a broken row is selected: `broke
  T+142.8`, `worst 1.24 @ T+140.0`, and `JUMP`.

A limit is a question asked of the whole run, so painting the answer along the run's own
axis says both the question and the answer in one row. The old panel printed a time and
made you find it.

## The inspector strip

One strip, 26 units, at the foot of the screen. It shows the one selected thing:

| Selected | Strip carries |
|---|---|
| an event | type `<` `>` (its lane's gestures) · `AT` · its `args` · `X` |
| a limit | channel `<` `>` · `<`/`>` · value · grace · `X` |
| a broken limit | the same, plus `broke` / `worst` / `JUMP` |
| nothing | one line naming what a click on a lane will add |

Every control on it is a widget this UI already has. Nothing new is invented.

## The bottom bar

**It goes on this screen.** `TRENDS`, `LOG` and `TAKES` become three keys at the right
end of the head strip and still open as overlays. They are a second look at a finished
run, which is what an overlay is for; none of them authors anything.

*This is the one item chosen rather than asked. Veto it and they can stay on a bottom
bar carrying nothing else, or move to the transport strip instead.*

## Headings

`rule()` and `well()` gain an optional size. This screen draws its headings at 6.5 with
1px letter spacing rather than 8 with 2px. At 8/2/caps a title fills most of a narrow
column and reads louder than the data under it.

The rest of the project is left alone. Changing the shared default is a project-wide
restyle and a separate decision.

## Files

| File | Change |
|---|---|
| `src/sim/scenario.js` | `lane` + `span` on every `GEST` row; `SCNLANE`; a load-time assert that every gesture names a real lane |
| `src/screens/scenario.js` | rebuilt: head strip, lanes, limit rows, inspector, zoom/pan. `drawScnEvents`, `drawScnLimits`, `scnVerdictPanel` and their four `ovlAdd` calls go |
| `src/core/chrome.js` | optional size on `rule()` / `well()` |
| `tools/audit-geometry.js` | assert every `GEST` row names a lane in `SCNLANE`, and that the scenario screen registers no authoring overlay |

`src/sim/step.js` is not touched. Neither is `chart.js`, `record.js` or `ui.js`.

## What proves it

- `audit-text.js` — the screen is captured at several zooms and pans, with a scenario
  carrying every gesture type at once, and with more limits than fit. Blocks, labels and
  the inspector all go through the same overflow and collision passes as everything else.
- `audit-geometry.js` — the lane table covers `GEST` exactly; no authoring panel is
  registered as an overlay on this screen.
- `audit-physics.js` — unchanged and expected to stay unchanged. `scnCompile()` is not
  touched, so the three presets must still measure PASS. **Not to be run without asking.**

## Known limits of this design

- **A `latch` block whose partner is missing runs to the end of the run.** That is the
  truth — a bypass nobody switches back stays bypassed — but it means a mis-authored
  script draws a very long block rather than an error.
- **`note` compiles to nothing**, so a NOTES lane block has no effect on the plant. It is
  a caption, and drawing it in its own lane is what keeps that obvious.
- **The chart can only draw a limit line for a channel it is plotting.** Two channels are
  plotted. Every other limit is read off its own row.
- **0.1 s remains the verdict's resolution**, unchanged: the judge still reads the
  archive, not the tick.
