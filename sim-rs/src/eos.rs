//! EOS + saturation curves, ported leaf-up from `src/data/pipenet.js`
//! (`satT` through `mixState`, `curveTab`, and the pure converse helpers).
//!
//! Rules: identical IEEE op order to the JS; JS `Math.max/min` NaN
//! semantics emulated explicitly (`js_max/js_min`); transcendentals via
//! `libm` (last-ulp differences vs V8 are the documented gate allowance).

pub const CURVE_N: usize = 2048;
pub const CURVE_LO: f64 = 100.0;
pub const WATSON: f64 = 0.38;
pub const RHO_N: f64 = 0.35;
pub const H_DATUM: f64 = 273.15;
pub const BETA_W: f64 = 0.0025;
pub const SOLID_K_W: f64 = 1.4; // COOLANT[0].solidK; per-curve override wins

pub const MX_X: usize = 0;
pub const MX_RHO: usize = 1;
pub const MX_B: usize = 2;

/// JS `&&` truthiness for a number-or-missing slot (`undefined` arrives as
/// NaN over the ABI): 0, -0 and NaN are falsy.
#[inline]
pub fn js_truthy(v: f64) -> bool {
    v != 0.0 && !v.is_nan()
}

/// JS `Math.max`: NaN in, NaN out.
#[inline]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// JS `Math.min`: NaN in, NaN out.
#[inline]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// JS `clamp(v,a,b) = Math.max(a, Math.min(b, v))`.
#[inline]
pub fn clamp(v: f64, a: f64, b: f64) -> f64 {
    js_max(a, js_min(b, v))
}

/// Saturation curve. Mirrors the keys `satCurveFor` builds (plus `tab`,
/// built once here instead of lazily — same values, no per-call box).
/// Missing numerics arrive as NaN and read falsy, exactly like `undefined`.
#[derive(Clone)]
pub struct Curve {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub tc: f64,
    pub rhoc: f64,
    pub p0: f64,
    pub t0: f64,
    pub n: f64,
    pub p_floor: f64,
    pub t_floor: f64,
    pub hfg: f64,
    pub rho: f64,
    pub cp: f64,
    pub mu: f64,
    pub mu_v: f64,
    pub solid_k: f64,
    pub tref: f64,
    pub tab: Option<CurveTab>,
}

#[derive(Clone)]
pub struct CurveTab {
    pub inv: f64,
    pub hi: f64,
    pub hfg: Box<[f64; CURVE_N]>,
    pub rf: Box<[f64; CURVE_N]>,
    pub rg: Box<[f64; CURVE_N]>,
    pub sp: Box<[f64; CURVE_N]>,
}

impl Curve {
    pub fn new(
        a: f64,
        b: f64,
        cc: f64,
        tc: f64,
        rhoc: f64,
        p0: f64,
        t0: f64,
        n: f64,
        p_floor: f64,
        t_floor: f64,
        hfg: f64,
        rho: f64,
        cp: f64,
        mu: f64,
        mu_v: f64,
        solid_k: f64,
        tref: f64,
    ) -> Self {
        let mut c = Self {
            a,
            b,
            c: cc,
            tc,
            rhoc,
            p0,
            t0,
            n,
            p_floor,
            t_floor,
            hfg,
            rho,
            cp,
            mu,
            mu_v,
            solid_k,
            tref,
            tab: None,
        };
        c.tab = curve_tab(&c);
        c
    }

    #[inline]
    pub fn anthropic(&self) -> bool {
        matches!(self.a, a if js_truthy(a))
    }
}

/// `curveTab`: null unless `tc > CURVE_LO + 10`.
pub fn curve_tab(c: &Curve) -> Option<CurveTab> {
    if !(c.tc > CURVE_LO + 10.0) {
        return None;
    }
    let d = (c.tc - CURVE_LO) / (CURVE_N - 1) as f64;
    let mut hfg = Box::new([0.0; CURVE_N]);
    let mut rf = Box::new([0.0; CURVE_N]);
    let mut rg = Box::new([0.0; CURVE_N]);
    let mut sp = Box::new([0.0; CURVE_N]);
    for i in 0..CURVE_N {
        let t = CURVE_LO + i as f64 * d;
        hfg[i] = hfg_raw(c, t);
        rf[i] = rhof_raw(c, t);
        rg[i] = rhog_raw(c, t);
        sp[i] = sat_p_raw(c, t);
    }
    Some(CurveTab { inv: 1.0 / d, hi: c.tc - d, hfg, rf, rg, sp })
}

#[inline]
fn tab_at(a: &[f64; CURVE_N], t: &CurveTab, temp: f64) -> f64 {
    let u = (temp - CURVE_LO) * t.inv;
    let i = u as usize;
    let w = u - i as f64;
    a[i] + (a[i + 1] - a[i]) * w
}

/// `satT`: Antoine where the row carries A, power law otherwise.
pub fn sat_t(c: &Curve, p: f64) -> f64 {
    if c.anthropic() {
        c.c + c.b / (c.a - crate::fdlibm::log(js_max(p, c.p_floor)))
    } else {
        c.t0 * crate::fdlibm::pow(js_max(p, c.p_floor) / c.p0, c.n)
    }
}

pub fn sat_p_raw(c: &Curve, t: f64) -> f64 {
    if c.anthropic() {
        crate::fdlibm::exp(c.a - c.b / js_max(t - c.c, 1.0))
    } else {
        c.p0 * crate::fdlibm::pow(js_max(t, c.t_floor) / c.t0, 1.0 / c.n)
    }
}

/// dp/dT along the curve, exact rather than differenced.
pub fn sat_slope(c: &Curve, p: f64) -> f64 {
    let q = js_max(p, c.p_floor);
    if !c.anthropic() {
        return q / (c.n * sat_t(c, q));
    }
    let d = js_max(sat_t(c, q) - c.c, 1.0);
    q * c.b / (d * d)
}

/// Watson: latent heat falls to zero at the critical point.
pub fn hfg_raw(c: &Curve, t: f64) -> f64 {
    if js_truthy(c.tc) {
        c.hfg * crate::fdlibm::pow(clamp((c.tc - t) / (c.tc - c.t0), 0.0, 6.0), WATSON)
    } else {
        c.hfg
    }
}

pub fn rhof_raw(c: &Curve, t: f64) -> f64 {
    if js_truthy(c.tc) {
        c.rhoc + (c.rho - c.rhoc) * crate::fdlibm::pow(clamp((c.tc - t) / (c.tc - c.t0), 0.0, 6.0), RHO_N)
    } else {
        c.rho
    }
}

/// Clausius-Clapeyron backwards, ceiled at the liquid.
pub fn rhog_raw(c: &Curve, t: f64) -> f64 {
    js_min(
        rhof_raw(c, t),
        js_max(sat_slope(c, sat_p_raw(c, t)) * t * 1e3 / js_max(hfg_raw(c, t), 1e-6), 1e-6),
    )
}

#[inline]
fn tabbed(c: &Curve, t: f64) -> Option<(&CurveTab, bool)> {
    match &c.tab {
        Some(tab) if t > CURVE_LO && t < tab.hi => Some((tab, true)),
        _ => None,
    }
}

pub fn hfg_of(c: &Curve, t: f64) -> f64 {
    match tabbed(c, t) {
        Some((tab, _)) => tab_at(&tab.hfg, tab, t),
        None => hfg_raw(c, t),
    }
}

pub fn rhof_of(c: &Curve, t: f64) -> f64 {
    match tabbed(c, t) {
        Some((tab, _)) => tab_at(&tab.rf, tab, t),
        None => rhof_raw(c, t),
    }
}

pub fn rhog_of(c: &Curve, t: f64) -> f64 {
    match tabbed(c, t) {
        Some((tab, _)) => tab_at(&tab.rg, tab, t),
        None => rhog_raw(c, t),
    }
}

pub fn sat_p(c: &Curve, t: f64) -> f64 {
    match tabbed(c, t) {
        Some((tab, _)) => tab_at(&tab.sp, tab, t),
        None => sat_p_raw(c, t),
    }
}

/// Three branches off the state the node is actually in; they meet at
/// x=0 and x=1. `out` is `[x, rho, branch]`, mirroring `MX_X/MX_RHO/MX_B`.
/// The curve read is inlined exactly like the JS (no call-boundary boxes).
pub fn mix_state<'a>(c: &Curve, p: f64, h: f64, out: &'a mut [f64; 3]) -> &'a mut [f64; 3] {
    let ts = if c.anthropic() {
        c.c + c.b / (c.a - crate::fdlibm::log(js_max(p, c.p_floor)))
    } else {
        c.t0 * crate::fdlibm::pow(js_max(p, c.p_floor) / c.p0, c.n)
    };
    let hf = c.cp * (ts - H_DATUM);
    let mut hfg = match &c.tab {
        Some(tab) if ts > CURVE_LO && ts < tab.hi => {
            let u = (ts - CURVE_LO) * tab.inv;
            let i = u as usize;
            let w = u - i as f64;
            tab.hfg[i] + (tab.hfg[i + 1] - tab.hfg[i]) * w
        }
        _ => hfg_of(c, ts),
    };
    if !(hfg > 1e-6) {
        hfg = 1e-6;
    }
    let mut x = (h - hf) / hfg;
    if x < 0.0 {
        x = 0.0;
    } else if x > 1.0 {
        x = 1.0;
    }
    out[MX_X] = x;
    out[MX_B] = if h <= hf { 0.0 } else if h >= hf + hfg { 2.0 } else { 1.0 };
    if h <= hf {
        let mut t = H_DATUM + h / c.cp;
        if t > ts {
            t = ts;
        }
        // Above its own critical temperature there is no liquid branch:
        // p/T off the design point the density is quoted at.
        if t >= c.tc {
            out[MX_RHO] = c.rho * (p / c.p0) * (tref_of(c) / js_max(t, 1.0));
        } else {
            let rf = match &c.tab {
                Some(tab) if t > CURVE_LO && t < tab.hi => {
                    let u = (t - CURVE_LO) * tab.inv;
                    let i = u as usize;
                    let w = u - i as f64;
                    tab.rf[i] + (tab.rf[i + 1] - tab.rf[i]) * w
                }
                _ => rhof_of(c, t),
            };
            let sp = match &c.tab {
                Some(tab) if t > CURVE_LO && t < tab.hi => {
                    let u = (t - CURVE_LO) * tab.inv;
                    let i = u as usize;
                    let w = u - i as f64;
                    tab.sp[i] + (tab.sp[i + 1] - tab.sp[i]) * w
                }
                _ => sat_p(c, t),
            };
            let solid_k = if js_truthy(c.solid_k) { c.solid_k } else { SOLID_K_W };
            out[MX_RHO] = rf * (1.0 + (BETA_W / js_max(1e-6, solid_k)) * js_max(0.0, p - sp));
        }
    } else if h >= hf + hfg {
        let t = ts + (h - hf - hfg) / c.cp;
        let rg = match &c.tab {
            Some(tab) if ts > CURVE_LO && ts < tab.hi => {
                let u = (ts - CURVE_LO) * tab.inv;
                let i = u as usize;
                let w = u - i as f64;
                tab.rg[i] + (tab.rg[i + 1] - tab.rg[i]) * w
            }
            _ => rhog_of(c, ts),
        };
        out[MX_RHO] = rg * ts / js_max(t, 1.0);
    } else {
        let (rf, rg) = match &c.tab {
            Some(tab) if ts > CURVE_LO && ts < tab.hi => {
                let u = (ts - CURVE_LO) * tab.inv;
                let i = u as usize;
                let w = u - i as f64;
                (
                    tab.rf[i] + (tab.rf[i + 1] - tab.rf[i]) * w,
                    tab.rg[i] + (tab.rg[i + 1] - tab.rg[i]) * w,
                )
            }
            _ => (rhof_of(c, ts), rhog_of(c, ts)),
        };
        out[MX_RHO] = 1.0 / ((1.0 - x) / rf + x / rg);
    }
    out
}

#[inline]
fn tref_of(c: &Curve) -> f64 {
    if js_truthy(c.tref) { c.tref } else { c.t0 }
}

/// Homogeneous (McAdams) viscosity, not the two-phase multiplier.
pub fn mu_mix_of(c: &Curve, x: f64) -> f64 {
    let mf = c.mu;
    let mg = if js_truthy(c.mu_v) { c.mu_v } else { c.mu };
    if x <= 0.0 {
        mf
    } else if x >= 1.0 {
        mg
    } else {
        1.0 / (x / mg + (1.0 - x) / mf)
    }
}

pub fn rho_mix_of(c: &Curve, p: f64, h: f64) -> f64 {
    let mut out = [0.0; 3];
    mix_state(c, p, h, &mut out)[MX_RHO]
}

// Entropy on mix_state's own three branches, so the two cannot disagree.
pub fn mix_s(c: &Curve, p: f64, h: f64) -> f64 {
    let ts = sat_t(c, p);
    let hf = c.cp * (ts - H_DATUM);
    let hfg = js_max(hfg_of(c, ts), 1e-6);
    if h <= hf {
        return c.cp * crate::fdlibm::log(js_max(js_min(H_DATUM + h / c.cp, ts), 1.0) / H_DATUM);
    }
    if h >= hf + hfg {
        return c.cp * crate::fdlibm::log((ts + (h - hf - hfg) / c.cp) / H_DATUM) + hfg / ts;
    }
    c.cp * crate::fdlibm::log(ts / H_DATUM) + (h - hf) / ts
}

// kJ/kg a state can do expanding isentropically to p0 (Hicks-Menzies).
pub fn exp_work_of(c: &Curve, p: f64, h: f64, p0: f64) -> f64 {
    if !(p > p0) {
        return 0.0;
    }
    let s1 = mix_s(c, p, h);
    let (mut lo, mut hi) = (0.0, h);
    for _ in 0..50 {
        let mid = 0.5 * (lo + hi);
        if mix_s(c, p0, mid) < s1 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    js_max(0.0, h - 0.5 * (lo + hi))
}

/// Numerically off mix_state itself, stepped to stay on the node's own
/// branch: across the shelf edge two slopes are orders apart.
pub fn drho_dp(c: &Curve, p: f64, h: f64, r0: Option<f64>, b0: Option<f64>) -> f64 {
    let dp = js_max(1e-4, p * 1e-3);
    let (r0, b0) = match (r0, b0) {
        (Some(r), Some(b)) => (r, b),
        _ => {
            let mut m = [0.0; 3];
            mix_state(c, p, h, &mut m);
            (m[MX_RHO], m[MX_B])
        }
    };
    let mut p1 = p + dp;
    let mut m1 = [0.0; 3];
    mix_state(c, p1, h, &mut m1);
    let mut r1 = m1[MX_RHO];
    if m1[MX_B] != b0 {
        let p2 = p - dp;
        let mut m2 = [0.0; 3];
        if p2 > 0.0 {
            mix_state(c, p2, h, &mut m2);
        }
        if p2 > 0.0 && m2[MX_B] == b0 {
            p1 = p2;
            r1 = m2[MX_RHO];
        } else {
            mix_state(c, p1, h, &mut m1);
            r1 = m1[MX_RHO];
        }
    }
    (r1 - r0) / (p1 - p)
}

/// rho(p, h) is monotone in p on all three branches, so this has one
/// answer: Newton off the curve's own slope, bisection-safeguarded.
/// `s1`/`s2` are the two scratch triplets (JS `MIX_SCRATCH`/`MIX_SCRATCH2`).
/// A node holding more than any pressure can account for is pinned at
/// `NET_PMAX`, not solved.
pub fn net_pstar(
    c: &Curve,
    p0: f64,
    h: f64,
    rho_t: f64,
    r0: Option<f64>,
    b0: Option<f64>,
    s1: &mut [f64; 3],
    s2: &mut [f64; 3],
) -> f64 {
    use crate::net::{COND_P0, NET_PMAX};
    // An empty node is at the vacuum, not at whatever it was last solved at.
    if !rho_t.is_finite() || rho_t <= 0.0 {
        return COND_P0;
    }
    let mut p = if p0 < COND_P0 {
        COND_P0
    } else if p0 > NET_PMAX {
        NET_PMAX
    } else {
        p0
    };
    let (lo, hi) = (COND_P0, NET_PMAX);
    let (mut lo, mut hi) = (lo, hi);
    for k in 0..40 {
        let (r, b);
        if k == 0 && p == p0 && r0.is_some() {
            r = r0.unwrap();
            b = b0.unwrap();
        } else {
            mix_state(c, p, h, s1);
            r = s1[MX_RHO];
            b = s1[MX_B];
        }
        if libm::fabs(r - rho_t) <= 1e-6 * rho_t {
            return p;
        }
        if r < rho_t {
            lo = p;
        } else {
            hi = p;
        }
        // DRHO_DP inlined, exactly like the JS.
        let dp = js_max(1e-4, p * 1e-3);
        let mut p1 = p + dp;
        mix_state(c, p1, h, s2);
        let mut r1 = s2[MX_RHO];
        if s2[MX_B] != b {
            let p2 = p - dp;
            if p2 > 0.0 {
                mix_state(c, p2, h, s2);
                if s2[MX_B] == b {
                    p1 = p2;
                    r1 = s2[MX_RHO];
                } else {
                    mix_state(c, p1, h, s2);
                    r1 = s2[MX_RHO];
                }
            } else {
                mix_state(c, p1, h, s2);
                r1 = s2[MX_RHO];
            }
        }
        let d = (r1 - r) / (p1 - p);
        let nxt = if d > 0.0 { p - (r - rho_t) / d } else { (lo + hi) / 2.0 };
        p = if nxt > lo && nxt < hi { nxt } else { (lo + hi) / 2.0 };
    }
    p
}

/// Compressibility per MPa: a gas is exactly 1/p, a two-phase node the
/// mass-weighted mixture of the two.
pub fn net_kappa(c: &Curve, p: f64, x: f64) -> f64 {
    use crate::net::COND_P0;
    let q = clamp(x, 0.0, 1.0);
    let g = 1.0 / js_max(p, COND_P0);
    let solid_k = if js_truthy(c.solid_k) { c.solid_k } else { SOLID_K_W };
    let kf = BETA_W / js_max(1e-6, solid_k);
    // A fluid above its own tc reads x 0 off the fictional tsat.
    q * g + (1.0 - q) * js_min(g, kf)
}

/// kJ/kg from H_DATUM; the two ends of the shelf.
pub fn sat_h(c: &Curve, p: f64) -> f64 {
    c.cp * (sat_t(c, p) - H_DATUM)
}

pub fn sat_hg(c: &Curve, p: f64) -> f64 {
    sat_h(c, p) + hfg_of(c, sat_t(c, p))
}

/// Taken as liquid: the seed, and how a pot's temperature enters the field.
pub fn h_of_t(c: &Curve, t: f64) -> f64 {
    c.cp * (t - H_DATUM)
}

/// On the shelf every enthalpy is the same temperature.
pub fn t_of_h(c: &Curve, p: f64, h: f64) -> f64 {
    let hf = sat_h(c, p);
    if h <= hf {
        return H_DATUM + h / c.cp;
    }
    let hg = hf + hfg_of(c, sat_t(c, p));
    if h >= hg {
        sat_t(c, p) + (h - hg) / c.cp
    } else {
        sat_t(c, p)
    }
}

pub fn x_of_h(c: &Curve, p: f64, h: f64) -> f64 {
    let hf = sat_h(c, p);
    clamp((h - hf) / js_max(hfg_of(c, sat_t(c, p)), 1e-6), 0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn water() -> Curve {
        Curve::new(
            9.844309,
            4174.5246,
            30.4331,
            647.096,
            322.0,
            6.9,
            558.0,
            0.0855,
            1e-4,
            1.0,
            1509.0,
            740.0,
            5.5,
            1.2e-4,
            2.0e-5,
            1.4,
            558.0,
        )
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() <= 2e-13 * (a.abs() + b.abs() + 1e-300)
    }

    #[test]
    fn table_geometry_matches_js() {
        let t = water().tab.expect("water has a table");
        assert!(approx(t.inv, 3.7415736909061663));
        assert!(approx(t.hi, 646.8287327796776));
    }

    #[test]
    fn js_truthiness_edges() {
        assert!(!js_truthy(0.0) && !js_truthy(-0.0) && !js_truthy(f64::NAN));
        assert!(js_truthy(1e-300) && js_truthy(-1.0));
        assert!(js_max(f64::NAN, 1.0).is_nan() && js_min(1.0, f64::NAN).is_nan());
        assert!(clamp(f64::NAN, 0.0, 1.0).is_nan());
    }

    // Spot values dumped from the live JS (node tools/bundle headless).
    #[test]
    fn mix_state_spots() {
        let w = water();
        let mut o = [0.0; 3];
        let rel = |a: f64, b: f64| (a - b).abs() / (a.abs() + b.abs() + 1e-300);
        let case = |c: &Curve, p: f64, h: f64, x: f64, rho: f64, b: f64| {
            let mut o = [0.0; 3];
            mix_state(c, p, h, &mut o);
            assert_eq!(o[MX_B], b, "branch p={p} h={h}");
            assert!(rel(o[MX_X], x) < 1e-12, "x p={p} h={h}: {} vs {x}", o[MX_X]);
            assert!(rel(o[MX_RHO], rho) < 1e-12, "rho p={p} h={h}: {} vs {rho}", o[MX_RHO]);
        };
        case(&w, 15.5, 100.0, 0.0, 1028.3216255704467, 0.0);
        case(&w, 15.5, 1600.0, 0.0, 740.18467756376549, 0.0);
        case(&w, 15.5, 3000.0, 1.0, 113.64317539940761, 2.0);
        case(&w, 0.1, 100.0, 0.0, 1000.8043164886770, 0.0);
        case(&w, 25.0, 3000.0, 1.0, 259.81268040954814, 2.0);
        case(&w, 0.0001, -100.0, 0.011259140256020296, 0.072717731058961441, 1.0);
        case(&w, 22.06, 2000.0, 0.0, 521.05889202947242, 0.0);
        assert!(rel(sat_t(&w, 15.5), 618.10718065836841) < 1e-12);
        assert!(rel(t_of_h(&w, 15.5, 3000.0), 639.53284766733452) < 1e-12);
        assert!(rel(x_of_h(&w, 0.0001, -100.0), 0.011259140256020296) < 1e-12);
        assert!(rel(sat_h(&w, 15.5), 1897.2644936210263) < 1e-12);
        assert!(rel(rho_mix_of(&w, 15.5, 100.0), 1028.3216255704467) < 1e-12);
        assert!(rel(mu_mix_of(&w, o[MX_X]), 1.2e-4) < 1e-12);
        let _ = &mut o;
    }

    #[test]
    fn power_law_and_tableless_curves() {
        // tc=2573 power-law curve with table (COOLANT[3]-shaped).
        let he = Curve::new(
            f64::NAN,
            f64::NAN,
            f64::NAN,
            2573.0,
            219.0,
            0.2,
            1150.0,
            0.048967223763803823,
            0.05,
            1.0,
            4260.0,
            847.0,
            1.25,
            2.5e-4,
            2.0e-5,
            1.4,
            723.0,
        );
        assert!(he.tab.is_some());
        let rel = |a: f64, b: f64| (a - b).abs() / (a.abs() + b.abs() + 1e-300);
        let mut o = [0.0; 3];
        mix_state(&he, 0.5, 100.0, &mut o);
        assert_eq!(o[MX_B], 0.0);
        assert!(rel(o[MX_RHO], 953.60587981604385) < 1e-12);
        mix_state(&he, 0.5, 4000.0, &mut o);
        assert_eq!(o[MX_B], 1.0);
        assert!(rel(o[MX_X], 0.67582626483479358) < 1e-12);
        assert!(rel(o[MX_RHO], 3.5930803083773037) < 1e-12);
        // Helium-shaped: tc below table threshold, raw laws only.
        let he5 = Curve::new(
            f64::NAN,
            f64::NAN,
            f64::NAN,
            5.195,
            69.6,
            7.0,
            2000.0,
            0.10,
            0.05,
            1.0,
            20.9,
            4.334,
            5.19,
            4.5e-5,
            4.5e-5,
            0.009,
            773.0,
        );
        assert!(he5.tab.is_none());
        let mut o = [0.0; 3];
        mix_state(&he5, 7.0, 500.0, &mut o);
        assert!(o[MX_RHO].is_finite() && o[MX_X] == 0.0);
    }
}
