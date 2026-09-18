//! Shared scaffolding for the `sig-probe`/`q-probe` harnesses (bins only,
//! never shipped): mini JSON, the edge-frozen table, post-ctl snapshot via
//! the ported `act_follow`, and the tank-open arms. Live-engine owns the
//! real arms later; both probes converge onto it then.
use sim_rs::frozen::{SteamBreak, TailFrozen};
use sim_rs::netlive::MatRegion;
use sim_rs::sec;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub enum J {
    N(f64),
    S(String),
    A(Vec<J>),
    O(HashMap<String, J>),
}

pub fn jparse(s: &str) -> J {
    let b = s.as_bytes();
    let mut o = 0usize;
    jval(b, &mut o)
}

fn jws(b: &[u8], o: &mut usize) {
    while *o < b.len() && (b[*o] == b' ' || b[*o] == b'\t' || b[*o] == b'\n' || b[*o] == b'\r') {
        *o += 1;
    }
}

fn jval(b: &[u8], o: &mut usize) -> J {
    jws(b, o);
    match b[*o] {
        b'{' => {
            *o += 1;
            let mut m = HashMap::new();
            jws(b, o);
            if b[*o] == b'}' {
                *o += 1;
                return J::O(m);
            }
            loop {
                jws(b, o);
                assert_eq!(b[*o], b'"', "obj key");
                let k = jstr(b, o);
                jws(b, o);
                assert_eq!(b[*o], b':', "colon");
                *o += 1;
                m.insert(k, jval(b, o));
                jws(b, o);
                if b[*o] == b',' {
                    *o += 1;
                    continue;
                }
                assert_eq!(b[*o], b'}', "obj end");
                *o += 1;
                break;
            }
            J::O(m)
        }
        b'[' => {
            *o += 1;
            let mut v = vec![];
            jws(b, o);
            if b[*o] == b']' {
                *o += 1;
                return J::A(v);
            }
            loop {
                v.push(jval(b, o));
                jws(b, o);
                if b[*o] == b',' {
                    *o += 1;
                    continue;
                }
                assert_eq!(b[*o], b']', "arr end");
                *o += 1;
                break;
            }
            J::A(v)
        }
        b'"' => J::S(jstr(b, o)),
        _ => {
            let s = *o;
            while *o < b.len() && !b" \t\n\r,]}".contains(&b[*o]) {
                *o += 1;
            }
            let t = std::str::from_utf8(&b[s..*o]).unwrap_or("NaN");
            match t {
                "true" => J::N(1.0),
                "false" => J::N(0.0),
                "null" => J::N(f64::NAN),
                _ => J::N(t.parse().unwrap_or(f64::NAN)),
            }
        }
    }
}

fn jstr(b: &[u8], o: &mut usize) -> String {
    assert_eq!(b[*o], b'"');
    *o += 1;
    let mut s = String::new();
    while b[*o] != b'"' {
        if b[*o] == b'\\' {
            *o += 1;
            s.push(b[*o] as char);
        } else {
            s.push(b[*o] as char);
        }
        *o += 1;
    }
    *o += 1;
    s
}

pub fn jstrs(j: &J) -> Vec<String> {
    match j {
        J::A(v) => v.iter().map(|x| match x {
            J::S(s) => s.clone(),
            J::N(n) => format!("{n}"),
            _ => "?".to_string(),
        }).collect(),
        _ => vec![],
    }
}

pub fn jget<'a>(m: &'a HashMap<String, J>, k: &str) -> &'a J {
    m.get(k).unwrap_or(&J::N(f64::NAN))
}

pub fn jstr_opt(j: &J) -> Option<String> {
    match j {
        J::S(s) => Some(s.clone()),
        _ => None,
    }
}

pub fn jnum_opt(j: &J) -> Option<f64> {
    match j {
        J::N(n) if !n.is_nan() => Some(*n),
        _ => None,
    }
}

fn jarr<'a>(j: &'a J) -> &'a [J] {
    match j {
        J::A(v) => v,
        _ => &[],
    }
}

fn jmap<'a>(j: &'a J) -> HashMap<String, &'a J> {
    match j {
        J::O(m) => m.iter().map(|(k, v)| (k.clone(), v)).collect(),
        _ => HashMap::new(),
    }
}

fn jnum(j: &J) -> f64 {
    match j {
        J::N(n) => *n,
        _ => f64::NAN,
    }
}

/// Parse `tail-frozen.json` ({presets:[...]}) into per-preset statics.
pub fn parse_tail_frozen(s: &str) -> Vec<TailFrozen> {
    let parsed = jparse(s);
    let root = jmap(&parsed);
    let presets: Vec<J> = match root.get("presets") {
        Some(J::A(v)) => v.clone(),
        _ => vec![],
    };
    let mut out = Vec::with_capacity(presets.len());
    for p in &presets {
        let m = jmap(p);
        let missing = J::N(f64::NAN);
        let get = |k: &str| -> &J { m.get(k).copied().unwrap_or(&missing) };
        let mut tf = TailFrozen::default();
        for (k, v) in jmap(get("contCell")) {
            if let (Ok(i), J::A(xy)) = (k.parse::<usize>(), v) {
                if xy.len() == 2 {
                    tf.cont_cell.insert(i, (jnum(&xy[0]) as i32, jnum(&xy[1]) as i32));
                }
            }
        }
        for (k, v) in jmap(get("partOfNode")) {
            if let (Ok(i), Some(pid)) = (k.parse::<usize>(), jstr_opt(v)) {
                tf.part_of_node.insert(i, pid);
            }
        }
        let sec_t = jmap(get("secT"));
        tf.sec_t = jarr(sec_t.get("t").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j) as u32).collect();
        tf.sec_t_parts = jarr(sec_t.get("parts").copied().unwrap_or(&J::N(f64::NAN))).iter().filter_map(jstr_opt).collect();
        tf.cond_parts = jarr(get("condParts")).iter().filter_map(jstr_opt).collect();
        for (k, v) in jmap(get("tankIdByNode")) {
            if let (Ok(i), Some(tid)) = (k.parse::<usize>(), jstr_opt(v)) {
                tf.tank_id_by_node.insert(i, tid);
            }
        }
        for (k, v) in jmap(get("loopNodes")) {
            if let Ok(ci) = k.parse::<i32>() {
                tf.loop_nodes.insert(ci, match v {
                    J::A(ns) => Some(ns.iter().filter_map(jstr_opt).collect()),
                    _ => None,
                });
            }
        }
        for b in jarr(get("steamBreaks")) {
            let bm = jmap(b);
            let mut sb = SteamBreak::default();
            sb.exh = jnum(bm.get("exh").copied().unwrap_or(&J::N(0.0))) != 0.0;
            for c in jarr(bm.get("cells").copied().unwrap_or(&J::N(f64::NAN))) {
                if let J::A(xy) = c {
                    if xy.len() == 2 {
                        sb.cells.push((jnum(&xy[0]) as i32, jnum(&xy[1]) as i32));
                    }
                }
            }
            tf.steam_breaks.push(sb);
        }
        let reg = jmap(get("regions"));
        tf.regions.of = jarr(reg.get("of").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j) as i32).collect();
        tf.regions.tight = jarr(reg.get("tight").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| if jnum(j) != 0.0 { 1 } else { 0 }).collect();
        for r in jarr(reg.get("regions").copied().unwrap_or(&J::N(f64::NAN))) {
            let rm = jmap(r);
            tf.regions.regions.push(MatRegion {
                bounded: jnum(rm.get("bounded").copied().unwrap_or(&J::N(0.0))) != 0.0,
                wall: jarr(rm.get("wall").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j) as u32).collect(),
                rel: jnum(rm.get("rel").copied().unwrap_or(&J::N(1.0))),
            });
        }
        for (k, v) in jmap(get("coreNetRef")) {
            tf.core_net_ref.insert(k, jnum(v));
        }
        for (k, v) in jmap(get("coreKNetRef")) {
            tf.core_k_net_ref.insert(k, jnum(v));
        }
        tf.trans_circs = jarr(get("transCircs")).iter().map(|j| jnum(j) as i32).collect();
        // note: gate writes transCircs only implicitly via loopNodes keys +
        // transNids order; transCircs key may be absent (order = transNids).
        tf.trans_nids = jarr(get("transNids")).iter().map(|ns| jarr(ns).iter().filter_map(jstr_opt).collect()).collect();
        tf.trans_rise_e = jarr(get("transRiseE")).iter().map(|j| jnum(j) as u32).collect();
        for (k, v) in jmap(get("fitBoreMm")) {
            tf.fit_bore_mm.insert(k, jnum(v));
        }
        for (k, v) in jmap(get("runBoreMm")) {
            tf.run_bore_mm.insert(k, jnum(v));
        }
        for (k, v) in jmap(get("fitNode")) {
            tf.fit_node.insert(k, jstr_opt(v).unwrap_or_default());
        }
        for kv in jarr(get("nodesOfPart")) {
            if let J::A(pair) = kv {
                if pair.len() == 2 {
                    if let (Some(id), J::A(ns)) = (jstr_opt(&pair[0]), &pair[1]) {
                        tf.nodes_of_part.push((id, ns.iter().map(|j| jnum(j) as u32).collect()));
                    }
                }
            }
        }
        tf.dgen = jnum(get("dgen"));
        tf.eff = jnum(get("eff"));
        tf.pzr_k = jnum(get("pzrK"));
        tf.h_turb = jnum(get("hTurb"));
        tf.pc_sig = jstr_opt(get("pcSig")).unwrap_or_default();
        for (k, v) in jmap(get("condUA")) {
            tf.cond_ua.insert(k, jnum(v));
        }
        for (k, v) in jmap(get("condMass")) {
            tf.cond_mass.insert(k, jnum(v));
        }
        for (k, v) in jmap(get("cwRef")) {
            tf.cw_ref.insert(k, jnum(v));
        }
        let nat = jmap(get("natInit"));
        tf.nat_tick = jnum(nat.get("tick").copied().unwrap_or(&J::N(0.0))) as u64;
        let pby = jmap(nat.get("pBy").copied().unwrap_or(&J::N(f64::NAN)));
        tf.nat_pby_v = jarr(pby.get("v").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j)).collect();
        tf.nat_pby_has = jarr(pby.get("has").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j) as u8).collect();
        tf.nat_loop = jarr(nat.get("loop").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j)).collect();
        let scr = jmap(get("scrMetal"));
        tf.scr_metal_qv = jarr(scr.get("qv").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j)).collect();
        tf.scr_metal_qm = jarr(scr.get("qm").copied().unwrap_or(&J::N(f64::NAN))).iter().map(|j| jnum(j) as u8).collect();
        for (k, v) in jmap(get("runEnds")) {
            if let J::A(ends) = v {
                if ends.len() == 2 {
                    if let (Some(a), Some(b)) = (jstr_opt(&ends[0]), jstr_opt(&ends[1])) {
                        tf.run_ends.insert(k, (a, b));
                    }
                }
            }
        }
        for (k, v) in jmap(get("nodeRunKey")) {
            if let Some(rk) = jstr_opt(v) {
                tf.node_run_key.insert(k, rk);
            }
        }
        tf.cont_order = jarr(get("contOrder")).iter().map(|j| jnum(j) as u32).collect();
        out.push(tf);
    }
    out
}
#[derive(Default)]
pub struct EdgeF {
    pub ck: i32,
    pub cdead: Option<String>,
    pub tid: Option<String>,
    pub end: Option<String>,
    pub freg: Option<String>,
    pub pid: Option<String>,
    pub cx: Option<i64>,
    pub cy: Option<i64>,
    pub pump: Option<String>,
    pub pool_at: Option<i64>,
    pub gate_mode: Option<String>,
    pub gate_ids: Vec<String>,
    pub h0fn: bool,
    pub h0num: Option<f64>,
    pub hsrc_fn: bool,
    pub inert: Option<f64>,
    pub machine: Option<String>,
}

fn jint_opt(j: &J) -> Option<i64> {
    match j {
        J::N(n) if n.is_finite() => Some(*n as i64),
        _ => None,
    }
}

pub struct EdgePreset {
    pub key: String,
    pub steam_ref: f64,
    pub casing_f: f64,
    pub pump_h0: f64,
    pub head_k: f64,
    pub tank_rho: f64,
    pub pump_head: HashMap<String, f64>,
    pub pump_rho0: HashMap<String, f64>,
    pub pump_suc: HashMap<String, String>,
    pub turb_c: f64,
    pub swallow: f64,
    pub bypass: f64,
    pub rho0: f64,
    pub rated: f64,
    pub sec_circ: HashMap<String, i64>,
    pub pool_part_h: HashMap<String, f64>,
    pub vent_circ: HashMap<String, i64>,
    pub vent_vac: HashMap<String, bool>,
    pub cond_sink_n: f64,
    pub cond_sink_ids: Vec<String>,
    pub fit_ids: Vec<String>,
    pub fit_relief: Vec<bool>,
    pub sig_tanks: Vec<String>,
    pub cond_p_des: f64,
    pub sg_byp_band: f64,
    pub ptref: f64,
    pub suggest: HashMap<i32, f64>,
    pub edges: Vec<EdgeF>,
}

pub fn parse_edge_frozen(s: &str) -> Vec<EdgePreset> {
    let mut out = vec![];
    let root = jparse(s);
    let presets = match &root {
        J::O(m) => match m.get("presets") {
            Some(J::A(v)) => v.clone(),
            _ => vec![],
        },
        _ => vec![],
    };
    for p in presets {
        let m = match &p {
            J::O(m) => m,
            _ => continue,
        };
        let num = |k: &str| jnum_opt(jget(m, k)).unwrap_or(f64::NAN);
        let smap = |k: &str| match m.get(k) {
            Some(J::O(mm)) => mm.iter().filter_map(|(id, v)| match v {
                J::O(pm) => pm.get("head").and_then(jnum_opt).map(|h| (id.clone(), h)),
                _ => None,
            }).collect(),
            _ => HashMap::new(),
        };
        let edges = match m.get("edges") {
            Some(J::A(v)) => v.iter().filter_map(|e| match e {
                J::O(em) => {
                    let opt = |k: &str| jstr_opt(em.get(k).unwrap_or(&J::N(f64::NAN)));
                    Some(EdgeF {
                        ck: jint_opt(em.get("ck").unwrap_or(&J::N(f64::NAN))).unwrap_or(-1) as i32,
                        cdead: opt("cdead"),
                        tid: opt("tid"),
                        end: opt("end"),
                        freg: opt("freg"),
                        pid: opt("pid"),
                        cx: em.get("cx").and_then(jint_opt),
                        cy: em.get("cy").and_then(jint_opt),
                        pump: opt("pump"),
                        pool_at: em.get("poolAt").and_then(jint_opt),
                        gate_mode: opt("gateMode"),
                        gate_ids: em.get("gateIds").map(jstrs).unwrap_or_default(),
                        h0fn: matches!(em.get("h0fn"), Some(J::N(x)) if *x != 0.0),
                        h0num: em.get("h0num").and_then(jnum_opt),
                        hsrc_fn: matches!(em.get("hsrcFn"), Some(J::N(x)) if *x != 0.0),
                        inert: em.get("I").and_then(jnum_opt),
                        machine: opt("machine"),
                    })
                }
                _ => None,
            }).collect(),
            _ => vec![],
        };
        let mut ep = EdgePreset {
            key: jstr_opt(m.get("key").unwrap_or(&J::N(f64::NAN))).unwrap_or_default(),
            steam_ref: num("steamRef"),
            casing_f: f64::NAN,
            pump_h0: f64::NAN,
            head_k: f64::NAN,
            tank_rho: f64::NAN,
            pump_head: smap("pumps"),
            pump_rho0: match m.get("pumpRho0") {
                Some(J::O(mm)) => mm.iter().filter_map(|(id, v)| jnum_opt(v).map(|x| (id.clone(), x))).collect(),
                _ => HashMap::new(),
            },
            pump_suc: match m.get("pumpSuc") {
                Some(J::O(mm)) => mm.iter().filter_map(|(id, v)| jstr_opt(v).map(|x| (id.clone(), x))).collect(),
                _ => HashMap::new(),
            },
            turb_c: f64::NAN,
            swallow: f64::NAN,
            bypass: f64::NAN,
            rho0: f64::NAN,
            rated: f64::NAN,
            sec_circ: match m.get("secCirc") {
                Some(J::O(mm)) => mm.iter().filter_map(|(id, v)| jint_opt(v).map(|x| (id.clone(), x))).collect(),
                _ => HashMap::new(),
            },
            pool_part_h: match m.get("poolPartH") {
                Some(J::O(mm)) => mm.iter().filter_map(|(id, v)| jnum_opt(v).map(|x| (id.clone(), x))).collect(),
                _ => HashMap::new(),
            },
            vent_circ: HashMap::new(),
            vent_vac: HashMap::new(),
            cond_sink_n: f64::NAN,
            cond_sink_ids: vec![],
            fit_ids: m.get("fitIds").map(jstrs).unwrap_or_default(),
            fit_relief: vec![],
            sig_tanks: m.get("sigTanks").map(jstrs).unwrap_or_default(),
            cond_p_des: f64::NAN,
            sg_byp_band: f64::NAN,
            ptref: f64::NAN,
            suggest: match m.get("suggest") {
                Some(J::O(sm)) => sm.iter().filter_map(|(k, v)| match (k.parse::<i32>(), v) {
                    (Ok(ci), J::N(p)) => Some((ci, *p)),
                    _ => None,
                }).collect(),
                _ => HashMap::new(),
            },
            edges,
        };
        if let Some(J::O(vm)) = m.get("vent") {
            for (id, v) in vm {
                if let J::O(em) = v {
                    if let Some(c) = em.get("circ").and_then(jint_opt) {
                        ep.vent_circ.insert(id.clone(), c);
                    }
                    ep.vent_vac.insert(id.clone(), matches!(em.get("vac"), Some(J::N(x)) if *x != 0.0));
                }
            }
        }
        if let Some(J::O(pm)) = m.get("plant") {
            ep.cond_sink_n = jnum_opt(jget(pm, "condSinkN")).unwrap_or(f64::NAN);
            ep.cond_sink_ids = pm.get("condSinkIds").map(jstrs).unwrap_or_default();
            ep.cond_p_des = jnum_opt(jget(pm, "condPDes")).unwrap_or(f64::NAN);
            ep.sg_byp_band = jnum_opt(jget(pm, "sgBypBand")).unwrap_or(f64::NAN);
            ep.ptref = jnum_opt(jget(pm, "ptref")).unwrap_or(f64::NAN);
        }
        if let Some(J::O(pm)) = m.get("pconsts") {
            ep.turb_c = jnum_opt(jget(pm, "turbC")).unwrap_or(f64::NAN);
            ep.swallow = jnum_opt(jget(pm, "swallow")).unwrap_or(f64::NAN);
            ep.bypass = jnum_opt(jget(pm, "bypass")).unwrap_or(f64::NAN);
            ep.rho0 = jnum_opt(jget(pm, "rho0")).unwrap_or(f64::NAN);
            ep.rated = jnum_opt(jget(pm, "rated")).unwrap_or(f64::NAN);
        }
        if let Some(J::O(cm)) = m.get("consts") {
            ep.casing_f = jnum_opt(jget(cm, "casingF")).unwrap_or(f64::NAN);
            ep.pump_h0 = jnum_opt(jget(cm, "pumpH0")).unwrap_or(f64::NAN);
            ep.head_k = jnum_opt(jget(cm, "headK")).unwrap_or(f64::NAN);
            ep.tank_rho = jnum_opt(jget(cm, "tankRho")).unwrap_or(f64::NAN);
        }
        if let Some(J::A(fm)) = m.get("fitRelief") {
            ep.fit_relief = fm.iter().map(|x| matches!(x, J::N(v) if *v != 0.0)).collect();
        }
        out.push(ep);
    }
    out
}

/// Replay post-ctl fixture: re-evaluate the recorded pass, apply demands,
/// lag motors — everything lanes/sig read, advanced on the passed state.
/// The engine performs the same three calls live (live_ctl → apply_act →
/// act_follow); this fixture replays recorded truth for verification.
pub fn replay_postpass(
    meta: &sim_rs::step::StepMeta,
    mut st: sim_rs::step::StepState,
    sample: &sim_rs::ctl::Sample,
    keys: &sim_rs::step::CtlMeta,
    dt: f64,
) -> sim_rs::step::StepState {
    let rep = sim_rs::ctl::ctl_replay(sample);
    sim_rs::live::apply_act(keys, &mut st, &rep.act);
    let inp = sec::SecIn { dt, ..Default::default() };
    let mut ev = vec![];
    let mut warns = 0u32;
    let mut cx = sec::Cx {
        meta: &meta.sec,
        curves: &meta.sec_curves,
        st: &mut st.sec,
        inp: &inp,
        ev: &mut ev,
        warns: &mut warns,
    };
    sec::act_follow(&mut cx);
    st
}
// NOTE: sglow_min/tank_open_live moved to sim_rs::live (live engine owns
// the arms); probes call those with explicit curves.

/// Probe-side conversion into the engine's frozen contract.
pub fn to_lib_edge(p: &EdgePreset) -> sim_rs::solvelive::EdgeFrozen {    use sim_rs::solvelive::{EdgeFrozen, FrozenEdge};
    let mut fr = EdgeFrozen {
        steam_ref: p.steam_ref,
        casing_f: p.casing_f,
        pump_h0: p.pump_h0,
        head_k: p.head_k,
        tank_rho: p.tank_rho,
        turb_c: p.turb_c,
        swallow: p.swallow,
        bypass: p.bypass,
        rho0: p.rho0,
        rated: p.rated,
        pump_head: p.pump_head.clone(),
        pump_rho0: p.pump_rho0.clone(),
        pump_suc: p.pump_suc.clone(),
        sec_circ: p.sec_circ.clone(),
        pool_part_h: p.pool_part_h.clone(),
        vent_circ: p.vent_circ.clone(),
        vent_vac: p.vent_vac.clone(),
        cond_sink_n: p.cond_sink_n,
        cond_sink_ids: p.cond_sink_ids.clone(),
        cond_p_des: p.cond_p_des,
        sg_byp_band: p.sg_byp_band,
        ptref: p.ptref,
        suggest: p.suggest.clone(),
        fit_ids: p.fit_ids.clone(),
        fit_relief: p.fit_relief.clone(),
        sig_tanks: p.sig_tanks.clone(),
        edges: Vec::with_capacity(p.edges.len()),
    };
    for e in &p.edges {
        fr.edges.push(FrozenEdge {
            ck: e.ck,
            cdead: e.cdead.clone(),
            tid: e.tid.clone(),
            end: e.end.clone(),
            freg: e.freg.clone(),
            pid: e.pid.clone(),
            cx: e.cx,
            cy: e.cy,
            pump: e.pump.clone(),
            pool_at: e.pool_at,
            gate_mode: e.gate_mode.clone(),
            gate_ids: e.gate_ids.clone(),
            hsrc_fn: e.hsrc_fn,
            inert: e.inert,
            machine: e.machine.clone(),
        });
    }
    fr
}

/// One tick's piece-cache decision from the gate sidecar (`pcdec` line).
pub struct PcDec {
    pub reuse: bool,
    pub sig_pre: String,
    pub sig_solve: String,
}

/// Parse `pcdec`/`sigseg` debug lines: preset idx by tag-0 rollover.
/// Returns (per-preset-per-tick decisions, per-preset siglists index order).
pub fn parse_pcdec(dbg: &str) -> HashMap<(usize, usize), PcDec> {
    let mut out = HashMap::new();
    let mut cur = 0usize;
    let mut last: Option<usize> = None;
    for ln in dbg.lines() {
        if let Some(rest) = ln.strip_prefix("pcdec t=") {
            let mut it = rest.split(' ');
            let tg: usize = it.next().unwrap_or("0").parse().unwrap_or(0);
            if tg == 0 && last.map(|l| l != 0).unwrap_or(false) {
                cur += 1;
            }
            last = Some(tg);
            let mut reuse = false;
            let mut sig_pre = String::new();
            let mut sig_solve = String::new();
            for kv in it {
                if let Some(v) = kv.strip_prefix("reuse=") {
                    reuse = v == "true";
                } else if let Some(v) = kv.strip_prefix("sigPre=") {
                    sig_pre = v.to_string();
                } else if let Some(v) = kv.strip_prefix("sigSolve=") {
                    sig_solve = v.to_string();
                }
            }
            out.insert((cur, tg), PcDec { reuse, sig_pre, sig_solve });
        }
    }
    out
}

/// Parse the gate's `ctl.tbl` (`tools/ctl-frozen.js` format) into the live
/// ctl template per preset.
pub fn parse_ctl_tbl(s: &str) -> Vec<sim_rs::live::FrozenTable> {
    let f64of = |s: &str| -> f64 {
        if s == "NaN" || s.is_empty() { f64::NAN } else { s.parse().unwrap_or(f64::NAN) }
    };
    let blank = || sim_rs::live::FrozenTable {
        ids: vec![], sig: vec![], arg: vec![], name: vec![],
        seed_out: vec![], seed_f: vec![], rods_of: HashMap::new(),
        turb_id: None, ctrl_id: None, steam_ref: 0.0,
    };
    let mut out = vec![];
    let mut cur: Option<sim_rs::live::FrozenTable> = None;
    for ln in s.lines() {
        let f: Vec<&str> = ln.split('|').collect();
        match f[0] {
            "preset" => {
                if let Some(p) = cur.take() {
                    out.push(p);
                }
                cur = Some(blank());
            }
            "blk" => {
                if let Some(p) = cur.as_mut() {
                    p.ids.push(f.get(1).unwrap_or(&"").to_string());
                    p.sig.push(f.get(3).unwrap_or(&"").to_string());
                    p.arg.push(f.get(4).unwrap_or(&"").to_string());
                    p.name.push(f.get(5).unwrap_or(&"").to_string());
                    p.seed_out.push(f64of(f.get(6).unwrap_or(&"")));
                    p.seed_f.push(f64of(f.get(7).unwrap_or(&"")));
                }
            }
            "meta" => {
                if let Some(p) = cur.as_mut() {
                    for kv in &f[1..] {
                        if let Some((k, v)) = kv.split_once('=') {
                            match k {
                                "turb" => { if !v.is_empty() { p.turb_id = Some(v.to_string()); } }
                                "ctrl" => { if !v.is_empty() { p.ctrl_id = Some(v.to_string()); } }
                                "steamRef" => { p.steam_ref = v.parse().unwrap_or(0.0); }
                                _ => {}
                            }
                        }
                    }
                }
            }
            "rods" => {
                if let Some(p) = cur.as_mut() {
                    if let Some((k, v)) = f.get(1).and_then(|s| s.split_once('=')) {
                        if !v.is_empty() {
                            p.rods_of.insert(k.to_string(), v.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(p) = cur.take() {
        out.push(p);
    }
    out
}
