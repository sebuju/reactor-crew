//! Secondary side + tick actuators + burst dice, ported from the §6.6
//! extractions in `src/sim/step.js` (`actFollow` … `secTankStep`).
//!
//! Rules: identical IEEE op order to the JS; `Math.max/min` NaN semantics
//! via `eos::js_max/js_min`; transcendentals via `libm` (sdig class —
//! `pow`/`exp` flow through UA laws, NTU, `condPoolT`'s bisection).
//! Dead tick-locals (`dump`, `flowFrac`, `spillSecKg`, `vented`,
//! `boiled`/`boilQ`) are not computed: pure reads with no state effect.
//! Plant-coupled reads arrive pre-evaluated (dump-kit, like earlier gates):
//! solved outs as resolved values, field bags, transport artifacts, piece
//! masks, structural tables. `logE` sites record `(sev, code)` (`tick.rs`).

use crate::eos::{clamp, h_of_t, hfg_of, js_max, js_min, rhof_of, rhog_of, sat_h, sat_hg, sat_t, t_of_h, x_of_h, Curve, CurveTab, CURVE_LO};
use crate::tick::*;

/// Curve-tab lerp helpers mirroring `condXAt`/`condHAt` (`step.js`).
fn tab_lerp(a: &[f64; 2048], tab: &CurveTab, temp: f64) -> f64 {
    let u = (temp - CURVE_LO) * tab.inv;
    let i = u as usize;
    let w = u - i as f64;
    a[i] + (a[i + 1] - a[i]) * w
}

fn tab_of(c: &Curve) -> Option<&CurveTab> {
    c.tab.as_ref()
}

fn curve_hi(c: &Curve) -> f64 {
    match tab_of(c) {
        Some(tb) => tb.hi,
        None => {
            if c.tc != 0.0 && !c.tc.is_nan() {
                c.tc - 1.0
            } else {
                let t = if c.tref != 0.0 && !c.tref.is_nan() {
                    c.tref
                } else if c.t0 != 0.0 && !c.t0.is_nan() {
                    c.t0
                } else {
                    1.0
                };
                t * 1.5
            }
        }
    }
}

fn cond_x_at(c: &Curve, m: f64, v: f64, t: f64) -> f64 {
    let (rf, rg) = match tab_of(c) {
        Some(tb) if t > CURVE_LO && t < tb.hi => (tab_lerp(&tb.rf, tb, t), tab_lerp(&tb.rg, tb, t)),
        _ => (crate::eos::rhof_raw(c, t), crate::eos::rhog_raw(c, t)),
    };
    clamp(rg * (v - m / rf) / js_max(1e-12, m * (1.0 - rg / rf)), 0.0, 1.0)
}

fn cond_h_at(c: &Curve, m: f64, v: f64, t: f64) -> f64 {
    let hfg = match tab_of(c) {
        Some(tb) if t > CURVE_LO && t < tb.hi => tab_lerp(&tb.hfg, tb, t),
        _ => crate::eos::hfg_raw(c, t),
    };
    h_of_t(c, t) + cond_x_at(c, m, v, t) * hfg
}
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// constants (mirror the JS `const`s; asserted per preset by the gate)
// ---------------------------------------------------------------------------

pub const VALVE_RATE: f64 = 1.0 / 17.0;
pub const LOAD_TAU: f64 = 2.0;
pub const FLOW_TAU: f64 = 5.0;
pub const PUMP_FRIC_S: f64 = 60.0;
pub const CAV_TAU: f64 = 1.5;
pub const CAV_SPAN: f64 = 12.0;
pub const BOR_IN: f64 = 60.0;
pub const BOR_OUT: f64 = 35.0;
pub const CORE_DT_QMIN: f64 = 0.004;
pub const COND_P0: f64 = 0.004;
pub const COND_ATM: f64 = 0.101;
pub const TURB_TRIP_P: f64 = 0.02;
pub const TURB_RESET_K: f64 = 0.75;
pub const RAD_TDES: f64 = 307.0;
pub const T_SPACE: f64 = 3.0;
pub const SGTR_RATE: f64 = 0.30;
pub const HOT_DUMP: f64 = 1.6;
pub const UA_FLOW: f64 = 0.8;
pub const H_DATUM: f64 = 273.15;
pub const TANK_RATE_REF: f64 = 2.6;
pub const T_FEED: f64 = 490.0;
pub const NET_DT: f64 = 0.02;
pub const SG_BURST_K: f64 = 1.5;
pub const PIPE_BURST_K: f64 = 1.5;
pub const PORV_LIFT_K: f64 = 1.06;
pub const PORV_RESEAT_K: f64 = 1.01;
pub const LEDGER_EPS: f64 = 1e-7;
pub const LEDGER_QUIET: f64 = 30.0;
pub const CP_STEEL: f64 = 0.5;

// FLUID table (`pipenet.js`): dens + act (+boron unused on tick path).
pub fn fluid_dens(key: &str) -> f64 {
    match key {
        "borated" => 1000.0,
        "condensate" => 1000.0,
        "contaminated" => 1000.0,
        "helium" => 11.0,
        _ => 1000.0,
    }
}
pub fn fluid_act(key: &str) -> f64 {
    match key {
        "contaminated" => 1.0,
        _ => 0.0,
    }
}

// ---------------------------------------------------------------------------
// structural inputs (per preset; resolved by the dumper off the live plant)
// ---------------------------------------------------------------------------

/// One tank row: the `D.tanks[tid]` fields the tick reads.
#[derive(Clone)]
pub struct TankRow {
    pub vol: f64,
    pub level: f64,
    pub fluid: String,
    pub hold: bool,
    pub hold_p: Option<f64>,
    pub inf: bool,
    pub cell: bool,
    pub gas_p0: Option<f64>,
    pub burst: Option<TankBurst>,
    pub auto: String,
    pub in_field: bool,
    pub primary: bool,
    pub circuit: i32,
}

/// Rupture-disc row (`D.tanks[tid].burst`).
#[derive(Clone)]
pub struct TankBurst {
    pub at: f64,
    pub drain: f64,
    pub rel: f64,
}

/// One relief fitting row.
#[derive(Clone)]
pub struct FitRow {
    pub lift: f64,
    pub reseat: f64,
    pub spring: bool,
    pub has_target: bool,
}

/// Part cells for `regionPAt` + damage sweeps (events reuses this table).
#[derive(Clone)]
pub struct PartRow {
    pub id: String,
    pub role: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Per-preset structural tables + scalar consts.
pub struct SecMeta {
    pub core_ids: Vec<String>,
    pub circ_of_core: Vec<i32>,
    pub core_inv_kg0: Vec<f64>,
    pub circ_key_of: Vec<Option<String>>,
    pub core_circ: i32,
    pub core_circs: Vec<bool>,
    pub backup: f64,
    pub hold_circs: Vec<i32>,
    pub hold_on_circ: Vec<Vec<String>>,
    pub drum_ids: Vec<String>,
    pub boiler_ids: Vec<String>,
    pub sg_ids: Vec<String>,
    pub sg_loop: Vec<i32>,
    pub pump_ids: Vec<String>,
    pub primary_pump: Vec<bool>,
    pub pump_res: Vec<Vec<String>>,
    pub pump_suc: Vec<Option<String>>,
    pub pump_edge: Vec<Option<String>>,
    pub pump_rotor: Vec<f64>,
    pub part_ids: Vec<String>,
    pub sg_efw_off: f64,
    pub sg_dry: f64,
    pub sgl_set: f64,
    pub sg_dome: f64,
    pub boiler_node: Vec<String>,
    pub boiler_circ: Vec<i32>,
    pub feed_node: Vec<String>,
    pub edge_gas_at: Vec<i32>,
    pub edge_u: Vec<i32>,
    pub edge_kind: Vec<String>,
    pub edge_key: Vec<String>,
    pub cond_break_keys: Vec<String>,
    pub tank_auto: Vec<String>,
    pub cond_ids: Vec<String>,
    pub cond_sinks: Vec<String>,
    pub cond_in_a: Vec<Option<String>>,
    pub cond_vacuum: Vec<bool>,
    pub cond_vol: Vec<f64>,
    pub cw_paths: Vec<Vec<(String, String, String)>>,
    pub rad_ids: Vec<String>,
    pub rad_ua: Vec<f64>,
    pub rad_mass: Vec<f64>,
    pub part_vol: Vec<f64>,
    pub rad_coat_emis: Vec<f64>,
    pub rad_area: Vec<f64>,
    pub ihx_ids: Vec<String>,
    pub ihx_ua: Vec<f64>,
    pub tick_rad_key: Vec<String>,
    pub rad_internal: Vec<(String, String)>,
    pub rad_live: Vec<bool>,
    pub sg_active_sg: Vec<bool>,
    pub sg_active_ihx: Vec<bool>,
    pub prompt_f: f64,
    pub sg_ua: Vec<f64>,
    pub sg_design_p: Vec<f64>,
    pub sg_mass: Vec<f64>,
    pub sg_burst_p: Vec<f64>,
    pub sg_active: Vec<bool>,
    pub shell_node: Vec<String>,
    pub shell_circ: Vec<i32>,
    pub sg_prim_circ: Vec<i32>,
    pub prim_faces: HashMap<String, (String, String)>,
    pub dry_min_kg: f64,
    pub dose: f64,
    pub in_core_node: Vec<bool>,
    pub net_vol: Vec<f64>,
    pub hold_line: Vec<String>,
    pub cond_role_part: Option<usize>,
    pub cond_p_des: f64,
    pub region_of: Vec<i32>,
    pub n_regions: usize,
    pub gw: usize,
    pub gh: usize,
    pub cond_ves_node: Vec<String>,
    pub is_drum: Vec<bool>,
    pub sgtr_key: Vec<String>,
    pub stage_keys: HashMap<String, (Option<String>, Option<String>)>,
    pub stage_in_nbr: HashMap<String, (Vec<i32>, Vec<i32>)>,
    pub tank_ids: Vec<String>,
    pub tanks: Vec<TankRow>,
    pub tank_kg: Vec<f64>,
    pub tank_node: Vec<String>,
    pub break_key: Vec<String>,
    pub tank_gone: Vec<bool>,
    pub tank_primary: Vec<bool>,
    pub primary_core: String,
    pub core_on_circ: Vec<Vec<String>>,
    pub core_piece_node: i32,
    pub sec_tank_ids: Vec<usize>,
    pub hold_tank_ids: Vec<usize>,
    pub relief_ids: Vec<String>,
    pub relief_pri: Vec<usize>,
    pub relief_sec: Vec<String>,
    pub relief_node: Vec<String>,
    pub fits: Vec<FitRow>,
    pub vent_key: Vec<Option<String>>,
    pub out_keys: Vec<String>,
    pub out_pos: HashMap<String, usize>,
    pub part_of: HashMap<String, usize>,
    pub shells_of: HashMap<String, Vec<String>>,
    pub by_keys: Vec<String>,
    pub sgtr_keys: Vec<String>,
    pub net_ref_by_run: HashMap<String, f64>,
    pub pipe_runs: Vec<PipeRun>,
    pub run_rating: Vec<f64>,
    pub run_node: Vec<String>,
    pub wall_cells: Vec<WallCell>,
    pub net_names: Vec<String>,
    pub net_index: HashMap<String, usize>,
    pub net_vapour: Vec<u8>,
    pub net_booked: Vec<u8>,
    pub circ_of_node: Vec<i32>,
    pub loop_nodes_n: usize,
    pub fold_map: HashMap<String, String>,
    pub core_piece_nodes: Vec<i32>,
    pub parts: Vec<PartRow>,
    pub fire_rows: HashMap<String, FireRow>,
    pub circ_burn: Vec<Option<String>>,
    pub steam_rise: f64,
    pub room_steam_h: f64,
    pub loop_kg: f64,
    pub core_dt0: f64,
    pub p0: f64,
    pub pcont: f64,
    pub tref: f64,
    pub rated: f64,
    pub flow_k: f64,
    pub flow_min: f64,
    pub inv_kg0: f64,
    pub p_sat_cp: f64,
}

/// One pipe run for the burst dice.
#[derive(Clone)]
pub struct PipeRun {
    pub key: String,
    pub cells: Vec<(i32, i32)>,
}

/// One wall-lotto cell.
#[derive(Clone)]
pub struct WallCell {
    pub k: String,
    pub x: i32,
    pub y: i32,
    pub tight: bool,
    pub burst_p: f64,
}

/// Sodium-fire row (`FIRE[burn]`).
#[derive(Clone)]
pub struct FireRow {
    pub wlhv: f64,
    pub wh2: f64,
    pub wh2o: f64,
    pub wast: f64,
    pub wast_max: f64,
}

// ---------------------------------------------------------------------------
// live state (owned; probe fills pre, replay mutates, probe compares post)
// ---------------------------------------------------------------------------

/// String→f64 bag that preserves insertion order for exact comparison.
#[derive(Clone, Default)]
pub struct SMap {
    pub keys: Vec<String>,
    pub vals: Vec<f64>,
}

impl SMap {
    pub fn get(&self, k: &str) -> Option<f64> {
        self.keys.iter().position(|x| x == k).map(|i| self.vals[i])
    }
    pub fn set(&mut self, k: &str, v: f64) {
        match self.keys.iter().position(|x| x == k) {
            Some(i) => self.vals[i] = v,
            None => {
                self.keys.push(k.to_string());
                self.vals.push(v);
            }
        }
    }
    pub fn del(&mut self, k: &str) {
        if let Some(i) = self.keys.iter().position(|x| x == k) {
            self.keys.remove(i);
            self.vals.remove(i);
        }
    }
    pub fn has(&self, k: &str) -> bool {
        self.keys.iter().any(|x| x == k)
    }
}

#[derive(Clone, Default)]
pub struct SMapB {
    pub keys: Vec<String>,
    pub vals: Vec<u8>,
}

impl SMapB {
    pub fn get(&self, k: &str) -> bool {
        self.keys.iter().position(|x| x == k).map(|i| self.vals[i] != 0).unwrap_or(false)
    }
    pub fn del(&mut self, k: &str) {
        if let Some(i) = self.keys.iter().position(|x| x == k) {
            self.keys.remove(i);
            self.vals.remove(i);
        }
    }
    pub fn set(&mut self, k: &str, v: bool) {
        match self.keys.iter().position(|x| x == k) {
            Some(i) => self.vals[i] = v as u8,
            None => {
                self.keys.push(k.to_string());
                self.vals.push(v as u8);
            }
        }
    }
}

/// Relief valve cells (open/auto/stuck/arm/blocked).
#[derive(Clone, Default)]
pub struct ReliefCell {
    pub open: bool,
    pub auto: bool,
    pub stuck: bool,
    pub arm: bool,
    pub blocked: bool,
}

/// Minimal per-core state the secondary writes (`pcoreStep`, `marginStep`).
#[derive(Clone, Default)]
pub struct SecCore {
    pub p_core: f64,
    pub flow_net: f64,
}

/// The mutable secondary state for one replay.
#[derive(Clone, Default)]
pub struct SecState {
    pub f64s: HashMap<String, f64>,
    pub u8s: HashMap<String, bool>,
    pub strings: HashMap<String, String>,
    pub maps: HashMap<String, SMap>,
    pub bmaps: HashMap<String, SMapB>,
    pub bags: HashMap<String, Bag>,
    pub relief: HashMap<String, ReliefCell>,
    pub cores: HashMap<String, SecCore>,
    pub dmg_parts: Vec<String>,
    pub dmg_why: HashMap<String, String>,
    pub mass_out: HashMap<String, f64>,
    pub mass_out_order: Vec<String>,
    pub heatbal: HeatBal,
    pub pump_live: Vec<String>,
    pub net_burst_p: HashMap<String, f64>,
    pub seed: u32,
    pub rng: i32,
    pub dice_off: bool,
    pub tank_byp: HashMap<String, bool>,
    pub tank_dump: HashMap<String, bool>,
    pub ref_open: bool,
    pub net_burst_gen: f64,
    pub room_p: Vec<f64>,
    pub room_water: Vec<f64>,
    pub room_wp: Vec<f64>,
    pub room_pool: Vec<f64>,
    pub room_pool_p: Vec<f64>,
}

#[derive(Clone, Default)]
pub struct HeatBal {
    pub prompt: f64,
    pub decay: f64,
    pub heat: f64,
    pub removal: f64,
    pub d_tavg: f64,
    pub sg_q_by: SMap,
    pub heat_by: SMap,
}

impl SecState {
    pub fn f(&self, k: &str) -> f64 {
        self.f64s.get(k).copied().unwrap_or(f64::NAN)
    }
    pub fn set_f(&mut self, k: &str, v: f64) {
        self.f64s.insert(k.to_string(), v);
    }
    pub fn b(&self, k: &str) -> bool {
        self.u8s.get(k).copied().unwrap_or(false)
    }
    pub fn set_b(&mut self, k: &str, v: bool) {
        self.u8s.insert(k.to_string(), v);
    }
    pub fn map(&self, k: &str) -> SMap {
        self.maps.get(k).cloned().unwrap_or_default()
    }
    pub fn map_mut(&mut self, k: &str) -> &mut SMap {
        self.maps.entry(k.to_string()).or_default()
    }
    pub fn bag(&self, k: &str) -> Bag {
        self.bags.get(k).cloned().unwrap_or(Bag { v: vec![], has: vec![] })
    }
    pub fn bag_mut(&mut self, k: &str) -> &mut Bag {
        self.bags.entry(k.to_string()).or_insert(Bag { v: vec![], has: vec![] })
    }
}

// ---------------------------------------------------------------------------
// per-sample inputs (dump-kit: solved/transport artifacts + masks + reads)
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct SecIn {
    pub dt: f64,
    pub sc_v: [f64; 7],
    pub by_vals: HashMap<String, f64>,
    pub by_typed: bool,
    pub by_v: Vec<f64>,
    pub q_tank: HashMap<String, f64>,
    pub relief_v: HashMap<String, f64>,
    pub sgtr_v: Vec<f64>,
    pub sgtr_by: HashMap<String, f64>,
    pub sgtr_typed: bool,
    pub sg_feed: HashMap<String, f64>,
    pub sg_steam: HashMap<String, f64>,
    pub by_loop: HashMap<String, f64>,
    pub run_flow_keys: Vec<String>,
    pub run_flow_vals: Vec<f64>,
    pub advect_out_pri: f64,
    pub advect_out_sec: f64,
    pub advect_landed: HashMap<String, f64>,
    pub advect_edge_kg: Vec<f64>,
    pub out_kg: HashMap<String, f64>,
    pub shells_live: HashMap<String, Vec<String>>,
    pub vent_edges: Vec<(String, f64)>,
    pub dgen: f64,
    pub net_burst_gen: f64,
    pub m_by_piece: Vec<i32>,
    pub core_piece: i32,
    pub core_pieces: Vec<i32>,
    pub cont_rel: HashMap<String, f64>,
    pub role_turb_alive: i32,
    pub core_heat: HashMap<String, f64>,
    pub in_loop_bits: Vec<Vec<bool>>,
    pub hold_live: Vec<bool>,
    pub stage_fed: Vec<bool>,
    pub tank_p: Vec<f64>,
    pub core_fn: HashMap<String, f64>,
    pub exh_open: bool,
    pub feed_in_mv: Vec<f64>,
    pub feed_in_hv: Vec<f64>,
    pub feed_in_hm: Vec<u8>,
}

// ---------------------------------------------------------------------------
// replay outputs
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct SecOut {
    pub inj: f64,
    pub inj_ids: Vec<String>,
    pub cav_ids: Vec<String>,
    pub sec_vent: HashMap<String, f64>,
    pub p_cond: f64,
    pub bleed_all: f64,
    pub events: Vec<LogEv>,
    pub warns: u32,
}

// ---------------------------------------------------------------------------
// small readers
// ---------------------------------------------------------------------------



/// Per-circuit curves for the readers.
pub struct SecCurves {
    pub curves: Vec<Curve>,
    pub water: Curve,
    pub set_p: Vec<f64>,
}

impl SecCurves {
    pub fn of(&self, ci: i32) -> &Curve {
        if ci >= 0 {
            if let Some(c) = self.curves.get(ci as usize) {
                return c;
            }
        }
        &self.water
    }
    pub fn set_p(&self, ci: i32) -> f64 {
        if ci >= 0 {
            if let Some(v) = self.set_p.get(ci as usize) {
                return *v;
            }
        }
        0.0
    }
}

// ---------------------------------------------------------------------------
// replay context: structural meta + curves + live state + dump-kit inputs
// ---------------------------------------------------------------------------

pub struct Cx<'a> {
    pub meta: &'a SecMeta,
    pub curves: &'a SecCurves,
    pub st: &'a mut SecState,
    pub inp: &'a SecIn,
    pub ev: &'a mut Vec<LogEv>,
    pub warns: &'a mut u32,
}

impl<'a> Cx<'a> {
    pub fn log(&mut self, sev: u8, code: u32) {
        self.ev.push(LogEv { sev, code });
    }
    pub fn book(&mut self, name: &str, kg: f64) {
        if kg != 0.0 {
            if !self.st.mass_out.contains_key(name) {
                self.st.mass_out_order.push(name.to_string());
            }
            book(&mut self.st.mass_out, name, kg);
        }
    }
    /// `coreFold` off the dumped fold map.
    pub fn fold<'b>(&self, raw: &'b str) -> &'b str
    where
        'a: 'b,
    {
        match self.meta.fold_map.get(raw) {
            Some(s) => s.as_str(),
            None => raw,
        }
    }
    /// `circOfNode` off the dumped per-node table.
    pub fn circ_of(&self, nid: &str) -> i32 {
        self.meta.net_index.get(nid).and_then(|i| self.meta.circ_of_node.get(*i)).copied().unwrap_or(-1)
    }
    /// bag read `pfAt`.
    pub fn pf(&self, bag: &str, nid: &str) -> Option<f64> {
        let i = self.meta.net_index.get(nid)?;
        self.st.bags.get(bag).and_then(|b| b.get(*i))
    }
    pub fn pf_set(&mut self, bag: &str, nid: &str, v: f64) {
        if let Some(i) = self.meta.net_index.get(nid).copied() {
            self.st.bag_mut(bag).set(i, v);
        }
    }
    /// `netPAt`.
    pub fn net_p_at(&self, nid: &str) -> f64 {
        if let Some(v) = self.pf("pBy", nid) {
            return js_max(COND_P0, v);
        }
        let c = self.curves.set_p(self.circ_of(nid));
        js_max(COND_P0, if c > 0.0 { c } else { self.st.f("P") })
    }
    /// `netHAt`.
    pub fn net_h_at(&self, nid: &str) -> f64 {
        if let Some(v) = self.pf("hBy", nid) {
            return v;
        }
        let ci = self.circ_of(nid);
        let c = self.curves.of(ci);
        if self.core_circs_of(ci) {
            return h_of_t(c, self.tavg_of(ci));
        }
        let p = self.net_p_at(nid);
        if self.vapour(nid) {
            sat_hg(c, p)
        } else {
            h_of_t(c, sat_t(c, p))
        }
    }
    pub fn net_temp_at(&self, nid: &str) -> f64 {
        let c = self.curves.of(self.circ_of(nid));
        t_of_h(c, self.net_p_at(nid), self.net_h_at(nid))
    }
    pub fn net_qual_at(&self, nid: &str) -> f64 {
        let c = self.curves.of(self.circ_of(nid));
        x_of_h(c, self.net_p_at(nid), self.net_h_at(nid))
    }
    pub fn net_rho_at(&self, nid: &str) -> f64 {
        let c = self.curves.of(self.circ_of(nid));
        crate::eos::rho_mix_of(c, self.net_p_at(nid), self.net_h_at(nid))
    }
    pub fn vapour(&self, nid: &str) -> bool {
        self.meta.net_index.get(nid).and_then(|i| self.meta.net_vapour.get(*i)).copied().unwrap_or(0) != 0
    }
    /// `tickPAt`.
    pub fn tick_p_at(&self, nid: &str) -> f64 {
        match self.pf("pBy", self.fold(nid)) {
            Some(v) => v,
            None => self.st.f("P"),
        }
    }
    /// `tickScAt`.
    pub fn tick_sc_at(&self, nid: &str) -> f64 {
        let folded = self.fold(nid).to_string();
        sat_t(self.curves.of(self.circ_of(&folded)), self.tick_p_at(nid)) - self.net_temp_at(nid)
    }
    pub fn circ_key(&self, ci: i32) -> Option<String> {
        if ci < 0 {
            return None;
        }
        self.meta.circ_key_of.get(ci as usize).and_then(|o| o.clone())
    }
    pub fn core_circs_of(&self, ci: i32) -> bool {
        ci >= 0 && self.meta.core_circs.get(ci as usize).copied().unwrap_or(false)
    }
    /// `loopP`.
    pub fn loop_p(&self, ci: i32) -> f64 {
        if let Some(k) = self.circ_key(ci) {
            if let Some(v) = self.st.maps.get("PBy").and_then(|m| m.get(&k)) {
                return v;
            }
        }
        if ci == self.meta.core_circ {
            let p = self.st.f("P");
            return if p.is_nan() { self.meta.p0 } else { p };
        }
        if self.core_circs_of(ci) {
            return self.curves.of(ci).p0;
        }
        self.meta.pcont
    }
    pub fn set_loop_p(&mut self, ci: i32, v: f64) {
        if let Some(k) = self.circ_key(ci) {
            self.st.map_mut("PBy").set(&k, v);
        }
        if ci == self.meta.core_circ {
            self.st.set_f("P", v);
        }
    }
    /// `TavgOf`.
    pub fn tavg_of(&self, ci: i32) -> f64 {
        if let Some(k) = self.circ_key(ci) {
            if let Some(v) = self.st.maps.get("TavgBy").and_then(|m| m.get(&k)) {
                return v;
            }
        }
        if ci == self.meta.core_circ {
            let t = self.st.f("Tavg");
            if !t.is_nan() {
                return t;
            }
        }
        let c = self.curves.of(ci);
        if c.tref.is_nan() { self.meta.tref } else { c.tref }
    }
    /// `holdLvlOf`.
    pub fn hold_lvl_of(&self, nid: &str) -> f64 {
        let ci = self.circ_of(nid);
        let c = self.curves.of(ci);
        let p = self.net_p_at(nid);
        let t = sat_t(c, p);
        let x = clamp(x_of_h(c, p, self.net_h_at(nid)), 0.0, 1.0);
        let rg = rhog_of(c, t);
        let rf = rhof_of(c, t);
        let vg = x / js_max(rg, 1e-9);
        let vf = (1.0 - x) / js_max(rf, 1e-9);
        100.0 * vf / js_max(vf + vg, 1e-12)
    }
    /// `holdSetP`.
    pub fn hold_set_p(&self, ci: i32) -> f64 {
        self.curves.set_p(ci)
    }
    /// `flowV` off the dumped run-flow holder.
    pub fn flow_v(&self, key: &str) -> f64 {
        self.inp.run_flow_vals.get(
            self.inp.run_flow_keys.iter().position(|k| k == key).unwrap_or(usize::MAX),
        ).copied().unwrap_or(0.0)
    }
    /// `tickRunRatio`.
    pub fn tick_run_ratio(&self, key: &str) -> f64 {
        let r = self.meta.net_ref_by_run.get(key).copied().unwrap_or(0.0).abs();
        if r > 1e-9 { self.flow_v(key) / r } else { 0.0 }
    }
    /// `outsNum` off the dumped scalar vector.
    pub fn outs_num(&self, i: usize) -> f64 {
        self.inp.sc_v.get(i).copied().unwrap_or(0.0)
    }
    /// `invRate` off the dumped loop inventory.
    pub fn inv_rate(&self, q: f64) -> f64 {
        if self.meta.loop_kg > 0.0 { 100.0 * q / self.meta.loop_kg } else { 0.0 }
    }
    /// `supplyK`.
    pub fn supply_k(&self) -> f64 {
        if self.st.b("blackout") {
            if self.st.b("bkpLost") { 0.0 } else { self.meta.backup }
        } else {
            1.0
        }
    }
    pub fn part_wrecked(&self, id: &str) -> bool {
        self.st.dmg_parts.iter().any(|x| x == id)
    }
    /// `tankOpen`.
    pub fn tank_open(&self, tid: &str, auto_live: bool) -> bool {
        if self.st.b("refOpen") {
            return true;
        }
        if self.st.maps.get("tankOpen").map(|m| m.get(tid).unwrap_or(0.0) != 0.0).unwrap_or(false) {
            return true;
        }
        if self.st.tank_byp.get(tid).copied().unwrap_or(false) {
            return false;
        }
        auto_live
    }
    /// `srand` verbatim, on the replayed rng word.
    pub fn srand(&mut self) -> f64 {
        srand_next(&mut self.st.rng)
    }
}

// ---------------------------------------------------------------------------
// `actFollow`: freg/valve motors + load lag.
// ---------------------------------------------------------------------------

pub fn act_follow(cx: &mut Cx) {
    let dt = cx.inp.dt;
    let freg: Vec<String> = cx.st.maps.get("fregBy").map(|m| m.keys.clone()).unwrap_or_default();
    for id in &freg {
        let dem = cx.st.maps.get("fregDemBy").and_then(|m| m.get(id));
        let cur = cx.st.maps.get("fregBy").and_then(|m| m.get(id)).unwrap_or(0.0);
        let dv = dem.unwrap_or(cur) - cur;
        // JS `if(dv)`: zero AND NaN both skip the motor.
        if dv != 0.0 && !dv.is_nan() {
            let step = js_sign(dv) * js_min(dv.abs(), VALVE_RATE * dt);
            cx.st.map_mut("fregBy").set(id, cur + step);
        }
    }
    let valves: Vec<String> = cx.st.maps.get("valve").map(|m| m.keys.clone()).unwrap_or_default();
    for id in &valves {
        let dem = cx.st.maps.get("valveDem").and_then(|m| m.get(id)).unwrap_or(f64::NAN);
        let cur = cx.st.maps.get("valve").and_then(|m| m.get(id)).unwrap_or(f64::NAN);
        let dv = dem - cur;
        // JS has no `if(dv)` here: the add always runs, so NaN poisons and
        // a zero dv is an exact no-op through the same code path.
        let step = js_sign(dv) * js_min(dv.abs(), VALVE_RATE * dt);
        cx.st.map_mut("valve").set(id, cur + step);
    }
    let load = cx.st.f("load");
    let load_dem = cx.st.f("loadDem");
    cx.st.set_f("load", load + (load_dem - load) * js_min(dt / LOAD_TAU, 1.0));
}

// ---------------------------------------------------------------------------
// `boronFollow`: boron actuator + core-piece boron seeding.
// ---------------------------------------------------------------------------

pub fn boron_follow(cx: &mut Cx) {
    let dt = cx.inp.dt;
    let db = cx.st.f("boronDem") - cx.st.f("boron");
    let rb = if db < 0.0 { BOR_IN } else { BOR_OUT } * dt;
    let d = js_sign(db) * js_min(db.abs(), rb);
    cx.st.set_f("boron", cx.st.f("boron") + d);
    if d != 0.0 {
        let n = cx.meta.net_names.len();
        for i in 0..n {
            let in_core = cx.inp.core_piece as usize;
            let of = cx.inp.m_by_piece.get(i).copied().unwrap_or(-1);
            let has = cx.st.bags.get("bBy").map(|b| b.has.get(i).copied().unwrap_or(0) != 0).unwrap_or(false);
            if of >= 0 && of as usize == in_core && has {
                let v = cx.st.bags.get("bBy").and_then(|b| b.v.get(i)).copied().unwrap_or(0.0);
                cx.st.bag_mut("bBy").set(i, v + d);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// `pcoreStep`: per-core solved pressure readout + plant `pCore`.
// ---------------------------------------------------------------------------

pub fn pcore_step(cx: &mut Cx) {
    for id in cx.meta.core_ids.clone() {
        let v = cx.tick_p_at(&id);
        if let Some(cs) = cx.st.cores.get_mut(&id) {
            cs.p_core = v;
        }
    }
    let pri = cx.meta.primary_core.clone();
    let v = cx.tick_p_at(&pri);
    cx.st.set_f("pCore", v);
}

// ---------------------------------------------------------------------------
// `pressRead`: loop pressures + hold-tank levels.
// ---------------------------------------------------------------------------

pub fn press_read(cx: &mut Cx) {
    let dt = cx.inp.dt;
    let core = cx.meta.core_circ;
    for ci in cx.meta.hold_circs.clone() {
        let hold0 = cx.meta.hold_on_circ.get(ci as usize).and_then(|v| v.first()).cloned();
        let own = cx.meta.core_on_circ.get(ci as usize).and_then(|v| v.first()).cloned();
        let dr = if hold0.is_none() {
            cx.meta.drum_ids.iter().find(|d| {
                cx.meta.tank_ids.iter().position(|t| t == *d).and_then(|ti| cx.meta.tanks.get(ti).map(|t| t.circuit)).unwrap_or(-2) == ci
            }).cloned()
        } else {
            None
        };
        let nid = match (&hold0, &dr, &own) {
            (Some(id), _, _) => Some(cx.fold(id).to_string()),
            (None, Some(d), _) => Some(cx.fold(d).to_string()),
            (None, None, Some(o)) => Some(cx.fold(o).to_string()),
            _ => None,
        };
        let readable = nid.as_ref().and_then(|n| cx.meta.net_index.get(n)).is_some();
        if nid.is_none() || !readable {
            let fb = own.clone().unwrap_or_else(|| cx.meta.primary_core.clone());
            let rp = cx.region_p_at_opt(cx.part_of(&fb));
            cx.set_loop_p(ci, rp);
            continue;
        }
        let nid = nid.unwrap();
        cx.set_loop_p(ci, cx.net_p_at(&nid));
        if let Some(id) = hold0 {
            let was = cx.st.maps.get("lvlBy").and_then(|m| m.get(&id)).unwrap_or_else(|| cx.st.f("lvl"));
            let lvl = clamp(cx.hold_lvl_of(&nid), 0.0, 100.0);
            let dlvl = if dt > 0.0 { (lvl - was) / dt } else { 0.0 };
            cx.st.map_mut("lvlBy").set(&id, lvl);
            cx.st.map_mut("dLvlBy").set(&id, dlvl);
            if ci == core {
                cx.st.set_f("lvl", lvl);
                cx.st.set_f("dLvl", dlvl);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// `spillStep`: opening outflows + plant spill rate.
// ---------------------------------------------------------------------------

pub fn spill_step(cx: &mut Cx) {
    let spill = cx.inv_rate(cx.outs_num(4));
    if cx.inp.by_typed {
        for (bj, k) in cx.meta.by_keys.clone().iter().enumerate() {
            let raw = cx.inp.by_v.get(bj).copied().unwrap_or(0.0);
            let v = cx.inv_rate(raw);
            cx.st.map_mut("spillBy").set(k, v);
        }
        let keep: HashSet<String> = cx.meta.by_keys.iter().cloned().collect();
        let dead: Vec<String> = cx.st.maps.get("spillBy").map(|m| m.keys.iter().filter(|k| !keep.contains(*k)).cloned().collect()).unwrap_or_default();
        for k in dead {
            cx.st.map_mut("spillBy").del(&k);
        }
    } else {
        let keys: Vec<String> = cx.inp.by_vals.keys().cloned().collect();
        let cur: Vec<String> = cx.st.maps.get("spillBy").map(|m| m.keys.clone()).unwrap_or_default();
        for k in cur {
            if !cx.inp.by_vals.contains_key(&k) {
                cx.st.map_mut("spillBy").del(&k);
            }
        }
        for k in keys {
            let raw = cx.inp.by_vals.get(&k).copied().unwrap_or(0.0);
            let v = cx.inv_rate(raw);
            cx.st.map_mut("spillBy").set(&k, v);
        }
    }
    cx.st.set_f("spillRate", spill);
}

// ---------------------------------------------------------------------------
// `tankRateStep`: per-tank solved push + injection sum.
// ---------------------------------------------------------------------------

pub fn tank_rate_step(cx: &mut Cx) -> (f64, Vec<String>) {
    let mut inj = 0.0;
    let mut ids = vec![];
    for (ti, tid) in cx.meta.tank_ids.iter().enumerate() {
        if cx.meta.tank_gone.get(ti).copied().unwrap_or(false) {
            cx.st.map_mut("tankRate").del(tid);
            continue;
        }
        let q = cx.inv_rate(cx.inp.q_tank.get(tid).copied().unwrap_or(0.0));
        cx.st.map_mut("tankRate").set(tid, q);
        if cx.meta.tank_primary.get(ti).copied().unwrap_or(false) && q > 1e-6 * TANK_RATE_REF {
            inj += q;
            ids.push(tid.clone());
        }
    }
    (inj, ids)
}

// ---------------------------------------------------------------------------
// `invStep`: inventory reads.
// ---------------------------------------------------------------------------

pub fn inv_nodes_kg(cx: &Cx, cid: Option<i32>) -> f64 {
    // The piece OF the core's node, not the node position itself.
    let np = match cid {
        Some(id) => cx.meta.core_piece_nodes.get(id as usize).copied().unwrap_or(cx.meta.core_piece_node),
        None => cx.meta.core_piece_node,
    };
    let c = if np >= 0 {
        cx.inp.m_by_piece.get(np as usize).copied().unwrap_or(-1)
    } else {
        -1
    };
    let ci = match cid {
        Some(id) => cx.meta.circ_of_core.get(id as usize).copied().unwrap_or(cx.meta.core_circ),
        None => cx.meta.core_circ,
    };
    let mut m = 0.0;
    for i in 0..cx.meta.net_names.len() {
        if cx.meta.net_booked.get(i).copied().unwrap_or(0) != 0 {
            continue;
        }
        if cx.inp.m_by_piece.get(i).copied().unwrap_or(-1) != c {
            continue;
        }
        if ci >= 0 && !cx.inp.in_loop_bits.get(ci as usize).and_then(|b| b.get(i)).copied().unwrap_or(true) {
            continue;
        }
        if let Some(b) = cx.st.bags.get("mBy") {
            if b.has.get(i).copied().unwrap_or(0) != 0 {
                m += b.v.get(i).copied().unwrap_or(0.0);
            }
        }
    }
    m
}

pub fn inv_step(cx: &mut Cx) {
    if cx.meta.inv_kg0 > 0.0 {
        cx.st.set_f("inv", 100.0 * inv_nodes_kg(cx, None) / cx.meta.inv_kg0);
    }
    for ci in 0..cx.meta.core_ids.len() {
        let c = cx.meta.circ_of_core.get(ci).copied().unwrap_or(cx.meta.core_circ);
        let key = cx.circ_key(c).unwrap_or_default();
        // Scaled by the CORE's own K.invKg0; a non-positive one stays unwritten.
        let inv0 = cx.meta.core_inv_kg0.get(ci).copied().unwrap_or(cx.meta.inv_kg0);
        if inv0 > 0.0 {
            let v = 100.0 * inv_nodes_kg(cx, Some(ci as i32)) / inv0;
            cx.st.map_mut("invBy").set(&key, v);
        }
    }
}

// ---------------------------------------------------------------------------
// `cavStep`: pump cavitation fill + worst readout.
// ---------------------------------------------------------------------------

pub fn cav_step(cx: &mut Cx) -> Vec<String> {
    let dt = cx.inp.dt;
    let mut ids = vec![];
    let mut worst = 0.0;
    // prune dead keys first (read-only pass over a snapshot of keys)
    let cur: Vec<String> = cx.st.maps.get("cavP").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("cavP").del(&k);
        }
    }
    let kc = js_min(dt / CAV_TAU, 1.0);
    for pid in cx.meta.pump_ids.clone() {
        let pi = cx.meta.pump_ids.iter().position(|p| p == &pid).unwrap();
        let suc = cx.meta.pump_suc.get(pi).and_then(|o| o.clone()).unwrap_or_default();
        let want = clamp(-cx.tick_sc_at(&suc) / CAV_SPAN, 0.0, 1.0);
        let cur_v = match cx.st.maps.get("cavP").and_then(|m| m.get(&pid)) {
            Some(v) => v,
            None => {
                cx.st.map_mut("cavP").set(&pid, want);
                want
            }
        };
        let v = cur_v + (want - cur_v) * kc;
        cx.st.map_mut("cavP").set(&pid, v);
        if v > worst {
            worst = v;
        }
        if v > 0.15 {
            ids.push(pid);
        }
    }
    cx.st.set_f("cav", worst);
    ids
}

// ---------------------------------------------------------------------------
// `pumpQStep`: per-pump casing-edge flow readout.
// ---------------------------------------------------------------------------

pub fn pump_q_step(cx: &mut Cx) {
    let cur: Vec<String> = cx.st.maps.get("pumpQBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("pumpQBy").del(&k);
        }
    }
    for (pi, pid) in cx.meta.pump_ids.clone().iter().enumerate() {
        let key = cx.meta.pump_edge.get(pi).and_then(|o| o.clone());
        let Some(k) = key else { continue };
        let q = cx.flow_v(&k);
        cx.st.map_mut("pumpQBy").set(pid, if q > 0.0 { q.abs() } else { 0.0 });
    }
}

// ---------------------------------------------------------------------------
// AUTORULE rows + `tankOpen` + `sglMin`/`boilerLvl`/`sgLvl`.
// ---------------------------------------------------------------------------

fn autorule_live(cx: &Cx, auto: &str, tid: &str) -> bool {
    match auto {
        "manual" => false,
        "always" => true,
        "sglow" => {
            let cur = cx.st.bmaps.get("tankAuto").map(|m| m.get(tid)).unwrap_or(false);
            sgl_min(cx) < if cur { cx.meta.sg_efw_off } else { cx.meta.sg_dry }
        }
        "plow" => {
            let ci = cx.meta.tank_ids.iter().position(|t| t == tid).and_then(|ti| cx.meta.tanks.get(ti).map(|t| t.circuit)).unwrap_or(-1);
            cx.loop_p(ci) < cx.hold_set_p(ci) * 0.55
        }
        _ => false,
    }
}

fn sgl_min(cx: &Cx) -> f64 {
    if cx.meta.boiler_ids.is_empty() {
        return 100.0;
    }
    let mut m = 100.0;
    for id in cx.meta.boiler_ids.clone() {
        let v = boiler_lvl(cx, &id);
        if v < m {
            m = v;
        }
    }
    m
}

fn boiler_lvl(cx: &Cx, id: &str) -> f64 {
    let bi = cx.meta.boiler_ids.iter().position(|b| b == id).unwrap();
    if !cx.meta.is_drum[bi] {
        return sg_lvl(cx, id);
    }
    let nd = cx.meta.boiler_node[bi].clone();
    match cx.pf("hBy", &nd) {
        None => cx.meta.sgl_set,
        Some(_) => {
            if cx.meta.net_index.get(&nd).is_none() {
                return cx.meta.sgl_set;
            }
            let v = cx.hold_lvl_of(&nd);
            if v.is_finite() { clamp(v, 0.0, 100.0) } else { cx.meta.sgl_set }
        }
    }
}

fn sg_lvl(cx: &Cx, id: &str) -> f64 {
    let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap();
    let nd = cx.meta.shell_node[si].clone();
    match cx.pf("hBy", &nd) {
        None => cx.meta.sgl_set,
        Some(_) => {
            if cx.meta.net_index.get(&nd).is_none() {
                return cx.meta.sgl_set;
            }
            let v = cx.hold_lvl_of(&nd) * cx.meta.sg_dome;
            if v.is_finite() { clamp(v, 0.0, 100.0) } else { cx.meta.sgl_set }
        }
    }
}

// ---------------------------------------------------------------------------
// `pumpCoastStep`: rotor coast + standby reserve rule.
// ---------------------------------------------------------------------------

pub fn pump_coast_step(cx: &mut Cx) {
    let dt = cx.inp.dt;
    let k = js_min(dt / FLOW_TAU, 1.0);
    for (pi, pid) in cx.meta.pump_ids.clone().iter().enumerate() {
        if !cx.st.pump_live.contains(pid) {
            cx.st.pump_live.push(pid.clone());
        }
        if cx.st.maps.get("flowDemBy").and_then(|m| m.get(pid)).is_none() {
            cx.st.map_mut("flowDemBy").set(pid, 1.0);
        }
        let res = cx.meta.pump_res.get(pi).cloned().unwrap_or_default();
        if !res.is_empty() {
            let mut open = false;
            for r in &res {
                let ti = cx.meta.tank_ids.iter().position(|t| t == r);
                let auto = ti.and_then(|i| cx.meta.tank_auto.get(i)).map(|s| s.as_str()).unwrap_or("manual");
                if cx.tank_open(r, autorule_live(cx, auto, r)) {
                    open = true;
                    break;
                }
            }
            cx.st.map_mut("flowDemBy").set(pid, if open { 1.0 } else { 0.0 });
        }
        if cx.st.maps.get("flowBy").and_then(|m| m.get(pid)).is_none() {
            let d = cx.st.maps.get("flowDemBy").and_then(|m| m.get(pid)).unwrap_or(1.0);
            cx.st.map_mut("flowBy").set(pid, d);
        }
        let n = cx.st.maps.get("flowBy").and_then(|m| m.get(pid)).unwrap_or(f64::NAN);
        let want = cx.supply_k() * cx.st.maps.get("flowDemBy").and_then(|m| m.get(pid)).unwrap_or(f64::NAN);
        let rr = cx.meta.pump_rotor.get(pi).copied().unwrap_or(6.0);
        let v = if want >= n {
            n + (want - n) * k
        } else {
            js_max(want, n - (n * n / (2.0 * rr) + n / PUMP_FRIC_S) * dt)
        };
        cx.st.map_mut("flowBy").set(pid, v);
    }
    let live = cx.st.pump_live.clone();
    let dead: Vec<String> = cx.st.maps.get("flowBy").map(|m| m.keys.iter().filter(|k| !live.contains(k)).cloned().collect()).unwrap_or_default();
    for k in dead {
        cx.st.map_mut("flowBy").del(&k);
        cx.st.map_mut("flowDemBy").del(&k);
    }
}

// ---------------------------------------------------------------------------
// `sgShare`: per-generator primary-flow shares.
// ---------------------------------------------------------------------------

pub fn sg_share(cx: &Cx) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    for (i, id) in cx.meta.sg_ids.iter().enumerate() {
        let li = cx.meta.sg_loop.get(i).copied().unwrap_or(-1);
        let q = if li >= 0 {
            cx.inp.by_loop.get(&li.to_string()).copied().unwrap_or(0.0)
        } else {
            0.0
        };
        out.insert(id.clone(), if q > 0.0 { q } else { 0.0 });
    }
    let tot: f64 = out.values().sum();
    if tot > 0.0 {
        for v in out.values_mut() {
            *v /= tot;
        }
    } else if !out.is_empty() {
        let n = out.len() as f64;
        for v in out.values_mut() {
            *v = 1.0 / n;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// `stageStream`: one stream off the solve + `sgQAt`/`ihxQAt` + `ntuCounter`.
// ---------------------------------------------------------------------------

pub struct StageStream {
    pub t: f64,
    pub x: f64,
    pub fl: f64,
    pub c: f64,
}

pub fn stage_stream(cx: &Cx, id: &str, k: usize) -> StageStream {
    let (kopt, nbr) = match cx.meta.stage_keys.get(id) {
        Some((k0, k1)) => (if k == 0 { k0.clone() } else { k1.clone() },
            cx.meta.stage_in_nbr.get(id).map(|v| if k == 0 { v.0.clone() } else { v.1.clone() }).unwrap_or_default()),
        None => (None, vec![]),
    };
    let at: i32 = nbr.first().copied().unwrap_or(-1);
    let nm = if at >= 0 { cx.meta.net_names.get(at as usize).cloned().unwrap_or_default() } else { String::new() };
    let key = kopt.unwrap_or_default();
    let refr = cx.meta.net_ref_by_run.get(&key).copied().unwrap_or(0.0).abs();
    let w = js_max(cx.flow_v(&key).abs(), 0.02 * refr);
    let x = if at < 0 { 0.0 } else { clamp(cx.net_qual_at(&nm), 0.0, 1.0) };
    let t = if at < 0 { cx.st.f("Tavg") } else { cx.net_temp_at(&nm) };
    let fl = if refr > 1e-9 { w / refr } else { 0.02 };
    let c = if x > 0.0 {
        f64::INFINITY
    } else {
        w * cx.curves.of(cx.circ_of(&nm)).cp
    };
    StageStream { t, x, fl, c }
}

pub fn ntu_counter(ntu: f64, cr: f64) -> f64 {
    if !(ntu > 0.0) {
        return 0.0;
    }
    if !(cr < 0.999) {
        return ntu / (1.0 + ntu);
    }
    let e = crate::fdlibm::exp(-ntu * (1.0 - cr));
    (1.0 - e) / (1.0 - cr * e)
}

fn sg_hot(cx: &Cx, id: &str) -> f64 {
    let at = cx.meta.stage_in_nbr.get(id).and_then(|v| v.0.first()).copied().unwrap_or(-1);
    if at < 0 {
        return cx.st.f("Tavg");
    }
    let nm = cx.meta.net_names.get(at as usize).cloned().unwrap_or_default();
    cx.net_temp_at(&nm)
}

fn sg_temp(cx: &Cx, id: &str) -> f64 {
    if let Some(v) = cx.st.maps.get("sgTBy").and_then(|m| m.get(id)) {
        return v;
    }
    let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap();
    sec_p_target(cx, id, si)
}

fn sec_p_target(cx: &Cx, id: &str, si: usize) -> f64 {
    let dp = cx.meta.sg_design_p.get(si).copied().unwrap_or(0.0);
    dp * crate::fdlibm::pow(js_max(sec_load_share(cx, id), 0.05), 0.25)
}

fn sec_load_share(cx: &Cx, id: &str) -> f64 {
    let l = cx.st.f("load");
    let l = if l.is_nan() { 1.0 } else { l };
    let sg = cx.st.maps.get("sgShare");
    match sg {
        None => l,
        Some(m) => {
            let n = m.keys.len() as f64;
            match m.get(id) {
                Some(w) => if n > 0.0 { l * n * w } else { l },
                None => l,
            }
        }
    }
}

pub fn sg_q_at(cx: &Cx, id: &str, fl: f64, film_k: f64) -> f64 {
    let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap();
    let ua = cx.meta.sg_ua.get(si).copied().unwrap_or(0.0) * crate::fdlibm::pow(fl, UA_FLOW) * sg_fill(cx, id) * film_k;
    let dt = js_max(0.0, sg_hot(cx, id) - sg_temp(cx, id));
    let wcp = stage_stream(cx, id, 0).c;
    if !wcp.is_finite() {
        return ua * dt;
    }
    if wcp > 0.0 { wcp * (1.0 - crate::fdlibm::exp(-ua / wcp)) * dt } else { 0.0 }
}

fn sg_fill(cx: &Cx, id: &str) -> f64 {
    clamp(sg_lvl(cx, id) / cx.meta.sg_dry, 0.0, 1.0)
}

pub fn ihx_q_at(cx: &Cx, id: &str) -> f64 {
    if cx.part_wrecked(id) {
        return 0.0;
    }
    let ii = cx.meta.ihx_ids.iter().position(|s| s == id).unwrap();
    let a = stage_stream(cx, id, 0);
    let b = stage_stream(cx, id, 1);
    let dt = a.t - b.t;
    if !(dt > 0.0) {
        return 0.0;
    }
    let ua = cx.meta.ihx_ua.get(ii).copied().unwrap_or(0.0) * crate::fdlibm::pow(js_min(a.fl, b.fl), UA_FLOW)
        * (1.0 - 0.85 * js_max(a.x, b.x));
    let cmin = js_min(a.c, b.c);
    let cmax = js_max(a.c, b.c);
    if !cmin.is_finite() {
        return ua * dt;
    }
    if !(cmin > 0.0) {
        return 0.0;
    }
    ntu_counter(ua / cmin, if cmax.is_finite() { cmin / cmax } else { 0.0 }) * cmin * dt
}

// ---------------------------------------------------------------------------
// `sgHeatStep`: nat/readout, sgShare sync, SG/ihx/rad heat, heat balance.
// ---------------------------------------------------------------------------

pub fn sg_heat_step(cx: &mut Cx, pump_k: f64) {
    let _driven = cx.meta.flow_k * pump_k;
    cx.st.set_f("nat", cx.outs_num(6));
    let sgw = sg_share(cx);
    let cur: Vec<String> = cx.st.maps.get("sgShare").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !sgw.contains_key(&k) {
            cx.st.map_mut("sgShare").del(&k);
        }
    }
    for (k, v) in &sgw {
        cx.st.map_mut("sgShare").set(k, *v);
    }
    let v_now = clamp(cx.st.f("vf"), 0.0, 1.5);
    let n_sg = js_max(1.0, sgw.len() as f64);
    let film_k = 1.0 - 0.85 * js_min(v_now, 1.0);
    let mut q_tot = 0.0;
    let sgq_cur: Vec<String> = cx.st.heatbal.sg_q_by.keys.clone();
    for k in sgq_cur {
        if !sgw.contains_key(&k) {
            if let Some(i) = cx.st.heatbal.sg_q_by.keys.iter().position(|x| x == &k) {
                cx.st.heatbal.sg_q_by.keys.remove(i);
                cx.st.heatbal.sg_q_by.vals.remove(i);
            }
        }
    }
    for (id, sh) in &sgw {
        let fl = js_max(pump_k * sh * n_sg, 0.02);
        let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap();
        let fed = cx.inp.stage_fed.get(si).copied().unwrap_or(false);
        let q = if fed { sg_q_at(cx, id, fl, film_k) } else { 0.0 };
        cx.st.heatbal.sg_q_by.set(id, q);
        if cx.meta.sg_active_sg.get(si).copied().unwrap_or(false) {
            q_tot += q;
        }
    }
    let cur: Vec<String> = cx.st.maps.get("ihxQBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("ihxQBy").del(&k);
        }
    }
    for (ii, id) in cx.meta.ihx_ids.clone().iter().enumerate() {
        let fed = cx.inp.stage_fed.get(cx.meta.sg_ids.len() + ii).copied().unwrap_or(false);
        let q = if fed { ihx_q_at(cx, id) } else { 0.0 };
        cx.st.map_mut("ihxQBy").set(id, q);
        if cx.meta.sg_active_ihx.get(ii).copied().unwrap_or(false) {
            q_tot += q;
        }
    }
    // radiator panels
    let cur: Vec<String> = cx.st.maps.get("radTBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("radTBy").del(&k);
            cx.st.map_mut("radQBy").del(&k);
        }
    }
    for (ri, id) in cx.meta.rad_ids.clone().iter().enumerate() {
        let kk = cx.meta.tick_rad_key.get(ri).cloned().unwrap_or_default();
        let refr = cx.meta.net_ref_by_run.get(&kk).copied().unwrap_or(0.0).abs();
        let r = cx.tick_run_ratio(&kk);
        let (ia, ib) = cx.meta.rad_internal.get(ri).cloned().unwrap_or_default();
        let face = if r >= 0.0 { ia } else { ib };
        let n_in = cx.fold(&format!("{id}{face}")).to_string();
        let fl = js_max(r.abs(), 0.02);
        let has_t = cx.st.maps.get("radTBy").and_then(|m| m.get(id));
        if has_t.is_none() {
            cx.st.map_mut("radTBy").set(id, RAD_TDES);
        }
        let t_by = cx.st.maps.get("radTBy").and_then(|m| m.get(id)).unwrap_or(RAD_TDES);
        let q = if cx.part_wrecked(id) || !cx.meta.rad_live.get(ri).copied().unwrap_or(false) || !(refr > 1e-9) {
            0.0
        } else {
            cx.meta.rad_ua.get(ri).copied().unwrap_or(0.0) * crate::fdlibm::pow(fl, UA_FLOW)
                * (1.0 - 0.85 * clamp(cx.net_qual_at(&n_in), 0.0, 1.0))
                * js_max(0.0, cx.net_temp_at(&n_in) - t_by)
        };
        cx.st.map_mut("radQBy").set(id, q);
        let pi = cx.meta.net_index.get(&n_in).copied();
        let of = pi.and_then(|i| cx.inp.m_by_piece.get(i).copied()).unwrap_or(-2);
        if cx.inp.core_pieces.contains(&of) {
            q_tot += q;
        }
    }
    let removal = q_tot / (cx.meta.rated * 1000.0);
    let n = cx.st.f("n");
    let decay = cx.st.f("decay");
    cx.st.heatbal.prompt = n * cx.meta.prompt_f;
    cx.st.heatbal.decay = decay;
    cx.st.heatbal.heat = n * cx.meta.prompt_f + decay;
    cx.st.heatbal.removal = removal;
    let cores: Vec<String> = cx.meta.core_ids.clone();
    let hb: Vec<String> = cx.st.heatbal.heat_by.keys.clone();
    for k in hb {
        if !cores.contains(&k) {
            if let Some(i) = cx.st.heatbal.heat_by.keys.iter().position(|x| x == &k) {
                cx.st.heatbal.heat_by.keys.remove(i);
                cx.st.heatbal.heat_by.vals.remove(i);
            }
        }
    }
    for id in &cores {
        let h = cx.inp.core_heat.get(id).copied().unwrap_or(f64::NAN);
        cx.st.heatbal.heat_by.set(id, h);
    }
    cx.st.heatbal.d_tavg = cx.st.f("dTavg");
}

// ---------------------------------------------------------------------------
// `springStep` + `reliefCmd`.
// ---------------------------------------------------------------------------

pub fn relief_cmd(cx: &mut Cx, fid: &str, open: bool) {
    let cell = cx.st.relief.entry(fid.to_string()).or_insert(ReliefCell::default());
    if open {
        if cell.open {
            return;
        }
        cell.open = true;
        cell.auto = true;
        cell.stuck = cell.arm;
        cell.arm = false;
        if cx.meta.relief_sec.contains(&fid.to_string()) {
            cx.log(SEV_WARN, EV_RELIEF_LIFT);
        }
        return;
    }
    if !(cell.open && cell.auto && !cell.stuck) {
        return;
    }
    cell.open = false;
    cell.auto = false;
}

pub fn spring_step(cx: &mut Cx, fi: usize, pv: f64) {
    let (lift, reseat) = (cx.meta.fits.get(fi).map(|f| f.lift).unwrap_or(f64::NAN),
        cx.meta.fits.get(fi).map(|f| f.reseat).unwrap_or(f64::NAN));
    let fid = cx.meta.relief_ids.get(fi).cloned().unwrap_or_default();
    if pv > lift {
        relief_cmd(cx, &fid, true);
    } else if pv < reseat {
        relief_cmd(cx, &fid, false);
    }
}

// ---------------------------------------------------------------------------
// `holdReliefStep`: hold-tank pressures + primary relief vent/book.
// ---------------------------------------------------------------------------

pub fn hold_relief_step(cx: &mut Cx) {
    let dt = cx.inp.dt;
    if cx.st.b("breach") {
        return;
    }
    for (hi, ti) in cx.meta.hold_tank_ids.clone().iter().enumerate() {
        let id = cx.meta.tank_ids.get(*ti).cloned().unwrap_or_default();
        let ci = cx.meta.tanks.get(*ti).map(|t| t.circuit).unwrap_or(-1);
        if ci < 0 {
            continue;
        }
        if cx.inp.hold_live.get(hi).copied().unwrap_or(false) {
            let v = cx.loop_p(ci);
            cx.st.map_mut("holdPBy").set(&id, v);
        }
    }
    let rids: Vec<usize> = cx.meta.relief_pri.clone();
    let cur: Vec<String> = cx.st.maps.get("reliefVent").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !rids.iter().any(|i| &cx.meta.relief_ids[*i] == &k) {
            cx.st.map_mut("reliefVent").del(&k);
        }
    }
    for i in &rids {
        cx.st.map_mut("reliefVent").set(&cx.meta.relief_ids[*i], 0.0);
    }
    let mut vent_loose = 0.0;
    for fi in rids {
        let fid = cx.meta.relief_ids[fi].clone();
        cx.st.map_mut("reliefVent").set(&fid, 0.0);
        if cx.meta.fits.get(fi).map(|f| f.spring).unwrap_or(false) {
            let pv = cx.tick_p_at(&cx.meta.relief_node.get(fi).cloned().unwrap_or_default());
            spring_step(cx, fi, pv);
        }
        let cell = cx.st.relief.get(&fid).cloned().unwrap_or_default();
        if !cell.open || cell.blocked {
            continue;
        }
        let rate = js_max(0.0, cx.inv_rate(cx.inp.relief_v.get(&fid).copied().unwrap_or(0.0)));
        let q = rate * dt;
        cx.st.map_mut("reliefVent").set(&fid, rate);
        if !cx.meta.fits.get(fi).map(|f| f.has_target).unwrap_or(false) {
            let cr = cx.inp.cont_rel.get(&format!("relief:{fid}")).copied().unwrap_or(1.0);
            let v = cx.st.f("release");
            cx.st.set_f("release", js_min(100.0, v + (rate / SGTR_RATE) * 0.02 * cr * cx.meta.dose * dt));
            vent_loose += q;
        }
    }
    cx.book("reliefRoom", vent_loose / 100.0 * cx.meta.loop_kg);
}

// ---------------------------------------------------------------------------
// `discTankStep`: rupture discs + wrecked-tank drain.
// ---------------------------------------------------------------------------

pub fn disc_tank_step(cx: &mut Cx) {
    let dt = cx.inp.dt;
    for (ti, tid) in cx.meta.tank_ids.clone().iter().enumerate() {
        let t = cx.meta.tanks.get(ti).cloned().unwrap_or(TankRow {
            vol: 0.0, level: 0.0, fluid: "water".into(), hold: false, hold_p: None, inf: false,
            cell: false, gas_p0: None, burst: None, auto: "manual".into(),
            in_field: false, primary: false, circuit: -1,
        });
        let field = t.in_field;
        if field {
            let out = 100.0 * cx.inp.out_kg.get(&cx.meta.break_key.get(ti).cloned().unwrap_or_default()).copied().unwrap_or(0.0) / js_max(cx.meta.tank_kg.get(ti).copied().unwrap_or(1.0), 1e-9);
            let rel = if cx.part_wrecked(tid) {
                1.0
            } else if cx.st.bmaps.get("burstBy").map(|m| m.get(tid)).unwrap_or(false) {
                t.burst.as_ref().map(|b| b.rel).unwrap_or(0.0)
            } else {
                0.0
            };
            if out > 0.0 && rel > 0.0 {
                let cr = cx.inp.cont_rel.get(&format!("tank:{tid}")).copied().unwrap_or(1.0);
                let act = fluid_act(&t.fluid);
                let v = cx.st.f("release");
                cx.st.set_f("release", js_min(100.0, v + out * rel * act * cr * cx.meta.dose * dt));
            }
        } else if !cx.meta.tanks.get(ti).map(|t| t.hold).unwrap_or(false) && cx.part_wrecked(tid) {
            let lvl = cx.st.maps.get("tank").and_then(|m| m.get(tid)).unwrap_or(0.0);
            if lvl > 0.0 {
                let out = js_min(lvl, HOT_DUMP * js_min(lvl, 100.0) / 100.0 * dt);
                cx.st.map_mut("tank").set(tid, lvl - out);
                cx.book("tankWreck", out / 100.0 * cx.meta.tank_kg.get(ti).copied().unwrap_or(0.0));
                let cr = cx.inp.cont_rel.get(&format!("tank:{tid}")).copied().unwrap_or(1.0);
                let v = cx.st.f("release");
                cx.st.set_f("release", js_min(100.0, v + out * fluid_act(&t.fluid) * cr * cx.meta.dose * dt));
            }
        }
        let Some(b) = t.burst.clone() else { continue };
        let armed = cx.st.bmaps.get("burstBy").map(|m| m.get(tid)).unwrap_or(false);
        if !armed {
            let tp = cx.inp.tank_p.get(ti).copied().unwrap_or(0.0);
            if tp >= b.at {
                cx.st.bmaps.entry("burstBy".into()).or_default().set(tid, true);
                cx.log(SEV_ALARM, EV_DISC_BURST);
            }
        }
        let armed = cx.st.bmaps.get("burstBy").map(|m| m.get(tid)).unwrap_or(false);
        let lvl = cx.st.maps.get("tank").and_then(|m| m.get(tid)).unwrap_or(0.0);
        if !field && armed && lvl > 0.0 {
            let out = js_min(lvl, b.drain * dt);
            cx.st.map_mut("tank").set(tid, lvl - out);
            cx.book("burstDisc", out / 100.0 * cx.meta.tank_kg.get(ti).copied().unwrap_or(0.0));
            let cr = cx.inp.cont_rel.get(&format!("tank:{tid}")).copied().unwrap_or(1.0);
            let v = cx.st.f("release");
            cx.st.set_f("release", js_min(100.0, v + out * b.rel * fluid_act(&t.fluid) * cr * cx.meta.dose * dt));
        }
    }
}

// ---------------------------------------------------------------------------
// `bookTailStep`: transport books + tank rules.
// ---------------------------------------------------------------------------

pub fn book_tail_step(cx: &mut Cx, inj: f64) {
    cx.book("spillPri", cx.inp.advect_out_pri);
    cx.st.set_f("injRate", inj);
    for (ti, _tid) in cx.meta.tank_ids.clone().iter().enumerate() {
        let t = &cx.meta.tanks[ti];
        if !t.inf || !t.primary {
            continue;
        }
        let node = cx.meta.tank_node.get(ti).cloned().unwrap_or_default();
        cx.book("boundaryTank", cx.inp.advect_landed.get(&node).copied().unwrap_or(0.0));
    }
    for (ti, tid) in cx.meta.tank_ids.clone().iter().enumerate() {
        let auto = cx.meta.tank_auto.get(ti).cloned().unwrap_or_default();
        let v = autorule_live(cx, &auto, tid);
        cx.st.bmaps.entry("tankAuto".into()).or_default().set(tid, v);
    }
}

// ---------------------------------------------------------------------------
// `sgtrStep` + `sgReactStep` (sodium-water reaction).
// ---------------------------------------------------------------------------

fn sw_react(row: &FireRow, kg_na: f64) -> (f64, f64, f64) {
    (kg_na * row.wlhv, kg_na * row.wh2, kg_na * row.wh2o)
}

fn sw_na_for(row: &FireRow, kg_h2o: f64) -> f64 {
    kg_h2o / row.wh2o
}

fn h2_total(cx: &Cx) -> f64 {
    let mut t = 0.0;
    for i in 0..cx.meta.net_names.len() {
        let c = cx.st.bags.get("h2By").and_then(|b| b.v.get(i)).copied().unwrap_or(0.0);
        if !(c > 0.0) {
            continue;
        }
        if !cx.meta.in_core_node.get(i).copied().unwrap_or(false) {
            continue;
        }
        let m = cx.st.bags.get("mBy").and_then(|b| {
            if b.has.get(i).copied().unwrap_or(0) != 0 {
                b.v.get(i).copied()
            } else {
                None
            }
        });
        let m = m.unwrap_or_else(|| {
            let nm = cx.meta.net_names.get(i).cloned().unwrap_or_default();
            cx.meta.net_vol.get(i).copied().unwrap_or(0.0) * cx.net_rho_at(&nm)
        });
        t += c * m;
    }
    t
}

pub fn sg_react_step(cx: &mut Cx) {
    let ids = cx.meta.sg_ids.clone();
    let cur: Vec<String> = cx.st.maps.get("sgWastBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !ids.contains(&k) {
            for bag in ["sgWastBy", "sgSwQBy", "sgPwQBy", "sgH2By"] {
                cx.st.map_mut(bag).del(&k);
            }
        }
    }
    for (si, id) in ids.iter().enumerate() {
        if cx.st.maps.get("sgWastBy").and_then(|m| m.get(id)).is_none() {
            cx.st.map_mut("sgWastBy").set(id, 1.0);
        }
        cx.st.map_mut("sgSwQBy").set(id, 0.0);
        cx.st.map_mut("sgPwQBy").set(id, 0.0);
        let burn_at = |ci: i32| -> Option<String> {
            if ci < 0 {
                return None;
            }
            cx.meta.circ_burn.get(ci as usize).and_then(|o| o.clone())
        };
        let prim_ci = cx.meta.sg_prim_circ.get(si).copied().unwrap_or(-1);
        let shell_ci = cx.meta.shell_circ.get(si).copied().unwrap_or(-1);
        let f = burn_at(prim_ci).as_ref().and_then(|b| cx.meta.fire_rows.get(b)).cloned();
        // `if(!f || satOfCirc(shellCirc(id)).burn) continue`
        let Some(row) = f else { continue };
        if burn_at(shell_ci).is_some() {
            continue;
        }
        let key = cx.meta.sgtr_key.get(si).cloned().unwrap_or_default();
        // `outsBag(outs, "sgtrV", "sgtrBy", "sgtrPos", key)`: typed holder or legacy object.
        let q = if cx.inp.sgtr_typed {
            cx.meta.sgtr_keys.iter().position(|k| k == &key).and_then(|p| cx.inp.sgtr_v.get(p).copied()).unwrap_or(f64::NAN)
        } else {
            cx.inp.sgtr_by.get(&key).copied().unwrap_or(f64::NAN)
        };
        // `if(!q) continue` — skips zero AND NaN, before react + wast.
        if !(q != 0.0) {
            continue;
        }
        let dt = cx.inp.dt;
        let (qq, h2) = if q > 0.0 {
            let (qq, h2, _) = sw_react(&row, q * dt);
            (qq, h2)
        } else {
            let (qq, h2, _) = sw_react(&row, sw_na_for(&row, -q * dt));
            (qq, h2)
        };
        if q > 0.0 {
            cx.st.map_mut("sgSwQBy").set(id, qq / dt);
            let cur = cx.st.maps.get("sgH2By").and_then(|m| m.get(id)).unwrap_or(0.0);
            cx.st.map_mut("sgH2By").set(id, cur + h2);
        } else {
            cx.st.map_mut("sgPwQBy").set(id, qq / dt);
            sg_prim_h2(cx, id, h2);
        }
        let w = cx.st.maps.get("sgWastBy").and_then(|m| m.get(id)).unwrap_or(1.0);
        cx.st.map_mut("sgWastBy").set(id, js_min(row.wast_max, w * (1.0 + row.wast * dt)));
    }
}

fn sg_prim_h2(cx: &mut Cx, id: &str, kg: f64) {
    let (fa, fb) = cx.meta.prim_faces.get(id).cloned().unwrap_or_default();
    for face in [fa, fb] {
        if face.is_empty() {
            continue;
        }
        let nd = cx.fold(&format!("{id}{face}")).to_string();
        let m = cx.pf("mBy", &nd).unwrap_or(0.0);
        if m > cx.meta.dry_min_kg {
            let cur = cx.pf("h2By", &nd).unwrap_or(0.0);
            cx.pf_set("h2By", &nd, cur + kg / 2.0 / m);
        }
    }
    cx.st.set_f("h2", h2_total(cx));
}

pub fn sgtr_step(cx: &mut Cx) {
    let leak = js_max(0.0, cx.inv_rate(cx.outs_num(3)));
    cx.st.set_f("sgtrRate", leak);
    if cx.inp.sgtr_typed {
        for (gj, k) in cx.meta.sgtr_keys.clone().iter().enumerate() {
            let raw = cx.inp.sgtr_v.get(gj).copied().unwrap_or(0.0);
            let v = js_max(0.0, cx.inv_rate(raw));
            cx.st.map_mut("sgtrBy").set(k, v);
        }
        let keep: HashSet<String> = cx.meta.sgtr_keys.iter().cloned().collect();
        let dead: Vec<String> = cx.st.maps.get("sgtrBy").map(|m| m.keys.iter().filter(|k| !keep.contains(*k)).cloned().collect()).unwrap_or_default();
        for k in dead {
            cx.st.map_mut("sgtrBy").del(&k);
        }
    } else {
        let cur: Vec<String> = cx.st.maps.get("sgtrBy").map(|m| m.keys.clone()).unwrap_or_default();
        for k in cur {
            if !cx.inp.sgtr_by.contains_key(&k) {
                cx.st.map_mut("sgtrBy").del(&k);
            }
        }
        let keys: Vec<String> = cx.inp.sgtr_by.keys().cloned().collect();
        for k in keys {
            let raw = cx.inp.sgtr_by.get(&k).copied().unwrap_or(0.0);
            let v = js_max(0.0, cx.inv_rate(raw));
            cx.st.map_mut("sgtrBy").set(&k, v);
        }
    }
    let mut hot = 0.0;
    let keys: Vec<String> = cx.st.maps.get("sgtrBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in keys {
        let id = k.strip_prefix("sgtr:").unwrap_or(&k).to_string();
        let v = cx.st.maps.get("sgtrBy").and_then(|m| m.get(&k)).unwrap_or(0.0);
        let ai = cx.meta.sg_ids.iter().position(|s| s == &id);
        let act = ai.map(|i| cx.meta.sg_active_sg.get(i).copied().unwrap_or(false)).unwrap_or(false);
        if act {
            let cr = cx.inp.cont_rel.get(&format!("sg:{id}")).copied().unwrap_or(1.0);
            hot += v * cr;
        }
    }
    if hot > 0.0 {
        let dt = cx.inp.dt;
        let v = cx.st.f("release");
        cx.st.set_f("release", js_min(100.0, v + (hot / 0.30) * 0.02 * cx.meta.dose * dt));
    }
    sg_react_step(cx);
}

// ---------------------------------------------------------------------------
// `marginStep`: subcooling margin over indexed field reads.
// ---------------------------------------------------------------------------

pub fn margin_step(cx: &mut Cx, pump_k: f64) {
    // hold mask rebuilt per call like the tick (`scratch(net,"scHold",…)`,
    // refilled, never rebuilt across calls).
    let mut hold_bits = vec![false; cx.meta.net_names.len()];
    for nm in cx.meta.hold_line.clone() {
        if let Some(i) = cx.meta.net_index.get(&nm).copied() {
            if i < hold_bits.len() {
                hold_bits[i] = true;
            }
        }
    }
    for ci in cx.meta.hold_circs.clone() {
        let mut worst: Option<String> = None;
        let mut hot = f64::NEG_INFINITY;
        let c_c = cx.curves.of(ci).clone();
        for i in 0..cx.meta.net_names.len() {
            let nm = cx.meta.net_names.get(i).cloned().unwrap_or_default();
            if cx.circ_of(&nm) != ci {
                continue;
            }
            if cx.meta.net_booked.get(i).copied().unwrap_or(0) != 0 {
                continue;
            }
            if hold_bits.get(i).copied().unwrap_or(false) {
                continue;
            }
            let t = match (cx.pf("pBy", &nm), cx.pf("hBy", &nm)) {
                (Some(_), Some(_)) => {
                    let bag_p = cx.st.bags.get("pBy").unwrap();
                    let bag_h = cx.st.bags.get("hBy").unwrap();
                    let p = if bag_p.v[i] > COND_P0 { bag_p.v[i] } else { COND_P0 };
                    let h = bag_h.v[i];
                    let ts = sat_t(&c_c, p);
                    let hf = c_c.cp * (ts - H_DATUM);
                    let hfg = hfg_of(&c_c, ts);
                    if clamp((h - hf) / js_max(hfg, 1e-6), 0.0, 1.0) > 0.0 {
                        continue;
                    }
                    if h <= hf {
                        H_DATUM + h / c_c.cp
                    } else if h >= hf + hfg {
                        ts + (h - hf - hfg) / c_c.cp
                    } else {
                        ts
                    }
                }
                _ => {
                    if cx.net_qual_at(&nm) > 0.0 {
                        continue;
                    }
                    cx.net_temp_at(&nm)
                }
            };
            if t > hot {
                hot = t;
                worst = Some(nm);
            }
        }
        let w = worst.or_else(|| cx.meta.hold_on_circ.get(ci as usize).and_then(|v| v.first()).cloned())
            .or_else(|| cx.meta.core_on_circ.get(ci as usize).and_then(|v| v.first()).cloned())
            .unwrap_or_else(|| cx.meta.primary_core.clone());
        let sc = cx.tick_sc_at(&w);
        let key = cx.circ_key(ci).unwrap_or_default();
        // s.scBy keyed by circuit INDEX in JS (`s.scBy[ci]`)!
        cx.st.map_mut("scBy").set(&ci.to_string(), sc);
        let _ = key;
    }
    let sc = cx.st.maps.get("scBy").and_then(|m| m.get(&cx.meta.core_circ.to_string())).unwrap_or(f64::NAN);
    let n = cx.st.f("n");
    let decay = cx.st.f("decay");
    cx.st.set_f("heat", n * cx.meta.prompt_f + decay);
    cx.st.set_f("sc", sc);
    cx.st.set_f("flowNet", pump_k);
    for id in cx.meta.core_ids.clone() {
        let v = cx.inp.core_fn.get(&id).copied().unwrap_or(f64::NAN);
        if let Some(cs) = cx.st.cores.get_mut(&id) {
            cs.flow_net = v;
        }
    }
}

// ---------------------------------------------------------------------------
// `condTurbStep`: freg pruning + condenser/turbine latches.
// ---------------------------------------------------------------------------

pub fn cond_turb_step(cx: &mut Cx) {
    let cur: Vec<String> = cx.st.maps.get("fregBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.boiler_ids.contains(&k) {
            cx.st.map_mut("fregBy").del(&k);
        }
    }
    let cur: Vec<String> = cx.st.maps.get("fregDemBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.boiler_ids.contains(&k) {
            cx.st.map_mut("fregDemBy").del(&k);
        }
    }
    if !cx.st.b("condLost") && cx.cond_p() >= COND_ATM {
        cx.st.set_b("condLost", true);
        cx.log(SEV_ALARM, EV_COND_LOST);
    }
    if !cx.st.b("turbTrip") && cx.cond_p() > TURB_TRIP_P {
        cx.st.set_b("turbTrip", true);
        cx.log(SEV_ALARM, EV_TURB_TRIP);
    } else if cx.st.b("turbTrip") && !cx.st.b("condLost") && !cx.inp.exh_open && cx.inp.role_turb_alive > 0 && cx.cond_p() < TURB_TRIP_P * TURB_RESET_K {
        cx.st.set_b("turbTrip", false);
        cx.log(SEV_INFO, EV_TURB_RELATCH);
    }
}

// ---------------------------------------------------------------------------
// condenser/secondary readers shared by the steps below.
// ---------------------------------------------------------------------------

impl<'a> Cx<'a> {
    /// `condP`.
    pub fn cond_p(&self) -> f64 {
        let exh = if self.inp.exh_open {
            self.region_p_at_opt(self.meta.cond_role_part.clone())
        } else {
            0.0
        };
        let lost = if self.st.b("condLost") { COND_ATM } else { 0.0 };
        js_max(exh, js_max(lost, self.cond_p_read()))
    }
    fn cond_p_read(&self) -> f64 {
        let mut p = 0.0;
        let mut n = 0u32;
        for id in &self.meta.cond_sinks {
            if let Some(v) = self.st.maps.get("condPBy").and_then(|m| m.get(id)) {
                if v.is_finite() {
                    p += v;
                    n += 1;
                }
            }
        }
        if n > 0 {
            return js_max(COND_P0, p / n as f64);
        }
        let ct = self.st.f("condT");
        if ct.is_nan() {
            return self.meta.cond_p_des;
        }
        js_max(COND_P0, crate::eos::sat_p(&self.curves.water, ct))
    }
    /// `regionPAt` for an optional part-table index.
    pub fn region_p_at_opt(&self, part: Option<usize>) -> f64 {
        let means = region_p_mean(
            &self.meta.region_of,
            &self.st.bags.get("roomP").map(|b| b.v.clone()).unwrap_or_default(),
            self.meta.n_regions,
        );
        match part {
            Some(pi) => {
                let p = &self.meta.parts[pi];
                region_p(&self.meta.region_of, &means, self.meta.pcont,
                    self.meta.gw, self.meta.gh, p.x + (p.w / 2), p.y + (p.h / 2))
            }
            None => region_p(&self.meta.region_of, &means, self.meta.pcont, self.meta.gw, self.meta.gh, -1, -1),
        }
    }
    /// `condTRead`.
    pub fn cond_t_read(&self, ci_: usize) -> Option<f64> {
        let id = self.meta.cond_ids.get(ci_).cloned().unwrap_or_default();
        if self.meta.cond_vacuum.get(ci_).copied().unwrap_or(false) {
            Some(self.cond_pool_t(&id))
        } else {
            let nd = self.meta.cond_ves_node.get(ci_).cloned().unwrap_or_default();
            Some(self.net_temp_at(&nd))
        }
    }
    /// `condPoolT`: bisection off the curve tab (mirrors the JS exactly).
    pub fn cond_pool_t(&self, id: &str) -> f64 {
        let ci = self.meta.cond_ids.iter().position(|c| c == id);
        let nd = ci.and_then(|i| self.meta.cond_ves_node.get(i).cloned()).unwrap_or_default();
        let c = self.curves.of(self.circ_of(&nd));
        let m = self.pf("mBy", &nd).unwrap_or(f64::NAN);
        let h = self.net_h_at(&nd);
        let v = ci.and_then(|i| self.meta.cond_vol.get(i).copied()).unwrap_or(0.0);
        if !(m > 0.0) || !h.is_finite() || !(v > 0.0) {
            return self.net_temp_at(&nd);
        }
        let hi = curve_hi(c);
        let lo = CURVE_LO + 1.0;
        if !(hi > lo) {
            return self.net_temp_at(&nd);
        }
        if cond_x_at(c, m, v, hi) >= 1.0 || h >= cond_h_at(c, m, v, hi) {
            return self.net_temp_at(&nd);
        }
        if h <= cond_h_at(c, m, v, lo) {
            return lo;
        }
        let mut a = lo;
        let mut b = hi;
        for _ in 0..40 {
            let t = 0.5 * (a + b);
            if cond_h_at(c, m, v, t) < h {
                a = t;
            } else {
                b = t;
            }
        }
        0.5 * (a + b)
    }
    pub fn cond_t_mean(&self) -> Option<f64> {
        if self.meta.cond_sinks.is_empty() {
            return None;
        }
        let mut t = 0.0;
        let mut n = 0u32;
        for id in &self.meta.cond_sinks {
            let v = self.st.maps.get("condTBy").and_then(|m| m.get(id));
            // `condTOf`: pot or nothing (undefined → skip)
            if let Some(v) = v {
                t += v;
                n += 1;
            }
        }
        if n > 0 { Some(t / n as f64) } else { None }
    }
    pub fn part_of(&self, id: &str) -> Option<usize> {
        self.meta.part_of.get(id).copied()
    }
    pub fn part_idx(&self, id: &str) -> Option<usize> {
        self.meta.parts.iter().position(|p| p.id == id)
    }
    /// `radRejOf` per panel index.
    pub fn rad_rej_of(&self, ri: usize) -> f64 {
        let id = self.meta.rad_ids.get(ri).cloned().unwrap_or_default();
        if self.part_wrecked(&id) {
            return 0.0;
        }
        let emis = self.meta.rad_coat_emis.get(ri).copied().unwrap_or(0.85);
        let area = self.meta.rad_area.get(ri).copied().unwrap_or(0.0);
        let t = self.st.maps.get("radTBy").and_then(|m| m.get(&id)).unwrap_or(RAD_TDES);
        js_max(0.0, emis * 5.670374419e-8 * area * (crate::fdlibm::pow(t, 4.0) - crate::fdlibm::pow(T_SPACE, 4.0)) / 1000.0)
    }
    /// `cwInOf` per condenser index.
    pub fn cw_in_of(&self, ci: usize) -> Option<f64> {
        let id = self.meta.cond_ids.get(ci).cloned().unwrap_or_default();
        let paths = self.meta.cw_paths.get(ci).cloned().unwrap_or_default();
        let mut t = 0.0;
        let mut n = 0u32;
        for (key, a, b) in &paths {
            let refr = self.meta.net_ref_by_run.get(key).copied().unwrap_or(0.0).abs();
            let fwd = if refr > 1e-9 { self.flow_v(key) / refr } else { 0.0 } >= 0.0;
            let face = if fwd { a } else { b };
            let nd = self.fold(&format!("{id}{face}")).to_string();
            t += self.net_temp_at(&nd);
            n += 1;
        }
        if n > 0 { Some(t / n as f64) } else { None }
    }
    pub fn cw_in_mean(&self) -> Option<f64> {
        if self.meta.cond_sinks.is_empty() {
            return None;
        }
        let mut t = 0.0;
        let mut n = 0u32;
        for id in &self.meta.cond_sinks {
            if let Some(v) = self.st.maps.get("cwInTBy").and_then(|m| m.get(id)) {
                t += v;
                n += 1;
            }
        }
        if n > 0 { Some(t / n as f64) } else { None }
    }
    /// `reliefAtP`.
    pub fn relief_at_p(&self, fid: &str) -> f64 {
        let sh = self.meta.shells_of.get(fid).cloned().unwrap_or_default();
        if sh.is_empty() {
            return self.st.f("P");
        }
        let live = self.inp.shells_live.get(fid).cloned().unwrap_or_default();
        if live.is_empty() {
            return self.region_p_at_opt(self.part_of(fid));
        }
        let mut pk = 0.0;
        for id in &live {
            if let Some(si) = self.meta.sg_ids.iter().position(|s| s == id) {
                pk = js_max(pk, self.sec_p(si));
            }
        }
        pk
    }
    /// `secP`: a burst OR wrecked shell is an opening (`sgOpen`).
    pub fn sec_p(&self, si: usize) -> f64 {
        let id = self.meta.sg_ids.get(si).cloned().unwrap_or_default();
        if self.st.bmaps.get("sgBurst").map(|m| m.get(&id)).unwrap_or(false) || self.part_wrecked(&id) {
            let pi = self.part_of(&id);
            return self.region_p_at_opt(pi);
        }
        match self.st.maps.get("sgPBy").and_then(|m| m.get(&id)) {
            Some(p) => js_max(COND_P0, p),
            None => self.sec_p_target_by_id(&id, si),
        }
    }
    fn sec_p_target_by_id(&self, id: &str, si: usize) -> f64 {
        sec_p_target(self, id, si)
    }
    /// `boilerP`.
    pub fn boiler_p(&self, bi: usize) -> f64 {
        if !self.meta.is_drum.get(bi).copied().unwrap_or(false) {
            let si = self.meta.sg_ids.iter().position(|s| s == &self.meta.boiler_ids[bi]).unwrap_or(usize::MAX);
            return if si == usize::MAX { f64::NAN } else { self.sec_p(si) };
        }
        let id = self.meta.boiler_ids.get(bi).cloned().unwrap_or_default();
        match self.pf("pBy", &id) {
            Some(v) => js_max(COND_P0, v),
            None => self.hold_set_p(self.meta.boiler_circ.get(bi).copied().unwrap_or(-1)),
        }
    }
}

// ---------------------------------------------------------------------------
// `secVentStep`: secondary relief steam + per-shell vent split.
// ---------------------------------------------------------------------------

pub fn sec_vent_step(cx: &mut Cx) -> (HashMap<String, f64>, f64) {
    let p_cond = cx.cond_p();
    let mut sec_vent: HashMap<String, f64> = HashMap::new();
    for fid in cx.meta.relief_sec.clone() {
        cx.st.map_mut("reliefSteam").set(&fid, 0.0);
    }
    for id in cx.meta.boiler_ids.clone() {
        sec_vent.insert(id, 0.0);
    }
    // vent kilograms off dumped vent-kind edges
    let mut vent_kg: HashMap<String, f64> = HashMap::new();
    for (key, kg) in cx.inp.vent_edges.clone() {
        *vent_kg.entry(key).or_insert(0.0) += kg;
    }
    for (fi, fid) in cx.meta.relief_ids.clone().iter().enumerate() {
        if !cx.meta.relief_sec.contains(fid) {
            continue;
        }
        let shells = cx.inp.shells_live.get(fid).cloned().unwrap_or_default();
        if cx.meta.fits.get(fi).map(|f| f.spring).unwrap_or(false) {
            let pv = cx.relief_at_p(fid);
            spring_step(cx, fi, pv);
        }
        let cell = cx.st.relief.get(fid).cloned().unwrap_or_default();
        let steam = if !cell.open || cell.blocked {
            0.0
        } else {
            js_max(0.0, cx.inp.relief_v.get(fid).copied().unwrap_or(0.0))
        };
        cx.st.map_mut("reliefSteam").set(fid, steam);
        let vkey = cx.meta.vent_key.get(fi).and_then(|o| o.clone()).unwrap_or_default();
        let q = vent_kg.get(&vkey).copied().unwrap_or(0.0) / js_max(cx.inp.dt, 1e-9);
        if !(q > 0.0) {
            continue;
        }
        let back = cx.region_p_at_opt(cx.part_of(fid));
        let mut tot = 0.0;
        for id in &shells {
            let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap_or(usize::MAX);
            if si != usize::MAX {
                tot += js_max(0.0, cx.sec_p(si) - back);
            }
        }
        let n = shells.len() as f64;
        for id in &shells {
            let si = cx.meta.sg_ids.iter().position(|s| s == id).unwrap_or(usize::MAX);
            let over = if si != usize::MAX { js_max(0.0, cx.sec_p(si) - back) } else { 0.0 };
            let add = q * if tot > 0.0 { over / tot } else { 1.0 / n };
            *sec_vent.entry(id.clone()).or_insert(0.0) += add;
        }
    }
    (sec_vent, p_cond)
}

// ---------------------------------------------------------------------------
// `shellStep`: SG shells + drums (returns bleedAll for `turbStep`).
// ---------------------------------------------------------------------------

fn feed_bleed_kgs(cx: &Cx, bi: usize) -> f64 {
    feed_heat_kw(cx, bi)
        / js_max(
            sat_hg(cx.curves.of(cx.meta.boiler_circ.get(bi).copied().unwrap_or(-1)), cx.boiler_p(bi)) - feed_in_h(cx, bi),
            1.0,
        )
}

fn feed_in_h(cx: &Cx, bi: usize) -> f64 {
    let nm = cx.meta.feed_node.get(bi).cloned().unwrap_or_default();
    let ni = cx.meta.net_index.get(&nm).copied();
    // Transport-measured feed enthalpy when masked; hotwell fallback before the first pass.
    let h = ni.and_then(|i| {
        if cx.inp.feed_in_hm.get(i).copied().unwrap_or(0) != 0 {
            cx.inp.feed_in_hv.get(i).copied()
        } else {
            None
        }
    });
    if let Some(v) = h {
        return v;
    }
    let ct = cx.st.f("condT");
    h_of_t(
        cx.curves.of(cx.meta.boiler_circ.get(bi).copied().unwrap_or(-1)),
        if ct.is_nan() { T_FEED } else { ct },
    )
}

fn feed_heat_kw(cx: &Cx, bi: usize) -> f64 {
    let id = cx.meta.boiler_ids.get(bi).cloned().unwrap_or_default();
    let c = cx.curves.of(cx.meta.boiler_circ.get(bi).copied().unwrap_or(-1));
    let nm = cx.meta.feed_node.get(bi).cloned().unwrap_or_default();
    let h_in = feed_in_h(cx, bi);
    let duty = js_max(0.0, cx.st.maps.get("steamBy").and_then(|m| m.get(&id)).unwrap_or(0.0))
        * js_max(0.0, h_of_t(c, T_FEED) - h_in);
    let hs = sat_h(c, cx.boiler_p(bi));
    let m = cx.pf("mBy", &nm).unwrap_or(0.0);
    let ni = cx.meta.net_index.get(&nm).copied();
    let mv = ni.and_then(|i| cx.inp.feed_in_mv.get(i).copied()).unwrap_or(0.0);
    let room = js_max(0.0, mv) * js_max(0.0, hs - h_in)
        + m * js_max(0.0, hs - cx.net_h_at(&nm)) / NET_DT;
    js_min(duty, room)
}

fn bleed_of(cx: &Cx, bi: usize) -> f64 {
    let id = cx.meta.boiler_ids.get(bi).cloned().unwrap_or_default();
    js_min(
        feed_bleed_kgs(cx, bi),
        js_max(0.0, cx.st.maps.get("steamBy").and_then(|m| m.get(&id)).unwrap_or(0.0)),
    )
}

fn rise_cond(cx: &Cx, bi: usize, p: f64) -> f64 {
    js_max(
        1.0,
        sat_hg(cx.curves.of(cx.meta.boiler_circ.get(bi).copied().unwrap_or(-1)), p) - feed_in_h(cx, bi),
    )
}

pub fn shell_step(cx: &mut Cx, sec_vent: &HashMap<String, f64>) -> f64 {
    let mut bleed_all = 0.0;
    let sgw = sg_share(cx);
    for id in cx.st.maps.get("sgTBy").map(|m| m.keys.clone()).unwrap_or_default() {
        if !cx.meta.boiler_ids.contains(&id) {
            cx.st.map_mut("sgTBy").del(&id);
        }
    }
    for id in cx.st.maps.get("sgFedBy").map(|m| m.keys.clone()).unwrap_or_default() {
        if !cx.meta.boiler_ids.contains(&id) {
            cx.st.map_mut("sgFedBy").del(&id);
        }
    }
    for id in cx.st.maps.get("sgPBy").map(|m| m.keys.clone()).unwrap_or_default() {
        if !sgw.contains_key(&id) {
            cx.st.map_mut("sgPBy").del(&id);
        }
    }
    for id in cx.st.bmaps.get("sgBurst").map(|m| m.keys.clone()).unwrap_or_default() {
        if !sgw.contains_key(&id) {
            cx.st.bmaps.entry("sgBurst".into()).or_default().del(&id);
        }
    }
    for id in cx.meta.boiler_ids.clone() {
        cx.st.map_mut("steamBy").set(&id, 0.0);
        cx.st.map_mut("sgVentBy").set(&id, 0.0);
    }
    for (si, id) in cx.meta.sg_ids.clone().iter().enumerate() {
        if cx.meta.sg_mass.get(si).copied().unwrap_or(0.0) <= 0.0 {
            continue;
        }
        if !cx.st.bmaps.get("sgBurst").map(|m| m.keys.contains(id)).unwrap_or(false) {
            cx.st.bmaps.entry("sgBurst".into()).or_default().set(id, false);
        }
        let nd = cx.meta.shell_node.get(si).cloned().unwrap_or_default();
        let ci = cx.meta.shell_circ.get(si).copied().unwrap_or(-1);
        let shell_p = cx.sec_p(si);
        cx.st.map_mut("sgTBy").set(id, sat_t(cx.curves.of(ci), shell_p));
        let fed = cx.inp.sg_feed.get(id).copied().unwrap_or(0.0);
        cx.st.map_mut("sgFedBy").set(id, fed);
        if !cx.st.bmaps.get("sgBurst").map(|m| m.get(id)).unwrap_or(false) && shell_p > cx.meta.sg_burst_p.get(si).copied().unwrap_or(f64::INFINITY) {
            cx.st.bmaps.entry("sgBurst".into()).or_default().set(id, true);
            let gen = cx.st.f("sgBurstGen");
            cx.st.set_f("sgBurstGen", (gen as i64 | 0) as f64 + 1.0);
            cx.log(SEV_ALARM, EV_SG_BURST);
        }
        let open = cx.st.bmaps.get("sgBurst").map(|m| m.get(id)).unwrap_or(false) || cx.part_wrecked(id);
        let steam_to = if open {
            0.0
        } else {
            cx.inp.sg_steam.get(id).copied().unwrap_or(0.0)
        };
        let vent = sec_vent.get(id).copied().unwrap_or(0.0);
        let p = if open {
            cx.region_p_at_opt(cx.part_of(id))
        } else {
            js_max(COND_P0, cx.pf("pBy", &nd).unwrap_or(shell_p))
        };
        cx.st.map_mut("sgPBy").set(id, p);
        let to_cond_cut = js_min(vent, js_max(steam_to, 0.0));
        cx.book("sgVent", vent * cx.inp.dt);
        cx.st.map_mut("steamBy").set(id, steam_to);
        cx.st.map_mut("sgVentBy").set(id, vent);
        if cx.st.maps.get("fregBy").and_then(|m| m.get(id)).is_none() {
            cx.st.map_mut("fregBy").set(id, 0.0);
        }
        if cx.st.maps.get("fregDemBy").and_then(|m| m.get(id)).is_none() {
            let f = cx.st.maps.get("fregBy").and_then(|m| m.get(id)).unwrap_or(0.0);
            cx.st.map_mut("fregDemBy").set(id, f);
        }
        let bi = cx.meta.boiler_ids.iter().position(|b| b == id).unwrap();
        let avail = js_max(0.0, steam_to - to_cond_cut);
        let bleed = js_min(bleed_of(cx, bi), avail);
        bleed_all += bleed;
        if vent > 0.0 {
            let live = cx.part_wrecked(id);
            let act = cx.meta.sg_active_sg.get(si).copied().unwrap_or(false);
            if live && act {
                let shr = vent / js_max(steam_to + vent, 1e-9);
                let cr = cx.inp.cont_rel.get(&format!("sg:{id}")).copied().unwrap_or(1.0);
                let v = cx.st.f("release");
                let add = shr * (js_max(0.0, cx.st.f("sgtrRate")) / SGTR_RATE) * 0.02 * cr * cx.meta.dose * cx.inp.dt;
                cx.st.set_f("release", js_min(100.0, v + add));
            }
        }
    }
    for (bi, id) in cx.meta.boiler_ids.clone().iter().enumerate() {
        if !cx.meta.is_drum.get(bi).copied().unwrap_or(false) {
            continue;
        }
        let nd = cx.meta.boiler_node.get(bi).cloned().unwrap_or_default();
        let _ = nd;
        let ci = cx.meta.boiler_circ.get(bi).copied().unwrap_or(-1);
        let bp = cx.boiler_p(bi);
        let v = sat_t(cx.curves.of(ci), bp);
        cx.st.map_mut("sgTBy").set(id, v);
        let fed = cx.inp.sg_feed.get(id).copied().unwrap_or(0.0);
        cx.st.map_mut("sgFedBy").set(id, fed);
        if cx.st.maps.get("fregBy").and_then(|m| m.get(id)).is_none() {
            cx.st.map_mut("fregBy").set(id, 0.0);
        }
        if cx.st.maps.get("fregDemBy").and_then(|m| m.get(id)).is_none() {
            let f = cx.st.maps.get("fregBy").and_then(|m| m.get(id)).unwrap_or(0.0);
            cx.st.map_mut("fregDemBy").set(id, f);
        }
        let steam_to = if cx.part_wrecked(id) { 0.0 } else { js_max(0.0, drum_steam_kgs(cx, &nd)) };
        cx.st.map_mut("steamBy").set(id, steam_to);
        let bleed = js_min(bleed_of(cx, bi), steam_to);
        bleed_all += bleed;
    }
    bleed_all
}

fn drum_steam_kgs(cx: &Cx, nd: &str) -> f64 {
    let ni = match cx.meta.net_index.get(nd).copied() {
        Some(i) => i,
        None => return 0.0,
    };
    let mut m = 0.0;
    for (e, kg) in cx.inp.advect_edge_kg.iter().enumerate() {
        if cx.meta.edge_gas_at.get(e).copied().unwrap_or(-1) != ni as i32 {
            continue;
        }
        let u = cx.meta.edge_u.get(e).copied().unwrap_or(-1);
        m += if u == ni as i32 { *kg } else { -*kg };
    }
    m / js_max(cx.inp.dt, 1e-9)
}

// ---------------------------------------------------------------------------
// `condVentStep`: lost-vacuum overboard steam.
// ---------------------------------------------------------------------------

pub fn cond_vent_step(cx: &mut Cx) {
    let mut cv = 0.0;
    if cx.st.b("condLost") {
        for key in cx.meta.cond_break_keys.clone() {
            cv += cx.inp.out_kg.get(&key).copied().unwrap_or(0.0);
        }
    }
    cx.st.set_f("condVent", if !cx.st.b("condLost") { 0.0 } else { cv / js_max(cx.inp.dt, 1e-9) });
    if cx.st.f("condVent") > 0.0 && !cx.st.b("condVentSeen") {
        cx.st.set_b("condVentSeen", true);
        cx.log(SEV_WARN, EV_COND_VENT);
    }
}

// ---------------------------------------------------------------------------
// `turbStep`: turbine work + condenser reads.
// ---------------------------------------------------------------------------

pub fn turb_step(cx: &mut Cx, p_cond: f64, bleed_all: f64) {
    cx.st.set_f("turbWk", js_max(0.0, cx.outs_num(0) - bleed_all));
    let a = cx.outs_num(2);
    cx.st.set_f("turbP", if a > 0.0 { cx.outs_num(1) / a } else { p_cond });
    let cur: Vec<String> = cx.st.maps.get("condTBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("condTBy").del(&k);
        }
    }
    let cur: Vec<String> = cx.st.maps.get("condPBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("condPBy").del(&k);
        }
    }
    for (ci, id) in cx.meta.cond_ids.clone().iter().enumerate() {
        let nd = cx.meta.cond_ves_node.get(ci).cloned().unwrap_or_default();
        if let Some(p) = cx.pf("pBy", &nd) {
            if p.is_finite() {
                let pi = cx.part_idx(id);
                let wrecked = pi.and_then(|i| cx.meta.parts.get(i)).map(|p| cx.part_wrecked(&p.id)).unwrap_or(false);
                let v = if wrecked { cx.region_p_at_opt(pi) } else { js_max(COND_P0, p) };
                cx.st.map_mut("condPBy").set(id, v);
            }
        }
        if let Some(t) = cx.cond_t_read(ci) {
            if t.is_finite() {
                cx.st.map_mut("condTBy").set(id, t);
            }
        }
    }
    if let Some(m) = cx.cond_t_mean() {
        cx.st.set_f("condT", m);
    }
}

// ---------------------------------------------------------------------------
// `radPanelStep`: radiator pots + circulating-water inlet tracking.
// ---------------------------------------------------------------------------

pub fn rad_panel_step(cx: &mut Cx) {
    let cp_w = cx.curves.water.cp;
    for (ri, id) in cx.meta.rad_ids.clone().iter().enumerate() {
        let cur = cx.st.maps.get("radTBy").and_then(|m| m.get(id)).unwrap_or(f64::NAN);
        let cap = cx.meta.rad_mass.get(ri).copied().unwrap_or(0.0) * 1000.0 * CP_STEEL
            + cx.meta.part_vol.get(ri).copied().unwrap_or(0.0) * 1000.0 * cp_w;
        let q_in = cx.st.maps.get("radQBy").and_then(|m| m.get(id)).unwrap_or(0.0);
        let q_out = cx.rad_rej_of(ri);
        let skin = cx.st.maps.get("skinQ").and_then(|m| m.get(id)).unwrap_or(0.0);
        cx.st.map_mut("radTBy").set(id, pot_step(cur, cap, q_in, q_out, skin, cx.inp.dt));
    }
    let cur: Vec<String> = cx.st.maps.get("cwInTBy").map(|m| m.keys.clone()).unwrap_or_default();
    for k in cur {
        if !cx.meta.part_ids.iter().any(|p| p == &k) {
            cx.st.map_mut("cwInTBy").del(&k);
        }
    }
    for (ci, id) in cx.meta.cond_ids.clone().iter().enumerate() {
        if let Some(t) = cx.cw_in_of(ci) {
            cx.st.map_mut("cwInTBy").set(id, t);
        }
    }
    if let Some(m) = cx.cw_in_mean() {
        cx.st.set_f("cwInT", m);
    }
}

fn pot_step(t: f64, cap: f64, q_in: f64, q_out: f64, skin: f64, dt: f64) -> f64 {
    clamp(t + (q_in - q_out - skin) / js_max(1.0, cap) * dt, T_SPACE, f64::INFINITY)
}

// ---------------------------------------------------------------------------
// `secTankStep`: secondary reserve metering + overflow.
// ---------------------------------------------------------------------------

pub fn sec_tank_step(cx: &mut Cx) {
    let dt = cx.inp.dt;
    for id in cx.meta.sec_tank_ids.clone() {
        let tid = cx.meta.tank_ids.get(id).cloned().unwrap_or_default();
        cx.st.map_mut("tankOver").set(&tid, 0.0);
    }
    for id in cx.meta.sec_tank_ids.clone() {
        let tid = cx.meta.tank_ids.get(id).cloned().unwrap_or_default();
        let t = &cx.meta.tanks[id];
        if !t.cell {
            continue;
        }
        let cap = js_max(1.0, cx.meta.tank_kg.get(id).copied().unwrap_or(1.0));
        let rk = cx.inp.advect_landed.get(cx.meta.tank_node.get(id).cloned().unwrap_or_default().as_str()).copied().unwrap_or(0.0) / js_max(dt, 1e-9);
        let lvl = cx.st.maps.get("tank").and_then(|m| m.get(&tid)).unwrap_or(f64::NAN);
        let raw = lvl + 100.0 * rk / cap * dt;
        if raw > 100.0 {
            cx.st.map_mut("tankOver").set(&tid, (raw - 100.0) / 100.0 * cap / js_max(dt, 1e-9));
        }
        if !t.inf {
            let v = clamp(raw, 0.0, 100.0);
            cx.st.map_mut("tank").set(&tid, v);
            cx.book("tankClampSec", (raw - v) / 100.0 * cap);
        } else {
            cx.book("boundaryTank", rk * dt);
        }
    }
    if !cx.meta.sec_tank_ids.is_empty() || !cx.meta.cond_ids.is_empty() {
        cx.book("spillSec", cx.inp.advect_out_sec);
    }
}

// ---------------------------------------------------------------------------
// `burstDice`: pipe-burst + wall-lotto dice (BURST / dmgWhy).
// ---------------------------------------------------------------------------

pub fn burst_dice(cx: &mut Cx) {
    if cx.st.net_burst_gen != cx.inp.net_burst_gen {
        cx.st.net_burst_p.clear();
        cx.st.net_burst_gen = cx.inp.net_burst_gen;
    }
    // cellBroken memo rebuilt per call from pre dmgParts (perf-only in JS).
    let mut broke = HashSet::new();
    for id in &cx.st.dmg_parts {
        if let Some(rest) = id.strip_prefix("pipe:") {
            if let Some(c) = rest.find(',') {
                if let (Ok(x), Ok(y)) = (rest[..c].parse::<i32>(), rest[c + 1..].parse::<i32>()) {
                    broke.insert(x * 4096 + y);
                }
            }
        }
    }
    for (ri, r) in cx.meta.pipe_runs.clone().iter().enumerate() {
        if r.cells.is_empty() {
            continue;
        }
        let pa = match cx.pf("pBy", &cx.meta.run_node.get(ri).cloned().unwrap_or_default()) {
            Some(v) => v,
            None => continue,
        };
        let rating = cx.meta.run_rating.get(ri).copied().unwrap_or(0.0);
        let pb = *cx.st.net_burst_p.entry(r.key.clone()).or_insert(rating);
        if pa <= pb {
            continue;
        }
        let mut open = false;
        for (x, y) in &r.cells {
            if broke.contains(&(x * 4096 + y)) {
                open = true;
                break;
            }
        }
        if open {
            continue;
        }
        let n = r.cells.len();
        let c = if cx.st.dice_off {
            r.cells[0]
        } else {
            let f = (cx.srand() * n as f64).floor() as usize;
            r.cells[f.min(n - 1)] };
        let id = format!("pipe:{},{}", c.0, c.1);
        if cx.st.dmg_parts.iter().any(|x| x == &id) {
            continue;
        }
        cx.st.dmg_parts.push(id.clone());
        cx.st.dmg_why.insert(id, "BURST".to_string());
        cx.log(SEV_ALARM, EV_PIPE_BURST);
    }
    let mut lo = f64::INFINITY;
    let mut tie: Vec<i32> = vec![];
    let has_dmg = !cx.st.dmg_parts.is_empty();
    for w in &cx.meta.wall_cells {
        if !(w.tight) {
            continue;
        }
        if has_dmg && cx.st.dmg_parts.iter().any(|x| x == &format!("mat:{}", w.k)) {
            continue;
        }
        let m = w.burst_p - mat_cell_dp(
            &cx.meta.region_of,
            &cx.st.room_p, &cx.st.room_water, &cx.st.room_wp, &cx.st.room_pool, &cx.st.room_pool_p,
            cx.meta.gw, cx.meta.gh, w.x, w.y,
        );
        if m < lo - 1e-9 {
            lo = m;
            tie.clear();
            tie.push(w.x * 4096 + w.y);
        } else if m < lo + 1e-9 {
            tie.push(w.x * 4096 + w.y);
        }
    }
    if !tie.is_empty() && lo <= 0.0 {
        let cpk = if cx.st.dice_off {
            tie[0]
        } else {
            let f = (cx.srand() * tie.len() as f64).floor() as usize;
            tie[f.min(tie.len() - 1)]
        };
        // JS `(cpk/4096)|0` truncates toward zero; cpk >= 0 here.
        let cx2 = cpk / 4096;
        let cy = cpk % 4096;
        let id = format!("mat:{cx2},{cy}");
        cx.st.dmg_parts.push(id.clone());
        cx.st.dmg_why.insert(id, "BURST".to_string());
        cx.log(SEV_ALARM, EV_WALL_BURST);
    }
}

// ---------------------------------------------------------------------------
// replay driver: the extracted fns in true tick-relative order.
// ---------------------------------------------------------------------------

pub struct SecReplay {
    pub inj: f64,
    pub inj_ids: Vec<String>,
    pub cav_ids: Vec<String>,
    pub sec_vent: HashMap<String, f64>,
    pub p_cond: f64,
    pub bleed_all: f64,
    pub events: Vec<LogEv>,
    pub warns: u32,
}

pub fn sec_replay(
    meta: &SecMeta,
    curves: &SecCurves,
    st: &mut SecState,
    inp: &SecIn,
    pump_k: f64,
) -> SecReplay {
    let mut ev = vec![];
    let mut warns = 0u32;
    let mut cx = Cx { meta, curves, st, inp, ev: &mut ev, warns: &mut warns };
    act_follow(&mut cx);
    boron_follow(&mut cx);
    pcore_step(&mut cx);
    press_read(&mut cx);
    spill_step(&mut cx);
    let (inj, inj_ids) = tank_rate_step(&mut cx);
    burst_dice(&mut cx);
    inv_step(&mut cx);
    let cav_ids = cav_step(&mut cx);
    pump_q_step(&mut cx);
    pump_coast_step(&mut cx);
    sg_heat_step(&mut cx, pump_k);
    hold_relief_step(&mut cx);
    disc_tank_step(&mut cx);
    book_tail_step(&mut cx, inj);
    sgtr_step(&mut cx);
    margin_step(&mut cx, pump_k);
    cond_turb_step(&mut cx);
    let (sec_vent, p_cond) = sec_vent_step(&mut cx);
    let bleed_all = shell_step(&mut cx, &sec_vent.clone());
    cond_vent_step(&mut cx);
    turb_step(&mut cx, p_cond, bleed_all);
    rad_panel_step(&mut cx);
    sec_tank_step(&mut cx);
    SecReplay { inj, inj_ids, cav_ids, sec_vent, p_cond, bleed_all, events: ev, warns }
}
