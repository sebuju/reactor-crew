//! Secondary-side replayer for the §6.6 sec gate (`node tools/sec-gate.js`).
//! Replays the extracted tick segment (`actFollow` … `secTankStep`) per
//! sample from dumped live state (dump-kit: solved outs, field bags,
//! transport artifacts, piece masks, structural tables) and demands exact
//! discrete/event agreement plus sdig-semantics float agreement (`pow`/`exp`
//! flow through the UA laws). Dev-only.
use sim_rs::sec::*;
use sim_rs::tick::*;
use std::collections::HashMap;

struct Cur<'a> {
    b: &'a [u8],
    o: usize,
}
impl<'a> Cur<'a> {
    fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
        v
    }
    fn i32(&mut self) -> i32 {
        let v = i32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
        v
    }
    fn f64(&mut self) -> f64 {
        let v = f64::from_le_bytes([
            self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3],
            self.b[self.o + 4], self.b[self.o + 5], self.b[self.o + 6], self.b[self.o + 7],
        ]);
        self.o += 8;
        v
    }
    fn u8(&mut self) -> u8 {
        let v = self.b[self.o];
        self.o += 1;
        v
    }
    fn f64a(&mut self, n: usize) -> Vec<f64> {
        (0..n).map(|_| self.f64()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n).map(|_| self.i32()).collect()
    }
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn str(&mut self) -> String {
        let n = self.u32() as usize;
        let v = String::from_utf8(self.b[self.o..self.o + n].to_vec()).unwrap();
        self.o += n;
        v
    }
    fn strs(&mut self, n: usize) -> Vec<String> {
        (0..n).map(|_| self.str()).collect()
    }
    fn strsn(&mut self) -> Vec<String> {
        let n = self.u32() as usize;
        self.strs(n)
    }
    fn f64an(&mut self) -> Vec<f64> {
        let n = self.u32() as usize;
        self.f64a(n)
    }
    fn u8an(&mut self) -> Vec<u8> {
        let n = self.u32() as usize;
        self.u8a(n)
    }
    fn i32an(&mut self) -> Vec<i32> {
        let n = self.u32() as usize;
        self.i32a(n)
    }
    fn u32an(&mut self) -> Vec<u32> {
        let n = self.u32() as usize;
        self.u32a(n)
    }
    fn strmap(&mut self) -> HashMap<String, f64> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.f64();
            m.insert(k, v);
        }
        m
    }
    fn strmap_b(&mut self) -> HashMap<String, bool> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.u8() != 0;
            m.insert(k, v);
        }
        m
    }
    fn bag(&mut self, n: usize) -> Bag {
        Bag { v: self.f64a(n), has: self.u8a(n) }
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

struct Cmp {
    fails: u32,
    worst: f64,
    worst_at: String,
    shown: u32,
}

impl Cmp {
    fn floats(&mut self, si: usize, nm: &str, got: &HashMap<String, f64>, want: &HashMap<String, f64>) {
        let mut gk: Vec<&String> = got.keys().collect();
        let mut wk: Vec<&String> = want.keys().collect();
        gk.sort();
        wk.sort();
        if gk != wk {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} key mismatch");
                self.shown += 1;
            }
            return;
        }
        for k in gk {
            let (a, b) = (got[k], want[k]);
            if bits(a, b) {
                continue;
            }
            if a.is_nan() || b.is_nan() {
                self.fails += 1;
                if self.shown < 10 {
                    println!("sample {si}: {nm}[{k}] {a:e} vs {b:e} (NaN mismatch)");
                    self.shown += 1;
                }
                continue;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{k}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 10 {
                    println!("sample {si}: {nm}[{k}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                } else {
                    break;
                }
            }
        }
    }
    fn float1(&mut self, si: usize, nm: &str, a: f64, b: f64) {
        if bits(a, b) {
            return;
        }
        if a.is_nan() || b.is_nan() {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} {a:e} vs {b:e} (NaN mismatch)");
                self.shown += 1;
            }
            return;
        }
        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if r > self.worst {
            self.worst = r;
            self.worst_at = format!("sample {si}: {nm} {a} vs {b}");
        }
        if r > 1e-6 {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} {a:e} vs {b:e} (rel {r:e})");
                self.shown += 1;
            }
        }
    }
    fn bits_eq(&mut self, si: usize, nm: &str, got: &HashMap<String, bool>, want: &HashMap<String, bool>) {
        let mut gk: Vec<&String> = got.keys().collect();
        let mut wk: Vec<&String> = want.keys().collect();
        gk.sort();
        wk.sort();
        if gk != wk || gk.iter().any(|k| got[*k] != want[*k]) {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} bitmask mismatch");
                self.shown += 1;
            }
        }
    }
    fn strs(&mut self, si: usize, nm: &str, got: &[String], want: &[String]) {
        if got != want {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} list mismatch {got:?} vs {want:?}");
                self.shown += 1;
            }
        }
    }
    fn text(&mut self, si: usize, nm: &str, a: &str, b: &str) {
        if a != b {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} {a:?} vs {b:?}");
                self.shown += 1;
            }
        }
    }
}

fn read_smap(c: &mut Cur, n: usize) -> SMap {
    let keys = c.strs(n);
    let vals = c.f64a(n);
    SMap { keys, vals }
}

fn read_curve(c: &mut Cur) -> sim_rs::eos::Curve {
    let k: Vec<f64> = (0..17).map(|_| c.f64()).collect();
    sim_rs::eos::Curve::new(
        k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], k[10],
        k[11], k[12], k[13], k[14], k[15], k[16],
    )
}

fn read_curves(c: &mut Cur, _meta: &SecMeta) -> SecCurves {
    let n = c.u32() as usize;
    let mut curves = vec![];
    for _ in 0..n {
        curves.push(read_curve(c));
    }
    let water = read_curve(c);
    let set_p = c.f64a(n);
    SecCurves { curves, water, set_p }
}

fn read_inputs(c: &mut Cur, meta: &SecMeta, dt: f64) -> SecIn {
    let sc_v = {
        let v = c.f64a(7);
        [v[0], v[1], v[2], v[3], v[4], v[5], v[6]]
    };
    let by_typed = c.u8() != 0;
    let by_v = if by_typed { c.f64a(meta.by_keys.len()) } else { vec![] };
    let by_vals = if by_typed { HashMap::new() } else { c.strmap() };
    let q_tank = c.strmap();
    let relief_v = c.strmap();
    let sgtr_typed = c.u8() != 0;
    let sgtr_v = if sgtr_typed { c.f64a(meta.sgtr_keys.len()) } else { vec![] };
    let sgtr_by = if sgtr_typed { HashMap::new() } else { c.strmap() };
    let sg_feed = c.strmap();
    let sg_steam = c.strmap();
    let by_loop = c.strmap();
    let n_rf = c.u32() as usize;
    let run_flow_keys = c.strs(n_rf);
    let run_flow_vals = c.f64a(run_flow_keys.len());
    let advect_out_pri = c.f64();
    let advect_out_sec = c.f64();
    let advect_landed = c.strmap();
    let advect_edge_kg = {
        let n = c.u32() as usize;
        c.f64a(n)
    };
    let out_kg = c.strmap();
    let shells_live = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let nv = c.u32() as usize;
            let v = c.strs(nv);
            m.insert(k, v);
        }
        m
    };
    let vent_edges = {
        let n = c.u32() as usize;
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let k = c.str();
            let q = c.f64();
            v.push((k, q));
        }
        v
    };
    let dgen = c.f64();
    let net_burst_gen = c.f64();
    let m_by_piece = {
        let n = c.u32() as usize;
        c.i32a(n)
    };
    let core_piece = c.i32();
    let core_pieces: Vec<i32> = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let core_heat = c.strmap();
    let in_loop_bits: Vec<Vec<bool>> = {
        let n = c.u32() as usize;
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let m = c.u32() as usize;
            v.push(c.u8a(m).iter().map(|&x| x != 0).collect());
        }
        v
    };
    let hold_live = c.u8a(meta.hold_tank_ids.len()).iter().map(|&v| v != 0).collect();
    let stage_fed = {
        let n = c.u32() as usize;
        c.u8a(n).iter().map(|&v| v != 0).collect()
    };
    let core_fn = c.strmap();
    let tank_p = c.f64a(meta.tank_ids.len());
    let exh_open = c.u8() != 0;
    let role_turb_alive = c.i32();
    let cont_rel = c.strmap();
    let feed_in_mv = c.f64an();
    let feed_in_hv = c.f64an();
    let feed_in_hm = {
        let n = c.u32() as usize;
        c.u8a(n)
    };
    SecIn {
        dt, sc_v, by_typed, by_v, by_vals, q_tank, relief_v, sgtr_typed,
        sgtr_v, sgtr_by, sg_feed, sg_steam, by_loop, run_flow_keys,
        run_flow_vals, advect_out_pri, advect_out_sec, advect_landed,
        advect_edge_kg, out_kg, shells_live, vent_edges, dgen, net_burst_gen,
        m_by_piece, core_piece, core_pieces, cont_rel, role_turb_alive,
        core_heat, in_loop_bits, hold_live, stage_fed, tank_p, core_fn, exh_open,
        feed_in_mv, feed_in_hv, feed_in_hm,
    }
}

fn read_meta(c: &mut Cur) -> SecMeta {
    let core_ids = c.strsn();
    let circ_of_core = c.i32a(core_ids.len());
    let core_inv_kg0 = c.f64a(core_ids.len());
    let n_circ_key = c.u32() as usize;
    let mut circ_key_of = vec![None; n_circ_key];
    for i in 0..n_circ_key {
        let s = c.str();
        circ_key_of[i] = if s.is_empty() { None } else { Some(s) };
    }
    let core_circ = c.i32();
    let core_circs = c.u8an().iter().map(|&v| v != 0).collect();
    let backup = c.f64();
    let hold_circs = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let hold_on_circ: Vec<Vec<String>> = {
        let n = c.u32() as usize;
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let m = c.u32() as usize;
            v.push(c.strs(m));
        }
        v
    };
    let drum_ids = c.strsn();
    let boiler_ids = c.strsn();
    let sg_ids = c.strsn();
    let sg_loop = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let pump_ids = c.strsn();
    let primary_pump = c.u8a(pump_ids.len()).iter().map(|&v| v != 0).collect();
    let mut pump_res = vec![];
    let mut pump_suc = vec![];
    let mut pump_edge = vec![];
    for _ in &pump_ids {
        pump_res.push(c.strsn());
        let s = c.str();
        pump_suc.push(if s.is_empty() { None } else { Some(s) });
        let s = c.str();
        pump_edge.push(if s.is_empty() { None } else { Some(s) });
    }
    let pump_rotor = c.f64a(pump_ids.len());
    let part_ids = c.strsn();
    let sg_efw_off = c.f64();
    let sg_dry = c.f64();
    let sgl_set = c.f64();
    let sg_dome = c.f64();
    let boiler_node = c.strs(boiler_ids.len());
    let boiler_circ = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let feed_node = c.strs(boiler_ids.len());
    let n_edges = c.u32() as usize;
    let edge_gas_at = c.i32a(n_edges);
    let edge_u = c.i32a(n_edges);
    let edge_kind = c.strsn();
    let edge_key = c.strsn();
    let cond_break_keys = c.strsn();
    let tank_auto = c.strsn();
    let cond_ids = c.strsn();
    let cond_sinks = c.strsn();
    let mut cond_in_a = vec![];
    for _ in &cond_ids {
        let s = c.str();
        cond_in_a.push(if s.is_empty() { None } else { Some(s) });
    }
    let cond_vacuum = c.u8a(cond_ids.len()).iter().map(|&v| v != 0).collect();
    let cond_vol = c.f64a(cond_ids.len());
    let mut cw_paths = vec![];
    for _ in &cond_ids {
        let n = c.u32() as usize;
        let mut v = vec![];
        for _ in 0..n {
            v.push((c.str(), c.str(), c.str()));
        }
        cw_paths.push(v);
    }
    let rad_ids = c.strsn();
    let rad_ua = c.f64a(rad_ids.len());
    let rad_mass = c.f64a(rad_ids.len());
    let part_vol = c.f64a(rad_ids.len());
    let rad_coat_emis = c.f64a(rad_ids.len());
    let rad_area = c.f64a(rad_ids.len());
    let tick_rad_key = c.strs(rad_ids.len());
    let mut rad_internal = vec![];
    for _ in &rad_ids {
        rad_internal.push((c.str(), c.str()));
    }
    let rad_live = c.u8a(rad_ids.len()).iter().map(|&v| v != 0).collect();
    let ihx_ids = c.strsn();
    let ihx_ua = c.f64a(ihx_ids.len());
    let is_drum = c.u8a(boiler_ids.len()).iter().map(|&v| v != 0).collect();
    let sg_active_ihx = c.u8a(ihx_ids.len()).iter().map(|&v| v != 0).collect();
    let prompt_f = c.f64();
    let sg_ua = c.f64a(sg_ids.len());
    let sg_design_p = c.f64a(sg_ids.len());
    let sg_mass = c.f64a(sg_ids.len());
    let sg_burst_p = c.f64a(sg_ids.len());
    let sg_active: Vec<bool> = c.u8a(sg_ids.len()).iter().map(|&v| v != 0).collect();
    let shell_node = c.strs(sg_ids.len());
    let shell_circ = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let sg_prim_circ = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let mut prim_faces = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let k = c.str();
            let a = c.str();
            let b = c.str();
            prim_faces.insert(k, (a, b));
        }
    }
    let dry_min_kg = c.f64();
    let dose = c.f64();
    let in_core_node = c.u8an().iter().map(|&v| v != 0).collect();
    let net_vol = c.f64an();
    let hold_line = c.strsn();
    let cond_role_part = {
        let v = c.i32();
        if v < 0 { None } else { Some(v as usize) }
    };
    let cond_p_des = c.f64();
    let n_cells = c.u32() as usize;
    let region_of = c.i32a(n_cells);
    let n_regions = c.u32() as usize;
    let pcont = c.f64();
    let gw = c.u32() as usize;
    let gh = c.u32() as usize;
    let cond_ves_node = c.strs(cond_ids.len());
    let tank_ids = c.strsn();
    let mut tanks = vec![];
    for _ in &tank_ids {
        let vol = c.f64();
        let level = c.f64();
        let fluid = c.str();
        let hold = c.u8() != 0;
        let has_hp = c.u8() != 0;
        let hold_p = if has_hp { Some(c.f64()) } else { None };
        let inf = c.u8() != 0;
        let cell = c.u8() != 0;
        let has_gas = c.u8() != 0;
        let gas_p0 = if has_gas { Some(c.f64()) } else { None };
        let has_b = c.u8() != 0;
        let burst = if has_b { Some(TankBurst { at: c.f64(), drain: c.f64(), rel: c.f64() }) } else { None };
        let auto = c.str();
        let in_field = c.u8() != 0;
        let primary = c.u8() != 0;
        let circuit = c.i32();
        tanks.push(TankRow { vol, level, fluid, hold, hold_p, inf, cell, gas_p0, burst, auto, in_field, primary, circuit });
    }
    let tank_kg = c.f64a(tank_ids.len());
    let tank_node = c.strs(tank_ids.len());
    let break_key = c.strs(tank_ids.len());
    let tank_gone = c.u8a(tank_ids.len()).iter().map(|&v| v != 0).collect();
    let tank_primary = c.u8a(tank_ids.len()).iter().map(|&v| v != 0).collect();
    let primary_core = c.str();
    let core_on_circ = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.strsn()).collect()
    };
    let circ_of_core = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let core_piece_nodes = {
        let n = c.u32() as usize;
        (0..n).map(|_| c.i32()).collect()
    };
    let core_piece_node = c.i32();
    let inv_kg0 = c.f64();
    let sec_tank_ids = c.u32an().iter().map(|&v| v as usize).collect();
    let hold_tank_ids = c.u32an().iter().map(|&v| v as usize).collect();
    let relief_ids = c.strsn();
    let relief_pri = c.u32an().iter().map(|&v| v as usize).collect();
    let relief_sec = c.strsn();
    let relief_node = c.strs(relief_ids.len());
    let mut fits = vec![];
    for _ in &relief_ids {
        fits.push(FitRow { lift: c.f64(), reseat: c.f64(), spring: c.u8() != 0, has_target: c.u8() != 0 });
    }
    let vent_key = {
        let mut v = vec![];
        for _ in &relief_ids {
            let s = c.str();
            v.push(if s.is_empty() { None } else { Some(s) });
        }
        v
    };
    let out_keys = c.strsn();
    let out_pos = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let v = c.u32() as usize;
            m.insert(k, v);
        }
        m
    };
    let part_of = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let v = c.u32() as usize;
            m.insert(k, v);
        }
        m
    };
    let shells_of = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            m.insert(k, c.strsn());
        }
        m
    };
    let by_keys = c.strsn();
    let sgtr_keys = c.strsn();
    let sgtr_key = c.strs(sg_ids.len());
    let (stage_keys, stage_in_nbr) = {
        let n = c.u32() as usize;
        let mut k = HashMap::new();
        let mut nb = HashMap::new();
        for _ in 0..n {
            let id = c.str();
            let k0 = c.str();
            let k1 = c.str();
            let n0 = c.u32() as usize;
            let v0 = c.i32a(n0);
            let n1 = c.u32() as usize;
            let v1 = c.i32a(n1);
            k.insert(id.clone(), (
                if k0.is_empty() { None } else { Some(k0) },
                if k1.is_empty() { None } else { Some(k1) },
            ));
            nb.insert(id, (v0, v1));
        }
        (k, nb)
    };
    let net_ref_by_run = c.strmap();
    let pipe_runs = {
        let n = c.u32() as usize;
        let mut v = vec![];
        for _ in 0..n {
            let key = c.str();
            let nc = c.u32() as usize;
            let mut cells = vec![];
            for _ in 0..nc {
                let x = c.i32();
                let y = c.i32();
                cells.push((x, y));
            }
            v.push(PipeRun { key, cells });
        }
        v
    };
    let run_rating = c.f64a(pipe_runs.len());
    let run_node = c.strs(pipe_runs.len());
    let wall_cells = {
        let n = c.u32() as usize;
        let mut v = vec![];
        for _ in 0..n {
            let k = c.str();
            let x = c.i32();
            let y = c.i32();
            let tight = c.u8() != 0;
            let burst_p = c.f64();
            v.push(WallCell { k, x, y, tight, burst_p });
        }
        v
    };
    let net_names = c.strsn();
    let net_index = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let v = c.u32() as usize;
            m.insert(k, v);
        }
        m
    };
    let net_vapour = c.u8a(net_names.len());
    let net_booked = c.u8a(net_names.len());
    let circ_of_node = c.i32a(net_names.len());
    let fold_map = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let v = c.str();
            m.insert(k, v);
        }
        m
    };
    let parts = {
        let n = c.u32() as usize;
        let mut v = vec![];
        for _ in 0..n {
            let id = c.str();
            let role = c.str();
            let x = c.i32();
            let y = c.i32();
            let w = c.i32();
            let h = c.i32();
            v.push(PartRow { id, role, x, y, w, h });
        }
        v
    };
    let fire_rows = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let wlhv = c.f64();
            let wh2 = c.f64();
            let wh2o = c.f64();
            let wast = c.f64();
            let wast_max = c.f64();
            m.insert(k, FireRow { wlhv, wh2, wh2o, wast, wast_max });
        }
        m
    };
    let nci = c.u32() as usize;
    let mut circ_burn = vec![];
    for _ in 0..nci {
        let s = c.str();
        circ_burn.push(if s.is_empty() { None } else { Some(s) });
    }
    let steam_rise = c.f64();
    let room_steam_h = c.f64();
    let loop_kg = c.f64();
    let core_dt0 = c.f64();
    let p0 = c.f64();
    let tref = c.f64();
    let rated = c.f64();
    let flow_k = c.f64();
    let flow_min = c.f64();
    let p_sat_cp = c.f64();
    SecMeta {
        core_ids, circ_of_core, core_inv_kg0, circ_key_of, core_circ, core_circs, backup,
        hold_circs, hold_on_circ, drum_ids, boiler_ids, boiler_circ, sg_ids, sg_loop,
        pump_ids, primary_pump, pump_res, pump_suc, pump_edge, pump_rotor,
        part_ids, sg_efw_off, sg_dry, sgl_set, sg_dome, boiler_node,
        feed_node, edge_gas_at, edge_u, edge_kind, edge_key,
        cond_break_keys, tank_auto, cond_ids, cond_sinks, cond_in_a,
        cond_vacuum, cond_vol, cw_paths, rad_ids, rad_ua, rad_mass, part_vol,
        rad_coat_emis, rad_area, tick_rad_key, rad_internal, rad_live,
        prompt_f, sg_ua, sg_design_p, sg_mass, sg_burst_p,
        sg_active_sg: sg_active.clone(), sg_active_ihx, sg_active,
        ihx_ids, ihx_ua, is_drum,
        shell_node, shell_circ, sg_prim_circ, prim_faces, dry_min_kg, dose,
        in_core_node, net_vol, hold_line, cond_role_part,
        cond_p_des, region_of, n_regions, pcont, gw, gh, cond_ves_node,
        tank_ids, tanks, tank_kg, tank_node, break_key, tank_gone,
        tank_primary, primary_core, core_on_circ, core_piece_nodes, core_piece_node,
        loop_nodes_n: 0, fold_map, parts,
        fire_rows, circ_burn, steam_rise, room_steam_h, loop_kg, core_dt0,
        p0, tref, rated, flow_k, flow_min, inv_kg0, p_sat_cp,
        sec_tank_ids, hold_tank_ids, relief_ids, relief_pri, relief_sec,
        relief_node, fits, vent_key, out_keys, out_pos, part_of, shells_of,
        by_keys, sgtr_keys, sgtr_key, stage_keys, stage_in_nbr,
        net_ref_by_run, pipe_runs, run_rating,
        run_node, wall_cells, net_names, net_index, net_vapour, net_booked,
        circ_of_node,
    }
}

fn read_state(c: &mut Cur, meta: &SecMeta) -> SecState {
    let nf = c.u32() as usize;
    let mut f64s = HashMap::new();
    for _ in 0..nf {
        f64s.insert(c.str(), c.f64());
    }
    let nb = c.u32() as usize;
    let mut u8s = HashMap::new();
    for _ in 0..nb {
        u8s.insert(c.str(), c.u8() != 0);
    }
    let mut maps = HashMap::new();
    let nm = c.u32() as usize;
    for _ in 0..nm {
        let k = c.str();
        let n = c.u32() as usize;
        maps.insert(k, read_smap(c, n));
    }
    let mut bmaps = HashMap::new();
    let nbm = c.u32() as usize;
    for _ in 0..nbm {
        let k = c.str();
        let n = c.u32() as usize;
        let keys = c.strs(n);
        let vals = c.u8a(n);
        let mut m = SMapB { keys: vec![], vals: vec![] };
        m.keys = keys;
        m.vals = vals;
        bmaps.insert(k, m);
    }
    let mut bags = HashMap::new();
    let nbg = c.u32() as usize;
    for _ in 0..nbg {
        let k = c.str();
        let n = c.u32() as usize;
        bags.insert(k, c.bag(n));
    }
    let mut relief = HashMap::new();
    let nr = c.u32() as usize;
    for _ in 0..nr {
        let k = c.str();
        let v = c.u8a(5);
        relief.insert(k, ReliefCell {
            open: v[0] != 0, auto: v[1] != 0, stuck: v[2] != 0, arm: v[3] != 0, blocked: v[4] != 0,
        });
    }
    let mut cores = HashMap::new();
    for id in &meta.core_ids {
        let p = c.f64();
        let f = c.f64();
        cores.insert(id.clone(), SecCore { p_core: p, flow_net: f });
    }
    let nd = c.u32() as usize;
    let dmg_parts = c.strs(nd);
    let mut why = HashMap::new();
    let nw = c.u32() as usize;
    for _ in 0..nw {
        why.insert(c.str(), c.str());
    }
    let mass_out = c.strmap();
    let hb = HeatBal {
        prompt: c.f64(),
        decay: c.f64(),
        heat: c.f64(),
        removal: c.f64(),
        d_tavg: c.f64(),
        sg_q_by: {
            let n = c.u32() as usize;
            read_smap(c, n)
        },
        heat_by: {
            let n = c.u32() as usize;
            read_smap(c, n)
        },
    };
    let np = c.u32() as usize;
    let pump_live = c.strs(np);
    let net_burst_p = c.strmap();
    let seed = c.u32();
    let rng = c.i32();
    let dice_off = c.u8() != 0;
    let tank_byp = c.strmap_b();
    let tank_dump = c.strmap_b();
    let ref_open = c.u8() != 0;
    let net_burst_gen = c.f64();
    let n = meta.gw * meta.gh;
    let room_p = c.f64a(n);
    let room_water = c.f64a(n);
    let room_wp = c.f64a(n);
    let room_pool = c.f64a(n);
    let room_pool_p = c.f64a(n);
    SecState {
        f64s, u8s, strings: HashMap::new(), maps, bmaps, bags, relief, cores,
        dmg_parts, dmg_why: why, mass_out, mass_out_order: vec![], heatbal: hb, pump_live, net_burst_p,
        seed, rng, dice_off, tank_byp, tank_dump, ref_open, net_burst_gen,
        room_p, room_water, room_wp, room_pool, room_pool_p,
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    assert_eq!(c.u32(), 1, "format v1");
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    let mut n_samples = 0u32;
    let mut n_blocks = 0usize;
    for _pi in 0..np {
        let meta = read_meta(&mut c);
        if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("preset {_pi} meta ok o={}", c.o); }
        let curves = read_curves(&mut c, &meta);
        if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("preset {_pi} curves ok o={}", c.o); }
        let ns = c.u32() as usize;
        if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("preset {_pi} ns={ns} o={}", c.o); }
        for si in 0..ns {
            n_samples += 1;
            let tag = c.u32();
            let dt = c.f64();
            let pump_k = c.f64();
            if std::env::var("PROBE_DEBUG").is_ok() && si < 3 { eprintln!("preset {_pi} sample {si} head o={}", c.o); }
            let inp = read_inputs(&mut c, &meta, dt);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 3 { eprintln!("preset {_pi} sample {si} inputs ok o={}", c.o); }
            let pre = read_state(&mut c, &meta);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 3 { eprintln!("preset {_pi} sample {si} pre ok o={}", c.o); }
            let mut st = pre.clone();
            let r = sec_replay(&meta, &curves, &mut st, &inp, pump_k);
            // returned locals
            cmp.float1(si, "inj", r.inj, c.f64());
            let w_inj: Vec<String> = {
                let n = c.u32() as usize;
                c.strs(n)
            };
            cmp.strs(si, "injIds", &r.inj_ids, &w_inj);
            let w_cav: Vec<String> = {
                let n = c.u32() as usize;
                c.strs(n)
            };
            cmp.strs(si, "cavIds", &r.cav_ids, &w_cav);
            let w_sv = c.strmap();
            let mut g_sv: HashMap<String, f64> = HashMap::new();
            for (k, v) in &r.sec_vent {
                g_sv.insert(k.clone(), *v);
            }
            cmp.floats(si, "secVent", &g_sv, &w_sv);
            cmp.float1(si, "pCond", r.p_cond, c.f64());
            cmp.float1(si, "bleedAll", r.bleed_all, c.f64());
            // events
            let ne = c.u32() as usize;
            let mut w_ev = vec![];
            for _ in 0..ne {
                w_ev.push((c.u8(), c.u32()));
            }
            let g_ev: Vec<(u8, u32)> = r.events.iter().map(|e| (e.sev, e.code)).collect();
            if g_ev != w_ev {
                cmp.fails += 1;
                if cmp.shown < 10 {
                    println!("sample {si}: events {g_ev:?} vs {w_ev:?}");
                    cmp.shown += 1;
                }
            }
            cmp.float1(si, "warns", r.warns as f64, c.u32() as f64);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 3 { eprintln!("preset {_pi} sample {si} expected ok o={}", c.o); }
            // post state
            let want = read_state(&mut c, &meta);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 3 { eprintln!("preset {_pi} sample {si} post ok o={}", c.o); }
            compare_state(&mut cmp, si, &st, &want);
            n_blocks += 1;
            let _ = (tag, dt);
        }
    }
    assert_eq!(c.o, bytes.len(), "trailing bytes");
    println!(
        "samples={n_samples} blocks={n_blocks} worst-rel={:.2e} @ {} FAILURES={}",
        cmp.worst, cmp.worst_at, cmp.fails
    );
}

fn compare_state(cmp: &mut Cmp, si: usize, got: &SecState, want: &SecState) {
    let g: HashMap<String, f64> = got.f64s.clone();
    let w: HashMap<String, f64> = want.f64s.clone();
    cmp.floats(si, "f64", &g, &w);
    let gb: HashMap<String, bool> = got.u8s.clone();
    let wb: HashMap<String, bool> = want.u8s.clone();
    cmp.bits_eq(si, "u8", &gb, &wb);
    for (k, gm) in &got.maps {
        match want.maps.get(k) {
            Some(wm) => {
                let gg: HashMap<String, f64> =
                    gm.keys.iter().zip(gm.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
                let ww: HashMap<String, f64> =
                    wm.keys.iter().zip(wm.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
                cmp.floats(si, &format!("map:{k}"), &gg, &ww);
            }
            None => {
                cmp.fails += 1;
                if cmp.shown < 10 {
                    println!("sample {si}: map:{k} missing in want");
                    cmp.shown += 1;
                }
            }
        }
    }
    for k in want.maps.keys() {
        if !got.maps.contains_key(k) {
            cmp.fails += 1;
            if cmp.shown < 10 {
                println!("sample {si}: map:{k} missing in got");
                cmp.shown += 1;
            }
        }
    }
    for (k, gm) in &got.bmaps {
        match want.bmaps.get(k) {
            Some(wm) => {
                let gg: HashMap<String, bool> =
                    gm.keys.iter().zip(gm.vals.iter()).map(|(a, b)| (a.clone(), *b != 0)).collect();
                let ww: HashMap<String, bool> =
                    wm.keys.iter().zip(wm.vals.iter()).map(|(a, b)| (a.clone(), *b != 0)).collect();
                cmp.bits_eq(si, &format!("bmap:{k}"), &gg, &ww);
            }
            None => {
                cmp.fails += 1;
            }
        }
    }
    for (k, gb) in &got.bags {
        match want.bags.get(k) {
            Some(wb) => {
                if gb.has != wb.has {
                    cmp.fails += 1;
                    if cmp.shown < 10 {
                        println!("sample {si}: bag:{k} mask mismatch");
                        cmp.shown += 1;
                    }
                    continue;
                }
                for (i, (&a, &b)) in gb.v.iter().zip(wb.v.iter()).enumerate() {
                    if !(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())) {
                        if a.is_nan() || b.is_nan() {
                            cmp.fails += 1;
                            if cmp.shown < 10 {
                                println!("sample {si}: bag:{k}[{i}] {a:e} vs {b:e} (NaN mismatch)");
                                cmp.shown += 1;
                            }
                            break;
                        }
                        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                        if r > cmp.worst {
                            cmp.worst = r;
                            cmp.worst_at = format!("sample {si}: bag:{k}[{i}] {a} vs {b}");
                        }
                        if r > 1e-6 {
                            cmp.fails += 1;
                            if cmp.shown < 10 {
                                println!("sample {si}: bag:{k}[{i}] {a:e} vs {b:e} (rel {r:e})");
                                cmp.shown += 1;
                            }
                            break;
                        }
                    }
                }
            }
            None => {
                cmp.fails += 1;
            }
        }
    }
    // relief cells
    for (k, cell) in &got.relief {
        match want.relief.get(k) {
            Some(w) => {
                let gg = [cell.open as u8, cell.auto as u8, cell.stuck as u8, cell.arm as u8, cell.blocked as u8];
                let ww = [w.open as u8, w.auto as u8, w.stuck as u8, w.arm as u8, w.blocked as u8];
                if gg != ww {
                    cmp.fails += 1;
                    if cmp.shown < 10 {
                        println!("sample {si}: relief[{k}] {gg:?} vs {ww:?}");
                        cmp.shown += 1;
                    }
                }
            }
            None => {
                cmp.fails += 1;
            }
        }
    }
    for (k, cs) in &got.cores {
        match want.cores.get(k) {
            Some(w) => {
                cmp.float1(si, &format!("core[{k}].pCore"), cs.p_core, w.p_core);
                cmp.float1(si, &format!("core[{k}].flowNet"), cs.flow_net, w.flow_net);
            }
            None => {
                cmp.fails += 1;
            }
        }
    }
    cmp.strs(si, "dmgParts", &got.dmg_parts, &want.dmg_parts);
    let gd: HashMap<String, bool> = got.dmg_why.keys().map(|k| (k.clone(), true)).collect();
    let wd: HashMap<String, bool> = want.dmg_why.keys().map(|k| (k.clone(), true)).collect();
    cmp.bits_eq(si, "dmgWhyKeys", &gd, &wd);
    for (k, v) in &got.dmg_why {
        if let Some(w) = want.dmg_why.get(k) {
            cmp.text(si, &format!("dmgWhy[{k}]"), v, w);
        }
    }
    let gm: HashMap<String, f64> = got.mass_out.clone();
    cmp.floats(si, "massOut", &gm, &want.mass_out);
    let hb = &got.heatbal;
    let wh = &want.heatbal;
    cmp.float1(si, "hb.prompt", hb.prompt, wh.prompt);
    cmp.float1(si, "hb.decay", hb.decay, wh.decay);
    cmp.float1(si, "hb.heat", hb.heat, wh.heat);
    cmp.float1(si, "hb.removal", hb.removal, wh.removal);
    cmp.float1(si, "hb.dTavg", hb.d_tavg, wh.d_tavg);
    let gg: HashMap<String, f64> =
        hb.sg_q_by.keys.iter().zip(hb.sg_q_by.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
    let ww: HashMap<String, f64> =
        wh.sg_q_by.keys.iter().zip(wh.sg_q_by.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
    cmp.floats(si, "hb.sgQBy", &gg, &ww);
    let gg: HashMap<String, f64> =
        hb.heat_by.keys.iter().zip(hb.heat_by.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
    let ww: HashMap<String, f64> =
        wh.heat_by.keys.iter().zip(wh.heat_by.vals.iter()).map(|(a, b)| (a.clone(), *b)).collect();
    cmp.floats(si, "hb.heatBy", &gg, &ww);
    cmp.strs(si, "pumpLive", &got.pump_live, &want.pump_live);
    let gm: HashMap<String, f64> = got.net_burst_p.clone();
    cmp.floats(si, "netBurstP", &gm, &want.net_burst_p);
    if got.seed != want.seed || got.rng != want.rng || got.dice_off != want.dice_off {
        cmp.fails += 1;
        if cmp.shown < 10 {
            println!("sample {si}: rng state mismatch");
            cmp.shown += 1;
        }
    }
    if got.net_burst_gen.to_bits() != want.net_burst_gen.to_bits() {
        cmp.fails += 1;
        if cmp.shown < 10 {
            println!("sample {si}: netBurstGen mismatch");
            cmp.shown += 1;
        }
    }
    let gb: HashMap<String, bool> = got.tank_byp.clone();
    cmp.bits_eq(si, "tankByp", &gb, &want.tank_byp);
    let gb: HashMap<String, bool> = got.tank_dump.clone();
    cmp.bits_eq(si, "tankDump", &gb, &want.tank_dump);
    if got.ref_open != want.ref_open {
        cmp.fails += 1;
    }
    for (nm, gv, wv) in [
        ("roomP", &got.room_p, &want.room_p),
        ("roomWater", &got.room_water, &want.room_water),
        ("roomWP", &got.room_wp, &want.room_wp),
        ("roomPool", &got.room_pool, &want.room_pool),
        ("roomPoolP", &got.room_pool_p, &want.room_pool_p),
    ] {
        for (i, (&a, &b)) in gv.iter().zip(wv.iter()).enumerate() {
            if !(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())) {
                if a.is_nan() || b.is_nan() {
                    cmp.fails += 1;
                    if cmp.shown < 10 {
                        println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (NaN mismatch)");
                        cmp.shown += 1;
                    }
                    break;
                }
                let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                if r > cmp.worst {
                    cmp.worst = r;
                    cmp.worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
                }
                if r > 1e-6 {
                    cmp.fails += 1;
                    if cmp.shown < 10 {
                        println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                        cmp.shown += 1;
                    }
                    break;
                }
            }
        }
    }
}
