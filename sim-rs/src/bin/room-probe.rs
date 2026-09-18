//! Room + sump replayer for the §6.6 room gate (`node tools/room-gate.js`).
//! Replays `sumpStep` then `roomStep` per sample from dumped live state
//! (dump-kit: solved/transport artifacts, tool orders, field bags) and
//! demands exact discrete/event agreement plus sdig-semantics float
//! agreement (`pow` flows through hull radiation and liquid friction).
//! Dev-only.
use sim_rs::room::*;
use sim_rs::tick::*;
use std::collections::{HashMap, HashSet};

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
    fn f32(&mut self) -> f32 {
        let v = f32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
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
    fn f32a(&mut self, n: usize) -> Vec<f32> {
        (0..n).map(|_| self.f32()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n).map(|_| self.i32()).collect()
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
            if self.shown < 1000000 {
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
                if self.shown < 1000000 {
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
                if self.shown < 1000000 {
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
            if self.shown < 1000000 {
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
            if self.shown < 1000000 {
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
            if self.shown < 1000000 {
                println!("sample {si}: {nm} bitmask mismatch");
                self.shown += 1;
            }
        }
    }
    fn strs(&mut self, si: usize, nm: &str, got: &[String], want: &[String]) {
        if got != want {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} list mismatch {got:?} vs {want:?}");
                self.shown += 1;
            }
        }
    }
    fn grid(&mut self, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        if got.len() != want.len() {
            self.fails += 1;
            if self.shown < 1000000 {
                println!("sample {si}: {nm} len {} vs {}", got.len(), want.len());
                self.shown += 1;
            }
            return;
        }
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) {
                continue;
            }
            if a.is_nan() || b.is_nan() {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (NaN mismatch)");
                    self.shown += 1;
                }
                break;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 1000000 {
                    println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                }
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

fn read_curves(c: &mut Cur) -> RoomCurves {
    let n = c.u32() as usize;
    let mut curves = vec![];
    for _ in 0..n {
        curves.push(read_curve(c));
    }
    let water = read_curve(c);
    let set_p = c.f64a(n);
    RoomCurves { curves, water, set_p }
}

fn read_meta(c: &mut Cur) -> RoomMeta {
    let gw = c.u32() as usize;
    let gh = c.u32() as usize;
    let mpc = c.f64();
    let pcont = c.f64();
    let loop_kg = c.f64();
    let steam_rise = c.f64();
    let room_steam_h = c.f64();
    let tref = c.f64();
    let der = RoomDer::new(mpc, c.f64());
    let nparts = c.u32() as usize;
    let mut parts = vec![];
    for _ in 0..nparts {
        let id = c.str();
        let role = c.str();
        let x = c.i32();
        let y = c.i32();
        let w = c.i32();
        let h = c.i32();
        let has_on = c.u8() != 0;
        let on = if has_on { Some(c.str()) } else { None };
        parts.push(RoomPart { id, role, x, y, w, h, on });
    }
    let nroles = c.u32() as usize;
    let mut roles = HashMap::new();
    for _ in 0..nroles {
        let role = c.str();
        let drown = c.u8() != 0;
        let thermal = c.str();
        let ni = c.u32() as usize;
        let mut internal = vec![];
        for _ in 0..ni {
            internal.push((c.str(), c.str()));
        }
        roles.insert(role, RoleRow { drown, thermal, internal });
    }
    let nfn = c.u32() as usize;
    let mut face_nodes = HashMap::new();
    for _ in 0..nfn {
        let id = c.str();
        face_nodes.insert(id, (c.str(), c.str(), c.str(), c.str()));
    }
    let core_ids = c.strsn();
    if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("meta parts ok o={}", c.o); }
    let mut core_nb = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            core_nb.insert(c.str(), c.u32() as usize);
        }
    }
    let tank_bkp = c.f64();
    let relief_ids = c.strsn();
    let relief_sec = c.strsn();
    let boiler_ids = c.strsn();
    let mut shell_node = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            shell_node.insert(c.str(), c.str());
        }
    }
    let mut part_roles = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            part_roles.insert(c.str(), c.str());
        }
    }
    let mut part_on = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let id = c.str();
            let has = c.u8() != 0;
            part_on.insert(id, if has { Some(c.str()) } else { None });
        }
    }
    let mut tank_hold = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            tank_hold.insert(c.str(), c.u8() != 0);
        }
    }
    let primary_relief = if c.u8() != 0 { Some(c.str()) } else { None };
    if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("meta tanks ok o={}", c.o); }
    let mut vent_key = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            vent_key.insert(c.str(), c.str());
        }
    }
    let mut circ_burn = vec![];
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let s = c.str();
            circ_burn.push(if s.is_empty() { None } else { Some(s) });
        }
    }
    let mut mat_tight = vec![];
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            mat_tight.push((c.i32(), c.i32()));
        }
    }
    let n_cells = c.u32() as usize;
    let region_of = c.i32a(n_cells);
    let n_regions = c.u32() as usize;
    let mut fire_rows = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let name = c.str();
            fire_rows.insert(name, FireFull {
                lhv: c.f64(), o2: c.f64(), ign: c.f64(), melt: c.f64(),
                boil: c.f64(), lf: c.f64(), rate: c.f64(), loc: c.f64(),
                emis: c.f64(), h_conv: c.f64(), sigma: c.f64(), eta: c.f64(),
                wlhv: c.f64(), wh2: c.f64(), wh2o: c.f64(), wrate: c.f64(),
                wast: c.f64(), wast_max: c.f64(),
            });
        }
    }
    let fire_cool = if c.u8() != 0 {
        Some(FireCool { cp: c.f64(), dens: c.f64(), bulk: c.f64() })
    } else {
        None
    };
    if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("meta fire ok o={}", c.o); }
    let mut by_runs = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let key = c.str();
            let nc = c.u32() as usize;
            let mut cells = vec![];
            for _ in 0..nc {
                cells.push((c.i32(), c.i32()));
            }
            let pa = c.str();
            let pb = c.str();
            by_runs.insert(key, ByRun {
                cells,
                pa: if pa.is_empty() { None } else { Some(pa) },
                pb: if pb.is_empty() { None } else { Some(pb) },
            });
        }
    }
    let mut port_cells = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let pid = c.str();
            let has = c.u8() != 0;
            port_cells.insert(pid, if has { Some((c.i32(), c.i32())) } else { None });
        }
    }
    let mut fit_target = HashSet::new();
    for s in c.strsn() {
        fit_target.insert(s);
    }
    let mut fit_vent_out = HashSet::new();
    for s in c.strsn() {
        fit_vent_out.insert(s);
    }
    if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("meta fit/bore ok o={}", c.o); }
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
    let circ_of_node = c.i32a(net_names.len());
    let mut circ_key_of = vec![];
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let s = c.str();
            circ_key_of.push(if s.is_empty() { None } else { Some(s) });
        }
    }
    let core_circs = c.u8an().iter().map(|&v| v != 0).collect();
    let authored = c.u8a(circ_key_of.len()).iter().map(|&v| v != 0).collect();
    let mut circ_of_extra = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            circ_of_extra.insert(c.str(), c.i32());
        }
    }
    // base G.
    let gn = c.u32() as usize;
    let g_occ = c.u8a(gn);
    let g_tight = c.u8a(gn);
    let g_face = c.u8a(gn);
    let mut g_own = vec![0i32; gn];
    for i in 0..gn {
        g_own[i] = c.i32();
    }
    let g_pan = c.u8a(gn);
    let g_turb = c.f64a(gn);
    let mut g_parts = vec![];
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let id = c.str();
            let m = c.u32() as usize;
            let mut cells = vec![];
            for _ in 0..m {
                cells.push(c.u32() as usize);
            }
            g_parts.push((id, cells));
        }
    }
    let mut g_runs = vec![];
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            let key = c.str();
            let m = c.u32() as usize;
            let mut cells = vec![];
            for _ in 0..m {
                cells.push(c.u32() as usize);
            }
            g_runs.push((key, cells));
        }
    }
    let mut g_shell_valves = HashMap::new();
    {
        let n = c.u32() as usize;
        for _ in 0..n {
            g_shell_valves.insert(c.str(), c.strsn());
        }
    }
    let g_bx = c.f64a(gn);
    let g_by = c.f64a(gn);
    let g_gx = c.f64a(gn);
    let g_gup = c.f64a(gn);
    let g_gdn = c.f64a(gn);
    RoomMeta {
        gw, gh, mpc, pcont, loop_kg, steam_rise, room_steam_h, der, parts,
        roles, face_nodes, core_ids, core_nb, tank_bkp, relief_ids, relief_sec,
        boiler_ids, shell_node, part_roles, part_on, tank_hold, primary_relief,
        vent_key, circ_burn, mat_tight, region_of, n_regions, fire_rows,
        fire_cool, by_runs, port_cells, fit_target, fit_vent_out,
        circ_of_node, circ_key_of, core_circs, authored, tref,
        net_names, net_index, net_vapour, circ_of_extra, g_occ, g_tight,
        g_face, g_own, g_pan, g_turb, g_parts, g_runs, g_shell_valves,
        g_bx, g_by, g_gx, g_gup, g_gdn,
    }
}

fn read_inputs(c: &mut Cur, meta: &RoomMeta, dt: f64) -> RoomIn {
    let spill_keys = c.strsn();
    let mut spill_by = HashMap::new();
    for k in &spill_keys {
        spill_by.insert(k.clone(), c.f64());
    }
    let relief_keys = c.strsn();
    let mut relief_vent = HashMap::new();
    for k in &relief_keys {
        relief_vent.insert(k.clone(), c.f64());
    }
    let out_kg = c.strmap();
    let out_h2 = c.strmap();
    let bore = c.strmap();
    let inj_present = c.u8() != 0;
    let (kind, rate, target) = if inj_present { (c.u8(), c.f64(), c.i32()) } else { (0, 0.0, -1) };
    let cg_it = c.u32();
    let pgen = c.u32();
    let gsx = c.f64an();
    let n = meta.gw * meta.gh;
    let disp = c.f64a(n);
    RoomIn {
        dt,
        spill_keys,
        spill_by,
        relief_keys,
        relief_vent,
        out_kg,
        out_h2,
        bore,
        inj: RoomInject { present: inj_present, kind, rate, target },
        cg_it,
        pgen,
        gsx,
        disp,
    }
}

fn read_state(c: &mut Cur, meta: &RoomMeta) -> RoomState {
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
    let ni = c.u32() as usize;
    let mut i32s = HashMap::new();
    for _ in 0..ni {
        i32s.insert(c.str(), c.i32());
    }
    let mut maps = HashMap::new();
    let nm = c.u32() as usize;
    for _ in 0..nm {
        let k = c.str();
        let n = c.u32() as usize;
        maps.insert(k, read_smap(c, n));
    }
    let mut bags = HashMap::new();
    let nbg = c.u32() as usize;
    for _ in 0..nbg {
        let k = c.str();
        let n = c.u32() as usize;
        bags.insert(k, c.bag(n));
    }
    let mut cores = HashMap::new();
    for id in &meta.core_ids {
        let rod_jam = c.u8() != 0;
        let rod_dem = c.f64();
        let tilt_dem = c.f64();
        let nzd = c.u32() as usize;
        let rod_z_dem = c.f64a(nzd);
        let rod_pos = c.f64();
        let tilt = c.f64();
        let nz = c.u32() as usize;
        let rod_z = c.f64a(nz);
        cores.insert(id.clone(), DmgCore {
            rod_jam, rod_dem, tilt_dem, rod_z_dem, rod_pos, tilt, rod_z,
            ..Default::default()
        });
    }
    let nd = c.u32() as usize;
    let dmg_parts = c.strs(nd);
    let mut why = HashMap::new();
    let nw = c.u32() as usize;
    for _ in 0..nw {
        why.insert(c.str(), c.str());
    }
    let mass_out = c.strmap();
    let burn_kg = c.f64();
    let burn_p = c.f64();
    let burn_blast = c.f64();
    let nn = c.u32() as usize;
    let burn_ids = c.strs(nn);
    let fire_kg = c.f64();
    let fire_p = c.f64();
    let fire_q = c.f64();
    let mut grids_f64 = GridMap::default();
    let mut grids_f32 = GridMap::default();
    let ng = c.u32() as usize;
    for _ in 0..ng {
        let k = c.str();
        let ty = c.u8();
        let m = c.u32() as usize;
        if ty == 0 {
            grids_f64.insert(k, c.f64a(m));
        } else {
            grids_f32.insert(k, c.f32a(m).iter().map(|v| *v as f64).collect());
        }
    }
    RoomState {
        f64s, u8s, i32s, maps, bags, cores, dmg_parts, dmg_why: why,
        mass_out, mass_out_order: vec![], burn_kg, burn_p, burn_blast, burn_ids, fire_kg, fire_p,
        fire_q, grids_f64, grids_f32,
    }
}

fn main() {
    if std::env::var("LIQ_DEBUG").is_ok() {
        sim_rs::room::LIQ_DEBUG.store(true, std::sync::atomic::Ordering::Relaxed);
    }
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
        if std::env::var("PROBE_DEBUG").is_ok() {
            let ids: Vec<&str> = meta.g_parts.iter().map(|(id, _)| id.as_str()).collect();
            eprintln!("preset {_pi} meta ok o={} gparts={ids:?} face04={:?}", c.o, &meta.g_face[0..4]);
        }
        let curves = read_curves(&mut c);
        if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("preset {_pi} curves ok o={}", c.o); }
        let ns = c.u32() as usize;
        if std::env::var("PROBE_DEBUG").is_ok() { eprintln!("preset {_pi} ns={ns} o={}", c.o); }
        for si in 0..ns {
            n_samples += 1;
            let tag = c.u32();
            let dt = c.f64();
            if std::env::var("PROBE_DEBUG").is_ok() && si < 2 { eprintln!("preset {_pi} sample {si} head o={}", c.o); }
            let inp = read_inputs(&mut c, &meta, dt);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 2 { eprintln!("preset {_pi} sample {si} inputs ok o={}", c.o); }
            let pre = read_state(&mut c, &meta);
            if std::env::var("PROBE_DEBUG").is_ok() && si < 2 {
                let w0 = pre.grids_f64.get("roomWater").map(|g| g[0]).unwrap_or(f64::NAN);
                let t0 = pre.grids_f64.get("roomT").map(|g| g[0]).unwrap_or(f64::NAN);
                eprintln!("preset {_pi} sample {si} pre ok o={} preW0={w0} preT0={t0}", c.o);
            }
            if std::env::var("PROBE_DEBUG").is_ok() && si == 6 {
                let pp = pre.grids_f32.get("roomPPk").map(|g| g[69]).unwrap_or(f64::NAN);
                let pr = pre.grids_f32.get("roomP").map(|g| g[69]).unwrap_or(f64::NAN);
                eprintln!("preset {_pi} sample {si} prePPk69={pp} preP69={pr}", );
            }
            let mut st = pre.clone();
            let f0 = cmp.fails;
            sim_rs::room::LIQ_SI.store(si as u32, std::sync::atomic::Ordering::Relaxed);
            sim_rs::room::LIQ_PI.store(_pi as u32, std::sync::atomic::Ordering::Relaxed);
            sim_rs::room::cap_warned_reset();
            if _pi == 8 && si == 4 {
                eprintln!("p8s4 pre fireKg map={:?} field={} fireOn={:?}", pre.f64s.get("fireKg"), pre.fire_kg, pre.f64s.get("roomFireOn"));
            }
            if _pi == 8 && si == 1 {
                let w = pre.grids_f64.get("roomWater");
                let e = pre.grids_f64.get("roomWaterE");
                if std::env::var("DUMPGRID").is_ok() {
                    if let Some(g) = w {
                        let bytes: Vec<u8> = g.iter().flat_map(|v| v.to_le_bytes()).collect();
                        let _ = std::fs::write(std::env::temp_dir().join("p8s1-rs-w.txt"), bytes);
                    }
                    if let Some(g) = e {
                        let bytes: Vec<u8> = g.iter().flat_map(|v| v.to_le_bytes()).collect();
                        let _ = std::fs::write(std::env::temp_dir().join("p8s1-rs-we.txt"), bytes);
                    }
                }
                eprintln!("p8s1 pre len={:?} w127={} w128={} w129={} e127={} e128={} e129={}",
                    w.map(|g| g.len()),
                    w.and_then(|g| g.get(127)).copied().unwrap_or(f64::NAN),
                    w.and_then(|g| g.get(128)).copied().unwrap_or(f64::NAN),
                    w.and_then(|g| g.get(129)).copied().unwrap_or(f64::NAN),
                    e.and_then(|g| g.get(127)).copied().unwrap_or(f64::NAN),
                    e.and_then(|g| g.get(128)).copied().unwrap_or(f64::NAN),
                    e.and_then(|g| g.get(129)).copied().unwrap_or(f64::NAN));
            }
            if std::env::var("INJ_DEBUG").is_ok() && inp.inj.present {
                eprintln!("preset {_pi} sample {si} inj kind={} rate={} tgt={}", inp.inj.kind, inp.inj.rate, inp.inj.target);
            }
            let r = room_replay(&meta, &curves, &mut st, &inp);
            // returned locals
            cmp.float1(si, "cgIt", r.cg_it as f64, c.u32() as f64);
            cmp.float1(si, "liqIt", r.liq_it as f64, c.u32() as f64);
            // events
            let ne = c.u32() as usize;
            let mut w_ev = vec![];
            for _ in 0..ne {
                w_ev.push((c.u8(), c.u32()));
            }
            let g_ev: Vec<(u8, u32)> = r.events.iter().map(|e| (e.sev, e.code)).collect();
            if g_ev != w_ev {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: events {g_ev:?} vs {w_ev:?}");
                    cmp.shown += 1;
                }
            }
            cmp.float1(si, "warns", r.warns as f64, c.u32() as f64);
            // post state
            let want = read_state(&mut c, &meta);
            compare_state(&mut cmp, si, &st, &want);
            let df = cmp.fails - f0;
            if df > 0 { println!("preset {_pi} sample {si}: nfail={df}"); }
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

fn compare_state(cmp: &mut Cmp, si: usize, got: &RoomState, want: &RoomState) {
    let g: HashMap<String, f64> = got.f64s.clone();
    let w: HashMap<String, f64> = want.f64s.clone();
    cmp.floats(si, "f64", &g, &w);
    let gb: HashMap<String, bool> = got.u8s.clone();
    let wb: HashMap<String, bool> = want.u8s.clone();
    cmp.bits_eq(si, "u8", &gb, &wb);
    let gi: HashMap<String, i32> = got.i32s.clone();
    let wi: HashMap<String, i32> = want.i32s.clone();
    let gib: HashMap<String, bool> = gi.keys().map(|k| (k.clone(), true)).collect();
    let wib: HashMap<String, bool> = wi.keys().map(|k| (k.clone(), true)).collect();
    cmp.bits_eq(si, "i32keys", &gib, &wib);
    for (k, v) in &gi {
        if let Some(wv) = wi.get(k) {
            if v != wv {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: i32[{k}] {v} vs {wv}");
                    cmp.shown += 1;
                }
            }
        }
    }
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
                if cmp.shown < 1000000 {
                    println!("sample {si}: map:{k} missing in want");
                    cmp.shown += 1;
                }
            }
        }
    }
    for k in want.maps.keys() {
        if !got.maps.contains_key(k) {
            cmp.fails += 1;
            if cmp.shown < 1000000 {
                println!("sample {si}: map:{k} missing in got");
                cmp.shown += 1;
            }
        }
    }
    for (k, gb) in &got.bags {
        match want.bags.get(k) {
            Some(wb) => {
                if gb.has != wb.has {
                    cmp.fails += 1;
                    if cmp.shown < 1000000 {
                        println!("sample {si}: bag:{k} mask mismatch");
                        cmp.shown += 1;
                    }
                    continue;
                }
                for (i, (&a, &b)) in gb.v.iter().zip(wb.v.iter()).enumerate() {
                    if !(a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())) {
                        if a.is_nan() || b.is_nan() {
                            cmp.fails += 1;
                            if cmp.shown < 1000000 {
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
                            if cmp.shown < 1000000 {
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
    for (k, cs) in &got.cores {
        match want.cores.get(k) {
            Some(w) => {
                let gb: HashMap<String, bool> =
                    [("rod_jam", cs.rod_jam)].iter().map(|(a, b)| (a.to_string(), *b)).collect();
                let wb: HashMap<String, bool> =
                    [("rod_jam", w.rod_jam)].iter().map(|(a, b)| (a.to_string(), *b)).collect();
                cmp.bits_eq(si, &format!("core[{k}].bits"), &gb, &wb);
                let gf: HashMap<String, f64> = [
                    ("rod_dem".to_string(), cs.rod_dem),
                    ("tilt_dem".to_string(), cs.tilt_dem),
                    ("rod_pos".to_string(), cs.rod_pos),
                    ("tilt".to_string(), cs.tilt),
                ]
                .into_iter()
                .collect();
                let wf: HashMap<String, f64> = [
                    ("rod_dem".to_string(), w.rod_dem),
                    ("tilt_dem".to_string(), w.tilt_dem),
                    ("rod_pos".to_string(), w.rod_pos),
                    ("tilt".to_string(), w.tilt),
                ]
                .into_iter()
                .collect();
                cmp.floats(si, &format!("core[{k}]"), &gf, &wf);
                if cs.rod_z_dem != w.rod_z_dem || cs.rod_z != w.rod_z {
                    cmp.floats(
                        si,
                        &format!("core[{k}].rodZ"),
                        &cs.rod_z_dem.iter().enumerate().map(|(i, v)| (format!("{i}"), *v)).collect(),
                        &w.rod_z_dem.iter().enumerate().map(|(i, v)| (format!("{i}"), *v)).collect(),
                    );
                }
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
            if v != w {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: dmgWhy[{k}] {v:?} vs {w:?}");
                    cmp.shown += 1;
                }
            }
        }
    }
    let gm: HashMap<String, f64> = got.mass_out.clone();
    let mut gk: Vec<&String> = got.mass_out.keys().collect();
    let mut wk: Vec<&String> = want.mass_out.keys().collect();
    gk.sort(); wk.sort();
    if gk != wk {
        println!("sample {si}: massOut keys {gk:?} vs {wk:?}");
    }
    cmp.floats(si, "massOut", &gm, &want.mass_out);
    for (nm, ga, wa) in [
        ("burnKg", got.burn_kg, want.burn_kg),
        ("burnP", got.burn_p, want.burn_p),
        ("burnBlast", got.burn_blast, want.burn_blast),
        ("fireKg", got.fire_kg, want.fire_kg),
        ("fireP", got.fire_p, want.fire_p),
        ("fireQ", got.fire_q, want.fire_q),
    ] {
        cmp.float1(si, nm, ga, wa);
    }
    cmp.strs(si, "burnIds", &got.burn_ids, &want.burn_ids);
    for (k, gv, wv) in [
        ("roomT", got.grids_f64.get("roomT"), want.grids_f64.get("roomT")),
        ("roomPool", got.grids_f64.get("roomPool"), want.grids_f64.get("roomPool")),
        ("roomPoolE", got.grids_f64.get("roomPoolE"), want.grids_f64.get("roomPoolE")),
        ("roomWater", got.grids_f64.get("roomWater"), want.grids_f64.get("roomWater")),
        ("roomWaterE", got.grids_f64.get("roomWaterE"), want.grids_f64.get("roomWaterE")),
    ] {
        match (gv, wv) {
            (Some(a), Some(b)) => cmp.grid(si, k, a, b),
            (None, None) => {}
            _ => {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: grid:{k} missing on one side");
                    cmp.shown += 1;
                }
            }
        }
    }
    for k in [
        "roomM", "roomH2", "roomO2", "roomVap", "roomFlame", "roomP", "roomPPk", "roomScar", "roomScarCur",
        "roomPU", "roomPV", "roomPoolU", "roomPoolV", "roomWU", "roomWV", "roomWP", "roomPoolP",
    ] {
        match (got.grids_f32.get(k), want.grids_f32.get(k)) {
            (Some(a), Some(b)) => cmp.grid(si, k, a, b),
            (None, None) => {}
            _ => {
                cmp.fails += 1;
                if cmp.shown < 1000000 {
                    println!("sample {si}: grid:{k} missing on one side");
                    cmp.shown += 1;
                }
            }
        }
    }
}

