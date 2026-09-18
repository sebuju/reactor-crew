//! Live tick derivation (plan §7): frozen block graph + live readers.
//! Field-by-field verified against gate dumps by live-probe; the WASM
//! `sim_step` drives the same path without any dump.
use crate::ctl;
use crate::sec;
use crate::step::{CtlMeta, SolveFrozen, SolveOut, SolveTail, StepMeta, StepState};
use std::collections::HashMap;

/// Design-time block table, frozen at commission (`FREEZE.build()`).
pub struct FrozenTable {
    pub ids: Vec<String>,
    pub sig: Vec<String>,
    pub arg: Vec<String>,
    pub name: Vec<String>,
    pub seed_out: Vec<f64>,
    pub seed_f: Vec<f64>,
    pub rods_of: HashMap<String, String>,
    pub turb_id: Option<String>,
    pub ctrl_id: Option<String>,
    pub steam_ref: f64,
}

/// Frozen per-run ctl state: structural template + design lookups +
/// plant constants + carried filter/output state that has no StepState
/// home (scram lag timers).
pub struct CtlFrozen {
    pub ids: Vec<String>,
    pub sig: Vec<String>,
    pub arg: Vec<String>,
    pub name: Vec<String>,
    pub rods_of: HashMap<String, String>,
    pub turb_id: Option<String>,
    pub ctrl_id: Option<String>,
    pub steam_ref: f64,
    pub seed_out: Vec<f64>,
    pub seed_f: Vec<f64>,
    pub ar_lo: f64,
    pub ar_hi: f64,
    pub p_load_max: f64,
    pub p_rps_lag: f64,
    pub p_rated: f64,
    pub freg_keys: Vec<String>,
    pub flow_keys: Vec<String>,
    pub valve_keys: Vec<String>,
    pub tank_keys: Vec<String>,
    pub relief_keys: Vec<String>,
    pub core_ids: Vec<String>,
    pub template: ctl::Sample,
    /// Frozen `reliefNodeOf` per fitting (the valve-pressure signal).
    pub fit_node: HashMap<String, String>,
}

/// Carried live-ctl state across ticks (mirrors the engine, not the dump).
pub struct CtlLive {
    pub rps_hot: Vec<f64>,
}

pub fn freeze_ctl(sample: ctl::Sample, t: &FrozenTable, keys: &CtlMeta) -> (CtlFrozen, CtlLive) {
    let n = sample.blocks.len();
    let pick = |v: &[String]| -> Vec<String> {
        if v.len() == n {
            v.to_vec()
        } else {
            vec![String::new(); n]
        }
    };
    let pickf = |v: &[f64]| -> Vec<f64> {
        if v.len() == n {
            v.to_vec()
        } else {
            vec![f64::NAN; n]
        }
    };
    let rps_hot = sample.act.cores.iter().map(|c| c.rps_hot).collect();
    let fr = CtlFrozen {
        ids: pick(&t.ids),
        sig: pick(&t.sig),
        arg: pick(&t.arg),
        name: pick(&t.name),
        rods_of: t.rods_of.clone(),
        turb_id: t.turb_id.clone(),
        ctrl_id: t.ctrl_id.clone(),
        steam_ref: t.steam_ref,
        seed_out: pickf(&t.seed_out),
        seed_f: pickf(&t.seed_f),
        ar_lo: sample.act.ar_lo,
        ar_hi: sample.act.ar_hi,
        p_load_max: sample.act.load_max,
        p_rps_lag: sample.act.rps_lag,
        p_rated: sample.act.p_rated,
        freg_keys: keys.freg_keys.clone(),
        flow_keys: keys.flow_keys.clone(),
        valve_keys: keys.valve_keys.clone(),
        tank_keys: keys.tank_keys.clone(),
        relief_keys: keys.relief_keys.clone(),
        core_ids: keys.core_ids.clone(),
        template: sample.clone(),
        fit_node: HashMap::new(),
    };
    (fr, CtlLive { rps_hot })
}

/// Wrecked-part test (`partWrecked`): membership in the synced damage list.
pub fn part_wrecked(st: &StepState, id: &str) -> bool {
    st.sec.dmg_parts.iter().any(|x| x == id)
}

/// Cabinet computing (`ctlLive`): host placed, whole, and fed.
pub fn ctl_live(meta: &StepMeta, st: &StepState, fr: &CtlFrozen) -> bool {
    let host = match &fr.ctrl_id {
        Some(id) => id,
        None => return false,
    };
    if part_wrecked(st, host) {
        return false;
    }
    if supply_k(meta, st) <= 0.0 {
        return false;
    }
    true
}

/// `supplyK`: 1, backup on blackout, 0 on lost backup.
pub fn supply_k(meta: &StepMeta, st: &StepState) -> f64 {
    if st.sec.u8s.get("blackout").copied().unwrap_or(false) {
        if st.sec.u8s.get("bkpLost").copied().unwrap_or(false) {
            0.0
        } else {
            meta.sec.backup
        }
    } else {
        1.0
    }
}

/// Sink dead test (`blkDead`): the driven part is wrecked.
pub fn sink_dead(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, kind: u8, arg: &str) -> bool {
    let part: Option<&str> = match kind {
        ctl::SINK_ROD_STEP | ctl::SINK_SCRAM | ctl::SINK_NEAR_TRIP => {
            fr.rods_of.get(arg).map(|s| s.as_str())
        }
        ctl::SINK_FREG | ctl::SINK_FLOW_DEM | ctl::SINK_VALVE_DEM | ctl::SINK_TANK_OPEN => {
            Some(arg)
        }
        ctl::SINK_RELIEF => Some(arg),
        ctl::SINK_LOAD_DEM | ctl::SINK_RUNBACK => fr.turb_id.as_deref(),
        _ => None,
    };
    match part {
        Some(p) => part_wrecked(st, p),
        None => false,
    }
}

/// Live position of a sink arg inside a frozen-ordered key list.
pub fn sink_pos(keys: &[String], arg: &str) -> i32 {
    keys.iter().position(|k| k == arg).map(|i| i as i32).unwrap_or(-1)
}

/// Blame walk (`blkBlame`): deepest hot input with a design name.
pub fn blame_walk(out: &[f64], modes: &[u8], inputs: &[Vec<i32>], ids: &[String], names: &[String], drv: usize) -> String {
    let n = out.len();
    let mut seen = vec![false; n];
    let mut stack = vec![drv];
    while let Some(id) = stack.pop() {
        if id >= n || seen[id] {
            continue;
        }
        seen[id] = true;
        if modes[id] == ctl::MODE_SOURCE || modes[id] == ctl::MODE_CONST {
            return String::new();
        }
        let mut hot = false;
        for &src in &inputs[id] {
            if src >= 0 && (src as usize) < n && out[src as usize] > 0.5 {
                stack.push(src as usize);
                hot = true;
            }
        }
        if !hot {
            return names.get(id).cloned().unwrap_or_default();
        }
    }
    String::new()
}

/// `sinkWired` (ctl.js:313): the block driving a sink kind/arg, preferring
/// a switched-on one. `on_only` is the `sinkDriver` arm — an off block is
/// wired but is nobody's driver.
pub fn sink_wired(
    blocks: &[ctl::Block],
    args: &[String],
    kind: u8,
    arg: &str,
    on_only: bool,
) -> Option<usize> {
    let mut off = None;
    for (i, b) in blocks.iter().enumerate() {
        if b.mode != ctl::MODE_SINK || b.sink_kind != kind {
            continue;
        }
        let a = args.get(i).map(|s| s.as_str()).unwrap_or("");
        if !(a.is_empty() || a == arg) {
            continue;
        }
        if b.inputs.first().copied().unwrap_or(-1) < 0 {
            continue;
        }
        if b.on {
            return Some(i);
        }
        if off.is_none() {
            off = Some(i);
        }
    }
    if on_only {
        None
    } else {
        off
    }
}

/// `sinkDriver`: the on-block only.
pub fn sink_driver(blocks: &[ctl::Block], args: &[String], kind: u8, arg: &str) -> Option<usize> {
    sink_wired(blocks, args, kind, arg, true)
}

/// Scram driver (`sinkDriver(s,"scram",arg)`): live on-block wired to it.
pub fn scram_driver(blocks: &[ctl::Block], args: &[String], arg: &str) -> Option<usize> {
    sink_driver(blocks, args, ctl::SINK_SCRAM, arg)
}

/// Runback live (`runbackLive`): cabinet live and a runback driver exists.
pub fn runback_live(meta: &StepMeta, st: &StepState, fr: &CtlFrozen) -> bool {
    if !ctl_live(meta, st, fr) {
        return false;
    }
    sink_driver(&fr.template.blocks, &fr.arg, ctl::SINK_RUNBACK, "").is_some()
}

/// Untripped rating share (`unitFrac`).
pub fn unit_frac(meta: &StepMeta, st: &StepState, p_rated: f64, x: f64) -> f64 {
    let mut live = 0.0;
    for id in &meta.core_ids {
        let scr = st.core.get(id).map(|c| c.scrammed).unwrap_or(false);
        if !scr {
            live += meta.core_k.get(id).map(|k| k.rated).unwrap_or(0.0);
        }
    }
    if live > 0.0 && live != p_rated {
        (x * p_rated / live).min(1.0)
    } else {
        x
    }
}

/// Program temperature (`tProg`) for a raw core state.
pub fn t_prog(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, id: &str) -> f64 {
    let tref = meta.core_k.get(id).map(|k| k.tref).unwrap_or(f64::NAN);
    let steam = meta.events.cores_steam.get(id).copied().unwrap_or(0.0) != 0.0;
    let scrammed = st.core.get(id).map(|c| c.scrammed).unwrap_or(false);
    if scrammed && runback_live(meta, st, fr) {
        return tref - 18.0;
    }
    if steam {
        return tref;
    }
    tref - 18.0 + 18.0 * unit_frac(meta, st, fr.p_rated, st.events.load)
}

/// `TavgOf`: per-circuit average, driver map else plant value.
pub fn tavg_of(meta: &StepMeta, st: &StepState, ci: i32) -> f64 {
    if let Some(k) = meta.sec.circ_key_of.get(ci as usize).and_then(|o| o.clone()) {
        if let Some(v) = st.sec.maps.get("TavgBy").and_then(|m| m.get(&k)) {
            return v;
        }
    }
    if ci == meta.sec.core_circ {
        let t = st.sec.f64s.get("Tavg").copied().unwrap_or(f64::NAN);
        if !t.is_nan() {
            return t;
        }
    }
    meta.sec.tref
}

/// `loopP`: circuit pressure off the solved-field bags.
pub fn loop_p(meta: &StepMeta, st: &StepState, ci: i32) -> f64 {
    if let Some(k) = meta.sec.circ_key_of.get(ci as usize).and_then(|o| o.clone()) {
        if let Some(v) = st.sec.maps.get("PBy").and_then(|m| m.get(&k)) {
            return v;
        }
    }
    if ci == meta.sec.core_circ {
        let p = st.sec.f64s.get("P").copied().unwrap_or(f64::NAN);
        return if p.is_nan() { meta.sec.p0 } else { p };
    }
    if ci >= 0 && meta.sec.core_circs.get(ci as usize).copied().unwrap_or(false) {
        return meta.sec_curves.of(ci).p0;
    }
    meta.sec.pcont
}

/// Core-view circuit index (`K.circ`), -1 for plant views.
pub fn view_ci(meta: &StepMeta, arg: &str) -> i32 {
    if meta.core_k.contains_key(arg) {
        meta.events.core_ci.get(arg).copied().unwrap_or(-1)
    } else {
        -1
    }
}

/// Circuit key string (`circKey`).
pub fn circ_key(meta: &StepMeta, ci: i32) -> Option<String> {
    meta.events.circ_key.get(&ci).cloned()
}

/// Vessel-or-plant float leaf for core-scope signal rows.
pub fn view_f64(meta: &StepMeta, st: &StepState, arg: &str, vessel: impl Fn(&crate::core::CoreState) -> f64, plant: f64) -> f64 {
    if meta.core_k.contains_key(arg) {
        st.core.get(arg).map(|cs| vessel(cs)).unwrap_or(plant)
    } else {
        plant
    }
}

/// Live signal read (`sigRead`) for the frozen source set.
pub fn sig_read(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, i: usize) -> f64 {
    let sig = fr.sig.get(i).map(|s| s.as_str()).unwrap_or("");
    let arg = fr.arg.get(i).map(|s| s.as_str()).unwrap_or("");
    match sig {
        "rpsset" | "rpsnear" | "fitlift" | "fitreseat" | "loopset" => {
            fr.template.blocks.get(i).map(|b| b.src_val).unwrap_or(f64::NAN)
        }
        "sgfed" => or0(st.sec.maps.get("sgFedBy").and_then(|m| m.get(arg))),
        "sgwant" => {
            let steam = or0(st.sec.maps.get("steamBy").and_then(|m| m.get(arg)));
            let lvl = sec_boiler_lvl(meta, &meta.sec_curves, st, arg);
            let rs = if meta.sec.steam_rise > 0.0 { fr.p_rated * 1000.0 / meta.sec.steam_rise } else { 0.0 };
            let nb = meta.sec.boiler_ids.len().max(1) as f64;
            (steam + (50.0 - lvl) / 100.0 * 2.3 * rs / nb).max(0.0)
        }
        "fitp" => sec_relief_p(meta, st, &fr.fit_node, arg),
        "sglo" => {
            let mut m = 100.0;
            for id in &meta.sec.boiler_ids {
                let v = sec_boiler_lvl(meta, &meta.sec_curves, st, id);
                if v < m {
                    m = v;
                }
            }
            m
        }
        _ => sig_read_live(meta, st, fr, sig, arg),
    }
}

/// Live signal read for state-derived rows.
pub fn sig_read_live(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, sig: &str, arg: &str) -> f64 {
    let ev = &st.events;
    match sig {
        "pwr" => view_f64(meta, st, arg, |cs| cs.n * 100.0, ev.n * 100.0),
        "prs" => {
            let ci = view_ci(meta, arg);
            if ci < 0 {
                ev.p
            } else {
                loop_p(meta, st, ci)
            }
        }
        "flow" => view_f64(meta, st, arg, |cs| cs.flow_net * 100.0, ev.flow_net * 100.0),
        "heat" => view_f64(meta, st, arg, |cs| cs.heat, ev.heat),
        "load" => ev.load * 100.0,
        "turbtr" => if ev.turb_trip { 1.0 } else { 0.0 },
        "dnbr" => view_f64(meta, st, arg, |cs| cs.dnbr, ev.dnbr),
        "tf" => view_f64(meta, st, arg, |cs| cs.tf, ev.tf),
        "vd" => view_f64(meta, st, arg, |cs| cs.vf, ev.vf),
        "nfr" => view_f64(meta, st, arg, |cs| cs.n, ev.n),
        "trip" => view_f64(meta, st, arg, |cs| if cs.scrammed { 1.0 } else { 0.0 }, if ev.scrammed { 1.0 } else { 0.0 }),
        "tavg" => {
            let ci = view_ci(meta, arg);
            if ci < 0 {
                return ev.tavg;
            }
            match circ_key(meta, ci).and_then(|k| st.tavg_by.get(&k).copied()) {
                Some(v) => v,
                None => ev.tavg,
            }
        }
        "dtavg" => {
            let ci = view_ci(meta, arg);
            if ci < 0 {
                return st.dtavg;
            }
            match circ_key(meta, ci).and_then(|k| st.dtavg_by.get(&k).copied()) {
                Some(v) => v,
                None => st.dtavg,
            }
        }
        "scc" => {
            let ci = view_ci(meta, arg);
            if ci < 0 {
                return ev.sc;
            }
            match ev.sc_by.get(&ci.to_string()).copied() {
                Some(v) => v,
                None => ev.sc,
            }
        }
        "tprog" => t_prog(meta, st, fr, arg),
        "tfrac" => unit_frac(meta, st, fr.p_rated, live_turb_share(meta, st, fr)),
        "loopp" => loop_p(meta, st, arg.parse().unwrap_or(-1)),
        _ => f64::NAN,
    }
}

/// Post-pass actuator application (`apply_ctl_replay` core): demands,
/// relief cells and vessel fan-out from the pass result into live state.
/// Pure map writes — no tails, shared by replay and engine.
pub fn apply_act(keys: &CtlMeta, st: &mut StepState, act: &ctl::Act) {
    // runback/load/demands (events home + sec copies, both read them)
    st.events.load = act.load;
    st.events.load_dem = act.load_dem;
    st.sec.f64s.insert("load".to_string(), act.load);
    st.sec.f64s.insert("loadDem".to_string(), act.load_dem);
    st.sec.f64s.insert("boronDem".to_string(), act.boron_dem);
    st.sec.u8s.insert("rbHot".to_string(), act.rb_hot);
    // freg/flow/valve/tank demands into sec maps
    for (i, k) in keys.freg_keys.iter().enumerate() {
        if let Some(v) = act.freg.get(i) {
            st.sec.maps.entry("fregDemBy".to_string()).or_insert_with(sec::SMap::default).set(k, *v);
        }
    }
    for (i, k) in keys.flow_keys.iter().enumerate() {
        if let Some(v) = act.flow.get(i) {
            st.sec.maps.entry("flowDemBy".to_string()).or_insert_with(sec::SMap::default).set(k, *v);
        }
    }
    for (i, k) in keys.valve_keys.iter().enumerate() {
        if let Some(v) = act.valve.get(i) {
            st.sec.maps.entry("valveDem".to_string()).or_insert_with(sec::SMap::default).set(k, *v);
        }
    }
    for (i, k) in keys.tank_keys.iter().enumerate() {
        if let Some(v) = act.tank.get(i) {
            st.sec.maps.entry("tankOpen".to_string()).or_insert_with(sec::SMap::default).set(k, if *v { 1.0 } else { 0.0 });
        }
    }
    // relief cells: sec struct + events maps
    for (i, k) in keys.relief_keys.iter().enumerate() {
        if let Some(rc) = act.relief.get(i) {
            if let Some(cell) = st.sec.relief.get_mut(k) {
                cell.open = rc.open;
                cell.auto = rc.auto;
                cell.stuck = rc.stuck;
                cell.arm = rc.arm;
            }
            st.events.relief_open.insert(k.clone(), rc.open);
            st.events.relief_auto.insert(k.clone(), rc.auto);
            st.events.relief_stuck.insert(k.clone(), rc.stuck);
        }
    }
    // per-vessel: CoreState + EvVessel fan-out
    for (i, id) in keys.core_ids.iter().enumerate() {
        if let Some(ca) = act.cores.get(i) {
            if let Some(cs) = st.core.get_mut(id) {
                cs.rod_dem = ca.rod_dem;
                cs.rod_zdem = ca.rod_zdem.clone();
                cs.rod_band = ca.rod_band;
                cs.rod_jam = ca.rod_jam;
                cs.scrammed = ca.scrammed;
            }
            if let Some(ev) = st.events.vessels.get_mut(id) {
                ev.rod_dem = ca.rod_dem;
                ev.rod_z_dem = ca.rod_zdem.clone();
                ev.rod_band = ca.rod_band;
                ev.rod_jam = ca.rod_jam;
                ev.scrammed = ca.scrammed;
                ev.rps_hot = ca.rps_hot;
                ev.rps_near = ca.rps_near;
                ev.trip = ca.trip.clone();
            }
        }
    }
}

/// Pin-hot test (`|Tavg - tProg| > 0.5`) for the actuator snapshot.
pub fn pin_hot(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, id: &str) -> bool {
    let ci = meta.events.core_ci.get(id).copied().unwrap_or(-1);
    (tavg_of(meta, st, ci) - t_prog(meta, st, fr, id)).abs() > 0.5
}

fn sec_pf(meta: &StepMeta, st: &StepState, bag: &str, nid: &str) -> Option<f64> {
    let i = meta.sec.net_index.get(nid)?;
    st.sec.bags.get(bag).and_then(|b| b.get(*i))
}

fn sec_circ_of(meta: &StepMeta, nid: &str) -> i32 {
    meta.sec.net_index.get(nid).and_then(|i| meta.sec.circ_of_node.get(*i)).copied().unwrap_or(-1)
}

/// `netPAt` over live sec bags.
pub fn sec_net_p_at(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, nid: &str) -> f64 {
    if let Some(v) = sec_pf(meta, st, "pBy", nid) {
        return crate::eos::js_max(crate::sec::COND_P0, v);
    }
    let c = curves.set_p(sec_circ_of(meta, nid));
    let p = st.sec.f64s.get("P").copied().unwrap_or(f64::NAN);
    crate::eos::js_max(crate::sec::COND_P0, if c > 0.0 { c } else { p })
}

/// `netHAt` over live sec bags.
pub fn sec_net_h_at(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, nid: &str) -> f64 {
    if let Some(v) = sec_pf(meta, st, "hBy", nid) {
        return v;
    }
    let ci = sec_circ_of(meta, nid);
    let c = curves.of(ci);
    if ci >= 0 && meta.sec.core_circs.get(ci as usize).copied().unwrap_or(false) {
        return crate::eos::h_of_t(c, tavg_of(meta, st, ci));
    }
    let p = sec_net_p_at(meta, curves, st, nid);
    if meta.sec.net_index.get(nid).and_then(|i| meta.sec.net_vapour.get(*i)).copied().unwrap_or(0) != 0 {
        crate::eos::sat_hg(c, p)
    } else {
        crate::eos::h_of_t(c, crate::eos::sat_t(c, p))
    }
}

/// `holdLvlOf` over live state.
pub fn sec_hold_lvl_of(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, nid: &str) -> f64 {
    let ci = sec_circ_of(meta, nid);
    let c = curves.of(ci);
    let p = sec_net_p_at(meta, curves, st, nid);
    let t = crate::eos::sat_t(c, p);
    let x = crate::eos::clamp(crate::eos::x_of_h(c, p, sec_net_h_at(meta, curves, st, nid)), 0.0, 1.0);
    let rg = crate::eos::rhog_of(c, t);
    let rf = crate::eos::rhof_of(c, t);
    let vg = x / crate::eos::js_max(rg, 1e-9);
    let vf = (1.0 - x) / crate::eos::js_max(rf, 1e-9);
    100.0 * vf / crate::eos::js_max(vf + vg, 1e-12)
}

fn sec_is_drum(meta: &StepMeta, id: &str) -> bool {
    meta.sec.boiler_ids.iter().position(|b| b == id)
        .and_then(|i| meta.sec.is_drum.get(i).copied()).unwrap_or(false)
}

fn sec_shell_node(meta: &StepMeta, id: &str) -> Option<String> {
    meta.sec.sg_ids.iter().position(|s| s == id)
        .and_then(|i| meta.sec.shell_node.get(i).cloned())
}

/// `sgLvl`: shell void across the operating span.
pub fn sec_sg_lvl(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, id: &str) -> f64 {
    let n = match sec_shell_node(meta, id) {
        Some(n) => n,
        None => return 50.0,
    };
    if sec_pf(meta, st, "hBy", &n).is_none() {
        return 50.0;
    }
    if meta.sec.net_index.get(&n).is_none() {
        return 50.0;
    }
    let v = sec_hold_lvl_of(meta, curves, st, &n) * 1.6;
    if v.is_finite() {
        crate::eos::clamp(v, 0.0, 100.0)
    } else {
        50.0
    }
}

/// `boilerLvl`: drums read the whole section, SGs the shell.
pub fn sec_boiler_lvl(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, id: &str) -> f64 {
    if !sec_is_drum(meta, id) {
        return sec_sg_lvl(meta, curves, st, id);
    }
    let n = match meta.sec.fold_map.get(id) {
        Some(f) => f.clone(),
        None => id.to_string(),
    };
    if sec_pf(meta, st, "hBy", &n).is_none() {
        return 50.0;
    }
    if meta.sec.net_index.get(&n).is_none() {
        return 50.0;
    }
    let v = sec_hold_lvl_of(meta, curves, st, &n);
    if v.is_finite() {
        crate::eos::clamp(v, 0.0, 100.0)
    } else {
        50.0
    }
}

/// Driest boiler level (`sglMin`): an average would hide one boiling dry.
pub fn sgl_min(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState) -> f64 {
    if meta.sec.boiler_ids.is_empty() {
        return 100.0;
    }
    let mut m = 100.0;
    for id in &meta.sec.boiler_ids {
        let v = sec_boiler_lvl(meta, curves, st, id);
        if v < m {
            m = v;
        }
    }
    m
}

/// Full live tank valve (`tankLive`) with AUTORULE arms.
pub fn tank_open_live(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, tid: &str) -> bool {
    let ref_open = st.sec.u8s.get("refOpen").copied().unwrap_or(false);
    let op = st.sec.maps.get("tankOpen").and_then(|m| m.get(tid)).unwrap_or(0.0) != 0.0;
    let bypass = st.sec.tank_byp.get(tid).copied().unwrap_or(false);
    let (auto, circ) = meta.sec.tank_ids.iter().position(|x| x == tid)
        .and_then(|i| meta.sec.tanks.get(i))
        .map(|r| (r.auto.clone(), r.circuit))
        .unwrap_or(("manual".to_string(), -1));
    let rule_live = match auto.as_str() {
        "sglow" => {
            let cur = st.sec.bmaps.get("tankAuto").map(|m| m.get(tid)).unwrap_or(false);
            sgl_min(meta, curves, st) < if cur { meta.sec.sg_efw_off } else { meta.sec.sg_dry }
        }
        "plow" => loop_p(meta, st, circ) < curves.set_p(circ) * 0.55,
        _ => false,
    };
    crate::netlive::tank_live(&st.sec.dmg_parts, tid, crate::netlive::tank_open(ref_open, op, bypass, &auto, rule_live))
}

/// Sink-averaged condenser pressure (`condPRead`).
pub fn cond_p_read(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, sinks: &[String], cond_des: f64) -> f64 {
    let (mut p, mut n) = (0.0, 0u32);
    if let Some(m) = st.sec.maps.get("condPBy") {
        for id in sinks {
            if let Some(v) = m.get(id) {
                if v.is_finite() {
                    p += v;
                    n += 1;
                }
            }
        }
    }
    if n > 0 {
        crate::eos::js_max(0.004, p / n as f64)
    } else if let Some(t) = st.sec.f64s.get("condT").copied() {
        crate::eos::js_max(0.004, crate::eos::sat_p(&curves.water, t))
    } else {
        cond_des
    }
}

/// Worst boiler overpressure fraction (`sgOverFrac`).
pub fn sg_over_frac(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState) -> f64 {
    let mut over = 0.0f64;
    for (bi, id) in meta.sec.boiler_ids.iter().enumerate() {
        over = crate::eos::js_max(over, live_boiler_p(meta, curves, st, bi) / boiler_design_p(meta, curves, id) - 1.0);
    }
    over
}
/// Pool readers (`poolLvlOf`/`poolH`/`condFill0`): a pool's level is the
/// water it holds against its volume; its head is liquid-weighed drainage.
pub const MPC: f64 = 1.4 / 3.0;

/// Commissioning fill of the hosted condensate (`condFill0`), %.
pub fn cond_fill0(meta: &StepMeta) -> f64 {
    let (mut v, mut f) = (0.0, 0.0);
    for (i, _id) in meta.sec.tank_ids.iter().enumerate() {
        if let Some(r) = meta.sec.tanks.get(i) {
            if !r.cell {
                v += r.vol;
                f += r.vol * r.level;
            }
        }
    }
    if v > 0.0 { f / v } else { 50.0 }
}

/// Pool level at a node (`poolLvlOf`), 0..100; `None` with no booked mass.
pub fn pool_lvl_of(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, i: usize) -> Option<f64> {
    if st.m_by.has.get(i).copied().unwrap_or(0) == 0 {
        return None;
    }
    let nm = meta.sec.net_names.get(i)?;
    let ci = meta.sec.net_index.get(nm).and_then(|k| meta.sec.circ_of_node.get(*k)).copied().unwrap_or(-1);
    let c = curves.of(ci);
    let rf = crate::eos::rhof_of(c, crate::eos::sat_t(c, sec_net_p_at(meta, curves, st, nm)));
    let vol = meta.sec.net_vol.get(i).copied().unwrap_or(0.0);
    Some(crate::eos::clamp(100.0 * st.m_by.v[i] / crate::eos::js_max(vol * rf, 1e-9), 0.0, 100.0))
}

/// Pool head over a drain (`poolH`), MPa; absent pool or part reads 0.
pub fn pool_h(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, i: usize, part_h: Option<f64>) -> f64 {
    let lvl = match pool_lvl_of(meta, curves, st, i) {
        Some(l) => l,
        None => return 0.0,
    };
    let ph = match part_h {
        Some(h) => h,
        None => return 0.0,
    };
    let nm = match meta.sec.net_names.get(i) {
        Some(n) => n,
        None => return 0.0,
    };
    let ci = meta.sec.net_index.get(nm).and_then(|k| meta.sec.circ_of_node.get(*k)).copied().unwrap_or(-1);
    let c = curves.of(ci);
    let f = crate::eos::clamp(lvl / crate::eos::js_max(cond_fill0(meta), 1.0), 0.0, 1.0);
    crate::eos::rhof_of(c, crate::eos::sat_t(c, sec_net_p_at(meta, curves, st, nm)))
        * crate::edge::G_MPA
        * crate::eos::js_max(ph, 1.0)
        * MPC
        * f
}

/// Mixture density off the node's own (p, h) (`netRhoAt`).
pub fn net_rho_at(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, nid: &str) -> f64 {
    let ci = meta.sec.net_index.get(nid).and_then(|k| meta.sec.circ_of_node.get(*k)).copied().unwrap_or(-1);
    let c = curves.of(ci);
    let mut out = [0.0; 3];
    crate::eos::mix_state(c, sec_net_p_at(meta, curves, st, nid), sec_net_h_at(meta, curves, st, nid), &mut out);
    out[crate::eos::MX_RHO]
}

/// Generator design pressure (`boilerDesignP`): drums hold the loop setpoint.
pub fn boiler_design_p(meta: &StepMeta, curves: &sec::SecCurves, id: &str) -> f64 {
    match meta.sec.boiler_ids.iter().position(|b| b == id) {
        Some(bi) => {
            if meta.sec.is_drum.get(bi).copied().unwrap_or(false) {
                curves.set_p(meta.sec.boiler_circ.get(bi).copied().unwrap_or(-1))
            } else {
                meta.sec.sg_ids.iter().position(|s| s == id)
                    .and_then(|si| meta.sec.sg_design_p.get(si).copied())
                    .unwrap_or(0.0)
            }
        }
        None => 0.0,
    }
}

/// Setpoint pressure of a circuit (`holdSetP`): the lowest-id hold tank
/// states it; without one the (frozen) suggested pressure answers.
/// `suggest` arrives pre-evaluated per circuit (commission-static).
pub fn hold_set_p(meta: &StepMeta, ci: i32, suggest: &[f64]) -> f64 {
    if let Some(h) = meta.sec.hold_on_circ.get(ci as usize).and_then(|v| v.first()) {
        if let Some(p) = meta.sec.tank_ids.iter().position(|t| t == h)
            .and_then(|ti| meta.sec.tanks.get(ti).and_then(|r| r.hold_p))
        {
            return p;
        }
    }
    suggest.get(ci as usize).copied().unwrap_or(0.0)
}

/// Compartment pressure at a part (`regionPAt`).
pub fn live_region_p_at(meta: &StepMeta, st: &StepState, part: Option<usize>) -> f64 {
    let room_p = st.sec.bags.get("roomP").map(|b| b.v.clone()).unwrap_or_default();
    let means = crate::tick::region_p_mean(&meta.sec.region_of, &room_p, meta.sec.n_regions);
    match part.and_then(|pi| meta.sec.parts.get(pi)) {
        Some(p) => crate::tick::region_p(&meta.sec.region_of, &means, meta.sec.pcont, meta.sec.gw, meta.sec.gh, p.x + p.w / 2, p.y + p.h / 2),
        None => crate::tick::region_p(&meta.sec.region_of, &means, meta.sec.pcont, meta.sec.gw, meta.sec.gh, -1, -1),
    }
}

/// `secP` by SG index: burst/wrecked shells read the room.
pub fn sec_sec_p(meta: &StepMeta, st: &StepState, si: usize) -> f64 {
    let id = meta.sec.sg_ids.get(si).cloned().unwrap_or_default();
    let burst = st.sec.bmaps.get("sgBurst").map(|m| m.get(&id)).unwrap_or(false);
    if burst || part_wrecked(st, &id) {
        return live_region_p_at(meta, st, meta.sec.part_of.get(&id).copied());
    }
    match st.sec.maps.get("sgPBy").and_then(|m| m.get(&id)) {
        Some(p) => crate::eos::js_max(crate::sec::COND_P0, p),
        None => live_sec_p_target(meta, st, &id, si),
    }
}

fn live_sec_load_share(meta: &StepMeta, st: &StepState, id: &str) -> f64 {
    let l = st.sec.f64s.get("load").copied().unwrap_or(f64::NAN);
    let l = if l.is_nan() { 1.0 } else { l };
    match st.sec.maps.get("sgShare") {
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

fn live_sec_p_target(meta: &StepMeta, st: &StepState, id: &str, si: usize) -> f64 {
    let dp = meta.sec.sg_design_p.get(si).copied().unwrap_or(0.0);
    dp * crate::fdlibm::pow(crate::eos::js_max(live_sec_load_share(meta, st, id), 0.05), 0.25)
}

/// `reliefP` (step.js:862): a shell valve reads the worst shell it guards,
/// anything else the pressure at its own node. `fit_node` is the frozen
/// `reliefNodeOf` per fitting — a PORV is not in `reliefIds` and still has
/// one.
pub fn sec_relief_p(
    meta: &StepMeta,
    st: &StepState,
    fit_node: &HashMap<String, String>,
    fid: &str,
) -> f64 {
    let shells = meta.sec.shells_of.get(fid).cloned().unwrap_or_default();
    if !meta.sec.relief_sec.iter().any(|x| x == fid) {
        let raw = fit_node.get(fid).cloned().unwrap_or_default();
        if raw.is_empty() || raw == "null" {
            return st.events.p;
        }
        let nm = meta.sec.fold_map.get(&raw).cloned().unwrap_or(raw);
        return sec_net_p_at(meta, &meta.sec_curves, st, &nm);
    }
    if shells.is_empty() {
        return st.events.p;
    }
    let mut pk = 0.0f64;
    let mut any = false;
    for id in &shells {
        if st.events.port_shut.iter().any(|p| port_cuts_shell(p, id)) {
            continue;
        }
        if let Some(si) = meta.sec.sg_ids.iter().position(|s| s == id) {
            pk = pk.max(sec_sec_p(meta, st, si));
            any = true;
        }
    }
    // Isolated: nothing feeds the stub, so it holds compartment pressure.
    if any { pk } else { live_region_p_at(meta, st, meta.sec.part_of.get(fid).copied()) }
}

fn port_cuts_shell(_port: &str, _shell: &str) -> bool {
    false
}

/// Full live `ctlPass`: assemble, evaluate in order with intra-pass
/// scram/load feedback, apply sinks. Returns post-pass out/f/act.
/// `live.rps_hot` carries scram lag timers across ticks.
pub fn live_ctl(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, live: &mut CtlLive) -> ctl::Replay {
    let dt = 0.02;
    let n = fr.template.blocks.len();
    let mut out = st.blk_out.clone();
    if out.len() != n {
        // Cold start mirrors ensureBlk: fresh arrays read the design seeds.
        out = fr.seed_out.clone();
        if out.len() != n {
            out = vec![0.0; n];
        }
    }
    let mut f = st.blk_f.clone();
    if f.len() != n {
        f = fr.seed_f.clone();
        if f.len() != n {
            f = fr.template.blocks.iter().map(|b| {
                if b.mode == ctl::MODE_PID { 0.0 } else { f64::NAN }
            }).collect();
        }
    }
    let mut act = assemble_act(meta, st, fr, &live.rps_hot);
    if !ctl_live(meta, st, fr) {
        return ctl::Replay { out, f, act };
    }
    let modes: Vec<u8> = fr.template.blocks.iter().map(|b| b.mode).collect();
    let inputs: Vec<Vec<i32>> = fr.template.blocks.iter().map(|b| b.inputs.clone()).collect();
    let on: Vec<bool> = fr.template.blocks.iter().map(|b| b.on).collect();
    let order = ctl::ctl_order(&fr.template.blocks);
    let mut work_scr: Vec<bool> = act.cores.iter().map(|c| c.scrammed).collect();
    let mut work_hot: Vec<f64> = act.cores.iter().map(|c| c.rps_hot).collect();
    let mut work_near: Vec<bool> = act.cores.iter().map(|c| c.rps_near).collect();
    let mut work_load = act.load;
    let mut ins = vec![0.0f64; 3];
    for &id in order.iter() {
        if !on[id] {
            continue;
        }
        let b = &fr.template.blocks[id];
        ins.resize(b.inputs.len(), 0.0);
        for (k, &src) in b.inputs.iter().enumerate() {
            ins[k] = if src >= 0 && (src as usize) < n { out[src as usize] } else { 0.0 };
        }
        let (v, f_new) = if b.mode == ctl::MODE_SOURCE {
            (live_src(meta, st, fr, id, &work_scr, &work_hot, &work_near, work_load), f[id])
        } else {
            ctl::blk_eval(b, &ins, dt, out[id], f[id])
        };
        f[id] = f_new;
        if b.mode == ctl::MODE_SINK && !sink_dead(meta, st, fr, b.sink_kind, fr.arg.get(id).map(|s| s.as_str()).unwrap_or("")) {
            let mid = if b.sink_kind == ctl::SINK_SCRAM {
                match scram_driver(&fr.template.blocks, &fr.arg, fr.arg.get(id).map(|s| s.as_str()).unwrap_or("")) {
                    Some(drv) => blame_walk(&out, &modes, &inputs, &fr.ids, &fr.name, drv),
                    None => String::new(),
                }
            } else {
                String::new()
            };
            ctl::sink_apply(&mut act, b.sink_kind, b.sink_arg, at0(&ins), dt, &mid);
            for (ci, c) in act.cores.iter().enumerate() {
                if ci < work_scr.len() {
                    work_scr[ci] = c.scrammed;
                    work_hot[ci] = c.rps_hot;
                    work_near[ci] = c.rps_near;
                }
            }
            work_load = act.load;
        }
        if v.is_finite() {
            out[id] = v;
        }
    }
    live.rps_hot = act.cores.iter().map(|c| c.rps_hot).collect();
    ctl::Replay { out, f, act }
}

fn at0(ins: &[f64]) -> f64 {
    if ins.is_empty() { f64::NAN } else { ins[0] }
}

/// Live source value with intra-pass scram/load feedback applied.
pub fn live_src(
    meta: &StepMeta,
    st: &StepState,
    fr: &CtlFrozen,
    i: usize,
    work_scr: &[bool],
    _work_hot: &[f64],
    _work_near: &[bool],
    work_load: f64,
) -> f64 {
    let sig = fr.sig.get(i).map(|s| s.as_str()).unwrap_or("");
    let arg = fr.arg.get(i).map(|s| s.as_str()).unwrap_or("");
    match sig {
        "trip" => {
            match meta.core_ids.iter().position(|id| id == arg) {
                Some(ci) => if work_scr.get(ci).copied().unwrap_or(false) { 1.0 } else { 0.0 },
                None => if st.events.scrammed { 1.0 } else { 0.0 },
            }
        }
        "tprog" => {
            let tref = meta.core_k.get(arg).map(|k| k.tref).unwrap_or(f64::NAN);
            let steam = meta.events.cores_steam.get(arg).copied().unwrap_or(0.0) != 0.0;
            let scrammed = meta.core_ids.iter().position(|id| id == arg)
                .and_then(|ci| work_scr.get(ci).copied()).unwrap_or(false);
            if scrammed && runback_live(meta, st, fr) {
                return tref - 18.0;
            }
            if steam {
                return tref;
            }
            tref - 18.0 + 18.0 * unit_frac_work(meta, st, fr, work_scr, work_load)
        }
        _ => sig_read(meta, st, fr, i),
    }
}

fn unit_frac_work(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, work_scr: &[bool], work_load: f64) -> f64 {
    let mut live = 0.0;
    for (ci, id) in meta.core_ids.iter().enumerate() {
        let scr = work_scr.get(ci).copied().unwrap_or_else(|| st.core.get(id).map(|c| c.scrammed).unwrap_or(false));
        if !scr {
            live += meta.core_k.get(id).map(|k| k.rated).unwrap_or(0.0);
        }
    }
    if live > 0.0 && live != fr.p_rated {
        (work_load * fr.p_rated / live).min(1.0)
    } else {
        work_load
    }
}

const T_FEED: f64 = 490.0;
const NET_DT: f64 = 0.02;

fn live_feed_in_h(meta: &StepMeta, st: &StepState, bi: usize) -> f64 {
    let nm = meta.sec.feed_node.get(bi).cloned().unwrap_or_default();
    let ni = meta.sec.net_index.get(&nm).copied();
    let h = ni.and_then(|i| {
        let hm = st.advect_cache.as_ref().and_then(|c| c.feed_hm.get(i).copied()).unwrap_or(0);
        if hm != 0 {
            st.advect_cache.as_ref().and_then(|c| c.feed_hv.get(i).copied())
        } else {
            None
        }
    });
    if let Some(v) = h {
        return v;
    }
    let ct = st.sec.f64s.get("condT").copied().unwrap_or(f64::NAN);
    crate::eos::h_of_t(
        meta.sec_curves.of(meta.sec.boiler_circ.get(bi).copied().unwrap_or(-1)),
        if ct.is_nan() { T_FEED } else { ct },
    )
}

/// `boilerP` over live state.
pub fn live_boiler_p(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, bi: usize) -> f64 {
    if !meta.sec.is_drum.get(bi).copied().unwrap_or(false) {
        let bid = meta.sec.boiler_ids.get(bi).cloned().unwrap_or_default();
        let si = meta.sec.sg_ids.iter().position(|s| s == &bid).unwrap_or(usize::MAX);
        return if si == usize::MAX { f64::NAN } else { sec_sec_p(meta, st, si) };
    }
    let id = meta.sec.boiler_ids.get(bi).cloned().unwrap_or_default();
    match sec_pf(meta, st, "pBy", &id) {
        Some(v) => crate::eos::js_max(crate::sec::COND_P0, v),
        None => curves.set_p(meta.sec.boiler_circ.get(bi).copied().unwrap_or(-1)),
    }
}

fn live_feed_heat_kw(meta: &StepMeta, st: &StepState, bi: usize) -> f64 {
    let id = meta.sec.boiler_ids.get(bi).cloned().unwrap_or_default();
    let c = meta.sec_curves.of(meta.sec.boiler_circ.get(bi).copied().unwrap_or(-1));
    let nm = meta.sec.feed_node.get(bi).cloned().unwrap_or_default();
    let h_in = live_feed_in_h(meta, st, bi);
    let steam = or0(st.sec.maps.get("steamBy").and_then(|m| m.get(&id)));
    let duty = crate::eos::js_max(0.0, steam)
        * crate::eos::js_max(0.0, crate::eos::h_of_t(c, T_FEED) - h_in);
    let hs = crate::eos::sat_h(c, live_boiler_p(meta, &meta.sec_curves, st, bi));
    let m = sec_pf(meta, st, "mBy", &nm).unwrap_or(0.0);
    let mv = meta.sec.net_index.get(&nm).copied()
        .and_then(|i| st.advect_cache.as_ref().and_then(|ac| ac.feed_mv.get(i).copied()))
        .unwrap_or(0.0);
    let nhat = sec_net_h_at(meta, &meta.sec_curves, st, &nm);
    let room = crate::eos::js_max(0.0, mv) * crate::eos::js_max(0.0, hs - h_in)
        + m * crate::eos::js_max(0.0, hs - nhat) / NET_DT;
    crate::eos::js_min(duty, room)
}

fn live_feed_bleed_kgs(meta: &StepMeta, st: &StepState, bi: usize) -> f64 {
    live_feed_heat_kw(meta, st, bi) / crate::eos::js_max(
        crate::eos::sat_hg(meta.sec_curves.of(meta.sec.boiler_circ.get(bi).copied().unwrap_or(-1)), live_boiler_p(meta, &meta.sec_curves, st, bi)) - live_feed_in_h(meta, st, bi),
        1.0,
    )
}

fn live_bleed_of(meta: &StepMeta, st: &StepState, bi: usize) -> f64 {
    let id = meta.sec.boiler_ids.get(bi).cloned().unwrap_or_default();
    crate::eos::js_min(
        live_feed_bleed_kgs(meta, st, bi),
        crate::eos::js_max(0.0, or0(st.sec.maps.get("steamBy").and_then(|m| m.get(&id)))),
    )
}

/// `turbShare`: shaft work plus heater bleed over plant reference.
pub fn live_turb_share(meta: &StepMeta, st: &StepState, fr: &CtlFrozen) -> f64 {
    if fr.steam_ref <= 0.0 {
        return 0.0;
    }
    let wk = or0(st.sec.f64s.get("turbWk").copied());
    let mut bleed = 0.0;
    for bi in 0..meta.sec.boiler_ids.len() {
        bleed += live_bleed_of(meta, st, bi);
    }
    (wk + bleed) / fr.steam_ref
}

fn fnum(v: f64) -> f64 {
    v
}

/// JS `(x||0)`: missing, null, AND NaN all read as 0.
pub fn or0(v: Option<f64>) -> f64 {
    match v {
        Some(x) if x != 0.0 && !x.is_nan() => x,
        _ => 0.0,
    }
}

/// Actuator snapshot assembly (pre-pass `actPre`) from live state.
/// `rps_hot` is caller-carried pre-pass lag timers (the engine's CtlLive;
/// the harness feeds the dumped pre-pass values since assembly input ==
/// assembly expectation by definition).
pub fn assemble_act(meta: &StepMeta, st: &StepState, fr: &CtlFrozen, rps_hot: &[f64]) -> ctl::Act {
    let t = &fr.template.act;
    let sec_f = |k: &str| st.sec.f64s.get(k).copied().unwrap_or(f64::NAN);
    let smap = |m: &HashMap<String, f64>| -> (Vec<String>, Vec<f64>) {
        let mut ks: Vec<String> = m.keys().cloned().collect();
        ks.sort();
        let vs = ks.iter().map(|k| m[k]).collect();
        (ks, vs)
    };
    let _ = smap;
    let load = st.events.load;
    let load_dem = st.events.load_dem;
    let boron_dem = sec_f("boronDem");
    let rb_hot = st.sec.u8s.get("rbHot").copied().unwrap_or(false);
    let ordered = |keys: &[String], m: Option<&sec::SMap>| -> (Vec<bool>, Vec<f64>) {
        match m {
            Some(mm) => keys.iter().map(|k| match mm.get(k) {
                Some(v) => (true, v),
                None => (false, f64::NAN),
            }).unzip(),
            None => (keys.iter().map(|_| false).collect(), keys.iter().map(|_| f64::NAN).collect()),
        }
    };
    let (freg_exist, freg_v) = ordered(&fr.freg_keys, st.sec.maps.get("fregDemBy"));
    let flow_map: HashMap<String, f64> = st.events.flow_demby.clone();
    let (flow_exist, flow_v) = {
        let ex: Vec<bool> = fr.flow_keys.iter().map(|k| flow_map.contains_key(k)).collect();
        let vs: Vec<f64> = fr.flow_keys.iter().map(|k| flow_map.get(k).copied().unwrap_or(f64::NAN)).collect();
        (ex, vs)
    };
    let (valve_exist, valve_v) = ordered(&fr.valve_keys, st.sec.maps.get("valveDem"));
    let (tank_exist, tank_b) = ordered(&fr.tank_keys, st.sec.maps.get("tankOpen"));
    let tank_v: Vec<bool> = tank_b.iter().map(|&v| v != 0.0).collect();
    let relief: Vec<ctl::ReliefCell> = fr.relief_keys.iter().map(|fid| {
        let open = st.events.relief_open.get(fid).copied().unwrap_or(false);
        let exist = st.events.relief_open.contains_key(fid);
        let spring = meta.sec.relief_ids.iter().position(|r| r == fid)
            .and_then(|i| meta.sec.fits.get(i)).map(|f| f.spring).unwrap_or(false);
        ctl::ReliefCell {
            exist,
            open,
            auto: st.events.relief_auto.get(fid).copied().unwrap_or(false),
            stuck: st.events.relief_stuck.get(fid).copied().unwrap_or(false),
            arm: st.sec.relief.get(fid).map(|c| c.arm).unwrap_or(false),
            spring,
        }
    }).collect();
    let tmpl_cores = &t.cores;
    let mut cores = Vec::with_capacity(meta.core_ids.len());
    for (ci, id) in meta.core_ids.iter().enumerate() {
        let cs = st.core.get(id);
        let ev = st.events.vessels.get(id);
        let tc = tmpl_cores.get(ci);
        let rod_part = fr.rods_of.get(id);
        cores.push(ctl::CoreAct {
            rod_dem: cs.map(|c| c.rod_dem).unwrap_or(f64::NAN),
            rod_zdem: cs.map(|c| c.rod_zdem.clone()).unwrap_or_default(),
            rod_band: cs.map(|c| c.rod_band).unwrap_or(false),
            split: cs.map(|c| c.split).unwrap_or(false),
            regang: cs.map(|c| c.re_gang).unwrap_or(false),
            bank_auto: tc.map(|c| c.bank_auto.clone()).unwrap_or_default(),
            rod_jam: cs.map(|c| c.rod_jam).unwrap_or(false),
            scrammed: cs.map(|c| c.scrammed).unwrap_or(false),
            rps_hot: rps_hot.get(ci).copied().unwrap_or(f64::NAN),
            rps_near: ev.map(|v| v.rps_near).unwrap_or(false),
            trip: ev.map(|v| v.trip.clone()).unwrap_or_default(),
            rated: meta.core_k.get(id).map(|k| k.rated).unwrap_or(f64::NAN),
            rod_rate: meta.core_k.get(id).map(|k| k.rod_rate).unwrap_or(f64::NAN),
            pin_hot: pin_hot(meta, st, fr, id),
            dmg_rod: match rod_part {
                Some(rp) => part_wrecked(st, rp),
                None => false,
            },
        });
    }
    let _ = fnum;
    ctl::Act {
        ar_lo: fr.ar_lo,
        ar_hi: fr.ar_hi,
        load_max: fr.p_load_max,
        rps_lag: fr.p_rps_lag,
        p_rated: fr.p_rated,
        load,
        load_dem,
        boron_dem,
        rb_hot,
        freg_exist,
        freg: freg_v,
        flow_exist,
        flow: flow_v,
        valve_exist,
        valve: valve_v,
        tank_exist,
        tank: tank_v,
        relief,
        cores,
    }
}

// ---------------------------------------------------------------------------
// Batch-B live sec-tail readers: exact ports of the gate capture sites
// (tools/step-gate.js:1497-1535). All read live replay state at the
// post_early hook (post-burstDice, pre-advect); the verify bin diffs each
// against the dumped SecTail with bit-exact f64 compare (NaN==NaN).
// ---------------------------------------------------------------------------

/// Live components over the dumped solve-time lanes + live post-solve field.
/// Mirrors netPieces (pipenet.js:2107): fn-edges conduct iff edgeG>0 (the
/// full flowG gate, diode/wet-donor included, via edge_gh_lanes), scalars
/// iff >0. Lanes are solve-time; capture re-evaluates closures on moved S
/// (pressRead PBy, relief lifts, new damage) — silent while those stay put.
pub struct LivePieces {
    pub of: Vec<i32>,
    pub npc: usize,
    pub live: Vec<u8>,
    pub adj: Vec<Vec<u32>>,
}

pub fn live_pieces(
    fz: &SolveFrozen,
    fs: &crate::field::FieldState,
    warr: &[f64],
    choke: bool,
    edge_q: &[Vec<f64>],
    edge_gates: &[Vec<f64>],
) -> LivePieces {
    let n = fz.n;
    let mut g = vec![0.0; fz.ne];
    for (e, gg) in g.iter_mut().enumerate() {
        let (gh, _, _) = crate::step::edge_gh_lanes(fz, fs, warr, &edge_q[e], &edge_gates[e], e, choke);
        *gg = gh;
    }
    let (of, npc, live) = crate::pieces::net_pieces(n, &fz.eu, &fz.ev, &g);
    let adj = crate::netlive::adj_from_live(n, &fz.eu, &fz.ev, &live);
    LivePieces { of, npc, live, adj }
}

/// Fixed set at capture (netBounds, pipenet.js:2060): solve-time cont/tank
/// pins with netStoreHeld=false (hold/drum/sec/cond classes skipped), then
/// storing vessels outside the field pinned at marker 0.
pub fn live_fixed(meta: &StepMeta, st: &StepState, tail: &SolveTail) -> (Vec<f64>, Vec<u8>) {
    crate::netlive::fixed_capture(
        meta, st, &tail.cont, &tail.hold_pins, &tail.drum_pins, &tail.tank_pins,
        &tail.sec_pins, &tail.cond_pins, false,
    )
}

/// holdLive per holdTankIds (pipenet.js:2068): BFS from the circuit's first
/// hold tank node over non-fixed nodes; a cycle in the reached piece reads
/// live. netStoreHeld=false at capture (fixed set above).
pub fn live_hold_live(meta: &StepMeta, st: &StepState, tail: &SolveTail) -> Vec<bool> {
    let pc = live_pieces(
        &meta.solve,
        &st.solve_carry.fs,
        &st.solve_carry.warr,
        st.solve_carry.choke,
        &tail.edge_q,
        &tail.edge_gates,
    );
    let (_fv, fh) = live_fixed(meta, st, tail);
    if std::env::var("BATCHB_DIAG").is_ok() {
        let nfx = fh.iter().map(|&v| v as usize).sum::<usize>();
        eprintln!("holdlive nfixed={nfx}");
    }
    crate::netlive::hold_live_circuits(meta, &pc.adj, &pc.live, &fh)
}

/// stageFed per sg+ihx id (step.js:1689): the hot stream's piece still feeds
/// a core piece, or another stage's cold stream. IN faces are static per
/// role (layout.js ROLE.sg/ihx internal).
pub fn live_stage_fed(meta: &StepMeta, pc: &LivePieces, id: &str) -> bool {
    let sg = meta.sec.sg_ids.iter().any(|s| s == id);
    let ihx = meta.sec.ihx_ids.iter().any(|s| s == id);
    if !sg && !ihx {
        return false;
    }
    let at = |face: &str| -> i32 {
        let raw = format!("{id}{face}");
        let folded = meta.sec.fold_map.get(&raw).map(|s| s.as_str()).unwrap_or(&raw);
        meta.sec.net_index.get(folded).map(|&i| pc.of[i]).unwrap_or(-1)
    };
    let (a0, b0) = if sg { (at("l"), at("b")) } else { (at("l"), at("r")) };
    if a0 < 0 && b0 < 0 {
        return false;
    }
    let has = |p: i32| p >= 0 && (p == a0 || p == b0);
    let cores = crate::pieces::core_pieces(&pc.of, &meta.solve.core_nodes, meta.solve.core_node);
    if cores.iter().any(|&p| has(p)) {
        return true;
    }
    for q in meta.sec.sg_ids.iter().chain(meta.sec.ihx_ids.iter()) {
        if q == id {
            continue;
        }
        let qsg = meta.sec.sg_ids.iter().any(|s| s == q);
        let (fa, fb) = if qsg { ("r", "t") } else { ("t", "b") };
        let raw_a = format!("{q}{fa}");
        let folded_a = meta.sec.fold_map.get(&raw_a).map(|s| s.as_str()).unwrap_or(&raw_a);
        let pa = meta.sec.net_index.get(folded_a).map(|&i| pc.of[i]).unwrap_or(-1);
        let raw_b = format!("{q}{fb}");
        let folded_b = meta.sec.fold_map.get(&raw_b).map(|s| s.as_str()).unwrap_or(&raw_b);
        let pb = meta.sec.net_index.get(folded_b).map(|&i| pc.of[i]).unwrap_or(-1);
        if has(pa) || has(pb) {
            return true;
        }
    }
    false
}

/// tankP per tankIds (pipenet.js:1146): a live hold tank holds its circuit's
/// loop pressure; an in-field vessel is its node; else the gas-charge law
/// about the commissioning void, floored at compartment pressure.
pub fn live_tank_p(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, tid: &str, hold_live: bool) -> f64 {
    let ti = match meta.sec.tank_ids.iter().position(|t| t == tid) {
        Some(i) => i,
        None => return 0.0,
    };
    let t = &meta.sec.tanks[ti];
    let ci = t.circuit;
    if t.hold && hold_live {
        return loop_p(meta, st, ci);
    }
    if t.in_field {
        if let Some(p) = sec_pf(meta, st, "pBy", tid) {
            return crate::eos::js_max(crate::sec::COND_P0, p);
        }
    }
    let void_frac = if t.gas_p0.is_some() {
        crate::eos::js_max(0.0, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0)
    } else if t.hold {
        crate::eos::js_max(0.01, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0)
    } else {
        0.0
    };
    // holdSetP's lowest-id-hold-p else the settled suggest; the dumped set_p
    // stands in for the suggest (exact while hold_p is stated).
    let p0 = match t.gas_p0 {
        Some(p) => p,
        None => {
            if t.hold {
                t.hold_p.unwrap_or_else(|| curves.set_p(ci))
            } else {
                0.0
            }
        }
    };
    let region = live_region_p_at(meta, st, meta.sec.part_of.get(tid).copied());
    // JS `!(frac > 0)`: a water-solid vessel sits at the charge itself.
    if void_frac <= 0.0 || void_frac.is_nan() {
        return crate::eos::js_max(region, p0);
    }
    let lvl = live_tank_lvl(meta, curves, st, tid);
    crate::eos::js_max(
        region,
        p0 * void_frac / crate::eos::js_max(0.01, void_frac + (t.level - crate::eos::clamp(lvl, 0.0, 100.0)) / 100.0),
    )
}

/// tankLvl per tank id (pipenet.js:1141): hold read, in-field gas law,
/// hosted condensate pool, operator's s.tank, commissioning level.
pub fn live_tank_lvl(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState, tid: &str) -> f64 {
    let ti = match meta.sec.tank_ids.iter().position(|t| t == tid) {
        Some(i) => i,
        None => return f64::NAN,
    };
    let t = &meta.sec.tanks[ti];
    if t.hold {
        if let Some(v) = st.sec.maps.get("lvlBy").and_then(|m| m.get(tid)).or_else(|| st.sec.f64s.get("lvl").copied()) {
            return v;
        }
    }
    if t.in_field {
        let gas_v0 = t.vol * crate::eos::js_max(0.0, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0);
        // JS `!(V0 > 0)`: non-positive or NaN both fall back to the void read.
        if gas_v0 <= 0.0 || gas_v0.is_nan() || t.gas_p0.is_none() {
            return sec_hold_lvl_of(meta, curves, st, tid);
        }
        match sec_pf(meta, st, "pBy", tid) {
            None => return crate::eos::clamp(t.level, 0.0, 100.0),
            Some(p) => {
                let p0 = t.gas_p0.unwrap_or(0.0);
                return 100.0 * (1.0 - (t.vol.min(gas_v0 * p0 / p)) / crate::eos::js_max(t.vol, 1e-9));
            }
        }
    }
    if !t.cell {
        if let Some(v) = live_cond_pool_lvl(meta, curves, st) {
            return v;
        }
    }
    if let Some(v) = st.sec.maps.get("tank").and_then(|m| m.get(tid)) {
        return v;
    }
    t.level
}

/// condPoolLvl (pipenet.js:1135): volume-weighted pool level across the
/// condenser vessels; undefined with no booked mass anywhere.
pub fn live_cond_pool_lvl(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState) -> Option<f64> {
    let (mut v, mut f) = (0.0, 0.0);
    for nm in &meta.sec.cond_ves_node {
        let i = match meta.sec.net_index.get(nm) {
            Some(&i) => i,
            None => continue,
        };
        let lvl = match pool_lvl_of(meta, curves, st, i) {
            Some(l) => l,
            None => continue,
        };
        let vol = meta.sec.net_vol.get(i).copied().unwrap_or(0.0);
        v += vol;
        f += vol * lvl;
    }
    if v > 0.0 { Some(f / v) } else { None }
}

/// coreFlowNet per core id (step.js:2076): the solve's inflow at the vessel's
/// node over its reference, else the carried flow. kg arrives via (x||0).
pub fn core_fn_of(kg: f64, net_ref: f64, fallback: f64) -> f64 {
    if net_ref > 0.0 {
        kg / net_ref
    } else {
        fallback
    }
}

/// Per-core circulation reference. K.netRef is the nominal per-core flow
/// (nomOuts.coreKgBy); the plant P.netRef is the same loop's total, so on a
/// single-core plant both accumulate identically and agree bit-exactly.
/// Multi-core splits need the nominal per-core shares (absent from meta).
pub fn core_net_ref_single(meta: &StepMeta) -> f64 {
    meta.solve.net_ref
}

/// Multi-core split candidate: the plant total shared by commissioned flowK.
pub fn core_net_ref_split(meta: &StepMeta, k: &crate::core::CoreK) -> f64 {
    let tot: f64 = meta.core_ids.iter().map(|id| meta.core_k.get(id.as_str()).map(|k| k.flow_k).unwrap_or(0.0)).sum();
    if tot > 0.0 { meta.solve.net_ref * k.flow_k / tot } else { 0.0 }
}

/// exhOpen (step.js:374): any holed steam-break run past the turbine.
/// P.net.steamBreaks cells are absent from meta, so this answers exactly
/// only while no pipe:/port: damage exists (nothing can be holed then).
pub fn live_exh_open(st: &StepState) -> Option<bool> {
    let any = st
        .sec
        .dmg_parts
        .iter()
        .any(|id| id.starts_with("pipe:") || id.starts_with("port:"));
    if any { None } else { Some(false) }
}

/// roleAlive("turb") (layout.js:508): share of turbine parts not wrecked.
pub fn live_role_turb_alive(meta: &StepMeta, st: &StepState) -> f64 {
    let ids: Vec<&String> = meta
        .room
        .part_roles
        .iter()
        .filter(|(_, r)| r.as_str() == "turb")
        .map(|(id, _)| id)
        .collect();
    if ids.is_empty() {
        return 0.0;
    }
    ids.iter().filter(|id| !part_wrecked(st, id)).count() as f64 / ids.len() as f64
}

/// contRelPart (paint.js:178): release fraction of the part's compartment.
/// Region {bounded, wall, rel} tables are absent from meta (see report), so
/// this stays at the no-release answer the undamaged samples verify.
pub fn live_cont_rel(_meta: &StepMeta, _st: &StepState, _pid: &str) -> f64 {
    1.0
}

/// shellsLive per reliefSecIds (step.js:296): fitting's shells with shut runs
/// cut out. Exact while no port is shut (portDead null → the full list).
pub fn live_shells_live(meta: &StepMeta, st: &StepState, fid: &str) -> Option<Vec<String>> {
    if st.events.port_shut.is_empty() {
        Some(meta.sec.shells_of.get(fid).cloned().unwrap_or_default())
    } else {
        None
    }
}

/// Typed outs bags rebuilt live over the replayed solve (net_read_edges over
/// sout.edge_kg + live wet + frozen tables). Positions follow flowMapsOf:
/// tank/non-hold order, relief fit order, shell first-seen order, core order.
pub struct BatchBags {
    pub q_tank: Vec<f64>,
    pub relief: Vec<f64>,
    pub sg_steam: Vec<f64>,
    pub sg_feed: Vec<f64>,
}

pub fn batchb_outs(meta: &StepMeta, st: &StepState, sout: &SolveOut, tail: &SolveTail) -> BatchBags {
    let fz = &meta.solve;
    let tb = crate::step::solve_tables(fz);
    let mut re: Vec<crate::read::ReadEdge> = Vec::with_capacity(fz.ne);
    for e in 0..fz.ne {
        re.push(crate::read::ReadEdge {
            u: fz.eu[e],
            v: fz.ev[e],
            key: fz.ekey[e],
            meter: fz.meter[e] != 0,
            pair: fz.pair[e],
            tank_u: tb.tank_nodes[fz.eu[e] as usize] != 0,
            tank_v: tb.tank_nodes[fz.ev[e] as usize] != 0,
            tank_id_u: fz.tank_id_of[fz.eu[e] as usize],
            tank_id_v: fz.tank_id_of[fz.ev[e] as usize],
            shell_of: fz.shell_of[e],
            shell_sign_neg: fz.shell_sign[e] != 0,
            sec_u: fz.sec_shell_of[fz.eu[e] as usize],
            sec_v: fz.sec_shell_of[fz.ev[e] as usize],
            is_sgtr: fz.is_sgtr[e] != 0,
            is_break: fz.is_break[e] != 0,
            break_steam: fz.break_steam[e] != 0,
            break_sec: fz.break_sec[e] != 0,
            work: fz.work[e] != 0,
            work_fr: tail.work_fr[e],
            relief: if fz.fit[e] < 0 {
                -1
            } else {
                fz.relief_keys.iter().position(|&k| k == fz.fit[e]).map(|p| p as i32).unwrap_or(-1)
            },
        });
    }
    let n_shell = tb.shell_pos.iter().filter(|&&x| x >= 0).count();
    let n_by = tb.by_pos.iter().filter(|&&x| x >= 0).count();
    let n_sgtr = tb.sgtr_pos.iter().filter(|&&x| x >= 0).count();
    let mut bags = crate::read::OutsBags {
        core_kg: vec![],
        q_tank: vec![0.0; fz.tank_keys.len()],
        sg_steam: vec![0.0; n_shell],
        by: vec![0.0; n_by],
        sg_feed: vec![0.0; n_shell],
        sgtr: vec![0.0; n_sgtr],
        relief: vec![0.0; fz.relief_keys.len()],
        sc: [0.0; 7],
    };
    let mut leg = crate::read::OutsLegacy::default();
    let mut core_tot = 0.0;
    // fixed/anchor feed only the drop span (discarded here); wet gates tank
    // edges exactly like the solve, so it stays live.
    let fh = vec![0u8; fz.n];
    let anchor = vec![-1i32; 1];
    let mut by_loop_leg: Vec<(i32, f64)> = vec![];
    let mut by_drop_leg: Vec<(i32, f64)> = vec![];
    crate::read::net_read_edges(
        &re,
        &sout.p_field_v,
        &sout.edge_kg,
        &fh,
        &anchor,
        &st.solve_carry.fs.wet,
        &tb.in_core,
        &fz.core_of,
        &tb.loop_stab,
        &tb.run_pos,
        &tb.tank_pos,
        &tb.shell_pos,
        &tb.sgtr_pos,
        &tb.relief_pos,
        &tb.by_pos,
        &tb.core_pos,
        None,
        &mut vec![],
        None,
        &mut by_loop_leg,
        &mut by_drop_leg,
        Some(&mut bags),
        &mut leg,
        None,
        &mut core_tot,
    );
    let _ = &anchor;
    BatchBags { q_tank: bags.q_tank, relief: bags.relief, sg_steam: bags.sg_steam, sg_feed: bags.sg_feed }
}

/// Live condFrac (step.js:324): hosted-tank pool share above the flood line.
pub fn live_cond_frac(meta: &StepMeta, curves: &sec::SecCurves, st: &StepState) -> f64 {
    let hosted = sec::batchb_hosted_ids(&meta.sec);
    if hosted.is_empty() {
        return 1.0;
    }
    let (mut c, mut m) = (0.0, 0.0);
    for ti in hosted {
        let k = meta.sec.tank_kg.get(ti).copied().unwrap_or(0.0);
        let tid = meta.sec.tank_ids.get(ti).cloned().unwrap_or_default();
        let lvl = live_tank_lvl(meta, curves, st, &tid);
        c += k;
        m += crate::eos::clamp(lvl, 0.0, 100.0) / 100.0 * k;
    }
    let pct = if c > 0.0 { 100.0 * m / c } else { 0.0 };
    crate::eos::clamp((100.0 - pct) / (100.0 - 90.0), 0.0, 1.0)
}

/// qTank bag labels: tankKeys order is tankNode insertion minus hold tanks
/// (step-gate.js:2409). tankNode inserts in node-name order (pipenet.js:1897:
/// `for nid in index`), so labels are non-hold tank ids sorted by node.
pub fn batchb_q_tank_order(meta: &StepMeta) -> Vec<String> {
    let mut with_node: Vec<(u32, String)> = vec![];
    for (ti, tid) in meta.sec.tank_ids.iter().enumerate() {
        if meta.sec.tanks[ti].hold {
            continue;
        }
        if let Some(node) = meta.sec.tank_node.get(ti).and_then(|s| s.parse::<u32>().ok()) {
            with_node.push((node, tid.clone()));
        }
    }
    with_node.sort_by_key(|(node, _)| *node);
    with_node.into_iter().map(|(_, tid)| tid).collect()
}

/// Relief bag slot per fit id. Net reliefKeys (net.fitIds order, net modes)
/// can hold ghost fits the P/D list lacks, so slots resolve through the
/// dumped relief node: it names the fit's own internal edge's upstream node,
/// whose first edge carrying a fit stab is the fit's. Unrouted (""/"null")
/// or non-relief fits have no slot (outsBag undefined → NaN).
pub fn batchb_relief_slot(meta: &StepMeta, fid: &str) -> Option<usize> {
    let fz = &meta.solve;
    let ti = meta.sec.relief_ids.iter().position(|r| r == fid)?;
    let rnode = meta.sec.relief_node.get(ti)?.as_str();
    if rnode.is_empty() || rnode == "null" {
        return None;
    }
    let idx = meta.sec.net_index.get(rnode).copied()? as u32;
    let e = (0..fz.ne).find(|&e| fz.eu[e] == idx && fz.fit[e] >= 0)?;
    let stab = fz.fit[e];
    fz.relief_keys.iter().position(|&k| k == stab)
}

/// Shell bag labels, assumed flowMapsOf shellKeys order.
pub fn batchb_shell_order(meta: &StepMeta) -> Vec<String> {
    meta.sec.sg_ids.iter().chain(meta.sec.drum_ids.iter()).cloned().collect()
}

/// coreKg bag labels, assumed coreNodes key order.
pub fn batchb_core_order(meta: &StepMeta) -> Vec<String> {
    meta.core_ids.clone()
}
