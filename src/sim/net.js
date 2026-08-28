// Dense solver for a pipe conductance network: a weighted graph Laplacian.
//
// Edge e=(u,v) with conductance g_e and head h_e carries flow
//   Q_e = g_e * (p_u - p_v + h_e)
// KCL at every FREE node gives a symmetric PSD system G p = b, with
//   G_uu = sum of g on u,  G_uv = -g_e,  b_u = sum of head terms on u.
//
// A FIXED node is one whose pressure is KNOWN rather than solved. The single
// `ground` node this file used to carry was the one-node case of that, pinned
// at 0; it is a set now because a plant can hold several known pressures at
// once - the pressurizer at s.P, containment behind a break, a tank's own
// charge - and no single affine offset can satisfy two of them at the same
// time. `fixed` is an object keyed by node index whose value is that node's
// pressure; a node absent from it is solved for.
//
// Factorization: LDL^T (Cholesky without the square root — the matrix is
// only PSD, not always strictly PD, because a floating island contributes an
// exact zero pivot; a plain Cholesky would have to take sqrt of that zero
// and lose the sign information the guard below needs). Stored compactly
// in-place in A: strict-lower entries become the unit-lower-triangular
// multipliers L[i][k] (i>k), the diagonal becomes D. That split is what
// lets a caller factor once per structure/conductance change and then
// substitute many times per tick for only an RHS change (~n^2 flops).

const NET_EPS = 1e-9;

// Symmetric Gaussian elimination, right-looking, no pivoting: the ordering
// is whatever the caller assembled (node index), never chosen for stability,
// because a graph Laplacian with every component grounded is PD in any order.
//
// The pivot guard: a component with no path to ground (an isolated design-
// bench port, a subgraph cut loose) makes that component's block singular.
// By elimination step, this always surfaces as a single pivot going to zero
// at the LAST node of that block to be processed — PSD guarantees the block
// diagonal cannot go negative, and once every other node in the block has
// been eliminated, whatever detached component is left has nothing further
// to contribute. Clamping the diagonal to 1 and zeroing only the *forward*
// entries (columns > k, not yet used) decouples that node for every pivot
// still to come, so no later step ever divides by ~0 and no NaN is produced.
// Columns < k are left untouched: those already hold finalized multipliers
// from earlier, non-degenerate pivots in the same block, and are exactly
// what makes the rest of that block's internal flows (e.g. a head source
// between two nodes that are floating together) solve correctly instead of
// silently discarding half the block's history.
// WHICH NODES THE GUARD BELOW HAD TO DECOUPLE, and it is worth handing back
// rather than throwing away: a node with no remaining path to ground gets an
// arbitrary potential out of the solve, and a caller that PRINTS potentials
// has to know that so it can print nothing instead. Shut a valve in the steam
// line and the turbine inlet is exactly this case - measured, it read 15.5 MPa
// on a pipe full of steam, which is a plausible-looking wrong number and the
// worst kind. Index is node index; allocated once per factorisation.
function netFactor(A, n, deg){
  for(let k=0;k<n;k++){
    const d = A[k*n+k];
    if(!(d > NET_EPS)){
      A[k*n+k] = 1;
      for(let j=k+1;j<n;j++){ A[k*n+j]=0; A[j*n+k]=0; }
      if(deg) deg[k] = 1;
      continue;
    }
    for(let i=k+1;i<n;i++){
      const lik = A[i*n+k] / d;
      for(let j=k+1;j<n;j++) A[i*n+j] -= lik*A[k*n+j];
      A[i*n+k] = lik;
    }
  }
  return A;
}

// Solve using a factored A (from netFactor) in place: x holds b on entry,
// p on exit. Forward-solve L y=b, divide by D, back-solve L^T z=y. O(n^2),
// no allocation — this is the per-tick path when only b changed.
function netSubst(A, x, n){
  for(let k=0;k<n;k++){
    let s = x[k];
    for(let j=0;j<k;j++) s -= A[k*n+j]*x[j];
    x[k] = s;
  }
  for(let k=0;k<n;k++) x[k] /= A[k*n+k];
  for(let i=n-1;i>=0;i--){
    let s = x[i];
    for(let j=i+1;j<n;j++) s -= A[j*n+i]*x[j];
    x[i] = s;
  }
  return x;
}

// One-shot solve for callers that don't need to cache the factorization.
// A is consumed as scratch; x holds b on entry, p on exit.
function netSolve(A, x, n){
  netFactor(A, n);
  return netSubst(A, x, n);
}

// Builds A (n*n, row-major) and b (length n) from an edge list. Each edge is
// {u, v, g, h}; g and h may be a plain number or a function(s) evaluated
// per assembly, since conductance/head both depend on live sim state (valve
// position, pump demand) while the graph topology itself does not change
// tick to tick.
//
// Fixed nodes: rather than pinning one with a penalty (an arbitrary, hard to
// justify condition number) or resizing the system to drop its row/column, a
// fixed node is simply never written to during assembly. Its row and column
// of A stay exactly zero, so netFactor's pivot guard decouples it exactly
// like any node with no path to a fixed one, and netSubst lands its solved
// potential at exactly 0 — the same single mechanism does both jobs, and the
// caller reads the KNOWN value back out of `fixed` rather than out of p.
// A fixed node's own pressure reaches its free neighbours through b instead:
// the -g*p_v term that would have sat in the matrix moves to the right-hand
// side as +g*pFixed. With one fixed node at 0 that term vanishes and this
// assembles bit-for-bit the matrix the single-ground version did.
//
// An edge with g<=0 (a fully-shut valve, same as a removed pipe) is skipped
// entirely rather than assembled with a zero conductance: a structurally-
// absent edge and a shut valve must produce a bit-identical matrix, because
// a later stage compares assembled matrices by strict equality.
/* `src`, if given, is a per-node injected CURRENT added to the KCL right-hand
   side after every edge has been stamped - a volume appearing at a node rather
   than flowing to it through a conductance. Thermal expansion is exactly that
   (step.js): heating the loop makes water where there was none, and in an
   incompressible network it has to leave somewhere, which is what makes the
   solved surge flow contain expansion by construction instead of a correlation
   standing beside the solve claiming it does.

   It goes in HERE and not in a pre-loaded b, which is what it looks like it
   should be: this function fills b from zero every call, so anything a caller
   wrote into b beforehand is wiped before the first edge is stamped.

   A fixed node absorbs whatever it is given by definition, so injecting into
   one is a no-op that would silently vanish; skipped rather than added. */
/* PASS `false` FOR `A` TO ASK FOR THE RIGHT-HAND SIDE ONLY. A back-substitution
   against a cached factorisation needs b and nothing else, and the matrix it
   was throwing away was n*n doubles allocated, zeroed and stamped every call -
   measured at 18% of a sim tick, twice a tick, for an answer nobody read.
   `null`/omitted still means "make me one", because that is what a caller
   assembling a matrix to factor wants; only an explicit `false` skips it. */
function netAssemble(edges, n, fixed, s, A, b, src){
  const wantA = A !== false;
  if(wantA) A = A || new Float64Array(n*n);
  b = b || new Float64Array(n);
  if(wantA) A.fill(0);
  b.fill(0);
  for(let e=0;e<edges.length;e++){
    const ed = edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    const h = typeof ed.h === 'function' ? ed.h(s) : (ed.h || 0);
    const u = ed.u, v = ed.v;
    const pu = fixed[u], pv = fixed[v];
    const gu = pu === undefined, gv = pv === undefined;
    if(wantA){
      if(gu) A[u*n+u] += g;
      if(gv) A[v*n+v] += g;
      if(gu && gv){ A[u*n+v] -= g; A[v*n+u] -= g; }
    }
    if(gu) b[u] -= g*h;
    if(gv) b[v] += g*h;
    if(gu && !gv) b[u] += g*pv;
    if(gv && !gu) b[v] += g*pu;
  }
  if(src) for(let i=0;i<n;i++) if(fixed[i]===undefined && src[i]) b[i] += src[i];
  return { A, b };
}

// Per-edge flow from solved potentials p: Q_e = g_e*(p_u - p_v + h_e).
// A fixed node reads as its KNOWN pressure, never as whatever p holds for it
// (netSubst leaves that at 0, which is the right answer only for a node
// fixed at 0 - leave it and every flow touching the core reads as though the
// vessel were at zero pressure: a large, plausible-looking wrong number with
// nothing thrown anywhere). Writes into out (length edges.length) to avoid
// allocating per tick; s is only needed if any edge's g/h is a function.
function netFlows(edges, p, fixed, out, s){
  for(let e=0;e<edges.length;e++){
    const ed = edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)){ out[e] = 0; continue; }
    const h = typeof ed.h === 'function' ? ed.h(s) : (ed.h || 0);
    const fu = fixed[ed.u], fv = fixed[ed.v];
    const pu = fu === undefined ? p[ed.u] : fu;
    const pv = fv === undefined ? p[ed.v] : fv;
    out[e] = g * (pu - pv + h);
  }
  return out;
}

// The solved field, with every fixed node's known pressure written back over
// the 0 netSubst left there. One place says "a fixed node reads its own
// value", so a reader can take p straight afterwards.
function netUnfix(p, fixed){
  for(const i in fixed) p[i] = fixed[i];
  return p;
}
