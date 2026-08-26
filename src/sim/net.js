// Dense solver for a pipe conductance network: a weighted graph Laplacian.
//
// Edge e=(u,v) with conductance g_e and head h_e carries flow
//   Q_e = g_e * (p_u - p_v + h_e)
// KCL at every non-ground node gives a symmetric PSD system G p = b, with
//   G_uu = sum of g on u,  G_uv = -g_e,  b_u = sum of head terms on u.
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
function netFactor(A, n){
  for(let k=0;k<n;k++){
    const d = A[k*n+k];
    if(!(d > NET_EPS)){
      A[k*n+k] = 1;
      for(let j=k+1;j<n;j++){ A[k*n+j]=0; A[j*n+k]=0; }
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
// Ground node: rather than pinning it with a penalty (an arbitrary, hard to
// justify condition number) or resizing the system to drop its row/column,
// ground is simply never written to during assembly. Its row and column of
// A stay exactly zero, so netFactor's pivot guard decouples it exactly like
// any other node with no path to ground, and netSubst lands its potential at
// exactly 0 — the same single mechanism does both jobs.
//
// An edge with g<=0 (a fully-shut valve, same as a removed pipe) is skipped
// entirely rather than assembled with a zero conductance: a structurally-
// absent edge and a shut valve must produce a bit-identical matrix, because
// a later stage compares assembled matrices by strict equality.
function netAssemble(edges, n, ground, s, A, b){
  A = A || new Float64Array(n*n);
  b = b || new Float64Array(n);
  A.fill(0);
  b.fill(0);
  for(let e=0;e<edges.length;e++){
    const ed = edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    const h = typeof ed.h === 'function' ? ed.h(s) : (ed.h || 0);
    const u = ed.u, v = ed.v;
    const gu = u !== ground, gv = v !== ground;
    if(gu) A[u*n+u] += g;
    if(gv) A[v*n+v] += g;
    if(gu && gv){ A[u*n+v] -= g; A[v*n+u] -= g; }
    if(gu) b[u] -= g*h;
    if(gv) b[v] += g*h;
  }
  return { A, b };
}

// Per-edge flow from solved potentials p: Q_e = g_e*(p_u - p_v + h_e).
// The ground node reads as potential 0 regardless of whatever p[ground]
// holds (netSubst already forces it to 0, but a caller passing a raw
// pressure array without solving through ground should still get the
// right answer). Writes into out (length edges.length) to avoid allocating
// per tick; s is only needed if any edge's g/h is a function.
function netFlows(edges, p, ground, out, s){
  for(let e=0;e<edges.length;e++){
    const ed = edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)){ out[e] = 0; continue; }
    const h = typeof ed.h === 'function' ? ed.h(s) : (ed.h || 0);
    const pu = ed.u === ground ? 0 : p[ed.u];
    const pv = ed.v === ground ? 0 : p[ed.v];
    out[e] = g * (pu - pv + h);
  }
  return out;
}
