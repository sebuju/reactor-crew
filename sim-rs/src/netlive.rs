//! Live net predicates, live-signature and piece-cache memo, ported from
//! `src/data/pipenet.js`: `portOpen/portLive/portWrecked`, `reliefLive`,
//! `tankOpen/tankLive` (+`AUTORULE`), `netDrySig/netDiodeSig`,
//! `netLiveSigBuild`, the `netPieces` memo discipline.
//!
//! Deep plant chains arrive pre-evaluated: AUTORULE `sglow`/`plow` read live
//! SG levels and loop pressures owned by later stages, and the diode head
//! `h` is the head stage's answer. Same `CvalIn` pattern as `edge.rs`.
use std::collections::{HashMap, HashSet};

/// Break-cell test (`cellBroken`): `pipe:x,y` damage ids pack as `x*4096+y`.
pub fn cell_broken(dmg: &[String], x: i32, y: i32) -> bool {
    let want = x.wrapping_mul(4096).wrapping_add(y);
    dmg.iter().any(|id| {
        if !id.starts_with("pipe:") {
            return false;
        }
        let rest = &id[5..];
        match rest.split_once(',') {
            Some((a, b)) => match (a.parse::<i32>(), b.parse::<i32>()) {
                (Ok(px), Ok(py)) => px.wrapping_mul(4096).wrapping_add(py) == want,
                _ => false,
            },
            None => false,
        }
    })
}

/// Burst-shell test (`sgOpen`): a burst shell is an opening.
pub fn sg_open(dmg: &[String], sg_burst: &HashMap<String, bool>, id: &str) -> bool {
    sg_burst.get(id).copied().unwrap_or(false) || part_wrecked(dmg, id)
}

/// Operator's drain cocked (`condDumpOpen`): any hosted tank draining.
pub fn cond_dump_open(tank_dump: &HashMap<String, bool>, hosted: &[String]) -> bool {
    hosted.iter().any(|id| tank_dump.get(id).copied().unwrap_or(false))
}

/// One autorule arm (`tankRuleLive`).
pub fn tank_rule_live(auto: &str, bypassed: bool) -> bool {
    auto != "manual" && auto != "always" && !bypassed
}

/// Any armed rule under a pick (`tankRuleAny`).
pub fn tank_rule_any(ids: &[String], auto_of: impl Fn(&str) -> String, pick: impl Fn(&str) -> bool, bypassed: impl Fn(&str) -> bool) -> bool {
    ids.iter().any(|id| pick(id) && tank_rule_live(&auto_of(id), bypassed(id)))
}

/// Secondary tank (`tankSecondary`): connected, but not to the core.
pub fn tank_secondary(circuit: i32, core_circs: &[bool]) -> bool {
    circuit >= 0 && !core_circs.get(circuit as usize).copied().unwrap_or(false)
}

/// Wrecked-part test (`partWrecked`): set membership in the damage list.
pub fn part_wrecked(dmg: &[String], id: &str) -> bool {
    dmg.iter().any(|x| x == id)
}

/// A shut port is an absent edge (`portOpen`).
pub fn port_open(port_shut: &HashSet<String>, pid: &str) -> bool {
    !port_shut.contains(pid)
}

/// A wrecked valve body is an opening (`portLive`).
pub fn port_live(port_shut: &HashSet<String>, dmg: &[String], pid: &str) -> bool {
    port_open(port_shut, pid) || part_wrecked(dmg, &format!("port:{pid}"))
}

/// One door for a relief fitting (`reliefLive`).
pub fn relief_live(
    ref_open: bool,
    open: &HashMap<String, bool>,
    blocked: &HashMap<String, bool>,
    id: &str,
) -> bool {
    (ref_open || open.get(id).copied().unwrap_or(false))
        && !blocked.get(id).copied().unwrap_or(false)
}

/// Operator valve/BYPASS/autorule gate (`tankOpen`). `rule_live` is the
/// pre-evaluated AUTORULE arm (`sglow`/`plow` owners port the arms);
/// `manual`/`always` never consult it, unknown autos read shut.
pub fn tank_open(ref_open: bool, op_open: bool, bypassed: bool, auto: &str, rule_live: bool) -> bool {
    if ref_open || op_open {
        return true;
    }
    if bypassed {
        return false;
    }
    match auto {
        "manual" => false,
        "always" => true,
        "sglow" | "plow" => rule_live,
        _ => false,
    }
}

/// Valve and diode, never the inventory (`tankLive`).
pub fn tank_live(dmg: &[String], id: &str, open: bool) -> bool {
    !part_wrecked(dmg, id) && open
}

/// Hash over the dry nodes (`netDrySig`): wrapping `Math.imul` semantics.
pub fn net_dry_sig(wet: &[u8]) -> i32 {
    let mut h: i32 = 0;
    for (i, &w) in wet.iter().enumerate() {
        if w == 0 {
            h = h.wrapping_mul(31).wrapping_add(i as i32 + 1);
        }
    }
    h
}

/// One diode edge's live inputs for the signature hash.
pub struct DiodeEdge {
    pub u: usize,
    pub v: usize,
    pub diode: f64,
    /// Pre-evaluated `edgeH` (head stage's answer).
    pub h: f64,
}

/// Shut-check-valve hash (`netDiodeSig`): read exactly as `flowG` reads it.
pub fn net_diode_sig(p: &[f64], diodes: &[DiodeEdge]) -> i32 {
    let mut h: i32 = 0;
    for (k, e) in diodes.iter().enumerate() {
        if (p[e.u] - p[e.v] + e.h) * e.diode < 0.0 {
            h = h.wrapping_mul(31).wrapping_add(k as i32 + 1);
        }
    }
    h
}

/// JS `String(number)`: `-0` prints `0`, shortest round-trip otherwise,
/// exponential below 1e-6 / at 1e21 with a signed exponent.
pub fn js_num_str(v: f64, out: &mut String) {
    if v.is_nan() {
        out.push_str("NaN");
    } else if v.is_infinite() {
        out.push_str(if v > 0.0 { "Infinity" } else { "-Infinity" });
    } else if v == 0.0 {
        out.push('0');
    } else if v.abs() >= 1e-6 && v.abs() < 1e21 {
        out.push_str(&format!("{v}"));
    } else {
        let e = format!("{v:e}");
        let (m, x) = e.split_once('e').unwrap_or((&e, "0"));
        out.push_str(m);
        out.push('e');
        if !x.starts_with('-') {
            out.push('+');
        }
        out.push_str(x);
    }
}

/// One fitting's contribution to the sig's fit segment.
pub enum FitSig {
    Relief(bool),
    /// `map_present` is `s.valve !== undefined`; `v` the fid's entry.
    Throttle { map_present: bool, v: Option<f64> },
}

/// Per-vessel break/tube/relief flags in `coreIds()` order.
pub struct CoreFlags {
    pub breach: bool,
    pub tubes_open: f64,
    pub cav_relief: bool,
}

/// Live-signature inputs (`netLiveSigBuild` segment order).
pub struct LiveSigIn<'a> {
    /// Tank bits in sig-list order (tanks with a node).
    pub tank_bits: &'a [bool],
    pub fits: &'a [FitSig],
    pub dmg: &'a [String],
    /// Shut ports in live insertion order, truthy only.
    pub shut: &'a [String],
    pub cores: &'a [CoreFlags],
    pub dry: i32,
    pub diode: i32,
    pub turb_trip: bool,
    pub cond_lost: bool,
    /// `s.load > 0`.
    pub load_pos: bool,
}

/// The whole structural key as one string; any change busts the cache.
pub fn net_live_sig_build(i: &LiveSigIn) -> String {
    let mut tk = String::new();
    for &b in i.tank_bits {
        tk.push(if b { '1' } else { '0' });
    }
    let mut fit = String::new();
    for (k, f) in i.fits.iter().enumerate() {
        if k > 0 {
            fit.push('|');
        }
        match f {
            FitSig::Relief(live) => fit.push(if *live { '1' } else { '0' }),
            FitSig::Throttle { map_present, v } => {
                if !map_present || v.is_none() {
                    fit.push_str("undefined");
                } else {
                    js_num_str(v.unwrap(), &mut fit);
                }
            }
        }
    }
    let mut dmg = String::new();
    for (k, d) in i.dmg.iter().enumerate() {
        if k > 0 {
            dmg.push(',');
        }
        dmg.push_str(d);
    }
    let mut shut = String::new();
    for (k, s) in i.shut.iter().enumerate() {
        if k > 0 {
            shut.push(',');
        }
        shut.push_str(s);
    }
    let mut cor = String::new();
    for c in i.cores {
        if c.breach {
            cor.push('B');
        }
        if c.tubes_open > 0.0 {
            cor.push('T');
        }
        if c.cav_relief {
            cor.push('R');
        }
    }
    let mut s = String::with_capacity(fit.len() + dmg.len() + shut.len() + cor.len() + tk.len() + 32);
    s.push_str(&fit);
    s.push('|');
    s.push_str(&dmg);
    s.push('|');
    s.push_str(&shut);
    s.push('|');
    s.push_str(&cor);
    s.push('|');
    s.push_str(&tk);
    s.push('|');
    s.push_str(&i.dry.to_string());
    s.push('|');
    s.push_str(&i.diode.to_string());
    s.push('|');
    if i.turb_trip {
        s.push('T');
    }
    if i.cond_lost {
        s.push('C');
    }
    if i.load_pos {
        s.push('L');
    }
    s
}

/// Solve-time piece cache (`net.pc`/`net.pcSig`): reuse iff the post-field
/// sig still matches the key, else a fresh BFS over live `g > 0`.
#[derive(Default)]
pub struct PiecesMemo {
    pub of: Vec<i32>,
    pub n: usize,
    pub live: Vec<u8>,
    pub sig: String,
    pub valid: bool,
}

impl PiecesMemo {
    /// Returns true on cache hit (buffers untouched).
    pub fn update(&mut self, sig: &str, n: usize, eu: &[u32], ev: &[u32], g: &[f64]) -> bool {
        if self.valid && self.sig == sig {
            return true;
        }
        let (of, npc, live) = crate::pieces::net_pieces(n, eu, ev, g);
        self.of = of;
        self.n = npc;
        self.live = live;
        self.sig = sig.to_string();
        self.valid = true;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_hash_matches_js() {
        // node: wet=[1,0,1,0,0] -> 2051.
        assert_eq!(net_dry_sig(&[1, 0, 1, 0, 0]), 2051);
        assert_eq!(net_dry_sig(&[1, 1, 1]), 0);
        assert_eq!(net_dry_sig(&[]), 0);
    }

    #[test]
    fn diode_shut_reads_like_flow_g() {
        let p = [1.0, 2.0];
        let shut = [DiodeEdge { u: 0, v: 1, diode: 1.0, h: 0.0 }];
        assert_eq!(net_diode_sig(&p, &shut), 1);
        let open = [DiodeEdge { u: 1, v: 0, diode: 1.0, h: 0.0 }];
        assert_eq!(net_diode_sig(&p, &open), 0);
        // NaN drop never shuts: `< 0` is false.
        let nan = [DiodeEdge { u: 0, v: 1, diode: 1.0, h: f64::NAN }];
        assert_eq!(net_diode_sig(&p, &nan), 0);
    }

    #[test]
    fn num_str_matches_js_string() {
        let mut s = String::new();
        for (v, want) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (0.5, "0.5"),
            (0.1 + 0.2, "0.30000000000000004"),
            (123.456, "123.456"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (2.5e-7, "2.5e-7"),
            (1e21, "1e+21"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
        ] {
            s.clear();
            js_num_str(v, &mut s);
            assert_eq!(s, want, "v={v}");
        }
    }

    #[test]
    fn broke_cells() {
        let dmg = ["pipe:3,7".to_string(), "pump0".to_string(), "pipe:x,y".to_string()];
        assert!(cell_broken(&dmg, 3, 7));
        assert!(!cell_broken(&dmg, 3, 8));
        assert!(!cell_broken(&dmg, 0, 0));
        assert!(!cell_broken(&[], 3, 7));
    }

    #[test]
    fn gates_truth_tables() {
        let shut: HashSet<String> = ["a".to_string()].into_iter().collect();
        assert!(!port_open(&shut, "a"));
        assert!(port_open(&shut, "b"));
        assert!(port_live(&shut, &[], "b"));
        assert!(!port_live(&shut, &[], "a"));
        assert!(port_live(&shut, &["port:a".to_string()], "a"));
        let open: HashMap<String, bool> = [("r".to_string(), true)].into_iter().collect();
        let blocked: HashMap<String, bool> = [("r".to_string(), true)].into_iter().collect();
        assert!(relief_live(false, &open, &HashMap::new(), "r"));
        assert!(relief_live(true, &HashMap::new(), &HashMap::new(), "r"));
        assert!(!relief_live(false, &open, &blocked, "r"));
        assert!(!relief_live(false, &HashMap::new(), &HashMap::new(), "r"));
        assert!(tank_open(true, false, true, "manual", false));
        assert!(tank_open(false, true, false, "manual", false));
        assert!(!tank_open(false, false, true, "always", false));
        assert!(!tank_open(false, false, false, "manual", true));
        assert!(tank_open(false, false, false, "always", false));
        assert!(tank_open(false, false, false, "sglow", true));
        assert!(!tank_open(false, false, false, "plow", false));
        assert!(!tank_open(false, false, false, "exotic", true));
        assert!(tank_live(&[], "t", true));
        assert!(!tank_live(&["t".to_string()], "t", true));
        assert!(!tank_live(&[], "t", false));
    }

    #[test]
    fn sig_build_segment_order() {
        let dmg = vec!["p1".to_string()];
        let shut = vec!["v2".to_string()];
        let cores = [CoreFlags { breach: true, tubes_open: 0.0, cav_relief: true }];
        let fits = [
            FitSig::Relief(true),
            FitSig::Throttle { map_present: true, v: Some(0.5) },
            FitSig::Throttle { map_present: false, v: None },
        ];
        let i = LiveSigIn {
            tank_bits: &[true, false],
            fits: &fits,
            dmg: &dmg,
            shut: &shut,
            cores: &cores,
            dry: 2051,
            diode: 0,
            turb_trip: true,
            cond_lost: false,
            load_pos: true,
        };
        assert_eq!(
            net_live_sig_build(&i),
            "1|0.5|undefined|p1|v2|BR|10|2051|0|TL"
        );
    }

    #[test]
    fn memo_reuses_on_sig_hit() {
        let mut m = PiecesMemo::default();
        let (eu, ev, g) = (vec![0, 1], vec![1, 2], vec![1.0, 0.0]);
        assert!(!m.update("a", 3, &eu, &ev, &g));
        assert_eq!((m.n, m.live.clone()), (2, vec![1, 0]));
        assert!(m.update("a", 3, &eu, &ev, &g));
        assert!(!m.update("b", 3, &eu, &ev, &[1.0, 1.0]));
        assert_eq!(m.live, vec![1, 1]);
    }
}

// ---------------------------------------------------------------------------
// Batch-A live solve-tail readers. Each mirrors a gate capture site
// (tools/step-gate.js:1245-1272 solve tail). Commission statics arrive as
// plain args (slices/maps); the bins convert `TailFrozen`, the engine's
// `sim_freeze` will fill the same shapes natively.
// ---------------------------------------------------------------------------

pub const CP_W: f64 = 5.5;
pub const COND_DT0: f64 = 13.0;
pub const COND_CAP_DP: f64 = 0.001;
pub const CW_RISE: f64 = 10.0;

/// `tankKg` (pipenet.js:1046): volume times fluid density.
pub fn tank_kg(meta: &crate::step::StepMeta, ti: usize) -> f64 {
    let t = &meta.sec.tanks[ti];
    t.vol * crate::sec::fluid_dens(&t.fluid)
}

/// `tankStores` (pipenet.js:1163): a storing vessel outside the field.
pub fn tank_stores(meta: &crate::step::StepMeta, ti: usize) -> bool {
    let t = &meta.sec.tanks[ti];
    if t.hold || t.inf || t.gas_p0.is_none() {
        return false;
    }
    t.vol * crate::eos::js_max(0.0, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0) > 0.0
}

/// `tankCapAt` (pipenet.js:1165): kg per MPa of the gas space filling up.
pub fn tank_cap_at(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    ti: usize,
    tank_p: f64,
) -> f64 {
    if !tank_stores(meta, ti) {
        return 0.0;
    }
    let tid = &meta.sec.tank_ids[ti];
    let region = crate::live::live_region_p_at(meta, st, meta.sec.part_of.get(tid).copied());
    let p = crate::eos::js_max(tank_p, region);
    let t = &meta.sec.tanks[ti];
    let vf = crate::eos::js_max(0.0, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0);
    tank_kg(meta, ti) * vf * t.gas_p0.unwrap_or(0.0) / (p * p)
}

/// `holdPOf` (pipenet.js:2151): operator hold pressure else loop pressure.
pub fn hold_p_of(meta: &crate::step::StepMeta, st: &crate::step::StepState, tid: &str, ci: i32) -> f64 {
    if let Some(v) = st.sec.maps.get("holdPBy").and_then(|m| m.get(tid)) {
        return v;
    }
    crate::live::loop_p(meta, st, ci)
}

/// Gate tank-node order (`for id in net.tankNode` = node-index order):
/// (node, tank-index) for every tank standing on a node.
pub fn tank_node_order(meta: &crate::step::StepMeta) -> Vec<(u32, usize)> {
    let mut v: Vec<(u32, usize)> = vec![];
    for (ti, _) in meta.sec.tank_ids.iter().enumerate() {
        if let Some(n) = meta.sec.tank_node.get(ti).and_then(|s| s.parse::<u32>().ok()) {
            v.push((n, ti));
        }
    }
    v.sort();
    v
}

/// Hold-live per tank index: holds read the hold vector, others are false.
pub fn hold_live_for(meta: &crate::step::StepMeta, hold_live: &[bool], ti: usize) -> bool {
    if !meta.sec.tanks[ti].hold {
        return false;
    }
    meta.sec
        .hold_tank_ids
        .iter()
        .position(|&h| h == ti)
        .and_then(|p| hold_live.get(p).copied())
        .unwrap_or(false)
}

/// `tail.holdPins`: holdTankIds order, `[tankNode, holdPOf]`.
pub fn live_hold_pins(meta: &crate::step::StepMeta, st: &crate::step::StepState) -> Vec<(u32, f64)> {
    let mut out = vec![];
    for &ti in &meta.sec.hold_tank_ids {
        let node: u32 = match meta.sec.tank_node.get(ti).and_then(|s| s.parse().ok()) {
            Some(n) => n,
            None => continue,
        };
        let tid = &meta.sec.tank_ids[ti];
        out.push((node, hold_p_of(meta, st, tid, meta.sec.tanks[ti].circuit)));
    }
    out
}

/// `tail.drumPins`: drum_ids order, `[tankNode, holdSetP(circuit)]`.
pub fn live_drum_pins(meta: &crate::step::StepMeta, sugg: &[f64]) -> Vec<(u32, f64)> {
    let mut out = vec![];
    for tid in &meta.sec.drum_ids {
        let ti = match meta.sec.tank_ids.iter().position(|t| t == tid) {
            Some(i) => i,
            None => continue,
        };
        let node: u32 = match meta.sec.tank_node.get(ti).and_then(|s| s.parse().ok()) {
            Some(n) => n,
            None => continue,
        };
        out.push((node, crate::live::hold_set_p(meta, meta.sec.tanks[ti].circuit, sugg)));
    }
    out
}

/// `tail.tankPins`: node order, non-hold non-field non-storing tanks.
pub fn live_tank_pins(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    hold_live: &[bool],
) -> Vec<(u32, f64)> {
    let mut out = vec![];
    for (n, ti) in tank_node_order(meta) {
        let t = &meta.sec.tanks[ti];
        if t.hold || t.in_field || tank_stores(meta, ti) {
            continue;
        }
        let tid = &meta.sec.tank_ids[ti];
        out.push((n, crate::live::live_tank_p(meta, curves, st, tid, hold_live_for(meta, hold_live, ti))));
    }
    out
}

/// `tail.tank_rows` (solve_tick §6 store order): `fz.tank_order` order,
/// `(tankCapAt, tankP)` per standing tank.
pub fn live_tank_rows(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    tank_order: &[u32],
    hold_live: &[bool],
) -> Vec<(f64, f64)> {
    let mut rev = HashMap::new();
    for (n, ti) in tank_node_order(meta) {
        rev.insert(n, ti);
    }
    tank_order
        .iter()
        .map(|&node| {
            match rev.get(&node).copied() {
                // Loud on coverage drift: the compare names the node.
                None => (0.0, 0.0),
                Some(ti) => {
                    let tid = meta.sec.tank_ids.get(ti).map(|s| s.as_str()).unwrap_or("");
                    let p = crate::live::live_tank_p(meta, curves, st, tid, hold_live_for(meta, hold_live, ti));
                    (tank_cap_at(meta, st, ti, p), p)
                }
            }
        })
        .collect()
}

/// `secP` by part id for the secT shell set (all SGs in the corpus).
pub fn live_sec_p_id(meta: &crate::step::StepMeta, st: &crate::step::StepState, pid: &str) -> f64 {
    match meta.sec.sg_ids.iter().position(|s| s == pid) {
        Some(si) => crate::live::sec_sec_p(meta, st, si),
        None => panic!("live_sec_p_id: non-sg secT part {pid}"),
    }
}

/// `tail.secPins`: sidecar secT order, `[node, secP(part)]`.
pub fn live_sec_pins(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    sec_t: &[(u32, String)],
) -> Vec<(u32, f64)> {
    sec_t.iter().map(|(n, pid)| (*n, live_sec_p_id(meta, st, pid))).collect()
}

/// `condVacuum` (pipenet.js:949): a ves node outside the core graph.
pub fn cond_vacuum(meta: &crate::step::StepMeta, id: &str) -> bool {
    let pos = match meta.sec.cond_ids.iter().position(|c| c == id) {
        Some(p) => p,
        None => return false,
    };
    let nm = match meta.sec.cond_ves_node.get(pos) {
        Some(n) if !n.is_empty() => n,
        _ => return false,
    };
    match meta.sec.net_index.get(nm) {
        Some(&i) => !meta.sec.in_core_node.get(i).copied().unwrap_or(false),
        None => false,
    }
}

/// `tail.condPins`: condV order filtered by vacuum, `[node, condP]`.
pub fn live_cond_pins(
    meta: &crate::step::StepMeta,
    cond_p: f64,
    cond_v: &[u32],
    cond_parts: &[String],
) -> Vec<(u32, f64)> {
    cond_v
        .iter()
        .zip(cond_parts.iter())
        .filter(|(_, id)| cond_vacuum(meta, id))
        .map(|(&n, _)| (n, cond_p))
        .collect()
}

/// Condenser ves-node index by part id.
fn cond_node(meta: &crate::step::StepMeta, id: &str) -> Option<usize> {
    let pos = meta.sec.cond_ids.iter().position(|c| c == id)?;
    let nm = meta.sec.cond_ves_node.get(pos)?;
    if nm.is_empty() {
        return None;
    }
    meta.sec.net_index.get(nm).copied()
}

/// `condTOf`: the pot's own K, else nothing.
fn cond_t_of(st: &crate::step::StepState, id: &str) -> Option<f64> {
    st.sec.maps.get("condTBy").and_then(|m| m.get(id))
}

/// `cwInAt`: inlet water K, design sink before the first tick.
fn cw_in_at(st: &crate::step::StepState, id: &str) -> f64 {
    st.sec
        .maps
        .get("cwInTBy")
        .and_then(|m| m.get(id))
        .unwrap_or(crate::sec::RAD_TDES)
}

/// `condTAt`: pot reading else arriving water.
pub fn cond_t_at(st: &crate::step::StepState, id: &str) -> f64 {
    cond_t_of(st, id).unwrap_or_else(|| cw_in_at(st, id))
}

/// `cwKOf`: this machine's circulating water against its commissioning ref.
fn cw_k_of(st: &crate::step::StepState, cw_ref: &HashMap<String, f64>, id: &str) -> f64 {
    let r = cw_ref.get(id).copied().unwrap_or(0.0);
    if !(r > 0.0) {
        return 0.0;
    }
    let f = st.sec.maps.get("cwFlowBy").and_then(|m| m.get(id)).unwrap_or(r);
    crate::eos::clamp(f / r, 0.0, 2.0)
}

/// `cwCOf`: kW/K of circulating water.
fn cw_c_of(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    cond_ua: &HashMap<String, f64>,
    cw_ref: &HashMap<String, f64>,
    id: &str,
) -> f64 {
    let ua = cond_ua.get(id).copied().unwrap_or(0.0);
    ua / (COND_DT0 / (COND_DT0 - CW_RISE)).ln() * cw_k_of(st, cw_ref, id)
}

/// `condKOf`: bought capacity less breakage less drowning.
fn cond_k_of(_meta: &crate::step::StepMeta, st: &crate::step::StepState, cond_frac: f64, id: &str) -> f64 {
    if part_wrecked(&st.sec.dmg_parts, id) {
        0.0
    } else {
        cond_frac
    }
}

/// `condRejOf`: kW the tubes are rejecting.
pub fn cond_rej_of(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    cond_ua: &HashMap<String, f64>,
    cw_ref: &HashMap<String, f64>,
    cond_frac: f64,
    id: &str,
) -> f64 {
    let c = cw_c_of(meta, st, cond_ua, cw_ref, id);
    if !(c > 0.0) {
        return 0.0;
    }
    let ua = cond_ua.get(id).copied().unwrap_or(0.0);
    let cold = cw_in_at(st, id);
    let t = cond_t_of(st, id).unwrap_or(cold);
    (c * (1.0 - (-ua * cond_k_of(meta, st, cond_frac, id) / c).exp()) * (t - cold)).max(0.0)
}

/// `condSatP`: saturation at the pot temperature, floored at COND_P0.
/// NOTE: the caller omits the circuit (`psatSec(T)`), so this is always
/// the water curve, never the circuit's (pipenet.js:454 + :839).
pub fn cond_sat_p(meta: &crate::step::StepMeta, curves: &crate::sec::SecCurves, st: &crate::step::StepState, id: &str) -> f64 {
    crate::eos::js_max(crate::sec::COND_P0, crate::eos::sat_p(&curves.water, cond_t_at(st, id)))
}

/// Circuit of a condenser's vessel.
fn cond_circ(meta: &crate::step::StepMeta, id: &str) -> i32 {
    cond_node(meta, id)
        .and_then(|i| meta.sec.circ_of_node.get(i).copied())
        .unwrap_or(-1)
}

/// `condLvl`: pool % else the commissioning fill.
fn cond_lvl(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    id: &str,
) -> f64 {
    let pos = meta.sec.cond_ids.iter().position(|c| c == id).unwrap_or(usize::MAX);
    let node = meta.solve.cond_v.get(pos).copied().unwrap_or(u32::MAX) as usize;
    if node != u32::MAX as usize {
        if let Some(l) = crate::live::pool_lvl_of(meta, curves, st, node) {
            return l;
        }
    }
    cond_fill0(meta)
}

/// `condFill0`: volume-weighted hosted fill, 50 absent.
fn cond_fill0(meta: &crate::step::StepMeta) -> f64 {
    let mut v = 0.0;
    let mut f = 0.0;
    for (ti, t) in meta.sec.tanks.iter().enumerate() {
        if t.cell {
            continue;
        }
        let _ = ti;
        v += t.vol;
        f += t.vol * t.level;
    }
    if v > 0.0 { f / v } else { 50.0 }
}

/// `condSteamVol`: vapour space over the pool.
fn cond_steam_vol(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    id: &str,
) -> f64 {
    let v = cond_node(meta, id).and_then(|i| meta.solve.vol.get(i).copied()).unwrap_or(0.1);
    (v * (1.0 - crate::eos::clamp(cond_lvl(meta, curves, st, id), 0.0, 100.0) / 100.0)).max(0.1)
}

/// `condCapAt`: kg per MPa of the space filling up, by difference.
fn cond_cap_at(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    id: &str,
    p: f64,
) -> f64 {
    let ci = cond_circ(meta, id);
    let c = curves.of(ci);
    let r0 = crate::eos::rhog_of(c, crate::eos::sat_t(c, p));
    let r1 = crate::eos::rhog_of(c, crate::eos::sat_t(c, p + COND_CAP_DP));
    (cond_steam_vol(meta, curves, st, id) * (r1 - r0) / COND_CAP_DP).max(1e-9)
}

/// `condStoreC` (step.js:461): compliance of the space + pool + steel.
pub fn cond_store_c(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    mass_kg: f64,
    id: &str,
) -> f64 {
    let ci = cond_circ(meta, id);
    let c = curves.of(ci);
    let p = cond_sat_p(meta, curves, st, id);
    // hfgOfCirc(ci,p) = hfgOf(c, satT(c,p)): temperature, not pressure.
    let hfg = crate::eos::hfg_of(c, crate::eos::sat_t(c, p)).max(1.0);
    let dtdp = ((crate::eos::sat_t(c, p + COND_CAP_DP) - crate::eos::sat_t(c, p)) / COND_CAP_DP).max(1e-6);
    let mw = cond_node(meta, id)
        .and_then(|i| st.m_by.has.get(i).copied())
        .unwrap_or(0)
        != 0;
    let mw_kg = if mw {
        cond_node(meta, id).and_then(|i| st.m_by.v.get(i).copied()).unwrap_or(0.0)
    } else {
        0.0
    };
    cond_cap_at(meta, curves, st, id, p) + (mw_kg * CP_W + mass_kg * 1000.0 * crate::sec::CP_STEEL) * dtdp / hfg
}

/// `condStoreW` (step.js:467): vapour condensed without crossing an edge.
pub fn cond_store_w(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    cond_ua: &HashMap<String, f64>,
    cw_ref: &HashMap<String, f64>,
    cond_frac: f64,
    id: &str,
) -> f64 {
    let ci = cond_circ(meta, id);
    let c = curves.of(ci);
    let p = cond_sat_p(meta, curves, st, id);
    -cond_rej_of(meta, st, cond_ua, cw_ref, cond_frac, id)
        / crate::eos::hfg_of(c, crate::eos::sat_t(c, p)).max(1.0)
}

/// `tail.cond_rows` (solve_tick §6 store order): condV order,
/// `(storeC, storeW, satP, wrecked, vacuum)` per condenser.
pub fn live_cond_rows(
    meta: &crate::step::StepMeta,
    curves: &crate::sec::SecCurves,
    st: &crate::step::StepState,
    cond_v: &[u32],
    cond_parts: &[String],
    cond_ua: &HashMap<String, f64>,
    cond_mass: &HashMap<String, f64>,
    cw_ref: &HashMap<String, f64>,
    cond_frac: f64,
) -> Vec<(f64, f64, f64, bool, bool)> {
    let _ = cond_v;
    cond_parts
        .iter()
        .map(|id| {
            (
                cond_store_c(meta, curves, st, cond_mass.get(id).copied().unwrap_or(0.0), id),
                cond_store_w(meta, curves, st, cond_ua, cw_ref, cond_frac, id),
                cond_sat_p(meta, curves, st, id),
                part_wrecked(&st.sec.dmg_parts, id),
                cond_vacuum(meta, id),
            )
        })
        .collect()
}

/// Region means over the live room grid; one pass, shared by every cell
/// read of the same tick.
pub fn region_means(meta: &crate::step::StepMeta, st: &crate::step::StepState) -> Vec<f64> {
    let room_p = st.sec.bags.get("roomP").map(|b| b.v.as_slice()).unwrap_or(&[]);
    crate::tick::region_p_mean(&meta.sec.region_of, room_p, meta.sec.n_regions)
}

/// Room-mean pressure at an explicit cell (`regionP`).
pub fn region_p_at_xy(meta: &crate::step::StepMeta, st: &crate::step::StepState, x: i32, y: i32) -> f64 {
    region_p_at_means(meta, &region_means(meta, st), x, y)
}

fn region_p_at_means(meta: &crate::step::StepMeta, means: &[f64], x: i32, y: i32) -> f64 {
    crate::tick::region_p(&meta.sec.region_of, means, meta.sec.pcont, meta.sec.gw, meta.sec.gh, x, y)
}

/// `netPcont` (pipenet.js:2165): containment cell, machine center, ship.
pub fn net_pcont_live(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    i: usize,
    cont_cell: &HashMap<usize, (i32, i32)>,
    part_of_node: &HashMap<usize, String>,
) -> f64 {
    net_pcont_means(meta, &region_means(meta, st), i, cont_cell, part_of_node)
}

fn net_pcont_means(
    meta: &crate::step::StepMeta,
    means: &[f64],
    i: usize,
    cont_cell: &HashMap<usize, (i32, i32)>,
    part_of_node: &HashMap<usize, String>,
) -> f64 {
    if let Some((x, y)) = cont_cell.get(&i) {
        return region_p_at_means(meta, means, *x, *y);
    }
    if let Some(pid) = part_of_node.get(&i) {
        if let Some(pi) = meta.sec.part_of.get(pid).and_then(|pi| meta.sec.parts.get(*pi)) {
            return region_p_at_means(meta, means, pi.x + pi.w / 2, pi.y + pi.h / 2);
        }
    }
    meta.sec.pcont
}

/// `tail.cont` pairs in gate `net.cont` order: (node, pcont).
pub fn live_cont_pairs(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    cont_order: &[u32],
    cont_cell: &HashMap<usize, (i32, i32)>,
    part_of_node: &HashMap<usize, String>,
) -> Vec<(u32, f64)> {
    let means = region_means(meta, st);
    cont_order
        .iter()
        .map(|&n| (n, net_pcont_means(meta, &means, n as usize, cont_cell, part_of_node)))
        .collect()
}

/// `tail.contP`: per-node containment pressure over all nodes.
pub fn live_cont_p(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    cont_cell: &HashMap<usize, (i32, i32)>,
    part_of_node: &HashMap<usize, String>,
) -> Vec<f64> {
    let means = region_means(meta, st);
    (0..meta.solve.n).map(|i| net_pcont_means(meta, &means, i, cont_cell, part_of_node)).collect()
}

/// `inLoop` (pipenet.js:1118) over frozen loop sets + run ends.
pub fn in_loop_live(
    loop_nodes: &HashMap<i32, Option<Vec<String>>>,
    fold_map: &HashMap<String, String>,
    node_run_key: &HashMap<String, String>,
    run_ends: &HashMap<String, (String, String)>,
    ci: i32,
    nm: &str,
) -> bool {
    let set = match loop_nodes.get(&ci) {
        Some(Some(s)) => s,
        _ => return true,
    };
    match node_run_key.get(nm) {
        None => set.iter().any(|n| n == nm),
        Some(rk) => match run_ends.get(rk) {
            None => false,
            Some((a, b)) => {
                let fa = fold_map.get(a).map(|s| s.as_str()).unwrap_or(a.as_str());
                let fb = fold_map.get(b).map(|s| s.as_str()).unwrap_or(b.as_str());
                set.iter().any(|n| n == fa) && set.iter().any(|n| n == fb)
            }
        },
    }
}

/// `netFixSetSig` generation (pipenet.js:2324): bumps when the mask moves.
#[derive(Default)]
pub struct FixGen {
    pub mask: Vec<u8>,
    pub gen: u64,
}

impl FixGen {
    pub fn update(&mut self, fh: &[u8]) -> u64 {
        if self.mask.len() != fh.len() {
            self.mask = fh.to_vec();
            self.gen += 1;
            return self.gen;
        }
        for i in 0..fh.len() {
            if self.mask[i] != fh[i] {
                self.mask = fh.to_vec();
                self.gen += 1;
                return self.gen;
            }
        }
        self.gen
    }
}

/// AfTopo divergence key (pipenet.js:2451-2457): live sig, pumps scale,
/// fixed-set generation.
pub fn div_topo_live(sig: &str, flow_scale: f64, fix_gen: u64) -> String {
    format!("{sig}|N{flow_scale}|{fix_gen}")
}

/// `exhOpen` (step.js:374) over frozen steam breaks: any exhaust run with
/// a holed cell. Port-wreck ends are absent from the break rows (undefined
/// reads false), so cells decide.
pub fn exh_open_live(steam_breaks: &[(Vec<(i32, i32)>, bool)], dmg: &[String]) -> bool {
    steam_breaks.iter().any(|(cells, exh)| {
        *exh && cells.iter().any(|(x, y)| cell_broken(dmg, *x, *y))
    })
}

/// `netBounds` storing set (pipenet.js:2060): storing vessels outside the
/// field pin at marker 0.
pub fn bounds_storing(meta: &crate::step::StepMeta) -> Vec<u32> {
    let mut storing: Vec<u32> = vec![];
    for (ti, _) in meta.sec.tank_ids.iter().enumerate() {
        let t = &meta.sec.tanks[ti];
        let gas_v0 = t.vol * crate::eos::js_max(0.0, (100.0 - crate::eos::clamp(t.level, 0.0, 100.0)) / 100.0);
        if !t.hold && !t.inf && t.gas_p0.is_some() && gas_v0 > 0.0 && !t.in_field {
            if let Some(nm) = meta.sec.tank_node.get(ti) {
                if let Some(&i) = meta.sec.net_index.get(nm) {
                    storing.push(i as u32);
                }
            }
        }
    }
    storing
}

/// Fixed set over explicit pins + storing bounds. `store_held=false` at
/// tail captures (hold/drum/sec/cond classes skipped); true inside natCirc.
#[allow(clippy::too_many_arguments)]
pub fn fixed_capture(
    meta: &crate::step::StepMeta,
    st: &crate::step::StepState,
    cont: &[(u32, f64)],
    hold_pins: &[(u32, f64)],
    drum_pins: &[(u32, f64)],
    tank_pins: &[(u32, f64)],
    sec_pins: &[(u32, f64)],
    cond_pins: &[(u32, f64)],
    store_held: bool,
) -> (Vec<f64>, Vec<u8>) {
    let n = meta.solve.n;
    let (mut fv, mut fh) = crate::pieces::fixed_fill(
        n, &st.solve_carry.fix_v, &[], &[],
        cont, store_held, hold_pins, drum_pins, tank_pins, sec_pins, cond_pins,
    );
    crate::pieces::bounds_fill(&mut fv, &mut fh, &bounds_storing(meta));
    (fv, fh)
}

/// `holdLive` per holdTankIds over explicit pieces + fixed mask.
pub fn hold_live_circuits(
    meta: &crate::step::StepMeta,
    adj: &[Vec<u32>],
    live: &[u8],
    fh: &[u8],
) -> Vec<bool> {
    let fz = &meta.solve;
    meta.sec
        .hold_tank_ids
        .iter()
        .map(|&ti| {
            let ci = meta.sec.tanks[ti].circuit;
            let h0 = meta.sec.tank_ids.iter().enumerate().find(|(j, _)| {
                meta.sec.tanks[*j].hold && meta.sec.tanks[*j].circuit == ci
            });
            match h0
                .and_then(|(j, _)| meta.sec.tank_node.get(j))
                .and_then(|s| s.parse::<u32>().ok())
            {
                None => false,
                Some(s) => crate::pieces::hold_live(fz.n, adj, live, &fz.eu, &fz.ev, s, fh),
            }
        })
        .collect()
}

/// Adjacency over the live edges (netPieces adj half, shared with the
/// piece-cache memo which stores only of/n/live).
pub fn adj_from_live(n: usize, eu: &[u32], ev: &[u32], live: &[u8]) -> Vec<Vec<u32>> {
    let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
    for (e, &lv) in live.iter().enumerate() {
        if lv == 0 {
            continue;
        }
        let (a, b) = (eu[e], ev[e]);
        adj[a as usize].push(b);
        adj[b as usize].push(a);
    }
    adj
}

/// Commission-frozen containment regions (`tailRegions` sidecar):
/// per-cell region rows, tight-cell mask, bounded regions with wall/rel.
#[derive(Default)]
pub struct MatRegions {
    pub of: Vec<i32>,
    pub tight: Vec<u8>,
    pub regions: Vec<MatRegion>,
}

#[derive(Default)]
pub struct MatRegion {
    pub bounded: bool,
    pub wall: Vec<u32>,
    pub rel: f64,
}

/// `matWall`: a tight cell walls.
fn mat_wall(reg: &MatRegions, gw: usize, gh: usize, x: i32, y: i32) -> bool {
    if x < 0 || y < 0 || x >= gw as i32 || y >= gh as i32 {
        return false;
    }
    reg.tight.get((y as usize) * gw + x as usize).copied().unwrap_or(0) != 0
}

/// Bounded region at a cell (`matRegionAt`), else none.
fn mat_region_at(reg: &MatRegions, gw: usize, gh: usize, x: i32, y: i32) -> Option<usize> {
    if x < 0 || y < 0 || x >= gw as i32 || y >= gh as i32 {
        return None;
    }
    let r = reg.of.get((y as usize) * gw + x as usize).copied().unwrap_or(-1);
    if r < 0 {
        return None;
    }
    reg.regions.get(r as usize).filter(|g| g.bounded).map(|_| r as usize)
}

/// A holed wall unseals its region (`matHoles` + `matSealed`): mat damage
/// ids on tight cells, paired across neighboring regions.
fn mat_sealed(reg: &MatRegions, gw: usize, gh: usize, dmg: &[String], idx: usize) -> bool {
    for id in dmg {
        if !id.starts_with("mat:") {
            continue;
        }
        let rest = &id[4..];
        let (xs, ys) = match rest.split_once(',') {
            Some(v) => v,
            None => continue,
        };
        let (x, y): (i32, i32) = match (xs.parse(), ys.parse()) {
            (Ok(a), Ok(b)) => (a, b),
            _ => continue,
        };
        if !mat_wall(reg, gw, gh, x, y) {
            continue;
        }
        let mut seen: Vec<usize> = vec![];
        for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
            if nx < 0 || ny < 0 || nx >= gw as i32 || ny >= gh as i32 {
                continue;
            }
            let r = reg.of.get((ny as usize) * gw + nx as usize).copied().unwrap_or(-1);
            if r >= 0 && !seen.contains(&(r as usize)) {
                seen.push(r as usize);
            }
        }
        for a in 0..seen.len() {
            for b in (a + 1)..seen.len() {
                if seen[a] == idx || seen[b] == idx {
                    return false;
                }
            }
        }
    }
    true
}

/// `contRelPart` (paint.js:178): release share past the part's own wall —
/// 1 outside containment, past an open wall, or with no wall at all.
pub fn cont_rel_live(
    reg: &MatRegions,
    dmg: &[String],
    gw: usize,
    gh: usize,
    part_x: Option<i32>,
    part_y: Option<i32>,
) -> f64 {
    let (x, y) = match (part_x, part_y) {
        (Some(a), Some(b)) => (a, b),
        _ => return 1.0,
    };
    match mat_region_at(reg, gw, gh, x, y) {
        None => 1.0,
        Some(ri) => {
            let g = &reg.regions[ri];
            if g.wall.is_empty() || !mat_sealed(reg, gw, gh, dmg, ri) {
                1.0
            } else {
                g.rel
            }
        }
    }
}

/// `netDryParts` (pipenet.js:537): part ids with a dry unbooked non-vapour
/// node. Tanks and booked nodes are out; a steam space never runs dry.
/// `nodes` preserves gate insertion order.
pub fn dry_parts_live(
    meta: &crate::step::StepMeta,
    fs_wet: &[u8],
    nodes: &[(String, Vec<u32>)],
) -> Vec<String> {
    let mut out = vec![];
    for (id, list) in nodes {
        if meta.sec.tank_ids.iter().any(|t| t == id) {
            continue;
        }
        for &i in list {
            let wet = fs_wet.get(i as usize).copied().unwrap_or(0) != 0;
            let booked = meta.sec.net_booked.get(i as usize).copied().unwrap_or(0) != 0;
            let vapour = meta.sec.net_vapour.get(i as usize).copied().unwrap_or(0) != 0;
            if !wet && !booked && !vapour {
                out.push(id.clone());
                break;
            }
        }
    }
    out
}

/// Governor work share (`turbWorkFrac`, step.js:2147).
pub fn turb_work_frac_of(work: f64, dump: f64) -> f64 {
    let t = work + dump;
    if t > 0.0 { work.max(0.0) / t } else { 0.0 }
}
