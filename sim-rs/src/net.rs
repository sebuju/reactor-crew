//! Linear solve core, ported from `src/sim/net.js` (`netFactor`,
//! `netSubst`, `netAssemble`, `netFlows`, `netUnfix`, `denseSolve`) plus
//! `netOrder` (`src/data/pipenet.js`).
//!
//! Pure IEEE op order throughout — no transcendentals — so agreement with
//! the JS is bit-exact. Edge terms (g/h) arrive pre-evaluated per solve;
//! plant-coupled `edgeG/edgeH` evaluation ports with its own stage.

pub const NET_EPS: f64 = 1e-9;
pub const NET_REL: f64 = 1e-12;
pub const COND_P0: f64 = 0.004;
pub const NET_PMAX: f64 = 200.0;
pub const DIV_KG: f64 = 1e-6;

/// Banded LU without pivoting. A degenerate pivot (floating block) is
/// replaced by the identity row and flagged in `deg`, exactly like the JS.
pub fn net_factor(a: &mut [f64], n: usize, mut deg: Option<&mut [u8]>, bw: Option<usize>, d0: &mut [f64]) {
    let b = bw.unwrap_or(n);
    for k in 0..n {
        d0[k] = a[k * n + k];
    }
    for k in 0..n {
        let d = a[k * n + k];
        let lim = n.min(k + b + 1);
        if !(d > NET_EPS) || !(d > NET_REL * d0[k]) {
            a[k * n + k] = 1.0;
            for j in (k + 1)..lim {
                a[k * n + j] = 0.0;
                a[j * n + k] = 0.0;
            }
            if let Some(dg) = deg.as_mut() {
                dg[k] = 1;
            }
            continue;
        }
        for i in (k + 1)..lim {
            let lik = a[i * n + k] / d;
            if lik == 0.0 {
                continue;
            }
            for j in (k + 1)..lim {
                a[i * n + j] -= lik * a[k * n + j];
            }
            a[i * n + k] = lik;
        }
    }
}

/// Forward/back substitution over the banded factors.
pub fn net_subst(a: &[f64], x: &mut [f64], n: usize, bw: Option<usize>) {
    let b = bw.unwrap_or(n);
    for k in 0..n {
        let mut s = x[k];
        for j in k.saturating_sub(b)..k {
            s -= a[k * n + j] * x[j];
        }
        x[k] = s;
    }
    for k in 0..n {
        x[k] /= a[k * n + k];
    }
    for i in (0..n).rev() {
        let mut s = x[i];
        let lim = n.min(i + b + 1);
        for j in (i + 1)..lim {
            s -= a[j * n + i] * x[j];
        }
        x[i] = s;
    }
}

/// Stamp conductances into A (compacted onto free rows via `row` when
/// given) and heads/sources into b. `g`/`h` are the solve's pre-evaluated
/// edge terms; `a=None` refills b only (the reused-factors path).
#[allow(clippy::too_many_arguments)]
pub fn net_assemble(
    u: &[u32],
    v: &[u32],
    g: &[f64],
    h: &[f64],
    fx_v: &[f64],
    fx_h: &[u8],
    cap: Option<&[f64]>,
    src: Option<&[f64]>,
    row: Option<&[u32]>,
    m: usize,
    n: usize,
    mut touch: Option<&mut [u8]>,
    a: Option<&mut [f64]>,
    b: &mut [f64],
) {
    let want_a = a.is_some();
    let mut a = a;
    if let Some(aa) = a.as_mut() {
        aa.fill(0.0);
    }
    b.fill(0.0);
    for e in 0..u.len() {
        let ge = g[e];
        if !(ge > 0.0) {
            continue;
        }
        let he = h[e];
        let (eu, ev) = (u[e] as usize, v[e] as usize);
        if let Some(t) = touch.as_mut() {
            t[eu] = 1;
            t[ev] = 1;
        }
        let (gu, gv) = (fx_h[eu] == 0, fx_h[ev] == 0);
        if want_a {
            let aa = a.as_mut().unwrap();
            let (ru, rv) = match row {
                Some(r) => (r[eu] as usize, r[ev] as usize),
                None => (eu, ev),
            };
            if gu {
                aa[ru * m + ru] += ge;
            }
            if gv {
                aa[rv * m + rv] += ge;
            }
            if gu && gv {
                aa[ru * m + rv] -= ge;
                aa[rv * m + ru] -= ge;
            }
        }
        if gu {
            b[eu] -= ge * he;
        }
        if gv {
            b[ev] += ge * he;
        }
        if gu && !gv {
            b[eu] += ge * fx_v[ev];
        }
        if gv && !gu {
            b[ev] += ge * fx_v[eu];
        }
    }
    if want_a {
        if let (Some(cp), Some(aa)) = (cap, a.as_mut()) {
            for i in 0..n {
                if fx_h[i] == 0 && cp[i] > 0.0 {
                    let ri = match row {
                        Some(r) => r[i] as usize,
                        None => i,
                    };
                    aa[ri * m + ri] += cp[i];
                }
            }
        }
    }
    if let Some(sp) = src {
        for i in 0..n {
            // JS `if(src[i])`: NaN is falsy, so NaN is skipped like 0.
            if fx_h[i] == 0 && sp[i] != 0.0 && !sp[i].is_nan() {
                b[i] += sp[i];
            }
        }
    }
}

/// Edge flows, signed along each edge's own u->v order. A fixed node reads
/// its known pressure.
pub fn net_flows(
    u: &[u32],
    v: &[u32],
    g: &[f64],
    h: &[f64],
    p: &[f64],
    fx_v: &[f64],
    fx_h: &[u8],
    out: &mut [f64],
) {
    for e in 0..u.len() {
        let ge = g[e];
        if !(ge > 0.0) {
            out[e] = 0.0;
            continue;
        }
        let (eu, ev) = (u[e] as usize, v[e] as usize);
        let pu = if fx_h[eu] != 0 { fx_v[eu] } else { p[eu] };
        let pv = if fx_h[ev] != 0 { fx_v[ev] } else { p[ev] };
        out[e] = ge * (pu - pv + h[e]);
    }
}

/// A fixed node lands at its known pressure (substitution leaves 0 there).
pub fn net_unfix(p: &mut [f64], fx_v: &[f64], fx_h: &[u8], n: usize) {
    for i in 0..n {
        if fx_h[i] != 0 {
            p[i] = fx_v[i];
        }
    }
}

/// Reverse Cuthill-McKee over the structural edge list. Ties on node
/// index, so a re-factor lands on the same ordering.
pub fn net_order(n: usize, u: &[u32], v: &[u32], fx_h: &[u8]) -> Vec<u32> {
    let mut pos = vec![-1i32; n];
    let mut free: Vec<u32> = Vec::new();
    for i in 0..n {
        if fx_h[i] == 0 {
            pos[i] = free.len() as i32;
            free.push(i as u32);
        }
    }
    let nf = free.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); nf];
    for e in 0..u.len() {
        let (a, b) = (pos[u[e] as usize], pos[v[e] as usize]);
        if a < 0 || b < 0 || a == b {
            continue;
        }
        adj[a as usize].push(b as usize);
        adj[b as usize].push(a as usize);
    }
    let by_deg = |p: &usize, q: &usize| adj[*p].len().cmp(&adj[*q].len()).then(p.cmp(q));
    let mut seen = vec![0u8; nf];
    let mut order: Vec<usize> = Vec::new();
    loop {
        let mut s = -1i32;
        for a in 0..nf {
            if seen[a] == 0 && (s < 0 || by_deg(&a, &(s as usize)).is_lt()) {
                s = a as i32;
            }
        }
        if s < 0 {
            break;
        }
        seen[s as usize] = 1;
        let mut q = vec![s as usize];
        let mut h = 0;
        while h < q.len() {
            let x = q[h];
            h += 1;
            order.push(x);
            let mut nb: Vec<usize> = adj[x].iter().filter(|y| seen[**y] == 0).copied().collect();
            nb.sort_by(by_deg);
            for y in nb {
                seen[y] = 1;
                q.push(y);
            }
        }
    }
    order.reverse();
    order.into_iter().map(|a| free[a]).collect()
}

/// Cold-path dense solve with partial pivoting (commissioning/tools only).
/// Flat row-major A, same loop order as the JS nested-array version.
pub fn dense_solve(a: &mut [f64], b: &mut [f64], out: &mut [f64], n: usize) -> bool {
    let mut ok = true;
    for c in 0..n {
        let mut piv = c;
        for r in (c + 1)..n {
            if a[r * n + c].abs() > a[piv * n + c].abs() {
                piv = r;
            }
        }
        if piv != c {
            for k in 0..n {
                a.swap(c * n + k, piv * n + k);
            }
            b.swap(c, piv);
        }
        if !(a[c * n + c].abs() > 1e-12) {
            ok = false;
            continue;
        }
        for r in (c + 1)..n {
            let f = a[r * n + c] / a[c * n + c];
            for k in c..n {
                a[r * n + k] -= f * a[c * n + k];
            }
            b[r] -= f * b[c];
        }
    }
    for c in (0..n).rev() {
        let mut s = b[c];
        for k in (c + 1)..n {
            s -= a[c * n + k] * out[k];
        }
        out[c] = if a[c * n + c].abs() > 1e-12 { s / a[c * n + c] } else { 0.0 };
    }
    ok
}

/// Assembly self-check: residues of free nodes, in the same terms as
/// `netDiverge` (dev invariant; the tick path reports these via import).
/// Returns (node, residue, qmax) for every free node over tolerance, plus
/// qmax. Empty (with qmax) when quiet.
pub fn diverge_check(
    u: &[u32],
    v: &[u32],
    q: &[f64],
    fx_h: &[u8],
    deg: Option<&[u8]>,
    cap: Option<&[f64]>,
    src: Option<&[f64]>,
    b: &[f64],
    n: usize,
) -> (Vec<(usize, f64)>, f64) {
    let mut d = vec![0.0; n];
    let mut qmax = 0.0;
    for e in 0..u.len() {
        let f = q[e];
        d[u[e] as usize] -= f;
        d[v[e] as usize] += f;
        if f.abs() > qmax {
            qmax = f.abs();
        }
    }
    let mut acc = vec![0.0; n];
    if let (Some(cp), Some(sp)) = (cap, src) {
        for i in 0..n {
            if !(cp[i] > 0.0) {
                continue;
            }
            acc[i] = cp[i] * b[i] - sp[i];
            if acc[i].abs() > qmax {
                qmax = acc[i].abs();
            }
        }
    }
    let mut out = Vec::new();
    if !(qmax > 0.0) {
        return (out, qmax);
    }
    let tol = f64::max(1e-6 * qmax, DIV_KG);
    for i in 0..n {
        if fx_h[i] != 0 {
            continue;
        }
        if let Some(dg) = deg {
            if dg[i] != 0 {
                continue;
            }
        }
        let r = d[i] - acc[i];
        if r.abs() > tol {
            out.push((i, r));
        }
    }
    (out, qmax)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-12 * (a.abs() + b.abs() + 1e-300)
    }

    #[test]
    fn triangle_solves_exact() {
        // 0--1 (g=2), 1--2 (g=3), node 2 fixed at 10, head 1 on edge 0.
        let (u, v, g, h) = (vec![0, 1], vec![1, 2], vec![2.0, 3.0], vec![1.0, 0.0]);
        let (fx_v, fx_h) = (vec![0.0, 0.0, 10.0], vec![0, 0, 1]);
        let mut a = vec![0.0; 4];
        let mut b = vec![0.0; 3];
        net_assemble(&u, &v, &g, &h, &fx_v, &fx_h, None, None, None, 2, 3, None, Some(&mut a), &mut b);
        // b0 = -2*1 = -2; b1 = 2*1 + 3*10 = 32.
        assert!(approx(b[0], -2.0) && approx(b[1], 32.0));
        let mut d0 = vec![0.0; 2];
        net_factor(&mut a, 2, None, None, &mut d0);
        let mut x = b[..2].to_vec();
        net_subst(&a, &mut x, 2, None);
        // A = [[2,-2],[-2,5]]; x = [9, 10].
        assert!(approx(x[0], 9.0) && approx(x[1], 10.0));
        let mut p = vec![x[0], x[1], 0.0];
        net_unfix(&mut p, &fx_v, &fx_h, 3);
        assert!(approx(p[2], 10.0));
        let mut q = vec![0.0; 2];
        net_flows(&u, &v, &g, &h, &p, &fx_v, &fx_h, &mut q);
        assert!(approx(q[0], 2.0 * (9.0 - 10.0 + 1.0)) && approx(q[1], 3.0 * (10.0 - 10.0)));
    }

    #[test]
    fn degenerate_pivot_flags_and_holds() {
        // Isolated free node: zero diagonal -> identity row, deg set.
        let (u, v, g, h) = (vec![0], vec![1], vec![1.0], vec![0.0]);
        let (fx_v, fx_h) = (vec![0.0, 0.0, 0.0], vec![0, 1, 0]);
        let mut a = vec![0.0; 4];
        let mut b = vec![0.0; 3];
        let mut row = vec![0u32; 3];
        row[0] = 0;
        row[2] = 1;
        net_assemble(&u, &v, &g, &h, &fx_v, &fx_h, None, None, Some(&row), 2, 3, None, Some(&mut a), &mut b);
        let mut deg = vec![0u8; 2];
        let mut d0 = vec![0.0; 2];
        net_factor(&mut a, 2, Some(&mut deg), Some(1), &mut d0);
        assert_eq!(deg, vec![0, 1]);
        let mut x = vec![b[0], b[2]];
        net_subst(&a, &mut x, 2, Some(1));
        assert!(x[1] == 0.0);
    }

    #[test]
    fn factor_subst_matches_dense_on_random() {
        // Deterministic LCG fuzz: banded factor+subst vs dense solve.
        let mut s = 0x12345678u32;
        let mut rnd = move || {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            (s as f64) / (u32::MAX as f64)
        };
        for _ in 0..50 {
            let n = 3 + (rnd() * 5.0) as usize;
            let mut a = vec![0.0; n * n];
            for i in 0..n {
                a[i * n + i] = 2.0 + rnd() * 5.0;
                if i > 0 {
                    let c = (rnd() - 0.5) * 2.0;
                    a[i * n + i - 1] = c;
                    a[(i - 1) * n + i] = c;
                }
            }
            let b: Vec<f64> = (0..n).map(|_| (rnd() - 0.5) * 10.0).collect();
            let mut af = a.clone();
            let mut d0 = vec![0.0; n];
            net_factor(&mut af, n, None, Some(1), &mut d0);
            let mut x = b.clone();
            net_subst(&af, &mut x, n, Some(1));
            let mut ad = a.clone();
            let mut bd = b.clone();
            let mut xd = vec![0.0; n];
            assert!(dense_solve(&mut ad, &mut bd, &mut xd, n));
            for i in 0..n {
                assert!(approx(x[i], xd[i]), "n={n} i={i}: {} vs {}", x[i], xd[i]);
            }
        }
    }

    #[test]
    fn order_is_deterministic_and_covers() {
        let (u, v) = (vec![0, 1, 2, 3, 4], vec![1, 2, 3, 4, 0]);
        let fx_h = vec![0, 0, 0, 0, 1];
        let o1 = net_order(5, &u, &v, &fx_h);
        let o2 = net_order(5, &u, &v, &fx_h);
        assert_eq!(o1, o2);
        let mut s = o1.clone();
        s.sort();
        assert_eq!(s, vec![0, 1, 2, 3]);
    }
}
