// Orthogonal connector router for the node view, after libavoid (Wybrow/Marriott/Stuckey,
// "Orthogonal Connector Routing", GD 2009 + "Seeing Around Corners", 2014). The WHOLE graph
// is routed in one pass — three stages:
//   1. a gridless visibility graph whose waypoints are obstacle corners (inflated for clearance)
//      + per-node face ports; any two waypoints joinable by a single orthogonal L,
//   2. A* per connector minimising length + bends, choosing the src/dst FACE itself (a super-
//      source/sink over all four faces; perpendicular exit/entry forced), groups soft-avoided,
//   3. nudging — connectors that share a corridor split into nested parallel lanes (and ports
//      fan along a face) so no two wires overlap, lanes centred in their free alley.
//
// Obstacle dodging, side selection and bundling all fall out of the search + nudging — there are
// no per-side heuristics. `routeGraph(nodes, groups, edges, opts)` returns a Map(key -> {pts,
// p1,d1,p2,d2}); the caller renders pts and anchors its port dots at p1/p2.
//
// Drag stability: opts.prevSides keeps each connector on its last-frame faces unless another face
// is genuinely cheaper (a small stickiness bias), so a tiny node move can't flip a route's whole
// shape across a cost-equality threshold.

/* ══ PORTED VERBATIM, WRAPPED, NOT REWRITTEN ══
   Six files lifted whole from the node-view router in the `oc` project, in
   dependency order and each under its own banner: route (the A* connector
   router, above), then minheap, corridors, busroute, decollide, busgraph.
   THE BUS ROUTER IS THE PRIMARY and `routeGraph` is its FALLBACK, which is how
   `oc` itself wires them (`routing.js`: router "bus", astar "also serves as the
   bus router's fallback") - a per-line A* gives every wire its own path, where
   the bus carves shared corridors and makes them ride together, which is the
   whole picture a fan of leaders out to the margin wants.

   Three changes and no others, all forced by this project having no build step
   and no modules: the six are closed in ONE IIFE handing back one global
   (`ROUTE`), every `import`/`export` is dropped since they are now siblings in
   one scope, and busroute's `EPS` (0.6) is `BUS_EPS` because corridors declares
   its own (0.5) - the single name collision across all six. faces.js's five
   exports are inlined below. The wrapper is not decoration: every top-level
   name in here is generic (`C`, `center`, `rev`, `len`), and `C` is this
   project's colour palette.

   Keep it verbatim. The whole point of taking it is that it is a solved
   problem, and a local edit is a fork nobody will re-sync. */
const ROUTE=(()=>{

// ---- from faces.js (the five names route.js imports) ------------------------
const FACE_OUT = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
// Pull the arriving endpoint `by` px INTO the node along its face normal, so a centred end-cap
// straddles the node edge instead of floating outside it. Mutates and returns pts.
function insetEndpoint(pts, side, by) {
    const v = FACE_OUT[side];
    if (!by || !v || pts.length < 2) return pts;
    const i = pts.length - 1;
    pts[i] = [pts[i][0] - v[0] * by, pts[i][1] - v[1] * by];
    return pts;
}
const PORT_MIN = 12;      // hard floor between fanned out-port dots on one face (dot is 8px) — no overlap
const PORT_END_KEEP = 18; // min distance an endpoint stays off a node corner so a bend can't swallow the stub
// How far an endpoint must stay off both ends of a face span. Shrinks on a short face so the usable
// band never inverts (a 20px face would otherwise want 18px of keep at each end).
const faceKeep = (span) => Math.min(PORT_END_KEEP, Math.max(0, (span - PORT_MIN) / 2));
// The facing-span a straight-shot pair needs to clear a corner at BOTH ends: below this, a straight
// connector's port lands inside the rounded corner, so the pair must be A*-routed instead.
const MIN_FACING_SPAN = PORT_MIN + 2 * PORT_END_KEEP;

const C = {
    clearance: 22,   // routing margin around each node => gutter width for waypoints
    bendCost: 70,    // penalty per 90-degree bend (vs 1 unit of length)
    headCross: 1e6,  // soft penalty per group TITLE band crossed — so heavy that ANY detour, however
                                      // long, beats crossing; a band is crossed only when a node is truly
                                      // boxed in (no path exists) and nothing else can route it
    headBand: 46,    // height (px) of a group's FULL colored title banner (CSS .ggroup-title:
                                      // padding 9*2 + ~24 line for --fs-xl 20px), added as its own soft rect so
                                      // wires bias off the whole banner — not just the text (0 disables)
    laneGap: 12,     // separation between bundled parallel wires
    faceStick: 50,   // bias to keep a connector's previous face (hysteresis) — < bendCost, so a
                                      // clearly better route still switches, but ties/small margins don't flicker
    bench: false,    // console.log per-phase timings each routeGraph call (window.__route.bench=true; __reroute())
    occCong: 40,     // congestion penalty per line already occupying a corridor bucket a route would reuse
    occCell: 20,     // px width of a congestion corridor bucket (lines within this count as sharing a run)
    haloCost: 150,    // light soft penalty for skimming a node's halo (0 disables) — nudges lines to
                     // keep a little clearance off node walls so bundles don't pile against them
    nodeHalo: 30,    // px the halo extends past each node edge (the soft-avoid ring around the hard body)
    faceBias: 260,   // soft preference for the face pointing AT the other endpoint: a face is charged
                                      // up to this (px-equiv) when its normal points fully AWAY, 0 when it points
                                      // straight at the target. Competes with length+bends, so a genuinely
                                      // blocked near face still yields, but a clear wrong-way face loses.
};

const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const DC = { N: 0, S: 1, E: 2, W: 3 };
const outDir = (s) => (FACE_OUT[s][0] !== 0 ? (FACE_OUT[s][0] > 0 ? "E" : "W") : (FACE_OUT[s][1] > 0 ? "S" : "N"));
const inDirOf = (s) => (FACE_OUT[s][0] !== 0 ? (FACE_OUT[s][0] > 0 ? "W" : "E") : (FACE_OUT[s][1] > 0 ? "N" : "S"));
const rev = (d) => (d === "N" ? "S" : d === "S" ? "N" : d === "E" ? "W" : "E");
// DC index of rev(d), by DC index of d — lets the hot loop compare directions as ints (see makeAStar).
const REVI = [DC.S, DC.N, DC.W, DC.E];

// ---- interned soft-crossing sets ---------------------------------------------
// Every edge carries the set of soft rects its segments cross. That used to be a real `Set` per
// edge — ~258k of them on the warframe fixture, ~129k distinct, averaging 5 members. But the SAME
// handful of crossing-sets recur over and over (all the edges threading one gap cross exactly the
// same halos), so they are interned: identical member lists share one immutable record.
//
// The record also caches `sum` — the total penalty for crossing everything in it. astar needs that on
// every expansion, and caching it on the shared record means it's computed once per DISTINCT set
// rather than once per edge. `sum` is lazy (-1 = not yet computed) because softCost isn't in scope
// here. Members are sorted and deduped so the key is canonical; astar only ever reads.
const EMPTY_IDS = new Int32Array(0);
const EMPTY_G = { n: 0, ids: EMPTY_IDS, sum: 0 };
// Scratch buffer the softList calls of one edgeOpts option append into — interning reads it and, on a
// hit (the overwhelmingly common case), copies nothing. Sized per pass in routeGraph.
let SCR = new Int32Array(512);
function internG(n, table) {
    if (!n) return EMPTY_G;
    if (n > 1) {   // insertion sort + dedupe in place: n averages ~5, so a comparator sort costs more
        for (let i = 1; i < n; i++) { const v = SCR[i]; let j = i - 1; while (j >= 0 && SCR[j] > v) { SCR[j + 1] = SCR[j]; j--; } SCR[j + 1] = v; }
        let w = 1;
        for (let i = 1; i < n; i++) if (SCR[i] !== SCR[i - 1]) SCR[w++] = SCR[i];
        n = w;
    }
    // key = the members packed straight into a string, one char each (soft indices are well under
    // 2^16). Cheaper to build than a join, and canonical because the members are sorted.
    const key = n === 1 ? SCR[0] : String.fromCharCode.apply(null, SCR.subarray(0, n));
    let g = table.get(key);
    if (!g) { g = { n, ids: SCR.slice(0, n), sum: -1 }; table.set(key, g); }
    return g;
}

// ---- band index over a rect set ---------------------------------------------
// segHitsHard/softList used to scan EVERY rect on EVERY candidate segment. edgeOpts emits up to 3
// segments per call and the whole router funnels through it (grid = 336k calls, ports = 672k, plus
// every astar expansion), so those two linear scans were the dominant cost of a route pass.
//
// Every segment tested here is AXIS-ALIGNED, so its bbox is degenerate on one axis: a horizontal
// segment can only hit rects straddling its single y, a vertical one rects straddling its single x.
// So index each rect set TWICE — into thin y-bands and thin x-bands — and let a query use whichever
// axis its bbox is thin on. That is one or two band lookups per query instead of a full scan.
// A 2-D cell grid does NOT work here: a canvas-wide horizontal run crosses every column, so it drags
// back the whole 256px band anyway.
//
// The band contents are a strict SUPERSET of what can match (built from raw rect bounds while the
// overlap test shrinks each rect by eps) and the SAME exact test then runs on every candidate, so
// results are identical to the full scan by construction — a lookup narrowing, not an approximation.
// Layout is CSR: `start[k]..start[k+1]` indexes into `items`.
const BAND = 64;   // px per band — ~2-4 entries per node-sized rect, 1-2 bands touched per query
function buildAxisBands(lo, hi, n) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { if (lo[i] < min) min = lo[i]; if (hi[i] > max) max = hi[i]; }
    const nb = Math.max(1, Math.min(8192, Math.floor((max - min) / BAND) + 1));
    const band = Math.max(BAND, (max - min) / nb);
    const bi = (v) => { const k = Math.floor((v - min) / band); return k < 0 ? 0 : k >= nb ? nb - 1 : k; };
    const start = new Int32Array(nb + 1);
    for (let i = 0; i < n; i++) { const a = bi(lo[i]), b = bi(hi[i]); for (let k = a; k <= b; k++) start[k + 1]++; }
    for (let k = 0; k < nb; k++) start[k + 1] += start[k];
    const items = new Int32Array(start[nb]), fill = start.slice(0, nb);
    for (let i = 0; i < n; i++) { const a = bi(lo[i]), b = bi(hi[i]); for (let k = a; k <= b; k++) items[fill[k]++] = i; }
    return { nb, band, bi, start, items };
}
function buildRectGrid(rx0, ry0, rx1, ry1, n) {
    if (!n) return null;
    return { x0: rx0, y0: ry0, x1: rx1, y1: ry1, byX: buildAxisBands(rx0, rx1, n), byY: buildAxisBands(ry0, ry1, n) };
}
// Pick the axis whose query range spans fewer bands, and return [index, firstBand, lastBand].
function pickBands(G, x0, x1, y0, y1) {
    const bx = G.byX, by = G.byY;
    const ax0 = bx.bi(x0), ax1 = bx.bi(x1), ay0 = by.bi(y0), ay1 = by.bi(y1);
    return (ax1 - ax0) <= (ay1 - ay0) ? [bx, ax0, ax1] : [by, ay0, ay1];
}

// `hb` = flat obstacle bounds {n, x0,y0,x1,y1} (typed arrays) + `hb.grid`, prebuilt once per
// routeGraph call. Reading flats in the hot loop avoids object-property chasing and recomputing
// x+w / y+h on every iteration. Falls back to the full scan when there is no index.
function segHitsHard(ax, ay, bx, by, hb, eps) {
    eps = eps == null ? 1 : eps;
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const rx0 = hb.x0, ry0 = hb.y0, rx1 = hb.x1, ry1 = hb.y1, G = hb.grid;
    if (!G) { const n = hb.n; for (let i = 0; i < n; i++) if (x1 > rx0[i] + eps && x0 < rx1[i] - eps && y1 > ry0[i] + eps && y0 < ry1[i] - eps) return true; return false; }
    const [B, b0, b1] = pickBands(G, x0, x1, y0, y1), st = B.start, it = B.items;
    for (let k = b0; k <= b1; k++) for (let p = st[k], q = st[k + 1]; p < q; p++) {
        const i = it[p];
        if (x1 > rx0[i] + eps && x0 < rx1[i] - eps && y1 > ry0[i] + eps && y0 < ry1[i] - eps) return true;
    }
    return false;
}
// Returns indices into `soft` of every penalty rect the segment crosses. A rect spanning several
// buckets can be reported twice — harmless, the caller always funnels the list through internG.
// `soft.grid` is the index (see buildRectGrid); its flats mirror soft[i].x0/y0/x1/y1.
// Appends the indices of every penalty rect the segment crosses into the shared SCR scratch, starting
// at `at`, and returns the new count. Writing into scratch rather than returning a fresh array keeps
// the hot path allocation-free — internG sorts/dedupes SCR in place and usually finds an existing
// record, so nothing is retained.
function softList(ax, ay, bx, by, soft, at) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const G = soft.grid;
    if (!G) { for (let i = 0; i < soft.length; i++) { const g = soft[i]; if (x1 > g.x0 + 1 && x0 < g.x1 - 1 && y1 > g.y0 + 1 && y0 < g.y1 - 1) SCR[at++] = i; } return at; }
    const sx0 = G.x0, sy0 = G.y0, sx1 = G.x1, sy1 = G.y1;
    const [B, b0, b1] = pickBands(G, x0, x1, y0, y1), st = B.start, it = B.items;
    for (let k = b0; k <= b1; k++) for (let p = st[k], q = st[k + 1]; p < q; p++) {
        const i = it[p];
        if (x1 > sx0[i] + 1 && x0 < sx1[i] - 1 && y1 > sy0[i] + 1 && y0 < sy1[i] - 1) SCR[at++] = i;
    }
    return at;
}
// the 1-bend L (or straight) options A=(ax,ay)->B=(bx,by) that clear all hard rects.
// `wantD1` (optional) = the only leave-direction the caller will keep. Every option's d1 follows from
// the geometry alone, BEFORE any obstacle test, so a caller that filters on d1 anyway (the face-port
// precompute, which forces a perpendicular exit, and the gate fallbacks) hands it in and the rejected
// variant costs nothing instead of a full segHitsHard + softList pair. Same options out either way.
function edgeOpts(ax, ay, bx, by, hb, soft, wantD1) {
    const out = [], len = Math.abs(ax - bx) + Math.abs(ay - by);
    if (len < 0.5) return out;
    const dh = bx > ax ? "E" : "W", dv = by > ay ? "S" : "N";
    const ih = DC[dh], iv = DC[dv];
    const gt = soft.intern;
    if (Math.abs(ax - bx) < 0.5) { if (wantD1 && wantD1 !== dv) return out; if (!segHitsHard(ax, ay, bx, by, hb)) out.push({ d1: dv, d2: dv, i1: iv, i2: iv, corner: null, len, gset: internG(softList(ax, ay, bx, by, soft, 0), gt) }); return out; }
    if (Math.abs(ay - by) < 0.5) { if (wantD1 && wantD1 !== dh) return out; if (!segHitsHard(ax, ay, bx, by, hb)) out.push({ d1: dh, d2: dh, i1: ih, i2: ih, corner: null, len, gset: internG(softList(ax, ay, bx, by, soft, 0), gt) }); return out; }
    if (!wantD1 || wantD1 === dh) {
        const c1 = [bx, ay];
        if (!segHitsHard(ax, ay, c1[0], c1[1], hb) && !segHitsHard(c1[0], c1[1], bx, by, hb))
            out.push({ d1: dh, d2: dv, i1: ih, i2: iv, corner: c1, len, gset: internG(softList(c1[0], c1[1], bx, by, soft, softList(ax, ay, c1[0], c1[1], soft, 0)), gt) });
    }
    if (!wantD1 || wantD1 === dv) {
        const c2 = [ax, by];
        if (!segHitsHard(ax, ay, c2[0], c2[1], hb) && !segHitsHard(c2[0], c2[1], bx, by, hb))
            out.push({ d1: dv, d2: dh, i1: iv, i2: ih, corner: c2, len, gset: internG(softList(c2[0], c2[1], bx, by, soft, softList(ax, ay, c2[0], c2[1], soft, 0)), gt) });
    }
    return out;
}

// A* over waypoints, state = (node, entryDir); cost = length + bendCost*bends + group penalty.
// Returns the chain [{node, corner}] start->goal (corner = the L-bend used to reach that node).
//
// Built ONCE per routeGraph pass (`makeAStar`) and re-run per connector, because every per-line
// allocation here is paid ~290 times over ~800 waypoints. The scratch state is therefore hoisted and
// reused: dist/prev live in typed arrays indexed by state id (a Map keyed on a small int was the
// single hottest thing in the profile), staleness is handled by a generation counter instead of
// clearing, and the binary heap is four flat parallel arrays instead of an array of [f,g,n,d] tuples.
//
// SEARCH SEMANTICS ARE UNCHANGED — same costs, same strict `<` relaxation, same heap comparisons and
// the same swap order, so ties break the same way and the chain returned is identical. This is purely
// how the search is stored.
//
// This heap deliberately does NOT use the shared minheap.js: it carries four payload lanes (f/g/node/
// dir) fused into the search, and swapping in a 1-lane heap would change how equal-f ties break in the
// live routing hot path. New searches (busroute.js) use minheap.js.
function makeAStar(WP, baseAdj, baseN, cap) {
    const SN = cap * 5;
    const dist = new Float64Array(SN), prevId = new Int32Array(SN), seen = new Int32Array(SN);
    const prevCorner = new Array(SN);
    let gen = 0;
    let hf = new Float64Array(2048), hg = new Float64Array(2048), hn = new Int32Array(2048), hd = new Int32Array(2048);
    let hlen = 0;
    const grow = () => {
        const g2 = (A, T) => { const b = new T(A.length * 2); b.set(A); return b; };
        hf = g2(hf, Float64Array); hg = g2(hg, Float64Array); hn = g2(hn, Int32Array); hd = g2(hd, Int32Array);
    };
    const swap = (a, b) => {
        let t = hf[a]; hf[a] = hf[b]; hf[b] = t;
        t = hg[a]; hg[a] = hg[b]; hg[b] = t;
        t = hn[a]; hn[a] = hn[b]; hn[b] = t;
        t = hd[a]; hd[a] = hd[b]; hd[b] = t;
    };
    // `d` is the entry direction as its DC index, 4 = none (start). Kept numeric end to end so the
    // hot loop never touches the "N"/"S"/"E"/"W" strings; edges carry DC-coded d1/d2 as e.i1/e.i2.
    return function search(overOf, start, goal, softCost, occCost) {
        gen++; hlen = 0;
        const gx = WP[goal][0], gy = WP[goal][1];
        const h = (i) => Math.abs(WP[i][0] - gx) + Math.abs(WP[i][1] - gy);
        const push = (f, g, n, d) => {
            if (hlen === hf.length) grow();
            let k = hlen++; hf[k] = f; hg[k] = g; hn[k] = n; hd[k] = d;
            while (k) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; swap(p, k); k = p; }
        };
        const s0 = start * 5 + 4;
        dist[s0] = 0; seen[s0] = gen; prevId[s0] = -1;
        push(h(start), 0, start, 4);
        let best = -1;
        while (hlen) {
            const g = hg[0], n = hn[0], d = hd[0];
            hlen--;
            if (hlen) {   // move the tail into the root and sift down (same comparisons as before)
                hf[0] = hf[hlen]; hg[0] = hg[hlen]; hn[0] = hn[hlen]; hd[0] = hd[hlen];
                let k = 0;
                for (; ;) { const a = 2 * k + 1, b = a + 1; let mi = k; if (a < hlen && hf[a] < hf[mi]) mi = a; if (b < hlen && hf[b] < hf[mi]) mi = b; if (mi === k) break; swap(mi, k); k = mi; }
            }
            const cur = n * 5 + d;
            if (g > (seen[cur] === gen ? dist[cur] : 1e18)) continue;
            if (n === goal) { best = cur; break; }
            // base adjacency then overlay — concatenating them allocated an array per expansion; the
            // two-list walk preserves that exact order, so equal-cost edges still resolve the same way.
            const bl = n < baseN ? baseAdj[n] : null, ol = overOf(n);
            for (let li = 0; li < 2; li++) {
                const list = li === 0 ? bl : ol;
                if (!list) continue;
                for (let ei = 0; ei < list.length; ei++) {
                    const e = list[ei];
                    let bends = (e.i1 !== e.i2 ? 1 : 0);
                    if (d !== 4 && e.i1 !== d) bends += 1;
                    const ns = e.to * 5 + e.i2, cap = seen[ns] === gen ? dist[ns] : 1e18;
                    // Penalties only ever ADD, so an edge that already loses on length+bends alone can
                    // never win — bail before the group/occupancy work rather than after. Same outcome,
                    // and in a graph this dense most expansions are exactly this case.
                    const lb = g + e.len + C.bendCost * bends;
                    if (lb >= cap) continue;
                    let pen = 0;
                    const gs = e.gset;
                    if (gs.n) {
                        let t = gs.sum;
                        if (t < 0) { t = 0; for (let z = 0; z < gs.n; z++) t += softCost[gs.ids[z]]; gs.sum = t; }
                        pen = t;
                    }
                    if (occCost) pen += occCost(n, e);   // congestion: steer AWAY from corridors earlier lines packed
                    const ng = lb + pen;
                    if (ng < cap) {
                        dist[ns] = ng; seen[ns] = gen; prevId[ns] = cur; prevCorner[ns] = e.corner;
                        push(ng + h(e.to), ng, e.to, e.i2);
                    }
                }
            }
        }
        if (best < 0) return null;
        const chain = [];
        for (let s = best; ;) { const p = prevId[s]; chain.push({ node: (s / 5) | 0, corner: p >= 0 ? prevCorner[s] : null }); if (p < 0) break; s = p; }
        chain.reverse();
        return chain;
    };
}

// A 2-point line whose ends don't share an axis renders as a DIAGONAL — but every edge is an
// orthogonal 90° route, so a diagonal stands out (the dotted tethers were the usual offenders: they
// centre BOTH ends on their face, and setEnd can't keep a 2-point line orthogonal). Replace it with
// an L (perpendicular faces) or Z (parallel faces) elbow derived from the src/dst face dirs, so it
// bends and arcs like the rest. Already-straight lines pass through untouched.
function orthoElbow(a, b, d1, d2) {
    if (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5) return [a, b];
    const vert = (d) => d === "T" || d === "B";
    if (vert(d1) === vert(d2)) {   // parallel faces -> Z bending on the shared (perpendicular) axis
        if (vert(d1)) { const my = (a[1] + b[1]) / 2; return [a, [a[0], my], [b[0], my], b]; }
        const mx = (a[0] + b[0]) / 2; return [a, [mx, a[1]], [mx, b[1]], b];
    }
    return vert(d1) ? [a, [a[0], b[1]], b] : [a, [b[0], a[1]], b];   // perpendicular -> single corner
}

function simplify(pts) {
    const dd = [];
    for (const p of pts) { const l = dd[dd.length - 1]; if (l && Math.abs(l[0] - p[0]) < 0.5 && Math.abs(l[1] - p[1]) < 0.5) continue; dd.push(p); }
    if (dd.length < 3) return dd;
    const res = [dd[0]];
    for (let i = 1; i < dd.length - 1; i++) { const a = res[res.length - 1], b = dd[i], c = dd[i + 1]; const ch = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5; const cv = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5; if (!ch && !cv) res.push(b); }
    res.push(dd[dd.length - 1]);
    return res;
}

// ---- main: route the whole graph -------------------------------------------
// nodes:[{id,x,y,w,h}]  groups:[{members:[id...]}]  edges:[{from,to,key}]
// opts:{prevSides:Map(key->{d1,d2}), config}.  Returns Map(key -> {pts,p1,d1,p2,d2}).
function routeGraph(nodes, groups, edges, opts = {}) {
    if (opts.config) Object.assign(C, opts.config);
    const bnow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const BM = C.bench ? { t0: bnow() } : null;   // per-phase benchmark marks
    const prevSides = opts.prevSides || null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rects = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, id: n.id }));
    const m = C.clearance, PADG = 18;
    // soft[] holds avoid-with-penalty rects: one per group TITLE band (the top strip of a group's box)
    // so wires stray off the heading. Group BODIES carry no penalty — a box-crossing detour bought
    // nothing on a layout where groups are what wires must thread BETWEEN, and the corner waypoint ring
    // it dragged along made routes bulge around boxes for no gain. Only headings are protected, and
    // every line pays headCross to cross one — internal or foreign, no own-group exemption.
    //
    // Bands are HIGH-COST SOFT, never HARD. A member node sits BELOW its group's full-width band, so
    // hard-blocking the band would leave that node no escape: the router finds no path and drops to a
    // straight degenerate fallback (see stage 2) that ignores every obstacle and slices clean through
    // the banner. Heavy-soft instead makes the router detour around the heading whenever a path exists
    // and cross it (cleanly routed, not a degenerate cut) only when a node is genuinely boxed in.
    const soft = [], softCost = [];   // softCost[i] = penalty to cross soft[i]
    const bands = [];   // title-band rects {x,y,w,h} — passed to nudge as alley walls so the lane shift
                        // can't push a wire (that A* routed AROUND a heading) back ACROSS it
    for (const grp of (groups || [])) {
        // Geometry: prefer the caller's REAL rendered box + title-band height (grp.box/grp.bandH);
        // the title banner occupies the top `bandH` of that box. Fall back to member bounds ± PADG
        // (standalone/test callers without box info) — there the band height is the C.headBand guess.
        let bx0, by0, bx1, band;
        if (grp.box) {
            bx0 = grp.box.x; by0 = grp.box.y; bx1 = grp.box.x + grp.box.w;
            band = grp.bandH || 0;
        } else {
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, any = false;
            for (const id of grp.members) { const nd = byId.get(id); if (!nd) continue; any = true; x0 = Math.min(x0, nd.x); y0 = Math.min(y0, nd.y); x1 = Math.max(x1, nd.x + nd.w); }
            if (!any) continue;
            bx0 = x0 - PADG; by0 = y0 - PADG; bx1 = x1 + PADG; band = C.headBand;
        }
        if (C.headBand > 0 && band > 0) { soft.push({ x0: bx0, y0: by0, x1: bx1, y1: by0 + band }); softCost.push(C.headCross); bands.push({ x: bx0, y: by0, w: bx1 - bx0, h: band }); }
    }
    // extra title bands the caller computed itself (subgroup TOP bands, super-group BOTTOM label
    // band — each has its own position the box+bandH shorthand can't express). Same heavy-soft
    // treatment as a group heading (waypoints at the band corners let wires hug around it).
    for (const tb of (opts.titleBands || [])) { soft.push(tb); softCost.push(C.headCross); bands.push({ x: tb.x0, y: tb.y0, w: tb.x1 - tb.x0, h: tb.y1 - tb.y0 }); }
    // flat HARD obstacle bounds = node rects ONLY — title bands are soft (handled above), never hard,
    // so no member node is ever boxed in by its own heading. Hard-blocked by every segHitsHard.
    const RN = rects.length;
    const rx0 = new Float64Array(RN), ry0 = new Float64Array(RN), rx1 = new Float64Array(RN), ry1 = new Float64Array(RN);
    for (let i = 0; i < rects.length; i++) { const r = rects[i]; rx0[i] = r.x; ry0[i] = r.y; rx1[i] = r.x + r.w; ry1[i] = r.y + r.h; }
    const HB = { n: RN, x0: rx0, y0: ry0, x1: rx1, y1: ry1, grid: buildRectGrid(rx0, ry0, rx1, ry1, RN) };

    // stage 1: base waypoints = inflated node corners + title-band corners; 1-bend adjacency
    const WP = [];
    for (const r of rects) { WP.push([r.x - m, r.y - m], [r.x + r.w + m, r.y - m], [r.x - m, r.y + r.h + m], [r.x + r.w + m, r.y + r.h + m]); }
    for (const g of soft) { WP.push([g.x0 - m, g.y0 - m], [g.x1 + m, g.y0 - m], [g.x0 - m, g.y1 + m], [g.x1 + m, g.y1 + m]); }
    // light soft HALO around every node (penalty-only — its corners aren't added as waypoints, the node's
    // own inflated corners already exist): a thin ring past each node so a segment skimming a node wall
    // pays a tiny cost and prefers a hair of clearance, letting bundles sit off the walls. Bodies stay HARD.
    if (C.haloCost > 0) for (const r of rects) { soft.push({ x0: r.x - C.nodeHalo, y0: r.y - C.nodeHalo, x1: r.x + r.w + C.nodeHalo, y1: r.y + r.h + C.nodeHalo }); softCost.push(C.haloCost); }
    // expose the soft-penalty rects (title bands, node halos) for the lab overlay
    if (opts.softOut) for (let i = 0; i < soft.length; i++) opts.softOut.push({ x: soft[i].x0, y: soft[i].y0, w: soft[i].x1 - soft[i].x0, h: soft[i].y1 - soft[i].y0, cost: softCost[i] });
    // index the soft rects too — built LAST, after the halo push, so it covers the final set. Hung on
    // the array itself so every softList/edgeOpts call site picks it up without threading an argument.
    {
        const SN = soft.length, sx0 = new Float64Array(SN), sy0 = new Float64Array(SN), sx1 = new Float64Array(SN), sy1 = new Float64Array(SN);
        for (let i = 0; i < SN; i++) { const g = soft[i]; sx0[i] = g.x0; sy0[i] = g.y0; sx1[i] = g.x1; sy1[i] = g.y1; }
        soft.grid = buildRectGrid(sx0, sy0, sx1, sy1, SN);
        soft.intern = new Map();   // crossing-set intern table for this pass (see internG)
        // worst case one option touches every soft rect twice (both legs of the L)
        if (SCR.length < SN * 2 + 8) SCR = new Int32Array(SN * 2 + 8);
    }
    const baseN = WP.length;
    const baseAdj = Array.from({ length: baseN }, () => []);
    for (let i = 0; i < baseN; i++) for (let j = i + 1; j < baseN; j++) {
        const A = WP[i], B = WP[j];
        for (const e of edgeOpts(A[0], A[1], B[0], B[1], HB, soft)) {
            baseAdj[i].push({ to: j, d1: e.d1, d2: e.d2, i1: e.i1, i2: e.i2, corner: e.corner, len: e.len, gset: e.gset });
            baseAdj[j].push({ to: i, d1: rev(e.d2), d2: rev(e.d1), i1: REVI[e.i2], i2: REVI[e.i1], corner: e.corner, len: e.len, gset: e.gset });
        }
    }

    if (BM) BM.grid = bnow();
    // precompute each node's 4 face-port edges to the base waypoints (perpendicular-forced)
    const FACES = ["L", "R", "T", "B"];
    const faceCenter = (n, f) => { const c = center(n); return f === "L" ? [n.x, c[1]] : f === "R" ? [n.x + n.w, c[1]] : f === "T" ? [c[0], n.y] : [c[0], n.y + n.h]; };
    const portPos = new Map(), portEdges = new Map();
    for (const n of nodes) {
        const pp = {}, pe = {};
        for (const f of FACES) {
            const sp = faceCenter(n, f); pp[f] = sp; const od = outDir(f), list = [];
            for (let i = 0; i < baseN; i++) { const W = WP[i]; for (const e of edgeOpts(sp[0], sp[1], W[0], W[1], HB, soft, od)) list.push({ to: i, d1: e.d1, d2: e.d2, i1: e.i1, i2: e.i2, corner: e.corner, len: e.len, gset: e.gset }); }
            pe[f] = list;
        }
        portPos.set(n.id, pp); portEdges.set(n.id, pe);
    }
    if (BM) BM.ports = bnow();
    // One A* instance for the whole pass — its scratch arrays are sized for the base graph plus the
    // handful of per-line entry waypoints (S0 + <=4 src + <=4 dst + D0) and reused for every connector.
    const search = makeAStar(WP, baseAdj, baseN, baseN + 16);
    // Per-line overlay edges (entry ports -> base graph). A fresh Map of fresh arrays per connector
    // meant ~800 array allocations x ~290 lines of pure garbage, so the buckets are allocated once and
    // recycled: a generation stamp marks which are live this line, no clearing pass and no re-alloc.
    const OVN = baseN + 16, ovGen = new Int32Array(OVN), ovList = new Array(OVN);
    let ovg = 0;
    const add = (from, e) => {
        if (ovGen[from] !== ovg) { ovGen[from] = ovg; if (ovList[from]) ovList[from].length = 0; else ovList[from] = []; }
        ovList[from].push(e);
    };
    const overOf = (i) => (ovGen[i] === ovg ? ovList[i] : null);

    // stage 2: route each line. Each endpoint is a TERMINAL: either a real NODE (a super-source over
    // its 4 face ports, A* picks the face) or a fixed GATE ({pt,dir,face}) — a single forced-direction
    // port on a group-box surface. Gates are how hierarchical routing (hierRoute.js) funnels a group's
    // boundary-crossing lines through ONE fanned crossing point per face: the outer pass and the inner
    // pass each terminate their half of the line at the SAME gate pt, so the stitched line is seamless.
    const lines = [];
    for (const e of edges) {
        const okFrom = e.fromGate || byId.has(e.from), okTo = e.toGate || byId.has(e.to);
        if (okFrom && okTo) lines.push({ from: e.from, to: e.to, key: e.key, pinSrc: e.pinSrc || null, insetEnd: e.insetEnd || 0, tether: !!e.tether, port: !!e.port, fromGate: e.fromGate || null, toGate: e.toGate || null });
    }
    // super-source/sink anchor position for an endpoint (a node centre, or the gate point itself)
    const anchor = (id, gate) => (gate ? gate.pt : center(byId.get(id)));
    // Congestion: each committed line STAMPS its runs into a coarse occupancy grid; later lines pay
    // OCONG per already-used corridor bucket they'd traverse, so once a corridor fills up A* routes the
    // NEXT line a DIFFERENT way (a nearby empty channel) instead of packing another wire 2px alongside.
    const OCELL = C.occCell, OCONG = C.occCong;
    const occ = new Map();
    // Bucket id is an INT, not "H:12" — occCost runs on every A* expansion, and building a string key
    // there (then hashing it) was the second-hottest thing in the router. Axis goes in bit 0, the
    // rounded corridor index in the rest; same 1:1 bucket identity as the old string form.
    const NOB = -2147483648;   // "this segment isn't an axis-aligned run" sentinel
    const segBucket = (p, q) => (Math.abs(p[1] - q[1]) < 0.5 && Math.abs(p[0] - q[0]) > 0.5) ? (Math.round(p[1] / OCELL) * 2) : (Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) > 0.5) ? (Math.round(p[0] / OCELL) * 2 + 1) : NOB;
    // An edge's buckets follow from its geometry alone (the endpoints of a base edge never move, and a
    // per-line overlay edge is discarded with its line), so resolve them ONCE per edge and cache on it
    // — the occupancy COUNTS still change every time a line is stamped, only the lookup key is fixed.
    const occCost = (n, e) => {
        let b1 = e._b1;
        if (b1 === undefined) {
            const A = WP[n], B = WP[e.to];
            if (!A || !B) return 0;
            if (e.corner) { b1 = e._b1 = segBucket(A, e.corner); e._b2 = segBucket(e.corner, B); }
            else { b1 = e._b1 = segBucket(A, B); e._b2 = NOB; }
        }
        const b2 = e._b2;
        let c = 0;
        if (b1 !== NOB) c += occ.get(b1) || 0;
        if (b2 !== NOB) c += occ.get(b2) || 0;
        return c ? OCONG * c : 0;
    };
    const stamp = (pts) => { for (let i = 0; i + 1 < pts.length; i++) { const b = segBucket(pts[i], pts[i + 1]); if (b !== NOB) occ.set(b, (occ.get(b) || 0) + 1); } };
    // FACING lines: the two endpoint nodes' spans overlap on an axis, so their facing sides line up and a
    // direct connector is the natural route. These are excluded from the heavy crowd-avoidance — routed
    // LAST with plain A* (no congestion, they don't stamp/contribute occupancy) so they stay direct
    // instead of being shoved off their path. Overlaps among them are still fixed by deCollide afterwards.
    // FACING = the two nodes genuinely face each other with a CLEAR direct corridor between them (their
    // spans overlap on an axis AND no node sits in the gap) — a simple straight/L connector. NOT merely
    // span-aligned across the whole canvas (distant aligned nodes with a crowd between are NOT facing).
    const anyNodeIn = (x0, y0, x1, y1) => { for (let i = 0; i < RN; i++) if (rx1[i] > x0 + 1 && rx0[i] < x1 - 1 && ry1[i] > y0 + 1 && ry0[i] < y1 - 1) return true; return false; };
    // Returns the facing FACES {src,dst} when the two nodes truly face with a clear gap between (a direct
    // connector), else null. The sides are PINNED below so a facing line leaves/enters the facing faces
    // and A* draws the straight/L directly, instead of the super-source picking odd sides and doglegging.
    // A facing span narrower than MIN_FACING_SPAN can't clear a rounded corner at both ends
    // (faces.js) — not a straight shot, falls through to the normal A* search instead. The chosen
    // `coord` is clamped by faceKeep the same way busroute.js's `band()` insets its port, so both
    // straight-shot detectors place an endpoint identically off the corner.
    const facingCoord = (lo, hi) => { const k = faceKeep(hi - lo); return Math.max(lo + k, Math.min(hi - k, (lo + hi) / 2)); };
    const facingLine = (ln) => {
        if (ln.fromGate || ln.toGate) return null;
        const a = byId.get(ln.from), b = byId.get(ln.to); if (!a || !b) return null;
        if (a.y < b.y + b.h && b.y < a.y + a.h) {   // y overlap -> horizontally facing? straight line at coord y
            const yo0 = Math.max(a.y, b.y), yo1 = Math.min(a.y + a.h, b.y + b.h);
            if (yo1 - yo0 >= MIN_FACING_SPAN) {
                const coord = facingCoord(yo0, yo1);
                if (a.x + a.w <= b.x && !anyNodeIn(a.x + a.w, yo0, b.x, yo1)) return { horiz: true, src: "R", dst: "L", p0: a.x + a.w, p1: b.x, coord, lo: yo0, hi: yo1 };
                if (b.x + b.w <= a.x && !anyNodeIn(b.x + b.w, yo0, a.x, yo1)) return { horiz: true, src: "L", dst: "R", p0: a.x, p1: b.x + b.w, coord, lo: yo0, hi: yo1 };
            }
        }
        if (a.x < b.x + b.w && b.x < a.x + a.w) {   // x overlap -> vertically facing? straight line at coord x
            const xo0 = Math.max(a.x, b.x), xo1 = Math.min(a.x + a.w, b.x + b.w);
            if (xo1 - xo0 >= MIN_FACING_SPAN) {
                const coord = facingCoord(xo0, xo1);
                if (a.y + a.h <= b.y && !anyNodeIn(xo0, a.y + a.h, xo1, b.y)) return { horiz: false, src: "B", dst: "T", p0: a.y + a.h, p1: b.y, coord, lo: xo0, hi: xo1 };
                if (b.y + b.h <= a.y && !anyNodeIn(xo0, b.y + b.h, xo1, a.y)) return { horiz: false, src: "T", dst: "B", p0: a.y, p1: b.y + b.h, coord, lo: xo0, hi: xo1 };
            }
        }
        return null;
    };
    for (const ln of lines) ln._facing = facingLine(ln);
    lines.sort((p, q) => (p._facing ? 1 : 0) - (q._facing ? 1 : 0));   // heavy (non-facing) first, facing last
    // FACING pre-pass: emit each facing line's direct straight connector NOW and STAMP it, so the heavy
    // lines (routed below, with congestion) see the facing lines' occupancy and steer clear of them.
    const emitFacing = (ln) => { const f = ln._facing; ln.pts = f.horiz ? [[f.p0, f.coord], [f.p1, f.coord]] : [[f.coord, f.p0], [f.coord, f.p1]]; ln.srcSide = f.src; ln.dstSide = f.dst; };
    for (const ln of lines) if (ln._facing) { emitFacing(ln); stamp(ln.pts); }
    if (BM) BM.facing = bnow();
    for (const ln of lines) {
        const base0 = WP.length;
        if (ln._facing) continue;   // already emitted + stamped in the facing pre-pass above
        const prev = prevSides && prevSides.get(ln.key);
        // Build the ENTRY waypoints for each end: [{idx, pt, dir, face, pe?}]. A node contributes its 4
        // face ports (pe = precomputed face->base edges); a gate contributes one point, exit/entry forced
        // to gate.dir. `dir` is the perpendicular direction of the stub touching that entry (out for the
        // source end, in for the dest end); for a gate hierRoute already baked the correct sense into dir.
        const S0 = WP.length; WP.push(anchor(ln.from, ln.fromGate).slice());
        const srcEntries = [];
        if (ln.fromGate) { const idx = WP.length; WP.push(ln.fromGate.pt.slice()); srcEntries.push({ idx, pt: ln.fromGate.pt, dir: ln.fromGate.dir, face: ln.fromGate.face }); }
        else { const pp = portPos.get(ln.from), pe = portEdges.get(ln.from); for (const f of (ln.pinSrc ? [ln.pinSrc] : FACES)) { const idx = WP.length; WP.push(pp[f].slice()); srcEntries.push({ idx, pt: pp[f], dir: outDir(f), face: f, pe: pe[f] }); } }
        const dstEntries = [];
        if (ln.toGate) { const idx = WP.length; WP.push(ln.toGate.pt.slice()); dstEntries.push({ idx, pt: ln.toGate.pt, dir: ln.toGate.dir, face: ln.toGate.face }); }
        else { const pp = portPos.get(ln.to), pe = portEdges.get(ln.to); for (const f of FACES) { const idx = WP.length; WP.push(pp[f].slice()); dstEntries.push({ idx, pt: pp[f], dir: inDirOf(f), face: f, pe: pe[f] }); } }
        const D0 = WP.length; WP.push(anchor(ln.to, ln.toGate).slice());
        ovg++;   // recycle the overlay buckets (see above) — everything stamped below is this line's
        // directional face bias: charge each face by how much its outward normal points AWAY from the
        // other endpoint (0 = straight at it, C.faceBias = straight away), so A* prefers the face facing
        // the target unless obstacles make it genuinely costlier. `aFrom`/`aTo` are the endpoint anchors.
        const aFrom = anchor(ln.from, ln.fromGate), aTo = anchor(ln.to, ln.toGate);
        const faceAway = (face, from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy) || 1, n = FACE_OUT[face]; return C.faceBias * (1 - (n[0] * dx + n[1] * dy) / L) / 2; };
        // hysteresis: non-previous faces cost a small stickiness bias, so the route keeps its face.
        for (const se of srcEntries) add(S0, { to: se.idx, d1: se.dir, d2: se.dir, i1: DC[se.dir], i2: DC[se.dir], corner: null, len: (prev && prev.d1 !== se.face ? C.faceStick : 0) + faceAway(se.face, aFrom, aTo), gset: EMPTY_G });
        for (const de of dstEntries) add(de.idx, { to: D0, d1: de.dir, d2: de.dir, i1: DC[de.dir], i2: DC[de.dir], corner: null, len: (prev && prev.d2 !== de.face ? C.faceStick : 0) + faceAway(de.face, aTo, aFrom), gset: EMPTY_G });
        // entries -> base visibility graph (node faces reuse the precompute; a gate scans the base once)
        for (const se of srcEntries) {
            if (se.pe) { for (const e of se.pe) add(se.idx, e); }
            else for (let i = 0; i < baseN; i++) { const W = WP[i]; for (const e of edgeOpts(se.pt[0], se.pt[1], W[0], W[1], HB, soft, se.dir)) add(se.idx, { to: i, d1: e.d1, d2: e.d2, i1: e.i1, i2: e.i2, corner: e.corner, len: e.len, gset: e.gset }); }
        }
        for (const de of dstEntries) {
            if (de.pe) { for (const e of de.pe) add(e.to, { to: de.idx, d1: rev(e.d2), d2: rev(e.d1), i1: REVI[e.i2], i2: REVI[e.i1], corner: e.corner, len: e.len, gset: e.gset }); }
            else for (let i = 0; i < baseN; i++) { const W = WP[i]; for (const e of edgeOpts(W[0], W[1], de.pt[0], de.pt[1], HB, soft)) if (e.d2 === de.dir) add(i, { to: de.idx, d1: e.d1, d2: e.d2, i1: e.i1, i2: e.i2, corner: e.corner, len: e.len, gset: e.gset }); }
        }
        // direct entry -> entry (short lines that never touch the base graph)
        for (const se of srcEntries) for (const de of dstEntries) for (const e of edgeOpts(se.pt[0], se.pt[1], de.pt[0], de.pt[1], HB, soft, se.dir)) if (e.d2 === de.dir) add(se.idx, { to: de.idx, d1: e.d1, d2: e.d2, i1: e.i1, i2: e.i2, corner: e.corner, len: e.len, gset: e.gset });
        const chain = search(overOf, S0, D0, softCost, ln._facing ? null : occCost);
        if (chain && chain.length >= 3) {
            ln.srcSide = (srcEntries.find((se) => se.idx === chain[1].node) || srcEntries[0]).face;
            ln.dstSide = (dstEntries.find((de) => de.idx === chain[chain.length - 2].node) || dstEntries[0]).face;
            const pts = [];
            for (let c = 1; c < chain.length - 1; c++) { if (chain[c].corner) pts.push(chain[c].corner.slice()); pts.push(WP[chain[c].node].slice()); }
            ln.pts = simplify(pts);
        } else {
            // degenerate (an endpoint trapped inside an overlapping node): orthogonal Z, never a diagonal
            const sc = anchor(ln.from, ln.fromGate), dc = anchor(ln.to, ln.toGate), horiz = Math.abs(dc[0] - sc[0]) >= Math.abs(dc[1] - sc[1]);
            const mx = (sc[0] + dc[0]) / 2, my = (sc[1] + dc[1]) / 2;
            ln.pts = simplify(horiz ? [sc.slice(), [mx, sc[1]], [mx, dc[1]], dc.slice()] : [sc.slice(), [sc[0], my], [dc[0], my], dc.slice()]);
            ln.srcSide = ln.fromGate ? ln.fromGate.face : (ln.pinSrc || (horiz ? (dc[0] >= sc[0] ? "R" : "L") : (dc[1] >= sc[1] ? "B" : "T")));
            ln.dstSide = ln.toGate ? ln.toGate.face : (horiz ? (dc[0] >= sc[0] ? "L" : "R") : (dc[1] >= sc[1] ? "T" : "B"));
        }
        if (!ln._facing) stamp(ln.pts);   // heavy lines record their runs; facing lines contribute nothing
        WP.length = base0;
    }

    if (BM) BM.astar = bnow();
    // stage 3: nudging — split shared corridors into nested lanes, centred in their alley. FACING lines
    // are excluded — they're already the clean direct connector; deCollide alone fans coincident ones apart.
    nudge(lines.filter((l) => !l._facing), byId, rects, opts.outPorts || new Map(), bands);
    if (BM) { const e = bnow(); const nf = lines.filter((l) => l._facing).length; console.log(`[route] ${(e - BM.t0).toFixed(0)}ms total | grid ${(BM.grid - BM.t0).toFixed(0)} ports ${(BM.ports - BM.grid).toFixed(0)} facing ${(BM.facing - BM.ports).toFixed(0)} astar ${(BM.astar - BM.facing).toFixed(0)} nudge ${(e - BM.astar).toFixed(0)} | ${lines.length} lines (${nf} facing, ${lines.length - nf} heavy), ${nodes.length} nodes, ${WP.length} wp`); }

    const out = new Map();
    for (const ln of lines) out.set(ln.key, { pts: ln.pts, p1: ln.pts[0].slice(), d1: ln.srcSide, p2: ln.pts[ln.pts.length - 1].slice(), d2: ln.dstSide });
    return out;
}

// Nudging: each connector is a chain of maximal H/V segments. Connectors sharing a corridor (same
// axis + coord, overlapping span) get distinct parallel lanes (V-seg => x-offset, H-seg => y-offset,
// so a vertex = base + its V-offset + its H-offset and orthogonality is preserved). Port stubs are
// segments too => connectors leaving one face fan out along it. Each lane band is shifted to stay
// within the free alley bounded by neighbouring nodes, so no lane spills across a node edge.
//
// Each corridor used to pick its own lane order independently (sorted by each wire's far endpoint) —
// fine for one corridor alone, but where a BUNDLE turns together from one corridor into another, the
// two corridors' independently-chosen orders can disagree, and the bundle crosses itself right at the
// bend even though it nests cleanly along each straight run. `orderCorridors` below fixes this:
// corridors sharing a bend are reordered together (crossing-minimising adjacent swaps, seeded by the
// old per-corridor sort) so a bundle keeps ONE consistent nesting order through its turns.
// endpoint reference centre for a line end: a node centre, or a gate's fixed point (gate ends have no
// backing node, so byId.get() would be undefined). Used by nudge/fan wherever they'd read a node centre.
const endCenter = (ln, which, byId) => { const g = which === "from" ? ln.fromGate : ln.toGate; return g ? g.pt : center(byId.get(which === "from" ? ln.from : ln.to)); };
// force a gate endpoint back onto its exact gate point after nudging, carrying the collinear stub
// vertex so the stub stays orthogonal — keeps the two halves' seam exactly coincident for stitching.
function pinGate(pts, pt, last) {
    if (!pts || pts.length < 2) return;
    const i = last ? pts.length - 1 : 0, j = last ? pts.length - 2 : 1;
    if (pts.length > 2) { if (Math.abs(pts[j][0] - pts[i][0]) < 0.5) pts[j][0] = pt[0]; if (Math.abs(pts[j][1] - pts[i][1]) < 0.5) pts[j][1] = pt[1]; }
    pts[i][0] = pt[0]; pts[i][1] = pt[1];
}
const MARG = 1;   // px of clearance baked onto every nudge alley wall (node + band) so lanes never sit flush
const CORNER_CLEAR = 15;   // px a band/node eviction pushes a vertex PAST the edge: > the corner radius (14)
                           // so the rounded bend at the evicted vertex can never arc back across the edge
const FACE_SPREAD = 2.4;   // fan a same-source bundle this many lane-gaps apart on its node face (uses
                           // the face's spare width so a fat bundle reads clearly), capped to the face
const WIDE_GAP_MULT = 6;   // cap on how far a widened (grid-stepped) lane gap can grow past C.laneGap
                           // when an alley has spare room — keeps a loose group readably spaced without
                           // flinging tracks across a wide-open gutter
function nudge(lines, byId, rects, outPorts, bands) {
    // alley walls = node rects PLUS title bands: a lane shift must not push a wire across a heading
    // it was routed around. A band straddling the segment's coord gives no bound (already inside it,
    // which A* avoids); a band to one side clamps that side, keeping the lane out of the band.
    const walls = bands && bands.length ? rects.concat(bands) : rects;
    for (const ln of lines) { ln._V = ln.pts.map((p) => p.slice()); ln._dx = new Array(ln._V.length).fill(0); ln._dy = new Array(ln._V.length).fill(0); }
    const segs = [], lineSegs = new Map();   // lineSegs: ln -> its segs in path order (no gaps — every
                                              // consecutive vertex pair is exactly one H or V segment,
                                              // orthogonal invariant) — walked below to find where a wire
                                              // BENDS from one bundled corridor straight into another.
    for (const ln of lines) { const V = ln._V, arr = []; lineSegs.set(ln, arr);
        for (let i = 0; i + 1 < V.length; i++) { const a = V[i], b = V[i + 1]; let s = null;
            if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5) s = { ln, axis: "V", coord: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]), i0: i, i1: i + 1 };
            else if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 0.5) s = { ln, axis: "H", coord: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), i0: i, i1: i + 1 };
            if (s) { segs.push(s); arr.push(s); }
    } }
    const buckets = new Map();
    for (const s of segs) { const k = s.axis + ":" + Math.round(s.coord); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(s); }
    const through = (s) => { const c0 = endCenter(s.ln, "from", byId), c1 = endCenter(s.ln, "to", byId); return s.axis === "V" ? (c0[0] + c1[0]) / 2 : (c0[1] + c1[1]) / 2; };
    // A coord-bucket can hold segments at the SAME axis-coord that live in vertically (or
    // horizontally) disjoint parts of the graph — different corridors that merely line up. Bundling
    // them as one lane group is wrong: their combined span reaches walls all over the canvas, which
    // yields a nonsensical (even inverted) alley and a wild lane shift that flings a segment across a
    // node it never touched. So first split each bucket into CLUSTERS of span-overlapping segments
    // (a real shared corridor) and lay each cluster out independently.
    const clustersOf = (arr) => {
        const byLo = arr.slice().sort((a, b) => a.lo - b.lo);
        const out = []; let cur = null, curHi = -Infinity;
        for (const s of byLo) {
            if (cur && s.lo > curHi + C.laneGap) { out.push(cur); cur = null; curHi = -Infinity; }   // gap > a lane → new corridor
            (cur || (cur = [])).push(s); curHi = Math.max(curHi, s.hi);
        }
        if (cur) out.push(cur);
        return out;
    };

    // ---- corridors: one per real shared run, seeded in the old through()-sorted order --------------
    const corridors = [];
    // A cluster of exactly ONE segment still becomes its own (single-track) corridor: a lone wire
    // crossing a gap gets the same alley-centering pass as a bundle (below), instead of being left
    // wherever A* happened to hug a border — see the centering step for why this needed T=1 too.
    for (const bucket of buckets.values()) {
        for (const arr of clustersOf(bucket)) {
            if (!arr.length) continue;
            arr.sort((a, b) => through(a) - through(b) || a.lo - b.lo);
            const corridor = { id: corridors.length, axis: arr[0].axis, coord: arr[0].coord, segs: arr };
            for (const s of arr) s.corridor = corridor;
            corridors.push(corridor);
        }
    }

    // ---- bends: every point a wire crosses from one BUNDLED corridor straight into another ---------
    // (two adjacent segments of the same wire that both landed in a corridor — a lone/unbundled side
    // has no order to keep consistent, so it's skipped). Grouped by the PAIR of corridors it bends
    // between: two wires only risk crossing each other at a bend where they share BOTH corridors.
    const pairGroups = new Map();
    for (const [, arr] of lineSegs) for (let k = 0; k + 1 < arr.length; k++) {
        const a = arr[k], b = arr[k + 1];
        if (!a.corridor || !b.corridor) continue;
        const key = a.corridor.id < b.corridor.id ? a.corridor.id + "," + b.corridor.id : b.corridor.id + "," + a.corridor.id;
        (pairGroups.get(key) || pairGroups.set(key, []).get(key)).push({ a, b });
    }
    for (const [key, group] of pairGroups) {
        const [ia, ib] = key.split(",").map(Number);
        (corridors[ia].touching || (corridors[ia].touching = [])).push(group);
        (corridors[ib].touching || (corridors[ib].touching = [])).push(group);
    }
    // live lane offset of a segment, read from its corridor's CURRENT order — reflects the latest
    // trial swap below, no separate bookkeeping needed.
    const laneOffset = (s) => { const c = s.corridor, T = c.segs.length; return (c.segs.indexOf(s) - (T - 1) / 2) * C.laneGap; };
    // the point a wire's bend sits at, from its two (V,H) corridor coords + their live lane offsets.
    const cornerOf = (bl) => {
        const v = bl.a.axis === "V" ? bl.a : bl.b, h = bl.a.axis === "H" ? bl.a : bl.b;
        return [v.corridor.coord + laneOffset(v), h.corridor.coord + laneOffset(h)];
    };
    // one endpoint of a segment's OTHER (non-corner) end, read straight from the pre-offset base
    // points — approximate (ignores any offset it might separately pick up as some earlier/later
    // bend's OWN corner), but only ever matters far from the corner under test, so it never flips
    // the local verdict. `isA` says whether this seg is the bend's entering half (corner = its i1,
    // so the far end is i0) or its exiting half (corner = its i0, far end i1).
    const farOf = (seg, isA, axisIdx) => seg.ln._V[isA ? seg.i0 : seg.i1][axisIdx];
    // does wire bl1's bend cross wire bl2's? Both pieces are axis-aligned (one V, one H per wire), so
    // "crosses" reduces to an exact interval test — does wire A's vertical run pass through wire B's
    // corner Y, AND wire B's horizontal run pass through wire A's corner X (or the symmetric case).
    // The CORNER end of each run is exact (from cornerOf, live offsets); the far end is the base-point
    // approximation above — mixing a base bound with a live corner on the SAME run would be wrong
    // (the live offset can push the corner past where the base far-bound sits, right where it matters
    // most), so each run's span is built from its own two consistent ends.
    const bendCrosses = (bl1, bl2) => {
        const c1 = cornerOf(bl1), c2 = cornerOf(bl2);
        const v1 = bl1.a.axis === "V" ? bl1.a : bl1.b, h1 = bl1.a.axis === "H" ? bl1.a : bl1.b;
        const v2 = bl2.a.axis === "V" ? bl2.a : bl2.b, h2 = bl2.a.axis === "H" ? bl2.a : bl2.b;
        const fy1 = farOf(v1, v1 === bl1.a, 1), fx1 = farOf(h1, h1 === bl1.a, 0);
        const fy2 = farOf(v2, v2 === bl2.a, 1), fx2 = farOf(h2, h2 === bl2.a, 0);
        const y1lo = Math.min(fy1, c1[1]), y1hi = Math.max(fy1, c1[1]), x1lo = Math.min(fx1, c1[0]), x1hi = Math.max(fx1, c1[0]);
        const y2lo = Math.min(fy2, c2[1]), y2hi = Math.max(fy2, c2[1]), x2lo = Math.min(fx2, c2[0]), x2hi = Math.max(fx2, c2[0]);
        const cross1 = y1lo <= c2[1] && c2[1] <= y1hi && x2lo <= c1[0] && c1[0] <= x2hi;
        const cross2 = y2lo <= c1[1] && c1[1] <= y2hi && x1lo <= c2[0] && c2[0] <= x1hi;
        return cross1 || cross2;
    };
    const groupCrossings = (group) => { let n = 0; for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (bendCrosses(group[i], group[j])) n++; return n; };
    const corridorCrossings = (c) => { let n = 0; for (const g of (c.touching || [])) n += groupCrossings(g); return n; };

    // ---- reorder: adjacent-transposition, accept only strict crossing reductions -------------------
    // Seeded by the through()-sort, so an already-clean bundle makes zero swaps and looks identical to
    // before; only a bundle whose corridors disagree on order gets reshuffled, and only until it stops
    // improving — monotonic, so this can only remove crossings, never introduce a worse-looking bundle.
    const active = corridors.filter((c) => c.touching && c.touching.length);
    // adjacent-transposition needs up to N passes to fully untangle a width-N bundle (worst case,
    // reverse order) — a flat cap starves wide bundles before they finish reordering. Scale to the
    // widest active corridor; cheap even when oversized, since a sweep with no accepted swap exits
    // the loop immediately (line below).
    let widest = 6; for (const c of active) if (c.segs.length > widest) widest = c.segs.length;
    const MAX_SWEEPS = widest;
    for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
        let changed = false;
        for (const c of active) for (let i = 0; i + 1 < c.segs.length; i++) {
            const before = corridorCrossings(c);
            const t = c.segs[i]; c.segs[i] = c.segs[i + 1]; c.segs[i + 1] = t;
            if (corridorCrossings(c) < before) changed = true;
            else { const t2 = c.segs[i]; c.segs[i] = c.segs[i + 1]; c.segs[i + 1] = t2; }   // no gain: revert
        }
        if (!changed) break;
    }

    // per-track spacing: pack at the minimum laneGap, but widen (grid-stepped, capped) to use spare
    // alley room instead of always cramming tracks to the tightest possible width.
    const gridGap = (n, room) => { if (n < 2) return C.laneGap; const steps = Math.floor(room / (n - 1) / C.laneGap); return Math.min(C.laneGap * Math.max(1, steps), C.laneGap * WIDE_GAP_MULT); };
    const soloQueue = [];   // lone (T=1) walled-both-sides segments, resolved after the main loop (see below)
    for (const corridor of corridors) {
        const arr = corridor.segs;
        const trackEnd = [];
        if (corridor.touching && corridor.touching.length) {
            // order-preserving packing: a segment gets the smallest track that's both free (no active
            // occupant) AND above every currently-active segment it overlaps. Plain greedy first-fit can
            // still re-pack a later, "outer" segment onto an earlier, freed track — invisible on its
            // own (the freed segment is gone by then) but it silently reinverts the order the sweep
            // above just settled, against whichever OTHER still-active segment now sits above it.
            for (const s of arr) {
                let minTr = 0;
                for (let t = 0; t < trackEnd.length; t++) if (trackEnd[t] > s.lo + 1) minTr = t + 1;
                let tr = minTr; while (tr < trackEnd.length && trackEnd[tr] > s.lo + 1) tr++;
                if (tr === trackEnd.length) trackEnd.push(s.hi); else trackEnd[tr] = s.hi;
                s.tr = tr;
            }
        } else {
            // no downstream bend to protect — plain greedy keeps this bundle at its most compact width.
            for (const s of arr) { let tr = 0; while (tr < trackEnd.length && trackEnd[tr] > s.lo + 1) tr++; if (tr === trackEnd.length) trackEnd.push(-Infinity); s.tr = tr; trackEnd[tr] = s.hi; }
        }
        const T = trackEnd.length;
        const axis = corridor.axis, coord = corridor.coord;
        let lo = Infinity, hi = -Infinity; for (const s of arr) { lo = Math.min(lo, s.lo); hi = Math.max(hi, s.hi); }
        let lb = -Infinity, rb = Infinity;
        for (const nd of walls) {
            const ov = axis === "V" ? (nd.y < hi && nd.y + nd.h > lo) : (nd.x < hi && nd.x + nd.w > lo); if (!ov) continue;
            // +MARG inflates every wall by 1px so a lane keeps a hair of clearance and never sits flush.
            const near0 = (axis === "V" ? nd.x : nd.y) - MARG, near1 = (axis === "V" ? nd.x + nd.w : nd.y + nd.h) + MARG;
            if (near1 <= coord + 0.5) lb = Math.max(lb, near1);            // wall entirely on the low side
            else if (near0 >= coord - 0.5) rb = Math.min(rb, near0);       // wall entirely on the high side
            // STRADDLE: the wall spans this lane's coord, i.e. the segment is INSIDE it (a node it's
            // cutting through, or a band it's crossing). A side bound alone can't evict it, so push the
            // whole bundle out to the NEARER edge of the wall.
            else if (coord - near0 <= near1 - coord) rb = Math.min(rb, near0);
            else lb = Math.max(lb, near1);
        }
        const clear = 5, aLo = lb + clear, aHi = rb - clear;
        const bounded = Number.isFinite(lb) && Number.isFinite(rb) && aHi > aLo;
        // A lone (T=1) segment walled on both sides is NOT resolved here — a DIFFERENT lone segment
        // elsewhere (a different corridor entirely, since it never shared this one's raw coordinate)
        // can independently centre into this exact same alley, and nothing here would know to keep
        // them apart: both would land on the identical coordinate and render on top of each other.
        // Defer it to the cross-corridor merge pass below, which groups by alley + span-overlap first.
        if (T === 1 && bounded) { soloQueue.push({ seg: arr[0], axis, lo, hi, aLo, aHi, coord }); continue; }
        const g = bounded ? gridGap(T, aHi - aLo) : C.laneGap;
        const minOff = (0 - (T - 1) / 2) * g, maxOff = ((T - 1) - (T - 1) / 2) * g;
        const minC = coord + minOff, maxC = coord + maxOff;
        let shift = 0;
        // Only move into the alley when it has real room. If walls leave aHi <= aLo (no alley — e.g.
        // a wall straddles both sides) the math goes haywire and would fling the bundle far off,
        // ACROSS unrelated nodes. There, keep A*'s coord (shift 0) — A* already routed it obstacle-free.
        if (aHi > aLo) {
            if (bounded) {
                // walled on BOTH sides — a real gutter/gap. Centre the bundle in it rather than just
                // clamping overflow, so a bundle that already "fits" stops sitting wherever A* happened
                // to hug one border and instead runs down the middle of the gap.
                shift = (aLo + aHi) / 2 - (minC + maxC) / 2;
            } else {
                // one-sided (or open) — nothing to centre against, only pull back if spilling out.
                if (maxC > aHi) shift = aHi - maxC;
                if (minC + shift < aLo) { const room = aHi - aLo, need = maxC - minC; shift = need <= room ? aLo - minC : (aLo + aHi) / 2 - (minC + maxC) / 2; }
            }
        }
        for (const s of arr) {
            const off = (s.tr - (T - 1) / 2) * g + shift;
            if (axis === "V") { s.ln._dx[s.i0] += off; s.ln._dx[s.i1] += off; } else { s.ln._dy[s.i0] += off; s.ln._dy[s.i1] += off; }
        }
    }
    // ---- lone-wire centring: merge by shared alley, not by raw coordinate ---------------------------
    // Two lone wires crossing the SAME gap almost never share a raw A* coordinate (each hugged
    // whichever border its own gate happened to bend near), so they never became one corridor above —
    // yet both independently centre into the identical alley midpoint, landing on the exact same
    // coordinate (invisible, unfollowable overlap). Group by the alley itself (not the raw coord),
    // cluster by span overlap, and pack the group onto distinct grid-spaced tracks around its centre.
    {
        const byAlley = new Map();
        for (const q of soloQueue) { const k = q.axis + ":" + Math.round(q.aLo) + ":" + Math.round(q.aHi); (byAlley.get(k) || byAlley.set(k, []).get(k)).push(q); }
        for (const list of byAlley.values()) {
            const byLo = list.slice().sort((a, b) => a.lo - b.lo);
            let cur = [], curHi = -Infinity;
            const flush = () => {
                if (!cur.length) return;
                const n = cur.length, aLo = cur[0].aLo, aHi = cur[0].aHi, centre = (aLo + aHi) / 2;
                const g = gridGap(n, aHi - aLo);
                for (let i = 0; i < n; i++) {
                    const q = cur[i], off = (i - (n - 1) / 2) * g + (centre - q.coord);
                    if (q.axis === "V") { q.seg.ln._dx[q.seg.i0] += off; q.seg.ln._dx[q.seg.i1] += off; } else { q.seg.ln._dy[q.seg.i0] += off; q.seg.ln._dy[q.seg.i1] += off; }
                }
                cur = []; curHi = -Infinity;
            };
            for (const q of byLo) { if (cur.length && q.lo > curHi + C.laneGap) flush(); cur.push(q); curHi = Math.max(curHi, q.hi); }
            flush();
        }
    }
    for (const ln of lines) {
        const pts = ln._V.map((p, i) => [p[0] + ln._dx[i], p[1] + ln._dy[i]]);
        clampEnds(pts, byId.get(ln.from), ln.srcSide); clampEnds(pts, byId.get(ln.to), ln.dstSide, true);
        ln._pts = pts;   // hold before simplify so the port-fan pass can place each source stub
    }
    // every PORT-line endpoint (data/control lines on a port dot) is laid out on the face it touches —
    // BOTH the leaving end and the arriving end — fanned along that face so no two dots overlap.
    fanFaceEnds(lines, byId, outPorts);
    // GATE ends: nudging shifts every stub's coord by its lane offset, which would slide a gate endpoint
    // off its exact gate point and open a gap at the stitch seam. Re-pin them (fanFaceEnds already left
    // them alone) so both halves of a crossing line still meet at the identical point.
    for (const ln of lines) { if (ln.fromGate) pinGate(ln._pts, ln.fromGate.pt, false); if (ln.toGate) pinGate(ln._pts, ln.toGate.pt, true); }
    // pull a line's arriving end a few px INTO the node (along the face normal, so the last segment
    // just shortens and stays orthogonal) — lets an end marker rest halfway inside the edge.
    for (const ln of lines) if (ln.insetEnd) insetEndpoint(ln._pts, ln.dstSide, ln.insetEnd);
    for (const ln of lines) {
        let pts = simplify(ln._pts);
        if (pts.length === 2) pts = orthoElbow(pts[0], pts[1], ln.srcSide, ln.dstSide);   // never a diagonal
        ln.pts = pts;
    }
    // FINAL backstop: the lane shift can slide a segment 1-5px into a wall edge (its center-when-narrow
    // fallback overrides the alley clamp). A* never crosses, so any overlap here is nudge's doing —
    // push each offending INTERIOR segment back out to the wall's nearest edge (+MARG). Endpoints
    // (port stubs, i=0 / last) are left alone so a wire never detaches from its node face.
    if (walls.length) for (const ln of lines) evictSegments(ln.pts, walls, ln.tether, ln, byId);
}
// Push interior axis-segments of `pts` out of any wall they sit inside, to the wall's nearer edge.
// Moving a segment's constant-axis coord shifts its two corner vertices only (neighbouring segments
// lengthen/shorten, staying orthogonal); the lane separation set by nudge is preserved.
function evictSegments(pts, walls, isTether, ln, byId) {
    for (let i = 0; i + 1 < pts.length; i++) {   // EVERY segment, incl. the port stubs — a tiny shift just
        const a = pts[i], b = pts[i + 1];        // slides the port along its own face, it stays attached
        const firstSeg = i === 0, lastSeg = i + 1 === pts.length - 1;
        const isEnd = firstSeg || lastSeg;   // a port-stub: clamp its move so it can't run off-face
        // a GATE stub must not move: its endpoint is pinned to the exact seam point shared with the other half.
        if (ln && ((firstSeg && ln.fromGate) || (lastSeg && ln.toGate))) continue;
        const vert = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5;
        const horiz = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 0.5;
        if (!vert && !horiz) continue;
        // A tether attaches at its face CENTRE, but fanFaceEnds can fan that endpoint to a coord whose
        // stub runs straight ACROSS a sibling node (grazing it) — and A* never sanctioned it. We can't
        // slide the stub freely (its dot must stay on the endpoint node's own face), so push it just off
        // the crossed node to that node's NEARER edge, then clamp back inside the endpoint node's face
        // span so the dot stays attached. If the clamp lands back inside the crossed node (face too
        // small to clear it) we leave the stub — detaching the wire is worse than the graze.
        const endNode = (isTether && isEnd && byId) ? byId.get(firstSeg ? ln.from : ln.to) : null;
        const lo = vert ? Math.min(a[1], b[1]) : Math.min(a[0], b[0]);
        const hi = vert ? Math.max(a[1], b[1]) : Math.max(a[0], b[0]);
        const coord = vert ? a[0] : a[1];
        for (const r of walls) {
            const e0 = vert ? r.x : r.y, e1 = vert ? (r.x + r.w) : (r.y + r.h);
            const o0 = vert ? r.y : r.x, o1 = vert ? (r.y + r.h) : (r.x + r.w);
            if (hi <= o0 + 0.5 || lo >= o1 - 0.5) continue;          // segment span misses the wall
            if (coord <= e0 + 0.5 || coord >= e1 - 0.5) {            // already outside (or flush with) the wall
                // GRAZING: an interior run sitting within MARG of an edge it runs alongside would render
                // flush against it — push it out to a full MARG clear. Port/gate stubs (isEnd) keep their
                // existing exemptions untouched; only a non-endpoint run gets nudged here.
                if (!isEnd) {
                    if (coord > e0 - MARG && coord <= e0 + 0.5) { const t = e0 - MARG; if (vert) { a[0] = t; b[0] = t; } else { a[1] = t; b[1] = t; } }
                    else if (coord < e1 + MARG && coord >= e1 - 0.5) { const t = e1 + MARG; if (vert) { a[0] = t; b[0] = t; } else { a[1] = t; b[1] = t; } }
                }
                continue;
            }
            if (isTether && isEnd) {
                if (!endNode) continue;   // no backing node face to clamp against (gate/free end) — leave it
                // nearer edge of the crossed node (minimal move off a graze), CORNER_CLEAR past it
                const t = (coord - e0) <= (e1 - coord) ? e0 - CORNER_CLEAR : e1 + CORNER_CLEAR;
                // clamp inside the endpoint node's face span (perp to the face = this segment's const axis)
                const fLo = vert ? endNode.x : endNode.y, fHi = vert ? (endNode.x + endNode.w) : (endNode.y + endNode.h);
                const ct = Math.max(fLo, Math.min(fHi, t));
                if (ct > e0 + 0.5 && ct < e1 - 0.5) continue;   // clamped back INSIDE the crossed node — can't clear without detaching
                if (vert) { a[0] = ct; b[0] = ct; } else { a[1] = ct; b[1] = ct; }
                continue;
            }
            // Push to the edge on the side the line's NEIGHBOURS sit — NOT the nearer edge. A line
            // arching over a node has both ends below the band; shoving its top run to the nearer
            // (top) edge would leave the two legs spanning the band. Following the neighbours sinks
            // the run to the bottom edge so the whole detour stays on one side, legs clear.
            const side = (j) => { if (j < 0 || j >= pts.length) return 0; const c = vert ? pts[j][0] : pts[j][1]; return c >= e1 ? 1 : (c <= e0 ? -1 : 0); };
            const lean = side(i - 1) + side(i + 2);
            // CORNER_CLEAR past the edge (> corner radius) so the rounded bend can't arc back over it.
            const toHigh = lean !== 0 ? lean > 0 : (coord - e0) > (e1 - coord);
            const target = toHigh ? e1 + CORNER_CLEAR : e0 - CORNER_CLEAR;
            if (isEnd && Math.abs(target - coord) > 14) continue;    // big move on a port stub would pull the dot off its face — leave it
            if (vert) { a[0] = target; b[0] = target; } else { a[1] = target; b[1] = target; }
        }
    }
}
// Lay out the endpoints of EVERY line along the face each touches: the source end where it LEAVES a
// node and the destination end where it ARRIVES. Per face, endpoints are ordered by where their far end
// sits (so stubs don't cross) and spread one laneGap apart, kept inside the face and floored at PORT_MIN
// so dots never overlap. A face with a SINGLE endpoint keeps its routed coordinate (port ends stay
// centred as before; structural ends are left exactly where routed) — only 2+ endpoints sharing a face
// redistribute. An idle out-port dot sits dead-centre of its face, so lines on that same face are kept
// clear of the centre.
function fanFaceEnds(lines, byId, outPorts) {
    const groups = new Map();   // "<node id>\x00<side>" -> endpoints touching that face
    const push = (nodeId, side, ln, end, other) => {
        const k = nodeId + "\x00" + side;
        (groups.get(k) || groups.set(k, []).get(k)).push({ ln, end, other });
    };
    for (const ln of lines) {
        // every line (port AND structural) registers both ends, so endpoints sharing a face
        // co-distribute and never collapse onto one point. A lone endpoint keeps its routed coord below.
        // GATE ends are skipped: they're pre-fanned by gates.js at a fixed point on a group-box face and
        // must not be redistributed onto a node face (they have no backing node here anyway).
        if (!ln.fromGate) push(ln.from, ln.srcSide, ln, "src", endCenter(ln, "to", byId));
        if (!ln.toGate) push(ln.to, ln.dstSide, ln, "dst", endCenter(ln, "from", byId));
    }
    for (const [k, arr] of groups) {
        const sep = k.indexOf("\x00"), nodeId = k.slice(0, sep), side = k.slice(sep + 1);
        const nd = byId.get(nodeId); if (!nd) continue;
        const horiz = side === "L" || side === "R";
        const lo = horiz ? nd.y : nd.x, span = horiz ? nd.h : nd.w, mid = lo + span / 2;
        arr.sort((a, b) => (horiz ? a.other[1] - b.other[1] : a.other[0] - b.other[0]));
        const n = arr.length;
        // keep endpoints off the rounded corners; shrink the inset on a short face so the band never inverts.
        const keep = faceKeep(span);
        const clamp = (c) => Math.max(lo + keep, Math.min(lo + span - keep, c));
        // a node with an idle out-port on THIS face parks a (non-endpoint) dot at the centre — keep lines
        // off it. A real PORT line leaving the face owns the dot (its own start); a structural src does not.
        const reserveMid = outPorts.get(nodeId) === side && !arr.some((e) => e.end === "src" && (e.ln.pinSrc || e.ln.port));
        if (n < 2) {
            // lone endpoint: port ends keep the canonical centred position; structural ends keep their
            // ROUTED coord (never force-centred). Either way, an end under an idle out-port dot is nudged clear.
            const e = arr[0], p = e.ln._pts; if (!p || p.length < 2) continue;
            const last = e.end === "dst", i = last ? p.length - 1 : 0;
            const cur = horiz ? p[i][1] : p[i][0];
            // a satellite tether attaches at the face CENTRE (both ends) — never let A* leave it at a corner
            let c = (e.ln.pinSrc || e.ln.port || e.ln.tether) ? mid : cur;
            if (reserveMid && Math.abs(c - mid) < PORT_MIN) c = mid + PORT_MIN;
            if (e.ln.pinSrc || e.ln.port || e.ln.tether || Math.abs(c - cur) > 0.5) setEnd(p, side, clamp(c), last);
            continue;
        }
        let coords;
        if (reserveMid) {
            // An idle out-port dot sits dead-centre of this face. Carve a PORT_MIN-wide gap around
            // mid and fan the (sorted) endpoints OUTWARD on either side of it, so none lands on the
            // dot — nor, when an endpoint would fall at mid, gets bumped straight onto its neighbour
            // (the old per-endpoint "+PORT_MIN" nudge did exactly that, stacking two lines on one coord).
            const step = Math.max(C.laneGap, PORT_MIN);
            const below = Math.ceil(n / 2);   // endpoints seated below the gap; the rest go above
            coords = arr.map((_, i) => i < below
                ? mid - PORT_MIN - (below - 1 - i) * step
                : mid + PORT_MIN + (i - below) * step);
        } else {
            // spread endpoints to use the FACE's spare room (up to FACE_SPREAD lane-gaps apart), not the
            // bare min — a fat same-source bundle then leaves its node visibly fanned instead of a
            // laneGap-tight ribbon you can't read. Still capped to the face span (minus the corner keep).
            const pref = Math.min(span - 2 * keep, (n - 1) * C.laneGap * FACE_SPREAD);
            const spread = Math.max(0, pref, (n - 1) * PORT_MIN);
            coords = arr.map((_, i) => mid - spread / 2 + (i * spread) / (n - 1));
        }
        for (let i = 0; i < n; i++) setEnd(arr[i].ln._pts, side, clamp(coords[i]), arr[i].end === "dst");
    }
}
// keep a fanned port endpoint within its node face span (perp coord already correct)
function clampEnds(pts, nd, side, last) {
    if (!nd || pts.length < 2) return;
    const i = last ? pts.length - 1 : 0, j = last ? pts.length - 2 : 1;
    // keep the endpoint off the rounded corners; shrink the inset on a short face so it never inverts.
    if (side === "T" || side === "B") { const M = faceKeep(nd.w), x = Math.max(nd.x + M, Math.min(nd.x + nd.w - M, pts[i][0])); if (pts[j] && Math.abs(pts[j][0] - pts[i][0]) < 0.5) pts[j] = [x, pts[j][1]]; pts[i] = [x, pts[i][1]]; }
    else { const M = faceKeep(nd.h), y = Math.max(nd.y + M, Math.min(nd.y + nd.h - M, pts[i][1])); if (pts[j] && Math.abs(pts[j][1] - pts[i][1]) < 0.5) pts[j] = [pts[j][0], y]; pts[i] = [pts[i][0], y]; }
}

// place a port-line endpoint at `coord` along its face (perp axis), carrying the collinear stub
// vertex with it so that segment stays orthogonal — the line meets its dot. `last` picks the END
// endpoint (arriving) instead of the START (leaving).
function setEnd(pts, side, coord, last) {
    if (pts.length < 2) return;
    const i = last ? pts.length - 1 : 0, j = last ? pts.length - 2 : 1;
    // carry the collinear stub vertex too — but ONLY when it's interior. On a 2-point (straight) line
    // the "neighbour" IS the opposite endpoint; dragging it would yank that dot off its own node when
    // both ends fan to different coords. There, just move this endpoint (the segment goes diagonal).
    const carry = pts.length > 2;
    if (side === "T" || side === "B") { if (carry && Math.abs(pts[j][0] - pts[i][0]) < 0.5) pts[j][0] = coord; pts[i][0] = coord; }
    else { if (carry && Math.abs(pts[j][1] - pts[i][1]) < 0.5) pts[j][1] = coord; pts[i][1] = coord; }
}

// ---- render: SVG path from a polyline (square or arc-rounded corners) ------
function polylinePath(pts, corners = "curve", radius = 14) {
    if (!pts || pts.length < 2) return "";
    if (pts.length === 2 || corners === "square")
        return "M " + pts.map((p) => `${rnd(p[0])} ${rnd(p[1])}`).join(" L ");
    let d = `M ${rnd(pts[0][0])} ${rnd(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const rad = Math.min(radius, len(a, b) / 2, len(b, c) / 2);
        const pin = toward(b, a, rad), pout = toward(b, c, rad);
        d += ` L ${rnd(pin[0])} ${rnd(pin[1])} Q ${rnd(b[0])} ${rnd(b[1])} ${rnd(pout[0])} ${rnd(pout[1])}`;
    }
    const e = pts[pts.length - 1];
    d += ` L ${rnd(e[0])} ${rnd(e[1])}`;
    return d;
}
const rnd = (n) => Math.round(n * 10) / 10;
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function toward(from, to, dist) { const l = len(from, to) || 1; return [from[0] + (to[0] - from[0]) * (dist / l), from[1] + (to[1] - from[1]) * (dist / l)]; }

/* ══════════ minheap.js ══════════ */
// minheap.js — the shared binary min-heap behind the graph searches.
//
// Flat typed arrays instead of an array of tuples: a Float64Array of keys (the A*/Dijkstra `f`) and a
// parallel Int32Array of payloads (a packed state id). One instance is reused across searches —
// `clear()` resets the length, it never reallocates — so a search sitting inside a retry loop doesn't
// churn the allocator.
//
// The popped key is exposed as `.topKey` (set by `pop()`), since a search that prunes on cost needs
// the key it just took, and returning a pair would allocate.
//
// NOT yet a caller: route.js `makeAStar` fuses four payload lanes (f/g/node/dir) into its own heap and
// is documented as semantics-frozen — porting it would change tie-break order in the live routing hot
// path. New searches should use this.

function makeHeap(cap = 1024) {
    let key = new Float64Array(cap), val = new Int32Array(cap), n = 0;
    const grow = () => {
        const k2 = new Float64Array(key.length * 2); k2.set(key); key = k2;
        const v2 = new Int32Array(val.length * 2); v2.set(val); val = v2;
    };
    const h = {
        topKey: 0,
        get size() { return n; },
        clear() { n = 0; },
        push(k, v) {
            if (n === key.length) grow();
            let i = n++; key[i] = k; val[i] = v;
            while (i) {
                const p = (i - 1) >> 1;
                if (key[p] <= key[i]) break;
                const tk = key[p]; key[p] = key[i]; key[i] = tk;
                const tv = val[p]; val[p] = val[i]; val[i] = tv;
                i = p;
            }
        },
        // Returns the min payload; its key lands in `h.topKey`. Undefined on an empty heap — callers
        // guard with `while (h.size)`.
        pop() {
            h.topKey = key[0];
            const out = val[0];
            n--;
            if (n) {
                key[0] = key[n]; val[0] = val[n];
                let i = 0;
                for (; ;) {
                    const a = 2 * i + 1, b = a + 1;
                    let m = i;
                    if (a < n && key[a] < key[m]) m = a;
                    if (b < n && key[b] < key[m]) m = b;
                    if (m === i) break;
                    const tk = key[m]; key[m] = key[i]; key[i] = tk;
                    const tv = val[m]; val[m] = val[i]; val[i] = tv;
                    i = m;
                }
            }
            return out;
        },
    };
    return h;
}

/* ══════════ corridors.js ══════════ */
// corridors.js — bus-corridor detection (Phase 1 of the bus router).
//
// A "bus corridor" is a maximal node-free axis-aligned strip that runs in the gap between node
// clusters: a wire trunk can travel along it and lanes pack across its width. This module ONLY
// finds them; it draws nothing and knows nothing about the DOM. Later phases route wires onto them.
//
//   findCorridors(nodeRects, opts) -> [{ axis:'v'|'h', x, y, w, h, cap }]
//
//   axis 'v' = vertical corridor (tall; thickness is its x-extent, length is its y-extent)
//   axis 'h' = horizontal corridor (wide; thickness is its y-extent, length is its x-extent)
//   cap      = max lines it can hold = floor(thickness / laneGap)
//
// Method: slab decomposition of free space. Inflate every node by `margin` (keep-out). Cut the
// cross-axis at every inflated node edge into slabs; within a slab every node either spans it fully
// or misses it entirely (no edge lies interior), so the free runs along the long axis are just the
// gaps between the spanning nodes. Each free run is then extended across neighbouring slabs as far
// as a run still fully containing it exists — giving the maximal free strip and its true width.
//
// Blockers are NODES ONLY. Group boxes are soft (a bus may run through a group's whitespace) so they
// are not passed in and do not block.
//
// NOTE (CLAUDE.md rule 7): the retired corridor.js one-go router built an hOpen/vOpen open-channel *grid*; this
// module emits free *strips as rectangles* — a different abstraction for this phase. Kept separate
// deliberately; reconcile only if a later phase genuinely needs one shared free-space structure.

const EPS = 0.5;

// Merge a list of [lo,hi] intervals (sorted by lo) into disjoint covered spans.
function mergeIntervals(iv) {
    if (!iv.length) return [];
    iv.sort((a, b) => a[0] - b[0]);
    const out = [iv[0].slice()];
    for (let i = 1; i < iv.length; i++) {
        const cur = iv[i], last = out[out.length - 1];
        if (cur[0] <= last[1] + EPS) last[1] = Math.max(last[1], cur[1]);
        else out.push(cur.slice());
    }
    return out;
}

// Free gaps in [lo,hi] left uncovered by `covered` (disjoint, sorted spans).
function gaps(covered, lo, hi) {
    const out = [];
    let cursor = lo;
    for (const [c0, c1] of covered) {
        if (c1 <= lo || c0 >= hi) continue;
        if (c0 > cursor + EPS) out.push([cursor, Math.min(c0, hi)]);
        cursor = Math.max(cursor, c1);
        if (cursor >= hi) break;
    }
    if (cursor < hi - EPS) out.push([cursor, hi]);
    return out;
}

// Core: find maximal free strips in abstract (a = cross/thickness axis, b = long/length axis) space.
// rects here are {a0,a1,b0,b1} inflated. Returns [{a0,a1,b0,b1}] maximal free rectangles.
// `bounds` (optional {aLo,aHi,bLo,bHi}) frames the free space by an outer box instead of the tightest
// bounding box of the obstacles themselves — used by freeRects() so open canvas beyond the node
// cluster (out to the viewport edge) counts as free space too. Omitted (findCorridors' path): behaves
// exactly as before — the a/b range is derived purely from the obstacle rects.
function stripsAB(rects, bounds = null) {
    if (!bounds && !rects.length) return [];
    const bLo = bounds ? bounds.bLo : Math.min(...rects.map(r => r.b0));
    const bHi = bounds ? bounds.bHi : Math.max(...rects.map(r => r.b1));

    // slab boundaries along the cross axis = every unique inflated edge, clipped into the bounds
    // when given (a node edge outside the bounds contributes the bounds edge instead).
    const edgeSet = new Set();
    if (bounds) { edgeSet.add(bounds.aLo); edgeSet.add(bounds.aHi); }
    for (const r of rects) {
        if (!bounds) { edgeSet.add(r.a0); edgeSet.add(r.a1); continue; }
        const a0 = Math.max(r.a0, bounds.aLo), a1 = Math.min(r.a1, bounds.aHi);
        if (a1 > a0) { edgeSet.add(a0); edgeSet.add(a1); }
    }
    const aEdges = [...edgeSet].sort((p, q) => p - q);
    if (aEdges.length < 2) return [];

    // per-slab free runs along b
    const slabs = [];
    for (let i = 0; i < aEdges.length - 1; i++) {
        const aL = aEdges[i], aR = aEdges[i + 1];
        if (aR - aL < EPS) continue;
        const mid = (aL + aR) / 2;
        const blocked = [];
        for (const r of rects) if (r.a0 <= mid && r.a1 >= mid) blocked.push([r.b0, r.b1]);
        const runs = gaps(mergeIntervals(blocked), bLo, bHi);
        slabs.push({ aL, aR, runs });
    }

    // extend each run across neighbouring slabs while a run still fully contains it. Extension
    // stops at a slab whose runs don't cover [t,b] — i.e. a node body walls the channel there.
    // Stopping at the first/last slab instead means the strip is open to the world edge on that
    // side (not walled by a node): flag it so callers can require "between nodes".
    const contains = (slab, t, b) => slab.runs.some(([rt, rb]) => rt <= t + EPS && rb >= b - EPS);
    const seen = new Set();
    const out = [];
    for (let i = 0; i < slabs.length; i++) {
        for (const [t, b] of slabs[i].runs) {
            let iL = i, iR = i;
            while (iR + 1 < slabs.length && contains(slabs[iR + 1], t, b)) iR++;
            while (iL - 1 >= 0 && contains(slabs[iL - 1], t, b)) iL--;
            const a0 = slabs[iL].aL, a1 = slabs[iR].aR;
            const key = `${Math.round(a0)}|${Math.round(a1)}|${Math.round(t)}|${Math.round(b)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ a0, a1, b0: t, b1: b, walled: iL > 0 && iR < slabs.length - 1 });
        }
    }
    return out;
}

// Drop strips fully contained by a wider-or-equal strip (removes nested duplicates from the
// per-run extension). O(n^2) on strip count — fine after the length/width filters upstream.
function dropContained(strips) {
    const keep = [];
    for (let i = 0; i < strips.length; i++) {
        const s = strips[i];
        let contained = false;
        for (let j = 0; j < strips.length; j++) {
            if (i === j) continue;
            const o = strips[j];
            const thicker = (o.a1 - o.a0) >= (s.a1 - s.a0) - EPS;
            const covers = o.a0 <= s.a0 + EPS && o.a1 >= s.a1 - EPS && o.b0 <= s.b0 + EPS && o.b1 >= s.b1 - EPS;
            const strictlyBigger = (o.a1 - o.a0) + (o.b1 - o.b0) > (s.a1 - s.a0) + (s.b1 - s.b0) + EPS;
            if (thicker && covers && (strictlyBigger || j < i)) { contained = true; break; }
        }
        if (!contained) keep.push(s);
    }
    return keep;
}

// c minus k as axis-aligned rectangles (0-4 pieces): the parts of c not covered by k.
function subtractRect(c, k) {
    const cx1 = c.x + c.w, cy1 = c.y + c.h, kx0 = k.x, ky0 = k.y, kx1 = k.x + k.w, ky1 = k.y + k.h;
    const ix0 = Math.max(c.x, kx0), iy0 = Math.max(c.y, ky0), ix1 = Math.min(cx1, kx1), iy1 = Math.min(cy1, ky1);
    if (ix0 >= ix1 - EPS || iy0 >= iy1 - EPS) return [c];    // no real overlap
    const out = [];
    if (c.y < iy0 - EPS) out.push({ x: c.x, y: c.y, w: c.w, h: iy0 - c.y });          // above the overlap
    if (iy1 < cy1 - EPS) out.push({ x: c.x, y: iy1, w: c.w, h: cy1 - iy1 });          // below
    if (c.x < ix0 - EPS) out.push({ x: c.x, y: iy0, w: ix0 - c.x, h: iy1 - iy0 });    // left (within overlap band)
    if (ix1 < cx1 - EPS) out.push({ x: ix1, y: iy0, w: cx1 - ix1, h: iy1 - iy0 });    // right
    return out;
}

// Enforce zero same-axis overlap by CLIPPING, not dropping. Process largest-first; subtract every
// already-kept corridor from the candidate and keep whatever non-overlapping pieces survive (still
// long/thick enough to be a channel). The kept set is pairwise non-overlapping, but a corridor that
// merely clips another is shortened rather than silently deleted, so coverage is preserved.
function suppressOverlaps(cor, laneGap, minLen, minAspect) {
    const area = (c) => c.w * c.h;
    const capOf = (thick) => Math.floor(thick / laneGap) + 1;
    const valid = (axis, w, h) => {
        const thick = axis === "v" ? w : h, len = axis === "v" ? h : w;
        return capOf(thick) >= 1 && len >= minLen && len >= thick * minAspect;
    };
    const order = [...cor].sort((a, b) => area(b) - area(a));
    const kept = [];
    for (const c of order) {
        let pieces = [{ x: c.x, y: c.y, w: c.w, h: c.h }];
        for (const k of kept) {
            pieces = pieces.flatMap((p) => subtractRect(p, k));
            if (!pieces.length) break;
        }
        for (const p of pieces) {
            if (!valid(c.axis, p.w, p.h)) continue;
            kept.push({ axis: c.axis, x: p.x, y: p.y, w: p.w, h: p.h, cap: capOf(c.axis === "v" ? p.w : p.h) });
        }
    }
    return kept;
}

/**
 * Find every maximal free (obstacle-clear) rectangle in a node layout — the same slab-decomposition
 * core findCorridors uses to carve wire channels, minus the corridor-only filters (walled, min
 * aspect/length), so a wide near-square gap ("plaza") a node could sit in is kept, not discarded.
 * Used by node placement (node_layout.js) to find where a freshly-created node fits without overlap.
 * @param {Object<string,{x,y,w,h}>} nodeRects
 * @param {Object} [opts]
 * @param {number} [opts.margin=0]  keep-out halo inflated around every node (0 = touching allowed)
 * @param {{x,y,w,h}} [opts.bounds] frame free space by this outer box (else the obstacles' own extent)
 * @returns {Array<{x:number, y:number, w:number, h:number}>}
 */
function freeRects(nodeRects, opts = {}) {
    const { margin = 0, bounds = null } = opts;
    const rects = Object.values(nodeRects || {});

    // vertical-cross pass: cross axis = x (a), long axis = y (b)
    const vRects = rects.map(r => ({ a0: r.x - margin, a1: r.x + r.w + margin, b0: r.y - margin, b1: r.y + r.h + margin }));
    const vBounds = bounds ? { aLo: bounds.x, aHi: bounds.x + bounds.w, bLo: bounds.y, bHi: bounds.y + bounds.h } : null;
    const vOut = dropContained(stripsAB(vRects, vBounds)).map(s => ({ x: s.a0, y: s.b0, w: s.a1 - s.a0, h: s.b1 - s.b0 }));

    // horizontal-cross pass: cross axis = y (a), long axis = x (b) — catches wide gaps the vertical
    // pass' slab merge might not extend into (same two-pass shape findCorridors uses).
    const hRects = rects.map(r => ({ a0: r.y - margin, a1: r.y + r.h + margin, b0: r.x - margin, b1: r.x + r.w + margin }));
    const hBounds = bounds ? { aLo: bounds.y, aHi: bounds.y + bounds.h, bLo: bounds.x, bHi: bounds.x + bounds.w } : null;
    const hOut = dropContained(stripsAB(hRects, hBounds)).map(s => ({ x: s.b0, y: s.a0, w: s.b1 - s.b0, h: s.a1 - s.a0 }));

    return [...vOut, ...hOut];
}

/**
 * Find bus corridors over a node layout.
 * @param {Object<string,{x,y,w,h}>} nodeRects
 * @param {Object} [opts]
 * @param {number} [opts.margin=22]  keep-out halo inflated around every node
 * @param {number} [opts.laneGap=12] per-lane spacing; cap = floor(thickness / laneGap) + 1
 * @param {number} [opts.minLen=280] drop corridors shorter than this along their long axis
 * @returns {Array<{axis:'v'|'h', x:number, y:number, w:number, h:number, cap:number}>}
 */
function findCorridors(nodeRects, opts = {}) {
    const { margin = 22, laneGap = 12, minLen = 280, minAspect = 4, smallCap = 3, tightGap = 6 } = opts;
    const rects = Object.values(nodeRects || {});
    if (!rects.length) return [];

    const inflate = (mapA) => rects.map(mapA);
    // lanes may ride the two edges of the channel, so N gaps hold N+1 lanes (fencepost). A SMALL-cap
    // corridor (a bottleneck) is packed tighter — its lanes use `tightGap` instead of `laneGap`, which
    // buys extra capacity; `extra` records how many lanes that tightening gained (shown as +N in the lab).
    const capSpec = (thick) => {
        const base = Math.floor(thick / laneGap) + 1;
        if (base <= smallCap) { const cap = Math.floor(thick / tightGap) + 1; return { cap, gap: tightGap, extra: cap - base }; }
        return { cap: base, gap: laneGap, extra: 0 };
    };

    // A corridor must be (a) walled by nodes on both cross sides — genuinely *between* nodes, not a
    // strip open to the empty world edge — and (b) at least `minAspect` times longer than it is thick,
    // so it reads as a channel, not a near-square plaza (which the transposed pass emits correctly).
    const keep = (s) => s.walled && (s.b1 - s.b0) >= (s.a1 - s.a0) * minAspect;

    // vertical corridors: cross axis = x (thickness), long axis = y (length)
    const vRects = inflate(r => ({ a0: r.x - margin, a1: r.x + r.w + margin, b0: r.y - margin, b1: r.y + r.h + margin }));
    let vCor = [];
    for (const s of dropContained(stripsAB(vRects))) {
        if (!keep(s)) continue;
        const thick = s.a1 - s.a0, len = s.b1 - s.b0, sp = capSpec(thick);
        if (sp.cap < 1 || len < minLen) continue;
        vCor.push({ axis: 'v', x: s.a0, y: s.b0, w: thick, h: len, cap: sp.cap, gap: sp.gap, capExtra: sp.extra });
    }

    // horizontal corridors: cross axis = y (thickness), long axis = x (length)
    const hRects = inflate(r => ({ a0: r.y - margin, a1: r.y + r.h + margin, b0: r.x - margin, b1: r.x + r.w + margin }));
    let hCor = [];
    for (const s of dropContained(stripsAB(hRects))) {
        if (!keep(s)) continue;
        const thick = s.a1 - s.a0, len = s.b1 - s.b0, sp = capSpec(thick);
        if (sp.cap < 1 || len < minLen) continue;
        hCor.push({ axis: 'h', x: s.b0, y: s.a0, w: len, h: thick, cap: sp.cap, gap: sp.gap, capExtra: sp.extra });
    }

    // overlap allowed: same-axis corridors may overlap — but a corridor almost entirely inside a
    // bigger same-axis one (a redundant near-duplicate) is dropped. `INSIDE` = fraction of the
    // smaller's area covered by the bigger to count as "inside".
    const INSIDE = 0.9;
    const areaIn = (c, k) => {
        const ix = Math.max(0, Math.min(c.x + c.w, k.x + k.w) - Math.max(c.x, k.x));
        const iy = Math.max(0, Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y));
        return ix * iy;
    };
    const dropInside = (cs) => cs.filter((c, i) => {
        const ac = c.w * c.h;
        return !cs.some((k, j) => j !== i && (k.w * k.h > ac + EPS || (Math.abs(k.w * k.h - ac) < EPS && j < i))
            && areaIn(c, k) / ac >= INSIDE);
    });
    return [...dropInside(vCor), ...dropInside(hCor)];
}

/* ══════════ busroute.js ══════════ */
// busroute.js — the bus router: route the "not facing" lines across a network of bus corridors.
//
// A line whose two nodes FACE each other (share a row or a column, so a direct L/straight shot
// exists) needs no bus — left for a later phase. A line whose nodes do NOT face each other travels
// the BUS NETWORK end to end:
//   APPROACH  source face -> nearest reachable bus's lane
//   RIDE/TURN ride that bus, turn 90 degrees at each junction (where two perpendicular corridors
//             cross) onto the next bus, hopping until a bus is reached that the target can exit to
//   EXIT      leave the last bus onto the target face
// Every bus ridden reserves one lane (centre-out). A bus line never routes THROUGH a node, but it
// does not deconflict with other wires ahead inside a channel — junction crossings are expected.
//
// Joins are resolved ONE SOURCE NODE AT A TIME. If a bus is full, has no path to the target, or the
// approach/exit can't be placed cleanly, the line falls through to the next start bus; a line with
// no workable option is left unrouted and the caller flags it `no-bus-route` (surfaced, not hidden).
// Committed approaches/exits deconflict later lines; placed wires stay followable.
//
// Lane reservation within a corridor fills from the CENTRE outward. Corridors + the junction graph
// come from findCorridors (corridors.js). This is the LIVE default router: busgraph.js adapts it to
// routing.js's contract (see ROUTE.router in routing.js).


const BUS_EPS = 0.6;
const MIN_SEP = 3;   // DEFAULT min gap between parallel wires: closer than this and they read as one
                     // (matches followable.js's crowd gate). The app overrides it via opts.minSep --
                     // the oracle tolerates 3px bundles, a rendered canvas at zoom does not.
const TIE = 40;      // start-bus distances within this many px count as "the same distance"
const NODE_CLEAR = 6; // a wire may not ride within this many px of a non-endpoint node's edge

// Any node overlapping the band (x0,y0)-(x1,y1)? 1px slack so the two flanking nodes (whose faces are
// the band edges) don't count. Mirrors the app-side facing check (route.js `anyNodeIn`).
function anyNodeIn(nodeRects, x0, y0, x1, y1) {
    for (const id in nodeRects) {
        const m = nodeRects[id];
        if (m.x + m.w > x0 + 1 && m.x < x1 - 1 && m.y + m.h > y0 + 1 && m.y < y1 - 1) return true;
    }
    return false;
}

// Two nodes FACE each other only when their spans overlap on one axis AND the gap between the facing
// faces is CLEAR of any node (line of sight). Returns { axis, bandLo, bandHi, p0, p1, d1, d2 }: the
// connector runs along `axis`, its port sits anywhere in [bandLo,bandHi] — the overlap band inset at
// both ends so the port can't land on a rounded corner (see `band` below) — it spans
// p0..p1 on the other axis, and d1/d2 are the faces it leaves/arrives on. Null if they don't face
// (then the line is bus-routed). Mirrors route.js `facingLine`.
function facingGeom(a, b, nodeRects) {
    const ax1 = a.x + a.w, ay1 = a.y + a.h, bx1 = b.x + b.w, by1 = b.y + b.h;
    // The overlap band's bounds ARE node edges, and the same coord lands on BOTH nodes — so a lane
    // reserved at an extreme attaches inside a rounded corner (and on the narrower node it can be a
    // corner while still mid-face on the wider one). Pull both ends in by the shared face keep, which
    // carries the short-face guard so a narrow overlap can't invert. The line-of-sight test below
    // stays on the RAW band: what the port may not do is not what the gap must be clear of.
    const band = (lo, hi) => { const k = faceKeep(hi - lo); return { bandLo: lo + k, bandHi: hi - k }; };
    // A pair whose facing span is too narrow to fit MIN_FACING_SPAN can never clear a rounded
    // corner at both ends (see faces.js) — not a straight shot, fall through to the bus network.
    if (a.y < by1 && b.y < ay1) {                            // y overlap -> horizontal shot (band in Y)
        const yo0 = Math.max(a.y, b.y), yo1 = Math.min(ay1, by1);
        if (yo1 - yo0 >= MIN_FACING_SPAN) {
            if (ax1 <= b.x && !anyNodeIn(nodeRects, ax1, yo0, b.x, yo1)) return { axis: "h", ...band(yo0, yo1), p0: ax1, p1: b.x, d1: "R", d2: "L" };
            if (bx1 <= a.x && !anyNodeIn(nodeRects, bx1, yo0, a.x, yo1)) return { axis: "h", ...band(yo0, yo1), p0: a.x, p1: bx1, d1: "L", d2: "R" };
        }
    }
    if (a.x < bx1 && b.x < ax1) {                            // x overlap -> vertical shot (band in X)
        const xo0 = Math.max(a.x, b.x), xo1 = Math.min(ax1, bx1);
        if (xo1 - xo0 >= MIN_FACING_SPAN) {
            if (ay1 <= b.y && !anyNodeIn(nodeRects, xo0, ay1, xo1, b.y)) return { axis: "v", ...band(xo0, xo1), p0: ay1, p1: b.y, d1: "B", d2: "T" };
            if (by1 <= a.y && !anyNodeIn(nodeRects, xo0, by1, xo1, a.y)) return { axis: "v", ...band(xo0, xo1), p0: a.y, p1: by1, d1: "T", d2: "B" };
        }
    }
    return null;
}

// Spatial index of node rects, bucketed into a grid of `cell`-sized squares, so a band query only
// tests the handful of nodes near it instead of all of them. A per-query generation stamp avoids
// re-testing a node that spans several cells (no per-query allocation).
function buildNodeIndex(nodeRects, cell) {
    const nodes = [], byCell = new Map();
    for (const id in nodeRects) {
        const m = nodeRects[id], ni = nodes.length;
        nodes.push({ id, x: m.x, y: m.y, x1: m.x + m.w, y1: m.y + m.h });
        for (let cx = Math.floor(m.x / cell); cx <= Math.floor((m.x + m.w) / cell); cx++)
            for (let cy = Math.floor(m.y / cell); cy <= Math.floor((m.y + m.h) / cell); cy++)
                pushBucket(byCell, cx + "," + cy, ni);
    }
    return { nodes, byCell, cell, stamp: new Int32Array(nodes.length), gen: 0 };
}
// Any node (other than `skip`) overlapping the axis-aligned band [x0,x1]x[y0,y1]?
function bandBlocked(index, skip, x0, x1, y0, y1) {
    if (x1 <= x0 || y1 <= y0) return false;
    const { nodes, byCell, cell, stamp } = index, gen = ++index.gen;
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
        for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
            const arr = byCell.get(cx + "," + cy);
            if (!arr) continue;
            for (const ni of arr) {
                if (stamp[ni] === gen) continue;
                stamp[ni] = gen;
                const n = nodes[ni];
                if (n.id !== skip && n.x < x1 && n.x1 > x0 && n.y < y1 && n.y1 > y0) return true;
            }
        }
    return false;
}

// Can source node `a` approach corridor `c` without an intervening node in the way? The band spans
// the node's face extent out to the corridor's spine on the facing side.
function reachable(a, aId, c, index) {
    const cxc = c.x + c.w / 2, cyc = c.y + c.h / 2, acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    if (c.axis === "v") {
        return cxc >= acx ? !bandBlocked(index, aId, a.x + a.w, cxc, a.y, a.y + a.h)
                          : !bandBlocked(index, aId, cxc, a.x, a.y, a.y + a.h);
    }
    return cyc >= acy ? !bandBlocked(index, aId, a.x, a.x + a.w, a.y + a.h, cyc)
                      : !bandBlocked(index, aId, a.x, a.x + a.w, cyc, a.y);
}

// reachability of every corridor from a node is constant, so compute it once per node and cache the
// boolean array (indexed by corridor idx). Source nodes and shared targets reuse it.
function reachAll(cache, nodeId, node, lanes, index) {
    let arr = cache.get(nodeId);
    if (!arr) { arr = lanes.map((c) => reachable(node, nodeId, c, index)); cache.set(nodeId, arr); }
    return arr;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- geometry helpers -----------------------------------------------------------------------

// Axis-aligned segments of a polyline as {axis:'h'|'v', c, lo, hi} (c = the constant coordinate).
function segsOf(pts) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        if (Math.abs(y0 - y1) < 0.5 && Math.abs(x0 - x1) >= 0.5) out.push({ axis: "h", c: y0, lo: Math.min(x0, x1), hi: Math.max(x0, x1) });
        else if (Math.abs(x0 - x1) < 0.5 && Math.abs(y0 - y1) >= 0.5) out.push({ axis: "v", c: x0, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
    }
    return out;
}

// Does any segment enter a node's forbidden zone? Nodes in `ends` (the route's own source/target) use
// their bare rect — a wire legitimately touches those faces. Every OTHER node is inflated by `clear`,
// so a wire may neither pass through it NOR ride hugging within `clear` of its edge.
function crossesNode(pts, ends, nodeRects, clear = 0) {
    for (const s of segsOf(pts)) {
        for (const id in nodeRects) {
            const c = ends.has(id) ? 0 : clear;
            const m = nodeRects[id], mx0 = m.x - c, mx1 = m.x + m.w + c, my0 = m.y - c, my1 = m.y + m.h + c;
            if (s.axis === "h") {
                if (s.c > my0 + 0.5 && s.c < my1 - 0.5 && s.lo < mx1 - 0.5 && s.hi > mx0 + 0.5) return true;
            } else {
                if (s.c > mx0 + 0.5 && s.c < mx1 - 0.5 && s.lo < my1 - 0.5 && s.hi > my0 + 0.5) return true;
            }
        }
    }
    return false;
}

// If a route segment passes through a node, return the index of the PATH corridor whose lane it rides
// (matched by the segment's constant coordinate), so the retry can route around that corridor. Returns
// -1 if nothing crosses, or the crossing segment isn't one of the path rides (approach/exit).
function crossingCorridor(pts, path, pathLanes, nodeRects) {
    for (const s of segsOf(pts)) {
        let hit = false;
        for (const id in nodeRects) {
            const m = nodeRects[id], mx0 = m.x, mx1 = m.x + m.w, my0 = m.y, my1 = m.y + m.h;
            if (s.axis === "h") { if (s.c > my0 + 0.5 && s.c < my1 - 0.5 && s.lo < mx1 - 0.5 && s.hi > mx0 + 0.5) { hit = true; break; } }
            else { if (s.c > mx0 + 0.5 && s.c < mx1 - 0.5 && s.lo < my1 - 0.5 && s.hi > my0 + 0.5) { hit = true; break; } }
        }
        if (!hit) continue;
        for (let i = 0; i < path.length; i++) {
            const rideAxis = path[i].axis === "v" ? "v" : "h";
            if (s.axis === rideAxis && Math.abs(pathLanes[i] - s.c) < 0.6) return i;
        }
        return -1;
    }
    return -1;
}

// Is point p strictly INSIDE segment s's interior (not at its endpoints)? A vertex landing here forms
// a T-junction with s (the wire owning s passes straight through where this vertex turns/ends).
function ptOnInterior(p, s) {
    const px = p[0], py = p[1];
    if (s.axis === "h") return Math.abs(py - s.c) < 0.6 && px > s.lo + 0.6 && px < s.hi - 0.6;
    return Math.abs(px - s.c) < 0.6 && py > s.lo + 0.6 && py < s.hi - 0.6;
}
// Does the wire cross or re-touch ITSELF? Every other check here holds a route against nodes or
// against OTHER wires — nothing stopped a route from cutting across its own approach leg (board a bus
// heading north, ride back south past where you boarded). The eye loses that line exactly like it
// loses two overlapping ones, and followable.js counts it as `self-overlap`.
//
// Only NON-ADJACENT segments count: consecutive ones legitimately share the corner between them, so
// the perpendicular test demands a STRICTLY interior crossing rather than a touch.
function selfCrosses(pts) {
    const s = segsOf(pts);
    for (let i = 0; i < s.length; i++) {
        for (let j = i + 2; j < s.length; j++) {
            const A = s[i], B = s[j];
            if (A.axis === B.axis) {
                if (Math.abs(A.c - B.c) < 0.6 && Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) > BUS_EPS) return true;
            } else {
                const V = A.axis === "v" ? A : B, H = A.axis === "v" ? B : A;
                if (V.c > H.lo + 0.6 && V.c < H.hi - 0.6 && H.c > V.lo + 0.6 && H.c < V.hi - 0.6) return true;
            }
        }
    }
    return false;
}
// T-merge: any vertex of this route lands on a committed segment's interior, OR any committed vertex
// lands on this route's interior. (Plain perpendicular crossings — neither side turning — are fine.)
function tMerge(pts, cSegs, cPts) {
    for (const v of pts) for (const s of cSegs) if (ptOnInterior(v, s)) return true;
    const ns = segsOf(pts);
    for (const p of cPts) for (const s of ns) if (ptOnInterior(p, s)) return true;
    return false;
}

// Does any segment overlap (collinear share) or crowd (near-parallel) an already-committed segment?
function conflictsCommitted(pts, committed, sep) {
    for (const s of segsOf(pts)) {
        for (const t of committed) {
            if (s.axis !== t.axis) continue;
            const span = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo);
            if (span <= BUS_EPS) continue;                       // no shared extent along the run
            const d = Math.abs(s.c - t.c);
            if (d < sep) return true;                        // collinear overlap (d~0) or crowd (d<sep)
        }
    }
    return false;
}

// ---- committed-geometry store (bucketed by coordinate for O(1)-ish lookups) -----------------
//
// All placed wires' segments and vertices, indexed so a new route only checks the handful nearby
// instead of the whole growing list. Segments bucket by axis+round(constant coord); vertices bucket
// by round(x) and round(y). Replaces the flat committed/committedPts arrays.
function newStore() { return { seg: new Map(), px: new Map(), py: new Map() }; }
function pushBucket(map, key, v) { (map.get(key) || map.set(key, []).get(key)).push(v); }
function storeCommit(st, pts) {
    for (const s of segsOf(pts)) pushBucket(st.seg, s.axis + ":" + Math.round(s.c), s);
    for (const p of pts) { pushBucket(st.px, Math.round(p[0]), p); pushBucket(st.py, Math.round(p[1]), p); }
}
// overlap/crowd of pts against the store (same-axis, within `sep`, spans overlap)
function storeConflicts(st, pts, sep) {
    const R = Math.ceil(sep);
    for (const s of segsOf(pts)) {
        for (let d = -R; d <= R; d++) {
            const arr = st.seg.get(s.axis + ":" + (Math.round(s.c) + d));
            if (!arr) continue;
            for (const t of arr) if (Math.abs(s.c - t.c) < sep && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > BUS_EPS) return true;
        }
    }
    return false;
}
// T-merge of pts against the store: a new vertex on a committed segment's interior, or vice-versa
function storeTMerge(st, pts) {
    for (const v of pts) {                                   // new vertex on a committed segment interior
        for (const s of st.seg.get("h:" + Math.round(v[1])) || []) if (ptOnInterior(v, s)) return true;
        for (const s of st.seg.get("v:" + Math.round(v[0])) || []) if (ptOnInterior(v, s)) return true;
    }
    for (const s of segsOf(pts)) {                           // committed vertex on a new segment interior
        const arr = (s.axis === "h" ? st.py : st.px).get(Math.round(s.c));
        if (arr) for (const p of arr) if (ptOnInterior(p, s)) return true;
    }
    return false;
}

// ---- lane reservation (per-corridor lanes + proximity occupancy, by SPAN — roll-backable) ---
//
// Each corridor gets its OWN `cap` lanes, centre-out at laneGap spacing within its thickness (so even
// a corridor thinner than laneGap still gets its one centre lane — a global grid would snap it to
// nothing). A lane is reserved only over the SPAN a line rides it, so one lane carries many lines on
// disjoint spans. Crowding between OVERLAPPING corridors' lanes is prevented by a proximity check
// against a global occupancy map: a lane can't be placed within MIN_SEP of another occupied lane over
// an overlapping span. Occupancy is bucketed by rounded coordinate for fast neighbour lookup.

// A corridor's boarding weight: how much extra ride-cost a bottleneck channel charges over a wide
// trunk, so the search prefers roomy corridors instead of treating every hop as equally attractive.
// Purely a function of the corridor's own `cap` (lane count) — no live occupancy, no manual input.
// cap >= trunkCap -> 0 (a free trunk); cap === 1 -> narrowW (the narrowest possible bottleneck).
function corridorWeight(cap, narrowW, trunkCap) {
    if (!narrowW || trunkCap <= 1) return 0;
    const frac = (trunkCap - cap) / (trunkCap - 1);
    return Math.max(0, narrowW * Math.min(1, frac));
}
function makeLanes(corridors, laneGap, narrowW, trunkCap) {
    return corridors.map((c, idx) => {
        const lo = c.axis === "v" ? c.x : c.y, hi = c.axis === "v" ? c.x + c.w : c.y + c.h;
        const center = (lo + hi) / 2, cap = Math.max(1, c.cap), gap = c.gap || laneGap, gridLanes = [];
        for (let slot = 0; slot < cap; slot++) gridLanes.push(center + (slot - (cap - 1) / 2) * gap);
        const laneLo = gridLanes[0], laneHi = gridLanes[gridLanes.length - 1];   // extremes, BEFORE the centre-out sort
        gridLanes.sort((p, q) => Math.abs(p - center) - Math.abs(q - center));   // centre-out
        const weight = corridorWeight(cap, narrowW, trunkCap);
        return { ...c, idx, gridLanes, laneLo, laneHi, laneMid: center, weight };
    });
}
// c's centre along its THIN axis — the coordinate at which a perpendicular corridor crosses it.
function perpCenter(c) { return c.axis === "v" ? c.x + c.w / 2 : c.y + c.h / 2; }
// THE RAMP. A wire boarding corridor c does not arrive at its centreline — it arrives at a LANE, and
// the perpendicular hop from wherever it already is (`want`) onto that lane is real travel that every
// cost term used to price at zero. `laneNear` is the closest lane c can actually offer; `rampCost` is
// what reaching it costs. A 1500px-wide plaza whose edge touches the node is NOT free to board: ride
// its centre lane and the wire pays ~750px out and ~750px back. Single definition, used by the
// start-bus score, the lane pick and the path search alike.
// (`clampLane` takes loose bounds so the flattened search, which holds typed arrays rather than lane
// objects, prices its ramp through the same primitive instead of rewriting the clamp.)
const clampLane = (want, lo, hi) => Math.min(Math.max(want, lo), hi);
const laneNear = (c, want) => clampLane(want, c.laneLo, c.laneHi);
const rampCost = (c, want) => Math.abs(laneNear(c, want) - want);
// The coordinate a corridor is measured ACROSS (its thin axis) vs the one it runs ALONG.
const crossOf = (c, x, y) => (c.axis === "v" ? x : y);
// Gap from (x,y) to c's extent along c's LONG axis — 0 while the point is alongside the corridor.
const longGap = (c, x, y) => (c.axis === "v" ? Math.max(c.y - y, 0, y - (c.y + c.h)) : Math.max(c.x - x, 0, x - (c.x + c.w)));
// Which face of a node at (cx,cy) does corridor c sit off? This is the face a wire boarding c leaves
// from — the same test resolveNode uses for srcSide once the lane is known, run early so a PINNED
// port (a watch/trigger line that must leave its own port's face) can rule corridors out up front.
function sideOf(c, cx, cy) {
    return c.axis === "v" ? (perpCenter(c) > cx ? "R" : "L") : (perpCenter(c) > cy ? "B" : "T");
}
// half of Q's extent measured along P's LONG axis (how far a turn onto/off Q can slide the span).
function perpHalf(Q, P) { return (P.axis === "v" ? Q.h : Q.w) / 2; }

// Can a lane at `coord` on `axis` hold [lo,hi] without overlapping the SAME lane's spans or crowding a
// near (< MIN_SEP) parallel lane? occ buckets segments by rounded coord; scan the neighbouring buckets.
function laneFree(occ, axis, coord, lo, hi, sep) {
    const r = Math.round(coord);
    for (let d = -Math.ceil(sep); d <= Math.ceil(sep); d++) {
        const arr = occ.get(axis + ":" + (r + d));
        if (!arr) continue;
        for (const s of arr) if (Math.abs(coord - s.c) < sep && Math.min(hi, s.hi) - Math.max(lo, s.lo) > BUS_EPS) return false;
    }
    return true;
}
// Is this EXACT lane coord occupied anywhere along [lo,hi]? Different question from laneFree, which
// answers "may a new span go here" and so also rejects a merely NEARBY lane — for counting how full a
// corridor is we want the lanes actually taken, not the ones blocked by a neighbour.
function laneUsed(occ, axis, coord, lo, hi) {
    const arr = occ.get(axis + ":" + Math.round(coord));
    if (!arr) return false;
    for (const s of arr) if (Math.abs(s.c - coord) < 0.5 && Math.min(hi, s.hi) - Math.max(lo, s.lo) > BUS_EPS) return true;
    return false;
}
function occAdd(occ, axis, coord, lo, hi) {
    const k = axis + ":" + Math.round(coord);
    (occ.get(k) || occ.set(k, []).get(k)).push({ c: coord, lo, hi });
}
function releaseSpan(occ, axis, coord, lo, hi) {
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const arr = occ.get(axis + ":" + Math.round(coord)); if (!arr) return;
    const i = arr.findIndex((s) => Math.abs(s.c - coord) < 0.5 && Math.abs(s.lo - lo) < 0.5 && Math.abs(s.hi - hi) < 0.5);
    if (i >= 0) arr.splice(i, 1);
}
// reserve a lane within corridor c free over [lo,hi]; returns the lane coord, or null if none.
// `want` = [wLo,wHi], the cross-axis stretch this ride is already spanning (where it boards, where it
// leaves). Any lane inside that stretch is free to use — the wire has to cross it regardless — so lanes
// are tried by how far OUTSIDE it they sit, centre-out only as the tiebreak. Without `want` a wide
// corridor hands back its centre lane and the wire pays a ramp of up to half the corridor's width in
// each direction; that is exactly the "flies out into open canvas and comes back" bug.
function reserveSpan(occ, c, lo, hi, sep, want) {
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    let order = c.gridLanes;
    if (want) {
        const wLo = Math.min(want[0], want[1]), wHi = Math.max(want[0], want[1]);
        const outside = (v) => Math.max(wLo - v, 0, v - wHi);
        order = c.gridLanes.slice().sort((p, q) => (outside(p) - outside(q)) || (Math.abs(p - c.laneMid) - Math.abs(q - c.laneMid)));
    }
    for (const coord of order) if (laneFree(occ, c.axis, coord, lo, hi, sep)) { occAdd(occ, c.axis, coord, lo, hi); return coord; }
    return null;
}
// Reserve a lane for an APPROACH or EXIT leg (the perpendicular hop between a node face and a bus).
// `axis` is the leg's orientation ('h' = horizontal, coord is a Y; 'v' = vertical, coord is an X). The
// coord is chosen centre-out within the face extent [faceLo,faceHi] at laneGap spacing, free over the
// leg's [spanLo,spanHi]. Legs share the same occupancy as rides, so a leg never crowds a ride/leg.
function reserveLeg(occ, axis, faceLo, faceHi, spanLo, spanHi, center, laneGap, sep) {
    const coords = [];
    for (let g = center; g <= faceHi + 1e-6; g += laneGap) coords.push(g);
    for (let g = center - laneGap; g >= faceLo - 1e-6; g -= laneGap) coords.push(g);
    coords.sort((p, q) => Math.abs(p - center) - Math.abs(q - center));
    for (const coord of coords) if (laneFree(occ, axis, coord, spanLo, spanHi, sep)) { occAdd(occ, axis, coord, spanLo, spanHi); return coord; }
    return null;
}

// ---- bus network (junctions between perpendicular corridors) --------------------------------

// Two corridors form a junction where they cross. Same-axis corridors never overlap (enforced by
// findCorridors), so a junction is always a V corridor overlapping an H corridor.
//
// The network is flattened for the search: corridor u's neighbours live in nbr[base[u] .. base[u]+
// deg[u]-1]. A SLOT in that flat array is also the search's state id — slot s means "riding corridor
// owner[s], having boarded it at its crossing with nbr[s]". That crossing sits at perpC[nbr[s]] along
// owner[s]'s long axis, which is exactly the entry coordinate the cost needs (see busPathDist).
// rev[s] is the mirror slot: stepping u -> v across slot s lands on state rev[s] with no lookup.
// Search scratch is sized once here and generation-stamped, so the hot retry loop never allocates.
function buildBusNet(lanes) {
    const N = lanes.length, adj = lanes.map(() => []);
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            const A = lanes[i], B = lanes[j];
            if (A.axis === B.axis) continue;
            if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) {
                adj[i].push(j); adj[j].push(i);
            }
        }
    }
    const base = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) base[i + 1] = base[i] + adj[i].length;
    const E = base[N];
    const nbr = new Int32Array(E), owner = new Int32Array(E), rev = new Int32Array(E);
    const slotOf = new Map();                            // u*N+v -> flat slot of the hop u->v
    for (let u = 0; u < N; u++) {
        for (let k = 0; k < adj[u].length; k++) {
            const s = base[u] + k;
            nbr[s] = adj[u][k]; owner[s] = u; slotOf.set(u * N + adj[u][k], s);
        }
    }
    for (let s = 0; s < E; s++) rev[s] = slotOf.get(nbr[s] * N + owner[s]);
    const perpC = new Float64Array(N);
    for (let i = 0; i < N; i++) perpC[i] = perpCenter(lanes[i]);
    const axisV = new Uint8Array(N);
    for (let i = 0; i < N; i++) axisV[i] = lanes[i].axis === "v" ? 1 : 0;
    // lane extremes per corridor, so the search can price a ramp without holding the lane objects
    const laneLo = new Float64Array(N), laneHi = new Float64Array(N);
    for (let i = 0; i < N; i++) { laneLo[i] = lanes[i].laneLo; laneHi[i] = lanes[i].laneHi; }
    // per-corridor boarding weight (bottleneck penalty) — see corridorWeight; 0 for every corridor
    // when narrowW is off, so this is a no-op unless the knob is tuned on.
    const weight = new Float64Array(N);
    for (let i = 0; i < N; i++) weight[i] = lanes[i].weight || 0;
    return {
        N, E, base, nbr, owner, rev, perpC, axisV, laneLo, laneHi, weight,
        heap: makeHeap(Math.max(64, E)),
        g: new Float64Array(E + 1), prev: new Int32Array(E + 1), seen: new Int32Array(E + 1), gen: 0,
    };
}

// Cheapest bus path from `start` to any goal corridor, by DISTANCE RIDDEN rather than hop count.
//
// Riding corridor u from its crossing with p to its crossing with v covers |perpC[v] - perpC[p]| — so
// the cost of a hop depends on where the wire BOARDED u, not on u alone. That makes the search state a
// directed hop (the flat slot), not a corridor. Each hop also pays `hopCost`, a flat turn penalty: a
// corner costs real estate and readability, so distance alone shouldn't buy three jogs to save a few px.
// It also pays `weight[v]`, a per-corridor bottleneck charge (corridorWeight) so a narrow channel isn't
// as attractive as a wide trunk running parallel to it — 0 unless `narrowW` is tuned on.
//
// A goal corridor is terminal but its exit cost varies per state, so the first goal popped isn't
// necessarily the cheapest — keep the best total and stop once the heap's minimum can no longer beat
// it. That exit cost is |tgtLong - inLong| along the goal's LONG axis PLUS the ramp off it: a goal
// corridor 1500px wide does not deliver the wire to the target's doorstep, and pricing only the long
// axis made every fat corridor look like a free delivery. Avoids `blocked` (full) corridors.
// (The boarding ramp onto `start` is deliberately NOT seeded here: `start` is fixed for the whole
// call, so it would add the same constant to every path and change nothing. Boarding is priced where
// it actually discriminates — the start-bus score in resolveNode.) Returns [idx...] or null.
function busPathDist(net, start, srcLong, goalSet, tcx, tcy, blocked, hopCost) {
    const { E, base, nbr, owner, rev, perpC, axisV, laneLo, laneHi, weight, heap, g, prev, seen } = net;
    if (blocked.has(start)) return null;
    const gen = ++net.gen;
    const tgtLong = (u) => (axisV[u] ? tcy : tcx);
    const tgtCross = (u) => (axisV[u] ? tcx : tcy);
    const exitRamp = (u) => { const w = tgtCross(u); return Math.abs(clampLane(w, laneLo[u], laneHi[u]) - w); };
    heap.clear();
    g[E] = 0; seen[E] = gen; prev[E] = -1;
    heap.push(0, E);
    let best = Infinity, bestState = -2;                 // -2 = none yet, -1 = the start corridor itself
    while (heap.size) {
        const s = heap.pop(), k = heap.topKey;
        if (k >= best) break;                            // nothing left in the heap can improve on best
        if (seen[s] !== gen || k > g[s]) continue;       // stale heap entry
        const u = s === E ? start : owner[s];
        const inL = s === E ? srcLong : perpC[nbr[s]];
        if (goalSet.has(u)) {
            const total = k + Math.abs(tgtLong(u) - inL) + exitRamp(u);
            if (total < best) { best = total; bestState = s === E ? -1 : s; }
        }
        for (let t = base[u], end = base[u + 1]; t < end; t++) {
            const v = nbr[t];
            if (blocked.has(v)) continue;
            const ng = k + Math.abs(perpC[v] - inL) + hopCost + weight[v];
            const ns = rev[t];
            if (seen[ns] === gen && ng >= g[ns]) continue;
            g[ns] = ng; seen[ns] = gen; prev[ns] = s;
            heap.push(ng, ns);
        }
    }
    if (bestState === -2) return null;
    if (bestState === -1) return [start];
    const path = [];
    for (let s = bestState; s !== E; s = prev[s]) path.push(owner[s]);
    path.push(start);
    path.reverse();
    return path;
}

// ---- one node's routes ---------------------------------------------------------------------

// Build one line's full multi-bus route from its reserved lanes and legs:
//   APPROACH  source face -> first bus lane   (horizontal/vertical leg on a reserved grid line)
//   RIDE/TURN along each bus, turning 90 degrees at each junction onto the next bus
//   EXIT      last bus lane -> target face     (leg on a reserved grid line)
// Every segment sits on a grid line reserved over its span, so nothing overlaps or crowds and no two
// join points stack. r fields: { a,b, path, pathLanes, srcSide, tgtSide, entry, exit } where `entry`
// is the source join coord (the approach leg's grid line) and `exit` the target join coord.
// Returns { pts, appr, exit } (appr, exit = the open-gap legs, kept for the node-crossing check).
function buildRoute1(r) {
    const { a, b, path: P, pathLanes: L, entry, exit: e } = r;
    let pts, appr, cur;
    if (P[0].axis === "v") {                                  // first bus vertical: lane X, approach horizontal at y=entry
        const fx = r.srcSide === "R" ? a.x + a.w : a.x, on = [L[0], entry];
        pts = [[fx, entry], on]; appr = [[fx, entry], on]; cur = on;
    } else {                                                  // first bus horizontal: lane Y, approach vertical at x=entry
        const fy = r.srcSide === "B" ? a.y + a.h : a.y, on = [entry, L[0]];
        pts = [[entry, fy], on]; appr = [[entry, fy], on]; cur = on;
    }
    for (let k = 1; k < P.length; k++) {                     // turn onto each next bus at its junction
        const laneK = L[k];
        const corner = P[k].axis === "h" ? [cur[0], laneK] : [laneK, cur[1]];
        pts.push(corner); cur = corner;
    }
    let exit;
    const last = P[P.length - 1], laneLast = L[L.length - 1];
    if (last.axis === "v") {                                  // vertical bus: ride to y=e, then leave to face
        const faceX = r.tgtSide === "L" ? b.x : b.x + b.w;
        pts.push([laneLast, e], [faceX, e]);
        exit = [[cur[0], cur[1]], [laneLast, e], [faceX, e]];
    } else {                                                  // horizontal bus: ride to x=e, then leave to face
        const faceY = r.tgtSide === "T" ? b.y : b.y + b.h;
        pts.push([e, laneLast], [e, faceY]);
        exit = [[cur[0], cur[1]], [e, laneLast], [e, faceY]];
    }
    return { pts: simplify(pts), appr, exit };
}

// Resolve one source node's joins across the bus NETWORK. Each line boards the nearest reachable bus
// to the source, then hops bus->bus at junctions until it reaches a bus from which the target is
// reachable, and exits there. Every bus it rides reserves one lane. If a bus is full, has no path to
// the target, or its approach can't be placed cleanly, the line falls through to the next start bus;
// a line with no workable option at all is left unrouted (flagged no-bus-route by the caller).
function resolveNode(aId, lines, lanes, net, grid, committed, reachCache, index, nodeRects, opts) {
    const a = lines[0].a;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const { laneGap, facePad, hopCost, minSep, faceBias } = opts;
    const reachSrc = reachAll(reachCache, aId, a, lanes, index);   // cached: source can approach corridor?
    const excl = new Map();                                  // line.key -> Set(start corridor idx) rejected
    for (const l of lines) excl.set(l.key, new Set());
    const dropped = new Set();

    // goal buses per line = corridors the TARGET can approach (mirror of the source approach test)
    const goalOf = new Map();
    for (const l of lines) {
        const gr = reachAll(reachCache, l.bId, l.b, lanes, index), g = new Set();
        for (let i = 0; i < lanes.length; i++) if (gr[i]) g.add(i);
        goalOf.set(l.key, g);
        if (!g.size) dropped.add(l.key);                     // target touches no bus -> unrouted
    }

    const block = new Map();                                 // line.key -> Set(corridor idx) to avoid in paths
    for (const l of lines) block.set(l.key, new Set());

    const releaseAll = (r) => {
        for (const t of r.taken) releaseSpan(grid, t.axis, t.coord, t.lo, t.hi);
    };

    for (let iter = 0; iter < 2000; iter++) {
        const reserved = [];
        let contended = false;
        for (const l of lines) {
            if (dropped.has(l.key)) continue;
            const ex = excl.get(l.key), avoid = block.get(l.key), goal = goalOf.get(l.key);

            // pick the start bus by lowest COST = what BOARDING it really costs + a face-direction
            // charge: boarding a corridor off the face pointing AWAY from the target costs up to
            // `faceBias` px, 0 when that face points straight at it. Without this the router boards the
            // merely-nearest corridor and a line leaves the wrong side (e.g. the TOP face when its
            // target sits below). Mirrors route.js's faceBias; the bus router had no target-direction
            // term at all. Near-ties on the combined cost still break toward the target's dominant axis.
            // Boarding cost is the RAMP onto the nearest lane the corridor can offer plus the gap along
            // its long axis — NOT distance to its bounding rect, which is 0 the moment the node sits
            // alongside it and so priced a 1500px-wide plaza as if the wire could board at its edge.
            const tdx = (l.b.x + l.b.w / 2) - acx, tdy = (l.b.y + l.b.h / 2) - acy, tL = Math.hypot(tdx, tdy) || 1;
            const faceAway = (face) => { const n = FACE_OUT[face]; return (faceBias || 0) * (1 - (n[0] * tdx + n[1] * tdy) / tL) / 2; };
            const dom = Math.abs(tdx) >= Math.abs(tdy) ? "h" : "v";
            let start = null, bd = Infinity;
            for (const c of lanes) {
                if (ex.has(c.idx) || avoid.has(c.idx)) continue;
                if (!reachSrc[c.idx]) continue;
                if (l.pin && sideOf(c, acx, acy) !== l.pin) continue;   // pinned port: board only from that face
                const score = rampCost(c, crossOf(c, acx, acy)) + longGap(c, acx, acy) + faceAway(sideOf(c, acx, acy));
                if (!start || score < bd - TIE) { start = c; bd = score; continue; }   // clearly cheaper
                if (score > bd + TIE) continue;                                        // clearly costlier
                const mc = c.axis === dom ? 1 : 0, ms = start.axis === dom ? 1 : 0;
                if (mc > ms) { start = c; bd = score; }                                // points toward target
            }
            if (!start) { dropped.add(l.key); continue; }     // no start bus left -> unrouted

            // path across the junction network to a goal bus, avoiding congested corridors. Cost is the
            // distance actually ridden (+ hopCost per turn), so the board coordinate on the start bus is
            // part of the input — it's where the ride begins.
            const startLong = start.axis === "v" ? acy : acx;
            const path = busPathDist(net, start.idx, startLong, goal, l.b.x + l.b.w / 2, l.b.y + l.b.h / 2, avoid, hopCost);
            if (!path) { excl.get(l.key).add(start.idx); contended = true; break; }
            const P = path.map(i => lanes[i]);

            // reserve a lane SPAN in each bus: only over the stretch the line actually rides it
            // (board/junction/exit points along that bus's long axis, padded by the crossing width).
            const r = { l, a, b: l.b, taken: [], path: P, pathLanes: [] };
            const srcLong = P[0].axis === "v" ? acy : acx;
            const tcx = l.b.x + l.b.w / 2, tcy = l.b.y + l.b.h / 2;
            const tgtLong = P[P.length - 1].axis === "v" ? tcy : tcx;
            // Where the wire currently sits on each axis. A ride's lane wants to fall between where the
            // wire already is on that axis and where it is ultimately headed — anywhere in that stretch
            // is ground it has to cover anyway, so it costs nothing; outside it is pure detour. Choosing
            // a lane on the corridor's cross axis MOVES the wire on that axis, hence the running update.
            let curX = acx, curY = acy;
            let failIdx = -1;
            for (let i = 0; i < P.length; i++) {
                const inL = i === 0 ? srcLong : perpCenter(P[i - 1]);
                const outL = i === P.length - 1 ? tgtLong : perpCenter(P[i + 1]);
                const padIn = i === 0 ? (P[i].axis === "v" ? a.h : a.w) / 2 : perpHalf(P[i - 1], P[i]);
                const padOut = i === P.length - 1 ? (P[i].axis === "v" ? l.b.h : l.b.w) / 2 : perpHalf(P[i + 1], P[i]);
                const lo = Math.min(inL, outL) - (inL <= outL ? padIn : padOut);
                const hi = Math.max(inL, outL) + (inL <= outL ? padOut : padIn);
                const want = P[i].axis === "v" ? [curX, tcx] : [curY, tcy];
                const coord = reserveSpan(grid, P[i], lo, hi, minSep, want);
                if (coord == null) { failIdx = i; break; }
                if (P[i].axis === "v") curX = coord; else curY = coord;
                r.taken.push({ axis: P[i].axis, coord, lo, hi });
                r.pathLanes.push(coord);
            }
            // a ride couldn't reserve a lane over its span (reserveSpan already tried every grid line):
            // the corridor genuinely can't host this ride there, so avoid it and re-path around it.
            if (failIdx >= 0) { releaseAll(r); block.get(l.key).add(P[failIdx].idx); contended = true; break; }

            // reserve the APPROACH and EXIT legs on the grid too (each fans onto its own grid line, so
            // join points never stack and a leg never runs over a ride). A leg is perpendicular to its
            // bus: horizontal off a vertical bus, vertical off a horizontal bus.
            const startLane = r.pathLanes[0], lastLane = r.pathLanes[r.pathLanes.length - 1];
            const last = P[P.length - 1];
            r.srcSide = P[0].axis === "v" ? (startLane > acx ? "R" : "L") : (startLane > acy ? "B" : "T");
            r.tgtSide = last.axis === "v" ? (lastLane < tcx ? "L" : "R") : (lastLane < tcy ? "T" : "B");
            const legFor = (bus, side, node, faceCenter, busLane) => {
                if (bus.axis === "v") {                        // horizontal leg at y=coord, spanning x face..lane
                    const fx = side === "R" ? node.x + node.w : node.x;
                    return { axis: "h", faceLo: node.y + facePad, faceHi: node.y + node.h - facePad,
                        spanLo: Math.min(fx, busLane), spanHi: Math.max(fx, busLane), center: faceCenter };
                }
                const fy = side === "B" ? node.y + node.h : node.y;   // vertical leg at x=coord, spanning y face..lane
                return { axis: "v", faceLo: node.x + facePad, faceHi: node.x + node.w - facePad,
                    spanLo: Math.min(fy, busLane), spanHi: Math.max(fy, busLane), center: faceCenter };
            };
            const ap = legFor(P[0], r.srcSide, a, P[0].axis === "v" ? acy : acx, startLane);
            r.entry = reserveLeg(grid, ap.axis, ap.faceLo, ap.faceHi, ap.spanLo, ap.spanHi, ap.center, laneGap, minSep);
            if (r.entry == null) { releaseAll(r); excl.get(l.key).add(P[0].idx); contended = true; break; }
            r.taken.push({ axis: ap.axis, coord: r.entry, lo: ap.spanLo, hi: ap.spanHi });
            const xl = legFor(last, r.tgtSide, l.b, last.axis === "v" ? tcy : tcx, lastLane);
            r.exit = reserveLeg(grid, xl.axis, xl.faceLo, xl.faceHi, xl.spanLo, xl.spanHi, xl.center, laneGap, minSep);
            if (r.exit == null) { releaseAll(r); block.get(l.key).add(last.idx); contended = true; break; }
            r.taken.push({ axis: xl.axis, coord: r.exit, lo: xl.spanLo, hi: xl.spanHi });

            // Now the exact board/turn/exit coords are known, so SHRINK each ride's reservation to the
            // stretch it truly rides (corner to corner) and free the padded overhang — this hands the
            // slack back to the grid for later lines. r.taken[0..P.length-1] are the ride spans.
            for (let i = 0; i < P.length; i++) {
                const t = r.taken[i];
                releaseSpan(grid, t.axis, t.coord, t.lo, t.hi);
                const inC = i === 0 ? r.entry : r.pathLanes[i - 1];
                const outC = i === P.length - 1 ? r.exit : r.pathLanes[i + 1];
                t.lo = Math.min(inC, outC); t.hi = Math.max(inC, outC);
                occAdd(grid, t.axis, t.coord, t.lo, t.hi);
            }
            reserved.push(r);
        }
        if (contended) { for (const r of reserved) releaseAll(r); continue; }
        if (!reserved.length) return new Map();

        const routes = new Map(reserved.map((r) => [r.l.key, buildRoute1(r)]));

        // A wire may NEVER pass through a node interior — the WHOLE route is checked against ALL nodes
        // (its own source/target included; a face touch is a boundary, not interior). It does not
        // deconflict with other wires ahead inside a channel — only the APPROACH and EXIT (crossing
        // open gaps) are checked for overlap. When a route fails, BLAME the responsible bus precisely
        // so the retry fixes the real problem instead of blindly abandoning the start bus.
        let bad = null, blame = null;                        // blame: { kind:'start'|'corridor', idx }
        const local = [], localPts = [];
        for (const r of reserved) {
            const { pts, appr, exit } = routes.get(r.l.key);
            const ends = new Set([r.l.aId, r.l.bId]);
            if (crossesNode(appr, ends, nodeRects, NODE_CLEAR) || storeConflicts(committed, appr, minSep) || conflictsCommitted(appr, local, minSep)) {
                bad = r; blame = { kind: "start", idx: r.path[0].idx }; break;   // boarding is the problem
            }
            if (crossesNode(exit, ends, nodeRects, NODE_CLEAR) || storeConflicts(committed, exit, minSep) || conflictsCommitted(exit, local, minSep)) {
                bad = r; blame = { kind: "corridor", idx: r.path[r.path.length - 1].idx }; break;   // last bus
            }
            const ci = crossingCorridor(pts, r.path, r.pathLanes, nodeRects);   // a ride crosses a node?
            if (ci >= 0) { bad = r; blame = { kind: "corridor", idx: r.path[ci].idx }; break; }
            // whole route: never through/hugging a node, never T-merging into another wire, and never
            // crossing ITSELF. A self-cross means the approach boarded a bus the route then doubled
            // back past, so the START bus is what to retry.
            if (crossesNode(pts, ends, nodeRects, NODE_CLEAR) || selfCrosses(pts) || storeTMerge(committed, pts) || tMerge(pts, local, localPts)) {
                bad = r; blame = { kind: "start", idx: r.path[0].idx }; break;
            }
            local.push(...segsOf(appr), ...segsOf(exit)); localPts.push(...pts);
        }

        if (!bad) {
            const out = new Map();
            for (const r of reserved) {
                const s = routes.get(r.l.key);
                storeCommit(committed, s.pts);                // deconflict future lines
                out.set(r.l.key, { pts: s.pts, d1: r.srcSide, d2: r.tgtSide, via: "bus" });
            }
            return out;                                       // keep every lane span + exit reservation
        }
        for (const r of reserved) releaseAll(r);
        if (blame.kind === "start") excl.get(bad.l.key).add(blame.idx);   // try boarding a different bus
        else block.get(bad.l.key).add(blame.idx);            // route around the offending corridor
    }
    return new Map();
}

/**
 * Dock not-facing lines onto their nearest reachable bus, one source node at a time.
 * @returns {Map<string,{pts:number[][],src,d1,d2,via}>}  routes keyed by link.key (d1/d2 = the faces
 *          the wire leaves/arrives on, "L"|"R"|"T"|"B"; via = "bus" rode corridors, "facing" took a
 *          direct line-of-sight shot);
 *          ._stats = {facing,routed,unrouted}; ._unrouted = [{key, at}] (no-bus-route offenders)
 */
function busRoute(links, nodeRects, corridors, opts = {}) {
    const cfg = { laneGap: 12, facePad: 6, hopCost: 120, minSep: MIN_SEP, faceBias: 200, narrowW: 0, trunkCap: 4, ...opts };
    // hopCost MUST stay > 0. BFS could never repeat a corridor (its visited gate); a distance search
    // can, and a repeated corridor would double-reserve a lane and break buildRoute1's corner walk.
    // With a strictly positive turn penalty no optimal path revisits one: re-entering a corridor is
    // always beaten by riding it straight through, which is no longer AND drops two turns.
    cfg.hopCost = Math.max(1e-6, cfg.hopCost);
    const lanes = makeLanes(corridors, cfg.laneGap, cfg.narrowW, cfg.trunkCap);
    const net = buildBusNet(lanes);                       // bus network: which corridors cross + search scratch
    const grid = new Map();                                // global grid-lane occupancy (axis:coord -> spans)
    const index = buildNodeIndex(nodeRects, 256);          // spatial index for band/reachability queries
    const stats = { facing: 0, routed: 0, unrouted: 0 };

    const committed = newStore();                         // all placed wires, bucketed for fast lookup
    const reachCache = new Map();                          // nodeId -> per-corridor reachability
    const routes = new Map();
    const unrouted = [];
    const byNode = new Map();

    // classify: a clear line-of-sight pair is a straight shot (deferred until AFTER the bus lines);
    // everything else is bus-routed.
    const straights = [];
    const degree = new Map();                              // nodeId -> total lines touching it, EITHER end
    const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
    for (const l of links) {
        const a = l.ra || nodeRects[l.aId], b = l.rb || nodeRects[l.bId];
        if (!a || !b) continue;
        bump(l.aId); bump(l.bId);
        const g = facingGeom(a, b, nodeRects);
        // a PINNED source (watch/trigger: the line must leave its own port's face) only takes the
        // straight shot if the shot happens to leave that face — otherwise it rides the buses, which
        // can board from the pinned side.
        if (g && (!l.pinSrc || g.d1 === l.pinSrc)) straights.push({ l, g });
        else (byNode.get(l.aId) || byNode.set(l.aId, []).get(l.aId)).push({ ...l, a, b, pin: l.pinSrc || null });
    }

    // BUS lines FIRST: busiest nodes first so they claim lanes before scraps — "busiest" by TOTAL
    // degree (both ends), not just how many lines this node sources. A hub with 10 incoming/0
    // outgoing routed last under a source-only count; it's still the node whose lane choices matter
    // most. Only nodes that own at least one bus-routed (non-straight) line appear in byNode at all,
    // so the sort is over that set — degree just re-orders it, never adds/drops a node.
    const nodeOrder = [...byNode.entries()].sort((p, q) => (degree.get(q[0]) || 0) - (degree.get(p[0]) || 0));
    for (const [aId, lines] of nodeOrder) {
        const stubs = resolveNode(aId, lines, lanes, net, grid, committed, reachCache, index, nodeRects, cfg);
        for (const l of lines) {
            const s = stubs.get(l.key);
            if (s) { routes.set(l.key, { pts: s.pts, src: aId, d1: s.d1, d2: s.d2, via: "bus" }); stats.routed++; }
            else { stats.unrouted++; unrouted.push({ key: l.key, at: [l.a.x + l.a.w / 2, l.a.y + l.a.h / 2] }); }
        }
    }

    // FACING straight shots AFTER: each reserves a grid line WITHIN the overlap band, adapting its port
    // to whatever the bus lines left free, so shots fan apart and never overlap a bus line or another
    // shot. A band with no free grid line means the shot CANNOT be placed without stacking — two faces
    // overlapping by less than a lane gap can hold exactly one line, and parking the rest on the band
    // centre drew them all on top of each other. Hand those to the fallback router, which is free to
    // bend around instead of insisting on the straight line.
    for (const { l, g } of straights) {
        const coord = reserveLeg(grid, g.axis, g.bandLo, g.bandHi, Math.min(g.p0, g.p1), Math.max(g.p0, g.p1), (g.bandLo + g.bandHi) / 2, cfg.laneGap, cfg.minSep);
        if (coord == null) { stats.unrouted++; unrouted.push({ key: l.key, at: [g.p0, g.bandLo] }); continue; }
        const pts = g.axis === "h" ? [[g.p0, coord], [g.p1, coord]] : [[coord, g.p0], [coord, g.p1]];
        routes.set(l.key, { pts, src: l.aId, d1: g.d1, d2: g.d2, via: "facing" }); storeCommit(committed, pts); stats.facing++;
    }

    // How full each corridor ended up: its own lanes that carry at least one span. Counted from the
    // FINAL occupancy (after every retry rolled back and the straight shots claimed theirs), so it
    // reflects what was actually placed, not what was attempted. Indexed by corridor idx.
    routes._corridorUse = lanes.map((c) => {
        const lo = c.axis === "v" ? c.y : c.x, hi = c.axis === "v" ? c.y + c.h : c.x + c.w;
        let n = 0;
        for (const coord of c.gridLanes) if (laneUsed(grid, c.axis, coord, lo, hi)) n++;
        return n;
    });
    routes._stats = stats;
    routes._unrouted = unrouted;
    return routes;
}

/* ══════════ decollide.js ══════════ */
// decollide.js — GLOBAL cross-pass wire de-collision, run once on the FINAL stitched routes.
//
// Why this exists: hierRoute.js routes the graph in ISOLATED passes (one outer + one per group box)
// for performance. route.js's nudge() — the anti-overlap / lane-packing stage — separates coincident
// wires ONLY within a single pass. Two wires from DIFFERENT passes never share a nudge bucket, so both
// can land on the identical world coordinate for a long shared run (the "two wires exactly on top of
// each other" bug). This pass reconciles that residue across the assembled polylines.
//
// Design — occupancy-aware MINIMAL displacement (NOT re-centering). An earlier attempt re-centred each
// colliding run in its free alley (like nudge does within a pass); global-blind, that FLUNG runs onto
// OTHER wires already sitting mid-alley and made overlap WORSE. So instead: leave every run where A*
// put it, and for each run that actually collides with a different wire, nudge ONLY that run to the
// nearest track that is verified clear of EVERY other segment (global occupancy). A run that can't find
// a clear track inside its wall-bounded alley is left untouched — never displaced onto something else.
//
// Held fixed (never moved): a port-stub endpoint segment (moving it detaches the wire from its node)
// and a run sitting INSIDE a wall (an inner-pass run within its own group box — evicting it is wrong).

const CLEAR = 5;           // px kept clear of each alley wall (matches nudge's `clear`)

// The free alley around a run's coord: nearest wall edge each side. A wall STRADDLING the coord (the run
// sits inside it) makes the run unmovable — we must not push it out of the box/node it lives in.
function alleyOf(axis, coord, lo, hi, walls) {
    let lb = -Infinity, rb = Infinity, straddled = false;
    for (const w of walls) {
        const ov = axis === "V" ? (w.y < hi && w.y + w.h > lo) : (w.x < hi && w.x + w.w > lo);
        if (!ov) continue;
        const e0 = axis === "V" ? w.x : w.y, e1 = axis === "V" ? w.x + w.w : w.y + w.h;
        if (e1 <= coord + 0.5) lb = Math.max(lb, e1);
        else if (e0 >= coord - 0.5) rb = Math.min(rb, e0);
        else { straddled = true; break; }
    }
    return { lb, rb, straddled };
}

const spanOverlap = (a, b) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1;

// The node face a port stub attaches to, as its slidable perp span (an H stub rides an L/R face, slides
// in Y; a V stub rides a T/B face, slides in X). Returns {lo,hi} or null (free/gate end — leave pinned).
function faceSpanFor(port, axis, walls) {
    const T = 8;
    if (axis === "H") { for (const w of walls) if (port[1] > w.y - 1 && port[1] < w.y + w.h + 1 && (Math.abs(port[0] - w.x) < T || Math.abs(port[0] - (w.x + w.w)) < T)) return { lo: w.y, hi: w.y + w.h }; }
    else { for (const w of walls) if (port[0] > w.x - 1 && port[0] < w.x + w.w + 1 && (Math.abs(port[1] - w.y) < T || Math.abs(port[1] - (w.y + w.h)) < T)) return { lo: w.x, hi: w.x + w.w }; }
    return null;
}
// Where a port may legally sit on that face: the span inset by the SHARED `faceKeep` (faces.js), the
// same keep-out route.js's fans and busroute.js's straight-shot band use — so a slide here can never
// park a port somewhere neither router would have placed it (i.e. inside a rounded corner).
const faceBandOf = (f) => { if (!f) return null; const k = faceKeep(f.hi - f.lo); return { lo: f.lo + k, hi: f.hi - k }; };
// A run that is the FIRST and the LAST segment at once (a 2-point straight shot) is BOTH ends' stub:
// its single coord docks a face on each node. Sliding it against one node's face alone is what drove a
// window<->trigger shot onto the window's corner — the coord must satisfy BOTH bands, so intersect them.
const bandMeet = (p, q) => (p && q ? { lo: Math.max(p.lo, q.lo), hi: Math.min(p.hi, q.hi) } : p || q);
// would a run on `axis` at coord `c` spanning [lo,hi] pierce any node interior?
function stubHitsNode(axis, c, lo, hi, walls) {
    for (const w of walls) {
        const e0 = axis === "V" ? w.x : w.y, e1 = axis === "V" ? w.x + w.w : w.y + w.h;
        const o0 = axis === "V" ? w.y : w.x, o1 = axis === "V" ? w.y + w.h : w.x + w.w;
        if (c > e0 + 1 && c < e1 - 1 && hi > o0 + 1 && lo < o1 - 1) return true;
    }
    return false;
}

// Group-box CONTAINERS (not obstacles): a box the run lives INSIDE only clamps how far it may
// travel (it must stay in the box), never freezes it — unlike a straddling wall. A box entirely to
// one side clamps that side like a wall (don't cross into a neighbouring group). Returns interior
// bounds only; never "straddled", so an inner-pass run stays free to shift into a clear lane.
function containerBounds(axis, coord, lo, hi, boxes) {
    let lb = -Infinity, rb = Infinity;
    for (const w of boxes) {
        const ov = axis === "V" ? (w.y < hi && w.y + w.h > lo) : (w.x < hi && w.x + w.w > lo);
        if (!ov) continue;
        const e0 = axis === "V" ? w.x : w.y, e1 = axis === "V" ? w.x + w.w : w.y + w.h;
        if (e1 <= coord + 0.5) lb = Math.max(lb, e1);           // box entirely on the low side
        else if (e0 >= coord - 0.5) rb = Math.min(rb, e0);      // box entirely on the high side
        else { lb = Math.max(lb, e0); rb = Math.min(rb, e1); }  // run is INSIDE this box — keep it in
    }
    return { lb, rb };
}

// deCollide(routes, walls, config) -> new Map(key -> {pts,p1,d1,p2,d2})
//   routes : the Map hierRoute returns (values may be CACHED sub-pass objects, shared by reference)
//   walls  : [{x,y,w,h}] every node rect + title band a shift must not cross
//   config : { laneGap, containers } — containers are group boxes: a run INSIDE one may still shift
//            into a parallel lane (clamped to stay in the box), where a straddling wall would freeze
//            it. Passing boxes as walls (the old behaviour) left sibling skip-edges stacked on one coord.
// Returns a fresh Map; untouched routes keep their original object, touched ones get a CLONE (never
// mutate in place — hierRoute hands back cached sub-pass results by reference, poisoning the pass cache).
function deCollide(routes, walls, config = {}) {
    const laneGap = config.laneGap || 12;
    walls = walls || [];
    const containers = config.containers || [];   // group boxes: clamp travel, never freeze (see containerBounds)
    const bnow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const bt0 = config.bench ? bnow() : 0;
    const blog = () => { if (config.bench) console.log(`[decollide] ${(bnow() - bt0).toFixed(0)}ms | ${routes.size} routes`); };

    // ---- decompose every route into axis-aligned segments (read-only over the originals) ----
    // `cur` is the run's live coord (updated as we displace); `movable` gates whether it may move at all.
    const segs = [];
    for (const [key, r] of routes) {
        const pts = r && r.pts;
        if (!pts || pts.length < 2) continue;
        const last = pts.length - 1;
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i], b = pts[i + 1];
            const endpoint = i === 0 || i + 1 === last;   // a port stub — its far end is the node face; don't move it
            let s = null;
            if (Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5)
                s = { key, axis: "V", coord: a[0], cur: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]), i0: i, i1: i + 1 };
            else if (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 0.5)
                s = { key, axis: "H", coord: a[1], cur: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), i0: i, i1: i + 1 };
            if (!s) continue;
            s.isEnd = endpoint;
            if (endpoint) {
                const fa = i === 0 ? faceBandOf(faceSpanFor(pts[0], s.axis, walls)) : null;
                const fb = i + 1 === last ? faceBandOf(faceSpanFor(pts[last], s.axis, walls)) : null;
                s.face = bandMeet(fa, fb);   // both when this run is the whole wire (see bandMeet)
            }
            const al = endpoint ? null : alleyOf(s.axis, s.coord, s.lo, s.hi, walls);
            s.movable = !endpoint && !(al && al.straddled);
            let lb = al ? al.lb : -Infinity, rb = al ? al.rb : Infinity;
            // group boxes only tighten the alley (stay inside the box) — an enclosing box no longer
            // freezes the run, so sibling skip-edges arching over a node row can still fan into lanes.
            if (!endpoint && containers.length) {
                const cb = containerBounds(s.axis, s.coord, s.lo, s.hi, containers);
                lb = Math.max(lb, cb.lb); rb = Math.min(rb, cb.rb);
            }
            s.lb = lb; s.rb = rb;
            segs.push(s);
        }
    }

    const byAxis = { V: [], H: [] };
    for (const s of segs) byAxis[s.axis].push(s);
    // the same-axis OTHER-wire runs that share this run's span — its neighbours on the corridor.
    const neighboursOf = (seg) => byAxis[seg.axis].filter((s2) => s2.key !== seg.key && spanOverlap(seg, s2));
    // min gap from coord `c` to any neighbour (Infinity when the corridor is otherwise empty).
    const minGap = (c, list) => { let d = Infinity; for (const s2 of list) d = Math.min(d, Math.abs(c - s2.cur)); return d; };

    // ---- resolve: fan each colliding movable run off its neighbours, packing tighter when the alley
    // is cramped. The old fixed-laneGap search GAVE UP when the alley was tighter than (n-1)*laneGap
    // (the many-skip-edges-over-one-row case) and left runs stacked. This packs to fit instead.
    // Relaxation (Lloyd): each run that sits within a laneGap of a neighbour slides to the MIDPOINT of
    // the gap between its two bracketing runs (or the alley walls when a side is open). Iterated, a
    // crowded corridor spreads to EVEN spacing — which is a full laneGap when the alley is roomy and
    // packs proportionally tighter (never below what fits) when it isn't, the many-skip-edges case.
    // Two runs on the identical coord are split by a stable key tie-break so they don't move as one.
    // Occupancy-safe by construction: a run is bounded by its neighbours + its own alley, so it can
    // never cross onto another wire (the flaw that sank the earlier global re-centre — see header).
    for (let pass = 0; pass < 24; pass++) {
        let moved = false;
        for (const seg of segs) {
            if (!seg.movable) continue;
            const list = neighboursOf(seg);
            if (!list.length || minGap(seg.cur, list) >= laneGap - 0.5) continue;   // clear enough — leave it
            const loB = Number.isFinite(seg.lb) ? seg.lb + CLEAR : -1e9;
            const hiB = Number.isFinite(seg.rb) ? seg.rb - CLEAR : 1e9;
            let below = loB, above = hiB;                     // nearest neighbour bracketing `seg` each side
            for (const s2 of list) {
                const lower = s2.cur < seg.cur - 0.01 || (Math.abs(s2.cur - seg.cur) <= 0.01 && s2.key < seg.key);
                if (lower) below = Math.max(below, s2.cur); else above = Math.min(above, s2.cur);
            }
            let target = (below + above) / 2;
            if (target < loB) target = loB; else if (target > hiB) target = hiB;
            if (Math.abs(target - seg.cur) > 0.4) { seg.cur = target; moved = true; }
        }
        if (!moved) break;
    }

    // ---- endpoint de-dup: fanFaceEnds / evict can stack two port stubs on ONE face coord (the Lloyd
    // relaxation above skips endpoints — moving one would detach it). But a stub may SLIDE along its own
    // node face (perp coord) without detaching. For each end-stub still colliding, slide it to the
    // nearest face coord that is (a) >laneGap from every other run sharing its span AND (b) leaves the
    // stub clear of every node — so separating a stub can never manufacture a through-node.
    const OVL = 1;   // px of span overlap that counts as a collision (catch sub-laneGap near-misses too)
    const collides = (seg, c) => {
        for (const s2 of segs) { if (s2 === seg || s2.axis !== seg.axis) continue; if (Math.abs(s2.cur - c) < laneGap - 0.5 && Math.min(seg.hi, s2.hi) - Math.max(seg.lo, s2.lo) > OVL) return true; }
        return false;
    };
    for (let iter = 0; iter < 30; iter++) {
        let fixed = false;
        for (const seg of segs) {
            if (!seg.isEnd || !seg.face || seg.face.hi - seg.face.lo < 2) continue;   // no legal band left — leave it put
            // resolve an end-stub that collides with another run, pierces a node (a long stub nudge
            // shoved through a node row), or sits OUTSIDE its own legal face band — all fix by sliding
            // along the face to a clear coord. The out-of-band case is what left a straight shot docked
            // on a node corner: an earlier iteration slid it there to dodge a collision, and once it no
            // longer collided nothing pulled it back inside the keep-out.
            const outOfBand = seg.cur < seg.face.lo - 0.5 || seg.cur > seg.face.hi + 0.5;
            if (!outOfBand && !collides(seg, seg.cur) && !stubHitsNode(seg.axis, seg.cur, seg.lo, seg.hi, walls)) continue;
            const lo = seg.face.lo, hi = seg.face.hi;   // already inset by faceKeep on every face it docks
            let best = null, bestd = 1e9;
            for (let c = lo; c <= hi; c += 2) {
                if (stubHitsNode(seg.axis, c, seg.lo, seg.hi, walls)) continue;
                if (collides(seg, c)) continue;
                const d = Math.abs(c - seg.cur); if (d < bestd) { bestd = d; best = c; }
            }
            if (best != null && Math.abs(best - seg.cur) > 0.5) { seg.cur = best; fixed = true; }
        }
        if (!fixed) break;
    }

    // ---- apply: clone each displaced wire's pts once, shift its vertices, re-simplify ----
    const moved = new Map();   // key -> [{i0,i1,axis,off}]
    for (const s of segs) {
        const off = s.cur - s.coord;
        if (Math.abs(off) < 0.5) continue;
        (moved.get(s.key) || moved.set(s.key, []).get(s.key)).push({ i0: s.i0, i1: s.i1, axis: s.axis, off });
    }
    if (!moved.size) { blog(); return routes; }                // nothing displaced — hand back the input untouched
    const out = new Map(routes);
    for (const [key, list] of moved) {
        const r = routes.get(key);
        if (!r || !r.pts) continue;
        const pts = r.pts.map((p) => p.slice());               // deep clone — never mutate the cached array
        for (const sh of list) {
            const ax = sh.axis === "V" ? 0 : 1;                // V shifts x, H shifts y
            pts[sh.i0][ax] += sh.off; pts[sh.i1][ax] += sh.off;
        }
        const np = simplify(pts);
        // spread the source record so a field this pass knows nothing about (the bus router's `via`
        // provenance tag) survives a displacement — only the geometry is ours to rewrite.
        out.set(key, { ...r, pts: np, p1: np[0].slice(), p2: np[np.length - 1].slice() });
    }
    blog();
    return out;
}

/* ══════════ busgraph.js ══════════ */
// busgraph.js — the bus router behind the live router contract.
//
// routing.js speaks one shape:  (nodes, edges, opts) -> Map(key -> {pts,p1,d1,p2,d2}).  busRoute
// speaks node RECTS and its own link records, and it can legitimately leave a line unrouted. This
// adapter is the only place those two meet — busroute.js stays a pure geometry module with no idea
// the app exists, exactly like route.js.
//
// Three things busroute.js knows nothing about, handled here:
//   BLOCKS    group headings are soft-cost detours in route.js; busRoute has no soft costs, so each
//             heading goes in as an extra HARD obstacle. findCorridors sees the same rect list, so a
//             heading blocks the CORRIDOR CARVE as well as the wires — a channel is never cut across
//             a group title. Callers must pass every heading: each group's own title strip AND the
//             subgroup / super-group / ungated bands (routing.js `blockRects`).
//   FALLBACK  a line busRoute couldn't place would otherwise paint as a provisional elbow straight
//             through whatever is in the way. Instead the caller's `fallback` (routeGraph) supplies
//             those keys — a real orthogonal route, at the cost of one A* pass whenever any line
//             misses. Zero misses = zero cost.
//   INSET     watch/trigger caps sit ON the node edge, so their last point is pulled INTO the node
//             along its arrival face (`r.d2`) via the shared insetEndpoint (faces.js), same primitive
//             route.js uses at its own tail.
//
// deCollide runs ONLY when the fallback did. A pure bus pass needs none — every wire holds a lane
// span it reserved, so a lane shift could only move it off one — but a fallback line is routed blind
// to those lanes and can land on top of one.


/**
 * Route the graph over bus corridors.
 * @param {Array<{id,x,y,w,h}>} nodes
 * @param {Array<{from,to,key,insetEnd,pinSrc}>} edges
 * @param {Object} opts
 * @param {Array<{x,y,w,h}>} [opts.blockRects]      group headings — hard no-go for the corridor carve
 *                                                  AND for the wires themselves
 * @param {Object} [opts.bus]                       {margin, laneGap, minLen, hopCost, facePad, narrowW, trunkCap}
 * @param {Function} [opts.fallback]                (missingEdges) -> Map(key -> {pts,p1,d1,p2,d2}),
 *                                                  called ONLY if busRoute left something unrouted
 * @param {Function} [opts.deconflict]              (routes) -> routes, applied ONLY when the fallback
 *                                                  ran (deCollide) — see the note at the call
 * @param {Function} [opts.onCorridors]              (corridors) -> void, the channels this pass carved.
 *                                                  Handed out rather than returned so the routes Map
 *                                                  stays the contract (and survives structured clone
 *                                                  to the worker, which drops a Map's extra props)
 * @returns {Map<string,{pts,p1,d1,p2,d2}>}
 */
function busRouteGraph(nodes, edges, opts = {}) {
    const { blockRects = [], bus = {}, fallback = null, deconflict = null, onCorridors = null } = opts;
    // minSep/tightGap are raised well above busroute's own defaults (3 / 6): the followability oracle
    // only cares that two wires are distinguishable at all, the rendered canvas needs them readably
    // apart (scripts/route_metrics.mjs calls < 9px ambiguous). tightGap tracks minSep, or a bottleneck
    // corridor packs lanes closer than a lane may legally sit anyway.
    const cfg = { margin: 9, laneGap: 12, minLen: 280, hopCost: 2000, facePad: 6, minSep: 10, tightGap: 10, faceBias: 200, narrowW: 2000, trunkCap: 4, ...bus };

    const nodeRects = {};
    for (const n of nodes) nodeRects[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h };
    // obstacles = nodes + every group heading. The " block:" ids are synthetic: a real node id never
    // starts with a space, so one can never be a link endpoint, so `crossesNode`'s endpoint exemption
    // never fires for it — the heading is unconditionally impassable (see the BLOCKS note above).
    const obst = { ...nodeRects };
    for (let i = 0; i < blockRects.length; i++) {
        const b = blockRects[i];
        if (b && b.w > 0 && b.h > 0) obst[" block:" + i] = { x: b.x, y: b.y, w: b.w, h: b.h };
    }

    const links = [];
    for (const e of edges) {
        const ra = nodeRects[e.from], rb = nodeRects[e.to];
        if (!ra || !rb || e.from === e.to) continue;      // unpositioned endpoint, or a self-edge
        links.push({ key: e.key, aId: e.from, bId: e.to, ra, rb, pinSrc: e.pinSrc || null });
    }

    const corridors = findCorridors(obst, cfg);
    const routes = busRoute(links, obst, corridors, cfg);
    // published AFTER routing so each channel carries how full it ended up (`used` lanes of `cap`) —
    // the debug tint grades on that, and it only exists once the wires have been placed.
    if (onCorridors) {
        const use = routes._corridorUse || [];
        onCorridors(corridors.map((c, i) => ({ ...c, used: use[i] || 0 })));
    }

    const out = new Map();
    const insetOf = new Map(edges.map((e) => [e.key, e.insetEnd || 0]));
    for (const [key, r] of routes) {
        const pts = insetEndpoint(r.pts, r.d2, insetOf.get(key) || 0);
        out.set(key, { pts, p1: pts[0].slice(), d1: r.d1, p2: pts[pts.length - 1].slice(), d2: r.d2, via: r.via });
    }

    // Whatever missed — no bus path, no free lane, or an endpoint the corridors never reach.
    const missed = edges.filter((e) => !out.has(e.key) && nodeRects[e.from] && nodeRects[e.to] && e.from !== e.to);
    let res = out;
    if (missed.length && fallback) {
        const fb = fallback(missed);
        for (const e of missed) { const r = fb && fb.get(e.key); if (r) out.set(e.key, { ...r, via: "fallback" }); }
        // The fallback router is blind to the lanes busRoute reserved, so a fallback line can land on
        // top of a bus line. Fan coincident runs apart — ONLY on this path: with nothing to fall back
        // on, every wire already holds its own reserved lane and a shift would just move it off one.
        if (deconflict) res = deconflict(out) || out;
    }
    res._stats = { ...routes._stats, fellBack: missed.length };
    return res;
}

return {routeGraph, busRouteGraph, deCollide, findCorridors, simplify, polylinePath, C};
})();
