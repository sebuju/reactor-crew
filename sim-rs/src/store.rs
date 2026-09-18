//! Storage rows, ported from `netStore` (`src/data/pipenet.js`).
//!
//! The EOS class replays through the gated `net_pstar`/`drho_dp`; tank and
//! condenser compliances arrive pre-evaluated (their predicates port with
//! the tank stage). Memo arrays (`stKp/stKh/stKm/stP0/stC`) are carried by
//! the caller like the net-attached originals.

use crate::eos::*;
use crate::net::COND_P0;

pub const NET_DT: f64 = 0.02;
pub const DRY_MIN_KG: f64 = 1e-6;

/// Memo + outputs carried across replays.
#[derive(Clone, Default)]
pub struct StoreState {
    pub kp: Vec<f64>,
    pub kh: Vec<f64>,
    pub km: Vec<f64>,
    pub p0: Vec<f64>,
    pub cc: Vec<f64>,
}

/// Pre-evaluated per-tank compliance: (node, C, p0).
pub struct TankRow {
    pub node: u32,
    pub c: f64,
    pub p0: f64,
}

/// Pre-evaluated per-condenser row: (node, C, w, p0, wrecked, vacuum).
pub struct CondRow {
    pub node: u32,
    pub c: f64,
    pub w: f64,
    pub p0: f64,
    pub wrecked: bool,
    pub vacuum: bool,
}

/// Storage rows for one call. Returns None when nothing stores (the JS
/// returns null and the solve treats the store as absent).
pub fn net_store(
    n: usize,
    vol: &[f64],
    curve_of: &[u32],
    curves: &[Curve],
    f_p: &[f64],
    f_rho: &[f64],
    f_x: &[f64],
    f_b: &[f64],
    mb_v: &[f64],
    mb_has: &[u8],
    hb_v: &[f64],
    hb_has: &[u8],
    fallback_h: &[f64],
    store_held: bool,
    hold_nodes: &[u32],
    drum_nodes: &[u32],
    tanks: &[TankRow],
    conds: &[CondRow],
    memo: &mut StoreState,
    cap: &mut [f64],
    src: &mut [f64],
    pin: &mut [u8],
) -> bool {
    cap.fill(0.0);
    src.fill(0.0);
    pin.fill(0);
    let mut any = false;
    let mut s1 = [0.0; 3];
    let mut s2 = [0.0; 3];
    if !store_held {
        for i in 0..n {
            let m_eos = js_max(vol[i] * f_rho[i], DRY_MIN_KG);
            let m = if mb_has[i] != 0 { mb_v[i] } else { m_eos };
            let v = vol[i];
            let h_n = if hb_has[i] != 0 { hb_v[i] } else { fallback_h[i] };
            let (p_f, r_f, b_f) = (f_p[i], f_rho[i], f_b[i]);
            let (p0, c);
            if p_f == memo.kp[i] && h_n == memo.kh[i] && m == memo.km[i] {
                p0 = memo.p0[i];
                c = memo.cc[i];
            } else {
                let cu = &curves[curve_of[i] as usize];
                p0 = if v > 0.0 {
                    net_pstar(cu, p_f, h_n, m / v, Some(r_f), Some(b_f), &mut s1, &mut s2)
                } else {
                    p_f
                };
                let d = if p0 == p_f {
                    drho_dp(cu, p0, h_n, Some(r_f), Some(b_f))
                } else {
                    drho_dp(cu, p0, h_n, None, None)
                };
                let xr = f_x[i];
                let xq = if xr < 0.0 { 0.0 } else if xr > 1.0 { 1.0 } else { xr };
                let gk = 1.0 / js_max(p0, COND_P0);
                let solid_k = if js_truthy(cu.solid_k) { cu.solid_k } else { SOLID_K_W };
                let kf = BETA_W / js_max(1e-6, solid_k);
                c = js_max(v * d, m_eos * (xq * gk + (1.0 - xq) * js_min(gk, kf)));
                memo.kp[i] = p_f;
                memo.kh[i] = h_n;
                memo.km[i] = m;
                memo.p0[i] = p0;
                memo.cc[i] = c;
            }
            if !(c > 0.0) || !c.is_finite() || !p0.is_finite() || !m.is_finite() {
                continue;
            }
            cap[i] = c / NET_DT;
            src[i] = c / NET_DT * p0;
            any = true;
        }
        for &tn in hold_nodes {
            let i = tn as usize;
            if cap[i] > 0.0 {
                pin[i] = 1;
            }
        }
        for &dn in drum_nodes {
            let i = dn as usize;
            if cap[i] > 0.0 {
                pin[i] = 1;
            }
        }
    }
    for t in tanks {
        let i = t.node as usize;
        if !(t.c > 0.0) || !t.c.is_finite() {
            continue;
        }
        if !t.p0.is_finite() {
            continue;
        }
        cap[i] = t.c / NET_DT;
        src[i] = t.c / NET_DT * t.p0;
        pin[i] = 1;
        any = true;
    }
    if !store_held {
        for cd in conds {
            let i = cd.node as usize;
            if cd.wrecked || !cd.vacuum {
                continue;
            }
            if !(cd.c > 0.0) || !cd.c.is_finite() || !cd.w.is_finite() || !cd.p0.is_finite() {
                continue;
            }
            cap[i] = cd.c / NET_DT;
            src[i] = cd.c / NET_DT * cd.p0 + cd.w;
            pin[i] = 1;
            any = true;
        }
    }
    any
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_store_returns_false() {
        let n = 2;
        let mut memo = StoreState {
            kp: vec![f64::NAN; n],
            kh: vec![f64::NAN; n],
            km: vec![f64::NAN; n],
            p0: vec![0.0; n],
            cc: vec![0.0; n],
        };
        let (mut cap, mut src, mut pin) = (vec![0.0; n], vec![0.0; n], vec![0u8; n]);
        let water = Curve::new(
            9.844309, 4174.5246, 30.4331, 647.096, 322.0, 6.9, 558.0, 0.0855, 1e-4, 1.0,
            1509.0, 740.0, 5.5, 1.2e-4, 2.0e-5, 1.4, 558.0,
        );
        // Zero volume everywhere: V>0 false so p0=pF, but d=drho_dp at pF
        // still yields C>0... use NaN field to force the skip path instead.
        let nan = vec![f64::NAN; n];
        let ok = net_store(
            n, &[0.0, 0.0], &[0, 0], &[water], &nan, &nan, &nan, &nan, &nan,
            &[0, 0], &nan, &[0, 0], &nan, false, &[], &[], &[], &[], &mut memo, &mut cap,
            &mut src, &mut pin,
        );
        assert!(!ok);
    }
}
