const NET_EPS = 1e-9, NET_REL = 1e-12;

function netFactor(A, n, deg, bw){
  const B = bw === undefined ? n : bw;
  // Relative to the row's own weight: a floating block's last pivot cancels to g x 1e-16.
  const d0 = new Float64Array(n);
  for(let k=0;k<n;k++) d0[k] = A[k*n+k];
  for(let k=0;k<n;k++){
    const d = A[k*n+k], lim = Math.min(n, k+B+1);
    if(!(d > NET_EPS) || !(d > NET_REL*d0[k])){
      A[k*n+k] = 1;
      for(let j=k+1;j<lim;j++){ A[k*n+j]=0; A[j*n+k]=0; }
      if(deg) deg[k] = 1;
      continue;
    }
    for(let i=k+1;i<lim;i++){
      const lik = A[i*n+k] / d;
      if(lik === 0) continue;
      for(let j=k+1;j<lim;j++) A[i*n+j] -= lik*A[k*n+j];
      A[i*n+k] = lik;
    }
  }
  return A;
}

function netSubst(A, x, n, bw){
  const B = bw === undefined ? n : bw;
  for(let k=0;k<n;k++){
    let s = x[k];
    for(let j=Math.max(0,k-B);j<k;j++) s -= A[k*n+j]*x[j];
    x[k] = s;
  }
  for(let k=0;k<n;k++) x[k] /= A[k*n+k];
  for(let i=n-1;i>=0;i--){
    let s = x[i], lim = Math.min(n, i+B+1);
    for(let j=i+1;j<lim;j++) s -= A[j*n+i]*x[j];
    x[i] = s;
  }
  return x;
}

// A is compacted onto the free rows by `row`, b stays at full node length; a fixed node is never stamped and reaches free neighbours through b as +g*pFixed.
function netAssemble(edges, n, fixed, s, A, b, src, row, m, touch, cap){
  const wantA = A !== false;
  if(!row) m = n;
  if(wantA) A = A || new Float64Array(m*m);
  b = b || new Float64Array(n);
  if(wantA) A.fill(0);
  b.fill(0);
  for(let e=0;e<edges.length;e++){
    const ed = edges[e];
    const g = typeof ed.g === 'function' ? ed.g(s) : ed.g;
    if(!(g > 0)) continue;
    const h = typeof ed.h === 'function' ? ed.h(s) : (ed.h || 0);
    const u = ed.u, v = ed.v;
    if(touch){ touch[u]=1; touch[v]=1; }
    const pu = fixed[u], pv = fixed[v];
    const gu = pu === undefined, gv = pv === undefined;
    if(wantA){
      const ru = row ? row[u] : u, rv = row ? row[v] : v;
      if(gu) A[ru*m+ru] += g;
      if(gv) A[rv*m+rv] += g;
      if(gu && gv){ A[ru*m+rv] -= g; A[rv*m+ru] -= g; }
    }
    if(gu) b[u] -= g*h;
    if(gv) b[v] += g*h;
    if(gu && !gv) b[u] += g*pv;
    if(gv && !gu) b[v] += g*pu;
  }
  if(wantA && cap) for(let i=0;i<n;i++) if(fixed[i]===undefined && cap[i] > 0){
    const ri = row ? row[i] : i; A[ri*m+ri] += cap[i]; }
  if(src) for(let i=0;i<n;i++) if(fixed[i]===undefined && src[i]) b[i] += src[i];
  return { A, b };
}

// A fixed node reads its known pressure, never p - netSubst leaves that at 0.
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

function netUnfix(p, fixed){
  for(const i in fixed) p[i] = fixed[i];
  return p;
}

// A (rows) and b are consumed; false = a pivot vanished, `out` still filled with 0 where it could not be decided.
function denseSolve(A, b, out, n){
  let ok = true;
  for(let c=0;c<n;c++){
    let piv = c;
    for(let r=c+1;r<n;r++) if(Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if(piv !== c){ const t=A[c]; A[c]=A[piv]; A[piv]=t; const u=b[c]; b[c]=b[piv]; b[piv]=u; }
    if(!(Math.abs(A[c][c]) > 1e-12)){ ok = false; continue; }
    for(let r=c+1;r<n;r++){ const f = A[r][c]/A[c][c];
      for(let k=c;k<n;k++) A[r][k] -= f*A[c][k];
      b[r] -= f*b[c]; }
  }
  for(let c=n-1;c>=0;c--){ let s = b[c];
    for(let k=c+1;k<n;k++) s -= A[c][k]*out[k];
    out[c] = Math.abs(A[c][c]) > 1e-12 ? s/A[c][c] : 0; }
  return ok;
}
