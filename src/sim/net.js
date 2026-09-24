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

/* NR 2nd ed. elmhes + hqr: every eigenvalue of a real n x n matrix a (row-major, destroyed) */
function eigReal(a, n){
  const A = (i, j) => (i - 1)*n + (j - 1), wr = new Float64Array(n + 1), wi = new Float64Array(n + 1);
  for(let m=2;m<n;m++){ let x = 0, i = m;
    for(let j=m;j<=n;j++) if(Math.abs(a[A(j, m - 1)]) > Math.abs(x)){ x = a[A(j, m - 1)]; i = j; }
    if(i !== m){ for(let j=m-1;j<=n;j++){ const t = a[A(i, j)]; a[A(i, j)] = a[A(m, j)]; a[A(m, j)] = t; }
      for(let j=1;j<=n;j++){ const t = a[A(j, i)]; a[A(j, i)] = a[A(j, m)]; a[A(j, m)] = t; } }
    if(x) for(let i2=m+1;i2<=n;i2++){ let y = a[A(i2, m - 1)]; if(y !== 0){ y /= x; a[A(i2, m - 1)] = y;
      for(let j=m;j<=n;j++) a[A(i2, j)] -= y*a[A(m, j)];
      for(let j=1;j<=n;j++) a[A(j, m)] += y*a[A(j, i2)]; } } }
  const SIGN = (u, v) => v >= 0 ? Math.abs(u) : -Math.abs(u);
  let anorm = 0; for(let i=1;i<=n;i++) for(let j=Math.max(i - 1, 1);j<=n;j++) anorm += Math.abs(a[A(i, j)]);
  let nn = n, t = 0, l, m, x, y, z, w, v, u, s, r = 0, q = 0, p = 0;
  while(nn >= 1){ let its = 0;
    do {
      for(l=nn;l>=2;l--){ s = Math.abs(a[A(l - 1, l - 1)]) + Math.abs(a[A(l, l)]); if(s === 0) s = anorm;
        if(Math.abs(a[A(l, l - 1)]) + s === s){ a[A(l, l - 1)] = 0; break; } }
      x = a[A(nn, nn)];
      if(l === nn){ wr[nn] = x + t; wi[nn--] = 0; }
      else { y = a[A(nn - 1, nn - 1)]; w = a[A(nn, nn - 1)]*a[A(nn - 1, nn)];
        if(l === nn - 1){ p = 0.5*(y - x); q = p*p + w; z = Math.sqrt(Math.abs(q)); x += t;
          if(q >= 0){ z = p + SIGN(z, p); wr[nn - 1] = wr[nn] = x + z; if(z) wr[nn] = x - w/z; wi[nn - 1] = wi[nn] = 0; }
          else { wr[nn - 1] = wr[nn] = x + p; wi[nn - 1] = -(wi[nn] = z); }
          nn -= 2; }
        else {
          if(its === 60) throw new Error("hqr: no convergence");
          if(its === 10 || its === 20){ t += x; for(let i=1;i<=nn;i++) a[A(i, i)] -= x;
            s = Math.abs(a[A(nn, nn - 1)]) + Math.abs(a[A(nn - 1, nn - 2)]); y = x = 0.75*s; w = -0.4375*s*s; }
          ++its;
          for(m=nn-2;m>=l;m--){ z = a[A(m, m)]; r = x - z; s = y - z;
            p = (r*s - w)/a[A(m + 1, m)] + a[A(m, m + 1)]; q = a[A(m + 1, m + 1)] - z - r - s; r = a[A(m + 2, m + 1)];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r); p /= s; q /= s; r /= s;
            if(m === l) break;
            u = Math.abs(a[A(m, m - 1)])*(Math.abs(q) + Math.abs(r));
            v = Math.abs(p)*(Math.abs(a[A(m - 1, m - 1)]) + Math.abs(z) + Math.abs(a[A(m + 1, m + 1)]));
            if(u + v === v) break; }
          for(let i=m+2;i<=nn;i++){ a[A(i, i - 2)] = 0; if(i !== m + 2) a[A(i, i - 3)] = 0; }
          for(let k=m;k<=nn-1;k++){
            if(k !== m){ p = a[A(k, k - 1)]; q = a[A(k + 1, k - 1)]; r = 0; if(k !== nn - 1) r = a[A(k + 2, k - 1)];
              if((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0){ p /= x; q /= x; r /= x; } }
            if((s = SIGN(Math.sqrt(p*p + q*q + r*r), p)) !== 0){
              if(k === m){ if(l !== m) a[A(k, k - 1)] = -a[A(k, k - 1)]; } else a[A(k, k - 1)] = -s*x;
              p += s; x = p/s; y = q/s; z = r/s; q /= p; r /= p;
              for(let j=k;j<=nn;j++){ p = a[A(k, j)] + q*a[A(k + 1, j)];
                if(k !== nn - 1){ p += r*a[A(k + 2, j)]; a[A(k + 2, j)] -= p*z; }
                a[A(k + 1, j)] -= p*y; a[A(k, j)] -= p*x; }
              const mmin = nn < k + 3 ? nn : k + 3;
              for(let i=l;i<=mmin;i++){ p = x*a[A(i, k)] + y*a[A(i, k + 1)];
                if(k !== nn - 1){ p += z*a[A(i, k + 2)]; a[A(i, k + 2)] -= p*r; }
                a[A(i, k + 1)] -= p*q; a[A(i, k)] -= p; } } } } }
    } while(l < nn - 1); }
  const out = []; for(let i=1;i<=n;i++) out.push([wr[i], wi[i]]);
  return out; }


/* dense LU with partial pivoting; solve(b) in place */
function luFactor(M, n){ const P = new Int32Array(n);
  for(let k=0;k<n;k++){ let p = k; for(let i=k+1;i<n;i++) if(Math.abs(M[i*n+k]) > Math.abs(M[p*n+k])) p = i;
    P[k] = p; if(p !== k) for(let j=0;j<n;j++){ const t = M[k*n+j]; M[k*n+j] = M[p*n+j]; M[p*n+j] = t; }
    for(let i=k+1;i<n;i++){ const f = M[i*n+k] /= M[k*n+k]; for(let j=k+1;j<n;j++) M[i*n+j] -= f*M[k*n+j]; } }
  return b => { for(let k=0;k<n;k++){ const p = P[k]; if(p !== k){ const t = b[k]; b[k] = b[p]; b[p] = t; } }
    for(let i=0;i<n;i++) for(let j=0;j<i;j++) b[i] -= M[i*n+j]*b[j];
    for(let i=n-1;i>=0;i--){ for(let j=i+1;j<n;j++) b[i] -= M[i*n+j]*b[j]; b[i] /= M[i*n+i]; }
    return b; }; }

