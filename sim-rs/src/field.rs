//! Nodal field update, ported from `netFieldUpdate` (`src/data/pipenet.js`).
//!
//! The plant-coupled reads (`netPAt`/`netHAt` fallbacks, `poolLvlOf`) arrive
//! as pre-evaluated inputs; the store call at the end of the JS function
//! ports with its own stage and is not replayed here (it reads F, never
//! writes it). Curve-per-node and structural masks are commission-time data.

use crate::eos::*;

pub const NET_DT: f64 = 0.02;
pub const DRY_FRAC: f64 = 1e-3;
pub const DRY_MIN_KG: f64 = 1e-6;

/// Structural per-node data: volume, run membership, curve index.
pub struct FieldStruct {
    pub vol: Vec<f64>,
    pub run_mask: Vec<u8>,
    pub curve_of: Vec<u32>,
    pub gas_nodes: Vec<u32>,
    pub liq_nodes: Vec<u32>,
    pub cond_v: Vec<u32>,
    pub cont_mask: Vec<u8>,
}

/// Per-sample inputs: typed field snapshots, solver march flows, fallbacks.
pub struct FieldSample<'a> {
    pub pb_v: &'a [f64],
    pub pb_has: &'a [u8],
    pub hb_v: &'a [f64],
    pub hb_has: &'a [u8],
    pub mb_v: &'a [f64],
    pub mb_has: &'a [u8],
    pub w_arr: &'a [f64],
    pub edge_u: &'a [u32],
    pub edge_v: &'a [u32],
    /// Resolved `netPAt`/`netHAt` per node (plant reads, evaluated by the driver).
    pub fallback_p: &'a [f64],
    pub fallback_h: &'a [f64],
    /// `poolLvlOf` per `cond_v` entry (`None` slot reads as undefined).
    pub pool_lvl: &'a [Option<f64>],
}

/// Live F arrays, carried across replays like `net.F`.
pub struct FieldState {
    pub p: Vec<f64>,
    pub rho: Vec<f64>,
    pub x: Vec<f64>,
    pub b: Vec<f64>,
    pub rho_d: Vec<f64>,
    pub rho_g: Vec<f64>,
    pub rho_l: Vec<f64>,
    pub wet: Vec<u8>,
    pub void_: Vec<u8>,
    pub mu: Vec<f64>,
    pub lp: Vec<f64>,
    pub lh: Vec<f64>,
    pub lm: Vec<f64>,
}

impl FieldState {
    pub fn seed(
        p: Vec<f64>,
        rho: Vec<f64>,
        x: Vec<f64>,
        b: Vec<f64>,
        rho_d: Vec<f64>,
        rho_g: Vec<f64>,
        rho_l: Vec<f64>,
        wet: Vec<u8>,
        void_: Vec<u8>,
        mu: Vec<f64>,
        lp: Vec<f64>,
        lh: Vec<f64>,
        lm: Vec<f64>,
    ) -> Self {
        Self { p, rho, x, b, rho_d, rho_g, rho_l, wet, void_, mu, lp, lh, lm }
    }
}

/// Structural dry test: against what the node would hold, never a typed
/// density. `rho` is always the mix read here (the `undefined` fallback
/// needs plant reads and ports with the caller stage).
#[inline]
pub fn net_node_dry(m: Option<f64>, vol: f64, rho: f64) -> bool {
    match m {
        Some(m) => {
            let eos = vol * rho;
            eos > DRY_MIN_KG && m <= DRY_FRAC * eos
        }
        None => false,
    }
}

/// The node loop + rhoG/rhoL + cond/void/cont passes of `netFieldUpdate`.
pub fn field_update(
    st: &FieldStruct,
    curves: &[Curve],
    fs: &mut FieldState,
    s: &FieldSample,
    scratch3: &mut [f64; 3],
) {
    use crate::net::COND_P0;
    let n = st.vol.len();
    let mut fed_in = vec![0.0; n];
    for e in 0..s.edge_u.len() {
        let w = s.w_arr[e];
        if w > 0.0 {
            fed_in[s.edge_v[e] as usize] += w;
        } else if w < 0.0 {
            fed_in[s.edge_u[e] as usize] -= w;
        }
    }
    for i in 0..n {
        let p = if s.pb_has[i] != 0 { js_max(COND_P0, s.pb_v[i]) } else { s.fallback_p[i] };
        let h = if s.hb_has[i] != 0 { s.hb_v[i] } else { s.fallback_h[i] };
        let m = if s.mb_has[i] != 0 { Some(s.mb_v[i]) } else { None };
        let mk = m.unwrap_or(-1.0);
        if p == fs.lp[i] && h == fs.lh[i] && mk == fs.lm[i] {
            continue;
        }
        fs.lp[i] = p;
        fs.lh[i] = h;
        fs.lm[i] = mk;
        let c = &curves[st.curve_of[i] as usize];
        mix_state(c, p, h, scratch3);
        fs.p[i] = p;
        fs.rho[i] = scratch3[MX_RHO];
        fs.x[i] = scratch3[MX_X];
        fs.b[i] = scratch3[MX_B];
        // A RUN is a full pipe: what it carries IS its holdup.
        fs.rho_d[i] = match m {
            Some(m) if st.vol[i] > 0.0 && st.run_mask[i] != 0 => m / st.vol[i],
            _ => scratch3[MX_RHO],
        };
        fs.wet[i] = if net_node_dry(m, st.vol[i], scratch3[MX_RHO])
            && fed_in[i] * NET_DT <= DRY_FRAC * st.vol[i] * scratch3[MX_RHO]
        {
            0
        } else {
            1
        };
        fs.mu[i] = mu_mix_of(c, scratch3[MX_X]);
    }
    for &gi in &st.gas_nodes {
        let i = gi as usize;
        let c = &curves[st.curve_of[i] as usize];
        fs.rho_g[i] = rhog_of(c, sat_t(c, fs.p[i]));
    }
    for &li in &st.liq_nodes {
        let i = li as usize;
        let c = &curves[st.curve_of[i] as usize];
        fs.rho_l[i] = rhof_of(c, sat_t(c, fs.p[i]));
    }
    // The pool's own surface, not (p,h).
    if !st.cond_v.is_empty() {
        fs.void_.fill(0);
        for (k, &cv) in st.cond_v.iter().enumerate() {
            let i = cv as usize;
            if let Some(lvl) = s.pool_lvl[k] {
                if lvl < 100.0 {
                    fs.void_[i] = 1;
                }
                if lvl > 0.0 {
                    let c = &curves[st.curve_of[i] as usize];
                    fs.rho_d[i] = rhof_of(c, sat_t(c, fs.p[i]));
                }
            }
        }
    }
    // Containment never donates.
    for i in 0..n {
        if st.cont_mask[i] != 0 {
            fs.wet[i] = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_edges() {
        assert!(net_node_dry(Some(1e-9), 1.0, 1000.0));
        assert!(!net_node_dry(Some(2.0), 1.0, 1000.0));
        assert!(!net_node_dry(None, 1.0, 1000.0));
        assert!(!net_node_dry(Some(f64::NAN), 1.0, 1000.0));
        // Near-vacuum holds a milligram and is not spent.
        assert!(!net_node_dry(Some(1e-9), 1e-12, 1000.0));
    }
}
