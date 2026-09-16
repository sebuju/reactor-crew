//! Control cabinet (`ctlPass` + sinks), ported from `src/sim/ctl.js:222`.
//!
//! Plant-coupled reads arrive pre-evaluated (dump-kit, like the core gate):
//! every `source` block carries the `sigRead` value the real tick observed
//! at its evaluation point (intra-tick sink feedback included), every `sink`
//! carries its `blkDead` bit, and every `scram` sink carries its `blkBlame`
//! string. What ports is the pure control math: Kahn order, `blkEval` per
//! mode, and the sink applies onto dumped actuator state. `blkSeedOut`
//! (bumpless commissioning) is not tick path and stays JS.
//!
//! Rules: identical IEEE op order to the JS; `Math.max/min` NaN semantics
//! via `eos::js_max/js_min`; `clamp` is `Math.max(a, Math.min(b, v))`
//! (`src/core/text.js`). No transcendentals, so the gate bar is bit-exact.

use crate::eos::{clamp, js_max, js_min};

/// Block modes, matching the gate's encoding of `BLK` keys.
pub const MODE_SOURCE: u8 = 0;
pub const MODE_CONST: u8 = 1;
pub const MODE_MATH: u8 = 2;
pub const MODE_PID: u8 = 3;
pub const MODE_INTEG: u8 = 4;
pub const MODE_LIMIT: u8 = 5;
pub const MODE_LAG: u8 = 6;
pub const MODE_COMPARE: u8 = 7;
pub const MODE_LATCH: u8 = 8;
pub const MODE_SEL: u8 = 9;
pub const MODE_SINK: u8 = 10;
pub const MODE_UNKNOWN: u8 = 255;

/// Sink kinds, matching the gate's encoding of `SINK` keys.
pub const SINK_ROD_STEP: u8 = 0;
pub const SINK_FREG: u8 = 1;
pub const SINK_RELIEF: u8 = 2;
pub const SINK_FLOW_DEM: u8 = 3;
pub const SINK_LOAD_DEM: u8 = 4;
pub const SINK_BORON_DEM: u8 = 5;
pub const SINK_VALVE_DEM: u8 = 6;
pub const SINK_TANK_OPEN: u8 = 7;
pub const SINK_SCRAM: u8 = 8;
pub const SINK_NEAR_TRIP: u8 = 9;
pub const SINK_RUNBACK: u8 = 10;
pub const SINK_UNKNOWN: u8 = 255;

/// Nullable float knobs, in dump order. The null bit means the JS knob was
/// `null`/`undefined` (blank), which differs from NaN in arithmetic.
pub const KNOB_V: usize = 0;
pub const KNOB_K: usize = 1;
pub const KNOB_KP: usize = 2;
pub const KNOB_TI: usize = 3;
pub const KNOB_TD: usize = 4;
pub const KNOB_DB: usize = 5;
pub const KNOB_N: usize = 6;
pub const KNOB_LO: usize = 7;
pub const KNOB_HI: usize = 8;
pub const KNOB_RATE: usize = 9;
pub const KNOB_TAU: usize = 10;
pub const KNOB_ON: usize = 11;
pub const KNOB_OFF: usize = 12;

/// One live block (`s.blkBy[id]` plus its dump-kit inputs).
pub struct Block {
    pub mode: u8,
    pub on: bool,
    /// Wiring slots as indices into the sample's block list (-1: null/unknown).
    pub inputs: Vec<i32>,
    pub knob: [f64; 13],
    pub nullmask: u16,
    /// Math op: 0 add, 1 sub, 2 mul, 3 div, 4 min, else max.
    pub math_op: u8,
    /// Sel op: 1 min, 0 max, else median.
    pub sel_op: u8,
    /// Compare op: 1 below, else above.
    pub cmp_op: u8,
    /// Dump-kit: `sigRead` value observed at this block's evaluation point.
    pub src_val: f64,
    pub sink_kind: u8,
    /// Index into the sink's key list (-1: arg names nothing held).
    pub sink_arg: i32,
    /// Dump-kit: `blkDead` at this sink's evaluation point.
    pub dead: bool,
    /// Dump-kit: `blkBlame` at this scram sink's evaluation point.
    pub blame: String,
}

#[inline]
fn is_null(b: &Block, k: usize) -> bool {
    b.nullmask & (1u16 << k) != 0
}

/// JS `Math.sign`: NaN in, NaN out, signed zeros preserved.
#[inline]
fn js_sign(v: f64) -> f64 {
    if v.is_nan() {
        f64::NAN
    } else if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    }
}

/// One relief valve's command cells plus its static spring flag.
#[derive(Clone)]
pub struct ReliefCell {
    pub exist: bool,
    pub open: bool,
    pub auto: bool,
    pub stuck: bool,
    pub arm: bool,
    pub spring: bool,
}

/// Per-core actuator state written by the core-scoped sinks.
#[derive(Clone)]
pub struct CoreAct {
    pub rod_dem: f64,
    pub rod_zdem: Vec<f64>,
    pub rod_band: bool,
    pub split: bool,
    pub regang: bool,
    pub bank_auto: Vec<bool>,
    pub rod_jam: bool,
    pub scrammed: bool,
    pub rps_hot: f64,
    pub rps_near: bool,
    pub trip: String,
    pub rated: f64,
    pub rod_rate: f64,
    /// Dump-kit: `|Tavg - tProg| > 0.5` (static over the tick).
    pub pin_hot: bool,
    /// Dump-kit: `s.dmgParts` holds this core's rod drive.
    pub dmg_rod: bool,
}

/// Actuator state written by sinks: globals, demand maps, relief cells, cores.
#[derive(Clone)]
pub struct Act {
    pub ar_lo: f64,
    pub ar_hi: f64,
    pub load_max: f64,
    pub rps_lag: f64,
    pub p_rated: f64,
    pub load: f64,
    pub load_dem: f64,
    pub boron_dem: f64,
    pub rb_hot: bool,
    pub freg_exist: Vec<bool>,
    pub freg: Vec<f64>,
    pub flow_exist: Vec<bool>,
    pub flow: Vec<f64>,
    pub valve_exist: Vec<bool>,
    pub valve: Vec<f64>,
    pub tank_exist: Vec<bool>,
    pub tank: Vec<bool>,
    pub relief: Vec<ReliefCell>,
    pub cores: Vec<CoreAct>,
}

/// One `ctlPass` sample: the graph, its evaluation order, and actuator state.
pub struct Sample {
    pub dt: f64,
    pub live: bool,
    pub blocks: Vec<Block>,
    /// Dumped JS `ctlOrder`, as block indices. Recomputed and asserted.
    pub order: Vec<usize>,
    pub out_pre: Vec<f64>,
    pub f_pre: Vec<f64>,
    pub act: Act,
}

/// Replay outputs: block state plus actuator state.
pub struct Replay {
    pub out: Vec<f64>,
    pub f: Vec<f64>,
    pub act: Act,
}

/// Kahn over the live links, matching `ctlOrder`: FIFO from zero-degree in
/// id order, cycle leftovers appended in id order.
pub fn ctl_order(blocks: &[Block]) -> Vec<usize> {
    let n = blocks.len();
    let mut deg = vec![0usize; n];
    let mut kids: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (id, b) in blocks.iter().enumerate() {
        for &src in &b.inputs {
            if src >= 0 && (src as usize) < n {
                deg[id] += 1;
                kids[src as usize].push(id);
            }
        }
    }
    let mut q: std::collections::VecDeque<usize> = deg
        .iter()
        .enumerate()
        .filter(|(_, &d)| d == 0)
        .map(|(i, _)| i)
        .collect();
    let mut order = Vec::with_capacity(n);
    while let Some(id) = q.pop_front() {
        order.push(id);
        for &k in &kids[id] {
            deg[k] -= 1;
            if deg[k] == 0 {
                q.push_back(k);
            }
        }
    }
    for (id, &d) in deg.iter().enumerate() {
        if d > 0 {
            order.push(id);
        }
    }
    order
}

/// Missing input slots read as NaN, like JS `undefined` in arithmetic.
#[inline]
fn at(ins: &[f64], i: usize) -> f64 {
    if i < ins.len() { ins[i] } else { f64::NAN }
}

/// `blkEval`: the value out, plus the new filter state (moved only by pid).
fn blk_eval(b: &Block, ins: &[f64], dt: f64, out_hold: f64, f_hold: f64) -> (f64, f64) {
    match b.mode {
        MODE_SOURCE => (b.src_val, f_hold),
        MODE_CONST => {
            let v = if is_null(b, KNOB_V) { 0.0 } else { b.knob[KNOB_V] };
            (v, f_hold)
        }
        MODE_MATH => {
            let (a, c) = (at(ins, 0), at(ins, 1));
            let r = match b.math_op {
                0 => a + c,
                1 => a - c,
                2 => a * c,
                3 => {
                    if c != 0.0 {
                        a / c
                    } else {
                        0.0
                    }
                }
                4 => js_min(a, c),
                _ => js_max(a, c),
            };
            let k_is_one = !is_null(b, KNOB_K) && b.knob[KNOB_K] == 1.0;
            if k_is_one {
                (r, f_hold)
            } else {
                let k = if is_null(b, KNOB_K) { 0.0 } else { b.knob[KNOB_K] };
                (k * r, f_hold)
            }
        }
        MODE_PID => {
            let (e, rate) = (at(ins, 0), at(ins, 1));
            let td = if is_null(b, KNOB_TD) || b.knob[KNOB_TD] == 0.0 || b.knob[KNOB_TD].is_nan() {
                0.0
            } else {
                b.knob[KNOB_TD]
            };
            let n = if is_null(b, KNOB_N) { 0.0 } else { b.knob[KNOB_N] };
            let f = f_hold + js_min(dt / js_max(td / n, dt), 1.0) * (rate - f_hold);
            let db = if is_null(b, KNOB_DB) {
                f64::NAN
            } else {
                b.knob[KNOB_DB]
            };
            let kp = if is_null(b, KNOB_KP) { 0.0 } else { b.knob[KNOB_KP] };
            let ti = if !is_null(b, KNOB_TI) && b.knob[KNOB_TI] > 0.0 {
                b.knob[KNOB_TI]
            } else {
                -1.0
            };
            let u = if e.abs() < db {
                0.0
            } else {
                kp * (f + (if ti > 0.0 { e / ti } else { 0.0 })
                    + td * (f - f_hold) / js_max(dt, 1e-9))
                    * dt
            };
            (u, f)
        }
        MODE_INTEG => {
            let lo = if is_null(b, KNOB_LO) {
                f64::NEG_INFINITY
            } else {
                b.knob[KNOB_LO]
            };
            let hi = if is_null(b, KNOB_HI) {
                f64::INFINITY
            } else {
                b.knob[KNOB_HI]
            };
            (clamp(out_hold + at(ins, 0), lo, hi), f_hold)
        }
        MODE_LIMIT => {
            let o = out_hold;
            let lo = if is_null(b, KNOB_LO) {
                f64::NEG_INFINITY
            } else {
                b.knob[KNOB_LO]
            };
            let hi = if is_null(b, KNOB_HI) {
                f64::INFINITY
            } else {
                b.knob[KNOB_HI]
            };
            let mut v = clamp(at(ins, 0), lo, hi);
            if !is_null(b, KNOB_RATE) {
                let d = v - o;
                v = o + js_sign(d) * js_min(d.abs(), b.knob[KNOB_RATE] * dt);
            }
            (v, f_hold)
        }
        MODE_LAG => {
            let tau = if is_null(b, KNOB_TAU) { 0.0 } else { b.knob[KNOB_TAU] };
            (out_hold + js_min(dt / js_max(tau, dt), 1.0) * (at(ins, 0) - out_hold), f_hold)
        }
        MODE_COMPARE => {
            let on = if b.inputs.len() > 1 && b.inputs[1] >= 0 {
                ins[1]
            } else if is_null(b, KNOB_ON) {
                0.0
            } else {
                b.knob[KNOB_ON]
            };
            let off = if b.inputs.len() > 2 && b.inputs[2] >= 0 {
                ins[2]
            } else if is_null(b, KNOB_OFF) {
                0.0
            } else {
                b.knob[KNOB_OFF]
            };
            let held = out_hold != 0.0 && !out_hold.is_nan();
            let x = at(ins, 0);
            let v = if b.cmp_op == 1 {
                if held {
                    if x > off { 0.0 } else { 1.0 }
                } else if x < on {
                    1.0
                } else {
                    0.0
                }
            } else if held {
                if x < off { 0.0 } else { 1.0 }
            } else if x > on {
                1.0
            } else {
                0.0
            };
            (v, f_hold)
        }
        MODE_LATCH => {
            let v = if at(ins, 1) > 0.5 {
                0.0
            } else if at(ins, 0) > 0.5 {
                1.0
            } else {
                out_hold
            };
            (v, f_hold)
        }
        MODE_SEL => {
            let mut w: Vec<f64> = Vec::with_capacity(ins.len());
            for (i, &src) in b.inputs.iter().enumerate() {
                if src >= 0 {
                    w.push(ins[i]);
                }
            }
            if w.is_empty() {
                return (0.0, f_hold);
            }
            if b.sel_op == 1 {
                let mut m = w[0];
                for &v in &w[1..] {
                    if v < m {
                        m = v;
                    }
                }
                (m, f_hold)
            } else if b.sel_op == 0 {
                let mut m = w[0];
                for &v in &w[1..] {
                    if v > m {
                        m = v;
                    }
                }
                (m, f_hold)
            } else {
                w.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let m = w[(w.len() - 1) >> 1];
                (m, f_hold)
            }
        }
        MODE_SINK => (at(ins, 0), f_hold),
        _ => (out_hold, f_hold),
    }
}

fn bank_auto_live(c: &CoreAct, bx: usize) -> bool {
    !c.scrammed && !c.rod_jam && (!c.split || c.bank_auto[bx])
}

fn rod_apply(act: &mut Act, ci: usize, step: f64, dt: f64) {
    let rr = act.cores[ci].rod_rate;
    let err = clamp(step, -rr * dt, rr * dt);
    let lo = clamp(act.ar_lo, 0.0, 1.0);
    let hi = clamp(js_max(act.ar_hi, act.ar_lo), 0.0, 1.0);
    let c = &mut act.cores[ci];
    c.rod_band = false;
    if !c.split && bank_auto_live(c, 0) {
        let want = c.rod_dem + err;
        let got = clamp(want, lo, hi);
        c.rod_band = (want - got).abs() > 1e-9 && c.pin_hot;
        c.rod_dem = got;
    } else if c.split && !c.regang {
        for bx in 0..c.rod_zdem.len() {
            if bank_auto_live(c, bx) {
                let want = c.rod_zdem[bx] + err;
                let got = clamp(want, lo, hi);
                if (want - got).abs() > 1e-9 && c.pin_hot {
                    c.rod_band = true;
                }
                c.rod_zdem[bx] = got;
            }
        }
    }
}

fn relief_cmd(cell: &mut ReliefCell, open: bool) {
    if open {
        if cell.open {
            return;
        }
        cell.open = true;
        cell.auto = true;
        cell.stuck = cell.arm;
        cell.arm = false;
        return;
    }
    if !(cell.open && cell.auto && !cell.stuck) {
        return;
    }
    cell.open = false;
    cell.auto = false;
}

fn sink_apply(act: &mut Act, kind: u8, arg: i32, v: f64, dt: f64, blame: &str) {
    let ai = arg as usize;
    match kind {
        SINK_ROD_STEP => {
            if arg >= 0 && ai < act.cores.len() {
                rod_apply(act, ai, v, dt);
            }
        }
        SINK_FREG => {
            if arg >= 0 && ai < act.freg.len() && act.freg_exist[ai] {
                act.freg[ai] = clamp(v, 0.0, 1.0);
            }
        }
        SINK_RELIEF => {
            if arg >= 0 && ai < act.relief.len() {
                let cell = &mut act.relief[ai];
                if cell.exist && !cell.spring {
                    relief_cmd(cell, v > 0.5);
                }
            }
        }
        SINK_FLOW_DEM => {
            if arg >= 0 && ai < act.flow.len() && act.flow_exist[ai] {
                act.flow[ai] = clamp(v / 100.0, 0.0, 1.5);
            }
        }
        SINK_LOAD_DEM => {
            act.load_dem = clamp(v / 100.0, 0.0, act.load_max);
        }
        SINK_BORON_DEM => {
            act.boron_dem = v;
        }
        SINK_VALVE_DEM => {
            if arg >= 0 && ai < act.valve.len() && act.valve_exist[ai] {
                act.valve[ai] = clamp(v / 100.0, 0.0, 1.0);
            }
        }
        SINK_TANK_OPEN => {
            if arg >= 0 && ai < act.tank.len() && act.tank_exist[ai] {
                act.tank[ai] = v > 0.5;
            }
        }
        SINK_SCRAM => {
            if arg >= 0 && ai < act.cores.len() {
                let lag = act.rps_lag;
                let c = &mut act.cores[ai];
                let hot = v > 0.5;
                c.rps_hot = if hot { c.rps_hot + dt } else { 0.0 };
                if hot && !c.scrammed && c.rps_hot >= lag - dt * 0.5 {
                    c.scrammed = true;
                    c.rod_dem = 1.0;
                    c.trip = if blame.is_empty() {
                        "AUTOMATIC SCRAM".to_string()
                    } else {
                        format!("RPS TRIP / {blame}")
                    };
                    if !c.dmg_rod {
                        c.rod_jam = false;
                    }
                }
            }
        }
        SINK_NEAR_TRIP => {
            if arg >= 0 && ai < act.cores.len() {
                act.cores[ai].rps_near = v > 0.5;
            }
        }
        SINK_RUNBACK => {
            let hot = v > 0.5;
            if hot && !act.rb_hot {
                let mut live = 0.0;
                for c in &act.cores {
                    if !c.scrammed {
                        live += c.rated;
                    }
                }
                let cap = if act.p_rated > 0.0 { live / act.p_rated } else { 0.0 };
                let nv = js_min(act.load, js_max(0.05, cap));
                act.load = nv;
                act.load_dem = nv;
            }
            act.rb_hot = hot;
        }
        _ => {}
    }
}

/// One `ctlPass`: Kahn order, per-block eval in order, sinks applied inline.
/// A dark cabinet (`live == false`) holds every output and writes no sink.
pub fn ctl_replay(s: &Sample) -> Replay {
    let mut out = s.out_pre.clone();
    let mut f = s.f_pre.clone();
    let mut act = s.act.clone();
    if !s.live {
        return Replay { out, f, act };
    }
    let n = s.blocks.len();
    let mut ins = vec![0.0f64; 3];
    for &id in ctl_order(&s.blocks).iter() {
        let b = &s.blocks[id];
        if !b.on {
            continue;
        }
        ins.resize(b.inputs.len(), 0.0);
        for (i, &src) in b.inputs.iter().enumerate() {
            ins[i] = if src >= 0 && (src as usize) < n {
                out[src as usize]
            } else {
                0.0
            };
        }
        let (v, f_new) = blk_eval(b, &ins, s.dt, out[id], f[id]);
        f[id] = f_new;
        if b.mode == MODE_SINK && !b.dead {
            sink_apply(&mut act, b.sink_kind, b.sink_arg, at(&ins, 0), s.dt, &b.blame);
        }
        if v.is_finite() {
            out[id] = v;
        }
    }
    Replay { out, f, act }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_fifo_and_cycle_tail() {
        // a <- b <- c plus a self-loop-free cycle d <-> e.
        let b = |inputs: Vec<i32>| Block {
            mode: MODE_MATH,
            on: true,
            inputs,
            knob: [f64::NAN; 13],
            nullmask: 0,
            math_op: 0,
            sel_op: 0,
            cmp_op: 0,
            src_val: 0.0,
            sink_kind: SINK_UNKNOWN,
            sink_arg: -1,
            dead: false,
            blame: String::new(),
        };
        let blocks = vec![
            b(vec![]),
            b(vec![0]),
            b(vec![1]),
            b(vec![4]),
            b(vec![3]),
        ];
        assert_eq!(ctl_order(&blocks), vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn pid_filter_matches_js_op_order() {
        // e=1, rate=0.5, kp=2, ti=10, td=1, n=8, dt=0.02, f0=0.
        let mut knob = [f64::NAN; 13];
        knob[KNOB_KP] = 2.0;
        knob[KNOB_TI] = 10.0;
        knob[KNOB_TD] = 1.0;
        knob[KNOB_N] = 8.0;
        knob[KNOB_DB] = 0.0;
        let b = Block {
            mode: MODE_PID,
            on: true,
            inputs: vec![0, 0],
            knob,
            nullmask: 0,
            math_op: 0,
            sel_op: 0,
            cmp_op: 0,
            src_val: 0.0,
            sink_kind: SINK_UNKNOWN,
            sink_arg: -1,
            dead: false,
            blame: String::new(),
        };
        let (u, f) = blk_eval(&b, &[1.0, 0.5], 0.02, 0.0, 0.0);
        let ff = 0.0f64 + (0.02f64 / (1.0f64 / 8.0f64).max(0.02)).min(1.0) * (0.5 - 0.0);
        let uu = 2.0 * (ff + 1.0 / 10.0 + 1.0 * (ff - 0.0) / 0.02f64.max(1e-9)) * 0.02;
        assert_eq!(f.to_bits(), ff.to_bits());
        assert_eq!(u.to_bits(), uu.to_bits());
    }
}
