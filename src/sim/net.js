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
