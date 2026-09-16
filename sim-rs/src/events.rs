//! Events tail replay: the `stepMarch` tail after `roomStep`, in order —
//! `blastStep` + `overpressureStep` + `burnFireStep` + `cookStep` +
//! `evLatchStep` (incl. `annStep` every 5th tick) + `repairStep` +
//! `flowSpinStep` + `ledgerStep` — plus `radDoseStep`, which runs just
//! before `injectFluid`/`roomStep` but belongs to this module's scope.
//!
//! Dump-kit rules (same as sec/room): solved/transport artifacts arrive as
//! values (runFlow, sumpKg, condP, verdicts, steam books, partSkin), field
//! bags and masks as tables, transcendental-free replay (helper-level
//! exp/log/pow route through `crate::fdlibm`).

use std::collections::{HashMap, HashSet};

use crate::eos::{clamp, js_max, js_min, js_truthy};
use crate::tick::*;

// Asserted gate-side (events-gate assertConsts), same values as JS.
pub const ROOM_CRUSH_K: f64 = 10.0;
pub const ROOM_CRUSH_SPAN: f64 = 0.5;
pub const ROOM_CRUSH_TAU: f64 = 60.0;
pub const ROOM_DMG_SPAN: f64 = 60.0;
pub const ROOM_DMG_TAU: f64 = 25.0;
pub const PIPE_PBURST: f64 = 120.0;
pub const PIPE_TSURV: f64 = 900.0;
pub const H2_BURN_EV: f64 = 1.0;
pub const H2_LHV: f64 = 120000.0;
pub const FIRE_EV_KG: f64 = 1.0;
pub const LEDGER_EPS: f64 = 1e-7;
pub const LEDGER_QUIET: f64 = 30.0;
pub const H2_EV: f64 = 20.0;
pub const H2_LFL: f64 = 0.04;
pub const RAD_HI: f64 = 1.0;
pub const RAD_FLOOR: f64 = 0.02;
pub const RAD_CEIL: f64 = 3.0;
pub const RAD_CREW_K: f64 = 0.33;
pub const RAD_DOSE_K: f64 = 0.25;
pub const RAD_BREACH: f64 = 3.0;
pub const RAD_DMG: f64 = 0.06;
pub const RAD_MELT: f64 = 4.0;
pub const RAD_SGTR: f64 = 1.2;
pub const RAD_AIR: f64 = 0.05;
pub const RAD_TANK: f64 = 0.03;
pub const RAD_SLOW: f64 = 0.5;
pub const ANN_TICKS: i32 = 5;
pub const DRAW_K: f64 = 8.375;
pub const PROMPT_F: f64 = 0.935;
pub const SG_LOW: f64 = 35.0;
pub const SG_DRY_LO: f64 = 10.0;
pub const TURB_TRIP_P: f64 = 0.02;
pub const COND_DT0: f64 = 13.0;
pub const TPROG_SPAN: f64 = 18.0;
pub const T_HULL: f64 = 293.0;
pub const AIR_MMOL: f64 = 0.02896;
pub const H2_MMOL: f64 = 0.002016;
pub const H2O_MMOL: f64 = 0.018015;

// Severity codes (match the gate's EVMSG table).
pub const SEV_ALARM: u8 = 0;
pub const SEV_WARN: u8 = 1;
pub const SEV_INFO: u8 = 2;

/// One LAY part (geometry + gate-resolved thresholds).
#[derive(Clone, Default)]
pub struct EvPart {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub role: String,
    pub name: String,
    pub pburst: f64,
    pub pdes: f64,
    pub tsurv: f64,
    pub face_nodes: [Option<String>; 4],
    pub part_on: Option<String>,
    pub tank_hold: bool,
}

/// One cellHazards entry (gate-resolved).
#[derive(Clone, Default)]
pub struct EvHaz {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub lim: f64,
    pub what: String,
}

/// One core vessel: the fields coreAgg/radSrc/ANN/dmgFx read or write.
#[derive(Clone, Default)]
pub struct EvVessel {
    pub n: f64,
    pub decay: f64,
    pub dmg: f64,
    pub melt_frac: f64,
    pub dec: Vec<f64>,
    pub tf: f64,
    pub dnbr: f64,
    pub vf: f64,
    pub ox_max: f64,
    pub q_ox: f64,
    pub fatigue: f64,
    pub scrammed: bool,
    pub breach: bool,
    pub melt: bool,
    pub trip: String,
    pub rod_pos: f64,
    pub rod_jam: bool,
    pub rod_band: bool,
    pub rho: f64,
    pub parts_xe: f64,
    pub tilt: f64,
    pub rod_z: Vec<f64>,
    pub rod_z_dem: Vec<f64>,
    pub tilt_dem: f64,
    pub rod_dem: f64,
    pub rps_hot: f64,
    pub rps_near: bool,
}

/// Per-tank static facts (all resolved gate-side).
#[derive(Clone, Default)]
pub struct EvTank {
    pub inf: bool,
    pub hold: bool,
    pub cell: bool,
    pub level: f64,
    pub act: f64,
    pub kg: f64,
    pub in_field: bool,
}

/// Resolved steam book per flow run (gate-side via real steamBook/steamDir).
#[derive(Clone, Default)]
pub struct EvSteamBook {
    pub vent: bool,
    pub taps: Vec<String>,
    pub dir: f64,
    pub gens: Vec<String>,
    pub ends: bool,
}

/// Per-preset meta.
#[derive(Clone, Default)]
pub struct EventsMeta {
    pub gw: usize,
    pub gh: usize,
    pub parts: Vec<EvPart>,
    pub hazards: Vec<EvHaz>,
    pub core_ids: Vec<String>,
    pub primary_core: String,
    pub cores_rated: HashMap<String, f64>,
    pub cores_nb: HashMap<String, usize>,
    pub circ_key: HashMap<i32, String>,
    pub core_ci: HashMap<String, i32>,
    pub core_circ: i32,
    pub circ_tref: HashMap<i32, f64>,
    pub core_hold: HashMap<String, String>,
    pub tf_ref: f64,
    pub dnbr0: f64,
    pub tref: f64,
    pub steam_flag: f64,
    pub rated: f64,
    pub cores_tref: HashMap<String, f64>,
    pub cores_steam: HashMap<String, f64>,
    pub flow_min: f64,
    pub p0: f64,
    pub rated_steam: f64,
    pub sg_lift: f64,
    pub sg_ids: Vec<String>,
    pub boiler_ids: Vec<String>,
    pub pump_ids: Vec<String>,
    pub primary_pumps: HashSet<String>,
    pub tank_ids: Vec<String>,
    pub tanks: HashMap<String, EvTank>,
    pub relief_fit_ids: Vec<String>,
    pub rad_ids: Vec<String>,
    pub rad_live: HashMap<String, bool>,
    pub primary_relief: Option<String>,
    pub node_names: HashSet<String>,
    pub incore_names: HashSet<String>,
    pub booked: Vec<u8>,
    pub run_keys: Vec<String>,
    pub run_pos: HashMap<String, usize>,
    pub by_key: HashMap<String, EvRun>,
    pub tag_by_key: HashMap<String, i32>,
    pub net_ref_by_run: HashMap<String, f64>,
    pub steam_book: HashMap<String, EvSteamBook>,
    pub mat_of: Vec<i32>,
    pub crew_rect: Option<[i32; 4]>,
    pub kern_core: Vec<(String, Vec<f64>)>,
    pub kern_sg: Vec<Vec<f64>>,
    pub kern_tank: Vec<(String, Vec<f64>)>,
    pub kern_pipe: Option<Vec<f64>>,
    pub has_pipe_kernel: bool,
    pub bkp: f64,
    pub panel_thresh: f64,
    pub vessel_flag: bool,
    pub flow_k: f64,
    pub catcher: bool,
    pub fuel_in_coolant: bool,
    pub tank_water_act: f64,
}

/// One flow run's static endpoints (gate-resolved).
#[derive(Clone, Default)]
pub struct EvRun {
    pub k: String,
    pub pa: String,
    pub pb: String,
}

/// Full mutable state (pre in, post out).
#[derive(Clone, Default)]
pub struct EventsState {
    pub tick: i32,
    pub n: f64,
    pub decay: f64,
    pub dec: Vec<f64>,
    pub heat: f64,
    pub dmg: f64,
    pub melt_frac: f64,
    pub tf: f64,
    pub dnbr: f64,
    pub vf: f64,
    pub ox_max: f64,
    pub q_ox: f64,
    pub fatigue: f64,
    pub scrammed: bool,
    pub breach: bool,
    pub melt: bool,
    pub trip: String,
    pub rod_pos: f64,
    pub rod_jam: bool,
    pub rod_band: bool,
    pub rho: f64,
    pub parts_xe: f64,
    pub p: f64,
    pub tavg: f64,
    pub lvl: f64,
    pub sc: f64,
    pub cav: f64,
    pub h2: f64,
    pub inj_rate: f64,
    pub release: f64,
    pub blackout: bool,
    pub load: f64,
    pub load_dem: f64,
    pub bkp_lost: bool,
    pub sgtr: bool,
    pub flow_net: f64,
    pub turb_trip: bool,
    pub cond_lost: bool,
    pub crew_dose: f64,
    pub dose: f64,
    pub dose_rate: f64,
    pub rep_rate: f64,
    pub party_spent: bool,
    pub mass_res: f64,
    pub mass_warn: f64,
    pub mass_warn_t: i32,
    pub room_pmax: f64,
    pub room_burn_on: f64,
    pub room_fire_on: f64,
    pub room_bang: f64,
    pub room_max: f64,
    pub spin_v: f64,
    pub spin_tv: f64,
    pub ann_rev: u32,
    pub burn_blast: bool,
    pub burn_kg: f64,
    pub burn_p: f64,
    pub burn_ids: Vec<String>,
    pub fire_kg: f64,
    pub fire_p: f64,
    pub fire_q: f64,
    pub repair_present: bool,
    pub repair_t: f64,
    pub repair_need: f64,
    pub repair_id: String,
    pub room_p: Vec<f64>,
    pub room_t: Vec<f64>,
    pub room_h2: Vec<f64>,
    pub room_m: Vec<f64>,
    pub room_vap: Vec<f64>,
    pub vessels: HashMap<String, EvVessel>,
    pub tank: HashMap<String, f64>,
    pub mby_has: Vec<u8>,
    pub mby_v: Vec<f64>,
    pub mass_out: HashMap<String, f64>,
    pub mass_out_order: Vec<String>,
    pub dmg_parts: Vec<String>,
    pub dmg_why: HashMap<String, String>,
    pub room_crush: HashMap<String, f64>,
    pub room_hurt: HashMap<String, f64>,
    pub flow_pos: HashMap<String, f64>,
    pub ev: HashMap<String, bool>,
    pub ann_on: HashMap<String, u8>,
    pub relief_open: HashMap<String, bool>,
    pub relief_blocked: HashMap<String, bool>,
    pub relief_stuck: HashMap<String, bool>,
    pub relief_auto: HashMap<String, bool>,
    pub relief_steam: HashMap<String, f64>,
    pub sg_burst: HashMap<String, bool>,
    pub port_shut: HashSet<String>,
    pub flow_demby: HashMap<String, f64>,
    pub lvl_by: HashMap<String, f64>,
    pub sc_by: HashMap<String, f64>,
    pub tavg_by: HashMap<String, f64>,
}

/// Per-sample inputs (dump-kit values).
#[derive(Clone, Default)]
pub struct EventsIn {
    pub dt: f64,
    pub cav_ids: Vec<String>,
    pub inj_ids: Vec<String>,
    pub runflow: Vec<f64>,
    pub ledg_m0: f64,
    pub ledg_o0: f64,
    pub sump_kg: f64,
    pub cond_p: f64,
    pub rps_state: String,
    pub sink_runback: bool,
    pub runback_live: bool,
    pub trip_near: bool,
    pub dry_ids: Vec<String>,
    pub part_skin: Vec<f64>,
    pub panel_hit: f64,
    pub cond_frac: f64,
    pub sec_p: HashMap<String, f64>,
    pub boiler_lvl: HashMap<String, f64>,
    pub loopp_by_core: HashMap<String, f64>,
    pub cont_rel: HashMap<String, f64>,
    pub party_cells: Vec<usize>,
    pub log0: u32,
}

pub struct Cx<'a> {
    pub _meta: &'a EventsMeta,
}

/// `hurtStep`: ramp damage integral; true on the tick it trips.
pub fn hurt_step(bag: &mut HashMap<String, f64>, id: &str, over: f64, tau: f64, dt: f64) -> bool {
    if !(over > 0.0) {
        return false;
    }
    let h = bag.get(id).copied().unwrap_or(0.0) + js_min(over, 1.0) * dt / tau;
    bag.insert(id.to_string(), h);
    if h < 1.0 {
        return false;
    }
    bag.insert(id.to_string(), 0.0);
    true
}

/// `coreAgg`: rated-weighted vessel aggregates onto S.
pub fn core_agg(meta: &EventsMeta, st: &mut EventsState) {
    let mut r = 0.0;
    for id in &meta.core_ids {
        r += meta.cores_rated.get(id).copied().unwrap_or(0.0);
    }
    let ng = st.dec.len();
    let mut n = 0.0;
    let mut dec = 0.0;
    let mut dmg = 0.0;
    let mut mf = 0.0;
    let mut tf = f64::NEG_INFINITY;
    let mut dnbr = f64::INFINITY;
    let mut vf = 0.0;
    let mut ox = 0.0;
    let mut qox = 0.0;
    let mut fat = 0.0;
    let mut any = false;
    let mut scr = false;
    let mut brk = false;
    let mut melt = false;
    let mut trip = String::new();
    let mut grp = vec![0.0; ng];
    for id in &meta.core_ids {
        let Some(c) = st.vessels.get(id) else { continue };
        any = true;
        let w = if r > 0.0 { meta.cores_rated.get(id).copied().unwrap_or(0.0) / r } else { 0.0 };
        n += w * c.n;
        dec += w * c.decay;
        dmg += w * c.dmg;
        mf += w * c.melt_frac;
        if c.dec.len() == ng {
            for i in 0..ng {
                grp[i] += w * c.dec[i];
            }
        }
        tf = js_max(tf, c.tf);
        dnbr = js_min(dnbr, c.dnbr);
        vf = js_max(vf, c.vf);
        ox = js_max(ox, c.ox_max);
        qox = js_max(qox, c.q_ox);
        fat = js_max(fat, c.fatigue);
        scr = scr || c.scrammed;
        brk = brk || c.breach;
        melt = melt || c.melt;
        if trip.is_empty() && !c.trip.is_empty() {
            trip = c.trip.clone();
        }
    }
    st.n = if any { n } else { 1e-9 };
    st.decay = dec;
    st.dec = grp;
    st.heat = st.n * PROMPT_F + st.decay;
    st.dmg = dmg;
    st.melt_frac = mf;
    st.tf = if any { tf } else { meta.tf_ref };
    st.dnbr = if any { dnbr } else { meta.dnbr0 };
    st.vf = vf;
    st.ox_max = ox;
    st.q_ox = qox;
    st.fatigue = fat;
    st.scrammed = scr;
    st.breach = brk;
    st.melt = melt;
    st.trip = trip;
    if let Some(p) = st.vessels.get(&meta.primary_core) {
        st.rod_pos = p.rod_pos;
        st.rod_jam = p.rod_jam;
        st.rod_band = p.rod_band;
        st.rho = p.rho;
        st.parts_xe = p.parts_xe;
    }
}

/// Mean room pressure per region (roomPStatic's field).
fn region_p_mean(meta: &EventsMeta, room_p: &[f64]) -> Vec<f64> {
    let mut nreg = 0usize;
    for r in &meta.mat_of {
        nreg = nreg.max((*r + 1).max(0) as usize);
    }
    let nreg = nreg.max(1) as usize;
    let mut sum = vec![0.0; nreg];
    let mut cnt = vec![0u32; nreg];
    for (i, r) in meta.mat_of.iter().enumerate() {
        if *r < 0 || i >= room_p.len() {
            continue;
        }
        sum[*r as usize] += room_p[i];
        cnt[*r as usize] += 1;
    }
    sum.iter()
        .zip(cnt.iter())
        .map(|(s, c)| if *c > 0 { s / *c as f64 } else { 0.0 })
        .collect()
}

/// `roomPStatic`: region-mean pressure field (probe recomputes fresh; the
/// JS memo keyed on (s, roomPGen) is a pure cache).
fn room_p_static(meta: &EventsMeta, room_p: &[f64]) -> Vec<f64> {
    let m = region_p_mean(meta, room_p);
    meta.mat_of
        .iter()
        .map(|r| if *r < 0 { 0.0 } else { m[*r as usize] })
        .collect()
}

/// `roomPAt`: worst cell pressure over a part rect, minus gauge if given.
fn room_p_at(room_p: &[f64], gw: usize, gh: usize, x: i32, y: i32, w: i32, h: i32, g: Option<&[f64]>) -> f64 {
    let mut v = 0.0;
    for xx in x..x + w {
        for yy in y..y + h {
            if xx < 0 || yy < 0 || xx >= gw as i32 || yy >= gh as i32 {
                continue;
            }
            let i = (yy as usize) * gw + xx as usize;
            let q = match g {
                Some(gg) => room_p[i] - gg[i],
                None => room_p[i],
            };
            if q > v {
                v = q;
            }
        }
    }
    v
}

/// `roomAt`: worst air temperature over a part rect (T_HULL floor).
fn room_at(room_t: &[f64], gw: usize, gh: usize, x: i32, y: i32, w: i32, h: i32) -> f64 {
    let mut v = 0.0;
    for xx in x..x + w {
        for yy in y..y + h {
            if xx < 0 || yy < 0 || xx >= gw as i32 || yy >= gh as i32 {
                continue;
            }
            let i = (yy as usize) * gw + xx as usize;
            if room_t[i] > v {
                v = room_t[i];
            }
        }
    }
    if v == 0.0 {
        T_HULL
    } else {
        v
    }
}

/// `roomH2Frac`/`roomMolX` (room.js) on events state.
fn room_mol_x(m: f64, h2: f64, vap: f64) -> f64 {
    js_max(0.0, m - h2 - vap) / AIR_MMOL + vap / H2O_MMOL
}
fn room_h2_frac(m: f64, h2: f64, vap: f64) -> f64 {
    let n = h2 / H2_MMOL;
    if n > 0.0 {
        n / (room_mol_x(m, h2, vap) + n)
    } else {
        0.0
    }
}

/// `roomH2Peak`: worst H2 volume fraction over gas cells.
fn room_h2_peak(room_h2: &[f64], room_m: &[f64], room_vap: &[f64]) -> f64 {
    let mut v = 0.0;
    for i in 0..room_h2.len() {
        let f = room_h2_frac(
            room_m.get(i).copied().unwrap_or(0.0),
            room_h2[i],
            room_vap.get(i).copied().unwrap_or(0.0),
        );
        if f > v {
            v = f;
        }
    }
    v
}

/// `roomOverIds`: parts whose skin is past survival.
fn room_over_ids(meta: &EventsMeta, part_skin: &[f64]) -> Vec<String> {
    let mut out = Vec::new();
    for (k, p) in meta.parts.iter().enumerate() {
        if p.tsurv != 0.0 && fitted(meta, p) {
            let skin = part_skin.get(k).copied().unwrap_or(T_HULL);
            if skin > p.tsurv {
                out.push(p.id.clone());
            }
        }
    }
    out
}

fn fitted(meta: &EventsMeta, p: &EvPart) -> bool {
    if p.role == "bkp" {
        meta.bkp > 0.0
    } else {
        true
    }
}

/// Owned bridge into `tick.rs` dmg applier (maps live in the bridge, so the
/// borrowed `DmgCtx` is valid for the whole replay).
pub struct DmgBridge {
    pub part_role: HashMap<String, String>,
    pub part_on: HashMap<String, Option<String>>,
    pub nb: HashMap<String, usize>,
    pub tank_hold: HashMap<String, bool>,
    pub primary_relief: Option<String>,
}

impl DmgBridge {
    pub fn from_meta(meta: &EventsMeta) -> Self {
        DmgBridge {
            part_role: meta.parts.iter().map(|p| (p.id.clone(), p.role.clone())).collect(),
            part_on: meta.parts.iter().map(|p| (p.id.clone(), p.part_on.clone())).collect(),
            nb: meta.cores_nb.clone(),
            tank_hold: meta.parts.iter().map(|p| (p.id.clone(), p.tank_hold)).collect(),
            primary_relief: meta.primary_relief.clone(),
        }
    }
    pub fn ctx(&self) -> DmgCtx<'_> {
        DmgCtx {
            part_role: &self.part_role,
            part_on: &self.part_on,
            nb: &self.nb,
            tank_hold: &self.tank_hold,
            primary_relief: self.primary_relief.clone(),
        }
    }
    pub fn state_of(&self, st: &EventsState) -> DmgState {
        let mut cores = HashMap::new();
        for (id, v) in &st.vessels {
            cores.insert(
                id.clone(),
                DmgCore {
                    breach: v.breach,
                    trip: if v.trip.is_empty() { None } else { Some(v.trip.clone()) },
                    fatigue: v.fatigue,
                    rod_jam: v.rod_jam,
                    rod_dem: v.rod_dem,
                    tilt_dem: v.tilt_dem,
                    rod_z_dem: v.rod_z_dem.clone(),
                    rod_pos: v.rod_pos,
                    tilt: v.tilt,
                    rod_z: v.rod_z.clone(),
                },
            );
        }
        DmgState {
            load: st.load,
            load_dem: st.load_dem,
            bkp_lost: st.bkp_lost,
            sgtr: st.sgtr,
            cores,
            relief_open: st.relief_open.clone(),
            relief_stuck: st.relief_stuck.clone(),
            relief_auto: st.relief_auto.clone(),
        }
    }
    pub fn write_back(&self, st: &mut EventsState, ds: &DmgState) {
        st.load = ds.load;
        st.load_dem = ds.load_dem;
        st.bkp_lost = ds.bkp_lost;
        st.sgtr = ds.sgtr;
        st.relief_open = ds.relief_open.clone();
        st.relief_stuck = ds.relief_stuck.clone();
        st.relief_auto = ds.relief_auto.clone();
        for (id, cs) in &ds.cores {
            if let Some(v) = st.vessels.get_mut(id) {
                v.breach = cs.breach;
                v.trip = cs.trip.clone().unwrap_or_default();
                v.fatigue = cs.fatigue;
                v.rod_jam = cs.rod_jam;
                v.rod_dem = cs.rod_dem;
                v.tilt_dem = cs.tilt_dem;
                v.rod_z_dem = cs.rod_z_dem.clone();
            }
        }
    }
    pub fn hit(&self, st: &mut EventsState, id: &str) {
        let ctx = self.ctx();
        let mut ds = self.state_of(st);
        dmg_hit(id, &ctx, &mut ds);
        self.write_back(st, &ds);
    }
    pub fn fix(&self, st: &mut EventsState, id: &str) {
        let ctx = self.ctx();
        let mut ds = self.state_of(st);
        dmg_fix(id, &ctx, &mut ds);
        self.write_back(st, &ds);
    }
}

fn min_pburst(meta: &EventsMeta) -> f64 {
    let mut m = PIPE_PBURST;
    for p in &meta.parts {
        if p.pburst == 0.0 {
            continue;
        }
        if p.role == "bkp" && !(meta.bkp > 0.0) {
            continue;
        }
        if p.pburst < m {
            m = p.pburst;
        }
    }
    m
}

/// `blastStep`: H2-bang latch + blast vs crush judgment over parts and cells.
pub fn blast_step(meta: &EventsMeta, st: &mut EventsState, ev: &mut Vec<LogEv>, dt: f64, bridge: &DmgBridge) {
    if !st.burn_blast && st.room_pmax >= min_pburst(meta) {
        st.burn_blast = true;
        ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_BLAST_LATCH });
    }
    let gauge = room_p_static(meta, &st.room_p);
    let mut seen: HashSet<String> = HashSet::new();
    for p in &meta.parts {
        if p.pburst == 0.0 || !fitted(meta, p) {
            continue;
        }
        seen.insert(p.id.clone());
        if st.dmg_parts.iter().any(|x| x == &p.id) {
            st.room_crush.insert(p.id.clone(), 0.0);
            continue;
        }
        let pk = room_p_at(&st.room_p, meta.gw, meta.gh, p.x, p.y, p.w, p.h, None);
        let bang = if js_truthy(st.room_burn_on) || js_truthy(st.room_fire_on) || js_truthy(st.room_bang) {
            room_p_at(&st.room_p, meta.gw, meta.gh, p.x, p.y, p.w, p.h, Some(&gauge))
        } else {
            0.0
        };
        let blast = bang >= p.pburst;
        let clim = p.pburst * ROOM_CRUSH_K;
        if blast {
            st.room_crush.insert(p.id.clone(), 0.0);
        } else if !hurt_step(&mut st.room_crush, &p.id, (pk - clim) / (clim * ROOM_CRUSH_SPAN), ROOM_CRUSH_TAU, dt) {
            continue;
        }
        st.dmg_parts.push(p.id.clone());
        st.dmg_why.insert(p.id.clone(), if blast { "BLAST" } else { "CRUSHED" }.to_string());
        bridge.hit(st, &p.id);
        if blast {
            st.burn_ids.push(p.name.clone());
        }
        ev.push(LogEv {
            sev: SEV_ALARM,
            code: if blast { crate::tick::EV_BLAST_DMG } else { crate::tick::EV_CRUSH_DMG },
        });
    }
    for q in &meta.hazards {
        if q.lim != 0.0 {
            continue;
        }
        seen.insert(q.id.clone());
        if st.dmg_parts.iter().any(|x| x == &q.id) {
            st.room_crush.insert(q.id.clone(), 0.0);
            continue;
        }
        let ci = (q.y as usize) * meta.gw + q.x as usize;
        let pk = st.room_p.get(ci).copied().unwrap_or(0.0);
        let bang = if js_truthy(st.room_burn_on) || js_truthy(st.room_fire_on) || js_truthy(st.room_bang) {
            pk - gauge.get(ci).copied().unwrap_or(0.0)
        } else {
            0.0
        };
        let blast = bang >= PIPE_PBURST;
        let clim = PIPE_PBURST * ROOM_CRUSH_K;
        if blast {
            st.room_crush.insert(q.id.clone(), 0.0);
        } else if !hurt_step(&mut st.room_crush, &q.id, (pk - clim) / (clim * ROOM_CRUSH_SPAN), ROOM_CRUSH_TAU, dt) {
            continue;
        }
        st.dmg_parts.push(q.id.clone());
        st.dmg_why.insert(q.id.clone(), if blast { "BLAST" } else { "CRUSHED" }.to_string());
        bridge.hit(st, &q.id);
        if blast {
            st.burn_ids.push(q.what.clone());
        }
        ev.push(LogEv {
            sev: SEV_ALARM,
            code: if blast { crate::tick::EV_BLAST_DMG } else { crate::tick::EV_CRUSH_DMG },
        });
    }
    st.room_crush.retain(|id, _| seen.contains(id));
    st.room_bang = 0.0;
}

/// `overpressureStep`: circuit pressure vs shell design (never piezometric).
pub fn overpressure_step(
    meta: &EventsMeta,
    st: &mut EventsState,
    ev: &mut Vec<LogEv>,
    bridge: &DmgBridge,
    cond_p: f64,
) {
    for p in &meta.parts {
        if p.pdes == 0.0 || !fitted(meta, p) || st.dmg_parts.iter().any(|x| x == &p.id) {
            continue;
        }
        let mut pk = 0.0;
        let mut seen = false;
        for n in p.face_nodes.iter().flatten() {
            if !meta.node_names.contains(n) {
                continue;
            }
            seen = true;
            let v = if meta.incore_names.contains(n) { st.p } else { cond_p };
            if v > pk {
                pk = v;
            }
        }
        // NOTE: st.cond_p is carried on state (dumped input per sample).
        if !seen || pk < p.pdes {
            continue;
        }
        st.dmg_parts.push(p.id.clone());
        st.dmg_why.insert(p.id.clone(), "OVERPRESSURE".to_string());
        bridge.hit(st, &p.id);
        ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_SHELL_FAIL });
    }
}

/// `burnFireStep`: close the deflagration/fire latches when flames are out.
pub fn burn_fire_step(st: &mut EventsState, ev: &mut Vec<LogEv>) {
    if !js_truthy(st.room_burn_on) && st.burn_kg > 0.0 {
        if st.burn_kg > H2_BURN_EV {
            ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_DEFLAGRATION });
        }
        st.burn_kg = 0.0;
        st.burn_p = 0.0;
        st.burn_blast = false;
        st.burn_ids.clear();
    }
    if !js_truthy(st.room_fire_on) && st.fire_kg > 0.0 {
        if st.fire_kg > FIRE_EV_KG {
            ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_NAFIRE });
        }
        st.fire_kg = 0.0;
        st.fire_p = 0.0;
        st.fire_q = 0.0;
    }
}

/// `cookStep`: ramp heat kill on parts (skin) and pipe/port cells (air).
pub fn cook_step(meta: &EventsMeta, st: &mut EventsState, ev: &mut Vec<LogEv>, dt: f64, bridge: &DmgBridge, part_skin: &[f64]) {
    // the live set only serves the sweep at the end, which has nothing to sweep while no cell is hot
    let track = !st.room_hurt.is_empty();
    let mut seen: HashSet<String> = HashSet::new();
    for (k, p) in meta.parts.iter().enumerate() {
        if p.tsurv == 0.0 || !fitted(meta, p) {
            continue;
        }
        seen.insert(p.id.clone());
        if st.dmg_parts.iter().any(|x| x == &p.id) {
            st.room_hurt.insert(p.id.clone(), 0.0);
            continue;
        }
        let skin = part_skin.get(k).copied().unwrap_or(T_HULL);
        if !hurt_step(&mut st.room_hurt, &p.id, (skin - p.tsurv) / ROOM_DMG_SPAN, ROOM_DMG_TAU, dt) {
            continue;
        }
        st.dmg_parts.push(p.id.clone());
        st.dmg_why.insert(p.id.clone(), "COOKED".to_string());
        bridge.hit(st, &p.id);
        ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_HEAT_DMG });
    }
    for q in &meta.hazards {
        if track {
            seen.insert(q.id.clone());
        }
        if st.dmg_parts.iter().any(|x| x == &q.id) {
            st.room_hurt.insert(q.id.clone(), 0.0);
            continue;
        }
        let ci = (q.y as usize) * meta.gw + q.x as usize;
        let air = st.room_t.get(ci).copied().unwrap_or(T_HULL);
        let lim = if q.lim != 0.0 { q.lim } else { PIPE_TSURV };
        if !hurt_step(&mut st.room_hurt, &q.id, (air - lim) / ROOM_DMG_SPAN, ROOM_DMG_TAU, dt) {
            continue;
        }
        st.dmg_parts.push(q.id.clone());
        st.dmg_why.insert(q.id.clone(), "COOKED".to_string());
        bridge.hit(st, &q.id);
        ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_HEAT_DMG });
    }
    if track {
        st.room_hurt.retain(|id, _| seen.contains(id));
    }
}
/// `repairStep`: dose-gated fix via the same DMGFX row that hit.
pub fn repair_step(st: &mut EventsState, ev: &mut Vec<LogEv>, dt: f64, bridge: &DmgBridge) {
    if !st.repair_present {
        return;
    }
    st.repair_t += dt * rad_work_k(st.rep_rate);
    st.dose = js_min(100.0, st.dose + st.rep_rate * RAD_DOSE_K * dt);
    if st.dose >= 100.0 && !st.party_spent {
        st.party_spent = true;
        st.repair_present = false;
        ev.push(LogEv { sev: SEV_ALARM, code: crate::tick::EV_REPAIR_OUT });
    } else if st.repair_t >= st.repair_need {
        let k = st.repair_id.clone();
        st.dmg_parts.retain(|q| q != &k);
        st.dmg_why.remove(&k);
        bridge.fix(st, &k);
        ev.push(LogEv { sev: SEV_INFO, code: crate::tick::EV_REPAIR_DONE });
    }
}

fn rad_work_k(r: f64) -> f64 {
    1.0 / (1.0 + js_max(0.0, r - RAD_SLOW) / RAD_SLOW)
}

fn flow_v(run_pos: &HashMap<String, usize>, runflow: &[f64], key: &str) -> f64 {
    match run_pos.get(key) {
        Some(i) => runflow.get(*i).copied().unwrap_or(0.0),
        None => 0.0,
    }
}

fn tick_run_ratio(meta: &EventsMeta, runflow: &[f64], key: &str) -> f64 {
    let r = meta.net_ref_by_run.get(key).copied().unwrap_or(0.0).abs();
    if r > 1e-9 {
        flow_v(&meta.run_pos, runflow, key) / r
    } else {
        0.0
    }
}

fn tick_steam_run(meta: &EventsMeta, st: &EventsState, runflow: &[f64], key: &str) -> f64 {
    let Some(book) = meta.steam_book.get(key) else { return 0.0 };
    if !book.ends {
        return 0.0;
    }
    if book.vent {
        let mut q = 0.0;
        for fid in &book.taps {
            q += st.relief_steam.get(fid).copied().unwrap_or(0.0);
        }
        return q * book.dir;
    }
    flow_v(&meta.run_pos, runflow, key)
}

fn steam_scale(meta: &EventsMeta, key: &str, k: &str) -> f64 {
    if k == "exh" {
        return meta.rated_steam;
    }
    let gens = meta.steam_book.get(key).map(|b| b.gens.len()).unwrap_or(0);
    meta.rated_steam * js_max(1.0, gens as f64) / js_max(1.0, meta.sg_ids.len() as f64)
}

/// `flowSpinStep`: renderer phase advance (pixels) + shaft rates.
pub fn flow_spin_step(meta: &EventsMeta, st: &mut EventsState, runflow: &[f64], dt: f64) {
    let sp = 60.0 * DRAW_K * dt;
    let keys: Vec<String> = st.flow_pos.keys().cloned().collect();
    for key in keys {
        let Some(r) = meta.by_key.get(&key) else { continue };
        if !(port_open(&st.port_shut, &r.pa) && port_open(&st.port_shut, &r.pb)) {
            continue;
        }
        if r.k == "steam" || r.k == "exh" {
            let v = sp * 1.4 * tick_steam_run(meta, st, runflow, &key) / js_max(1e-6, steam_scale(meta, &key, &r.k));
            *st.flow_pos.get_mut(&key).unwrap() += v;
            continue;
        }
        let tag = meta.tag_by_key.get(&key).copied().unwrap_or(0);
        if tag != 0 || meta.net_ref_by_run.contains_key(&key) {
            *st.flow_pos.get_mut(&key).unwrap() += sp * tick_run_ratio(meta, runflow, &key) * 1.4;
        }
    }
    let driven = meta.flow_k * st.flow_net;
    st.spin_v = 360.0 * driven;
    st.spin_tv = 360.0 * js_min(st.load, 1.5);
}

fn port_open(port_shut: &HashSet<String>, pid: &str) -> bool {
    !port_shut.contains(pid)
}

/// `ledgerKg`: unbooked nodes + non-hosted tanks + sump (dumped value).
/// Single running total in JS order: mBy terms, then tanks, then sump.
pub fn ledger_kg(meta: &EventsMeta, st: &EventsState, sump_kg: f64) -> f64 {
    let mut m = 0.0;
    for (i, b) in meta.booked.iter().enumerate() {
        if *b != 0 {
            continue;
        }
        if st.mby_has.get(i).copied().unwrap_or(0) != 0 {
            m += st.mby_v.get(i).copied().unwrap_or(0.0);
        }
    }
    for id in &meta.tank_ids {
        if let Some(t) = meta.tanks.get(id) {
            // JS: !inf && !hold && !!cell && !in_field (a HOSTED tank holds
            // nothing of its own; field tanks keep their own book).
            if t.inf || t.hold || !t.cell || t.in_field {
                continue;
            }
            let lvl = st.tank.get(id).copied().unwrap_or(t.level);
            m += lvl / 100.0 * t.kg;
        }
    }
    m += sump_kg;
    m
}

/// `ledgerStep`: mass-balance residual + rate-limited warn.
pub fn ledger_step(meta: &EventsMeta, st: &mut EventsState, warns: &mut u32, dt: f64, ledg_m0: f64, ledg_o0: f64, sump_kg: f64) {
    let res = (ledg_m0 - ledger_kg(meta, st, sump_kg)) - (ledger_out_ordered(&st.mass_out_order, &st.mass_out) - ledg_o0);
    st.mass_res = res;
    if res.abs() > LEDGER_EPS * js_max(ledg_m0, 1.0) {
        let was = st.mass_warn;
        let t = st.tick;
        let fresh = !js_truthy(was) || res * was < 0.0 || res.abs() > 10.0 * was.abs() || res.abs() < 0.1 * was.abs();
        if fresh || (t - st.mass_warn_t) as f64 >= LEDGER_QUIET / dt {
            st.mass_warn = res;
            st.mass_warn_t = t;
            *warns += 1;
        }
    }
}

/// Radiation source term (radSrc) off live state.
#[derive(Clone, Default)]
struct RadSrc {
    core: HashMap<String, f64>,
    tank: HashMap<String, f64>,
    sg: f64,
    air: f64,
    pipe: f64,
}

fn rad_src(meta: &EventsMeta, st: &EventsState, cont_rel: &HashMap<String, f64>) -> RadSrc {
    let mut core = HashMap::new();
    for id in &meta.core_ids {
        let Some(c) = st.vessels.get(id) else { continue };
        let w = (c.n * PROMPT_F + c.decay) * if c.breach { RAD_BREACH } else { 1.0 }
            + RAD_DMG * c.dmg * cont_rel.get(id).copied().unwrap_or(1.0)
            + if !meta.catcher { RAD_MELT * c.melt_frac } else { 0.0 };
        core.insert(id.clone(), w);
    }
    let mut tank = HashMap::new();
    for (id, lvl) in &st.tank {
        let act = meta.tanks.get(id).map(|t| t.act).unwrap_or(meta.tank_water_act);
        tank.insert(id.clone(), RAD_TANK * lvl * act);
    }
    RadSrc {
        core,
        tank,
        sg: if st.sgtr { RAD_SGTR } else { 0.0 },
        air: RAD_AIR * st.release,
        pipe: if meta.fuel_in_coolant { RAD_PIPE_V * st.n } else { 0.0 },
    }
}

const RAD_PIPE_V: f64 = 0.01;

/// `radSolve`: accumulate kernels (exact order: air, cores, sg, tanks, pipe).
fn rad_solve(meta: &EventsMeta, q: &RadSrc, n: usize) -> Vec<f64> {
    let mut f = vec![q.air; n];
    for (id, k) in &meta.kern_core {
        let w = q.core.get(id).copied().unwrap_or(0.0);
        if w == 0.0 || w.is_nan() {
            continue;
        }
        for i in 0..n {
            f[i] += w * k.get(i).copied().unwrap_or(0.0);
        }
    }
    if q.sg != 0.0 && !q.sg.is_nan() {
        for k in &meta.kern_sg {
            for i in 0..n {
                f[i] += q.sg * k.get(i).copied().unwrap_or(0.0);
            }
        }
    }
    for (id, k) in &meta.kern_tank {
        let w = q.tank.get(id).copied().unwrap_or(0.0);
        if w == 0.0 || w.is_nan() {
            continue;
        }
        for i in 0..n {
            f[i] += w * k.get(i).copied().unwrap_or(0.0);
        }
    }
    if q.pipe != 0.0 && !q.pipe.is_nan() {
        if let Some(kp) = meta.kern_pipe.as_ref() {
            for i in 0..n {
                f[i] += q.pipe * kp.get(i).copied().unwrap_or(0.0);
            }
        }
    }
    f
}

/// `radAt`: worst cell over a rect, clamped.
fn rad_at(f: &[f64], gw: usize, gh: usize, rect: Option<[i32; 4]>) -> f64 {
    let Some(p) = rect else { return RAD_FLOOR };
    let mut v = 0.0;
    for x in p[0]..p[0] + p[2] {
        for y in p[1]..p[1] + p[3] {
            if x < 0 || y < 0 || x >= gw as i32 || y >= gh as i32 {
                continue;
            }
            let q = f[(y as usize) * gw + x as usize];
            if q > v {
                v = q;
            }
        }
    }
    clamp(v, RAD_FLOOR, RAD_CEIL)
}

/// `radParty` core: min over free-approach cells, clamped.
fn rad_party_min(f: &[f64], cells: &[usize]) -> f64 {
    if cells.is_empty() {
        return RAD_CEIL;
    }
    let mut v = 1e9;
    for c in cells {
        let q = f.get(*c).copied().unwrap_or(0.0);
        if q < v {
            v = q;
        }
    }
    clamp(v, RAD_FLOOR, RAD_CEIL)
}

/// `radDoseStep`: fresh field solve → crew dose + party rate.
pub fn rad_dose_step(meta: &EventsMeta, st: &mut EventsState, dt: f64, cont_rel: &HashMap<String, f64>, party_cells: &[usize]) {
    let n = meta.gw * meta.gh;
    let f = rad_solve(meta, &rad_src(meta, st, cont_rel), n);
    st.dose_rate = rad_at(&f, meta.gw, meta.gh, meta.crew_rect);
    st.crew_dose = js_min(100.0, st.crew_dose + st.dose_rate * RAD_CREW_K * dt);
    st.rep_rate = if st.repair_present {
        rad_party_min(&f, party_cells)
    } else {
        0.0
    };
}

/// Replay driver: radDose (independent inputs) then the stepMarch tail in
/// order — blast, overpressure, burnFire, cook, evLatch, repair, flowSpin,
/// ledger. Single tick from the dumped pre-state; no tick increment in scope.
pub struct EventsReplay {    pub events: Vec<LogEv>,
    pub warns: u32,
    pub cg_it: u32,
    pub liq_it: u32,
}

pub fn events_replay(meta: &EventsMeta, st: &mut EventsState, inp: &EventsIn) -> EventsReplay {
    let mut ev = vec![];
    let mut warns = 0u32;
    let bridge = DmgBridge::from_meta(meta);
    let dt = inp.dt;
    rad_dose_step(meta, st, dt, &inp.cont_rel, &inp.party_cells);
    blast_step(meta, st, &mut ev, dt, &bridge);
    overpressure_step(meta, st, &mut ev, &bridge, inp.cond_p);
    burn_fire_step(st, &mut ev);
    cook_step(meta, st, &mut ev, dt, &bridge, &inp.part_skin);
    ev_latch_step(meta, st, &mut ev, inp);
    repair_step(st, &mut ev, dt, &bridge);
    flow_spin_step(meta, st, &inp.runflow, dt);
    ledger_step(meta, st, &mut warns, dt, inp.ledg_m0, inp.ledg_o0, inp.sump_kg);
    // JS LOG caps at LOG_MAX=240 (log.js) with shift-on-overflow; the gate
    // slices per sample right after its fns, so only the last (240-log0)
    // of this sample's events survive. Mirror exactly.
    let keep = 240usize.saturating_sub((inp.log0 as usize).min(240));
    if ev.len() > keep {
        let drop = ev.len() - keep;
        ev.drain(..drop);
    }
    EventsReplay { events: ev, warns, cg_it: 0, liq_it: 0 }
}

/// `flowMean` over primary pumps (flowDemPri shape).
fn flow_mean(pump_ids: &[String], primary: &HashSet<String>, map: &HashMap<String, f64>) -> f64 {
    let mut t = 0.0;
    let mut n = 0u32;
    for id in pump_ids {
        if !primary.contains(id) {
            continue;
        }
        t += map.get(id).copied().unwrap_or(1.0);
        n += 1;
    }
    if n == 0 {
        return 1.0;
    }
    t / n as f64
}

fn relief_any_open(meta: &EventsMeta, st: &EventsState) -> bool {
    for id in &meta.relief_fit_ids {
        if st.relief_open.get(id).copied().unwrap_or(false)
            && !st.relief_blocked.get(id).copied().unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn relief_any_stuck(meta: &EventsMeta, st: &EventsState) -> bool {
    for id in &meta.relief_fit_ids {
        if st.relief_open.get(id).copied().unwrap_or(false)
            && st.relief_auto.get(id).copied().unwrap_or(false)
            && st.relief_stuck.get(id).copied().unwrap_or(false)
            && !st.relief_blocked.get(id).copied().unwrap_or(false)
        {
            return true;
        }
    }
    false
}

/// `tProg` on resolved (tref, steam): turbine programme temperature.
/// NOTE: ANN calls tProg(s) with cs undefined, so the load term is ALWAYS
/// the raw s.load (unitFrac applies only when cs is passed, never here).
fn tprog(tref: f64, steam: f64, scrammed: bool, runback: bool, load: f64) -> f64 {
    if scrammed && runback {
        tref - TPROG_SPAN
    } else if steam != 0.0 {
        tref
    } else {
        tref - TPROG_SPAN + TPROG_SPAN * load
    }
}

/// Per-vessel view for core/rods ANN rows (coreSeen, predicate-read fields).
pub struct CoreView {
    pub n: f64,
    pub dnbr: f64,
    pub dmg: f64,
    pub parts_xe: f64,
    pub scrammed: bool,
    pub rho: f64,
    pub vf: f64,
    pub breach: bool,
    pub melt: bool,
    pub q_ox: f64,
    pub melt_frac: f64,
    pub rod_jam: bool,
    pub rod_band: bool,
    pub p: f64,
    pub tavg: f64,
    pub lvl: f64,
    pub sc: f64,
    pub tref: f64,
    pub steam: f64,
}

fn core_view(meta: &EventsMeta, st: &EventsState, loopp: &HashMap<String, f64>, id: &str) -> Option<CoreView> {
    let cs = st.vessels.get(id)?;
    let k_present = meta.cores_rated.contains_key(id);
    let ci = meta.core_ci.get(id).copied();
    let key = ci.and_then(|c| meta.circ_key.get(&c).cloned());
    let p = if k_present {
        loopp.get(id).copied().unwrap_or(st.p)
    } else {
        st.p
    };
    // TavgOf(s, ci): TavgBy[key] ?? (ci==coreCirc ? s.tavg) ?? sat Tref.
    let tavg = if k_present {
        match key.as_deref() {
            Some(k) => match st.tavg_by.get(k) {
                Some(v) => *v,
                None => {
                    if ci == Some(meta.core_circ) {
                        st.tavg
                    } else {
                        meta.circ_tref.get(&ci.unwrap_or(-999)).copied().unwrap_or(meta.tref)
                    }
                }
            },
            None => meta.tref,
        }
    } else {
        st.tavg
    };
    let lvl = if k_present {
        match meta.core_hold.get(id) {
            Some(h) if !h.is_empty() => match st.lvl_by.get(h) {
                Some(v) => *v,
                None => st.lvl,
            },
            _ => st.lvl,
        }
    } else {
        st.lvl
    };
    let sc = if k_present {
        match key.as_deref() {
            Some(k) => st.sc_by.get(k).copied().unwrap_or(st.sc),
            None => st.sc,
        }
    } else {
        st.sc
    };
    Some(CoreView {
        n: cs.n,
        dnbr: cs.dnbr,
        dmg: cs.dmg,
        parts_xe: cs.parts_xe,
        scrammed: cs.scrammed,
        rho: cs.rho,
        vf: cs.vf,
        breach: cs.breach,
        melt: cs.melt,
        q_ox: cs.q_ox,
        melt_frac: cs.melt_frac,
        rod_jam: cs.rod_jam,
        rod_band: cs.rod_band,
        p,
        tavg,
        lvl,
        sc,
        tref: meta.cores_tref.get(id).copied().unwrap_or(meta.tref),
        steam: meta.cores_steam.get(id).copied().unwrap_or(meta.steam_flag),
    })
}

/// `evLatchStep`: 30 latches (exact else-branches) + annStep every 5th tick.
#[allow(clippy::too_many_arguments)]
pub fn ev_latch_step(
    meta: &EventsMeta,
    st: &mut EventsState,
    ev: &mut Vec<LogEv>,
    inp: &EventsIn,
) {
    core_agg(meta, st);
    macro_rules! latch {
        ($key:expr, $code:expr, $sev:expr, $cond:expr) => {
            if $cond {
                if !st.ev.get($key).copied().unwrap_or(false) {
                    st.ev.insert($key.to_string(), true);
                    ev.push(LogEv { sev: $sev, code: $code });
                }
            } else {
                st.ev.insert($key.to_string(), false);
            }
        };
    }
    macro_rules! sticky {
        ($key:expr, $code:expr, $sev:expr, $cond:expr) => {
            if $cond && !st.ev.get($key).copied().unwrap_or(false) {
                st.ev.insert($key.to_string(), true);
                ev.push(LogEv { sev: $sev, code: $code });
            }
        };
    }
    latch!("hipow", EV_HIPOW, SEV_WARN, st.n > 1.10);
    latch!("dnbr13", EV_DNBR13, SEV_WARN, st.dnbr < 1.30);
    latch!("dnbr10", EV_DNBR10, SEV_ALARM, st.dnbr < 1.00);
    latch!("scram", EV_SCRAM, SEV_ALARM, st.scrammed);
    latch!("recrit", EV_RECRIT, SEV_ALARM, st.scrammed && st.rod_pos > 0.98 && st.rho > -200.0);
    latch!("cav", EV_CAV, SEV_WARN, st.cav > 0.15);
    latch!("dry", EV_DRY, SEV_ALARM, !inp.dry_ids.is_empty());
    latch!(
        "flowfloor",
        EV_FLOWFLOOR,
        SEV_WARN,
        flow_mean(&meta.pump_ids, &meta.primary_pumps, &st.flow_demby) < meta.flow_min
    );
    latch!("hip", EV_HIP, SEV_WARN, st.p > meta.p0 * 1.05);
    latch!("porv", EV_PORV, SEV_WARN, relief_any_open(meta, st));
    latch!("stuck", EV_STUCK, SEV_ALARM, relief_any_stuck(meta, st));
    latch!("void", EV_VOID, SEV_ALARM, st.vf > 0.15);
    latch!("hirad", EV_HIRAD, SEV_WARN, st.dose_rate > RAD_HI);
    latch!("hiroom", EV_HIROOM, SEV_ALARM, !room_over_ids(meta, &inp.part_skin).is_empty());
    latch!("h2room", EV_H2ROOM, SEV_ALARM, room_h2_peak(&st.room_h2, &st.room_m, &st.room_vap) >= H2_LFL);
    latch!("pit", EV_PIT, SEV_INFO, -st.parts_xe > 3200.0);
    latch!("jam", EV_JAM, SEV_ALARM, st.rod_jam);
    latch!("byp_rps", EV_BYP_RPS, SEV_WARN, inp.rps_state == "BYPASSED");
    latch!(
        "byp_runback",
        EV_BYP_RUNBACK,
        SEV_WARN,
        inp.sink_runback && !inp.runback_live
    );
    sticky!("norps", EV_NORPS, SEV_WARN, inp.rps_state == "NOT FITTED");
    latch!("inj", EV_INJ, SEV_INFO, !inp.inj_ids.is_empty());
    sticky!("d1", EV_D1, SEV_ALARM, st.dmg > 1.0);
    sticky!("d25", EV_D25, SEV_ALARM, st.dmg > 25.0);
    sticky!("crew50", EV_CREW50, SEV_ALARM, st.crew_dose > 50.0);
    sticky!("fat50", EV_FAT50, SEV_WARN, st.fatigue > 50.0);
    sticky!("brk", EV_BRK, SEV_ALARM, st.breach);
    sticky!("ox", EV_OX, SEV_ALARM, st.q_ox > st.n * PROMPT_F);
    sticky!("h2", EV_H2, SEV_ALARM, st.h2 > H2_EV);
    sticky!("melt", EV_MELT, SEV_ALARM, st.melt);
    if st.tick % ANN_TICKS == 0 {
        ann_step(meta, st, inp);
    }
}

/// One ANN row: label, severity, host kind (core/rods/plain), predicate id.
struct AnnRow {
    label: &'static str,
    sev: u8,
    kind: u8, // 0 plain (raw s), 1 core/rod (per-vessel view)
    pred: u8,
}

const ANN: &[AnnRow] = &[
    AnnRow { label: "HI FLUX", sev: SEV_ALARM, kind: 1, pred: 0 },
    AnnRow { label: "LO DNBR", sev: SEV_ALARM, kind: 1, pred: 1 },
    AnnRow { label: "FUEL DMG", sev: SEV_ALARM, kind: 1, pred: 2 },
    AnnRow { label: "LO PRESS", sev: SEV_WARN, kind: 0, pred: 3 },
    AnnRow { label: "HI PZR LVL", sev: SEV_WARN, kind: 0, pred: 4 },
    AnnRow { label: "LO SUBCOOL", sev: SEV_ALARM, kind: 0, pred: 5 },
    AnnRow { label: "TAVG DEV", sev: SEV_WARN, kind: 1, pred: 6 },
    AnnRow { label: "XENON PIT", sev: SEV_INFO, kind: 1, pred: 7 },
    AnnRow { label: "RECRITICAL", sev: SEV_ALARM, kind: 1, pred: 8 },
    AnnRow { label: "ROD JAM", sev: SEV_WARN, kind: 1, pred: 9 },
    AnnRow { label: "PORV OPEN", sev: SEV_ALARM, kind: 0, pred: 10 },
    AnnRow { label: "CORE VOID", sev: SEV_ALARM, kind: 1, pred: 11 },
    AnnRow { label: "RX TRIP", sev: SEV_ALARM, kind: 1, pred: 12 },
    AnnRow { label: "HI PRESS", sev: SEV_ALARM, kind: 0, pred: 13 },
    AnnRow { label: "CAVITATION", sev: SEV_WARN, kind: 0, pred: 14 },
    AnnRow { label: "LO FLOW", sev: SEV_WARN, kind: 0, pred: 15 },
    AnnRow { label: "NO RPS", sev: SEV_WARN, kind: 0, pred: 16 },
    AnnRow { label: "RX BREACH", sev: SEV_ALARM, kind: 1, pred: 17 },
    AnnRow { label: "BLACKOUT", sev: SEV_WARN, kind: 0, pred: 18 },
    AnnRow { label: "CORE MELT", sev: SEV_ALARM, kind: 1, pred: 19 },
    AnnRow { label: "SG HI PRES", sev: SEV_ALARM, kind: 0, pred: 20 },
    AnnRow { label: "SG BURST", sev: SEV_ALARM, kind: 0, pred: 21 },
    AnnRow { label: "LO SG LVL", sev: SEV_WARN, kind: 0, pred: 22 },
    AnnRow { label: "SG DRY", sev: SEV_ALARM, kind: 0, pred: 23 },
    AnnRow { label: "HOTWELL HI", sev: SEV_ALARM, kind: 0, pred: 24 },
    AnnRow { label: "TURB TRIP", sev: SEV_ALARM, kind: 0, pred: 25 },
    AnnRow { label: "NO VACUUM", sev: SEV_ALARM, kind: 0, pred: 26 },
    AnnRow { label: "ROD LIMIT", sev: SEV_WARN, kind: 1, pred: 27 },
    AnnRow { label: "NEAR TRIP", sev: SEV_WARN, kind: 1, pred: 28 },
    AnnRow { label: "AREA RAD", sev: SEV_WARN, kind: 0, pred: 29 },
    AnnRow { label: "CLAD OXID", sev: SEV_ALARM, kind: 1, pred: 30 },
    AnnRow { label: "FUEL MELT", sev: SEV_ALARM, kind: 1, pred: 31 },
    AnnRow { label: "HI ROOM T", sev: SEV_ALARM, kind: 0, pred: 32 },
    AnnRow { label: "H2 FIRE", sev: SEV_ALARM, kind: 0, pred: 33 },
    AnnRow { label: "H2 LFL", sev: SEV_ALARM, kind: 0, pred: 34 },
    AnnRow { label: "NO SINK", sev: SEV_ALARM, kind: 0, pred: 35 },
    AnnRow { label: "PANEL HI T", sev: SEV_WARN, kind: 0, pred: 36 },
    AnnRow { label: "NA FIRE", sev: SEV_ALARM, kind: 0, pred: 37 },
    AnnRow { label: "RPS OFF", sev: SEV_WARN, kind: 0, pred: 38 },
    AnnRow { label: "NO RUNBACK", sev: SEV_WARN, kind: 0, pred: 39 },
];

/// Plain (raw-state) ANN predicates by pred id.
fn ann_plain(meta: &EventsMeta, st: &EventsState, inp: &EventsIn, pred: u8) -> bool {
    match pred {
        3 => st.p < meta.p0 * 0.935,
        4 => st.lvl > 78.0,
        5 => st.sc < 8.0,
        10 => relief_any_open(meta, st),
        13 => st.p > meta.p0 * 1.05,
        14 => st.cav > 0.15,
        15 => st.flow_net < meta.flow_min,
        16 => inp.rps_state == "NOT FITTED",
        18 => st.blackout,
        20 => meta.sg_ids.iter().any(|id| inp.sec_p.get(id).copied().unwrap_or(f64::NAN) > meta.sg_lift),
        21 => meta.sg_ids.iter().any(|id| st.sg_burst.get(id).copied().unwrap_or(false)),
        22 => meta.boiler_ids.iter().any(|id| inp.boiler_lvl.get(id).copied().unwrap_or(f64::INFINITY) < SG_LOW),
        23 => meta.boiler_ids.iter().any(|id| inp.boiler_lvl.get(id).copied().unwrap_or(f64::INFINITY) < SG_DRY_LO),
        24 => inp.cond_frac < 1.0,
        25 => st.turb_trip,
        26 => st.cond_lost,
        29 => st.dose_rate > RAD_HI,
        32 => !room_over_ids(meta, &inp.part_skin).is_empty(),
        33 => st.room_burn_on > 0.0,
        34 => room_h2_peak(&st.room_h2, &st.room_m, &st.room_vap) >= H2_LFL,
        35 => !meta.rad_ids.iter().any(|id| {
            meta.rad_live.get(id).copied().unwrap_or(false) && !st.dmg_parts.iter().any(|x| x == id)
        }),
        36 => inp.panel_hit > meta.panel_thresh,
        37 => st.room_fire_on > 0.0,
        38 => inp.rps_state == "BYPASSED",
        39 => inp.sink_runback && !inp.runback_live,
        _ => false,
    }
}

/// Core/rod (per-vessel-view) ANN predicates by pred id.
fn ann_view(meta: &EventsMeta, st: &EventsState, inp: &EventsIn, v: &CoreView, pred: u8) -> bool {
    match pred {
        0 => v.n > 1.12,
        1 => v.dnbr < 1.30,
        2 => v.dmg > 0.1,
        6 => {
            if !meta.vessel_flag {
                return false;
            }
            let tp = tprog(v.tref, v.steam, v.scrammed, inp.runback_live, st.load);
            (v.tavg - tp).abs() > 4.0
        }
        7 => -v.parts_xe > 3200.0,
        8 => v.scrammed && v.rho > -200.0,
        9 => v.rod_jam,
        11 => v.vf > 0.15,
        12 => v.scrammed,
        17 => v.breach,
        19 => v.melt,
        27 => v.rod_band,
        28 => inp.trip_near,
        30 => v.q_ox > 0.0 && v.q_ox > v.n * PROMPT_F,
        31 => v.melt_frac > 0.0,
        _ => false,
    }
}

/// `annStep`: evaluate tiles, bump rev on transitions.
pub fn ann_step(meta: &EventsMeta, st: &mut EventsState, inp: &EventsIn) {
    for a in ANN {
        let v = if a.kind == 1 {
            let mut lit = false;
            for id in &meta.core_ids {
                // Missing vessel falls back to the aggregate view, exactly
                // like coreSeen returning raw s.
                let view: CoreView = match core_view(meta, st, &inp.loopp_by_core, id) {
                    Some(v) => v,
                    None => agg_view(meta, st),
                };
                if ann_view(meta, st, inp, &view, a.pred) {
                    lit = true;
                    break;
                }
            }
            lit
        } else {
            ann_plain(meta, st, inp, a.pred)
        };
        let cur = st.ann_on.get(a.label).copied().unwrap_or(0);
        if cur != (v as u8) {
            st.ann_on.insert(a.label.to_string(), v as u8);
            st.ann_rev += 1;
        }
    }
}

/// Aggregate-state fallback for core/rod rows when a vessel is missing
/// (mirrors coreSeen returning raw s).
fn agg_view(meta: &EventsMeta, st: &EventsState) -> CoreView {
    CoreView {
        n: st.n,
        dnbr: st.dnbr,
        dmg: st.dmg,
        parts_xe: st.parts_xe,
        scrammed: st.scrammed,
        rho: st.rho,
        vf: st.vf,
        breach: st.breach,
        melt: st.melt,
        q_ox: st.q_ox,
        melt_frac: st.melt_frac,
        rod_jam: st.rod_jam,
        rod_band: st.rod_band,
        p: st.p,
        tavg: st.tavg,
        lvl: st.lvl,
        sc: st.sc,
        tref: meta.tref,
        steam: meta.steam_flag,
    }
}
