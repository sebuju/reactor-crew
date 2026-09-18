//! `sim_freeze` payload reader. The one writer is `src/sim/freeze.js`
//! (`FREEZE.build()`); the step gate writes its `freeze.bin` through it.
use std::collections::HashMap;

use crate::ctl::Sample;
use crate::frozen::{SteamBreak, TailFrozen};
use crate::ingest::{read_ctl_meta, read_ctl_sample_body, Cur};
use crate::live::{CtlFrozen, CtlLive, FrozenTable};
use crate::netlive::MatRegion;
use crate::solvelive::{EdgeFrozen, FrozenEdge};
use crate::step::CtlMeta;

pub const MAGIC: &[u8; 4] = b"RCFZ";
pub const VERSION: u32 = 1;

pub struct FreezeIn {
    pub edge: EdgeFrozen,
    pub tail: TailFrozen,
    pub ctl_sample: Sample,
    pub ctl_meta: CtlMeta,
    pub ctl_table: FrozenTable,
}

impl FreezeIn {
    pub fn ctl(&self) -> (CtlFrozen, CtlLive) {
        crate::live::freeze_ctl(self.ctl_sample.clone(), &self.ctl_table, &self.ctl_meta)
    }
}

/// `None` on a bad magic or version; a truncated body past the header panics
/// like every other `Cur` reader.
pub fn read_freeze(c: &mut Cur) -> Option<FreezeIn> {
    if c.b.len() < c.o + 8 || &c.b[c.o..c.o + 4] != MAGIC {
        return None;
    }
    c.o += 4;
    if c.u32() != VERSION {
        return None;
    }
    let edge = read_edge(c);
    let tail = read_tail(c);
    let ctl_sample = read_ctl_sample_body(c);
    let ctl_meta = read_ctl_meta(c);
    let ctl_table = read_table(c);
    Some(FreezeIn { edge, tail, ctl_sample, ctl_meta, ctl_table })
}

fn num_map(c: &mut Cur, keep: impl Fn(f64) -> bool) -> HashMap<String, f64> {
    let mut m = c.strmap();
    m.retain(|_, v| keep(*v));
    m
}

fn int_map(c: &mut Cur) -> HashMap<String, i64> {
    c.strmap().into_iter().filter(|(_, v)| v.is_finite()).map(|(k, v)| (k, v as i64)).collect()
}

fn str_map(c: &mut Cur) -> HashMap<String, String> {
    let n = c.u32() as usize;
    (0..n).map(|_| (c.str(), c.str())).collect()
}

fn idx_map<T>(c: &mut Cur, mut row: impl FnMut(&mut Cur) -> T) -> HashMap<usize, T> {
    let n = c.u32() as usize;
    (0..n).map(|_| (c.u32() as usize, row(c))).collect()
}

fn opt_str(c: &mut Cur) -> Option<String> {
    if c.u8() != 0 { Some(c.str()) } else { None }
}

fn opt_f64(c: &mut Cur) -> Option<f64> {
    if c.u8() != 0 { Some(c.f64()) } else { None }
}

fn read_edge(c: &mut Cur) -> EdgeFrozen {
    let steam_ref = c.f64();
    let (casing_f, pump_h0, head_k, tank_rho) = (c.f64(), c.f64(), c.f64(), c.f64());
    let (turb_c, swallow, bypass, rho0, rated) = (c.f64(), c.f64(), c.f64(), c.f64(), c.f64());
    let pump_head = num_map(c, |v| !v.is_nan());
    let pump_rho0 = num_map(c, |v| !v.is_nan());
    let pump_suc = str_map(c);
    let sec_circ = int_map(c);
    let pool_part_h = num_map(c, |v| !v.is_nan());
    let vent_circ = int_map(c);
    let vent_vac = c.strmap_b();
    let cond_sink_n = c.f64();
    let cond_sink_ids = c.strsn();
    let (cond_p_des, sg_byp_band, ptref) = (c.f64(), c.f64(), c.f64());
    let psteam = c.u8() != 0;
    let ns = c.u32() as usize;
    let suggest = (0..ns).map(|_| (c.i32(), c.f64())).collect();
    let fit_ids = c.strsn();
    let fit_relief = c.u8an().into_iter().map(|v| v != 0).collect();
    let sig_tanks = c.strsn();
    let ne = c.u32() as usize;
    let edges = (0..ne).map(|_| FrozenEdge {
        ck: c.i32(),
        cdead: opt_str(c),
        tid: opt_str(c),
        end: opt_str(c),
        freg: opt_str(c),
        pid: opt_str(c),
        cx: opt_f64(c).map(|v| v as i64),
        cy: opt_f64(c).map(|v| v as i64),
        pump: opt_str(c),
        pool_at: opt_f64(c).map(|v| v as i64),
        gate_mode: opt_str(c),
        gate_ids: c.strsn(),
        hsrc_fn: c.u8() != 0,
        inert: opt_f64(c),
        machine: opt_str(c),
    }).collect();
    EdgeFrozen {
        steam_ref, casing_f, pump_h0, head_k, tank_rho, turb_c, swallow, bypass, rho0, rated,
        pump_head, pump_rho0, pump_suc, sec_circ, pool_part_h, vent_circ, vent_vac,
        cond_sink_n, cond_sink_ids, cond_p_des, sg_byp_band, ptref, psteam, suggest,
        fit_ids, fit_relief, sig_tanks, edges,
    }
}

fn read_tail(c: &mut Cur) -> TailFrozen {
    let mut tf = TailFrozen::default();
    tf.cont_cell = idx_map(c, |c| (c.i32(), c.i32()));
    tf.part_of_node = idx_map(c, |c| c.str());
    tf.sec_t = c.u32an();
    tf.sec_t_parts = c.strsn();
    tf.cond_parts = c.strsn();
    tf.tank_id_by_node = idx_map(c, |c| c.str());
    let nl = c.u32() as usize;
    for _ in 0..nl {
        let ci = c.i32();
        let nodes = if c.u8() != 0 { Some(c.strsn()) } else { None };
        tf.loop_nodes.insert(ci, nodes);
    }
    let nb = c.u32() as usize;
    for _ in 0..nb {
        let nc = c.u32() as usize;
        let cells = (0..nc).map(|_| (c.i32(), c.i32())).collect();
        tf.steam_breaks.push(SteamBreak { cells, exh: c.u8() != 0 });
    }
    tf.regions.of = c.i32an();
    tf.regions.tight = c.u8an();
    let nr = c.u32() as usize;
    for _ in 0..nr {
        let bounded = c.u8() != 0;
        let wall = c.u32an();
        tf.regions.regions.push(MatRegion { bounded, wall, rel: c.f64() });
    }
    tf.core_k_net_ref = c.strmap();
    tf.trans_circs = c.i32an();
    let nt = c.u32() as usize;
    tf.trans_nids = (0..nt).map(|_| c.strsn()).collect();
    tf.trans_rise_e = c.u32an();
    tf.fit_bore_mm = c.strmap();
    tf.run_bore_mm = c.strmap();
    tf.fit_node = str_map(c);
    let np = c.u32() as usize;
    tf.nodes_of_part = (0..np).map(|_| (c.str(), c.u32an())).collect();
    tf.dgen = c.f64();
    tf.eff = c.f64();
    tf.pzr_k = c.f64();
    tf.h_turb = c.f64();
    tf.cond_ua = c.strmap();
    tf.cond_mass = c.strmap();
    tf.cw_ref = c.strmap();
    tf.scr_metal_qv = c.f64an();
    tf.scr_metal_qm = c.u8an();
    let ne = c.u32() as usize;
    tf.run_ends = (0..ne).map(|_| (c.str(), (c.str(), c.str()))).collect();
    tf.node_run_key = str_map(c);
    tf.cont_order = c.u32an();
    tf
}

fn read_table(c: &mut Cur) -> FrozenTable {
    FrozenTable {
        ids: c.strsn(),
        sig: c.strsn(),
        arg: c.strsn(),
        name: c.strsn(),
        seed_out: c.f64an(),
        seed_f: c.f64an(),
        rods_of: str_map(c),
        turb_id: opt_str(c),
        ctrl_id: opt_str(c),
        steam_ref: c.f64(),
    }
}
