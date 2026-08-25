# HTML widget kit — API reference

`src/ui/kit.js` (loads after `src/core/ui.js`, before every `src/screens/*`)
`src/ui/kit.css`

Everything is exposed on the one global `KIT`. Every factory **builds its DOM
once** and returns `{el, set, ...}`. Call the factory once per widget instance
at screen-build time; call `set()` on every sync pass to update it cheaply.
`set()` never rebuilds DOM — it diffs against the last value and only writes
what changed, same discipline as `helpSync()` in `src/screens/help.js`.

## Rules

1. **Never write `S` from a widget.** A widget takes an `onChange`/`onClick`/
   `onSelect`/`onToggle` callback; the **caller** (the screen) calls
   `act(k, ...)` from `src/sim/record.js` inside that callback. That is what
   makes an input recordable, replayable and scriptable — see `AUTOSYS`/`ACT`
   in `.claude/CLAUDE.md`. A widget that mutates `S` itself is invisible to
   the tape.
2. **Colours are always `var(--c-*)`, text sizes always `var(--t*)`.** Never
   a literal hex colour or a literal px font-size in a screen's own CSS/JS.
   The palette is written by `cssVarsBoot()` in `src/core/constants.js`; the
   type scale mirrors `TSCALE` in `src/core/text.js`. Available: `--c-bg
   --c-panel --c-panel-hi --c-well --c-edge --c-edge2 --c-rail --c-ink
   --c-ink2 --c-bright --c-amber --c-cyan --c-red --c-green --c-blue
   --c-metal --c-xe --c-graph` and `--t15 --t13 --t12 --t10 --t9-5 --t9
   --t8-5 --t8 --t7-5 --t7 --t6-5 --t6`.
3. **Build once, sync cheaply.** Construct every widget for a screen at boot
   (mirroring `helpBuildDOM()`), keep the returned handles, and write a
   `xSync()` that only calls `set(...)` with fresh values every frame/tick.
   No widget here runs its own `requestAnimationFrame` loop — the screen
   drives it.
4. **Tooltips are two data attributes, not a widget.** `shell.js` already
   listens document-wide for `pointerover`/`pointerout` on
   `[data-tip-title]`. Call `KIT.tip(el, title, body)` to set them, or several
   factories below take a `tip` option and do it for you.
5. **A component with nothing to adjust gets no widget** — same rule the
   plates already followed. Don't build a row for state that never changes.

## `KIT.el(tag, cls, attrs)`

Bare DOM-creation helper (`document.createElement` + className + attributes).
Not a widget — used internally, exposed because a screen will want it too
rather than hand-rolling its own.

```js
const box = KIT.el("div", "my-row", {title:"x"});
```

## `KIT.tip(node, title, body)`

Sets `dataset.tipTitle` / `dataset.tipBody` on any element. Returns the node.

```js
KIT.tip(myButton, "SCRAM", "Trips the reactor. Always safe, never free.");
```

## `KIT.well(opts)` — panel box

`opts: {title, color}`. Returns `{el, body, setTitle(label)}`. `body` is
where you append content; `el` is the outer bordered box.

```js
const w = KIT.well({title:"COOLANT PUMPS"});
w.body.appendChild(mySlider.el);
```

CSS: `.kit-well`, `.kit-well-body`

## `KIT.rule(label, opts)` — `LABEL ─────` section header

`opts: {color}`. Returns `{el, set(label)}`.

```js
const r = KIT.rule("REACTIVITY");
container.appendChild(r.el);
```

CSS: `.kit-rule`

## `KIT.chip(color)` / `KIT.dot(color)` — inline row markers

Square / round marker, matching canvas `chip()`/`dot()`. Returns `{el, set(color)}`.

```js
const d = KIT.dot("var(--c-amber)");
row.appendChild(d.el); // later: d.set("var(--c-green)")
```

CSS: `.kit-chip`, `.kit-dot`

## `KIT.seg(opts)` — LED bargraph

`opts: {cells=24, frac, color}`. Segments are a static mask, never a solid
fill. Returns `{el, set(frac, color)}`, `frac` 0..1.

```js
const bar = KIT.seg({cells:16});
bar.set(0.62, "var(--c-cyan)");
```

CSS: `.kit-seg`, `.kit-seg-fill`

## `KIT.segSigned(opts)` — centre-zero bargraph

`opts: {cells=28, frac, color}`. `frac` -1..1, grows from the centre rail.
Returns `{el, set(frac, color)}`.

```js
const tilt = KIT.segSigned({});
tilt.set(-0.3, "var(--c-amber)");
```

CSS: `.kit-seg.kit-seg-signed`, `.kit-seg-mid`

## `KIT.segMark(opts)` — bargraph with limit marks

`opts: {signed, cells, frac, marks, color}`. Wraps `seg`/`segSigned` and adds
tick marks. `marks` are track fractions: 0..1 unsigned, -1..1 signed, same
convention as canvas `segMark()`. Returns `{el, set(frac, marks, color)}`.

```js
const flow = KIT.segMark({});
flow.set(0.8, [0.75], "var(--c-cyan)");
```

CSS: `.kit-seg-marks`, `.kit-seg-markline`

## `KIT.band(opts)` — zoned scale strip (`band()`+`bandBar()` combined)

`opts: {lo, hi, zones:[[upTo,color,label],...], dp, lim:[[v,label],...], v}`.
Zones/lo/hi/lim are fixed at construction (mirrors canvas `band()`, which is
also rebuilt every draw from static thresholds); only the value moves after
that. Returns `{el, set(v)}`.

```js
const dnbr = KIT.band({lo:1, hi:2.5, dp:2,
  zones:[[1.3,"var(--c-red)","LOW"],[2.5,"var(--c-green)","OK"]]});
dnbr.set(1.76);
```

**The bar is SVG; the labels are HTML.** The `<svg>` uses
`preserveAspectRatio="none"`, so its 100-unit x axis stretches to whatever
width the panel gives. That is right for the cells (plain rects) and wrong for
anything with a shape, so the ticks carry `vector-effect="non-scaling-stroke"`
and the type stays HTML — squashed text at a size the CSS ladder never set is
the one thing this would otherwise produce.

CSS: `.kit-band`, `.kit-band-svg`, `.kit-band-cell` (`.dim`),
`.kit-band-needle`, `.kit-band-cap`, `.kit-band-lim`, `.kit-band-peg`
(`.lo`/`.hi`), `.kit-band-lo/hi/zlabel`

A scale is drawn for the range the plant is **steered** in, so a scrammed core
runs DNBR clean off the end of it. `set()` past either end pins the needle and
shows `.kit-band-peg` — a detached pip saying the needle *pegged* rather than
arrived. Do not widen a band to swallow a scram: the 50 pcm the reading is
actually for becomes a tenth of a segment.

**Not ported**: the canvas version's `o.col` forced-colour override. One
caller used it; pass a pre-computed colour instead.

## `KIT.lamp(color)` — alarm lamp

Round pip; red blinks automatically, matching the annunciator rhythm.
Returns `{el, set(on, color)}`.

```js
const l = KIT.lamp();
l.set(true, "var(--c-red)");
```

CSS: `.kit-lamp`, `.kit-lamp.blink`

## `KIT.badge()` — "!" fault marker

Returns `{el, set(visible, color)}`.

```js
const b = KIT.badge();
b.set(true);
```

CSS: `.kit-badge`

## `KIT.hatch()` — damage overlay

Absolutely-positioned diagonal hatch; give its parent `position:relative`.
Returns `{el, set(on, color)}`.

```js
const h = KIT.hatch();
componentBox.style.position = "relative";
componentBox.appendChild(h.el);
h.set(true, "var(--c-red)");
```

CSS: `.kit-hatch`

## `KIT.button(label, opts)`

`opts: {onClick, sunk, flat, danger, size, tip, on}`. `danger` is the one
solid-red style — reserve it for SCRAM and the emergency boron dump, per
`.claude/CLAUDE.md`. Returns `{el, set({label, on, disabled})}`.

```js
const scram = KIT.button("SCRAM", {danger:true, onClick:()=>act("scram")});
scram.set({disabled:false});
```

CSS: `.kit-btn`, `.kit-btn-sunk`, `.kit-btn-flat`, `.kit-btn-danger`, `.on`

## `KIT.slider(opts)` — actual vs demand

`opts: {min, max, step, val, dem, mark, fmt, cells, onChange, tip, title}`.
The thumb is the **actual** (native `<input type=range>` value); the amber
caret overlay is **demand**, shown only while it differs from actual. Every
`onChange(v)` fires while dragging — the caller decides whether to call
`act()` on every event or coalesce (the sim's own `recAct()` already
coalesces same-tick continuous acts, so firing on every `input` event is
safe). Returns `{el, set(val, dem)}`.

```js
const flow = KIT.slider({min:0, max:100, fmt:v=>v.toFixed(0)+"%",
  onChange:v=>act("flowDem", v)});
flow.set(S.flow, S.flowDem);
```

CSS: `.kit-slider`, `.kit-slider-track`, `.kit-slider-fill`, `.kit-slider-mark`,
`.kit-slider-dem`, `.kit-slider-input`, `.kit-slider-readout`

**Not ported**: the canvas slider's click-preview hairline (amber tick where
a click on bare track would land), the away-from-track drag gearing, and
per-cell mark-violation colouring are left out — native `<input type=range>`
covers drag/click/keyboard directly instead. See report.

## `KIT.optList(items, opts)` — radio rows (bench `optList()`)

`items: [{name, tip}]`, `opts: {sel, deltas, onSelect}`. `deltas[i]` is the
mass-over-cheapest-option in tonnes, same as the canvas version's `+Nt` tag.
Returns `{el, set(sel, deltas)}`.

```js
const arch = KIT.optList([{name:"PWR"},{name:"BWR"}], {onSelect:i=>D.arch=i});
arch.set(D.arch, [0, 12]);
```

CSS: `.kit-optlist-row`, `.kit-optlist-name`, `.kit-optlist-mass`, `.on`, `.min`

## `KIT.segSel(labels, opts)` — segmented choice (bench `segSel()`)

`labels: string[]`, `opts: {sel, deltas, onSelect}`. Returns `{el, set(sel, deltas)}`.

```js
const size = KIT.segSel(["S","M","L"], {onSelect:i=>D.turb=i});
size.set(D.turb, [0,4,9]);
```

CSS: `.kit-segsel`, `.kit-segsel-cell`, `.on`, `.min`

## `KIT.sliderRow(opts)` — titled slider + mass delta (bench `sliderF()`)

Same `opts` as `KIT.slider`, plus `massFn` (truthy just reserves the mass-tag
element; compute the number yourself and pass it to `set`). Returns
`{el, set(val, dem, massDelta), slider}`.

```js
const row = KIT.sliderRow({title:"CORE POWER", min:0, max:100,
  fmt:v=>v+"%", massFn:true, onChange:v=>D.power=v});
row.set(D.power, null, 6);
```

CSS: `.kit-sliderrow`, `.kit-sliderrow-mass`, `.min`

## `KIT.readout(opts)` — titled read-only value (bench `readF()`)

`opts: {title, tip, val}`. Returns `{el, set(valueString)}`.

```js
const r = KIT.readout({title:"SHUTDOWN MARGIN"});
r.set(sdm.toFixed(0) + " pcm");
```

CSS: `.kit-readout`, `.kit-readout-val`

## `KIT.toggle(opts)` — fit switch (bench `toggleF()`)

`opts: {label, mass, tip, on, onToggle}`. Returns `{el, set(on)}`.

```js
const hpi = KIT.toggle({label:"HPI", mass:8, tip:"Gravity-fed injection.",
  onToggle:()=>D.hpi=!D.hpi});
hpi.set(D.hpi);
```

CSS: `.kit-toggle`, `.kit-toggle-mark`, `.kit-toggle-label`, `.kit-toggle-mass`, `.on`
