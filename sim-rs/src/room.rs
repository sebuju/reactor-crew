//! Compartment (room) + sump tick scope, ported from `src/data/room.js`
//! (`roomStep` and sub-passes) and `src/sim/step.js` (`sumpStep`,
//! `sumpLiqCb`).
//!
//! Rules: identical IEEE op order to the JS; `Math.max/min` NaN semantics
//! via `eos::js_max/js_min`; transcendentals via `libm` (sdig class);
//! F32 grids compute in f64 and round once on store (`as f32 as f64`),
//! matching V8 doubles with f32 stores. `logE` sites record `(sev, code)`
//! (`tick.rs`); `burnEv`/`fireEv` latches are state for the events gate.
//! Module scratch (`gs*`, `lq*`, plume queues, memos) is replay-local;
//! only `roomCgIt`/`liqCgIt` (warm-start/readout) and `roomPGen` cross as
//! per-sample inputs.

use crate::eos::{clamp, h_of_t, hfg_of, js_max, js_min, sat_h, sat_hg, sat_p, sat_t, t_of_h, x_of_h, Curve, H_DATUM};
use crate::tick::*;
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// constants (mirror room.js; asserted per preset by the gate)
// ---------------------------------------------------------------------------

pub const ROOM_DEPTH: f64 = 4.0;
pub const ROOM_RHO: f64 = 1.2;
pub const ROOM_CP: f64 = 1.0;
pub const ROOM_H: f64 = 6.0;
pub const ROOM_MIX: f64 = 0.35;
pub const ROOM_UP: f64 = 3.0;
pub const ROOM_BLOCK: f64 = 0.12;
pub const ROOM_TMAX: f64 = 20000.0;
pub const T_HULL: f64 = 293.0;
pub const HULL_EMIS: f64 = 0.85;
pub const ROOM_CGAME: f64 = 50.0;
pub const ROOM_CV: f64 = 0.718;
pub const ROOM_SKIN_TAU: f64 = 45.0;
pub const SKIN_PROC_K: f64 = 20.0;
pub const ROOM_VENT_KGS: f64 = 50.0;
pub const INERT_KGS: f64 = 10.0;
pub const ROOM_ENTRAIN: f64 = 25.0;
pub const ROOM_JET_TAU: f64 = 1.0;
pub const R_AIR: f64 = 0.000287;
pub const ROOM_P0: f64 = 101.3;
pub const COND_P0: f64 = 0.004;
pub const T_SPACE: f64 = 3.0;
pub const R_SI: f64 = 287.0;
pub const RHO_K: f64 = 7.0;
pub const SIGMA: f64 = 5.670374419e-8;

pub fn sw_na_for(wh2o: f64, kg_h2o: f64) -> f64 {
    kg_h2o / wh2o
}

pub fn sw_react_row(wlhv: f64, wh2: f64, wh2o: f64, kg_na: f64) -> (f64, f64, f64) {
    (kg_na * wlhv, kg_na * wh2, kg_na * wh2o)
}
pub const WAVE_P_LO: f64 = 0.05;
pub const WAVE_U_LO: f64 = 0.01;
pub const CG_TOL: f64 = 1e-7;
pub const CG_MAX: usize = 200;
pub const HIT_LO: f64 = 5.0;
pub const WATER_RHO: f64 = 1000.0;
pub const WATER_BULK: f64 = 2.2e9;
pub const G_MPA: f64 = 9.81e-6;
pub const G_SI: f64 = G_MPA * 1e6;
pub const LIQ_MANNING: f64 = 0.012;
pub const LIQ_CD: f64 = 0.6;
pub const LIQ_V_MAX: f64 = 30.0;
pub const LIQ_REST: f64 = 0.05;
pub const LIQ_H_LO: f64 = 0.001;
pub const LIQ_CG_TOL: f64 = 1e-9;
pub const LIQ_CG_MAX: usize = 400;
pub const LIQ_FULL_K: f64 = 1.0 - 1e-4;
pub const FACE_TAIL: usize = 16;
pub const ADV_SWEEPS: usize = 4;
pub const POOL_DMIN: f64 = 0.01;
pub const SPRAY_WE0: f64 = 13.0;
pub const SPRAY_WE1: f64 = 40.3;
pub const R_VAP: f64 = 0.0004615;
pub const PAN_DRAIN_KGS: f64 = 20.0;
pub const ROOM_VG_MIN: f64 = 0.01;
pub const ROOM_FR_MIN: f64 = 0.1;
pub const H2_LFL: f64 = 0.04;
pub const H2_UFL: f64 = 0.75;
pub const H2_IGN: f64 = 773.0;
pub const H2_LHV: f64 = 120000.0;
pub const H2_MMOL: f64 = 0.002016;
pub const AIR_MMOL: f64 = 0.02896;
pub const H2O_MMOL: f64 = 0.018015;
pub const O2_FRAC0: f64 = 0.2095;
pub const O2_MMOL: f64 = 0.032;
pub const O2_LOC: f64 = 0.05;
pub const H2_TURB: f64 = 4.0;
pub const H2_UP: f64 = AIR_MMOL / H2_MMOL;
pub const FLOOD_DROWN: f64 = 2.0 / 3.0;
pub const H2_SL: [[f64; 2]; 7] = [
    [0.04, 0.05], [0.10, 0.40], [0.20, 1.30], [0.30, 2.60],
    [0.40, 3.00], [0.60, 1.60], [0.75, 0.30],
];

// Derived per preset from `mpc` (all mirror the JS expressions).
#[derive(Clone, Default)]
pub struct RoomDer {
    pub room_cair: f64,
    pub room_c: f64,
    pub room_cvair: f64,
    pub room_hk: f64,
    pub hull_face_a: f64,
    pub room_vcell: f64,
    pub room_mair: f64,
    pub room_m0: f64,
    pub room_o2_0: f64,
    pub o2_per_h2: f64,
    pub h2_up: f64,
    pub liq_l_min: f64,
}

impl RoomDer {
    pub fn new(mpc: f64, water_cp: f64) -> Self {
        let room_cair = mpc * mpc * ROOM_DEPTH * ROOM_RHO * ROOM_CP;
        let room_c = room_cair * ROOM_CGAME;
        let vcell = mpc * mpc * ROOM_DEPTH;
        let room_m0 = ROOM_P0 / 1000.0 * vcell / (R_AIR * T_HULL);
        let _ = water_cp;
        RoomDer {
            room_cair,
            room_c,
            room_cvair: room_cair * ROOM_CV / ROOM_CP,
            room_hk: ROOM_H * mpc * mpc / 1000.0,
            hull_face_a: mpc * ROOM_DEPTH,
            room_vcell: vcell,
            room_mair: mpc * mpc * ROOM_DEPTH * ROOM_RHO,
            room_m0,
            room_o2_0: O2_FRAC0 * room_m0 / AIR_MMOL * O2_MMOL,
            o2_per_h2: O2_MMOL / (2.0 * H2_MMOL),
            h2_up: AIR_MMOL / H2_MMOL,
            liq_l_min: 0.05 * mpc,
        }
    }
}

// ---------------------------------------------------------------------------
// structural inputs (per preset; resolved by the dumper off the live plant)
// ---------------------------------------------------------------------------

/// One LAY part (flood loop, G parts, role reads).
#[derive(Clone)]
pub struct RoomPart {
    pub id: String,
    pub role: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub on: Option<String>,
}

/// One role row (flood/drown, thermal doors, internal faces).
#[derive(Clone)]
pub struct RoleRow {
    pub drown: bool,
    pub thermal: String,
    pub internal: Vec<(String, String)>,
}

/// One byKey run (roomOpenCells + bore).
#[derive(Clone)]
pub struct ByRun {
    pub cells: Vec<(i32, i32)>,
    pub pa: Option<String>,
    pub pb: Option<String>,
}

/// Sodium-fire row (full FIRE columns used by the room).
#[derive(Clone)]
pub struct FireFull {
    pub lhv: f64,
    pub o2: f64,
    pub ign: f64,
    pub melt: f64,
    pub boil: f64,
    pub lf: f64,
    pub rate: f64,
    pub loc: f64,
    pub emis: f64,
    pub h_conv: f64,
    pub sigma: f64,
    pub eta: f64,
    pub wlhv: f64,
    pub wh2: f64,
    pub wh2o: f64,
    pub wrate: f64,
    pub wast: f64,
    pub wast_max: f64,
}

/// COOLANT burn row (fireCp/Rho/bulk).
#[derive(Clone)]
pub struct FireCool {
    pub cp: f64,
    pub dens: f64,
    pub bulk: f64,
}

/// Per-preset structural tables + scalar consts.
pub struct RoomMeta {
    pub gw: usize,
    pub gh: usize,
    pub mpc: f64,
    pub pcont: f64,
    pub loop_kg: f64,
    pub steam_rise: f64,
    pub room_steam_h: f64,
    pub der: RoomDer,
    pub parts: Vec<RoomPart>,
    pub roles: HashMap<String, RoleRow>,
    pub face_nodes: HashMap<String, (String, String, String, String)>,
    pub core_ids: Vec<String>,
    pub core_nb: HashMap<String, usize>,
    pub tank_bkp: f64,
    pub relief_ids: Vec<String>,
    pub relief_sec: Vec<String>,
    pub boiler_ids: Vec<String>,
    pub shell_node: HashMap<String, String>,
    pub part_roles: HashMap<String, String>,
    pub part_on: HashMap<String, Option<String>>,
    pub tank_hold: HashMap<String, bool>,
    pub primary_relief: Option<String>,
    pub vent_key: HashMap<String, String>,
    pub circ_burn: Vec<Option<String>>,
    pub mat_tight: Vec<(i32, i32)>,
    pub region_of: Vec<i32>,
    pub n_regions: usize,
    pub fire_rows: HashMap<String, FireFull>,
    pub fire_cool: Option<FireCool>,
    pub by_runs: HashMap<String, ByRun>,
    pub port_cells: HashMap<String, Option<(i32, i32)>>,
    pub fit_target: HashSet<String>,
    pub fit_vent_out: HashSet<String>,
    pub circ_of_node: Vec<i32>,
    pub circ_key_of: Vec<Option<String>>,
    pub core_circs: Vec<bool>,
    pub authored: Vec<bool>,
    pub tref: f64,
    pub net_names: Vec<String>,
    pub net_index: HashMap<String, usize>,
    pub net_vapour: Vec<u8>,
    pub circ_of_extra: HashMap<String, i32>,
    // base G (static per preset; the live hole overlay is recomputed).
    pub g_occ: Vec<u8>,
    pub g_tight: Vec<u8>,
    pub g_face: Vec<u8>,
    pub g_own: Vec<i32>,
    pub g_pan: Vec<u8>,
    pub g_turb: Vec<f64>,
    pub g_parts: Vec<(String, Vec<usize>)>,
    pub g_runs: Vec<(String, Vec<usize>)>,
    pub g_shell_valves: HashMap<String, Vec<String>>,
    pub g_bx: Vec<f64>,
    pub g_by: Vec<f64>,
    pub g_gx: Vec<f64>,
    pub g_gup: Vec<f64>,
    pub g_gdn: Vec<f64>,
}

/// Per-circuit curves for the readers.
pub struct RoomCurves {
    pub curves: Vec<Curve>,
    pub water: Curve,
    pub set_p: Vec<f64>,
}

impl RoomCurves {
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
// live state (owned; probe fills pre, replay mutates, probe compares post)
// ---------------------------------------------------------------------------

/// String→f64 bag preserving insertion order for exact comparison.
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
}

/// The mutable room state for one replay. F32 grids are kept as f64
/// internally (exactly f32-representable after every store); arithmetic
/// runs in f64 and rounds once on store, matching V8 doubles+f32 stores.
#[derive(Clone, Default)]
pub struct RoomState {
    pub f64s: HashMap<String, f64>,
    pub u8s: HashMap<String, bool>,
    pub i32s: HashMap<String, i32>,
    pub maps: HashMap<String, SMap>,
    pub bags: HashMap<String, Bag>,
    pub cores: HashMap<String, DmgCore>,
    pub dmg_parts: Vec<String>,
    pub dmg_why: HashMap<String, String>,
    pub mass_out: HashMap<String, f64>,
    pub mass_out_order: Vec<String>,
    pub burn_kg: f64,
    pub burn_p: f64,
    pub burn_blast: f64,
    pub burn_ids: Vec<String>,
    pub fire_kg: f64,
    pub fire_p: f64,
    pub fire_q: f64,
    pub grids_f64: HashMap<String, Vec<f64>>,
    pub grids_f32: HashMap<String, Vec<f64>>,
}

impl RoomState {
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
    pub fn map_mut(&mut self, k: &str) -> &mut SMap {
        self.maps.entry(k.to_string()).or_default()
    }
    /// f32 store: round once, like a Float32Array write.
    pub fn set_f32(grid: &mut Vec<f64>, i: usize, v: f64) {
        if i < grid.len() {
            grid[i] = v as f32 as f64;
        }
    }
}

// ---------------------------------------------------------------------------
// per-sample inputs (dump-kit: solved/transport artifacts + tool orders)
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct RoomInject {
    pub present: bool,
    pub kind: u8,
    pub rate: f64,
    pub target: i32,
}

#[derive(Clone, Default)]
pub struct RoomIn {
    pub dt: f64,
    /// Insertion-ordered keys (JS `for-in` order drives float-sum order).
    pub spill_keys: Vec<String>,
    pub spill_by: HashMap<String, f64>,
    pub relief_keys: Vec<String>,
    pub relief_vent: HashMap<String, f64>,
    pub out_kg: HashMap<String, f64>,
    pub out_h2: HashMap<String, f64>,
    pub bore: HashMap<String, f64>,
    pub inj: RoomInject,
    pub cg_it: u32,
    pub pgen: u32,
    pub gsx: Vec<f64>,
    pub disp: Vec<f64>,
}

// ---------------------------------------------------------------------------
// replay outputs
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct RoomOut {
    pub events: Vec<LogEv>,
    pub warns: u32,
    pub cg_it: u32,
    pub liq_it: u32,
}

// ---------------------------------------------------------------------------
// replay context: structural meta + curves + live state + dump-kit inputs
// ---------------------------------------------------------------------------

pub struct Cx<'a> {
    pub meta: &'a RoomMeta,
    pub curves: &'a RoomCurves,
    pub st: &'a mut RoomState,
    pub inp: &'a RoomIn,
    pub ev: &'a mut Vec<LogEv>,
    pub warns: &'a mut u32,
    pub sc: &'a mut Scratch,
}

/// Dev-only live-gate trace flag (set by room-probe under PROBE_DEBUG).
pub static LIQ_DEBUG: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
/// Dev-only current sample index for the trace.
pub static LIQ_SI: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
/// Dev-only current preset index for the trace.
pub static LIQ_PI: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);

/// Replay-local scratch (module scratch in JS, re-cut per replay).
#[derive(Default)]
pub struct Scratch {
    pub src: Vec<f64>,
    pub d: Vec<f64>,
    pub d2: Vec<f64>,
    pub y: Vec<f64>,
    pub gs: GasScratch,
    pub lq: LiqScratch,
    pub seen: Vec<i32>,
    pub q: Vec<i32>,
    pub ring: Vec<i32>,
    pub gen: i32,
    pub mark: i32,
    pub tail: usize,
    pub add_i: Vec<usize>,
    pub add_w: Vec<f64>,
    pub gd_q: Vec<i32>,
    pub gd_seen: Vec<i32>,
    pub gd_k: i32,
    pub gd_ring: Vec<usize>,
    pub gs_y0: Vec<f64>,
    pub gs_y: Vec<f64>,
    pub fire_q: Vec<f64>,
    pub pstat: Vec<f64>,
    pub pstat_gen: u32,
    pub pstat_init: bool,
    pub pgen_cur: u32,
    pub cg_it: u32,
    pub liq_it: u32,
    pub rmean: Vec<f64>,
    pub rmean_gen: u32,
    pub rmean_init: bool,
    pub rmean_n: usize,
    pub disp: Vec<f64>,
    pub plume_n: usize,
}

#[derive(Default)]
pub struct GasScratch {
    pub p: Vec<f64>,
    pub vg: Vec<f64>,
    pub di: Vec<f64>,
    pub ax: Vec<f64>,
    pub ay: Vec<f64>,
    pub b: Vec<f64>,
    pub x: Vec<f64>,
    pub r: Vec<f64>,
    pub z: Vec<f64>,
    pub dd: Vec<f64>,
    pub ap: Vec<f64>,
    pub j: Vec<f64>,
    pub fx: Vec<f64>,
    pub fy: Vec<f64>,
    pub out: Vec<f64>,
    pub f: Vec<f64>,
    pub m0: Vec<f64>,
    pub k: Vec<f64>,
    pub ki: Vec<f64>,
    pub inn: Vec<f64>,
}

#[derive(Default)]
pub struct LiqScratch {
    pub p: Vec<f64>,
    pub h: Vec<f64>,
    pub hc: Vec<f64>,
    pub cap: Vec<f64>,
    pub comp: Vec<f64>,
    pub ax: Vec<f64>,
    pub ay: Vec<f64>,
    pub ayd: Vec<f64>,
    pub b: Vec<f64>,
    pub x: Vec<f64>,
    pub fx: Vec<f64>,
    pub fy: Vec<f64>,
    pub m0: Vec<f64>,
    pub di: Vec<f64>,
    pub gas: Vec<f64>,
    pub awx: Vec<f64>,
    pub awy: Vec<f64>,
    pub lcap: Vec<f64>,
    pub lat: Vec<f64>,
    pub full: Vec<u8>,
    pub stand: Vec<u8>,
    pub stiff: Vec<u8>,
}

impl Scratch {
    pub fn size(&mut self, n: usize) {
        let z = || vec![0.0; n];
        self.src = z();
        self.d = z();
        self.d2 = z();
        self.y = z();
        let g = &mut self.gs;
        g.p = z();
        g.vg = z();
        g.di = z();
        g.ax = z();
        g.ay = z();
        g.b = z();
        g.r = z();
        g.z = z();
        g.dd = z();
        g.ap = z();
        g.j = z();
        g.fx = z();
        g.fy = z();
        g.out = z();
        g.f = z();
        g.m0 = z();
        g.k = z();
        g.ki = z();
        g.inn = z();
        let l = &mut self.lq;
        l.p = z();
        l.h = z();
        l.hc = z();
        l.cap = z();
        l.comp = z();
        l.ax = z();
        l.ay = z();
        l.ayd = z();
        l.b = z();
        l.x = z();
        l.fx = z();
        l.fy = z();
        l.m0 = z();
        l.di = z();
        l.gas = z();
        l.awx = z();
        l.awy = z();
        l.lcap = z();
        l.lat = z();
        l.full = vec![0; n];
        l.stand = vec![0; n];
        l.stiff = vec![0; n];
        self.seen = vec![0; n];
        self.q = vec![0; n];
        self.ring = vec![0; n];
        self.gd_q = vec![0; n];
        self.gd_seen = vec![0; n];
        self.gs_y0 = z();
        self.gs_y = z();
        self.fire_q = z();
        self.pstat = z();
        self.rmean = vec![0.0; self.rmean_n];
        self.disp = z();
    }
}

// Process-global once-flags for the `[room] ... stopped short` warns,
// mirroring the module `cgCapWarned` (warn once per tag per process).
static CAP_WARNED: std::sync::OnceLock<std::sync::Mutex<HashSet<String>>> =
    std::sync::OnceLock::new();

fn cap_warned(tag: &str) -> bool {
    let set = CAP_WARNED.get_or_init(|| std::sync::Mutex::new(HashSet::new()));
    let mut g = set.lock().unwrap();
    if g.contains(tag) {
        return true;
    }
    g.insert(tag.to_string());
    false
}

/// Harness-only: fresh once-flags per sample, mirroring a gate that clears
/// `cgCapWarned` around each sample's fns (evolution warns must not suppress
/// sample warns on either side).
pub fn cap_warned_reset() {
    if let Some(set) = CAP_WARNED.get() {
        set.lock().unwrap().clear();
    }
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
    pub fn warn(&mut self, tag: String) {
        if !cap_warned(&tag) {
            *self.warns += 1;
        }
    }
    /// `circOfNode` off the dumped per-name table (net names) or extras.
    pub fn circ_of(&self, nid: &str) -> i32 {
        if let Some(i) = self.meta.net_index.get(nid) {
            return self.meta.circ_of_node.get(*i).copied().unwrap_or(-1);
        }
        self.meta.circ_of_extra.get(nid).copied().unwrap_or(-1)
    }
    pub fn vapour(&self, nid: &str) -> bool {
        self.meta.net_index.get(nid).and_then(|i| self.meta.net_vapour.get(*i)).copied().unwrap_or(0) != 0
    }
    /// `holdSetP`: dumped per-circuit table; ci < 0 reads the compartment base.
    pub fn hold_set_p(&self, ci: i32) -> f64 {
        if ci == i32::MIN {
            return 0.0;
        }
        if ci < 0 {
            return self.meta.pcont;
        }
        self.curves.set_p(ci)
    }
    /// Bag read `pfAt` over a dumped holder bag.
    pub fn pf(&self, bag: &str, nid: &str) -> Option<f64> {
        let i = self.meta.net_index.get(nid)?;
        self.st.bags.get(bag).and_then(|b| b.get(*i))
    }
    /// `netPAt`, with the compartment-base fallback for nodes off the net.
    pub fn net_p_at(&self, nid: Option<&str>) -> f64 {
        if let Some(n) = nid {
            if let Some(i) = self.meta.net_index.get(n) {
                if let Some(v) = self.st.bags.get("pBy").and_then(|b| b.get(*i)) {
                    return js_max(COND_P0, v);
                }
            }
            let c = self.hold_set_p(self.circ_of(n));
            return js_max(COND_P0, if c > 0.0 { c } else { self.st.f("P") });
        }
        js_max(COND_P0, self.meta.pcont)
    }
    /// `netHAt`.
    pub fn net_h_at(&self, nid: &str) -> f64 {
        if let Some(v) = self.pf("hBy", nid) {
            return v;
        }
        let ci = self.circ_of(nid);
        let c = self.curves.of(ci);
        if ci >= 0 && self.meta.authored.get(ci as usize).copied().unwrap_or(false) {
            return h_of_t(c, self.tavg_of(ci));
        }
        let p = self.net_p_at(Some(nid));
        if self.vapour(nid) {
            sat_hg(c, p)
        } else {
            h_of_t(c, sat_t(c, p))
        }
    }
    pub fn net_temp_at(&self, nid: &str) -> f64 {
        let c = self.curves.of(self.circ_of(nid));
        t_of_h(c, self.net_p_at(Some(nid)), self.net_h_at(nid))
    }
    pub fn net_qual_at(&self, nid: &str) -> f64 {
        let c = self.curves.of(self.circ_of(nid));
        x_of_h(c, self.net_p_at(Some(nid)), self.net_h_at(nid))
    }
    /// `TavgOf`.
    pub fn tavg_of(&self, ci: i32) -> f64 {
        if ci >= 0 {
            if let Some(k) = self.meta.circ_key_of.get(ci as usize).and_then(|o| o.clone()) {
                if let Some(v) = self.st.maps.get("TavgBy").and_then(|m| m.get(&k)) {
                    return v;
                }
            }
        }
        self.st.f("Tavg")
    }
    /// Live G overlay: shot-open wall cells from `dmgParts`, recomputed
    /// face masks off the dumped base arrays (mirrors `roomGeomLive`).
    pub fn live_g(&self) -> LiveG {
        let meta = self.meta;
        let n = meta.gw * meta.gh;
        let mut hole = vec![0u8; n];
        for id in &self.st.dmg_parts {
            if let Some(rest) = id.strip_prefix("mat:") {
                if let Some(c) = rest.find(',') {
                    if let (Ok(x), Ok(y)) = (rest[..c].parse::<i32>(), rest[c + 1..].parse::<i32>()) {
                        if x >= 0 && y >= 0 && x < meta.gw as i32 && y < meta.gh as i32
                            && meta.mat_tight.contains(&(x, y))
                        {
                            hole[(y as usize) * meta.gw + (x as usize)] = 1;
                        }
                    }
                }
            }
        }
        let parts_cells: HashMap<String, Vec<usize>> = meta.g_parts.iter().cloned().collect();
        if hole.iter().all(|&v| v == 0) {
            return LiveG {
                bx: meta.g_bx.clone(),
                by: meta.g_by.clone(),
                gx: meta.g_gx.clone(),
                gup: meta.g_gup.clone(),
                gdn: meta.g_gdn.clone(),
                hole,
                parts_cells,
            };
        }
        let gw = meta.gw as i32;
        let g0 = ROOM_MIX * meta.der.room_c / (meta.mpc * meta.mpc);
        let blk = |tight: &[u8], occ: &[u8], h: &[u8], i: usize| -> f64 {
            if h[i] != 0 {
                1.0
            } else if tight[i] != 0 {
                0.0
            } else if occ[i] != 0 {
                ROOM_BLOCK
            } else {
                1.0
            }
        };
        let mut bx = vec![0.0; n];
        let mut by = vec![0.0; n];
        let mut gx = vec![0.0; n];
        let mut gup = vec![0.0; n];
        let mut gdn = vec![0.0; n];
        for y in 0..meta.gh as i32 {
            for x in 0..gw {
                let i = (y as usize) * meta.gw + (x as usize);
                if x < gw - 1 {
                    bx[i] = blk(&meta.g_tight, &meta.g_occ, &hole, i)
                        * blk(&meta.g_tight, &meta.g_occ, &hole, i + 1);
                    gx[i] = g0 * bx[i];
                }
                if y < meta.gh as i32 - 1 {
                    by[i] = blk(&meta.g_tight, &meta.g_occ, &hole, i)
                        * blk(&meta.g_tight, &meta.g_occ, &hole, i + meta.gw);
                    let b = g0 * by[i];
                    gup[i] = b * ROOM_UP;
                    gdn[i] = b;
                }
            }
        }
        LiveG { bx, by, gx, gup, gdn, hole, parts_cells }
    }
    /// `roomComp`: flood-fill compartments off the live face mask.
    pub fn room_comp(&self, g: &LiveG) -> Vec<i32> {
        let (gw, gh) = (self.meta.gw, self.meta.gh);
        let n = gw * gh;
        let mut c = vec![-1i32; n];
        let mut st = vec![];
        let mut nc = 0;
        for i0 in 0..n {
            if c[i0] >= 0 {
                continue;
            }
            c[i0] = nc;
            st.push(i0);
            while let Some(i) = st.pop() {
                let x = i % gw;
                if x < gw - 1 && g.bx[i] != 0.0 && c[i + 1] < 0 {
                    c[i + 1] = nc;
                    st.push(i + 1);
                }
                if x > 0 && g.bx[i - 1] != 0.0 && c[i - 1] < 0 {
                    c[i - 1] = nc;
                    st.push(i - 1);
                }
                if i + gw < n && g.by[i] != 0.0 && c[i + gw] < 0 {
                    c[i + gw] = nc;
                    st.push(i + gw);
                }
                if i >= gw && g.by[i - gw] != 0.0 && c[i - gw] < 0 {
                    c[i - gw] = nc;
                    st.push(i - gw);
                }
            }
            nc += 1;
        }
        c
    }
    pub fn part_wrecked(&self, id: &str) -> bool {
        self.st.dmg_parts.iter().any(|x| x == id)
    }
    /// f32 store helper for state grids.
    pub fn set32(&mut self, grid: &str, i: usize, v: f64) {
        if let Some(g) = self.st.grids_f32.get_mut(grid) {
            RoomState::set_f32(g, i, v);
        }
    }
    pub fn grid32(&self, grid: &str, i: usize) -> f64 {
        self.st.grids_f32.get(grid).and_then(|g| g.get(i)).copied().unwrap_or(0.0)
    }
    pub fn grid64(&self, grid: &str, i: usize) -> f64 {
        self.st.grids_f64.get(grid).and_then(|g| g.get(i)).copied().unwrap_or(0.0)
    }
}

/// Live geometry for the tick: recomputed face masks (hole overlay) +
/// static part-cell lookup.
pub struct LiveG {
    pub bx: Vec<f64>,
    pub by: Vec<f64>,
    pub gx: Vec<f64>,
    pub gup: Vec<f64>,
    pub gdn: Vec<f64>,
    pub hole: Vec<u8>,
    pub parts_cells: HashMap<String, Vec<usize>>,
}

// ---------------------------------------------------------------------------
// fluid readers + `roomLiqOuts` + open cells + plumes
// ---------------------------------------------------------------------------

/// One opening's fluid: enthalpy, circuit (curve), donor node if any.
pub struct Fluid {
    pub h: f64,
    pub ci: i32,
    pub nd: Option<String>,
}

impl<'a> Cx<'a> {
    /// `partTemp`: a box's contents temperature, or null.
    pub fn part_temp(&self, pid: &str) -> Option<f64> {
        let role = self.meta.parts.iter().find(|p| p.id == pid)?.role.clone();
        let th = self.meta.roles.get(&role).map(|r| r.thermal.as_str()).unwrap_or("none");
        if th == "none" {
            return None;
        }
        if role == "sg" {
            return self.st.maps.get("sgTBy").and_then(|m| m.get(pid));
        }
        if role == "ihx" {
            let faces = self.meta.face_nodes.get(pid).cloned().unwrap_or_default();
            let ins = self.meta.roles.get(&role).map(|r| r.internal.clone()).unwrap_or_default();
            let mut t = 0.0;
            let mut n = 0u32;
            for (a, b) in &ins {
                let fa = match a.as_str() {
                    "t" => &faces.0, "r" => &faces.1, "b" => &faces.2, _ => &faces.3,
                };
                let fb = match b.as_str() {
                    "t" => &faces.0, "r" => &faces.1, "b" => &faces.2, _ => &faces.3,
                };
                t += self.net_temp_at(fa);
                n += 1;
                t += self.net_temp_at(fb);
                n += 1;
            }
            return if n > 0 { Some(t / n as f64) } else { Some(self.st.f("Tavg")) };
        }
        if role == "cond" {
            return self.st.maps.get("condTBy").and_then(|m| m.get(pid));
        }
        if role == "radiator" {
            return self.st.maps.get("radTBy").and_then(|m| m.get(pid));
        }
        Some(self.st.f("Tavg"))
    }
    /// `partSkin`.
    pub fn part_skin(&self, pid: &str) -> f64 {
        match self.st.maps.get("partT").and_then(|m| m.get(pid)) {
            Some(v) => v,
            None => self.part_temp(pid).unwrap_or(T_HULL),
        }
    }
    /// `partFluidNode`: highest-pressure readable face node.
    pub fn part_fluid_node(&self, pid: &str) -> Option<String> {
        let faces = self.meta.face_nodes.get(pid)?.clone();
        let mut best: Option<String> = None;
        let mut bp = f64::NEG_INFINITY;
        for nm in [faces.0, faces.1, faces.2, faces.3] {
            if self.meta.net_index.get(&nm).is_none() {
                continue;
            }
            let p = self.net_p_at(Some(&nm));
            if !(p > bp) {
                continue;
            }
            if !self.net_temp_at(&nm).is_finite() {
                continue;
            }
            bp = p;
            best = Some(nm);
        }
        best
    }
    pub fn part_fluid_h(&self, pid: &str) -> Option<Fluid> {
        let nd = self.part_fluid_node(pid)?;
        let h = self.net_h_at(&nd);
        if !h.is_finite() {
            return None;
        }
        Some(Fluid { h, ci: self.circ_of(&nd), nd: Some(nd) })
    }
    pub fn run_fluid_t(&self, key: &str) -> Option<f64> {
        let nid = format!("run:{key}");
        if self.meta.net_index.get(&nid).is_none() {
            return None;
        }
        let v = self.net_temp_at(&nid);
        if std::env::var("PROBE_DEBUG").is_ok() && key.contains("hpi") {
            eprintln!("rstf {key} nid={nid} p={} h={} ci={} v={v}", self.net_p_at(Some(&nid)), self.net_h_at(&nid), self.circ_of(&nid));
        }
        if v.is_finite() {
            Some(v)
        } else {
            None
        }
    }
    pub fn run_fluid_h(&self, key: &str) -> Option<Fluid> {
        let nid = format!("run:{key}");
        if self.meta.net_index.get(&nid).is_none() {
            return None;
        }
        let h = self.net_h_at(&nid);
        if !h.is_finite() {
            return None;
        }
        Some(Fluid { h, ci: self.circ_of(&nid), nd: None })
    }
    /// `breakPart` / `breakCav`.
    pub fn open_fluid_h(&self, k: &str) -> Option<Fluid> {
        if let Some(cid) = k.strip_prefix("break:cav:") {
            let nd = format!("cav:{cid}");
            let h = self.net_h_at(&nd);
            return if h.is_finite() {
                Some(Fluid { h, ci: self.circ_of(&nd), nd: Some(nd) })
            } else {
                None
            };
        }
        let t = k.strip_prefix("break:").unwrap_or(k);
        if t.find(':').is_none() {
            return self.part_fluid_h(t);
        }
        self.run_fluid_h(t)
    }
    /// `openFlashX`.
    pub fn open_flash_x(&self, fl: &Fluid, i: i32) -> f64 {
        let c = self.curves.of(fl.ci);
        let p = (ROOM_P0
            + if i >= 0 {
                js_max(0.0, self.grid32("roomP", i as usize))
            } else {
                0.0
            })
            / 1000.0;
        let ts = sat_t(c, p);
        let hfg = hfg_of(c, ts);
        if hfg > 0.0 {
            clamp((fl.h - sat_h(c, p)) / hfg, 0.0, 1.0)
        } else {
            1.0
        }
    }
    /// `roomOpenCells`: break cells actually cut.
    pub fn room_open_cells(&self, g: &LiveG, key: &str) -> Vec<usize> {
        let t = key.strip_prefix("break:").unwrap_or(key);
        // `breakPart(key) || breakCav(key)`: a bare part id, or the core id
        // behind a cavity key (whose cells are the vessel's own).
        let pid = if t.find(':').is_none() {
            Some(t)
        } else {
            key.strip_prefix("break:cav:")
        };
        if let Some(p) = pid {
            if !p.is_empty() {
                if let Some(cells) = g.parts_cells.get(p) {
                    return cells.clone();
                }
            }
            return vec![];
        }
        let gw = self.meta.gw;
        let mut out = vec![];
        if let Some(r) = self.meta.by_runs.get(t) {
            for (x, y) in &r.cells {
                if self.cell_broken(*x, *y) {
                    out.push((*y as usize) * gw + (*x as usize));
                }
            }
            for pid in [&r.pa, &r.pb] {
                if let Some(p) = pid {
                    if self.part_wrecked(&format!("port:{p}")) {
                        if let Some((x, y)) = self.meta.port_cells.get(p).copied().flatten() {
                            out.push((y as usize) * gw + (x as usize));
                        }
                    }
                }
            }
        }
        out
    }
    pub fn cell_broken(&self, x: i32, y: i32) -> bool {
        let id = format!("pipe:{x},{y}");
        self.st.dmg_parts.iter().any(|v| v == &id)
    }
    /// `roomPourCells`: bottom-row mid cell for breaks, else the cells.
    pub fn room_pour_cells(&self, key: &str, cells: &[usize]) -> Vec<usize> {
        let t = key.strip_prefix("break:").unwrap_or(key);
        let is_part = t.find(':').is_none();
        let is_cav = key.starts_with("break:cav:");
        if !key.starts_with("break:") || !(is_part || is_cav) || cells.is_empty() {
            return cells.to_vec();
        }
        let gw = self.meta.gw;
        let mut lo = -1i32;
        for i in cells {
            lo = js_max(lo as f64, (*i / gw) as f64) as i32;
        }
        let mut row: Vec<usize> = cells.iter().copied().filter(|i| (*i / gw) as i32 == lo).collect();
        row.sort();
        vec![row[row.len() >> 1]]
    }
    /// `roomLiqOuts`: one walk over spill + unvented relief breaks.
    /// Returns work items (collect-then-process: the callback reborrows Cx).
    /// `spillBy`/`reliefVent` are solved outs (dump-kit inputs, not state).
    pub fn room_liq_outs(&self, g: &LiveG) -> Vec<(Vec<usize>, f64, Fluid, String)> {
        let mut out = vec![];
        for k in &self.inp.spill_keys {
            let rate = self.inp.spill_by.get(k).copied().unwrap_or(0.0);
            if !(self.inp.out_kg.get(k).copied().unwrap_or(0.0) > 0.0) {
                continue;
            }
            if let Some(fl) = self.open_fluid_h(k) {
                let cells = self.room_open_cells(g, k);
                out.push((cells, rate, fl, k.clone()));
            }
        }
        for fid in &self.inp.relief_keys {
            let rate = self.inp.relief_vent.get(fid).copied().unwrap_or(0.0);
            if self.meta.fit_target.contains(fid) || self.meta.fit_vent_out.contains(fid) {
                continue;
            }
            if let Some(fl) = self.part_fluid_h(fid) {
                let cells = g.parts_cells.get(fid).cloned().unwrap_or_default();
                let vk = self.meta.vent_key.get(fid).cloned().unwrap_or_default();
                out.push((cells, rate, fl, vk));
            }
        }
        out
    }
    /// BFS plume off the opening over the BASE tight mask; returns the count.
    pub fn room_plume(&mut self, cells: &[usize], n: usize) -> usize {
        let (gw, gh) = (self.meta.gw, self.meta.gh);
        let nn = gw * gh;
        self.sc.gen += 1;
        let mark = self.sc.gen;
        self.sc.tail = 0;
        let tight = self.meta.g_tight.clone();
        for i in cells {
            if *i >= nn {
                continue;
            }
            if self.sc.seen[*i] != mark {
                self.sc.seen[*i] = mark;
                self.sc.ring[*i] = 0;
                self.sc.q[self.sc.tail] = *i as i32;
                self.sc.tail += 1;
            }
        }
        let mut head = 0usize;
        while head < self.sc.tail && self.sc.tail < n {
            let i = self.sc.q[head] as usize;
            head += 1;
            let x = i % gw;
            let y = i / gw;
            let r = self.sc.ring[i] + 1;
            let mut push = |j: usize| {
                if self.sc.seen[j] != mark && tight[j] == 0 && self.sc.tail < n {
                    self.sc.seen[j] = mark;
                    self.sc.ring[j] = r;
                    self.sc.q[self.sc.tail] = j as i32;
                    self.sc.tail += 1;
                }
            };
            if y > 0 {
                push(i - gw);
            }
            if x > 0 {
                push(i - 1);
            }
            if x < gw - 1 {
                push(i + 1);
            }
            if y < gh - 1 {
                push(i + gw);
            }
        }
        self.sc.tail
    }
    /// `roomShare`: 1/(1+ring) weights over the plume.
    pub fn room_share(&mut self, cells: &[usize], kgps: f64, mut put: impl FnMut(&mut Cx, usize, f64)) {
        if cells.is_empty() {
            return;
        }
        let (gw, gh) = (self.meta.gw, self.meta.gh);
        let n = clamp(
            libm::round(kgps * ROOM_ENTRAIN * ROOM_JET_TAU / self.meta.der.room_mair),
            cells.len() as f64,
            (gw * gh) as f64,
        ) as usize;
        // collect (cell, ring) first: `put` re-enters Cx (no aliasing).
        let mut items = vec![];
        let tail = self.room_plume(cells, n);
        for k in 0..tail {
            let i = self.sc.q[k] as usize;
            items.push((i, self.sc.ring[i]));
        }
        let mut w = 0.0;
        for (_, r) in &items {
            w += 1.0 / (1.0 + *r as f64);
        }
        for (i, r) in items {
            let f = 1.0 / (1.0 + r as f64) / w;
            put(self, i, f);
        }
    }
    pub fn room_jet(&mut self, cells: &[usize], kw: f64, kgps: f64) {
        self.room_share(cells, kgps, |cx, i, f| {
            let v = cx.grid_src(i) + kw * f;
            cx.set_src(i, v);
        });
    }
    /// `roomAddH2`.
    pub fn room_add_h2(&mut self, cells: &[usize], kgps: f64, kg: f64) {
        if !(kg > 0.0) {
            return;
        }
        self.room_share(cells, kgps, |cx, i, f| {
            cx.set_f32grid("roomH2", i, cx.grid32("roomH2", i) + kg * f);
            cx.set_f32grid("roomM", i, cx.grid32("roomM", i) + kg * f);
        });
    }
    /// `roomAddGas`.
    pub fn room_add_gas(&mut self, cells: &[usize], kg: f64, kgps: f64) {
        if !(kg > 0.0) {
            return;
        }
        let mut items: Vec<(usize, f64)> = vec![];
        let mut w = 0.0;
        self.room_share(cells, kgps, |cx, i, f| {
            let v = f * cx.room_vgas(i);
            items.push((i, v));
            w += v;
        });
        if !(w > 0.0) {
            return;
        }
        for (i, v) in items {
            let dm = kg * v / w;
            self.set_f32grid("roomM", i, self.grid32("roomM", i) + dm);
            self.set_f32grid("roomVap", i, self.grid32("roomVap", i) + dm);
        }
    }
    /// `roomJetLiq`.
    pub fn room_jet_liq(&mut self, cells: &[usize], kg: f64, h: f64, ci: i32) {
        if !(kg > 0.0) {
            return;
        }
        let c = self.curves.of(ci).clone();
        self.room_share(cells, kg, |cx, i, f| {
            let t = cx.grid64("roomT", i);
            let v = cx.grid_src(i) + kg * f * (h - h_of_t(&c, t));
            cx.set_src(i, v);
        });
    }
    /// `roomVgas`: m3 of gas over whatever stands on the floor.
    pub fn room_vgas(&self, i: usize) -> f64 {
        let w = self.grid64("roomWater", i);
        let p = self.grid64("roomPool", i);
        let fr = self.fire_rho();
        js_max(
            ROOM_VG_MIN * self.meta.der.room_vcell,
            self.meta.der.room_vcell - w / WATER_RHO - p / fr,
        )
    }
    pub fn room_gas_cell(&self, vg: f64) -> bool {
        vg > ROOM_VG_MIN * self.meta.der.room_vcell * 1.0001
    }
    pub fn fire_rho(&self) -> f64 {
        self.meta.fire_cool.as_ref().map(|c| c.dens * RHO_K).unwrap_or(1000.0)
    }
    pub fn set_f32grid(&mut self, grid: &str, i: usize, v: f64) {
        if let Some(g) = self.st.grids_f32.get_mut(grid) {
            RoomState::set_f32(g, i, v);
        }
    }
    pub fn grid_src(&self, i: usize) -> f64 {
        self.sc.src.get(i).copied().unwrap_or(0.0)
    }
    pub fn set_src(&mut self, i: usize, v: f64) {
        if i < self.sc.src.len() {
            self.sc.src[i] = v;
        }
    }
}

// ---------------------------------------------------------------------------
// sump: spill landing + flood damage. Geometry views for the tick.
// ---------------------------------------------------------------------------

impl<'a> Cx<'a> {
    /// `sumpLiqCb`: spill kilograms land as floor water.
    pub fn sump_liq_cb(&mut self, g: &LiveG, cells: Vec<usize>, _rate: f64, fl: Fluid, key: String) {
        if cells.is_empty() {
            return;
        }
        if self.meta.circ_burn.get(fl.ci as usize).and_then(|o| o.clone()).map(|b| !b.is_empty()).unwrap_or(false) {
            return;
        }
        let kg = self.inp.out_kg.get(&key).copied().unwrap_or(0.0)
            * (1.0 - self.open_flash_x(&fl, cells[0] as i32));
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed) {
            let si = LIQ_SI.load(std::sync::atomic::Ordering::Relaxed);
            eprintln!("sumpdbg si{si} {key}: kg={kg} fx={} h={} c0={} rp={}", self.open_flash_x(&fl, cells[0] as i32), fl.h, cells[0], self.grid32("roomP", cells[0]));
        }
        if !(kg > 0.0) {
            return;
        }
        let pour = self.room_pour_cells(&key, &cells);
        let hl = sat_h(
            &self.curves.water,
            (ROOM_P0 + js_max(0.0, self.grid32("roomP", pour[0]))) / 1000.0,
        );
        let pn = self.net_p_at(fl.nd.as_deref());
        let pr = (ROOM_P0 + self.grid32("roomP", pour[0])) * 1000.0;
        let v0 = libm::sqrt(2.0 * js_max(0.0, pn * 1e6 - pr) / WATER_RHO);
        for i in &pour {
            let qw = self.liq_water_q();
            self.liq_land(g, &qw, *i, kg / pour.len() as f64, kg / pour.len() as f64 * hl, v0);
        }
        self.book("sump", -kg);
    }
    /// `sumpStep`: transport spill lands; deep water wrecks machines.
    pub fn sump_step(&mut self, g: &LiveG) {
        let items = self.room_liq_outs(g);
        for (cells, rate, fl, key) in items {
            self.sump_liq_cb(g, cells, rate, fl, key);
        }
        // flood sweep over LAY parts.
        let parts = self.meta.parts.clone();
        for p in &parts {
            if !self.fitted(p) {
                continue;
            }
            if self.part_wrecked(&p.id) {
                continue;
            }
            let line = self.part_flood_line(p, g);
            if line.is_none() || !self.flood_drowns(p, line.unwrap()) {
                continue;
            }
            self.st.dmg_parts.push(p.id.clone());
            self.st.dmg_why.insert(p.id.clone(), "FLOODED".to_string());
            self.dmg_hit_owned(&p.id);
            self.log(SEV_ALARM, EV_FLOOD);
        }
    }
    pub fn fitted(&self, p: &RoomPart) -> bool {
        if p.role == "bkp" {
            return self.meta.tank_bkp > 0.0;
        }
        true
    }
    pub fn flood_drowns(&self, p: &RoomPart, line: f64) -> bool {
        let drown = self.meta.roles.get(&p.role).map(|r| r.drown).unwrap_or(false);
        drown && line <= p.y as f64 + p.h as f64 * (1.0 - FLOOD_DROWN)
    }
    fn dmg_hit_owned(&mut self, id: &str) {
        let ctx = DmgCtx {
            part_role: &self.meta.part_roles,
            part_on: &self.meta.part_on,
            nb: &self.meta.core_nb,
            tank_hold: &self.meta.tank_hold,
            primary_relief: self.meta.primary_relief.clone(),
        };
        // Bridge the tracked fields through the shared applier.
        let mut ds = DmgState {
            load: self.st.f("load"),
            load_dem: self.st.f("loadDem"),
            bkp_lost: self.st.b("bkpLost"),
            sgtr: self.st.b("sgtr"),
            ..Default::default()
        };
        for (cid, cs) in &self.st.cores {
            ds.cores.insert(cid.clone(), cs.clone());
        }
        dmg_hit(id, &ctx, &mut ds);
        self.st.set_f("load", ds.load);
        self.st.set_f("loadDem", ds.load_dem);
        self.st.set_b("bkpLost", ds.bkp_lost);
        self.st.set_b("sgtr", ds.sgtr);
        for (cid, cs) in ds.cores {
            self.st.cores.insert(cid, cs);
        }
    }
}

// ---------------------------------------------------------------------------
// gas: CG solve, faces, advection, roomGasStep, static, scar, condense
// ---------------------------------------------------------------------------

/// `roomCgApply`: y = A x, A = diag + face Laplacian.
pub fn cg_apply(x: &[f64], y: &mut [f64], di: &[f64], ax: &[f64], ay: &[f64], gw: usize, gh: usize) {
    let n = gw * gh;
    for i in 0..n {
        y[i] = di[i] * x[i];
    }
    for i in 0..n - 1 {
        let a = ax[i];
        if a == 0.0 {
            continue;
        }
        let q = a * (x[i] - x[i + 1]);
        y[i] += q;
        y[i + 1] -= q;
    }
    for i in 0..n - gw {
        let a = ay[i];
        if a == 0.0 {
            continue;
        }
        let q = a * (x[i] - x[i + gw]);
        y[i] += q;
        y[i + gw] -= q;
    }
}
/// Symmetric Gauss-Seidel preconditioner.
pub fn cg_precond(z: &mut [f64], r: &[f64], j: &[f64], ax: &[f64], ay: &[f64], gw: usize, gh: usize) {
    let n = gw * gh;
    for i in 0..n {
        let mut v = r[i];
        let x = i % gw;
        if x > 0 {
            v += ax[i - 1] * z[i - 1];
        }
        if i >= gw {
            v += ay[i - gw] * z[i - gw];
        }
        z[i] = v / j[i];
    }
    for i in (0..n).rev() {
        let mut v = z[i] * j[i];
        let x = i % gw;
        if x < gw - 1 {
            v += ax[i] * z[i + 1];
        }
        if i < n - gw {
            v += ay[i] * z[i + gw];
        }
        z[i] = v / j[i];
    }
}
fn warn_once(warns: &mut u32, tag: String) {
    if !cap_warned(&tag) {
        *warns += 1;
    }
}
/// `roomCgSolve`: CG from x, returns iterations.
pub fn cg_solve(
    b: &[f64],
    x: &mut [f64],
    di: &[f64],
    ax: &[f64],
    ay: &[f64],
    tol: f64,
    max: usize,
    tag: &str,
    gw: usize,
    gh: usize,
    warns: &mut u32,
) -> u32 {
    let n = gw * gh;
    let mut r = vec![0.0; n];
    let mut z = vec![0.0; n];
    let mut dd = vec![0.0; n];
    let mut ap = vec![0.0; n];
    let mut j = vec![0.0; n];
    for i in 0..n {
        j[i] = di[i];
    }
    for i in 0..n - 1 {
        j[i] += ax[i];
        j[i + 1] += ax[i];
    }
    for i in 0..n - gw {
        j[i] += ay[i];
        j[i + gw] += ay[i];
    }
    cg_apply(x, &mut ap, di, ax, ay, gw, gh);
    let mut bn = 0.0;
    let mut rz = 0.0;
    for i in 0..n {
        r[i] = b[i] - ap[i];
        bn += b[i] * b[i];
    }
    cg_precond(&mut z, &r, &j, ax, ay, gw, gh);
    for i in 0..n {
        dd[i] = z[i];
        rz += r[i] * z[i];
    }
    bn = libm::sqrt(bn);
    if !(bn > 0.0) {
        x.fill(0.0);
        return 0;
    }
    let mut it = 0u32;
    while (it as usize) < max {
        let mut rn = 0.0;
        for i in 0..n {
            rn += r[i] * r[i];
        }
        if libm::sqrt(rn) <= tol * bn {
            break;
        }
        cg_apply(&dd, &mut ap, di, ax, ay, gw, gh);
        let mut dad = 0.0;
        for i in 0..n {
            dad += dd[i] * ap[i];
        }
        let a = rz / dad;
        let mut rz1 = 0.0;
        for i in 0..n {
            x[i] += a * dd[i];
            r[i] -= a * ap[i];
        }
        cg_precond(&mut z, &r, &j, ax, ay, gw, gh);
        for i in 0..n {
            rz1 += r[i] * z[i];
        }
        let bt = rz1 / rz;
        rz = rz1;
        for i in 0..n {
            dd[i] = z[i] + bt * dd[i];
        }
        it += 1;
    }
    if it as usize >= max {
        warn_once(warns, tag.to_string());
    }
    it
}
pub fn gs_fx_open(bx: &[f64], vg: &[f64], i: usize, gw: usize, gh: usize, vgcell: f64) -> bool {
    let n = gw * gh;
    i + 1 < n
        && bx.get(i).copied().unwrap_or(0.0) != 0.0
        && vg.get(i).copied().unwrap_or(0.0) > vgcell
        && vg.get(i + 1).copied().unwrap_or(0.0) > vgcell
}

pub fn gs_fy_open(by: &[f64], vg: &[f64], i: usize, gw: usize, gh: usize, vgcell: f64) -> bool {
    let n = gw * gh;
    i + gw < n
        && by.get(i).copied().unwrap_or(0.0) != 0.0
        && vg.get(i).copied().unwrap_or(0.0) > vgcell
        && vg.get(i + gw).copied().unwrap_or(0.0) > vgcell
}

pub fn gs_mix(dt: f64, m: f64, room_c: f64) -> f64 {
    let g = m.abs() * ROOM_CP;
    g * room_c / (room_c + 8.0 * g) / dt
}

/// `faceInflow`.
pub fn face_inflow(inn: &mut [f64], fx: &[f64], fy: &[f64], gw: usize, gh: usize) {
    let n = gw * gh;
    inn.fill(0.0);
    for i in 0..n - 1 {
        let m = fx[i];
        if m > 0.0 {
            inn[i + 1] += m;
        } else if m < 0.0 {
            inn[i] -= m;
        }
    }
    for i in 0..n - gw {
        let m = fy[i];
        if m > 0.0 {
            inn[i + gw] += m;
        } else if m < 0.0 {
            inn[i] -= m;
        }
    }
}

/// `faceLimit` with the tail shave (free: borrows no Cx).
pub fn face_limit_impl(
    mm: &[f64],
    fx: &mut [f64],
    fy: &mut [f64],
    n: usize,
    cap: Option<&[f64]>,
    gw: usize,
    gh: usize,
    warns: &mut u32,
) {
        let nn = gw * gh;
        {
            let mut out = vec![0.0; nn];
        let mut inn = vec![0.0; nn];
        let mut k = vec![1.0; nn];
        let mut ki = vec![1.0; nn];
        for _ in 0..n {
            let mut moved = false;
            out.fill(0.0);
            inn.fill(0.0);
            for i in 0..nn {
                if fx[i] > 0.0 {
                    out[i] += fx[i] * ki[i + 1];
                    inn[i + 1] += fx[i] * k[i];
                } else if fx[i] < 0.0 {
                    out[i + 1] -= fx[i] * ki[i];
                    inn[i] -= fx[i] * k[i + 1];
                }
                if fy[i] > 0.0 {
                    out[i] += fy[i] * ki[i + gw];
                    inn[i + gw] += fy[i] * k[i];
                } else if fy[i] < 0.0 {
                    out[i + gw] -= fy[i] * ki[i];
                    inn[i] -= fy[i] * k[i + gw];
                }
            }
            for i in 0..nn {
                let have = mm[i] + inn[i] * ki[i];
                let v = if out[i] > have { have / out[i] } else { 1.0 };
                if v != k[i] {
                    moved = true;
                }
                k[i] = v;
            }
            if let Some(c) = cap {
                for i in 0..nn {
                    let room = js_max(0.0, c[i] - mm[i]) + out[i] * k[i];
                    let v = if inn[i] > room { room / inn[i] } else { 1.0 };
                    if v != ki[i] {
                        moved = true;
                    }
                    ki[i] = v;
                }
            }
            if !moved {
                break;
            }
        }
        for i in 0..nn {
            if fx[i] > 0.0 {
                fx[i] *= k[i] * ki[i + 1];
            } else if fx[i] < 0.0 {
                fx[i] *= k[i + 1] * ki[i];
            }
            if fy[i] > 0.0 {
                fy[i] *= k[i] * ki[i + gw];
            } else if fy[i] < 0.0 {
                fy[i] *= k[i + gw] * ki[i];
            }
        }
        let mut cut = 0.0;
        for it in 0..=FACE_TAIL {
            out.fill(0.0);
            face_inflow(&mut inn, fx, fy, gw, gh);
            for i in 0..nn - 1 {
                let m = fx[i];
                if m > 0.0 {
                    out[i] += m;
                } else if m < 0.0 {
                    out[i + 1] -= m;
                }
            }
            for i in 0..nn - gw {
                let m = fy[i];
                if m > 0.0 {
                    out[i] += m;
                } else if m < 0.0 {
                    out[i + gw] -= m;
                }
            }
            cut = 0.0;
            for i in 0..nn {
                let have = mm[i] + inn[i];
                let ex = out[i] - have;
                let v = if ex > have * 1e-9 + 1e-9 {
                    if have > 0.0 {
                        have / out[i]
                    } else {
                        0.0
                    }
                } else {
                    1.0
                };
                k[i] = v;
                if v != 1.0 && ex > cut {
                    cut = ex;
                }
            }
            if cut == 0.0 || it == FACE_TAIL {
                break;
            }
            for i in 0..nn - 1 {
                if fx[i] > 0.0 {
                    fx[i] *= k[i];
                } else if fx[i] < 0.0 {
                    fx[i] *= k[i + 1];
                }
            }
            for i in 0..nn - gw {
                if fy[i] > 0.0 {
                    fy[i] *= k[i];
                } else if fy[i] < 0.0 {
                    fy[i] *= k[i + gw];
                }
            }
        }
        if cut != 0.0 {
            warn_once(warns, format!("faceTail{n}"));
        }
}
}

/// `faceMove`.
pub fn face_move(mm: &mut [f64], fx: &[f64], fy: &[f64], gw: usize, gh: usize) {
        let n = gw * gh;
        let mut d = vec![0.0; n];
        for i in 0..n - 1 {
            if fx[i] != 0.0 {
                d[i] -= fx[i];
                d[i + 1] += fx[i];
            }
        }
        for i in 0..n - gw {
            if fy[i] != 0.0 {
                d[i] -= fy[i];
                d[i + gw] += fy[i];
            }
        }
        for i in 0..n {
            if d[i] != 0.0 {
                mm[i] = js_max(0.0, mm[i] + d[i]);
            }
        }
}

/// `roomAdvect`: implicit upwind species/energy ride.
pub fn room_advect(f: &mut [f64], m0: &[f64], m1: &[f64], fx: &[f64], fy: &[f64], inn: &[f64], lim: f64, gw: usize, gh: usize) {
        let n = gw * gh;
        let mut y0 = vec![0.0; n];
        let mut y = vec![0.0; n];
        for i in 0..n {
            y0[i] = if m0[i] > 0.0 { js_min(lim, f[i] / m0[i]) } else { 0.0 };
            y[i] = y0[i];
        }
        for _ in 0..ADV_SWEEPS {
            for i in 0..n {
                let x = i % gw;
                let mut nv = m0[i] * y0[i];
                if x > 0 && fx[i - 1] > 0.0 {
                    nv += fx[i - 1] * y[i - 1];
                }
                if x < gw - 1 && fx[i] < 0.0 {
                    nv -= fx[i] * y[i + 1];
                }
                if i >= gw && fy[i - gw] > 0.0 {
                    nv += fy[i - gw] * y[i - gw];
                }
                if i < n - gw && fy[i] < 0.0 {
                    nv -= fy[i] * y[i + gw];
                }
                let w = m0[i] + inn[i];
                y[i] = if w > 0.0 { nv / w } else { y0[i] };
            }
            for i in (0..n).rev() {
                let x = i % gw;
                let mut nv = m0[i] * y0[i];
                if x > 0 && fx[i - 1] > 0.0 {
                    nv += fx[i - 1] * y[i - 1];
                }
                if x < gw - 1 && fx[i] < 0.0 {
                    nv -= fx[i] * y[i + 1];
                }
                if i >= gw && fy[i - gw] > 0.0 {
                    nv += fy[i - gw] * y[i - gw];
                }
                if i < n - gw && fy[i] < 0.0 {
                    nv -= fy[i] * y[i + gw];
                }
                let w = m0[i] + inn[i];
                y[i] = if w > 0.0 { nv / w } else { y0[i] };
            }
        }
        for i in 0..n {
            f[i] = y[i] * m1[i];
        }
    }

impl<'a> Cx<'a> {
    /// `regionPMean` over the dumped roomP grid (tick.rs helper shape).
    pub fn region_means(&self) -> Vec<f64> {
        let n = self.meta.gw * self.meta.gh;
        let roomp = self.st.grids_f32.get("roomP").cloned().unwrap_or(vec![0.0; n]);
        region_p_mean(&self.meta.region_of, &roomp, self.meta.n_regions)
    }
    /// `roomPStatic`: compartment means, memoised on the replay gen.
    pub fn room_p_static(&mut self) -> Vec<f64> {
        let n = self.meta.gw * self.meta.gh;
        let gen = self.sc.pgen_cur;
        if self.sc.pstat_init && self.sc.pstat_gen == gen && self.sc.pstat.len() == n {
            return self.sc.pstat.clone();
        }
        let means = self.region_means();
        let mut out = vec![0.0; n];
        for i in 0..n {
            let r = self.meta.region_of.get(i).copied().unwrap_or(-1);
            out[i] = if r < 0 { 0.0 } else { means.get(r as usize).copied().unwrap_or(0.0) };
        }
        self.sc.pstat = out.clone();
        self.sc.pstat_gen = gen;
        self.sc.pstat_init = true;
        out
    }
    /// `roomGasStep`: implicit gas solve + advect; returns pmax.
    pub fn room_gas_step(&mut self, g: &LiveG) -> f64 {
        let Cx { meta, st, inp, ev: _, warns, sc, .. } = self;
        let (gw, gh) = (meta.gw, meta.gh);
        let n = gw * gh;
        let der = meta.der.clone();
        let mpc = meta.mpc;
        let dt = inp.dt;
        let fr = meta.fire_cool.as_ref().map(|c| c.dens * RHO_K).unwrap_or(1000.0);
        let vgmin = ROOM_VG_MIN * der.room_vcell;
        let vgcell = vgmin * 1.0001;
        let mut mm: Vec<f64> = st.grids_f32.get("roomM").cloned().unwrap_or(vec![0.0; n]);
        let mut uu: Vec<f64> = st.grids_f32.get("roomPU").cloned().unwrap_or(vec![0.0; n]);
        let mut vv: Vec<f64> = st.grids_f32.get("roomPV").cloned().unwrap_or(vec![0.0; n]);
        let wt = st.grids_f64.get("roomWater").cloned().unwrap_or(vec![0.0; n]);
        let pl = st.grids_f64.get("roomPool").cloned().unwrap_or(vec![0.0; n]);
        let tt = st.grids_f64.get("roomT").cloned().unwrap_or(vec![T_HULL; n]);
        for i in 0..n {
            let vvc = js_max(vgmin, der.room_vcell - wt[i] / WATER_RHO - pl[i] / fr);
            sc.gs.vg[i] = vvc;
            let d = sc.disp[i];
            sc.gs.p[i] = mm[i] * R_AIR * tt[i] / js_max(if vvc > vgcell { vvc + d } else { vvc }, 1e-6) * 1e6;
        }
        let mut live = false;
        for i in 0..n {
            if sc.disp[i] != 0.0 {
                live = true;
                break;
            }
        }
        let plo = WAVE_P_LO * 1000.0;
        let ulo = WAVE_U_LO * ROOM_RHO;
        {
            let vg = sc.gs.vg.clone();
            let pp = sc.gs.p.clone();
            for i in 0..n {
                if live {
                    break;
                }
                if uu[i].abs() > ulo || vv[i].abs() > ulo {
                    live = true;
                    break;
                }
                if i + 1 < n
                    && gs_fx_open(&g.bx, &vg, i, gw, gh, vgcell)
                    && (pp[i] - pp[i + 1]).abs() > plo
                {
                    live = true;
                    break;
                }
                if i + gw < n
                    && gs_fy_open(&g.by, &vg, i, gw, gh, vgcell)
                    && (pp[i] - pp[i + gw]).abs() > plo
                {
                    live = true;
                    break;
                }
            }
        }
        if !live {
            uu.fill(0.0);
            vv.fill(0.0);
            sc.gs.x.fill(0.0);
            sc.disp.fill(0.0);
            sc.cg_it = 0;
        } else {
            let a = mpc * ROOM_DEPTH;
            let ga = dt * dt * a / mpc;
            let vg = sc.gs.vg.clone();
            for i in 0..n {
                sc.gs.di[i] = vg[i] / (R_SI * js_max(tt[i], 1.0));
                if !gs_fx_open(&g.bx, &vg, i, gw, gh, vgcell) {
                    sc.gs.ax[i] = 0.0;
                    uu[i] = 0.0;
                } else {
                    sc.gs.ax[i] = ga * g.bx[i];
                }
                if !gs_fy_open(&g.by, &vg, i, gw, gh, vgcell) {
                    sc.gs.ay[i] = 0.0;
                    vv[i] = 0.0;
                } else {
                    sc.gs.ay[i] = ga * g.by[i];
                }
            }
            let mut fx = vec![0.0; n];
            let mut fy = vec![0.0; n];
            for i in 0..n {
                fx[i] = if sc.gs.ax[i] != 0.0 { uu[i] * a * dt } else { 0.0 };
                fy[i] = if sc.gs.ay[i] != 0.0 { vv[i] * a * dt } else { 0.0 };
            }
            for i in 0..n {
                let x = i % gw;
                sc.gs.b[i] = -(fx[i] - if x > 0 { fx[i - 1] } else { 0.0 } + fy[i]
                    - if i >= gw { fy[i - gw] } else { 0.0 });
            }
            for i in 0..n {
                if sc.disp[i] != 0.0 && sc.gs.vg[i] > vgcell {
                    sc.gs.b[i] += mm[i] * sc.disp[i] / (sc.gs.vg[i] + sc.disp[i]);
                }
            }
            sc.disp.fill(0.0);
            for i in 0..n - 1 {
                let q = sc.gs.ax[i] * (sc.gs.p[i] - sc.gs.p[i + 1]);
                sc.gs.b[i] -= q;
                sc.gs.b[i + 1] += q;
            }
            for i in 0..n - gw {
                let q = sc.gs.ay[i] * (sc.gs.p[i] - sc.gs.p[i + gw]);
                sc.gs.b[i] -= q;
                sc.gs.b[i + gw] += q;
            }
            // warm start only when the last solve ran (roomCgIt != 0).
            if sc.cg_it == 0 {
                sc.gs.x.fill(0.0);
            }
            let gx = sc.gs.ax.clone();
            let gy = sc.gs.ay.clone();
            let di = sc.gs.di.clone();
            let bb = sc.gs.b.clone();
            let mut xx = sc.gs.x.clone();
            let it = cg_solve(&bb, &mut xx, &di, &gx, &gy, CG_TOL, CG_MAX, "gas", gw, gh, warns);
            sc.gs.x.copy_from_slice(&xx);
            sc.cg_it = it;
            for i in 0..n {
                if sc.gs.ax[i] != 0.0 {
                    fx[i] -= sc.gs.ax[i] * ((sc.gs.p[i + 1] + sc.gs.x[i + 1]) - (sc.gs.p[i] + sc.gs.x[i]));
                }
                if sc.gs.ay[i] != 0.0 {
                    fy[i] -= sc.gs.ay[i] * ((sc.gs.p[i + gw] + sc.gs.x[i + gw]) - (sc.gs.p[i] + sc.gs.x[i]));
                }
            }
            face_limit_impl(&mm, &mut fx, &mut fy, 4, None, gw, gh, &mut *warns);
            for i in 0..n {
                if sc.gs.ax[i] != 0.0 {
                    uu[i] = fx[i] / (a * dt);
                } else {
                    fx[i] = 0.0;
                }
                if sc.gs.ay[i] != 0.0 {
                    vv[i] = fy[i] / (a * dt);
                } else {
                    fy[i] = 0.0;
                }
            }
            // JS copies pre-move s.roomM (F32) into F64 scratch, and faceMove
            // rounds s.roomM in place: mirror both round points exactly.
            let m0: Vec<f64> = mm.iter().map(|v| *v as f32 as f64).collect();
            let mut inn = vec![0.0; n];
            face_inflow(&mut inn, &fx, &fy, gw, gh);
            face_move(&mut mm, &fx, &fy, gw, gh);
            for v in mm.iter_mut() {
                *v = *v as f32 as f64;
            }
            // species + enthalpy ride (roomH2/O2/Vap arrays).
            for key in ["roomH2", "roomO2", "roomVap"] {
                if let Some(f) = st.grids_f32.get_mut(key) {
                    let mut ff: Vec<f64> = f.clone();
                    room_advect(&mut ff, &m0, &mm, &fx, &fy, &inn, 1.0, gw, gh);
                    for (j, v) in ff.iter().enumerate() {
                        RoomState::set_f32(f, j, *v);
                    }
                }
            }
            let rc = der.room_c;
            for i in 0..n {
                if fx[i] != 0.0 {
                    let a2 = if fx[i] > 0.0 { i } else { i + 1 };
                    let c2 = if a2 == i { i + 1 } else { i };
                    let q = gs_mix(dt, fx[i], rc) * (tt[a2] - tt[c2]);
                    sc.src[c2] += q;
                    sc.src[a2] -= q;
                }
                if fy[i] != 0.0 {
                    let a2 = if fy[i] > 0.0 { i } else { i + gw };
                    let c2 = if a2 == i { i + gw } else { i };
                    let q = gs_mix(dt, fy[i], rc) * (tt[a2] - tt[c2]);
                    sc.src[c2] += q;
                    sc.src[a2] -= q;
                }
            }
            // write back U/V/Mm (f32 stores).
            if let Some(g) = st.grids_f32.get_mut("roomPU") {
                for (j, v) in uu.iter().enumerate() {
                    RoomState::set_f32(g, j, *v);
                }
            }
            if let Some(g) = st.grids_f32.get_mut("roomPV") {
                for (j, v) in vv.iter().enumerate() {
                    RoomState::set_f32(g, j, *v);
                }
            }
            if let Some(g) = st.grids_f32.get_mut("roomM") {
                for (j, v) in mm.iter().enumerate() {
                    RoomState::set_f32(g, j, *v);
                }
            }
        }
        sc.pgen_cur += 1;
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("rsgas vgmin={vgmin} vgcell={vgcell} vg0={} mm0={} tt0={} wt0={} pl0={}", sc.gs.vg[0], mm[0], tt[0], wt[0], pl[0]);
        }
        let mut nset = 0;
        for i in 0..n {
            if sc.gs.vg[i] > vgcell {
                let v = mm[i] * R_AIR * tt[i] / js_max(sc.gs.vg[i], 1e-6) * 1000.0 - ROOM_P0;
                if let Some(g) = st.grids_f32.get_mut("roomP") {
                    RoomState::set_f32(g, i, v);
                }
                nset += 1;
            }
        }
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("rsgas-set nset={nset} v0={}", st.grids_f32.get("roomP").and_then(|g| g.get(0)).copied().unwrap_or(f64::NAN));
        }
        // liquid-filled cells carry the ring pressure.
        let mut ring_jobs = vec![];
        for i in 0..n {
            if !(sc.gs.vg[i] > vgcell) {
                ring_jobs.push(i);
            }
        }
        let rp = st.grids_f32.get("roomP").cloned().unwrap_or(vec![0.0; n]);
        let water = st.grids_f64.get("roomWater").cloned().unwrap_or(vec![0.0; n]);
        let pool = st.grids_f64.get("roomPool").cloned().unwrap_or(vec![0.0; n]);
        let fr = meta.fire_cool.as_ref().map(|c| c.dens * RHO_K).unwrap_or(1000.0);
        let vcell = meta.der.room_vcell;
        let bx = g.bx.clone();
        let by = g.by.clone();
        for i in ring_jobs {
            sc.gd_k += 1;
            let k = sc.gd_k;
            sc.gd_seen[i] = k;
            let mut q = vec![i];
            let mut h = 0usize;
            let mut w = 0.0;
            let mut nb: Vec<f64> = vec![];
            while h < q.len() && nb.is_empty() {
                let end = q.len();
                while h < end {
                    let a = q[h];
                    h += 1;
                    let x = a % gw;
                    let mut nbrs: Vec<(usize, f64)> = vec![];
                    if a >= gw {
                        nbrs.push((a - gw, by[a - gw]));
                    }
                    if x < gw - 1 {
                        nbrs.push((a + 1, bx[a]));
                    }
                    if x > 0 {
                        nbrs.push((a - 1, bx[a - 1]));
                    }
                    for (j, b) in nbrs {
                        if !(b > 0.0) || sc.gd_seen[j] == k {
                            continue;
                        }
                        sc.gd_seen[j] = k;
                        let vv = js_max(ROOM_VG_MIN * vcell, vcell - water[j] / WATER_RHO - pool[j] / fr);
                        if vv > vgcell {
                            nb.push(j as f64);
                            nb.push(b * vv);
                            w += b * vv;
                        } else {
                            q.push(j);
                        }
                    }
                }
            }
            let mut qq = 0.0;
            for kk in (0..nb.len()).step_by(2) {
                qq += rp[nb[kk] as usize] * nb[kk + 1];
            }
            let v = if w > 0.0 {
                qq / w
            } else if i >= gw {
                rp[i - gw]
            } else {
                0.0
            };
            if let Some(gg) = st.grids_f32.get_mut("roomP") {
                RoomState::set_f32(gg, i, v);
            }
        }
        // peak hold.
        for i in 0..n {
            let p = st.grids_f32.get("roomP").and_then(|g| g.get(i)).copied().unwrap_or(0.0);
            let pk = st.grids_f32.get("roomPPk").and_then(|g| g.get(i)).copied().unwrap_or(0.0);
            if p > pk {
                if let Some(g) = st.grids_f32.get_mut("roomPPk") {
                    RoomState::set_f32(g, i, p);
                }
            }
        }
        // roomPStatic (memoised on the replay gen) + pmax.
        let gen = sc.pgen_cur;
        let stt = if sc.pstat_init && sc.pstat_gen == gen && sc.pstat.len() == n {
            sc.pstat.clone()
        } else {
            let roomp = st.grids_f32.get("roomP").cloned().unwrap_or(vec![0.0; n]);
            let means = region_p_mean(&meta.region_of, &roomp, meta.n_regions);
            let mut out = vec![0.0; n];
            for i in 0..n {
                let r = meta.region_of.get(i).copied().unwrap_or(-1);
                out[i] = if r < 0 { 0.0 } else { means.get(r as usize).copied().unwrap_or(0.0) };
            }
            sc.pstat = out.clone();
            sc.pstat_gen = gen;
            sc.pstat_init = true;
            out
        };
        let mut pmax = 0.0;
        for i in 0..n {
            let p = st.grids_f32.get("roomP").and_then(|g| g.get(i)).copied().unwrap_or(0.0);
            let e = p - stt[i];
            if e > pmax {
                pmax = e;
            }
        }
        pmax
    }
    pub fn scar_step(&mut self, stt: &[f64]) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        for i in 0..n {
            if self.meta.g_occ[i] != 0 || self.meta.g_tight[i] != 0 {
                continue;
            }
            let a = (self.grid32("roomP", i) - stt[i]).abs();
            let cur = self.grid32("roomScarCur", i);
            if a > cur {
                self.set_f32grid("roomScarCur", i, a);
            } else if a < cur * 0.5 {
                if cur > HIT_LO {
                    self.set_f32grid("roomScar", i, self.grid32("roomScar", i) + cur - HIT_LO);
                }
                self.set_f32grid("roomScarCur", i, a);
            }
        }
    }
    /// `roomCondense`: steam past saturation lands as floor water.
    pub fn room_condense(&mut self, g: &LiveG) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        for i in 0..n {
            let v = self.grid32("roomVap", i);
            if !(v > 0.0) {
                continue;
            }
            let t = self.grid64("roomT", i);
            let tk = js_max(t, 1.0);
            let m = self.grid32("roomM", i);
            let drop = js_min(v, m) - sat_p(&self.curves.water, tk) * self.room_vgas(i) / (R_VAP * tk);
            if !(drop > 0.0) {
                continue;
            }
            self.set_f32grid("roomVap", i, v - drop);
            self.set_f32grid("roomM", i, m - drop);
            let e = drop * h_of_t(&self.curves.water, t);
            let qw = self.liq_water_q();
            if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
                && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
                && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
                && (i + gw == 128 || i == 128 || i == 128 + gw)
            {
                eprintln!("COND128 i={i} drop={drop} v={v} m={m} t={t} e={e}");
            }
            self.liq_land(g, &qw, i, drop, e, 0.0);
            self.book("sump", -drop);
        }
    }
}

// ---------------------------------------------------------------------------
// liquid: bundles, shallow solve, landing, flood, water heat, pan drain
// ---------------------------------------------------------------------------

/// Liquid bundle view (water or metal): array names + constants.
pub struct LiqQ {
    pub m: String,
    pub e: String,
    pub rho: f64,
    pub bulk: f64,
    pub vu: String,
    pub vv: String,
    pub p: String,
    pub o: String,
    pub o_rho: f64,
    pub u: Option<String>,
    pub tag: String,
}

impl<'a> Cx<'a> {
    pub fn liq_water_q(&self) -> LiqQ {
        LiqQ {
            m: "roomWater".to_string(),
            e: "roomWaterE".to_string(),
            rho: WATER_RHO,
            bulk: WATER_BULK,
            vu: "roomWU".to_string(),
            vv: "roomWV".to_string(),
            p: "roomWP".to_string(),
            o: "roomPool".to_string(),
            o_rho: self.fire_rho(),
            u: None,
            tag: "water".to_string(),
        }
    }
    pub fn liq_metal_q(&self) -> LiqQ {
        let bulk = self.meta.fire_cool.as_ref().map(|c| c.bulk).unwrap_or(WATER_BULK);
        LiqQ {
            m: "roomPool".to_string(),
            e: "roomPoolE".to_string(),
            rho: self.fire_rho(),
            bulk,
            vu: "roomPoolU".to_string(),
            vv: "roomPoolV".to_string(),
            p: "roomPoolP".to_string(),
            o: "roomWater".to_string(),
            o_rho: WATER_RHO,
            u: Some("roomWater".to_string()),
            tag: "metal".to_string(),
        }
    }
    pub fn liq_cap(&self, q: &LiqQ, j: usize) -> f64 {
        let o = self.grid64(&q.o, j);
        js_max(0.0, q.rho * (self.meta.der.room_vcell - o / q.o_rho))
    }
    pub fn liq_full(&self, q: &LiqQ, j: usize) -> bool {
        self.liq_full_at(q, j, self.grid64(&q.m, j))
    }
    pub fn liq_full_at(&self, q: &LiqQ, j: usize, m: f64) -> bool {
        m >= self.liq_cap(q, j) * LIQ_FULL_K
    }
    /// `liqShut`: tight, or an occupied cell with no owner (hole overlay opens).
    pub fn liq_shut(&self, g: &LiveG, j: usize) -> bool {
        if g.hole[j] != 0 {
            return false;
        }
        if self.meta.g_tight[j] != 0 {
            return true;
        }
        self.meta.g_occ[j] != 0 && self.meta.g_own[j] < 0
    }
    pub fn liq_runs(&self, g: &LiveG, i: usize, j: usize) -> bool {
        if self.liq_shut(g, j) {
            return false;
        }
        !(self.meta.g_pan[i] != 0 && self.meta.g_pan[j] == 0)
    }
    /// `liqStands`: floor or full cells down.
    pub fn liq_stands(&self, q: &LiqQ, g: &LiveG, i: usize) -> bool {
        let mut ii = i;
        let n = self.meta.gw * self.meta.gh;
        loop {
            let j = ii + self.meta.gw;
            if j >= n || !self.liq_runs(g, ii, j) {
                return true;
            }
            if !self.liq_full(q, j) {
                return false;
            }
            ii = j;
        }
    }
    /// `liqTop`.
    pub fn liq_top(&self, q: &LiqQ, g: &LiveG, i: usize) -> usize {
        let m = self.grid64(&q.m, i);
        if !(m > 0.0) || self.liq_shut(g, i) {
            return i;
        }
        let mut ii = i;
        let gw = self.meta.gw;
        loop {
            if ii < gw {
                break;
            }
            let above = ii - gw;
            let ma = self.grid64(&q.m, above);
            if !(ma > 0.0) || !self.liq_runs(g, above, ii) || !self.liq_full(q, ii) {
                break;
            }
            ii = above;
        }
        ii
    }
    pub fn liq_fill(&self, m: f64, rho: f64) -> f64 {
        m / (rho * self.meta.mpc * ROOM_DEPTH)
    }
    /// `liqSurf`.
    pub fn liq_surf(&self, q: &LiqQ, g: &LiveG, i: usize) -> f64 {
        let t = self.liq_top(q, g, i);
        let y = t / self.meta.gw;
        ((self.meta.gh - 1 - y) as f64) * self.meta.mpc + self.liq_fill(self.grid64(&q.m, t), q.rho)
    }
    /// `liqLand`: stack-aware landing + displacement source + arrival speed.
    pub fn liq_land(&mut self, g: &LiveG, q: &LiqQ, i: usize, kg: f64, kj: f64, v0: f64) {
        if !(kg > 0.0) {
            return;
        }
        let gw = self.meta.gw;
        let n = gw * self.meta.gh;
        let mut ii = i;
        while ii >= gw && self.liq_full(q, ii) && self.liq_runs(g, ii, ii - gw) && !self.liq_shut(g, ii - gw) {
            ii -= gw;
        }
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
            && kg > 0.1
            && (ii + gw == 128 || ii == 128 || ii == 128 + gw || i + gw == 128 || i == 128 || i == 128 + gw)
        {
            eprintln!("LAND128 src={i} tgt={ii} kg={kg} kj={kj}");
        }
        self.sc.disp[ii] += kg / q.rho;
        self.set_f64grid(&q.m, ii, self.grid64(&q.m, ii) + kg);
        // `q.E[i] += kJ || 0`.
        let kjj = if kj.is_nan() { 0.0 } else { kj };
        self.set_f64grid(&q.e, ii, self.grid64(&q.e, ii) + kjj);
        if v0 > 0.0 && ii < n - gw {
            let below = ii + gw;
            if self.liq_runs(g, ii, below) && !self.liq_full(q, below) {
                let vv = self.grid32(&q.vv, ii);
                self.set_f32grid(&q.vv, ii, js_max(vv, js_min(v0, LIQ_V_MAX)));
            }
        }
    }
    pub fn set_f64grid(&mut self, grid: &str, i: usize, v: f64) {
        if let Some(g) = self.st.grids_f64.get_mut(grid) {
            if i < g.len() {
                g[i] = v;
            }
        }
    }
}

impl<'a> Cx<'a> {
    /// `liqStep`: implicit shallow-liquid solve + move. Returns CG iterations.
    pub fn liq_step(&mut self, g: &LiveG, q: &LiqQ) -> u32 {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let dt = self.inp.dt;
        let mpc = self.meta.mpc;
        let a_area = mpc * ROOM_DEPTH;
        let rg = q.rho * G_SI;
        let p0 = ROOM_P0 * 1000.0;
        let cd2 = 2.0 * LIQ_CD * LIQ_CD;
        let n2g = G_SI * LIQ_MANNING * LIQ_MANNING;
        let mut mm: Vec<f64> = (0..n).map(|i| self.grid64(&q.m, i)).collect();
        let mut ee: Vec<f64> = (0..n).map(|i| self.grid64(&q.e, i)).collect();
        let mut vu: Vec<f64> = (0..n).map(|i| self.grid32(&q.vu, i)).collect();
        let mut vv: Vec<f64> = (0..n).map(|i| self.grid32(&q.vv, i)).collect();
        let lp0: Vec<f64> = (0..n).map(|i| self.grid32(&q.p, i)).collect();
        let mut any = false;
        for i in 0..n {
            if mm[i] > 0.0 {
                any = true;
                break;
            }
        }
        if !any {
            for i in 0..n {
                vu[i] = 0.0;
                vv[i] = 0.0;
            }
            self.write_grid32(&q.vu, &vu);
            self.write_grid32(&q.vv, &vv);
            // JS leaves liqCgIt untouched here (stale readout); keep sc.
            return 0;
        }
        let mut cap = vec![0.0; n];
        let mut hc = vec![0.0; n];
        let mut h = vec![0.0; n];
        let mut gas = vec![0.0; n];
        let mut full = vec![0u8; n];
        let mut stand = vec![0u8; n];
        let pan: Vec<u8> = self.meta.g_pan.clone();
        let shut: Vec<bool> = (0..n).map(|i| self.liq_shut(g, i)).collect();
        // under-fill per cell (metal floats on water; water has none).
        let zf: Vec<f64> = match &q.u {
            None => vec![0.0; n],
            Some(wm) => {
                let wgrid = self.st.grids_f64.get(wm).cloned().unwrap_or(vec![0.0; n]);
                (0..n).map(|i| wgrid[i] / (WATER_RHO * mpc * ROOM_DEPTH)).collect()
            }
        };
        for i in 0..n {
            cap[i] = if shut[i] { 0.0 } else { self.liq_cap(q, i) };
            hc[i] = cap[i] / (q.rho * a_area);
            h[i] = mm[i] / (q.rho * a_area);
            gas[i] = (ROOM_P0 + self.grid32("roomP", i)) * 1000.0;
            full[i] = (cap[i] > 0.0 && mm[i] >= cap[i] * LIQ_FULL_K) as u8;
        }
        stand_walk(gw, gh, &pan, &shut, &full, &mut *stand);
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
            && q.tag == "water"
        {
            eprintln!("MOUND128PRE mmU={} mm128={} mmD={} eeU={} ee128={} eeD={}", mm[128-gw], mm[128], mm[128+gw], ee[128-gw], ee[128], ee[128+gw]);
        }
        // mound climb (writes gsDisp).
        for i in (gw..n).rev() {
            if !(cap[i] > 0.0 && mm[i] > cap[i] && stand[i] != 0 && self.liq_runs(g, i, i - gw) && !self.liq_shut(g, i - gw)) {
                continue;
            }
            let ex = mm[i] - cap[i];
            let ee_ = ee[i] * ex / mm[i];
            mm[i] -= ex;
            mm[i - gw] += ex;
            ee[i] -= ee_;
            ee[i - gw] += ee_;
            self.sc.disp[i - gw] += ex / q.rho;
            h[i] = mm[i] / (q.rho * a_area);
            h[i - gw] = mm[i - gw] / (q.rho * a_area);
            full[i - gw] = (cap[i - gw] > 0.0 && mm[i - gw] >= cap[i - gw] * LIQ_FULL_K) as u8;
        }
        stand_walk(gw, gh, &pan, &shut, &full, &mut *stand);
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
            && q.tag == "water"
        {
            eprintln!("MOUND128POST mm66={} mm128={} mm190={} ee66={} ee128={} ee190={}", mm[66], mm[128], mm[190], ee[66], ee[128], ee[190]);
        }
        let mut stiff = vec![0u8; n];
        for i in 0..n {
            stiff[i] = (full[i] != 0
                && stand[i] != 0
                && (i < gw || !self.liq_runs(g, i, i - gw) || h[i - gw] > LIQ_H_LO)) as u8;
        }
        let mut p = vec![0.0; n];
        for i in 0..n {
            p[i] = if stiff[i] != 0 {
                p0 + lp0[i] * 1000.0
            } else {
                lq_p_free(&gas, rg, &h, i)
            };
        }
        let dlo = rg * LIQ_H_LO;
        let dbg = LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed);
        let mut live = false;
        for i in 0..n {
            if live && !dbg {
                break;
            }
            let x = i % gw;
            if x < gw - 1
                && lq_runs_x(&cap, &self.meta.g_pan, &shut, i)
                && (h[i] > 0.0 || h[i + 1] > 0.0)
            {
                let d = lq_drive_x(&zf, &h, &hc, &stand, &p, rg, &gas, i, i + 1);
                if vu[i].abs() > LIQ_REST || d.abs() > dlo {
                    live = true;
                    if !dbg {
                        break;
                    }
                }
            }
            if i < n - gw && lq_runs_y(&cap, &self.meta.g_pan, &shut, i, gw) && (h[i] > 0.0 || h[i + gw] > 0.0) {
                let j = i + gw;
                let d = p[i]
                    - if full[j] != 0 {
                        p[j] - rg * js_min(h[j], hc[j])
                    } else {
                        gas[j]
                    };
                if vv[i].abs() > LIQ_REST || d.abs() > dlo {
                    live = true;
                    if !dbg {
                        break;
                    }
                }
            }
        }
        if dbg {
            let si = LIQ_SI.load(std::sync::atomic::Ordering::Relaxed);
            eprintln!("liqdbg si{si} {} live={live} dlo={dlo} rg={rg}", q.tag);
        }
        // NOTE: lqWriteP + early return need LP writeback — handled below.
        let iters: u32;
        if !live {
            for i in 0..n {
                vu[i] = 0.0;
                vv[i] = 0.0;
            }
            iters = 0;
        } else {
            iters = self.liq_solve(
                g, q, &mut mm, &mut ee, &mut vu, &mut vv, &mut cap, &mut hc, &mut h, &gas,
                &mut full, &mut stand, &mut stiff, &mut p, &shut, &zf, a_area, rg, p0, cd2, n2g, dt,
            );
        }
        // write back velocities + LP.
        self.write_grid32(&q.vu, &vu);
        self.write_grid32(&q.vv, &vv);
        // lqWriteP(LP, M, stand, p, gas, P0).
        {
            let lp_grid = q.p.clone();
            for i in 0..n {
                let v = if mm[i] > 0.0 {
                    ((if stand[i] != 0 { p[i] } else { gas[i] }) - p0) / 1000.0
                } else {
                    0.0
                };
                if let Some(gg) = self.st.grids_f32.get_mut(&lp_grid) {
                    RoomState::set_f32(gg, i, v);
                }
            }
        }
        // write back M/E.
        for i in 0..n {
            self.set_f64grid(&q.m, i, mm[i]);
            self.set_f64grid(&q.e, i, ee[i]);
        }
        self.sc.liq_it = iters;
        iters
    }

    /// `liqStep` passes 0/1 (with the lid retry): the implicit solve itself.
    #[allow(clippy::too_many_arguments)]
    pub fn liq_solve(
        &mut self,
        g: &LiveG,
        q: &LiqQ,
        mm: &mut [f64],
        ee: &mut [f64],
        vu: &mut [f64],
        vv: &mut [f64],
        cap: &mut [f64],
        hc: &mut [f64],
        h: &mut [f64],
        gas: &[f64],
        full: &mut [u8],
        stand: &mut [u8],
        stiff: &mut [u8],
        p: &mut [f64],
        shut: &[bool],
        zf: &[f64],
        a_area: f64,
        rg: f64,
        p0: f64,
        cd2: f64,
        n2g: f64,
        dt: f64,
    ) -> u32 {
        let pan: Vec<u8> = self.meta.g_pan.clone();
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let mut ax = vec![0.0; n];
        let mut ay = vec![0.0; n];
        let mut ayd = vec![0.0; n];
        let mut b = vec![0.0; n];
        let mut x = vec![0.0; n];
        let mut fx = vec![0.0; n];
        let mut fy = vec![0.0; n];
        let mut di = vec![0.0; n];
        let mut awx = vec![0.0; n];
        let mut awy = vec![0.0; n];
        let mut lat = vec![0.0; n];
        let mut comp = vec![0.0; n];
        let mut iters = 0u32;
        let mpc = self.meta.mpc;
        let liq_l_min = 0.05 * mpc;
        let has_hole = g.hole.iter().any(|&hh| hh != 0);
        for pass in 0..2 {
            for i in 0..n {
                comp[i] = if cap[i] > 0.0 {
                    if stiff[i] != 0 {
                        js_max(cap[i] / q.bulk, 1e-9)
                    } else {
                        a_area / G_SI
                    }
                } else {
                    1.0
                };
            }
            ax.fill(0.0);
            ay.fill(0.0);
            ayd.fill(0.0);
            fx.fill(0.0);
            fy.fill(0.0);
            awx.fill(0.0);
            awy.fill(0.0);
            lat.fill(0.0);
            for i in 0..n {
                let xx = i % gw;
                if xx < gw - 1 && lq_runs_x(cap, &pan, shut, i) {
                    let j = i + 1;
                    let hf = js_max(lq_hw(h, hc, i), lq_hw(h, hc, j));
                    let lz = stand[i] == 0
                        && stand[j] == 0
                        && js_max(
                            vu[i].abs(),
                            js_max(
                                if xx > 0 { vu[i - 1].abs() } else { 0.0 },
                                if xx < gw - 2 { vu[i + 1].abs() } else { 0.0 },
                            ),
                        ) <= js_max(
                            js_max(lq_fall_v(vv, i, gw, gh, n), lq_fall_v(vv, j, gw, gh, n)),
                            LIQ_REST,
                        );
                    let d0 = if lz {
                        0.0
                    } else {
                        lq_drive_x(zf, h, hc, stand, p, rg, gas, i, j)
                    };
                    if hf > 0.0 && !lz {
                        let v = vu[i];
                        let up = if v > 0.0 {
                            i
                        } else if v < 0.0 {
                            j
                        } else if d0 >= 0.0 {
                            i
                        } else {
                            j
                        };
                        let dn = if up == i { j } else { i };
                        let aw = ROOM_DEPTH * hf;
                        let ll = mpc;
                        let mut c = n2g * v.abs() / crate::fdlibm::pow(js_max(hf, 1e-3), 4.0 / 3.0);
                        if full[up] != 0 && !(full[dn] != 0 && stand[dn] != 0) && has_hole && (g.hole[i] != 0 || g.hole[j] != 0) {
                            c += v.abs() / (cd2 * ll);
                        }
                        let vup = if v > 0.0 {
                            if xx > 0 && awx[i - 1] > 0.0 { vu[i - 1] } else { 0.0 }
                        } else if v < 0.0 {
                            if xx < gw - 2 && lq_runs_x(cap, &pan, shut, j) { vu[j] } else { 0.0 }
                        } else {
                            0.0
                        };
                        let adv = v.abs() / mpc;
                        let den = 1.0 + dt * (c + adv);
                        let gg = aw * dt * dt / (ll * den);
                        awx[i] = aw;
                        ax[i] = gg;
                        fx[i] = q.rho * aw * dt * (v + dt * adv * vup) / den + gg * d0;
                        fx[i] += (lat[i] - lat[j]) * dt * dt / ll;
                    }
                }
                if i < n - gw && lq_runs_y(cap, &pan, shut, i, gw) {
                    let j = i + gw;
                    let v = vv[i];
                    let d0 = p[i]
                        - if full[j] != 0 {
                            p[j] - rg * js_min(h[j], hc[j])
                        } else {
                            gas[j]
                        };
                    let mut up = if v > 0.0 {
                        i
                    } else if v < 0.0 {
                        j
                    } else if d0 > 0.0 {
                        i
                    } else if d0 < 0.0 {
                        j
                    } else if mm[i] >= mm[j] {
                        i
                    } else {
                        j
                    };
                    if !(mm[up] > 0.0) {
                        up = if up == i { j } else { i };
                    }
                    let dn = if up == i { j } else { i };
                    let f = if cap[up] > 0.0 { js_min(1.0, mm[up] / cap[up]) } else { 0.0 };
                    if f > 0.0 {
                        let aw = a_area * f;
                        let ll = js_max(js_max(lq_hw(h, hc, i), lq_hw(h, hc, j)), liq_l_min);
                        let hf = js_max(f * mpc, 1e-3);
                        if stand[i] == 0 && stand[j] != 0 && v > 0.0 {
                            lat[j] += 0.5 * q.rho * aw * v * v;
                        }
                        let mut c = n2g * v.abs() / crate::fdlibm::pow(hf, 4.0 / 3.0);
                        if full[up] != 0 && !(full[dn] != 0 && stand[dn] != 0) && has_hole && (g.hole[i] != 0 || g.hole[j] != 0) {
                            c += v.abs() / (cd2 * ll);
                        }
                        let vup = if v > 0.0 {
                            if i >= gw && awy[i - gw] > 0.0 { vv[i - gw] } else { 0.0 }
                        } else if v < 0.0 {
                            if j < n - gw && lq_runs_y(cap, &pan, shut, j, gw) { vv[j] } else { 0.0 }
                        } else {
                            0.0
                        };
                        let adv = v.abs() / mpc;
                        let den = 1.0 + dt * (c + adv);
                        let gg = aw * dt * dt / (ll * den);
                        awy[i] = aw;
                        fy[i] = q.rho * aw * dt * (v + dt * adv * vup) / den + gg * d0;
                        if full[j] != 0 {
                            ay[i] = gg;
                        } else {
                            ayd[i] = gg;
                        }
                    }
                }
            }
            for i in 0..n {
                di[i] = comp[i] + ayd[i];
                b[i] = -(fx[i] - if i % gw > 0 { fx[i - 1] } else { 0.0 } + fy[i]
                    - if i >= gw { fy[i - gw] } else { 0.0 });
            }
            x.fill(0.0);
            iters = cg_solve(&b, &mut x, &di, &ax, &ay, LIQ_CG_TOL, LIQ_CG_MAX, &q.tag, gw, gh, &mut *self.warns);
            if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
                && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
                && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
                && q.tag == "water"
            {
                let td = std::env::temp_dir();
                let _ = std::fs::write(td.join("p8s1-rs-b.txt"), b.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
                let _ = std::fs::write(td.join("p8s1-rs-x.txt"), x.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
                let _ = std::fs::write(td.join("p8s1-rs-di.txt"), di.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
                let _ = std::fs::write(td.join("p8s1-rs-ax.txt"), ax.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
                let _ = std::fs::write(td.join("p8s1-rs-ay.txt"), ay.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
            }
            for i in 0..n {
                if ax[i] != 0.0 {
                    fx[i] += ax[i] * (x[i] - x[i + 1]);
                }
                if ay[i] != 0.0 {
                    fy[i] += ay[i] * (x[i] - x[i + gw]);
                } else if ayd[i] != 0.0 {
                    fy[i] += ayd[i] * x[i];
                }
            }
            // lid retry on pass 0: a lid the pass fills goes stiff.
            if pass == 0 {
                let mut lid = false;
                for i in 0..n {
                    let xx = i % gw;
                    if full[i] == 0 || stiff[i] != 0 || stand[i] == 0 {
                        continue;
                    }
                    let net = -fx[i]
                        + if xx > 0 { fx[i - 1] } else { 0.0 }
                        - fy[i]
                        + if i >= gw { fy[i - gw] } else { 0.0 };
                    if net > 1e-3 {
                        stiff[i] = 1;
                        lid = true;
                    }
                }
                if lid {
                    continue;
                }
            }
            break;
        }
        // velocities + cap + move + advect + swaps + stiff pressures.
        for i in 0..n {
            if awx[i] > 0.0 {
                let v = clamp(fx[i] / (q.rho * awx[i] * dt), -LIQ_V_MAX, LIQ_V_MAX);
                fx[i] = q.rho * awx[i] * dt * v;
            } else {
                fx[i] = 0.0;
            }
            if awy[i] > 0.0 {
                let mut v = clamp(fy[i] / (q.rho * awy[i] * dt), -LIQ_V_MAX, LIQ_V_MAX);
                // pan's rim (note reversed arg order) + brim-full check.
                if v < 0.0 && i + gw < n {
                    let j = i + gw;
                    let runs_up = !shut[i] && !(self.meta.g_pan[j] != 0 && self.meta.g_pan[i] == 0);
                    if !runs_up && full[j] == 0 {
                        v = 0.0;
                    }
                }
                fy[i] = q.rho * awy[i] * dt * v;
            } else {
                fy[i] = 0.0;
            }
        }
        let mut lcap = vec![0.0; n];
        for i in 0..n {
            lcap[i] = if stand[i] != 0 { cap[i] } else { f64::INFINITY };
        }
        face_limit_impl(&mm, &mut fx, &mut fy, 128, Some(&lcap), gw, gh, &mut *self.warns);
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
            && q.tag == "water"
        {
            let _ = std::fs::write(std::env::temp_dir().join("p8s1-rs-fx.txt"), fx.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
            let _ = std::fs::write(std::env::temp_dir().join("p8s1-rs-fy.txt"), fy.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));
        }
        for i in 0..n {
            vu[i] = if awx[i] > 0.0 { fx[i] / (q.rho * awx[i] * dt) } else { 0.0 };
            vv[i] = if awy[i] > 0.0 { fy[i] / (q.rho * awy[i] * dt) } else { 0.0 };
        }
        let m0 = mm.to_vec();
        let mut inn = vec![0.0; n];
        face_inflow(&mut inn, &fx, &fy, gw, gh);
        face_move(&mut *mm, &fx, &fy, gw, gh);
        room_advect(&mut *ee, &m0, mm, &fx, &fy, &inn, f64::INFINITY, gw, gh);
        for i in 0..n {
            if mm[i] <= 0.0 {
                mm[i] = 0.0;
                ee[i] = 0.0;
            }
        }
        // gas swap per face (state gas fields). vgas off live liquid:
        // own bundle's mm plus the other bundle's grid (already settled).
        let fr = self.meta.fire_cool.as_ref().map(|cc| cc.dens * RHO_K).unwrap_or(1000.0);
        let vcell = self.meta.der.room_vcell;
        let is_water = q.m == "roomWater";
        for i in 0..n {
            let swap = |cx: &mut Self, a: usize, c: usize, m: f64| {
                let w = if is_water { mm[c] } else { cx.grid64("roomWater", c) };
                let p = if is_water { cx.grid64("roomPool", c) } else { mm[c] };
                let vgc = js_max(ROOM_VG_MIN * vcell, vcell - w / WATER_RHO - p / fr);
                cx.lq_swap(a, c, m, q.rho, vgc);
            };
            if fx[i] > 0.0 {
                swap(&mut *self, i, i + 1, fx[i]);
            } else if fx[i] < 0.0 {
                swap(&mut *self, i + 1, i, -fx[i]);
            }
            if fy[i] > 0.0 {
                swap(&mut *self, i, i + gw, fy[i]);
            } else if fy[i] < 0.0 {
                swap(&mut *self, i + gw, i, -fy[i]);
            }
        }
        for i in 0..n {
            h[i] = mm[i] / (q.rho * a_area);
            full[i] = (cap[i] > 0.0 && mm[i] >= cap[i] * LIQ_FULL_K) as u8;
            p[i] = if stiff[i] != 0 { p[i] + x[i] } else { lq_p_free(&gas, rg, &h, i) };
        }
        stand_walk(gw, gh, &pan, &shut, &full, &mut *stand);
        {
            let lp_grid = q.p.clone();
            for i in 0..n {
                let v = if mm[i] > 0.0 {
                    ((if stand[i] != 0 { p[i] } else { gas[i] }) - p0) / 1000.0
                } else {
                    0.0
                };
                if let Some(gg) = self.st.grids_f32.get_mut(&lp_grid) {
                    RoomState::set_f32(gg, i, v);
                }
            }
        }
        iters
    }
    /// `lqSwap`: the volume that crossed pushes receiver gas back.
    pub fn lq_swap(&mut self, a: usize, c: usize, m: f64, rho: f64, vgas_c: f64) {
        let dv = m / rho;
        let f = js_min(1.0, dv / (vgas_c + dv));
        for key in ["roomM", "roomH2", "roomO2", "roomVap"] {
            let gc = self.st.grids_f32.get(key).and_then(|g| g.get(c)).copied().unwrap_or(0.0);
            let g = gc * f;
            if let Some(gg) = self.st.grids_f32.get_mut(key) {
                let av = gg[a];
                RoomState::set_f32(gg, c, gc - g);
                RoomState::set_f32(gg, a, av + g);
            }
        }
    }

    pub fn write_grid32(&mut self, grid: &str, v: &[f64]) {
        if let Some(g) = self.st.grids_f32.get_mut(grid) {
            for (j, vv) in v.iter().enumerate() {
                RoomState::set_f32(g, j, *vv);
            }
        }
    }
}

/// `lqStandWalk`.
pub fn stand_walk(gw: usize, gh: usize, pan: &[u8], shut: &[bool], full: &[u8], stand: &mut [u8]) {
    let n = gw * gh;
    for i in (0..n).rev() {
        let j = i + gw;
        // liqRuns(G,i,j) for the downward face (pan rim handled by callers).
        let runs = j < n && !shut[j] && !(pan[i] != 0 && pan[j] == 0);
        stand[i] = if j >= n || !runs { 1 } else if full[j] != 0 && stand[j] != 0 { 1 } else { 0 };
    }
}

/// `lqHw`.
pub fn lq_hw(h: &[f64], hc: &[f64], i: usize) -> f64 {
    js_min(h[i], hc[i])
}

/// `lqSide`.
pub fn lq_side(zf: &[f64], h: &[f64], hc: &[f64], stand: &[u8], p: &[f64], rg: f64, gas: &[f64], i: usize, hm: f64) -> f64 {
    let w = js_min(lq_hw(h, hc, i), hm);
    if stand[i] != 0 {
        (p[i] + rg * zf[i]) * w - rg * w * w / 2.0 + gas[i] * (hm - w)
    } else {
        gas[i] * hm
    }
}

/// `lqDriveX`.
pub fn lq_drive_x(
    qzf: &[f64],
    h: &[f64],
    hc: &[f64],
    stand: &[u8],
    p: &[f64],
    rg: f64,
    gas: &[f64],
    i: usize,
    j: usize,
) -> f64 {
    let hm = js_max(lq_hw(h, hc, i), lq_hw(h, hc, j));
    if hm > 0.0 {
        (lq_side(qzf, h, hc, stand, p, rg, gas, i, hm) - lq_side(qzf, h, hc, stand, p, rg, gas, j, hm)) / hm
    } else {
        0.0
    }
}

/// `lqRunsX`: both caps open and both directions run.
pub fn lq_runs_x(cap: &[f64], pan: &[u8], shut: &[bool], i: usize) -> bool {
    cap[i] > 0.0
        && cap[i + 1] > 0.0
        && !shut[i + 1]
        && !(pan[i] != 0 && pan[i + 1] == 0)
        && !shut[i]
        && !(pan[i + 1] != 0 && pan[i] == 0)
}

/// `lqRunsY`.
pub fn lq_runs_y(cap: &[f64], pan: &[u8], shut: &[bool], i: usize, gw: usize) -> bool {
    cap[i] > 0.0 && cap[i + gw] > 0.0 && !shut[i + gw] && !(pan[i] != 0 && pan[i + gw] == 0)
}

pub fn lq_p_free(gas: &[f64], rg: f64, h: &[f64], i: usize) -> f64 {
    gas[i] + rg * h[i]
}

/// `lqFallV`.
pub fn lq_fall_v(vv: &[f64], k: usize, gw: usize, _gh: usize, n: usize) -> f64 {
    js_max(
        if k < n - gw { vv[k].abs() } else { 0.0 },
        if k >= gw { vv[k - gw].abs() } else { 0.0 },
    )
}

impl<'a> Cx<'a> {
    /// `partFloodLine`: water surface rows over a machine, or null.
    pub fn part_flood_line(&self, p: &RoomPart, g: &LiveG) -> Option<f64> {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let qw = self.liq_water_q();
        let mut surf = f64::NEG_INFINITY;
        let x0 = 0.max(p.x - 1);
        let x1 = (gw as i32 - 1).min(p.x + p.w);
        let y0 = 0.max(p.y);
        let y1 = (gh as i32).min(p.y + p.h);
        for x in x0..=x1 {
            for y in y0..y1 {
                let i = (y as usize) * gw + (x as usize);
                let w = self.grid64("roomWater", i);
                if !(w > 0.0) || self.liq_shut(g, i) {
                    continue;
                }
                if !self.liq_stands(&qw, g, i) {
                    continue;
                }
                let v = self.liq_surf(&qw, g, i);
                if v > surf {
                    surf = v;
                }
            }
        }
        if !(surf > f64::NEG_INFINITY) {
            return None;
        }
        let line = gh as f64 - surf / self.meta.mpc;
        if p.y as f64 + p.h as f64 > line {
            Some(line)
        } else {
            None
        }
    }
    /// `poolT`.
    pub fn pool_t(&self, m: f64, e: f64) -> f64 {
        if !(m > 0.0) {
            return T_HULL;
        }
        let f = match self.meta.fire_rows.values().next() {
            Some(r) => r,
            None => return T_HULL,
        };
        let cp = self.meta.fire_cool.as_ref().map(|c| c.cp).unwrap_or(1.0);
        let ef = -m * f.lf;
        if e >= 0.0 {
            f.melt + e / (m * cp)
        } else if e > ef {
            f.melt
        } else {
            f.melt + (e - ef) / (m * cp)
        }
    }
    /// `roomWaterHeat`: boil + air exchange + sodium share.
    pub fn room_water_heat(&mut self, g: &LiveG) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let dt = self.inp.dt;
        let mpc = self.meta.mpc;
        let area = mpc * ROOM_DEPTH;
        let hk = ROOM_H * area / 1000.0;
        let qw = self.liq_water_q();
        // NOTE: boiling mutates W/E/Vap/M (locals) then writes back.
        let mut wv: Vec<f64> = (0..n).map(|i| self.grid64("roomWater", i)).collect();
        let mut ev: Vec<f64> = (0..n).map(|i| self.grid64("roomWaterE", i)).collect();
        let tt: Vec<f64> = (0..n).map(|i| self.grid64("roomT", i)).collect();
        let mut vap: Vec<f64> = (0..n).map(|i| self.grid32("roomVap", i)).collect();
        let mut mm: Vec<f64> = (0..n).map(|i| self.grid32("roomM", i)).collect();
        let mut src = self.sc.src.clone();
        for i in 0..n {
            let m = wv[i];
            if !(m > 0.0) {
                continue;
            }
            let pk = (ROOM_P0 + js_max(0.0, self.grid32("roomP", i))) / 1000.0;
            let ts = sat_t(&self.curves.water, pk);
            let hf = sat_h(&self.curves.water, pk);
            if ev[i] > m * hf {
                let hfg = hfg_of(&self.curves.water, ts);
                let dm = js_min(m, (ev[i] - m * hf) / hfg);
                wv[i] = m - dm;
                ev[i] -= dm * (hf + hfg);
                vap[i] += dm;
                mm[i] += dm;
                self.book("sump", dm);
                src[i] += dm * (hf + hfg - h_of_t(&self.curves.water, tt[i])) / dt;
                if wv[i] <= 0.0 {
                    wv[i] = 0.0;
                    src[i] += ev[i] / dt;
                    ev[i] = 0.0;
                    continue;
                }
            }
            if self.liq_full_at(&qw, i, wv[i]) && i >= gw && wv[i - gw] > 0.0 && !self.liq_shut(g, i - gw) {
                continue;
            }
            let tw = if wv[i] > 0.0 {
                H_DATUM + ev[i] / (wv[i] * self.water_cp())
            } else {
                T_HULL
            };
            let mut qk = hk * (tw - tt[i]);
            let cap = wv[i] * self.water_cp() * (tw - tt[i]) / dt;
            qk = if qk > 0.0 {
                js_min(qk, js_max(0.0, cap))
            } else {
                js_max(qk, js_min(0.0, cap))
            };
            if i == 128
                && LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
                && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
                && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
            {
                eprintln!("E128HEAT wv={} ev={} tw={} qk={} cap={} tt={} hk={}", wv[i], ev[i], tw, qk, cap, tt[i], hk);
            }
            ev[i] -= qk * dt;
            src[i] += qk;
        }
        for i in 0..n {
            self.set_f64grid("roomWater", i, wv[i]);
            self.set_f64grid("roomWaterE", i, ev[i]);
            self.set_f32grid("roomVap", i, vap[i]);
            self.set_f32grid("roomM", i, mm[i]);
        }
        self.sc.src = src;
    }
    pub fn water_cp(&self) -> f64 {
        self.curves.water.cp
    }
    /// `roomPoolLit`.
    pub fn room_pool_lit(&self, i: usize) -> bool {
        let gw = self.meta.gw;
        let m = self.grid64("roomPool", i);
        if !(m > 0.0) {
            return false;
        }
        if i >= gw && self.grid64("roomPool", i - gw) > 0.0 {
            return false;
        }
        let f = match self.meta.fire_rows.values().next() {
            Some(r) => r,
            None => return false,
        };
        self.pool_t(m, self.grid64("roomPoolE", i)) >= f.ign
            && self.room_o2_frac(i) >= f.loc
    }
    pub fn room_o2_frac(&self, i: usize) -> f64 {
        let o2 = self.grid32("roomO2", i) / O2_MMOL;
        o2 / js_max(1e-9, self.room_mol_x(i) + self.grid32("roomH2", i) / H2_MMOL)
    }
    pub fn room_mol_x(&self, i: usize) -> f64 {
        js_max(0.0, self.grid32("roomM", i) - self.grid32("roomH2", i) - self.grid32("roomVap", i)) / AIR_MMOL
            + self.grid32("roomVap", i) / H2O_MMOL
    }
    /// `panDrain`.
    pub fn pan_drain(&mut self, _g: &LiveG) {
        let dt = self.inp.dt;
        let parts = self.meta.g_parts.clone();
        for (pid, cells) in &parts {
            let role = self.meta.parts.iter().find(|p| &p.id == pid).map(|p| p.role.clone()).unwrap_or_default();
            if role != "pan" || self.part_wrecked(pid) {
                continue;
            }
            let want0 = PAN_DRAIN_KGS * dt;
            let mut want = want0;
            // water first (books sump), then metal (no book).
            for i in cells {
                if !(want > 0.0) {
                    break;
                }
                let m = self.grid64("roomWater", *i);
                let take = js_min(want, m);
                if !(take > 0.0) {
                    continue;
                }
                let e = self.grid64("roomWaterE", *i);
                self.set_f64grid("roomWaterE", *i, e - e * take / m);
                self.book("sump", take);
                self.set_f64grid("roomWater", *i, m - take);
                want -= take;
                let pb = self.st.maps.get("panBy").and_then(|mm| mm.get(pid)).unwrap_or(0.0);
                self.st.map_mut("panBy").set(pid, pb + take);
                let m2 = self.grid64("roomWater", *i);
                let e2 = self.grid64("roomWaterE", *i);
                if m2 <= 0.0 {
                    self.set_f64grid("roomWater", *i, 0.0);
                    self.set_f64grid("roomWaterE", *i, 0.0);
                    let _ = e2;
                }
            }
            for i in cells {
                if !(want > 0.0) {
                    break;
                }
                let m = self.grid64("roomPool", *i);
                let take = js_min(want, m);
                if !(take > 0.0) {
                    continue;
                }
                let e = self.grid64("roomPoolE", *i);
                self.set_f64grid("roomPoolE", *i, e - e * take / m);
                self.set_f64grid("roomPool", *i, m - take);
                want -= take;
                let pb = self.st.maps.get("panBy").and_then(|mm| mm.get(pid)).unwrap_or(0.0);
                self.st.map_mut("panBy").set(pid, pb + take);
                if self.grid64("roomPool", *i) <= 0.0 {
                    self.set_f64grid("roomPool", *i, 0.0);
                    self.set_f64grid("roomPoolE", *i, 0.0);
                }
            }
            let _ = want0;
        }
    }
}

impl<'a> Cx<'a> {
    /// `roomH2Frac` / `roomO2Frac` / `roomMolX` use live grids (above).
    /// `h2Sl`: laminar burning velocity vs fraction.
    pub fn h2_sl(&self, f: f64) -> f64 {
        if f <= H2_SL[0][0] || f >= H2_SL[H2_SL.len() - 1][0] {
            return 0.0;
        }
        for k in 1..H2_SL.len() {
            let x1 = H2_SL[k][0];
            let y1 = H2_SL[k][1];
            let x0 = H2_SL[k - 1][0];
            let y0 = H2_SL[k - 1][1];
            if f <= x1 {
                return y0 + (y1 - y0) * (f - x0) / (x1 - x0);
            }
        }
        0.0
    }
    pub fn room_h2_frac(&self, i: usize) -> f64 {
        let n = self.grid32("roomH2", i) / H2_MMOL;
        if n > 0.0 {
            n / (self.room_mol_x(i) + n)
        } else {
            0.0
        }
    }
    pub fn room_flam_of(&self, f: f64, fo2: f64) -> bool {
        f >= H2_LFL && f <= H2_UFL && fo2 >= O2_LOC
    }
    pub fn room_flam(&self, i: usize) -> bool {
        self.room_flam_of(self.room_h2_frac(i), self.room_o2_frac(i))
    }
    pub fn room_front_u(&self, i: usize) -> f64 {
        js_max(ROOM_FR_MIN, 1.0 - self.grid32("roomFlame", i))
    }
    pub fn room_front_frac(&self, i: usize) -> f64 {
        let n = self.grid32("roomH2", i) / H2_MMOL;
        if n > 0.0 {
            n / (self.room_mol_x(i) * self.room_front_u(i) + n)
        } else {
            0.0
        }
    }
    pub fn room_front_o2(&self, i: usize) -> f64 {
        self.grid32("roomO2", i) / O2_MMOL / js_max(1e-9, self.room_mol_x(i) * self.room_front_u(i) + self.grid32("roomH2", i) / H2_MMOL)
    }
    pub fn room_flam_front(&self, i: usize) -> bool {
        self.room_flam_of(self.room_front_frac(i), self.room_front_o2(i))
    }
    /// `roomIgnites`: hot air, hot skin, or a wrecked sparking box.
    pub fn room_ignites(&self, _g: &LiveG, i: usize) -> bool {
        if self.grid64("roomT", i) >= H2_IGN {
            return true;
        }
        let k = self.meta.g_own[i];
        if k < 0 {
            return false;
        }
        let pid = match self.meta.g_parts.get(k as usize) {
            Some((id, _)) => id.clone(),
            None => return false,
        };
        // partSkin(s, p) with p resolved for partTemp.
        let skin = match self.st.maps.get("partT").and_then(|m| m.get(&pid)) {
            Some(v) => v,
            None => self.part_temp(&pid).unwrap_or(T_HULL),
        };
        skin >= H2_IGN || self.part_wrecked(&pid)
    }
}

impl<'a> Cx<'a> {
    /// `roomGasDisplace`: expel gas to the ring.
    pub fn room_gas_displace(&mut self, g: &LiveG, i: usize, dv: f64) {
        if !(dv > 0.0) {
            return;
        }
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let vcell = self.meta.der.room_vcell;
        let fr = self.meta.fire_cool.as_ref().map(|c| c.dens * RHO_K).unwrap_or(1000.0);
        let n = gw * gh;
        let water = self.st.grids_f64.get("roomWater").cloned().unwrap_or(vec![0.0; n]);
        let pool = self.st.grids_f64.get("roomPool").cloned().unwrap_or(vec![0.0; n]);
        let bx = g.bx.clone();
        let by = g.by.clone();
        self.sc.gd_k += 1;
        let k = self.sc.gd_k;
        let mut q = vec![i];
        self.sc.gd_seen[i] = k;
        let mut h = 0usize;
        let mut w = 0.0;
        let mut nb: Vec<f64> = vec![];
        while h < q.len() && nb.is_empty() {
            let end = q.len();
            while h < end {
                let a = q[h];
                h += 1;
                let x = a % gw;
                let mut nbrs: Vec<(usize, f64)> = vec![];
                if a >= gw {
                    nbrs.push((a - gw, by[a - gw]));
                }
                if x < gw - 1 {
                    nbrs.push((a + 1, bx[a]));
                }
                if x > 0 {
                    nbrs.push((a - 1, bx[a - 1]));
                }
                for (j, b) in nbrs {
                    if !(b > 0.0) || self.sc.gd_seen[j] == k {
                        continue;
                    }
                    self.sc.gd_seen[j] = k;
                    let vv = js_max(ROOM_VG_MIN * vcell, vcell - water[j] / WATER_RHO - pool[j] / fr);
                    if vv > ROOM_VG_MIN * vcell * 1.0001 {
                        nb.push(j as f64);
                        nb.push(b * vv);
                        w += b * vv;
                    } else {
                        q.push(j);
                    }
                }
            }
        }
        if !(w > 0.0) {
            return;
        }
        let vi = js_max(ROOM_VG_MIN * vcell, vcell - water[i] / WATER_RHO - pool[i] / fr);
        let f = js_min(1.0, dv / vi);
        for key in ["roomM", "roomH2", "roomO2", "roomVap"] {
            let gc = self.st.grids_f32.get(key).and_then(|gg| gg.get(i)).copied().unwrap_or(0.0);
            let gg = gc * f;
            if let Some(gm) = self.st.grids_f32.get_mut(key) {
                let mut kk = 0usize;
                while kk < nb.len() {
                    let a = nb[kk] as usize;
                    let av = gm[a];
                    RoomState::set_f32(gm, a, av + gg * nb[kk + 1] / w);
                    kk += 2;
                }
                let cv = gm[i];
                RoomState::set_f32(gm, i, cv - gg);
            }
        }
        let _ = gh;
    }
    /// `roomFireStep`: spray burn + settle + drain + water + pool burn.
    pub fn room_fire_step(&mut self, g: &LiveG) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let dt = self.inp.dt;
        let mpc = self.meta.mpc;
        let (flhv, fo2row, fign, fmelt, fboil, _flf, frate, floc, femis, fhconv, fsigma, feta, fwlhv, fwh2, fwh2o, fwrate, fwast, fwastmax);
        {
            let f = match self.meta.fire_rows.values().next() {
                Some(r) => r,
                None => return,
            };
            flhv = f.lhv; fo2row = f.o2; fign = f.ign; fmelt = f.melt; fboil = f.boil; _flf = f.lf;
            frate = f.rate; floc = f.loc; femis = f.emis; fhconv = f.h_conv; fsigma = f.sigma; feta = f.eta;
            fwlhv = f.wlhv; fwh2 = f.wh2; fwh2o = f.wh2o; fwrate = f.wrate; fwast = f.wast; fwastmax = f.wast_max;
        }
        let _ = (flhv, floc, femis, fhconv, fsigma, feta, fwast, fwastmax);
        let cp = self.meta.fire_cool.as_ref().map(|c| c.cp).unwrap_or(1.0);
        self.sc.fire_q.fill(0.0);
        self.st.set_f("roomFireOn", 0.0);
        let mut on = 0u32;
        let cool = self.meta.fire_cool.is_some();
        if cool {
            let items = self.room_liq_outs(g);
            for (cells, _rate, fl, key) in items {
                let burn = self.meta.circ_burn.get(fl.ci as usize).and_then(|o| o.clone()).unwrap_or_default();
                let row = self.meta.fire_rows.get(&burn).cloned();
                let row = match row {
                    Some(r) if !cells.is_empty() => r,
                    _ => continue,
                };
                let kg = self.inp.out_kg.get(&key).copied().unwrap_or(0.0);
                if !(kg > 0.0) {
                    continue;
                }
                let pn = self.net_p_at(fl.nd.as_deref());
                let pr = (ROOM_P0 + self.grid32("roomP", cells[0])) * 1000.0;
                let v = libm::sqrt(2.0 * js_max(0.0, pn * 1e6 - pr) / self.fire_rho());
                let dd = self.inp.bore.get(&key).copied().unwrap_or(0.0);
                let we = ROOM_RHO * v * v * dd / row.sigma;
                let frac = if dd > 0.0 {
                    clamp((we - SPRAY_WE0) / (SPRAY_WE1 - SPRAY_WE0), 0.0, 1.0)
                } else {
                    0.0
                };
                let tin = t_of_h(&self.curves.of(fl.ci), self.net_p_at(fl.nd.as_deref()), fl.h);
                let want = if tin >= row.ign { kg * frac * row.eta } else { 0.0 };
                let mut burnt = 0.0;
                if want > 0.0 {
                    // collect share targets first.
                    let mut shares: Vec<(usize, f64)> = vec![];
                    self.room_share(&cells, kg / dt, |_cx, i, sh| {
                        shares.push((i, sh));
                    });
                    for (i, sh) in shares {
                        let o2 = self.grid32("roomO2", i);
                        let m = js_min(want * sh, o2 / row.o2);
                        if !(m > 0.0) {
                            continue;
                        }
                        self.set_f32grid("roomO2", i, o2 - m * row.o2);
                        let fq = self.sc.fire_q[i] + m * (row.lhv + cp * (tin - row.melt));
                        self.sc.fire_q[i] = fq;
                        burnt += m;
                        on += 1;
                    }
                }
                self.st.set_f("fireKg", self.st.f("fireKg") + burnt);
                self.st.set_f("fireQ", self.st.f("fireQ") + burnt * row.lhv);
                let pour = self.room_pour_cells(&key, &cells);
                let per = (kg - burnt) / pour.len() as f64;
                if per > 0.0 {
                    let qm = self.liq_metal_q();
                    for i in &pour {
                        self.liq_land(g, &qm, *i, per, per * cp * (tin - row.melt), v);
                    }
                }
            }
        }
        // settle both liquids, drain pans, heat water, displace filled gas.
        {
            let qm = self.liq_metal_q();
            if cool {
                self.liq_step(g, &qm);
            }
        }
        {
            let qw = self.liq_water_q();
            self.liq_step(g, &qw);
            self.e128("settle");
        }
        self.pan_drain(g);
        self.e128("pan");
        self.room_water_heat(g);
        self.e128("heat");
        for i in 0..n {
            if self.grid32("roomM", i) > 0.0 && !self.room_gas_cell(self.room_vgas(i)) {
                let vcell = self.meta.der.room_vcell;
                self.room_gas_displace(g, i, vcell);
            }
        }
        if !cool {
            return;
        }
        let a0 = mpc * mpc;
        for i in 0..n {
            let mut m = self.grid64("roomPool", i);
            if !(m > 0.0) {
                continue;
            }
            let below = if i + gw < n { self.grid64("roomPool", i + gw) } else { 0.0 };
            let a = js_min(a0, (m + below) / (self.fire_rho() * POOL_DMIN));
            let mut tp = self.pool_t(m, self.grid64("roomPoolE", i));
            let fo2 = self.room_o2_frac(i);
            let open = i < gw || !(self.grid64("roomPool", i - gw) > 0.0);
            if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
                && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 4
                && (m > 1.0 || tp > fign - 50.0)
            {
                let pi = LIQ_PI.load(std::sync::atomic::Ordering::Relaxed);
                let below = if i + gw < n { self.grid64("roomPool", i + gw) } else { 0.0 };
                let dbg_a = js_min(a0, (m + below) / (self.fire_rho() * POOL_DMIN));
                let sump = self.grid64("roomWater", i);
                let vap = self.grid32("roomVap", i);
                eprintln!("firedbg pi{pi} i={i} open={open} tp={tp} ign={fign} fo2={fo2} loc={floc} m={m} o2={} w={sump} vap={vap} wlhv={fwlhv} wrate={fwrate} wh2o={fwh2o} A={dbg_a} swna={}", self.grid32("roomO2", i), sw_na_for(fwh2o, sump + vap));
            }
            if open && fwlhv != 0.0 {
                let sump = self.grid64("roomWater", i);
                let vap = self.grid32("roomVap", i);
                let mw = js_min(js_min(fwrate * a * dt, m), sw_na_for(fwh2o, sump + vap));
                if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
                    && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 4
                    && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
                    && i == 2886
                {
                    eprintln!("mwDBG i={i} mw={mw} fwa={} m={m} swna={}", fwrate * a * dt, sw_na_for(fwh2o, sump + vap));
                }
                if mw > 0.0 {
                    let (qq, h2, h2o) = sw_react_row(fwlhv, fwh2, fwh2o, mw);
                    let mut need = h2o;
                    if sump > 0.0 {
                        let take = js_min(need, sump);
                        let se = self.grid64("roomWaterE", i);
                        self.set_f64grid("roomWaterE", i, se - se * take / sump);
                        self.set_f64grid("roomWater", i, sump - take);
                        self.book("sump", take);
                        need -= take;
                    }
                    if need > 0.0 {
                        let t = js_min(need, vap);
                        self.set_f32grid("roomM", i, self.grid32("roomM", i) - t);
                        self.set_f32grid("roomVap", i, vap - t);
                    }
                    m -= mw;
                    self.set_f64grid("roomPool", i, m);
                    let ei = self.grid64("roomPoolE", i);
                    self.set_f64grid("roomPoolE", i, ei + qq - mw * cp * (tp - fmelt));
                    self.set_f32grid("roomH2", i, self.grid32("roomH2", i) + h2);
                    self.set_f32grid("roomM", i, self.grid32("roomM", i) + h2);
                    self.st.set_f("fireKg", self.st.f("fireKg") + mw);
                    self.st.set_f("fireQ", self.st.f("fireQ") + qq);
                    on += 1;
                    tp = self.pool_t(m, self.grid64("roomPoolE", i));
                }
            }
            if open && tp >= fign && fo2 >= floc {
                let mb = js_min(js_min(frate * (fo2 / O2_FRAC0) * a * dt, m), self.grid32("roomO2", i) / fo2row);
                if mb > 0.0 {
                    m -= mb;
                    self.set_f64grid("roomPool", i, m);
                    let o2 = self.grid32("roomO2", i);
                    self.set_f32grid("roomO2", i, o2 - mb * fo2row);
                    let ei = self.grid64("roomPoolE", i);
                    self.set_f64grid("roomPoolE", i, ei + mb * flhv - mb * cp * (tp - fmelt));
                    self.st.set_f("fireKg", self.st.f("fireKg") + mb);
                    self.st.set_f("fireQ", self.st.f("fireQ") + mb * flhv);
                    on += 1;
                }
            }
            if !(m > 0.0) {
                self.set_f64grid("roomPool", i, 0.0);
                self.set_f64grid("roomPoolE", i, 0.0);
                continue;
            }
            tp = self.pool_t(m, self.grid64("roomPoolE", i));
            let mut q = (fhconv * (tp - self.grid64("roomT", i))
                + femis * SIGMA * (crate::fdlibm::pow(tp, 4.0) - crate::fdlibm::pow(self.grid64("roomT", i), 4.0)) / 1000.0)
                * a;
            let qcap = m * cp * (tp - self.grid64("roomT", i)) / dt;
            q = if q > 0.0 {
                js_min(q, js_max(0.0, qcap))
            } else {
                js_max(q, js_min(0.0, qcap))
            };
            {
                let ei = self.grid64("roomPoolE", i);
                self.set_f64grid("roomPoolE", i, ei - q * dt);
            }
            // src is scratch: accumulate via direct access.
            self.sc.src[i] += q;
            let emax = m * cp * (fboil - fmelt);
            let ex = self.grid64("roomPoolE", i);
            if ex > emax {
                self.sc.src[i] += (ex - emax) / dt;
                self.set_f64grid("roomPoolE", i, emax);
            }
        }
        self.st.set_f("roomFireOn", on as f64);
    }
}

impl<'a> Cx<'a> {
    /// `roomH2Step`: inlet, vent/inert sets, diffuse, ignite, burn, scar.
    pub fn room_h2_step(&mut self, g: &LiveG, pmax: f64) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let dt = self.inp.dt;
        self.st.set_f("roomBurnOn", 0.0);
        if self.st.f("h2") > 0.0 {
            let items = self.room_liq_outs(g);
            for (cells, rate, _fl, key) in items {
                let m = self.inp.out_h2.get(&key).copied().unwrap_or(0.0);
                if !(m > 0.0) || cells.is_empty() {
                    continue;
                }
                let kgps = js_max(0.0, rate) / 100.0 * self.meta.loop_kg;
                self.room_add_h2(&cells, kgps, m);
            }
        }
        if !self.st.b("blackout") {
            let parts = self.meta.g_parts.clone();
            for (pid, cells) in &parts {
                let role = self.meta.parts.iter().find(|p| &p.id == pid).map(|p| p.role.clone()).unwrap_or_default();
                if role != "vent" || self.part_wrecked(pid) {
                    continue;
                }
                let f = js_min(1.0, ROOM_VENT_KGS / cells.len() as f64 / self.meta.der.room_mair * dt);
                for i in cells {
                    let h = self.grid32("roomH2", *i);
                    self.set_f32grid("roomH2", *i, h - h * f);
                    let v = self.grid32("roomVap", *i);
                    self.set_f32grid("roomVap", *i, v - v * f);
                    let t = self.grid64("roomT", *i);
                    let vg = self.room_vgas(*i);
                    let m0 = ROOM_P0 / 1000.0 * vg / (R_AIR * js_max(t, 1.0));
                    let o = self.grid32("roomO2", *i);
                    self.set_f32grid("roomO2", *i, o + (self.meta.der.room_o2_0 / self.meta.der.room_m0 * m0 - o) * f);
                    let mm = self.grid32("roomM", *i);
                    self.set_f32grid("roomM", *i, mm + (m0 - mm) * f);
                }
            }
        }
        {
            let parts = self.meta.g_parts.clone();
            for (pid, cells) in &parts {
                let role = self.meta.parts.iter().find(|p| &p.id == pid).map(|p| p.role.clone()).unwrap_or_default();
                if role != "inert" || self.part_wrecked(pid) {
                    continue;
                }
                let f = js_min(1.0, INERT_KGS / cells.len() as f64 / self.meta.der.room_mair * dt);
                for i in cells {
                    let h = self.grid32("roomH2", *i);
                    self.set_f32grid("roomH2", *i, h - h * f);
                    let o = self.grid32("roomO2", *i);
                    self.set_f32grid("roomO2", *i, o - o * f);
                }
            }
        }
        self.room_diffuse(g, "roomH2", H2_UP);
        self.room_diffuse(g, "roomO2", 1.0);
        // ignite + burn fronts.
        for i in 0..n {
            if self.grid32("roomFlame", i) <= 0.0
                && self.grid32("roomH2", i) > 0.0
                && self.room_flam(i)
                && self.room_ignites(g, i)
            {
                self.set_f32grid("roomFlame", i, 1e-6);
            }
        }
        let mut burned = 0.0;
        let mut on = 0u32;
        for i in 0..n {
            let mut q = 0.0;
            if self.grid32("roomFlame", i) > 0.0 {
                if !self.room_flam_front(i) {
                    self.set_f32grid("roomFlame", i, 0.0);
                } else {
                    let adv = js_min(1.0, self.h2_sl(self.room_front_frac(i)) * self.meta.g_turb[i] * dt / self.meta.mpc);
                    let m = js_min(self.grid32("roomH2", i), self.grid32("roomO2", i) / self.meta.der.o2_per_h2) * adv;
                    if m > 0.0 {
                        self.set_f32grid("roomH2", i, self.grid32("roomH2", i) - m);
                        self.set_f32grid("roomO2", i, self.grid32("roomO2", i) - m * self.meta.der.o2_per_h2);
                        burned += m;
                        q = m * H2_LHV;
                    }
                    let nf = js_min(1.0, self.grid32("roomFlame", i) + adv);
                    if nf >= 1.0 && self.grid32("roomFlame", i) < 1.0 {
                        let x = i % gw;
                        let y = i / gw;
                        let mut nb = vec![];
                        if x > 0 {
                            nb.push(i - 1);
                        }
                        if x < gw - 1 {
                            nb.push(i + 1);
                        }
                        if y > 0 {
                            nb.push(i - gw);
                        }
                        if y < gh - 1 {
                            nb.push(i + gw);
                        }
                        for j in nb {
                            if self.grid32("roomFlame", j) <= 0.0 && self.room_flam(j) {
                                self.set_f32grid("roomFlame", j, 1e-6);
                            }
                        }
                    }
                    self.set_f32grid("roomFlame", i, nf);
                    on += 1;
                }
            }
            if self.sc.fire_q[i] > 0.0 {
                q += self.sc.fire_q[i];
            }
            if q > 0.0 {
                self.room_bang(i, q);
            }
        }
        let stt = self.room_p_static();
        self.scar_step(&stt);
        self.st.set_f("roomBurnOn", on as f64);
        self.st.set_f("roomPMax", pmax);
        if self.st.f("roomFireOn") != 0.0 && pmax > self.st.f("fireP") {
            self.st.set_f("fireP", pmax);
        }
        if burned > 0.0 || on > 0 {
            self.st.set_f("burnKg", self.st.f("burnKg") + burned);
            if pmax > self.st.f("burnP") {
                self.st.set_f("burnP", pmax);
            }
        }
    }
    /// `roomBang`: constant-volume heat into a cell's air.
    pub fn room_bang(&mut self, i: usize, kj: f64) {
        if !(kj > 0.0) {
            return;
        }
        let n = self.meta.gw * self.meta.gh;
        if i >= n {
            return;
        }
        let t = self.grid64("roomT", i);
        self.set_f64grid("roomT", i, js_min(ROOM_TMAX, t + kj / self.meta.der.room_cvair));
    }
    /// `roomDiffuse` with bias `up` over the LIVE conductances.
    pub fn room_diffuse(&mut self, g: &LiveG, key: &str, up: f64) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let f: Vec<f64> = (0..n).map(|i| self.grid32(key, i)).collect();
        let m: Vec<f64> = (0..n).map(|i| self.grid32("roomM", i)).collect();
        let mut y = vec![0.0; n];
        for i in 0..n {
            y[i] = if m[i] > 0.0 { f[i] / m[i] } else { 0.0 };
        }
        {
            let y0 = y[0];
            let mut flat = true;
            for i in 1..n {
                if y[i] != y0 {
                    flat = false;
                    break;
                }
            }
            if flat && (up == 1.0 || y0 == 0.0) {
                return;
            }
        }
        let mut d = vec![0.0; n];
        let gx = g.gx.clone();
        let gdn = g.gdn.clone();
        let rc = self.meta.der.room_c;
        for y2 in 0..gh {
            for x in 0..gw - 1 {
                let i = y2 * gw + x;
                let q = gx[i] * js_min(m[i], m[i + 1]) * (y[i] - y[i + 1]) / rc;
                d[i] -= q;
                d[i + 1] += q;
            }
        }
        for y2 in 0..gh - 1 {
            for x in 0..gw {
                let i = y2 * gw + x;
                let j = i + gw;
                let q = gdn[i] * js_min(m[i], m[j]) * (up * y[j] - y[i]) / rc;
                d[i] += q;
                d[j] -= q;
            }
        }
        for i in 0..n {
            let v = js_max(0.0, f[i] + d[i] * self.inp.dt);
            self.set_f32grid(key, i, v);
        }
    }
}

impl<'a> Cx<'a> {
    /// `roomStepLiqCb`: non-burn spill heats + airs the plume.
    pub fn room_step_liq_cb(&mut self, cells: Vec<usize>, _rate: f64, fl: Fluid, key: String) {
        if self.meta.circ_burn.get(fl.ci as usize).and_then(|o| o.clone()).map(|b| !b.is_empty()).unwrap_or(false) {
            return;
        }
        let kg = self.inp.out_kg.get(&key).copied().unwrap_or(0.0) / self.inp.dt
            * self.open_flash_x(&fl, cells.first().copied().map(|i| i as i32).unwrap_or(-1));
        // roomJetLiq(src, T, cells, kg, fl.h, fl.c).
        let c = self.curves.of(fl.ci).clone();
        let tt: Vec<f64> = {
            let n = self.meta.gw * self.meta.gh;
            (0..n).map(|i| self.grid64("roomT", i)).collect()
        };
        let mut items: Vec<(usize, f64)> = vec![];
        self.room_share(&cells, kg, |_cx, i, f| {
            items.push((i, f));
        });
        for (i, f) in items {
            let v = self.sc.src[i] + kg * f * (fl.h - h_of_t(&c, tt[i]));
            self.sc.src[i] = v;
        }
        // roomAddGas(s, cells, kg*dt, kg).
        let mut items2: Vec<(usize, f64)> = vec![];
        let mut w = 0.0;
        self.room_share(&cells, kg, |cx, i, f| {
            let v = f * cx.room_vgas(i);
            items2.push((i, v));
            w += v;
        });
        if !(w > 0.0) {
            return;
        }
        for (i, v) in items2 {
            let dm = kg * self.inp.dt * v / w;
            self.set_f32grid("roomM", i, self.grid32("roomM", i) + dm);
            self.set_f32grid("roomVap", i, self.grid32("roomVap", i) + dm);
        }
    }
    /// `injectRoom`: the INJECT tool's room half.
    pub fn inject_room(&mut self, g: &LiveG) {
        let present = self.inp.inj.present;
        if !present {
            return;
        }
        let kind = self.inp.inj.kind;
        let rate = self.inp.inj.rate;
        let target = self.inp.inj.target;
        let n = self.meta.gw * self.meta.gh;
        if !(rate != 0.0) || target < 0 || target >= n as i32 {
            return;
        }
        let i = target as usize;
        // kind codes: 0 heat, 1 gas, 2 fluid, 3 h2, 4 o2, 5 steam.
        if kind == 0 {
            if rate == 0.0 {
                return;
            }
            self.sc.src[i] += rate;
            return;
        }
        if kind == 1 {
            if !(rate < 0.0) {
                return;
            }
            let m = self.grid32("roomM", i);
            let f = js_min(1.0, -rate * self.inp.dt / js_max(m, 1e-9));
            for key in ["roomM", "roomH2", "roomO2", "roomVap"] {
                let v = self.grid32(key, i);
                self.set_f32grid(key, i, v - v * f);
            }
            return;
        }
        if kind == 2 {
            let w = self.grid64("roomWater", i);
            let dm = if rate > 0.0 {
                rate * self.inp.dt
            } else {
                -js_min(-rate * self.inp.dt, w)
            };
            if dm == 0.0 {
                return;
            }
            if dm > 0.0 {
                let hl = h_of_t(&self.curves.water, T_HULL);
                let v0 = rate / (WATER_RHO * self.meta.mpc * ROOM_DEPTH);
                let qw = self.liq_water_q();
                self.liq_land(g, &qw, i, dm, dm * hl, v0);
                self.book("inject", -dm);
                return;
            }
            let e = self.grid64("roomWaterE", i);
            self.set_f64grid("roomWaterE", i, e + e * dm / w);
            // gsDisp bump for the removed water.
            self.sc.disp[i] += dm / WATER_RHO;
            self.set_f64grid("roomWater", i, w + dm);
            self.book("inject", -dm);
            return;
        }
        if !(rate > 0.0) {
            return;
        }
        let dm = rate * self.inp.dt;
        if kind == 3 {
            self.set_f32grid("roomH2", i, self.grid32("roomH2", i) + dm);
        } else if kind == 4 {
            self.set_f32grid("roomO2", i, self.grid32("roomO2", i) + dm);
        } else if kind == 5 {
            self.set_f32grid("roomVap", i, self.grid32("roomVap", i) + dm);
        } else {
            return;
        }
        self.set_f32grid("roomM", i, self.grid32("roomM", i) + dm);
    }
    /// Dev-only cell-128 mound/heat trace.
    pub fn e128m(&self, mm128: f64, ee128: f64, tag: &str) {
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
        {
            eprintln!("E128M{tag} mm={mm128} ee={ee128}");
        }
    }
    /// Dev-only cell-128 phase trace.
    pub fn e128ph(&self, tag: &str) {
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
        {
            let w = self.grid64("roomWater", 128);
            let e = self.grid64("roomWaterE", 128);
            eprintln!("E128PH{tag} w={w} e={e}");
        }
    }
    /// Dev-only cell-128 energy trace.
    pub fn e128(&self, tag: &str) {
        if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
            && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
            && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
        {
            let e = self.grid64("roomWaterE", 128);
            let w = self.grid64("roomWater", 128);
            eprintln!("E128{tag} w={w} e={e}");
        }
    }
}

impl<'a> Cx<'a> {
    /// `roomStep`: the whole compartment tick.
    pub fn room_step(&mut self, g: &LiveG) {
        let gw = self.meta.gw;
        let gh = self.meta.gh;
        let n = gw * gh;
        let dt = self.inp.dt;
        self.sc.src.fill(0.0);
        let pmax = self.room_gas_step(g);
        // parts: skins + sources + prune.
        {
            let parts: Vec<(String, Vec<usize>)> = self.meta.g_parts.clone();
            for (pid, cells) in &parts {
                let tp = self.part_temp(pid);
                let proc = match tp {
                    Some(v) => v.is_finite(),
                    None => false,
                };
                let has_pt = self.st.maps.get("partT").and_then(|m| m.get(pid)).is_some();
                if !has_pt {
                    let v = if proc { tp.unwrap() } else { T_HULL };
                    self.st.map_mut("partT").set(pid, v);
                }
                let ts = self.st.maps.get("partT").and_then(|m| m.get(pid)).unwrap_or(T_HULL);
                let mut air = 0.0;
                for i in cells {
                    air += self.grid64("roomT", *i);
                }
                let nn = cells.len() as f64;
                let hk = self.meta.der.room_hk;
                let qproc = if proc { nn * hk * SKIN_PROC_K * (tp.unwrap() - ts) } else { 0.0 };
                self.st.map_mut("skinQ").set(pid, qproc);
                let cap = ROOM_SKIN_TAU * nn * hk;
                let v = clamp(ts + (qproc + hk * (air - nn * ts)) / cap * dt, T_SPACE, ROOM_TMAX);
                self.st.map_mut("partT").set(pid, v);
                for i in cells {
                    let t = self.grid64("roomT", *i);
                    let vv = self.sc.src[*i] + self.meta.der.room_hk * (ts - t);
                    self.sc.src[*i] = vv;
                }
            }
            // prune partT/skinQ to current parts.
            let keep: HashSet<String> = parts.iter().map(|(id, _)| id.clone()).collect();
            for key in ["partT", "skinQ"] {
                let dead: Vec<String> = self
                    .st
                    .maps
                    .get(key)
                    .map(|m| m.keys.iter().filter(|k| !keep.contains(*k)).cloned().collect())
                    .unwrap_or_default();
                for k in dead {
                    self.st.map_mut(key).del(&k);
                    if key == "partT" {
                        // partSeen cleanup has no replay-visible effect.
                    }
                }
            }
        }
        // runs: per-region skins + sources + prune.
        {
            let runs: Vec<(String, Vec<usize>)> = self.meta.g_runs.clone();
            let mut live_keys: HashSet<String> = HashSet::new();
            for (rkey, cells) in &runs {
                // segC: group by region (numeric ascending, like for-in).
                let mut seg: HashMap<i32, Vec<usize>> = HashMap::new();
                for i in cells {
                    let ri = self.meta.region_of.get(*i).copied().unwrap_or(-1);
                    if ri < 0 {
                        continue;
                    }
                    seg.entry(ri).or_default().push(*i);
                }
                let mut ris: Vec<i32> = seg.keys().copied().collect();
                ris.sort();
                for ri in ris {
                    let cc = &seg[&ri];
                    let key = format!("{rkey}#{ri}");
                    live_keys.insert(key.clone());
                    let tf = self.run_fluid_t(rkey);
                    let has = self.st.maps.get("runT").and_then(|m| m.get(&key)).is_some();
                    if !has {
                        self.st.map_mut("runT").set(&key, tf.unwrap_or(T_HULL));
                    }
                    let ts = self.st.maps.get("runT").and_then(|m| m.get(&key)).unwrap_or(T_HULL);
                    let mut air = 0.0;
                    for i in cc {
                        air += self.grid64("roomT", *i);
                    }
                    let nn = cc.len() as f64;
                    let qproc = match tf {
                        Some(v) => nn * self.meta.der.room_hk * SKIN_PROC_K * (v - ts),
                        None => 0.0,
                    };
                    let cap = ROOM_SKIN_TAU * nn * self.meta.der.room_hk;
                    let v = clamp(ts + (qproc + self.meta.der.room_hk * (air - nn * ts)) / cap * dt, T_SPACE, ROOM_TMAX);
                    self.st.map_mut("runT").set(&key, v);
                    for i in cc {
                        let t = self.grid64("roomT", *i);
                        let vv = self.sc.src[*i] + self.meta.der.room_hk * (ts - t);
                        self.sc.src[*i] = vv;
                    }
                }
            }
            let dead: Vec<String> = self
                .st
                .maps
                .get("runT")
                .map(|m| m.keys.iter().filter(|k| !live_keys.contains(*k)).cloned().collect())
                .unwrap_or_default();
            for k in dead {
                self.st.map_mut("runT").del(&k);
            }
        }
        // jets: relief steam + shell holes + sgH2.
        {
            let secs = self.meta.relief_sec.clone();
            for fid in &secs {
                if self.meta.fit_target.contains(fid) || self.meta.fit_vent_out.contains(fid) {
                    continue;
                }
                let cells = self.meta.g_parts.iter().find(|(id, _)| id == fid).map(|(_, c)| c.clone()).unwrap_or_default();
                let rs = self.st.maps.get("reliefSteam").and_then(|m| m.get(fid)).unwrap_or(0.0);
                self.room_jet(&cells, rs * self.meta.room_steam_h, rs);
                let g1 = rs * dt;
                let _ = g1;
                // roomAddGas(cells, rs*dt, rs).
                let mut items: Vec<(usize, f64)> = vec![];
                let mut w = 0.0;
                self.room_share(&cells, rs, |cx, i, f| {
                    let v = f * cx.room_vgas(i);
                    items.push((i, v));
                    w += v;
                });
                if w > 0.0 {
                    for (i, v) in items {
                        let dm = rs * dt * v / w;
                        self.set_f32grid("roomM", i, self.grid32("roomM", i) + dm);
                        self.set_f32grid("roomVap", i, self.grid32("roomVap", i) + dm);
                    }
                }
            }
            for bid in &self.meta.boiler_ids {
                let mut by_valve = 0.0;
                if let Some(fids) = self.meta.g_shell_valves.get(bid) {
                    for fid in fids {
                        by_valve += self.st.maps.get("reliefSteam").and_then(|m| m.get(fid)).unwrap_or(0.0);
                    }
                }
                let hole = js_max(0.0, self.st.maps.get("sgVentBy").and_then(|m| m.get(bid)).unwrap_or(0.0) - by_valve);
                let cells = self.meta.g_parts.iter().find(|(id, _)| id == bid).map(|(_, c)| c.clone()).unwrap_or_default();
                self.room_jet(&cells, hole * self.meta.room_steam_h, hole);
                let mut items: Vec<(usize, f64)> = vec![];
                let mut w = 0.0;
                self.room_share(&cells, hole, |cx, i, f| {
                    let v = f * cx.room_vgas(i);
                    items.push((i, v));
                    w += v;
                });
                if w > 0.0 {
                    for (i, v) in items {
                        let dm = hole * dt * v / w;
                        self.set_f32grid("roomM", i, self.grid32("roomM", i) + dm);
                        self.set_f32grid("roomVap", i, self.grid32("roomVap", i) + dm);
                    }
                }
            }
            // sgH2 plume (ordered state keys).
            let h2keys: Vec<(String, f64)> = self
                .st
                .maps
                .get("sgH2By")
                .map(|m| m.keys.iter().zip(m.vals.iter()).map(|(k, v)| (k.clone(), *v)).collect())
                .unwrap_or_default();
            for (id, m) in h2keys {
                let rate = self.st.maps.get("sgVentBy").and_then(|mm| mm.get(&id)).unwrap_or(0.0);
                if !(m > 0.0) || !(rate > 0.0) {
                    continue;
                }
                let nd = self.meta.shell_node.get(&id).cloned().unwrap_or_default();
                let ms = self.pf("mBy", &nd).unwrap_or(0.0) * clamp(self.net_qual_at(&nd), 0.0, 1.0);
                let f = js_min(1.0, rate * dt / js_max(ms, 1e-6));
                self.st.map_mut("sgH2By").set(&id, m - m * f);
                let cells = self.meta.g_parts.iter().find(|(pid, _)| pid == &id).map(|(_, c)| c.clone()).unwrap_or_default();
                self.room_add_h2(&cells, rate, m * f);
            }
        }
        // liquid call + inject + fire.
        {
            let items = self.room_liq_outs(g);
            for (cells, rate, fl, key) in items {
                self.room_step_liq_cb(cells, rate, fl, key);
            }
        }
        self.inject_room(g);
        self.e128("inj");
        self.room_fire_step(g);
        self.e128("fire");
        // vent sets (blackout gates them; wrecked sets pass nothing).
        if !self.st.b("blackout") {
            let vents: Vec<Vec<usize>> = self
                .meta
                .g_parts
                .iter()
                .filter(|(id, _)| {
                    self.meta.part_roles.get(id).map(|r| r == "vent").unwrap_or(false)
                        && !self.part_wrecked(id)
                })
                .map(|(_, c)| c.clone())
                .collect();
            for cells in &vents {
                if cells.is_empty() {
                    continue;
                }
                let ua = ROOM_VENT_KGS * ROOM_CP / cells.len() as f64;
                for i in cells {
                    let t = self.grid64("roomT", *i);
                    let v = self.sc.src[*i] - ua * (t - T_HULL);
                    self.sc.src[*i] = v;
                }
            }
        }
        // explicit diffuse + hull radiation + T integrate.
        {
            let n = gw * gh;
            for i in 0..n {
                self.sc.d[i] = self.sc.src[i];
            }
            for y in 0..gh {
                for x in 0..gw - 1 {
                    let i = y * gw + x;
                    let q = g.gx[i]
                        * (self.grid64("roomT", i) - self.grid64("roomT", i + 1));
                    self.sc.d[i] -= q;
                    self.sc.d[i + 1] += q;
                }
            }
            for y in 0..gh - 1 {
                for x in 0..gw {
                    let i = y * gw + x;
                    let j = i + gw;
                    let dt2 = self.grid64("roomT", j) - self.grid64("roomT", i);
                    let q = (if dt2 > 0.0 { g.gup[i] } else { g.gdn[i] }) * dt2;
                    self.sc.d[i] += q;
                    self.sc.d[j] -= q;
                }
            }
            let k = HULL_EMIS * SIGMA * self.meta.der.hull_face_a / 1000.0;
            for i in 0..n {
                if self.meta.g_face[i] != 0 {
                    let t = self.grid64("roomT", i);
                    self.sc.d[i] -= k
                        * self.meta.g_face[i] as f64
                        * (crate::fdlibm::pow(t, 4.0) - crate::fdlibm::pow(T_SPACE, 4.0));
                }
            }
            for i in 0..n {
                let t = self.grid64("roomT", i);
                let v = clamp(t + self.sc.d[i] / self.meta.der.room_c * dt, T_SPACE, ROOM_TMAX);
                self.set_f64grid("roomT", i, v);
            }
        }
        self.room_h2_step(g, pmax);
        self.room_condense(g);
        self.e128("cond");
        let mut mx = 0.0;
        let mut at = -1i32;
        for i in 0..n {
            let t = self.grid64("roomT", i);
            if t > mx {
                mx = t;
                at = i as i32;
            }
        }
        self.st.set_f("roomMax", mx);
        self.st.i32s.insert("roomMaxAt".to_string(), at);
    }
}

/// Replay driver: sump then room, sharing scratch (like the tick).
pub struct RoomReplay {
    pub events: Vec<LogEv>,
    pub warns: u32,
    pub cg_it: u32,
    pub liq_it: u32,
    // Warm-start threading for full-tick (§6.7): scratch outputs the next
    // tick's inputs (room gate replays one sample, so it never needs these).
    pub gsx: Vec<f64>,
    pub disp: Vec<f64>,
    pub pgen_cur: u32,
}

pub fn room_replay(
    meta: &RoomMeta,
    curves: &RoomCurves,
    st: &mut RoomState,
    inp: &RoomIn,
) -> RoomReplay {
    let mut ev = vec![];
    let mut warns = 0u32;
    let n = meta.gw * meta.gh;
    let mut sc = Scratch::default();
    sc.size(n);
    sc.pgen_cur = inp.pgen;
    sc.cg_it = inp.cg_it;
    sc.gs.x = inp.gsx.clone();
    sc.disp = inp.disp.clone();
    if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
        && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 4
        && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
    {
        eprintln!("coolDBG cool={} nfire={}", meta.fire_cool.is_some(), meta.fire_rows.len());
    }
    // sump on the pre-flood geometry, then room on the live overlay
    // (flood damage opens walls between the two, like the tick).
    let g1 = {
        let cx = Cx { meta, curves, st: &mut *st, inp, ev: &mut ev, warns: &mut warns, sc: &mut sc };
        cx.live_g()
    };
    {
        let mut cx = Cx { meta, curves, st: &mut *st, inp, ev: &mut ev, warns: &mut warns, sc: &mut sc };
        cx.sump_step(&g1);
    }
    let g2 = {
        let cx = Cx { meta, curves, st: &mut *st, inp, ev: &mut ev, warns: &mut warns, sc: &mut sc };
        cx.live_g()
    };
    {
        let mut cx = Cx { meta, curves, st: &mut *st, inp, ev: &mut ev, warns: &mut warns, sc: &mut sc };
        cx.e128ph("sump");
        cx.room_step(&g2);
    }
    if LIQ_DEBUG.load(std::sync::atomic::Ordering::Relaxed)
        && LIQ_SI.load(std::sync::atomic::Ordering::Relaxed) == 1
        && LIQ_PI.load(std::sync::atomic::Ordering::Relaxed) == 8
    {
        let e = st.grids_f64.get("roomWaterE").and_then(|g| g.get(128)).copied().unwrap_or(f64::NAN);
        let w = st.grids_f64.get("roomWater").and_then(|g| g.get(128)).copied().unwrap_or(f64::NAN);
        eprintln!("E128END w={w} e={e}");
    }
    // Latch scalars live in f64s during replay; mirror to struct fields for compare.
    st.burn_kg = st.f("burnKg");
    st.burn_p = st.f("burnP");
    st.burn_blast = st.f("burnBlast");
    st.fire_kg = st.f("fireKg");
    st.fire_p = st.f("fireP");
    st.fire_q = st.f("fireQ");
    RoomReplay { events: ev, warns, cg_it: sc.cg_it, liq_it: sc.liq_it, gsx: sc.gs.x.clone(), disp: sc.disp.clone(), pgen_cur: sc.pgen_cur }
}
















