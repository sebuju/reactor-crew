//! Commission-frozen tables the tick reads and never writes. The browser
//! builds these once at commission (`sim_freeze`); native harnesses load
//! the same shape from `tail-frozen.json`.
use std::collections::HashMap;

use crate::netlive::MatRegions;

#[derive(Default)]
pub struct TailFrozen {
    pub cont_cell: HashMap<usize, (i32, i32)>,
    pub part_of_node: HashMap<usize, String>,
    pub sec_t: Vec<u32>,
    pub sec_t_parts: Vec<String>,
    pub cond_parts: Vec<String>,
    pub tank_id_by_node: HashMap<usize, String>,
    pub loop_nodes: HashMap<i32, Option<Vec<String>>>,
    pub steam_breaks: Vec<SteamBreak>,
    pub regions: MatRegions,
    pub core_net_ref: HashMap<String, f64>,
    pub core_k_net_ref: HashMap<String, f64>,
    pub trans_circs: Vec<i32>,
    pub trans_nids: Vec<Vec<String>>,
    pub trans_rise_e: Vec<u32>,
    pub fit_bore_mm: HashMap<String, f64>,
    pub run_bore_mm: HashMap<String, f64>,
    /// `reliefNodeOf` per fitting: a PORV is not in `reliefIds` and the
    /// valve-pressure signal still has to find its node.
    pub fit_node: HashMap<String, String>,
    pub nodes_of_part: Vec<(String, Vec<u32>)>,
    pub dgen: f64,
    /// `P.eff` and `layoutMetrics().pzrK`: commission scalars the advect
    /// source prices work and pressuriser programme through.
    pub eff: f64,
    pub pzr_k: f64,
    /// `P.hTurb`: the turbine's enthalpy drop at the design backpressure.
    /// Commission-only — a drum plant has no `sgDesignP()` to derive it from.
    pub h_turb: f64,
    pub cond_ua: HashMap<String, f64>,
    pub cond_mass: HashMap<String, f64>,
    pub cw_ref: HashMap<String, f64>,
    /// Commission `net.pcSig`: the piece memo's seed key. A derived S0 sig
    /// forces the wrong cache answer on tick 0.
    pub pc_sig: String,
    pub nat_tick: u64,
    pub nat_pby_v: Vec<f64>,
    pub nat_pby_has: Vec<u8>,
    pub nat_loop: Vec<f64>,
    pub scr_metal_qv: Vec<f64>,
    pub scr_metal_qm: Vec<u8>,
    pub run_ends: HashMap<String, (String, String)>,
    pub node_run_key: HashMap<String, String>,
    pub cont_order: Vec<u32>,
}

/// Suggested bore of a fitting with no runs and no shells, in mm: both
/// `fitBoreSuggest` branches floor there, so an unknown fid reads it.
pub const FIT_BORE0: f64 = 412.5;

#[derive(Default)]
pub struct SteamBreak {
    pub cells: Vec<(i32, i32)>,
    pub exh: bool,
}

impl TailFrozen {
    /// `secT` as the `(node, part)` pairs the sec-pin reader takes.
    pub fn sec_t_pairs(&self) -> Vec<(u32, String)> {
        self.sec_t.iter().zip(self.sec_t_parts.iter()).map(|(&n, p)| (n, p.clone())).collect()
    }
}
