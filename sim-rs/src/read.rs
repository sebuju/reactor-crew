//! Solve readers, ported from `src/data/pipenet.js`: `runEdgeCommon`,
//! `netReadP`, `netReadEdges`.
//!
//! Pure over a solve answer. The tick mixes containers (typed byRun holder,
//! legacy byLoop/outs objects, null byDrop); both branches port, selected by
//! the caller's containers exactly like the JS.

pub const OWK: usize = 0;
pub const OWKP: usize = 1;
pub const OWKA: usize = 2;
pub const OQSGT: usize = 3;
pub const OSPILL: usize = 4;
pub const OSPILLSEC: usize = 5;
pub const ONAT: usize = 6;

/// Signed flow common to a run's halves: same sign → smaller, opposing → 0.
pub fn run_edge_common(q: &[f64], pair: Option<usize>, e: usize) -> f64 {
    let v = q[e];
    match pair {
        Some(p) => {
            let w = q[p];
            if (v >= 0.0) == (w >= 0.0) {
                if w.abs() < v.abs() { w } else { v }
            } else {
                0.0
            }
        }
        None => v,
    }
}

/// Pressure field off a solve. `cont_p` carries the dumped `netPcont` per
/// node; `deg`/`store_pin` are `None` when the JS had no array.
pub fn net_read_p(
    b: &[f64],
    fx_h: &[u8],
    touch: &[u8],
    ref_of: &[i32],
    ref_n: usize,
    ref_anchor: &[i32],
    deg: Option<&[u8]>,
    store_pin: Option<&[u8]>,
    f_wet: &[u8],
    cont_p: &[f64],
    by_v: &mut [f64],
    by_has: &mut [u8],
) {
    let n = b.len();
    let mut lo = vec![f64::INFINITY; ref_n];
    let mut free = vec![1u8; ref_n];
    let mut wet = vec![0u8; ref_n];
    for i in 0..n {
        let c = ref_of[i] as usize;
        if fx_h[i] != 0 {
            if touch[i] != 0 {
                free[c] = 0;
            }
            continue;
        }
        if deg.map(|d| d[i] != 0).unwrap_or(false) && touch[i] == 0 {
            continue;
        }
        if f_wet[i] != 0 {
            wet[c] = 1;
        }
        if store_pin.map(|p| p[i] != 0).unwrap_or(false) {
            free[c] = 0;
        }
        if b[i] < lo[c] {
            lo[c] = b[i];
        }
    }
    let _ = ref_anchor;
    for i in 0..n {
        if deg.map(|d| d[i] != 0).unwrap_or(false) && touch[i] == 0 && fx_h[i] == 0 {
            by_has[i] = 0;
            continue;
        }
        let c = ref_of[i] as usize;
        // A piece nothing pins floats so its lowest node sits at the ship's
        // pressure; a shift cancels out of every flow.
        let off = if free[c] != 0 && wet[c] != 0 && fx_h[i] == 0 && lo[c].is_finite() {
            cont_p[i] - lo[c]
        } else {
            0.0
        };
        by_v[i] = b[i] + off;
        by_has[i] = 1;
    }
}

/// Edge structural row for `net_read_edges`.
pub struct ReadEdge {
    pub u: u32,
    pub v: u32,
    pub key: i32,
    pub meter: bool,
    pub pair: i32,
    pub tank_u: bool,
    pub tank_v: bool,
    pub tank_id_u: i32,
    pub tank_id_v: i32,
    pub shell_of: i32,
    pub shell_sign_neg: bool,
    pub sec_u: i32,
    pub sec_v: i32,
    pub is_sgtr: bool,
    pub is_break: bool,
    pub break_steam: bool,
    pub break_sec: bool,
    pub work: bool,
    pub work_fr: f64,
    pub relief: i32,
}

/// Key tables in flowMapsOf order (first-seen over edges, tankNode order
/// for tanks, coreNodes key order for cores, fitIds order for reliefs).
pub struct ReadMaps {
    pub run_keys: Vec<i32>,
    pub core_keys: Vec<i32>,
    pub tank_keys: Vec<i32>,
    pub shell_keys: Vec<i32>,
    pub sgtr_keys: Vec<i32>,
    pub relief_keys: Vec<i32>,
    pub by_keys: Vec<i32>,
    pub loop_of_run: Vec<i32>,
    pub core_of_node: Vec<i32>,
    pub tank_id_of_node: Vec<i32>,
    pub sec_shell_of_node: Vec<i32>,
    pub n_loops: usize,
}

/// Typed outs bags (the T path), index-aligned with ReadMaps.
#[derive(Default)]
pub struct OutsBags {
    pub core_kg: Vec<f64>,
    pub q_tank: Vec<f64>,
    pub sg_steam: Vec<f64>,
    pub by: Vec<f64>,
    pub sg_feed: Vec<f64>,
    pub sgtr: Vec<f64>,
    pub relief: Vec<f64>,
    pub sc: [f64; 7],
}

/// Legacy outs (plain-object branch): sorted (key, value) lists.
#[derive(Default)]
pub struct OutsLegacy {
    pub core_kg: Vec<(i32, f64)>,
    pub q_tank: Vec<(i32, f64)>,
    pub sg_steam: Vec<(i32, f64)>,
    pub by: Vec<(i32, f64)>,
    pub sg_feed: Vec<(i32, f64)>,
    pub sgtr: Vec<(i32, f64)>,
    pub relief: Vec<(i32, f64)>,
    pub turb_wk: f64,
    pub turb_wk_p: f64,
    pub turb_wk_a: f64,
    pub q_sgtr: f64,
    pub spill: f64,
    pub spill_sec: f64,
}

/// Position lookup that tolerates keys outside the bag's table.
#[inline]
fn pos_get(map: &[i32], idx: i32) -> Option<usize> {
    if idx < 0 {
        return None;
    }
    map.get(idx as usize).and_then(|&p| if p >= 0 { Some(p as usize) } else { None })
}

fn add_leg(dst: &mut Vec<(i32, f64)>, key: i32, v: f64) {
    if let Some(slot) = dst.iter_mut().find(|(k, _)| *k == key) {
        slot.1 += v;
    } else {
        dst.push((key, v));
    }
}

/// Edge-flow readers. `by_run_typed`: Some(vec) for the holder path (with
/// `run_pos` index per run key), None for the legacy object path (emitted
/// as a sorted list). `by_loop`: legacy map or typed vec selected by
/// `by_loop_typed`. `by_drop`: legacy map or skipped when None... always
/// Edge-flow readers. Ids are string-table indices; `*_pos` maps a table
/// index to its bag position (-1 absent). `by_drop` always accumulates (the
/// tick caller drops it). Typed-vs-legacy follows the caller's containers.
#[allow(clippy::too_many_arguments)]
pub fn net_read_edges(
    edges: &[ReadEdge],
    b: &[f64],
    q: &[f64],
    fixed_has: &[u8],
    ref_anchor: &[i32],
    f_wet: &[u8],
    in_core: &[bool],
    core_of: &[i32],
    loop_of: &[i32],
    run_pos: &[i32],
    tank_pos: &[i32],
    shell_pos: &[i32],
    sgtr_pos: &[i32],
    relief_pos: &[i32],
    by_pos: &[i32],
    core_pos: &[i32],
    mut by_run_typed: Option<&mut [f64]>,
    by_run_legacy: &mut Vec<(i32, f64)>,
    mut by_loop_typed: Option<&mut [f64]>,
    by_loop_legacy: &mut Vec<(i32, f64)>,
    by_drop: &mut Vec<(i32, f64)>,
    mut outs_typed: Option<&mut OutsBags>,
    outs_legacy: &mut OutsLegacy,
    mut core_typed: Option<&mut [f64]>,
    core_total: &mut f64,
) {
    let n = b.len();
    // Scale is the span, highest to lowest free-or-anchor node.
    let mut is_anchor = vec![0u8; n];
    for &a in ref_anchor {
        if a >= 0 {
            is_anchor[a as usize] = 1;
        }
    }
    let mut pmax = f64::NEG_INFINITY;
    let mut pmin = f64::INFINITY;
    for i in 0..n {
        if fixed_has[i] != 0 && is_anchor[i] == 0 {
            continue;
        }
        if b[i] > pmax {
            pmax = b[i];
        }
        if b[i] < pmin {
            pmin = b[i];
        }
    }
    let span = pmax - pmin;
    let mut core = 0.0;
    let mut spill = 0.0;
    let mut spill_sec = 0.0;
    if let Some(v) = by_run_typed.as_mut() {
        v.fill(0.0);
    }
    if let Some(v) = by_loop_typed.as_mut() {
        v.fill(0.0);
    }
    for (e, ed) in edges.iter().enumerate() {
        if ed.key >= 0 && ed.meter {
            let rv = run_edge_common(q, if ed.pair >= 0 { Some(ed.pair as usize) } else { None }, e);
            match by_run_typed.as_mut() {
                Some(v) => {
                    if let Some(p) = pos_get(run_pos, ed.key) {
                        v[p] += rv;
                    }
                }
                None => add_leg(by_run_legacy, ed.key, rv),
            }
        }
        // Signed per tank off the tank's own node, positive out. A masked
        // node without an id reads as absent (JS undefined), falling through.
        {
            let tu = if ed.tank_u && ed.tank_id_u >= 0 { Some(ed.tank_id_u) } else { None };
            let tv = if ed.tank_v && ed.tank_id_v >= 0 { Some(ed.tank_id_v) } else { None };
            if tu.is_some() || tv.is_some() {
                let (tid3, tn, out) = match tu {
                    Some(t) => (t, ed.u as usize, q[e]),
                    None => (tv.unwrap(), ed.v as usize, -q[e]),
                };
                // The same F.wet bit the transport reads.
                let add = if out > 0.0 && f_wet[tn] == 0 { 0.0 } else { out };
                // tid3 is already a tank-table position.
                match outs_typed.as_mut() {
                    Some(o) => {
                        if let Some(slot) = o.q_tank.get_mut(tid3 as usize) {
                            *slot += add;
                        }
                    }
                    None => add_leg(&mut outs_legacy.q_tank, tid3, add),
                }
            }
        }
        // Signed out of the shell; negative is steam arriving down a header.
        // Feeders into a shell (shellOf) are skipped here — they aggregate
        // under sgFeed, never sgSteam.
        if ed.shell_of < 0 && (ed.sec_u >= 0 || ed.sec_v >= 0) {
            if !ed.is_sgtr {
                let (sid, svv) = match ed.sec_u {
                    s if s >= 0 => (s, q[e]),
                    _ => (ed.sec_v, -q[e]),
                };
                match outs_typed.as_mut() {
                    Some(o) => {
                        if let Some(slot) = o.sg_steam.get_mut(sid as usize) {
                            *slot += svv;
                        }
                    }
                    None => add_leg(&mut outs_legacy.sg_steam, sid, svv),
                }
            }
        }
        // Turbine work: governor plus bypass, wheels' share only.
        if ed.work && ed.work_fr > 0.0 {
            let w = q[e] * ed.work_fr;
            match outs_typed.as_mut() {
                Some(o) => {
                    o.sc[OWK] += w;
                    o.sc[OWKP] += b[ed.u as usize] * w.abs();
                    o.sc[OWKA] += w.abs();
                }
                None => {
                    outs_legacy.turb_wk += w;
                    outs_legacy.turb_wk_p += b[ed.u as usize] * w.abs();
                    outs_legacy.turb_wk_a += w.abs();
                }
            }
        }
        if ed.key >= 0 {
            add_leg(by_drop, ed.key, if span > 0.0 {
                (b[ed.u as usize] - b[ed.v as usize]).abs() / span
            } else {
                0.0
            });
        }
        if ed.is_break {
            if !ed.break_steam {
                if ed.break_sec {
                    spill_sec += q[e].max(0.0);
                } else {
                    spill += q[e].max(0.0);
                }
            }
            if ed.key >= 0 {
                let mq = q[e].max(0.0);
                match outs_typed.as_mut() {
                    Some(o) => {
                        if let Some(p) = pos_get(by_pos, ed.key) {
                            o.by[p] += mq;
                        }
                    }
                    None => add_leg(&mut outs_legacy.by, ed.key, mq),
                }
            }
        }
        // Off the shell edge: shell_of is a stab index into the shell table.
        if ed.shell_of >= 0 {
            let fv = if ed.shell_sign_neg { -q[e] } else { q[e] };
            match outs_typed.as_mut() {
                Some(o) => {
                    if let Some(p) = pos_get(shell_pos, ed.shell_of) {
                        o.sg_feed[p] += fv;
                    }
                }
                None => add_leg(&mut outs_legacy.sg_feed, ed.shell_of, fv),
            }
        }
        if ed.is_sgtr {
                match outs_typed.as_mut() {
                    Some(o) => {
                        o.sc[OQSGT] += q[e];
                        if let Some(p) = pos_get(sgtr_pos, ed.key) {
                            o.sgtr[p] += q[e];
                        }
                    }
                    None => {
                    outs_legacy.q_sgtr += q[e];
                    add_leg(&mut outs_legacy.sgtr, ed.key, q[e]);
                }
            }
        }
        if ed.relief >= 0 {
            let av = q[e].abs();
                match outs_typed.as_mut() {
                    Some(o) => {
                        if let Some(slot) = o.relief.get_mut(ed.relief as usize) {
                            *slot += av;
                        }
                    }
                    None => add_leg(&mut outs_legacy.relief, ed.relief, av),
                }
        }
        // By node incidence and sign alone: legs carrying water away drop
        // out; tank edges are a different flow with their own figure.
        let q_tank_edge = ed.tank_u || ed.tank_v;
        let in_u = in_core[ed.u as usize];
        let in_v = in_core[ed.v as usize];
        if !q_tank_edge && (in_u || in_v) {
            let qin = if in_v { q[e] } else { -q[e] };
            if qin > 0.0 {
                core += qin;
                let cn = if in_v { ed.v as usize } else { ed.u as usize };
                let cid = core_of[cn];
                match core_typed.as_mut() {
                    Some(v) => {
                        if let Some(slot) = cid.try_into().ok().and_then(|i: usize| v.get_mut(i)) {
                            *slot += qin;
                        }
                    }
                    None => {
                        if cid >= 0 {
                            add_leg(&mut outs_legacy.core_kg, cid, qin);
                        }
                    }
                }
                let li = if ed.key >= 0 && (ed.key as usize) < loop_of.len() {
                    loop_of[ed.key as usize]
                } else {
                    -1
                };
                if li >= 0 {
                    match by_loop_typed.as_mut() {
                        Some(v) => v[li as usize] += qin,
                        None => add_leg(by_loop_legacy, li, qin),
                    }
                }
            }
        }
    }
    match outs_typed.as_mut() {
        Some(o) => {
            o.sc[OSPILL] = spill;
            o.sc[OSPILLSEC] = spill_sec;
        }
        None => {
            outs_legacy.spill = spill;
            outs_legacy.spill_sec = spill_sec;
        }
    }
    *core_total = core;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_flow_signs() {
        let q = [3.0, 2.0, -1.0];
        assert_eq!(run_edge_common(&q, None, 0), 3.0);
        assert_eq!(run_edge_common(&q, Some(1), 0), 2.0);
        assert_eq!(run_edge_common(&q, Some(2), 0), 0.0);
        // NaN>=0 is false: matches only a negative partner; 1 < NaN is
        // false, so the NaN itself comes back (same as the JS ternary).
        let qn = [f64::NAN, -1.0];
        assert!(run_edge_common(&qn, Some(1), 0).is_nan());
    }

    #[test]
    fn read_p_floats_and_pins() {
        // b = [10, 4], piece 0 unpinned+wet with lo=4, contP=15 -> float +11.
        let (b, fx, touch) = (vec![10.0, 4.0], vec![0, 0], vec![1, 1]);
        let (of, anch) = (vec![0, 0], vec![-1]);
        let (mut v, mut has) = (vec![0.0; 2], vec![0u8; 2]);
        net_read_p(&b, &fx, &touch, &of, 1, &anch, None, None, &[1, 1], &[15.0, 15.0], &mut v, &mut has);
        assert_eq!(v, vec![21.0, 15.0]);
        assert_eq!(has, vec![1, 1]);
        // Store-pinned piece does not float.
        let (mut v2, mut has2) = (vec![0.0; 2], vec![0u8; 2]);
        net_read_p(&b, &fx, &touch, &of, 1, &anch, None, Some(&[1, 0]), &[1, 1], &[15.0, 15.0], &mut v2, &mut has2);
        assert_eq!(v2, vec![10.0, 4.0]);
        let _ = has2;
    }
}
