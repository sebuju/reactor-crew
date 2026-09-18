//! Gate-dump readers shared by the step probe and the WASM engine ingest path.
//! Moved verbatim from `src/bin/step-probe.rs` (only visibility changed).
use crate::step::*;
use crate::tick::*;
use crate::{core, ctl, events, field, room, sec, store, tick, transport};
use std::collections::{HashMap, HashSet};

pub struct Cur<'a> {
    pub b: &'a [u8],
    pub o: usize,
    pub trace: bool,
}
impl<'a> Cur<'a> {
pub fn step_trace_o(o: usize) -> bool {
    o >= 50000 && o < 59200
}
    pub fn u32(&mut self) -> u32 {
        let v = u32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("u32 o={} v={}", self.o, v);
        }
        self.o += 4;
        v
    }
    pub fn i32(&mut self) -> i32 {
        let v = i32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
        self.o += 4;
        v
    }
    pub fn f64(&mut self) -> f64 {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("f64 o={}", self.o);
        }
        let v = f64::from_le_bytes([
            self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3],
            self.b[self.o + 4], self.b[self.o + 5], self.b[self.o + 6], self.b[self.o + 7],
        ]);
        self.o += 8;
        v
    }
    pub fn u8(&mut self) -> u8 {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("u8 o={} v={}", self.o, self.b[self.o]);
        }
        let v = self.b[self.o];
        self.o += 1;
        v
    }
    pub fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes([self.b[self.o], self.b[self.o + 1]]);
        self.o += 2;
        v
    }
    pub fn f64a(&mut self, n: usize) -> Vec<f64> {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("f64a o={} n={}", self.o, n);
        }
        (0..n).map(|_| self.f64()).collect()
    }
    pub fn u8a(&mut self, n: usize) -> Vec<u8> {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("u8a o={} n={}", self.o, n);
        }
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
    pub fn i32a(&mut self, n: usize) -> Vec<i32> {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("i32a o={} n={}", self.o, n);
        }
        (0..n).map(|_| self.i32()).collect()
    }
    pub fn u32a(&mut self, n: usize) -> Vec<u32> {
        if self.trace && self.o >= 50000 && self.o < 59200 {
            eprintln!("u32a o={} n={}", self.o, n);
        }
        (0..n).map(|_| self.u32()).collect()
    }
    pub fn str(&mut self) -> String {
        let n = self.u32() as usize;
        if self.trace && self.o >= 50000 && self.o < 59500 {
            eprintln!("str o={} n={}", self.o, n);
        }
        if self.o + n > self.b.len() {
            panic!("str oob o={} n={} len={}", self.o, n, self.b.len());
        }
        let v = String::from_utf8(self.b[self.o..self.o + n].to_vec())
            .unwrap_or_else(|_| panic!("str utf8 o={} n={}", self.o, n));
        self.o += n;
        v
    }
    pub fn strs(&mut self, n: usize) -> Vec<String> {
        (0..n).map(|_| self.str()).collect()
    }
    pub fn strsn(&mut self) -> Vec<String> {
        let n = self.u32() as usize;
        self.strs(n)
    }
    pub fn f64an(&mut self) -> Vec<f64> {
        let n = self.u32() as usize;
        self.f64a(n)
    }
    pub fn u8an(&mut self) -> Vec<u8> {
        let n = self.u32() as usize;
        self.u8a(n)
    }
    pub fn i32an(&mut self) -> Vec<i32> {
        let n = self.u32() as usize;
        self.i32a(n)
    }
    pub fn u32an(&mut self) -> Vec<u32> {
        let n = self.u32() as usize;
        self.u32a(n)
    }
    pub fn strmap(&mut self) -> HashMap<String, f64> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.f64();
            m.insert(k, v);
        }
        m
    }
    pub fn strmap_b(&mut self) -> HashMap<String, bool> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.u8() != 0;
            m.insert(k, v);
        }
        m
    }
    pub fn strmap_u8(&mut self) -> HashMap<String, u8> {
        let n = self.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = self.str();
            let v = self.u8();
            m.insert(k, v);
        }
        m
    }
    pub fn bag(&mut self, n: usize) -> Bag {
        Bag { v: self.f64a(n), has: self.u8a(n) }
    }
    pub fn pins(&mut self) -> Vec<(u32, f64)> {
        let k = self.u32() as usize;
        let mut v = Vec::with_capacity(k);
        for _ in 0..k {
            let i = self.u32();
            let p = self.f64a(1)[0];
            v.push((i, p));
        }
        v
    }
}

pub fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

pub struct Cmp {
    pub fails: u32,
    pub worst: f64,
    pub worst_at: String,
    pub shown: u32,
}

impl Cmp {
    pub fn fail(&mut self, si: usize, msg: String) {
        self.fails += 1;
        let cap = std::env::var("PROBE_SHOWN").ok().and_then(|v| v.parse().ok()).unwrap_or(20);
        if self.shown < cap {
            println!("sample {si}: {msg}");
            self.shown += 1;
        }
    }
    pub fn sdig(&mut self, si: usize, path: &str, a: f64, b: f64) {
        if a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()) {
            return;
        }
        // NaN-vs-finite is a real divergence (sdig's rel is NaN-blind):
        // fail it loudly under PROBE_STRICT_NAN. Legit NaNs agree bitwise.
        if (a.is_nan() || b.is_nan()) && std::env::var("PROBE_STRICT_NAN").is_ok() {
            self.fail(si, format!("{path} nan-vs-finite {a} vs {b}"));
            return;
        }
        let rel = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if rel > self.worst {
            self.worst = rel;
            self.worst_at = path.to_string();
        }
        if rel > 1e-6 {
            self.fail(si, format!("{path} {a} vs {b} (rel {rel:.3e})"));
        }
    }
    pub fn exact_u8(&mut self, si: usize, path: &str, a: u8, b: u8) {
        if a != b {
            self.fail(si, format!("{path} {a} vs {b}"));
        }
    }
    pub fn exact_bool(&mut self, si: usize, path: &str, a: bool, b: bool) {
        if a != b {
            self.fail(si, format!("{path} {a} vs {b}"));
        }
    }
    pub fn exact_i32(&mut self, si: usize, path: &str, a: i32, b: i32) {
        if a != b {
            self.fail(si, format!("{path} {a} vs {b}"));
        }
    }
    pub fn exact_u32(&mut self, si: usize, path: &str, a: u32, b: u32) {
        if a != b {
            self.fail(si, format!("{path} {a} vs {b}"));
        }
    }
    pub fn exact_str(&mut self, si: usize, path: &str, a: &str, b: &str) {
        if a != b {
            self.fail(si, format!("{path} {a} vs {b}"));
        }
    }
}

// Canonical state codec. Stream order (gate writer mirrors exactly):
//   SEC: f64s[n,(str,f64)] u8s[n,(str,u8)] strings[n,(str,str)]
//     maps[n,(str,SMap)] bmaps[n,(str,SMapB)] bags[n,(str,Bag)]
//     relief[n,(str,ReliefCell)] cores[n,(str,SecCore)]
//     dmg_parts[strsn] dmg_why[n,(str,str)] mass_out[n,(str,f64)]
//     heatbal[5 f64,SMap,SMap] pump_live[strsn] net_burst_p[n,(str,f64)]
//     seed[u32] rng[i32] dice_off[u8] tank_byp[n,(str,u8)] tank_dump[n,(str,u8)]
//     ref_open[u8] net_burst_gen[f64] room_p/room_water/room_wp/room_pool/
//     room_pool_p[f64an ×5]
//   (all maps sorted by key on the wire; ordered vecs in stored order)

pub fn read_smap(c: &mut Cur) -> sec::SMap {
    let n = c.u32() as usize;
    let keys = c.strs(n);
    let vals = c.f64a(n);
    sec::SMap { keys, vals }
}

pub fn cmp_smap(cmp: &mut Cmp, si: usize, path: &str, a: &sec::SMap, b: &sec::SMap) {
    let mut ka: Vec<&String> = a.keys.iter().collect();
    let mut kb: Vec<&String> = b.keys.iter().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        let only_a: Vec<&&String> = ka.iter().filter(|k| !kb.contains(k)).take(8).collect();
        let only_b: Vec<&&String> = kb.iter().filter(|k| !ka.contains(k)).take(8).collect();
        cmp.fail(si, format!("{path} key mismatch only_a={only_a:?} only_b={only_b:?}"));
        return;
    }
    for k in ka {
        cmp.sdig(si, &format!("{path}[{k}]"), a.get(k).unwrap_or(f64::NAN), b.get(k).unwrap_or(f64::NAN));
    }
}

pub fn read_sec_state(c: &mut Cur) -> sec::SecState {
    let mut f64s = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64();
        f64s.insert(k, v);
    }
    let mut u8s = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        u8s.insert(k, v);
    }
    let mut strings = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.str();
        strings.insert(k, v);
    }
    let mut maps = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = read_smap(c);
        maps.insert(k, v);
    }
    let mut bmaps = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let n = c.u32() as usize;
        let keys = c.strs(n);
        let vals = c.u8a(n);
        bmaps.insert(k, sec::SMapB { keys, vals });
    }
    let mut bags = HashMap::new();
    for _ in 0..c.u32() {
        if std::env::var("PROBE_DEBUG").is_ok() {
            eprintln!("bags o={}", c.o);
        }
        let k = c.str();
        let v = c.f64an();
        let has = c.u8an();
        bags.insert(k, Bag { v, has });
    }
    let mut relief = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        // ReliefCell wire: open auto stuck arm blocked (u8 ×5).
        let cell = sec::ReliefCell {
            open: c.u8() != 0,
            auto: c.u8() != 0,
            stuck: c.u8() != 0,
            arm: c.u8() != 0,
            blocked: c.u8() != 0,
        };
        relief.insert(k, cell);
    }
    let mut cores = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        cores.insert(k, sec::SecCore { p_core: c.f64(), flow_net: c.f64() });
    }
    let dmg_parts = c.strsn();
    let mut dmg_why = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.str();
        dmg_why.insert(k, v);
    }
    let mass_out = read_f64map(c);
    let mass_out_order = c.strsn();
    let heatbal = sec::HeatBal {
        prompt: c.f64(),
        decay: c.f64(),
        heat: c.f64(),
        removal: c.f64(),
        d_tavg: c.f64(),
        sg_q_by: read_smap(c),
        heat_by: read_smap(c),
    };
    let pump_live = c.strsn();
    let mut net_burst_p = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64();
        net_burst_p.insert(k, v);
    }
    let seed = c.u32();
    let rng = c.i32();
    let dice_off = c.u8() != 0;
    let mut tank_byp = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        tank_byp.insert(k, v);
    }
    let mut tank_dump = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        tank_dump.insert(k, v);
    }
    let ref_open = c.u8() != 0;
    let net_burst_gen = c.f64();
    let room_p = c.f64an();
    let room_water = c.f64an();
    let room_wp = c.f64an();
    let room_pool = c.f64an();
    let room_pool_p = c.f64an();
    sec::SecState {
        f64s, u8s, strings, maps, bmaps, bags, relief, cores, dmg_parts,
        dmg_why, mass_out, mass_out_order, heatbal, pump_live, net_burst_p, seed, rng,
        dice_off, tank_byp, tank_dump, ref_open, net_burst_gen, room_p,
        room_water, room_wp, room_pool, room_pool_p,
    }
}

pub fn cmp_map_f64(cmp: &mut Cmp, si: usize, path: &str, a: &HashMap<String, f64>, b: &HashMap<String, f64>) {
    let mut ka: Vec<&String> = a.keys().collect();
    let mut kb: Vec<&String> = b.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        let only_a: Vec<&&String> = ka.iter().filter(|k| !kb.contains(k)).take(8).collect();
        let only_b: Vec<&&String> = kb.iter().filter(|k| !ka.contains(k)).take(8).collect();
        cmp.fail(si, format!("{path} key mismatch only_a={only_a:?} only_b={only_b:?}"));
        return;
    }
    for k in ka {
        cmp.sdig(si, &format!("{path}[{k}]"), a[k], b[k]);
    }
}

pub fn cmp_map_bool(cmp: &mut Cmp, si: usize, path: &str, a: &HashMap<String, bool>, b: &HashMap<String, bool>) {
    let mut ka: Vec<&String> = a.keys().collect();
    let mut kb: Vec<&String> = b.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        let only_a: Vec<&&String> = ka.iter().filter(|k| !kb.contains(k)).take(8).collect();
        let only_b: Vec<&&String> = kb.iter().filter(|k| !ka.contains(k)).take(8).collect();
        cmp.fail(si, format!("{path} key mismatch only_a={only_a:?} only_b={only_b:?}"));
        return;
    }
    for k in ka {
        cmp.exact_bool(si, &format!("{path}[{k}]"), a[k], b[k]);
    }
}

pub fn cmp_map_str(cmp: &mut Cmp, si: usize, path: &str, a: &HashMap<String, String>, b: &HashMap<String, String>) {
    let mut ka: Vec<&String> = a.keys().collect();
    let mut kb: Vec<&String> = b.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{path} key mismatch"));
        return;
    }
    for k in ka {
        cmp.exact_str(si, &format!("{path}[{k}]"), &a[k], &b[k]);
    }
}

pub fn cmp_vec_str(cmp: &mut Cmp, si: usize, path: &str, a: &[String], b: &[String]) {
    if a != b {
        cmp.fail(si, format!("{path} {a:?} vs {b:?}"));
    }
}

pub fn cmp_vec_f64(cmp: &mut Cmp, si: usize, path: &str, a: &[f64], b: &[f64]) {
    if a.len() != b.len() {
        cmp.fail(si, format!("{path} len {} vs {}", a.len(), b.len()));
        return;
    }
    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
        cmp.sdig(si, &format!("{path}[{i}]"), *x, *y);
    }
}

pub fn cmp_sec_state(cmp: &mut Cmp, si: usize, tag: &str, a: &sec::SecState, b: &sec::SecState) {
    let p = tag;
    cmp_map_f64(cmp, si, &format!("{p}.f64s"), &a.f64s, &b.f64s);
    cmp_map_bool(cmp, si, &format!("{p}.u8s"), &a.u8s, &b.u8s);
    cmp_map_str(cmp, si, &format!("{p}.strings"), &a.strings, &b.strings);
    let mut ka: Vec<&String> = a.maps.keys().collect();
    let mut kb: Vec<&String> = b.maps.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.maps key mismatch"));
    } else {
        for k in ka {
            cmp_smap(cmp, si, &format!("{p}.maps[{k}]"), &a.maps[k], &b.maps[k]);
        }
    }
    // bmaps/bags/relief/cores compared by key set + fields.
    let mut ka: Vec<&String> = a.bmaps.keys().collect();
    let mut kb: Vec<&String> = b.bmaps.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.bmaps key mismatch"));
    } else {
        for k in ka {
            let (x, y) = (&a.bmaps[k], &b.bmaps[k]);
            if x.keys != y.keys || x.vals != y.vals {
                cmp.fail(si, format!("{p}.bmaps[{k}] mismatch"));
            }
        }
    }
    let mut ka: Vec<&String> = a.bags.keys().collect();
    let mut kb: Vec<&String> = b.bags.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.bags key mismatch"));
    } else {
        for k in ka {
            cmp_vec_f64(cmp, si, &format!("{p}.bags[{k}].v"), &a.bags[k].v, &b.bags[k].v);
            if a.bags[k].has != b.bags[k].has {
                let diff: Vec<String> = a.bags[k].has.iter().zip(b.bags[k].has.iter()).enumerate().filter_map(|(i, (x, y))| if x != y { Some(format!("{i}:{x}>{y}")) } else { None }).take(10).collect();
                cmp.fail(si, format!("{p}.bags[{k}].has mismatch at {diff:?}"));
            }
        }
    }
    let mut ka: Vec<&String> = a.relief.keys().collect();
    let mut kb: Vec<&String> = b.relief.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.relief key mismatch"));
    } else {
        for k in ka {
            let (x, y) = (&a.relief[k], &b.relief[k]);
            cmp.exact_bool(si, &format!("{p}.relief[{k}].open"), x.open, y.open);
            cmp.exact_bool(si, &format!("{p}.relief[{k}].auto"), x.auto, y.auto);
            cmp.exact_bool(si, &format!("{p}.relief[{k}].stuck"), x.stuck, y.stuck);
            cmp.exact_bool(si, &format!("{p}.relief[{k}].arm"), x.arm, y.arm);
            cmp.exact_bool(si, &format!("{p}.relief[{k}].blocked"), x.blocked, y.blocked);
        }
    }
    let mut ka: Vec<&String> = a.cores.keys().collect();
    let mut kb: Vec<&String> = b.cores.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.cores key mismatch"));
    } else {
        for k in ka {
            cmp.sdig(si, &format!("{p}.cores[{k}].p_core"), a.cores[k].p_core, b.cores[k].p_core);
            cmp.sdig(si, &format!("{p}.cores[{k}].flow_net"), a.cores[k].flow_net, b.cores[k].flow_net);
        }
    }
    cmp_vec_str(cmp, si, &format!("{p}.dmg_parts"), &a.dmg_parts, &b.dmg_parts);    cmp_map_str(cmp, si, &format!("{p}.dmg_why"), &a.dmg_why, &b.dmg_why);
    cmp_map_f64(cmp, si, &format!("{p}.mass_out"), &a.mass_out, &b.mass_out);
    cmp_vec_str(cmp, si, &format!("{p}.mass_out_order"), &a.mass_out_order, &b.mass_out_order);
    cmp.sdig(si, &format!("{p}.heatbal.prompt"), a.heatbal.prompt, b.heatbal.prompt);
    cmp.sdig(si, &format!("{p}.heatbal.decay"), a.heatbal.decay, b.heatbal.decay);
    cmp.sdig(si, &format!("{p}.heatbal.heat"), a.heatbal.heat, b.heatbal.heat);
    cmp.sdig(si, &format!("{p}.heatbal.removal"), a.heatbal.removal, b.heatbal.removal);
    cmp.sdig(si, &format!("{p}.heatbal.d_tavg"), a.heatbal.d_tavg, b.heatbal.d_tavg);
    cmp_smap(cmp, si, &format!("{p}.heatbal.sg_q_by"), &a.heatbal.sg_q_by, &b.heatbal.sg_q_by);
    cmp_smap(cmp, si, &format!("{p}.heatbal.heat_by"), &a.heatbal.heat_by, &b.heatbal.heat_by);
    cmp_vec_str(cmp, si, &format!("{p}.pump_live"), &a.pump_live, &b.pump_live);
    cmp_map_f64(cmp, si, &format!("{p}.net_burst_p"), &a.net_burst_p, &b.net_burst_p);
    cmp.exact_u32(si, &format!("{p}.seed"), a.seed, b.seed);
    cmp.exact_i32(si, &format!("{p}.rng"), a.rng, b.rng);
    cmp.exact_bool(si, &format!("{p}.dice_off"), a.dice_off, b.dice_off);
    cmp_map_bool(cmp, si, &format!("{p}.tank_byp"), &a.tank_byp, &b.tank_byp);
    cmp_map_bool(cmp, si, &format!("{p}.tank_dump"), &a.tank_dump, &b.tank_dump);
    cmp.exact_bool(si, &format!("{p}.ref_open"), a.ref_open, b.ref_open);
    cmp.sdig(si, &format!("{p}.net_burst_gen"), a.net_burst_gen, b.net_burst_gen);
    cmp_vec_f64(cmp, si, &format!("{p}.room_p"), &a.room_p, &b.room_p);
    cmp_vec_f64(cmp, si, &format!("{p}.room_water"), &a.room_water, &b.room_water);
    cmp_vec_f64(cmp, si, &format!("{p}.room_wp"), &a.room_wp, &b.room_wp);
    cmp_vec_f64(cmp, si, &format!("{p}.room_pool"), &a.room_pool, &b.room_pool);
    cmp_vec_f64(cmp, si, &format!("{p}.room_pool_p"), &a.room_pool_p, &b.room_pool_p);
}

// ROOM stream order (gate mirrors):
//   f64s u8s i32s maps bags (sorted, shaped as sec)
//   cores[n,(str,DmgCore)] dmg_parts dmg_why mass_out
//   burn_kg burn_p burn_blast burn_ids fire_kg fire_p fire_q
//   grids_f64[n,(str,f64an)] grids_f32[n,(str,f64an)]
// DmgCore wire: breach[u8] tripHas[u8] trip[str?] fatigue[f64] rod_jam[u8]
//   rod_dem[f64] tilt_dem[f64] rod_z_dem[f64an] rod_pos[f64] tilt[f64]
//   rod_z[f64an]

pub fn read_room_smap(c: &mut Cur) -> room::SMap {
    let n = c.u32() as usize;
    let keys = c.strs(n);
    let vals = c.f64a(n);
    room::SMap { keys, vals }
}

pub fn cmp_room_smap(cmp: &mut Cmp, si: usize, path: &str, a: &room::SMap, b: &room::SMap) {
    let mut ka: Vec<&String> = a.keys.iter().collect();
    let mut kb: Vec<&String> = b.keys.iter().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{path} key mismatch"));
        return;
    }
    for k in ka {
        cmp.sdig(si, &format!("{path}[{k}]"), a.get(k).unwrap_or(f64::NAN), b.get(k).unwrap_or(f64::NAN));
    }
}

pub fn read_dmg_core(c: &mut Cur) -> DmgCore {
    let breach = c.u8() != 0;
    let trip = if c.u8() != 0 { Some(c.str()) } else { None };
    let fatigue = c.f64();
    let rod_jam = c.u8() != 0;
    let rod_dem = c.f64();
    let tilt_dem = c.f64();
    let rod_z_dem = c.f64an();
    let rod_pos = c.f64();
    let tilt = c.f64();
    let rod_z = c.f64an();
    DmgCore { breach, trip, fatigue, rod_jam, rod_dem, tilt_dem, rod_z_dem, rod_pos, tilt, rod_z }
}

pub fn read_room_state(c: &mut Cur) -> room::RoomState {
    let mut f64s = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64();
        f64s.insert(k, v);
    }
    let mut u8s = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        u8s.insert(k, v);
    }
    let mut i32s = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.i32();
        i32s.insert(k, v);
    }
    let mut maps = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = read_room_smap(c);
        maps.insert(k, v);
    }
    let mut bags = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64an();
        let has = c.u8an();
        bags.insert(k, Bag { v, has });
    }
    let mut cores = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        cores.insert(k, read_dmg_core(c));
    }
    let dmg_parts = c.strsn();
    let mut dmg_why = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.str();
        dmg_why.insert(k, v);
    }
    let mass_out = read_f64map(c);
    let mass_out_order = c.strsn();
    let burn_kg = c.f64();
    let burn_p = c.f64();
    let burn_blast = c.f64();
    let burn_ids = c.strsn();
    let fire_kg = c.f64();
    let fire_p = c.f64();
    let fire_q = c.f64();
    let mut grids_f64 = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64an();
        grids_f64.insert(k, v);
    }
    let mut grids_f32 = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.f64an();
        grids_f32.insert(k, v);
    }
    room::RoomState {
        f64s, u8s, i32s, maps, bags, cores, dmg_parts, dmg_why, mass_out,
        mass_out_order, burn_kg, burn_p, burn_blast, burn_ids, fire_kg, fire_p, fire_q,
        grids_f64, grids_f32,
    }
}

pub fn cmp_dmg_core(cmp: &mut Cmp, si: usize, path: &str, a: &DmgCore, b: &DmgCore) {
    cmp.exact_bool(si, &format!("{path}.breach"), a.breach, b.breach);
    if a.trip != b.trip {
        cmp.fail(si, format!("{path}.trip {:?} vs {:?}", a.trip, b.trip));
    }
    cmp.sdig(si, &format!("{path}.fatigue"), a.fatigue, b.fatigue);
    cmp.exact_bool(si, &format!("{path}.rod_jam"), a.rod_jam, b.rod_jam);
    cmp.sdig(si, &format!("{path}.rod_dem"), a.rod_dem, b.rod_dem);
    cmp.sdig(si, &format!("{path}.tilt_dem"), a.tilt_dem, b.tilt_dem);
    cmp_vec_f64(cmp, si, &format!("{path}.rod_z_dem"), &a.rod_z_dem, &b.rod_z_dem);
    cmp.sdig(si, &format!("{path}.rod_pos"), a.rod_pos, b.rod_pos);
    cmp.sdig(si, &format!("{path}.tilt"), a.tilt, b.tilt);
    cmp_vec_f64(cmp, si, &format!("{path}.rod_z"), &a.rod_z, &b.rod_z);
}

pub fn cmp_room_state(cmp: &mut Cmp, si: usize, tag: &str, a: &room::RoomState, b: &room::RoomState) {
    let p = tag;
    cmp_map_f64(cmp, si, &format!("{p}.f64s"), &a.f64s, &b.f64s);
    cmp_map_bool(cmp, si, &format!("{p}.u8s"), &a.u8s, &b.u8s);
    let mut ka: Vec<&String> = a.i32s.keys().collect();
    let mut kb: Vec<&String> = b.i32s.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.i32s key mismatch"));
    } else {
        for k in ka {
            cmp.exact_i32(si, &format!("{p}.i32s[{k}]"), a.i32s[k], b.i32s[k]);
        }
    }
    let mut ka: Vec<&String> = a.maps.keys().collect();
    let mut kb: Vec<&String> = b.maps.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.maps key mismatch"));
    } else {
        for k in ka {
            cmp_room_smap(cmp, si, &format!("{p}.maps[{k}]"), &a.maps[k], &b.maps[k]);
        }
    }
    let mut ka: Vec<&String> = a.bags.keys().collect();
    let mut kb: Vec<&String> = b.bags.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        let only_a: Vec<&&String> = ka.iter().filter(|k| !kb.contains(k)).take(8).collect();
        let only_b: Vec<&&String> = kb.iter().filter(|k| !ka.contains(k)).take(8).collect();
        cmp.fail(si, format!("{p}.bags key mismatch only_a={only_a:?} only_b={only_b:?}"));
    } else {
        for k in ka {
            cmp_vec_f64(cmp, si, &format!("{p}.bags[{k}].v"), &a.bags[k].v, &b.bags[k].v);
            if a.bags[k].has != b.bags[k].has {
                let diff: Vec<String> = a.bags[k].has.iter().zip(b.bags[k].has.iter()).enumerate().filter_map(|(i, (x, y))| if x != y { Some(format!("{i}:{x}>{y}")) } else { None }).take(10).collect();
                cmp.fail(si, format!("{p}.bags[{k}].has mismatch at {diff:?}"));
            }
        }
    }
    let mut ka: Vec<&String> = a.cores.keys().collect();
    let mut kb: Vec<&String> = b.cores.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.cores key mismatch"));
    } else {
        for k in ka {
            cmp_dmg_core(cmp, si, &format!("{p}.cores[{k}]"), &a.cores[k], &b.cores[k]);
        }
    }
    cmp_vec_str(cmp, si, &format!("{p}.dmg_parts"), &a.dmg_parts, &b.dmg_parts);
    cmp_map_str(cmp, si, &format!("{p}.dmg_why"), &a.dmg_why, &b.dmg_why);
    cmp_map_f64(cmp, si, &format!("{p}.mass_out"), &a.mass_out, &b.mass_out);
    cmp_vec_str(cmp, si, &format!("{p}.mass_out_order"), &a.mass_out_order, &b.mass_out_order);
    cmp.sdig(si, &format!("{p}.burn_kg"), a.burn_kg, b.burn_kg);
    cmp.sdig(si, &format!("{p}.burn_p"), a.burn_p, b.burn_p);
    cmp.sdig(si, &format!("{p}.burn_blast"), a.burn_blast, b.burn_blast);
    cmp_vec_str(cmp, si, &format!("{p}.burn_ids"), &a.burn_ids, &b.burn_ids);
    cmp.sdig(si, &format!("{p}.fire_kg"), a.fire_kg, b.fire_kg);
    cmp.sdig(si, &format!("{p}.fire_p"), a.fire_p, b.fire_p);
    cmp.sdig(si, &format!("{p}.fire_q"), a.fire_q, b.fire_q);
    let mut ka: Vec<&String> = a.grids_f64.keys().collect();
    let mut kb: Vec<&String> = b.grids_f64.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.grids_f64 key mismatch"));
    } else {
        for k in ka {
            cmp_vec_f64(cmp, si, &format!("{p}.grids_f64[{k}]"), &a.grids_f64[k], &b.grids_f64[k]);
        }
    }
    let mut ka: Vec<&String> = a.grids_f32.keys().collect();
    let mut kb: Vec<&String> = b.grids_f32.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.grids_f32 key mismatch"));
    } else {
        for k in ka {
            cmp_vec_f64(cmp, si, &format!("{p}.grids_f32[{k}]"), &a.grids_f32[k], &b.grids_f32[k]);
        }
    }
}

// EVENTS stream order (gate mirrors): scalars in declaration order
// (tick[i32] n decay heat dmg melt_frac tf dnbr vf ox_max q_ox fatigue
// scrammed breach melt trip rod_pos rod_jam rod_band rho parts_xe p tavg
// lvl sc cav h2 inj_rate release blackout load load_dem bkp_lost sgtr
// flow_net turb_trip cond_lost crew_dose dose dose_rate rep_rate party_spent
// mass_res mass_warn mass_warn_t room_pmax room_burn_on room_fire_on
// room_bang room_max spin_v spin_tv ann_rev burn_blast burn_kg burn_p
// fire_kg fire_p fire_q repair_present repair_t repair_need repair_id)
// dec[f64an] burn_ids[strsn] room_p/room_t/room_h2/room_m/room_vap[f64an ×5]
// vessels[n,(str,EvVessel)] tank[n,(str,f64)] mby_has[u8an] mby_v[f64an]
// mass_out[n,(str,f64)] mass_out_order[strsn] dmg_parts[strsn]
// dmg_why[n,(str,str)] room_crush/room_hurt/flow_pos[n,(str,f64)]
// ev[n,(str,u8)] ann_on[n,(str,u8)]
// relief_open/blocked/stuck/auto[n,(str,u8)] relief_steam[n,(str,f64)]
// sg_burst[n,(str,u8)] port_shut[strsn-sorted]
// flow_demby/lvl_by/sc_by/tavg_by[n,(str,f64)]
// EvVessel wire: n decay dmg melt_frac dec[f64an] tf dnbr vf ox_max q_ox
// fatigue scrammed breach melt trip rod_pos rod_jam rod_band rho parts_xe
// tilt rod_z[f64an] rod_z_dem[f64an] tilt_dem rod_dem

pub fn read_ev_vessel(c: &mut Cur) -> events::EvVessel {
    let n = c.f64();
    let decay = c.f64();
    let dmg = c.f64();
    let melt_frac = c.f64();
    let dec = c.f64an();
    let tf = c.f64();
    let dnbr = c.f64();
    let vf = c.f64();
    let ox_max = c.f64();
    let q_ox = c.f64();
    let fatigue = c.f64();
    let scrammed = c.u8() != 0;
    let breach = c.u8() != 0;
    let melt = c.u8() != 0;
    let trip = c.str();
    let rod_pos = c.f64();
    let rod_jam = c.u8() != 0;
    let rod_band = c.u8() != 0;
    let rho = c.f64();
    let parts_xe = c.f64();
    let tilt = c.f64();
    let rod_z = c.f64an();
    let rod_z_dem = c.f64an();
    let tilt_dem = c.f64();
    let rod_dem = c.f64();
    let rps_hot = c.f64();
    let rps_near = c.u8() != 0;
    events::EvVessel {
        n, decay, dmg, melt_frac, dec, tf, dnbr, vf, ox_max, q_ox, fatigue,
        scrammed, breach, melt, trip, rod_pos, rod_jam, rod_band, rho,
        parts_xe, tilt, rod_z, rod_z_dem, tilt_dem, rod_dem, rps_hot, rps_near,
    }
}

pub fn read_map_u8(c: &mut Cur) -> HashMap<String, u8> {
    let mut m = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8();
        m.insert(k, v);
    }
    m
}

pub fn read_f64map(c: &mut Cur) -> HashMap<String, f64> {
    let n = c.u32() as usize;
    if std::env::var("PROBE_DEBUG").is_ok() && n < 10 {
        eprintln!("f64map n={n} o={}", c.o);
    }
    let keys = c.strs(n);
    let vals = c.f64a(n);
    keys.into_iter().zip(vals).collect()
}

pub fn read_events_state(c: &mut Cur) -> events::EventsState {
    let tick = c.i32();
    let n = c.f64();
    let decay = c.f64();
    let heat = c.f64();
    let dmg = c.f64();
    let melt_frac = c.f64();
    let tf = c.f64();
    let dnbr = c.f64();
    let vf = c.f64();
    let ox_max = c.f64();
    let q_ox = c.f64();
    let fatigue = c.f64();
    let scrammed = c.u8() != 0;
    let breach = c.u8() != 0;
    let melt = c.u8() != 0;
    let trip = c.str();
    let rod_pos = c.f64();
    let rod_jam = c.u8() != 0;
    let rod_band = c.u8() != 0;
    let rho = c.f64();
    let parts_xe = c.f64();
    let p = c.f64();
    let tavg = c.f64();
    let lvl = c.f64();
    let sc = c.f64();
    let cav = c.f64();
    let h2 = c.f64();
    let inj_rate = c.f64();
    let release = c.f64();
    let blackout = c.u8() != 0;
    let load = c.f64();
    let load_dem = c.f64();
    let bkp_lost = c.u8() != 0;
    let sgtr = c.u8() != 0;
    let flow_net = c.f64();
    let turb_trip = c.u8() != 0;
    let cond_lost = c.u8() != 0;
    let crew_dose = c.f64();
    let dose = c.f64();
    let dose_rate = c.f64();
    let rep_rate = c.f64();
    let party_spent = c.u8() != 0;
    let mass_res = c.f64();
    let mass_warn = c.f64();
    let mass_warn_t = c.i32();
    let room_pmax = c.f64();
    let room_burn_on = c.f64();
    let room_fire_on = c.f64();
    let room_bang = c.f64();
    let room_max = c.f64();
    let spin_v = c.f64();
    let spin_tv = c.f64();
    let ann_rev = c.u32();
    let burn_blast = c.u8() != 0;
    let burn_kg = c.f64();
    let burn_p = c.f64();
    let fire_kg = c.f64();
    let fire_p = c.f64();
    let fire_q = c.f64();
    let repair_present = c.u8() != 0;
    let repair_t = c.f64();
    let repair_need = c.f64();
    let repair_id = c.str();
    let dec = c.f64an();
    let burn_ids = c.strsn();
    let room_p = c.f64an();
    let room_t = c.f64an();
    let room_h2 = c.f64an();
    let room_m = c.f64an();
    let room_vap = c.f64an();
    let mut vessels = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        vessels.insert(k, read_ev_vessel(c));
    }
    let tank = read_f64map(c);
    let mby_has = c.u8an();
    let mby_v = c.f64an();
    let mass_out = read_f64map(c);
    let mass_out_order = c.strsn();
    let dmg_parts = c.strsn();
    let mut dmg_why = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.str();
        dmg_why.insert(k, v);
    }
    let room_crush = read_f64map(c);
    let room_hurt = read_f64map(c);
    let flow_pos = read_f64map(c);
    let mut ev = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        ev.insert(k, v);
    }
    let ann_on = read_map_u8(c);
    let mut relief_open = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        relief_open.insert(k, v);
    }
    let mut relief_blocked = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        relief_blocked.insert(k, v);
    }
    let mut relief_stuck = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        relief_stuck.insert(k, v);
    }
    let mut relief_auto = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        relief_auto.insert(k, v);
    }
    let relief_steam = read_f64map(c);
    let mut sg_burst = HashMap::new();
    for _ in 0..c.u32() {
        let k = c.str();
        let v = c.u8() != 0;
        sg_burst.insert(k, v);
    }
    let mut port_shut: HashSet<String> = HashSet::new();
    for s in c.strsn() {
        port_shut.insert(s);
    }
    let flow_demby = read_f64map(c);
    let lvl_by = read_f64map(c);
    let sc_by = read_f64map(c);
    let tavg_by = read_f64map(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("evmaps-o {}", c.o);
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("evmaps flowdemby={:?} lvlby={:?} scby={:?} tavgby={:?}", flow_demby, lvl_by, sc_by, tavg_by);
    }
    events::EventsState {
        tick, n, decay, dec, heat, dmg, melt_frac, tf, dnbr, vf, ox_max,
        q_ox, fatigue, scrammed, breach, melt, trip, rod_pos, rod_jam,
        rod_band, rho, parts_xe, p, tavg, lvl, sc, cav, h2, inj_rate,
        release, blackout, load, load_dem, bkp_lost, sgtr, flow_net,
        turb_trip, cond_lost, crew_dose, dose, dose_rate, rep_rate,
        party_spent, mass_res, mass_warn, mass_warn_t, room_pmax,
        room_burn_on, room_fire_on, room_bang, room_max, spin_v, spin_tv,
        ann_rev, burn_blast, burn_kg, burn_p, burn_ids, fire_kg, fire_p,
        fire_q, repair_present, repair_t, repair_need, repair_id, room_p,
        room_t, room_h2, room_m, room_vap, vessels, tank, mby_has, mby_v,
        mass_out, mass_out_order, dmg_parts, dmg_why, room_crush, room_hurt,
        flow_pos, ev, ann_on, relief_open, relief_blocked, relief_stuck,
        relief_auto, relief_steam, sg_burst, port_shut, flow_demby, lvl_by,
        sc_by, tavg_by,
    }
}

pub fn cmp_ev_vessel(cmp: &mut Cmp, si: usize, path: &str, a: &events::EvVessel, b: &events::EvVessel) {
    cmp.sdig(si, &format!("{path}.n"), a.n, b.n);
    cmp.sdig(si, &format!("{path}.decay"), a.decay, b.decay);
    cmp.sdig(si, &format!("{path}.dmg"), a.dmg, b.dmg);
    cmp.sdig(si, &format!("{path}.melt_frac"), a.melt_frac, b.melt_frac);
    cmp_vec_f64(cmp, si, &format!("{path}.dec"), &a.dec, &b.dec);
    cmp.sdig(si, &format!("{path}.tf"), a.tf, b.tf);
    cmp.sdig(si, &format!("{path}.dnbr"), a.dnbr, b.dnbr);
    cmp.sdig(si, &format!("{path}.vf"), a.vf, b.vf);
    cmp.sdig(si, &format!("{path}.ox_max"), a.ox_max, b.ox_max);
    cmp.sdig(si, &format!("{path}.q_ox"), a.q_ox, b.q_ox);
    cmp.sdig(si, &format!("{path}.fatigue"), a.fatigue, b.fatigue);
    cmp.exact_bool(si, &format!("{path}.scrammed"), a.scrammed, b.scrammed);
    cmp.exact_bool(si, &format!("{path}.breach"), a.breach, b.breach);
    cmp.exact_bool(si, &format!("{path}.melt"), a.melt, b.melt);
    cmp.exact_str(si, &format!("{path}.trip"), &a.trip, &b.trip);
    cmp.sdig(si, &format!("{path}.rod_pos"), a.rod_pos, b.rod_pos);
    cmp.exact_bool(si, &format!("{path}.rod_jam"), a.rod_jam, b.rod_jam);
    cmp.exact_bool(si, &format!("{path}.rod_band"), a.rod_band, b.rod_band);
    cmp.sdig(si, &format!("{path}.rho"), a.rho, b.rho);
    cmp.sdig(si, &format!("{path}.parts_xe"), a.parts_xe, b.parts_xe);
    cmp.sdig(si, &format!("{path}.tilt"), a.tilt, b.tilt);
    cmp_vec_f64(cmp, si, &format!("{path}.rod_z"), &a.rod_z, &b.rod_z);
    cmp_vec_f64(cmp, si, &format!("{path}.rod_z_dem"), &a.rod_z_dem, &b.rod_z_dem);
    cmp.sdig(si, &format!("{path}.tilt_dem"), a.tilt_dem, b.tilt_dem);
    cmp.sdig(si, &format!("{path}.rod_dem"), a.rod_dem, b.rod_dem);
    cmp.sdig(si, &format!("{path}.rps_hot"), a.rps_hot, b.rps_hot);
    cmp.exact_bool(si, &format!("{path}.rps_near"), a.rps_near, b.rps_near);
}

pub fn cmp_map_u8(cmp: &mut Cmp, si: usize, path: &str, a: &HashMap<String, u8>, b: &HashMap<String, u8>) {
    let mut ka: Vec<&String> = a.keys().collect();
    let mut kb: Vec<&String> = b.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{path} key mismatch"));
        return;
    }
    for k in ka {
        cmp.exact_u8(si, &format!("{path}[{k}]"), a[k], b[k]);
    }
}

pub fn cmp_events_state(cmp: &mut Cmp, si: usize, tag: &str, a: &events::EventsState, b: &events::EventsState) {
    let p = tag;
    cmp.exact_i32(si, &format!("{p}.tick"), a.tick, b.tick);
    cmp.sdig(si, &format!("{p}.n"), a.n, b.n);
    cmp.sdig(si, &format!("{p}.decay"), a.decay, b.decay);
    cmp.sdig(si, &format!("{p}.heat"), a.heat, b.heat);
    cmp.sdig(si, &format!("{p}.dmg"), a.dmg, b.dmg);
    cmp.sdig(si, &format!("{p}.melt_frac"), a.melt_frac, b.melt_frac);
    cmp.sdig(si, &format!("{p}.tf"), a.tf, b.tf);
    cmp.sdig(si, &format!("{p}.dnbr"), a.dnbr, b.dnbr);
    cmp.sdig(si, &format!("{p}.vf"), a.vf, b.vf);
    cmp.sdig(si, &format!("{p}.ox_max"), a.ox_max, b.ox_max);
    cmp.sdig(si, &format!("{p}.q_ox"), a.q_ox, b.q_ox);
    cmp.sdig(si, &format!("{p}.fatigue"), a.fatigue, b.fatigue);
    cmp.exact_bool(si, &format!("{p}.scrammed"), a.scrammed, b.scrammed);
    cmp.exact_bool(si, &format!("{p}.breach"), a.breach, b.breach);
    cmp.exact_bool(si, &format!("{p}.melt"), a.melt, b.melt);
    cmp.exact_str(si, &format!("{p}.trip"), &a.trip, &b.trip);
    cmp.sdig(si, &format!("{p}.rod_pos"), a.rod_pos, b.rod_pos);
    cmp.exact_bool(si, &format!("{p}.rod_jam"), a.rod_jam, b.rod_jam);
    cmp.exact_bool(si, &format!("{p}.rod_band"), a.rod_band, b.rod_band);
    cmp.sdig(si, &format!("{p}.rho"), a.rho, b.rho);
    cmp.sdig(si, &format!("{p}.parts_xe"), a.parts_xe, b.parts_xe);
    cmp.sdig(si, &format!("{p}.p"), a.p, b.p);
    cmp.sdig(si, &format!("{p}.tavg"), a.tavg, b.tavg);
    cmp.sdig(si, &format!("{p}.lvl"), a.lvl, b.lvl);
    cmp.sdig(si, &format!("{p}.sc"), a.sc, b.sc);
    cmp.sdig(si, &format!("{p}.cav"), a.cav, b.cav);
    cmp.sdig(si, &format!("{p}.h2"), a.h2, b.h2);
    cmp.sdig(si, &format!("{p}.inj_rate"), a.inj_rate, b.inj_rate);
    cmp.sdig(si, &format!("{p}.release"), a.release, b.release);
    cmp.exact_bool(si, &format!("{p}.blackout"), a.blackout, b.blackout);
    cmp.sdig(si, &format!("{p}.load"), a.load, b.load);
    cmp.sdig(si, &format!("{p}.load_dem"), a.load_dem, b.load_dem);
    cmp.exact_bool(si, &format!("{p}.bkp_lost"), a.bkp_lost, b.bkp_lost);
    cmp.exact_bool(si, &format!("{p}.sgtr"), a.sgtr, b.sgtr);
    cmp.sdig(si, &format!("{p}.flow_net"), a.flow_net, b.flow_net);
    cmp.exact_bool(si, &format!("{p}.turb_trip"), a.turb_trip, b.turb_trip);
    cmp.exact_bool(si, &format!("{p}.cond_lost"), a.cond_lost, b.cond_lost);
    cmp.sdig(si, &format!("{p}.crew_dose"), a.crew_dose, b.crew_dose);
    cmp.sdig(si, &format!("{p}.dose"), a.dose, b.dose);
    cmp.sdig(si, &format!("{p}.dose_rate"), a.dose_rate, b.dose_rate);
    cmp.sdig(si, &format!("{p}.rep_rate"), a.rep_rate, b.rep_rate);
    cmp.exact_bool(si, &format!("{p}.party_spent"), a.party_spent, b.party_spent);
    cmp.sdig(si, &format!("{p}.mass_res"), a.mass_res, b.mass_res);
    cmp.sdig(si, &format!("{p}.mass_warn"), a.mass_warn, b.mass_warn);
    cmp.exact_i32(si, &format!("{p}.mass_warn_t"), a.mass_warn_t, b.mass_warn_t);
    cmp.sdig(si, &format!("{p}.room_pmax"), a.room_pmax, b.room_pmax);
    cmp.sdig(si, &format!("{p}.room_burn_on"), a.room_burn_on, b.room_burn_on);
    cmp.sdig(si, &format!("{p}.room_fire_on"), a.room_fire_on, b.room_fire_on);
    cmp.sdig(si, &format!("{p}.room_bang"), a.room_bang, b.room_bang);
    cmp.sdig(si, &format!("{p}.room_max"), a.room_max, b.room_max);
    cmp.sdig(si, &format!("{p}.spin_v"), a.spin_v, b.spin_v);
    cmp.sdig(si, &format!("{p}.spin_tv"), a.spin_tv, b.spin_tv);
    cmp.exact_u32(si, &format!("{p}.ann_rev"), a.ann_rev, b.ann_rev);
    cmp.exact_bool(si, &format!("{p}.burn_blast"), a.burn_blast, b.burn_blast);
    cmp.sdig(si, &format!("{p}.burn_kg"), a.burn_kg, b.burn_kg);
    cmp.sdig(si, &format!("{p}.burn_p"), a.burn_p, b.burn_p);
    cmp.sdig(si, &format!("{p}.fire_kg"), a.fire_kg, b.fire_kg);
    cmp.sdig(si, &format!("{p}.fire_p"), a.fire_p, b.fire_p);
    cmp.sdig(si, &format!("{p}.fire_q"), a.fire_q, b.fire_q);
    cmp.exact_bool(si, &format!("{p}.repair_present"), a.repair_present, b.repair_present);
    cmp.sdig(si, &format!("{p}.repair_t"), a.repair_t, b.repair_t);
    cmp.sdig(si, &format!("{p}.repair_need"), a.repair_need, b.repair_need);
    cmp.exact_str(si, &format!("{p}.repair_id"), &a.repair_id, &b.repair_id);
    cmp_vec_f64(cmp, si, &format!("{p}.dec"), &a.dec, &b.dec);
    cmp_vec_str(cmp, si, &format!("{p}.burn_ids"), &a.burn_ids, &b.burn_ids);
    cmp_vec_f64(cmp, si, &format!("{p}.room_p"), &a.room_p, &b.room_p);
    cmp_vec_f64(cmp, si, &format!("{p}.room_t"), &a.room_t, &b.room_t);
    cmp_vec_f64(cmp, si, &format!("{p}.room_h2"), &a.room_h2, &b.room_h2);
    cmp_vec_f64(cmp, si, &format!("{p}.room_m"), &a.room_m, &b.room_m);
    cmp_vec_f64(cmp, si, &format!("{p}.room_vap"), &a.room_vap, &b.room_vap);
    let mut ka: Vec<&String> = a.vessels.keys().collect();
    let mut kb: Vec<&String> = b.vessels.keys().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.vessels key mismatch"));
    } else {
        for k in ka {
            cmp_ev_vessel(cmp, si, &format!("{p}.vessels[{k}]"), &a.vessels[k], &b.vessels[k]);
        }
    }
    cmp_map_f64(cmp, si, &format!("{p}.tank"), &a.tank, &b.tank);
    if a.mby_has != b.mby_has {
        cmp.fail(si, format!("{p}.mby_has mismatch"));
    }
    cmp_vec_f64(cmp, si, &format!("{p}.mby_v"), &a.mby_v, &b.mby_v);
    cmp_map_f64(cmp, si, &format!("{p}.mass_out"), &a.mass_out, &b.mass_out);
    cmp_vec_str(cmp, si, &format!("{p}.mass_out_order"), &a.mass_out_order, &b.mass_out_order);
    cmp_vec_str(cmp, si, &format!("{p}.dmg_parts"), &a.dmg_parts, &b.dmg_parts);
    cmp_map_str(cmp, si, &format!("{p}.dmg_why"), &a.dmg_why, &b.dmg_why);
    cmp_map_f64(cmp, si, &format!("{p}.room_crush"), &a.room_crush, &b.room_crush);
    cmp_map_f64(cmp, si, &format!("{p}.room_hurt"), &a.room_hurt, &b.room_hurt);
    cmp_map_f64(cmp, si, &format!("{p}.flow_pos"), &a.flow_pos, &b.flow_pos);
    cmp_map_bool(cmp, si, &format!("{p}.ev"), &a.ev, &b.ev);
    cmp_map_u8(cmp, si, &format!("{p}.ann_on"), &a.ann_on, &b.ann_on);
    cmp_map_bool(cmp, si, &format!("{p}.relief_open"), &a.relief_open, &b.relief_open);
    cmp_map_bool(cmp, si, &format!("{p}.relief_blocked"), &a.relief_blocked, &b.relief_blocked);
    cmp_map_bool(cmp, si, &format!("{p}.relief_stuck"), &a.relief_stuck, &b.relief_stuck);
    cmp_map_bool(cmp, si, &format!("{p}.relief_auto"), &a.relief_auto, &b.relief_auto);
    cmp_map_f64(cmp, si, &format!("{p}.relief_steam"), &a.relief_steam, &b.relief_steam);
    cmp_map_bool(cmp, si, &format!("{p}.sg_burst"), &a.sg_burst, &b.sg_burst);
    let mut ka: Vec<&String> = a.port_shut.iter().collect();
    let mut kb: Vec<&String> = b.port_shut.iter().collect();
    ka.sort();
    kb.sort();
    if ka != kb {
        cmp.fail(si, format!("{p}.port_shut mismatch"));
    }
    cmp_map_f64(cmp, si, &format!("{p}.flow_demby"), &a.flow_demby, &b.flow_demby);
    cmp_map_f64(cmp, si, &format!("{p}.lvl_by"), &a.lvl_by, &b.lvl_by);
    cmp_map_f64(cmp, si, &format!("{p}.sc_by"), &a.sc_by, &b.sc_by);
    cmp_map_f64(cmp, si, &format!("{p}.tavg_by"), &a.tavg_by, &b.tavg_by);
}

// CORE stream order per vessel (gate mirrors): id[str]
//   17 nodal vecs[f64an]: phi x_i x_x n_tf n_tc n_v n_rho n_vt n_tct n_cov
//   n_fol n_dmg n_ox n_melt n_disp n_dnb ch_w
//   n[f64] c[f64an] dec[f64an] decay heat rod_pos rod_dem
//   rod_z[f64an] rod_zdem[f64an] tilt tilt_dem split[u8] re_gang[u8]
//   rod_jam[u8] scrammed[u8] rod_band[u8] dnbr x i tf ao ro hot_ring hot_lev
//   v_node hot_flow tip_rho_out tf_hot dmg melt_frac ox_max q_ox fci
//   t_clad_hot dnbr_min dnbr_ring dnbr_lev fq vf void_th core_dt parts[9 f64]
//   rho p_core flow_net fatigue melt[u8] breach[u8]

pub fn read_core_state(c: &mut Cur) -> core::CoreState {
    let phi = c.f64an();
    let x_i = c.f64an();
    let x_x = c.f64an();
    let n_tf = c.f64an();
    let n_tc = c.f64an();
    let n_v = c.f64an();
    let n_rho = c.f64an();
    let n_vt = c.f64an();
    let n_tct = c.f64an();
    let n_cov = c.f64an();
    let n_fol = c.f64an();
    let n_dmg = c.f64an();
    let n_ox = c.f64an();
    let n_melt = c.f64an();
    let n_disp = c.f64an();
    let n_dnb = c.f64an();
    let ch_w = c.f64an();
    let n = c.f64();
    let cc = c.f64an();
    let dec = c.f64an();
    let decay = c.f64();
    let heat = c.f64();
    let rod_pos = c.f64();
    let rod_dem = c.f64();
    let rod_z = c.f64an();
    let rod_zdem = c.f64an();
    let tilt = c.f64();
    let tilt_dem = c.f64();
    let split = c.u8() != 0;
    let re_gang = c.u8() != 0;
    let rod_jam = c.u8() != 0;
    let scrammed = c.u8() != 0;
    let rod_band = c.u8() != 0;
    let dnbr = c.f64();
    let x = c.f64();
    let i = c.f64();
    let tf = c.f64();
    let ao = c.f64();
    let ro = c.f64();
    let hot_ring = c.f64();
    let hot_lev = c.f64();
    let v_node = c.f64();
    let hot_flow = c.f64();
    let tip_rho_out = c.f64();
    let tf_hot = c.f64();
    let dmg = c.f64();
    let melt_frac = c.f64();
    let ox_max = c.f64();
    let q_ox = c.f64();
    let fci = c.f64();
    let t_clad_hot = c.f64();
    let dnbr_min = c.f64();
    let dnbr_ring = c.f64();
    let dnbr_lev = c.f64();
    let fq = c.f64();
    let vf = c.f64();
    let void_th = c.f64();
    let core_dt = c.f64();
    let pv = c.f64a(9);
    let parts = [pv[0], pv[1], pv[2], pv[3], pv[4], pv[5], pv[6], pv[7], pv[8]];
    let rho = c.f64();
    let p_core = c.f64();
    let flow_net = c.f64();
    let fatigue = c.f64();
    let melt = c.u8() != 0;
    let breach = c.u8() != 0;
    let n_tube = c.u8an();
    let tubes_open = c.f64();
    let cav_relief = c.u8() != 0;
    core::CoreState {
        phi, x_i, x_x, n_tf, n_tc, n_v, n_rho, n_vt, n_tct, n_cov, n_fol,
        n_dmg, n_ox, n_melt, n_disp, n_dnb, ch_w, n, c: cc, dec, decay,
        heat, rod_pos, rod_dem, rod_z, rod_zdem, tilt, tilt_dem, split,
        re_gang, rod_jam, scrammed, rod_band, dnbr, x, i, tf, ao, ro,
        hot_ring, hot_lev, v_node, hot_flow, tip_rho_out, tf_hot, dmg,
        melt_frac, ox_max, q_ox, fci, t_clad_hot, dnbr_min, dnbr_ring,
        dnbr_lev, fq, vf, void_th, core_dt, parts, rho, p_core, flow_net,
        fatigue, melt, breach, n_tube, tubes_open, cav_relief,
    }
}

pub fn cmp_core_state(cmp: &mut Cmp, si: usize, tag: &str, a: &core::CoreState, b: &core::CoreState) {
    let p = tag;
    cmp_vec_f64(cmp, si, &format!("{p}.phi"), &a.phi, &b.phi);
    cmp_vec_f64(cmp, si, &format!("{p}.x_i"), &a.x_i, &b.x_i);
    cmp_vec_f64(cmp, si, &format!("{p}.x_x"), &a.x_x, &b.x_x);
    cmp_vec_f64(cmp, si, &format!("{p}.n_tf"), &a.n_tf, &b.n_tf);
    cmp_vec_f64(cmp, si, &format!("{p}.n_tc"), &a.n_tc, &b.n_tc);
    cmp_vec_f64(cmp, si, &format!("{p}.n_v"), &a.n_v, &b.n_v);
    cmp_vec_f64(cmp, si, &format!("{p}.n_rho"), &a.n_rho, &b.n_rho);
    cmp_vec_f64(cmp, si, &format!("{p}.n_vt"), &a.n_vt, &b.n_vt);
    cmp_vec_f64(cmp, si, &format!("{p}.n_tct"), &a.n_tct, &b.n_tct);
    cmp_vec_f64(cmp, si, &format!("{p}.n_cov"), &a.n_cov, &b.n_cov);
    cmp_vec_f64(cmp, si, &format!("{p}.n_fol"), &a.n_fol, &b.n_fol);
    cmp_vec_f64(cmp, si, &format!("{p}.n_dmg"), &a.n_dmg, &b.n_dmg);
    cmp_vec_f64(cmp, si, &format!("{p}.n_ox"), &a.n_ox, &b.n_ox);
    cmp_vec_f64(cmp, si, &format!("{p}.n_melt"), &a.n_melt, &b.n_melt);
    cmp_vec_f64(cmp, si, &format!("{p}.n_disp"), &a.n_disp, &b.n_disp);
    cmp_vec_f64(cmp, si, &format!("{p}.n_dnb"), &a.n_dnb, &b.n_dnb);
    cmp_vec_f64(cmp, si, &format!("{p}.ch_w"), &a.ch_w, &b.ch_w);
    cmp.sdig(si, &format!("{p}.n"), a.n, b.n);
    cmp_vec_f64(cmp, si, &format!("{p}.c"), &a.c, &b.c);
    cmp_vec_f64(cmp, si, &format!("{p}.dec"), &a.dec, &b.dec);
    cmp.sdig(si, &format!("{p}.decay"), a.decay, b.decay);
    cmp.sdig(si, &format!("{p}.heat"), a.heat, b.heat);
    cmp.sdig(si, &format!("{p}.rod_pos"), a.rod_pos, b.rod_pos);
    cmp.sdig(si, &format!("{p}.rod_dem"), a.rod_dem, b.rod_dem);
    cmp_vec_f64(cmp, si, &format!("{p}.rod_z"), &a.rod_z, &b.rod_z);
    cmp_vec_f64(cmp, si, &format!("{p}.rod_zdem"), &a.rod_zdem, &b.rod_zdem);
    cmp.sdig(si, &format!("{p}.tilt"), a.tilt, b.tilt);
    cmp.sdig(si, &format!("{p}.tilt_dem"), a.tilt_dem, b.tilt_dem);
    cmp.exact_bool(si, &format!("{p}.split"), a.split, b.split);
    cmp.exact_bool(si, &format!("{p}.re_gang"), a.re_gang, b.re_gang);
    cmp.exact_bool(si, &format!("{p}.rod_jam"), a.rod_jam, b.rod_jam);
    cmp.exact_bool(si, &format!("{p}.scrammed"), a.scrammed, b.scrammed);
    cmp.exact_bool(si, &format!("{p}.rod_band"), a.rod_band, b.rod_band);
    cmp.sdig(si, &format!("{p}.dnbr"), a.dnbr, b.dnbr);
    cmp.sdig(si, &format!("{p}.x"), a.x, b.x);
    cmp.sdig(si, &format!("{p}.i"), a.i, b.i);
    cmp.sdig(si, &format!("{p}.tf"), a.tf, b.tf);
    cmp.sdig(si, &format!("{p}.ao"), a.ao, b.ao);
    cmp.sdig(si, &format!("{p}.ro"), a.ro, b.ro);
    cmp.sdig(si, &format!("{p}.hot_ring"), a.hot_ring, b.hot_ring);
    cmp.sdig(si, &format!("{p}.hot_lev"), a.hot_lev, b.hot_lev);
    cmp.sdig(si, &format!("{p}.v_node"), a.v_node, b.v_node);
    cmp.sdig(si, &format!("{p}.hot_flow"), a.hot_flow, b.hot_flow);
    cmp.sdig(si, &format!("{p}.tip_rho_out"), a.tip_rho_out, b.tip_rho_out);
    cmp.sdig(si, &format!("{p}.tf_hot"), a.tf_hot, b.tf_hot);
    cmp.sdig(si, &format!("{p}.dmg"), a.dmg, b.dmg);
    cmp.sdig(si, &format!("{p}.melt_frac"), a.melt_frac, b.melt_frac);
    cmp.sdig(si, &format!("{p}.ox_max"), a.ox_max, b.ox_max);
    cmp.sdig(si, &format!("{p}.q_ox"), a.q_ox, b.q_ox);
    cmp.sdig(si, &format!("{p}.fci"), a.fci, b.fci);
    cmp.sdig(si, &format!("{p}.t_clad_hot"), a.t_clad_hot, b.t_clad_hot);
    cmp.sdig(si, &format!("{p}.dnbr_min"), a.dnbr_min, b.dnbr_min);
    cmp.sdig(si, &format!("{p}.dnbr_ring"), a.dnbr_ring, b.dnbr_ring);
    cmp.sdig(si, &format!("{p}.dnbr_lev"), a.dnbr_lev, b.dnbr_lev);
    cmp.sdig(si, &format!("{p}.fq"), a.fq, b.fq);
    cmp.sdig(si, &format!("{p}.vf"), a.vf, b.vf);
    cmp.sdig(si, &format!("{p}.void_th"), a.void_th, b.void_th);
    cmp.sdig(si, &format!("{p}.core_dt"), a.core_dt, b.core_dt);
    cmp_vec_f64(cmp, si, &format!("{p}.parts"), &a.parts, &b.parts);
    cmp.sdig(si, &format!("{p}.rho"), a.rho, b.rho);
    cmp.sdig(si, &format!("{p}.p_core"), a.p_core, b.p_core);
    cmp.sdig(si, &format!("{p}.flow_net"), a.flow_net, b.flow_net);
    cmp.sdig(si, &format!("{p}.fatigue"), a.fatigue, b.fatigue);
    cmp.exact_bool(si, &format!("{p}.melt"), a.melt, b.melt);
    cmp.exact_bool(si, &format!("{p}.breach"), a.breach, b.breach);
    if a.n_tube != b.n_tube {
        cmp.fail(si, format!("{p}.n_tube mismatch"));
    }
    cmp.sdig(si, &format!("{p}.tubes_open"), a.tubes_open, b.tubes_open);
    cmp.exact_bool(si, &format!("{p}.cav_relief"), a.cav_relief, b.cav_relief);
}

use crate::sec::{FitRow, FireRow, PartRow, PipeRun, SecMeta, TankBurst, TankRow, WallCell};

// SecMeta reader: copied verbatim from sec-probe.rs read_meta (frozen
// per-preset tables; gate writes via sec-gate.js dumpMeta).
pub fn read_sec_meta(c: &mut Cur) -> SecMeta {
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
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("secmeta@pumps o={}", c.o);
    }
    let part_ids = c.strsn();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("secmeta partids={:?}", part_ids);
    }
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
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("secmeta edge61 kind={:?} key={:?}", edge_kind.get(61), edge_key.get(61));
    }
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
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("secmeta@end o={}", c.o);
    }
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

use crate::room::{ByRun, FireCool, FireFull, RoleRow, RoomDer, RoomMeta, RoomPart};

// RoomMeta reader: copied verbatim from room-probe.rs read_meta (gate
// writes via room-gate.js dumpMeta).
pub fn read_room_meta(c: &mut Cur) -> RoomMeta {
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

use crate::eos::Curve;

pub fn read_curve(c: &mut Cur) -> Curve {
    let k: Vec<f64> = (0..17).map(|_| c.f64()).collect();
    Curve::new(
        k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], k[10],
        k[11], k[12], k[13], k[14], k[15], k[16],
    )
}

pub fn read_sec_curves(c: &mut Cur) -> sec::SecCurves {
    let n = c.u32() as usize;
    let mut curves = vec![];
    for _ in 0..n {
        curves.push(read_curve(c));
    }
    let water = read_curve(c);
    let set_p = c.f64a(n);
    sec::SecCurves { curves, water, set_p }
}

pub fn read_room_curves(c: &mut Cur) -> room::RoomCurves {
    let n = c.u32() as usize;
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("roomcurves n={n} o={}", c.o);
    }
    let mut curves = vec![];
    for _ in 0..n {
        curves.push(read_curve(c));
    }
    let water = read_curve(c);
    let set_p = c.f64a(n);
    room::RoomCurves { curves, water, set_p }
}

// CoreK reader: copied verbatim from core-probe.rs main (gate writes via
// core-gate.js dumpK). XNR const from core.
pub fn read_core_k(c: &mut Cur) -> core::CoreK {
    use crate::core::XNR;
    let nb = c.u32() as usize;
    let kv = c.f64a(55);
    let satv = c.f64a(17);
    let sat = Curve::new(
        satv[0], satv[1], satv[2], satv[3], satv[4], satv[5], satv[6], satv[7], satv[8],
        satv[9], satv[10], satv[11], satv[12], satv[13], satv[14], satv[15], satv[16],
    );
    let fl = c.u8a(4);
    core::CoreK {
        nb, sat, n0: kv[0], tf_ref: kv[1], tref: kv[2], rod_a: kv[3], tip_rho: kv[4],
        tip_len: kv[5], poison: kv[6], mix: kv[7], dt0: kv[8], dh: kv[9], a_heat: kv[10],
        g0: kv[11], film_pool: kv[12], x_sub: kv[13], x_sub_lo: kv[14], hfg: kv[15],
        flow_k: kv[16], pin_ua: kv[17], g_solid: kv[18], clad_r: kv[19], rod_d: kv[20],
        tmelt: kv[21], kxe: kv[22], a_f: kv[23], a_m: kv[24], a_x: kv[25], a_s: kv[26],
        a_v: kv[27], excess: kv[28], dnbr_k: kv[29], tdmg: kv[30], rated: kv[31],
        scram: kv[32], rod_rate: kv[33], burst_k: kv[34], p0: kv[35], core_kg0: kv[36],
        beta: kv[37], lam_big: kv[38], g_i: kv[39], lam_i: kv[40], g_x: kv[41],
        lam_x: kv[42], sig: kv[43], cr: kv[44], cz: kv[45], alb_r: kv[46], alb_t: kv[47],
        alb_b: kv[48], rinf: kv[49], burst_r: kv[50], rho0: kv[51], rho_beta: kv[52],
        plant_tref: kv[53], core_hgt: kv[54],
        poi_g: c.f64a(XNR), n_pen: c.f64a(XNR), enr_rho: c.f64a(XNR),
        rinf_w: c.f64a(XNR), bet: c.f64a(6), lam: c.f64a(6),
        bank_r: c.f64a(nb), bank_w: c.f64a(nb),
        oxid: fl[0] != 0, dryout: fl[1] != 0, tube: fl[2] != 0, dnb_law: fl[3],
    }
}

use crate::events::{EvHaz, EvPart, EvRun, EvSteamBook, EvTank, EventsMeta};

// EventsMeta reader: copied verbatim from events-probe.rs read_meta (gate
// writes via events-gate.js dumpMeta).
pub fn read_events_meta(c: &mut Cur) -> EventsMeta {
    let gw = c.u32() as usize;
    let gh = c.u32() as usize;
    let np = c.u32() as usize;
    let mut parts = Vec::with_capacity(np);
    for _ in 0..np {
        let id = c.str();
        let x = c.i32();
        let y = c.i32();
        let w = c.i32();
        let h = c.i32();
        let role = c.str();
        let name = c.str();
        let pburst = c.f64();
        let pdes = c.f64();
        let tsurv = c.f64();
        let mut face_nodes: [Option<String>; 4] = [None, None, None, None];
        for k in 0..4 {
            let s = c.str();
            if !s.is_empty() {
                face_nodes[k] = Some(s);
            }
        }
        let on = c.str();
        let part_on = if on.is_empty() { None } else { Some(on) };
        let tank_hold = c.u8() != 0;
        parts.push(EvPart { id, x, y, w, h, role, name, pburst, pdes, tsurv, face_nodes, part_on, tank_hold });
    }
    let nh = c.u32() as usize;
    let mut hazards = Vec::with_capacity(nh);
    for _ in 0..nh {
        hazards.push(EvHaz { id: c.str(), x: c.i32(), y: c.i32(), lim: c.f64(), what: c.str() });
    }
    let core_ids = c.strsn();
    let primary_core = c.str();
    let mut cores_rated = HashMap::new();
    for _ in 0..c.u32() {
        cores_rated.insert(c.str(), c.f64());
    }
    let mut cores_nb = HashMap::new();
    for _ in 0..c.u32() {
        cores_nb.insert(c.str(), c.u32() as usize);
    }
    let mut core_ci = HashMap::new();
    for _ in 0..c.u32() {
        core_ci.insert(c.str(), c.i32());
    }
    let mut circ_key = HashMap::new();
    for _ in 0..c.u32() {
        circ_key.insert(c.i32(), c.str());
    }
    let core_circ = c.i32();
    let mut circ_tref = HashMap::new();
    for _ in 0..c.u32() {
        circ_tref.insert(c.i32(), c.f64());
    }
    let mut core_hold = HashMap::new();
    for _ in 0..c.u32() {
        core_hold.insert(c.str(), c.str());
    }
    let mut cores_tref = HashMap::new();
    for _ in 0..c.u32() {
        cores_tref.insert(c.str(), c.f64());
    }
    let mut cores_steam = HashMap::new();
    for _ in 0..c.u32() {
        cores_steam.insert(c.str(), c.f64());
    }
    let tf_ref = c.f64();
    let dnbr0 = c.f64();
    let tref = c.f64();
    let steam_flag = c.f64();
    let rated = c.f64();
    let flow_min = c.f64();
    let p0 = c.f64();
    let rated_steam = c.f64();
    let sg_lift = c.f64();
    let panel_thresh = c.f64();
    let flow_k = c.f64();
    let bkp = c.f64();
    let catcher = c.u8() != 0;
    let fuel_in_coolant = c.u8() != 0;
    let vessel_flag = c.u8() != 0;
    let tank_water_act = c.f64();
    let sg_ids = c.strsn();
    let boiler_ids = c.strsn();
    let pump_ids = c.strsn();
    let tank_ids = c.strsn();
    let relief_fit_ids = c.strsn();
    let rad_ids = c.strsn();
    let primary_pumps: HashSet<String> = c.strsn().into_iter().collect();
    let mut rad_live = HashMap::new();
    for _ in 0..c.u32() {
        rad_live.insert(c.str(), c.u8() != 0);
    }
    let pr = c.str();
    let primary_relief = if pr.is_empty() { None } else { Some(pr) };
    let mut tanks = HashMap::new();
    for _ in 0..c.u32() {
        let id = c.str();
        tanks.insert(
            id,
            EvTank {
                inf: c.u8() != 0,
                hold: c.u8() != 0,
                cell: c.u8() != 0,
                level: c.f64(),
                act: c.f64(),
                kg: c.f64(),
                in_field: c.u8() != 0,
            },
        );
    }
    let node_names: HashSet<String> = c.strsn().into_iter().collect();
    let incore_names: HashSet<String> = c.strsn().into_iter().collect();
    let nb = c.u32() as usize;
    let booked = c.u8a(nb);
    let run_keys = c.strsn();
    let mut run_pos = HashMap::new();
    for _ in 0..c.u32() {
        run_pos.insert(c.str(), c.u32() as usize);
    }
    let mut by_key = HashMap::new();
    for _ in 0..c.u32() {
        let key = c.str();
        if c.u8() != 0 {
            by_key.insert(key, EvRun { k: c.str(), pa: c.str(), pb: c.str() });
        }
    }
    let mut tag_by_key = HashMap::new();
    for _ in 0..c.u32() {
        tag_by_key.insert(c.str(), c.i32());
    }
    let mut net_ref_by_run = HashMap::new();
    for _ in 0..c.u32() {
        net_ref_by_run.insert(c.str(), c.f64());
    }
    let mut steam_book = HashMap::new();
    for _ in 0..c.u32() {
        let key = c.str();
        if c.u8() == 0 {
            continue;
        }
        let vent = c.u8() != 0;
        let taps = c.strsn();
        let dir = c.f64();
        let gens = c.strsn();
        let ends = c.u8() != 0;
        steam_book.insert(key, EvSteamBook { vent, taps, dir, gens, ends });
    }
    let nm = c.u32() as usize;
    let mat_of = c.i32a(nm);
    let crew_some = c.u8() != 0;
    let crew_rect = if crew_some { Some([c.i32(), c.i32(), c.i32(), c.i32()]) } else { None };
    let mut kern_core = Vec::new();
    for _ in 0..c.u32() {
        let id = c.str();
        let m = c.u32() as usize;
        kern_core.push((id, c.f64a(m)));
    }
    let mut kern_sg = Vec::new();
    for _ in 0..c.u32() {
        let m = c.u32() as usize;
        kern_sg.push(c.f64a(m));
    }
    let mut kern_tank = Vec::new();
    for _ in 0..c.u32() {
        let id = c.str();
        let m = c.u32() as usize;
        kern_tank.push((id, c.f64a(m)));
    }
    let kern_pipe = if c.u8() != 0 {
        let m = c.u32() as usize;
        Some(c.f64a(m))
    } else {
        None
    };
    let has_pipe_kernel = kern_pipe.is_some();
    EventsMeta {
        gw, gh, parts, hazards, core_ids, primary_core, cores_rated, cores_nb,
        core_ci, circ_key, core_circ, circ_tref, core_hold, cores_tref, cores_steam,
        tf_ref, dnbr0, tref, steam_flag, rated, flow_min, p0, rated_steam, sg_lift,
        panel_thresh, flow_k, bkp, catcher, fuel_in_coolant, tank_water_act, sg_ids, boiler_ids,
        pump_ids, primary_pumps, tank_ids, relief_fit_ids, rad_ids, rad_live,
        primary_relief, tanks, node_names, incore_names, booked, run_keys, run_pos,
        by_key, tag_by_key, net_ref_by_run, steam_book, mat_of, crew_rect,
        kern_core, kern_sg, kern_tank, kern_pipe, has_pipe_kernel, vessel_flag,
    }
}

// SolveFrozen reader: adapted from solvefull-probe.rs main preset header
// (gate writes via solvefull-gate.js dumpMeta, plus net_ref/n_loops).
pub fn read_solve_frozen(c: &mut Cur) -> SolveFrozen {
    let n = c.u32() as usize;
    let ne = c.u32() as usize;
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("solve head n={n} ne={ne} o={}", c.o);
    }
    assert_eq!(c.u32(), 1, "solve format v1");
    let n_loops = c.u32() as usize;
    let net_ref = c.f64();
    let nc = c.u32() as usize;
    let mut curves = Vec::with_capacity(nc);
    for _ in 0..nc {
        let v = c.f64a(17);
        curves.push(Curve::new(
            v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12],
            v[13], v[14], v[15], v[16],
        ));
    }
    let curve_of = c.u32a(n);
    let eu = c.u32a(ne);
    let ev = c.u32a(ne);
    let wi = c.i32a(ne);
    let has_i = c.u8a(ne);
    let ii = c.i32a(ne);
    let dz = c.f64a(ne);
    let pool_at = c.i32a(ne);
    let choke_at = c.i32a(ne);
    let gas_at = c.i32a(ne);
    let liq_at = c.i32a(ne);
    let ck = c.i32a(ne);
    let diode_s = c.f64a(ne);
    let bore = c.f64a(ne);
    let llen = c.f64a(ne);
    let k0 = c.f64a(ne);
    let hce = c.f64a(ne);
    let cav_n = c.f64a(ne);
    let cav_one = c.f64a(ne);
    let cav_relief = c.f64a(ne);
    let cc0 = c.f64a(ne);
    let gate_n = c.u32a(ne);
    let g_is_fn = c.u8a(ne);
    let h_is_fn = c.u8a(ne);
    let g_scalar = c.f64a(ne);
    let h_scalar = c.f64a(ne);
    let ekey = c.i32a(ne);
    let meter = c.u8a(ne);
    let pair = c.i32a(ne);
    let is_break = c.u8a(ne);
    let break_steam = c.u8a(ne);
    let break_sec = c.u8a(ne);
    let is_sgtr = c.u8a(ne);
    let shell_of = c.i32a(ne);
    let shell_sign = c.u8a(ne);
    let work = c.u8a(ne);
    let fit = c.i32a(ne);
    let vol = c.f64a(n);
    let run_mask = c.u8a(n);
    let ng = c.u32() as usize;
    let gas_nodes = c.u32a(ng);
    let nl = c.u32() as usize;
    let liq_nodes = c.u32a(nl);
    let ncv = c.u32() as usize;
    let cond_v = c.u32a(ncv);
    let cont_mask = c.u8a(n);
    let ncl = c.u32() as usize;
    let _cont_list = c.u32a(ncl);
    let nt = c.u32() as usize;
    let tank_order = c.u32a(nt);
    let tank_hold = c.u8a(nt);
    let nhn = c.u32() as usize;
    let hold_nodes = c.u32a(nhn);
    let ndn = c.u32() as usize;
    let drum_nodes = c.u32a(ndn);
    let nst = c.u32() as usize;
    let _sec_t = c.u32a(nst);
    let ncn = c.u32() as usize;
    let core_nodes = c.u32a(ncn);
    let core_node = c.u32();
    let mut tables: Vec<Vec<i32>> = Vec::new();
    for _ in 0..7 {
        let k = c.u32() as usize;
        tables.push(c.i32a(k));
    }
    let loop_of_run = c.i32a(tables[0].len());
    let core_of = c.i32a(n);
    let tank_id_of = c.i32a(n);
    let sec_shell_of = c.i32a(n);
    let core_set = c.u8a(n);
    let nstr = c.u32() as usize;
    for _ in 0..nstr {
        let l = c.u32() as usize;
        c.o += l;
    }
    let fm = c.u32a(7);
    let _ = (_cont_list, _sec_t);
    SolveFrozen {
        n, ne, n_loops, net_ref, curves, curve_of, eu, ev, wi, has_i, ii,
        dz, pool_at, choke_at, gas_at, liq_at, ck, diode_s, bore, llen, k0,
        hce, cav_n, cav_one, cav_relief, cc0, gate_n, g_is_fn, h_is_fn,
        g_scalar, h_scalar, ekey, meter, pair, is_break, break_steam,
        break_sec, is_sgtr, shell_of, shell_sign, work, fit, vol, run_mask,
        gas_nodes, liq_nodes, cond_v, cont_mask, tank_order, tank_hold,
        hold_nodes, drum_nodes, core_nodes, core_node,
        run_keys: tables[0].clone(), core_keys: tables[1].clone(),
        tank_keys: tables[2].clone(), shell_keys: tables[3].clone(),
        sgtr_keys: tables[4].clone(), relief_keys: tables[5].clone(),
        by_keys: tables[6].clone(), loop_of_run, core_of, tank_id_of,
        sec_shell_of, core_set, fm,
    }
}

// TransFrozen reader: adapted from transport-probe.rs preset decode
// (gate writes via transport-gate.js dumpMeta, minus np/format-v1 framing).
pub fn read_trans_meta(c: &mut Cur) -> TransMeta {
    let n = c.u32() as usize;
    let ne = c.u32() as usize;
    let eu = c.u32a(ne);
    let ev = c.u32a(ne);
    let vol = c.f64a(n);
    let z = c.f64a(n);
    let booked = c.u8a(n);
    if std::env::var("PROBE_DEBUG").is_ok() && n > 72 {
        eprintln!("rsbooked62 {:?}", &booked[60..72]);
    }
    let book_id = c.u32a(n);
    let tank_has = c.u8a(n);
    let gas_at = c.i32a(ne);
    let liq_at = c.i32a(ne);
    let is_break = c.u8a(ne);
    let is_hole = c.u8a(ne);
    let steam = c.u8a(ne);
    let sec = c.u8a(ne);
    let opos = c.i32a(ne);
    let n_out = c.u32() as usize;
    let in_core = c.u8a(n);
    let circ_of = c.i32a(n);
    let ref_thru = c.f64a(n);
    let anch_skip = c.u8a(n);
    let metal_kg = c.f64a(n);
    let metal_tau = c.f64a(n);
    let metal_ua = c.f64a(n);
    let nc = c.u32() as usize;
    let mut curves = Vec::with_capacity(nc);
    for _ in 0..nc {
        curves.push(read_curve(c));
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("trans@curves o={}", c.o);
    }
    let curve_of = c.u32a(n);
    let nf = c.u32() as usize;
    let feed_idx = c.u32a(nf);
    let ncf = c.u32() as usize;
    let core_idx = c.u32a(ncf);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("trans@coreidx o={}", c.o);
    }
    let ntc = c.u32() as usize;
    let mut tavg_circs = Vec::with_capacity(ntc);
    for _ in 0..ntc {
        let ci = c.i32();
        let curve = c.u32();
        let tmin = c.f64a(1)[0];
        let tmax = c.f64a(1)[0];
        tavg_circs.push(transport::TavgCirc { ci, curve, tmin, tmax });
    }
    let core_node = c.i32();
    let has_boron = c.u8() != 0;
    let core_circ = c.i32();
    let consts = c.f64a(6);
    let (cond_p0, cp_steel, h2_rise, dry_min_kg, core_dt_qmin, tavg_rate_tau) =
        (consts[0], consts[1], consts[2], consts[3], consts[4], consts[5]);
    let nr = c.u32() as usize;
    let rise_lo = c.u32a(nr);
    let rise_hi = c.u32a(nr);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("transmeta n={n} ne={ne} nr={nr} maxlo={:?} maxhi={:?}", rise_lo.iter().max(), rise_hi.iter().max());
    }
    TransMeta {
        dt: 0.02, n, ne, eu, ev, vol, z, booked, book_id, tank_has,
        gas_at, liq_at, is_break, is_hole, steam, sec, opos, n_out,
        in_core, circ_of, ref_thru, anch_skip, metal_kg, metal_tau, metal_ua,
        curves, curve_of, feed_idx, core_idx, tavg_circs, core_node,
        has_boron, core_circ, cond_p0, cp_steel, h2_rise, dry_min_kg,
        core_dt_qmin, tavg_rate_tau, rise_lo, rise_hi,
    }
}

use crate::ctl::{Act, Block, CoreAct, ReliefCell, Sample, SINK_UNKNOWN};

// CtlMeta reader: 6 sink key lists (S0-once; gate dumps in dump order).
pub fn read_ctl_meta(c: &mut Cur) -> CtlMeta {
    CtlMeta {
        freg_keys: c.strsn(),
        flow_keys: c.strsn(),
        valve_keys: c.strsn(),
        tank_keys: c.strsn(),
        relief_keys: c.strsn(),
        core_ids: c.strsn(),
    }
}

// ctl Sample reader: copied from ctl-probe.rs main sample decode (minus
// want parts, which the step gate streams separately as post-ctl out/f).
pub fn read_ctl_sample(c: &mut Cur) -> (Sample, Vec<f64>, Vec<f64>) {
    let dt = c.f64();
    let live = c.u8() != 0;
    let n = c.u32() as usize;
    let ids: Vec<String> = (0..n).map(|_| c.str()).collect();
    let _ = ids;
    let modes = c.u8a(n);
    let on = c.u8a(n);
    let mut inputs: Vec<Vec<i32>> = Vec::with_capacity(n);
    for _ in 0..n {
        let m = c.u32() as usize;
        inputs.push((0..m).map(|_| c.i32()).collect());
    }
    let out_pre = c.f64a(n);
    let f_pre = c.f64a(n);
    let mut blocks: Vec<Block> = Vec::with_capacity(n);
    for i in 0..n {
        let mut knob = [0.0f64; 13];
        for k in 0..13 {
            knob[k] = c.f64();
        }
        let nullmask = c.u16();
        blocks.push(Block {
            mode: modes[i],
            on: on[i] != 0,
            inputs: std::mem::take(&mut inputs[i]),
            knob,
            nullmask,
            math_op: 0,
            sel_op: 0,
            cmp_op: 0,
            src_val: 0.0,
            sink_kind: SINK_UNKNOWN,
            sink_arg: -1,
            dead: false,
            blame: String::new(),
        });
    }
    let math_op = c.u8a(n);
    let sel_op = c.u8a(n);
    let cmp_op = c.u8a(n);
    let src = c.f64a(n);
    let sink_kind = c.u8a(n);
    let sink_arg: Vec<i32> = (0..n).map(|_| c.i32()).collect();
    let dead = c.u8a(n);
    let mut blame: Vec<String> = (0..n).map(|_| c.str()).collect();
    for (i, b) in blocks.iter_mut().enumerate() {
        b.math_op = math_op[i];
        b.sel_op = sel_op[i];
        b.cmp_op = cmp_op[i];
        b.src_val = src[i];
        b.sink_kind = sink_kind[i];
        b.sink_arg = sink_arg[i];
        b.dead = dead[i] != 0;
        b.blame = std::mem::take(&mut blame[i]);
    }
    let no = c.u32() as usize;
    let order: Vec<usize> = (0..no).map(|_| c.u32() as usize).collect();
    let (ar_lo, ar_hi, load_max, rps_lag, p_rated, load, load_dem, boron_dem) =
        (c.f64(), c.f64(), c.f64(), c.f64(), c.f64(), c.f64(), c.f64(), c.f64());
    let rb_hot = c.u8() != 0;
    let nf = c.u32() as usize;
    let freg = c.f64a(nf);
    let freg_exist = c.u8a(nf);
    let nw = c.u32() as usize;
    let flow = c.f64a(nw);
    let flow_exist = c.u8a(nw);
    let nv = c.u32() as usize;
    let valve = c.f64a(nv);
    let valve_exist = c.u8a(nv);
    let nt = c.u32() as usize;
    let tank = c.u8a(nt);
    let tank_exist = c.u8a(nt);
    let nr = c.u32() as usize;
    let mut relief = Vec::with_capacity(nr);
    for _ in 0..nr {
        let cell = c.u8a(6);
        relief.push(ReliefCell {
            exist: cell[0] != 0,
            open: cell[1] != 0,
            auto: cell[2] != 0,
            stuck: cell[3] != 0,
            arm: cell[4] != 0,
            spring: cell[5] != 0,
        });
    }
    let nc = c.u32() as usize;
    let mut cores = Vec::with_capacity(nc);
    for _ in 0..nc {
        let _id = c.str();
        let nb = c.u32() as usize;
        let rod_dem = c.f64();
        let rod_zdem = c.f64a(nb);
        let fl = c.u8a(6);
        let bank_auto = c.u8a(nb).iter().map(|&v| v != 0).collect();
        let (rps_hot, rated, rod_rate) = (c.f64(), c.f64(), c.f64());
        let px = c.u8a(2);
        let trip = c.str();
        cores.push(CoreAct {
            rod_dem,
            rod_zdem,
            rod_band: fl[0] != 0,
            split: fl[1] != 0,
            regang: fl[2] != 0,
            bank_auto,
            rod_jam: fl[3] != 0,
            scrammed: fl[4] != 0,
            rps_hot,
            rps_near: fl[5] != 0,
            trip,
            rated,
            rod_rate,
            pin_hot: px[0] != 0,
            dmg_rod: px[1] != 0,
        });
    }
    let want_out = c.f64a(n);
    let want_f = c.f64a(n);
    let sample = Sample {
        dt,
        live,
        blocks,
        order,
        out_pre,
        f_pre,
        act: Act {
            ar_lo, ar_hi, load_max, rps_lag, p_rated, load, load_dem, boron_dem, rb_hot,
            freg_exist: freg_exist.iter().map(|&v| v != 0).collect(),
            freg: freg.clone(),
            flow_exist: flow_exist.iter().map(|&v| v != 0).collect(),
            flow: flow.clone(),
            valve_exist: valve_exist.iter().map(|&v| v != 0).collect(),
            valve: valve.clone(),
            tank_exist: tank_exist.iter().map(|&v| v != 0).collect(),
            tank: tank.iter().map(|&v| v != 0).collect(),
            relief: relief.clone(),
            cores: cores.clone(),
        },
    };
    (sample, want_out, want_f)
}

// Per-tick tail bundle readers (stream order defined here; gate mirrors).
//   solve: fb_p fb_h pool[raw] cont held cont_p 5×pins tanks conds
//     edge_q edge_gates with_cap widx work_fr pc nat_loop div_sig
//   sec: hold_live stage_fed tank_p core_fn exh_open role cont_rel
//     shells_live pieces core_heat?/no in_loop dgen burst_gen cond_p
//     panel cond_frac sec_p boiler loopp q_tank relief sg_feed sg_steam
//     run_flow_keys
//   trans: src metal_q booked boron_pin fb tavg_prev in_loop member rise_a
//   core per vessel: id + 14 scalars  room: bore map
//   events: rps sink runback dry panel cond_frac cont_rel party
//   trip_near inject_node h2_post_vessel tube-map

pub fn read_solve_tail(c: &mut Cur, n: usize, ne: usize, n_loops: usize, nt: usize, ncv: usize) -> SolveTail {
    let fallback_p = c.f64a(n);
    let fallback_h = c.f64a(n);
    let pool_raw = c.f64a(ncv);
    let pool_lvl = pool_raw.into_iter().map(|v| if v.is_nan() { None } else { Some(v) }).collect();
    let cont = c.pins();
    let held = c.u8() != 0;
    let cont_p = c.f64a(n);
    let hold_pins = c.pins();
    let drum_pins = c.pins();
    let tank_pins = c.pins();
    let sec_pins = c.pins();
    let cond_pins = c.pins();
    let mut tank_rows = Vec::with_capacity(nt);
    for _ in 0..nt {
        tank_rows.push((c.f64(), c.f64()));
    }
    let mut cond_rows = Vec::with_capacity(ncv);
    for _ in 0..ncv {
        cond_rows.push((c.f64(), c.f64(), c.f64(), c.u8() != 0, c.u8() != 0));
    }
    let mut edge_q = Vec::with_capacity(ne);
    let mut edge_gates = Vec::with_capacity(ne);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("edge_q start o={}", c.o);
    }
    for ei in 0..ne {
        edge_q.push(c.f64a(45));
        let ng = c.u32() as usize;
        if ng > 1000 {
            panic!("edge {ei} ng huge {ng} o={}", c.o);
        }
        edge_gates.push(c.f64a(ng));
    }
    let with_cap = c.u8() != 0;
    let nw = c.u32() as usize;
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("solve-tail widx nw={nw} o={}", c.o);
    }
    let widx = c.u32a(nw);
    let work_fr = c.f64a(ne);
    let pc_of = {
        let m = c.u32() as usize;
        c.i32a(m)
    };
    let pc_npc = c.u32() as usize;
    let pc_live = {
        let m = c.u32() as usize;
        c.u8a(m)
    };
    let nat_loop = c.f64a(n_loops);
    let div_sig = c.str();
    SolveTail {
        fallback_p, fallback_h, pool_lvl, cont, held, cont_p, hold_pins,
        drum_pins, tank_pins, sec_pins, cond_pins, tank_rows, cond_rows,
        edge_q, edge_gates, with_cap, warned: false, widx, work_fr, pc_of,
        pc_npc, pc_live,
        nat_loop, div_sig,
    }
}

pub fn read_sec_tail(c: &mut Cur, meta: &SecMeta) -> SecTail {
    let hold_live = c.u8a(meta.hold_tank_ids.len()).iter().map(|&v| v != 0).collect();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("sectail@hold o={}", c.o);
    }
    let stage_fed = {
        let n = c.u32() as usize;
        c.u8a(n).iter().map(|&v| v != 0).collect()
    };
    let tank_p = c.f64a(meta.tank_ids.len());
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("sectail@tank o={}", c.o);
    }
    let core_fn = c.strmap();
    let exh_open = c.u8() != 0;
    let role_turb_alive = c.i32();
    let cont_rel = c.strmap();
    let shells_live = {
        let n = c.u32() as usize;
        let mut m = HashMap::new();
        for _ in 0..n {
            let k = c.str();
            let nv = c.u32() as usize;
            m.insert(k, c.strs(nv));
        }
        m
    };
    let m_by_piece = {
        let n = c.u32() as usize;
        c.i32a(n)
    };
    let core_piece = c.i32();
    let core_pieces = {
        let n = c.u32() as usize;
        c.i32a(n)
    };
    let in_loop_bits = {
        let n = c.u32() as usize;
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let m = c.u32() as usize;
            v.push(c.u8a(m).iter().map(|&x| x != 0).collect());
        }
        v
    };
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("sectail@inloop o={}", c.o);
    }
    let dgen = c.f64();
    let net_burst_gen = c.f64();
    let cond_p = c.f64();
    let panel_hit = c.f64();
    let cond_frac = c.f64();
    let sec_p = c.strmap();
    let boiler_lvl = c.strmap();
    let loopp = c.strmap();
    let q_tank = c.strmap();
    let relief_v = c.strmap();
    let sg_feed = c.strmap();
    let sg_steam = c.strmap();
    let run_flow_keys = c.strsn();
    SecTail {
        hold_live, stage_fed, tank_p, core_fn, exh_open, role_turb_alive,
        cont_rel, shells_live, m_by_piece, core_piece, core_pieces,
        in_loop_bits, dgen, net_burst_gen, cond_p, panel_hit, cond_frac,
        sec_p, boiler_lvl, loopp, q_tank, relief_v, sg_feed, sg_steam,
        run_flow_keys,
    }
}

pub fn read_trans_tail(c: &mut Cur, n: usize, ne: usize, ntc: usize, nr: usize) -> TransTail {
    TransTail {
        src: c.f64a(n),
        metal_qv: c.f64a(n),
        metal_qm: c.u8a(n),
        booked_kg: c.f64a(n),
        boron_pin: c.f64a(n),
        fb_p: c.f64a(n),
        fb_h: c.f64a(n),
        tavg_prev_t: c.f64a(ntc),
        tavg_prev_dt: c.f64a(ntc),
        tavg_in_loop: c.u8an(),
        tavg_core_member: c.u8an(),
        rise_a: c.f64a(nr),
    }
}

pub fn read_core_tail(c: &mut Cur) -> CoreTail {
    CoreTail {
        h_in: c.f64(),
        sink: c.u8() != 0,
        sat: c.f64(),
        v_leak: c.f64(),
        rel_part: c.f64(),
        h2m2: c.f64(),
        h2m2none: c.u8() != 0,
        h2pre: c.f64(),
        h2pre_has: c.u8() != 0,
        loop_kg: c.f64(),
        core_dt_max: c.f64(),
        tilt_rate: c.f64(),
        dose: c.f64(),
        catcher: c.u8() != 0,
    }
}

pub fn read_tube_tail(c: &mut Cur) -> TubeTail {
    let taken = c.u8() != 0;
    if !taken {
        return TubeTail::default();
    }
    TubeTail {
        taken,
        n_tube: c.u8an(),
        tubes_open: c.f64(),
        trip: c.str(),
        cav_relief: c.u8() != 0,
        breach: c.u8() != 0,
        room_bang: c.f64(),
        room_p_post: c.f64an(),
        logged_ch: c.u8() != 0,
        logged_sh: c.u8() != 0,
    }
}

pub fn read_events_tail(c: &mut Cur) -> EventsTail {
    EventsTail {
        rps_state: c.str(),
        sink_runback: c.u8() != 0,
        runback_live: c.u8() != 0,
        dry_ids: c.strsn(),
        panel_hit: c.f64(),
        cond_frac: c.f64(),
        cont_rel: c.strmap(),
        party_cells: c.u32an().into_iter().map(|v| v as usize).collect(),
    }
}

// __STAGE_READERS__
pub fn cmp_bag(cmp: &mut Cmp, si: usize, path: &str, a_v: &[f64], a_h: &[u8], b_v: &[f64], b_h: &[u8]) {
    cmp_vec_f64(cmp, si, &format!("{path}.v"), a_v, b_v);
    if a_h != b_h {
        cmp.fail(si, format!("{path}.has mismatch"));
    }
}

pub fn read_log_list(c: &mut Cur) -> Vec<(u8, u32)> {
    let n = c.u32() as usize;
    let mut v = Vec::with_capacity(n);
    for _ in 0..n {
        v.push((c.u8(), c.u32()));
    }
    v
}

// One commissioned preset: frozen metas + live S0 state. Mirrors the S0
// section of the step-probe main loop; the probe now calls this, and the
// WASM engine ingest path (`sim_ingest`) uses it to seed live state.
pub struct Preset {
    pub meta: StepMeta,
    pub st: StepState,
    pub core_ids: Vec<String>,
}

pub fn read_preset(c: &mut Cur, pi: usize, ver: u32) -> Preset {
    let sec_meta = read_sec_meta(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-secmeta o={}", c.o);
    }
    let sec_curves = read_sec_curves(c);
    let room_meta = read_room_meta(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-roommeta o={}", c.o);
    }
    let room_curves = read_room_curves(c);
    let events_meta = read_events_meta(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-eventsmeta o={}", c.o);
    }
    let ncore = c.u32() as usize;
    let mut core_ids = Vec::with_capacity(ncore);
    let mut core_k = HashMap::new();
    for _ in 0..ncore {
        let id = c.str();
        core_k.insert(id.clone(), read_core_k(c));
        core_ids.push(id);
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-coreK o={}", c.o);
    }
    let solve_frozen = read_solve_frozen(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-solve o={}", c.o);
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-solve o={}", c.o);
    }
    let trans_meta = read_trans_meta(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} post-trans o={}", c.o);
    }
    let meta = StepMeta {
        sec: sec_meta,
        sec_curves,
        room: room_meta,
        room_curves,
        events: events_meta,
        core_k,
        core_ids: core_ids.clone(),
        solve: solve_frozen,
        trans: trans_meta,
        ctl: CtlMeta::default(),
    };
    let sec0 = read_sec_state(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-sec o={}", c.o);
    }
    let room0 = read_room_state(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-room o={}", c.o);
    }
    let events0 = read_events_state(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-events o={}", c.o);
    }
    let mut core0 = HashMap::new();
    let ncore2 = c.u32() as usize;
    for _ in 0..ncore2 {
        let id = c.str();
        core0.insert(id, read_core_state(c));
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-cores o={}", c.o);
        for (id, cs) in &core0 {
            eprintln!("preset {pi} S0-coren {id}={}", cs.n);
        }
    }
    let mut bags = HashMap::new();
    for name in ["mBy", "hBy", "pBy", "bBy", "h2By", "metalT"] {
        bags.insert(name.to_string(), (c.f64an(), c.u8an()));
    }
    if std::env::var("PROBE_DEBUG").is_ok() && pi == 0 {
        let (mv, mh) = &bags["mBy"];
        eprintln!("S0-mBy62 {}", (60..72).map(|i| format!("{i}:{}:{}", mv.get(i).copied().unwrap_or(f64::NAN), mh.get(i).copied().unwrap_or(9))).collect::<Vec<_>>().join(" "));
    }
    let blk_out0 = c.f64an();
    let blk_f0 = c.f64an();
    let tavg0 = c.f64();
    let dtavg0 = c.f64();
    let mut tavg_by0 = HashMap::new();
    for _ in 0..c.u32() {
        tavg_by0.insert(c.str(), c.f64());
    }
    let mut dtavg_by0 = HashMap::new();
    for _ in 0..c.u32() {
        dtavg_by0.insert(c.str(), c.f64());
    }
    let n = meta.solve.n;
    let ne = meta.solve.ne;
    let f_seed = c.f64a(n);
    let f_seed1 = c.f64a(n);
    let f_seed2 = c.f64a(n);
    let f_seed3 = c.f64a(n);
    let f_seed4 = c.f64a(n);
    let f_seed5 = c.f64a(n);
    let f_seed6 = c.f64a(n);
    let f_seed7 = c.u8a(n);
    let f_seed8 = c.u8a(n);
    let f_seed9 = c.f64a(n);
    let f_seed10 = c.f64a(n);
    let f_seed11 = c.f64a(n);
    let f_seed12 = c.f64a(n);
    let warr0 = c.f64a(ne);
    let fixv0 = c.f64a(n);
    let choke0 = c.u8() != 0;
    let memo_kp = c.f64a(n);
    let memo_kh = c.f64a(n);
    let memo_km = c.f64a(n);
    let memo_p0 = c.f64a(n);
    let memo_c = c.f64a(n);
    let pc_of = {
        let m = c.u32() as usize;
        c.i32a(m)
    };
    let pc_npc = c.u32() as usize;
    let pc_live = {
        let m = c.u32() as usize;
        c.u8a(m)
    };
    let div_sig0 = c.str();
    let inj_present = c.u8() != 0;
    let (ik, ir, it) = if inj_present { (c.u8(), c.f64(), c.i32()) } else { (0, 0.0, -1) };
    let room_inj = room::RoomInject { present: inj_present, kind: ik, rate: ir, target: it };
    let room_cg0 = c.u32();
    let room_pgen0 = c.u32();
    let room_gsx0 = c.f64an();
    let room_disp0 = c.f64an();
    let log0init = read_log_list(c);
    let tick0 = c.u32();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-done o={}", c.o);
    }
    // v2: commission-seeded transport scratch (live engine reads these at
    // tick 0 before the first transport pass; v1 leaves the cache empty).
    let seed_cache = if ver >= 2 {
        let feed_hv = c.f64an();
        let feed_hm = c.u8an();
        let feed_mv = c.f64an();
        let feed_mm = c.u8an();
        let core_hv = c.f64an();
        let core_hm = c.u8an();
        Some(AdvectCache {
            feed_hv, feed_hm, feed_mv, feed_mm,
            core_hv, core_hm,
            ..Default::default()
        })
    } else {
        None
    };
    let mut st = StepState {
        sec: sec0,
        room: room0,
        events: events0,
        core: core0,
        m_by: NodeBag { v: bags["mBy"].0.clone(), has: bags["mBy"].1.clone() },
        h_by: NodeBag { v: bags["hBy"].0.clone(), has: bags["hBy"].1.clone() },
        p_by: NodeBag { v: bags["pBy"].0.clone(), has: bags["pBy"].1.clone() },
        b_by: NodeBag { v: bags["bBy"].0.clone(), has: bags["bBy"].1.clone() },
        h2_by: NodeBag { v: bags["h2By"].0.clone(), has: bags["h2By"].1.clone() },
        metal: NodeBag { v: bags["metalT"].0.clone(), has: bags["metalT"].1.clone() },
        mass_out: HashMap::new(),
        mass_out_order: vec![],
        dmg_parts: vec![],
        dmg_why: HashMap::new(),
        blk_out: blk_out0,
        blk_f: blk_f0,
        log: log0init.into_iter().map(|(s, cd)| tick::LogEv { sev: s, code: cd }).collect(),
        room_cg_it: room_cg0,
        room_liq_it: 0,
        room_pgen: room_pgen0,
        room_gsx: room_gsx0,
        room_disp: room_disp0,
        tavg: tavg0,
        dtavg: dtavg0,
        tavg_by: tavg_by0,
        dtavg_by: dtavg_by0,
        room_inj,
        advect_cache: seed_cache,
        field: FieldCarry::default(),
        solve_carry: SolveCarried::default(),
        tick: tick0 as u64,
    };
    st.mass_out = st.sec.mass_out.clone();
    st.mass_out_order = st.sec.mass_out_order.clone();
    st.dmg_parts = st.sec.dmg_parts.clone();
    st.dmg_why = st.sec.dmg_why.clone();
    st.solve_carry.fs = field::FieldState {
        p: f_seed, rho: f_seed1, x: f_seed2, b: f_seed3, rho_d: f_seed4,
        rho_g: f_seed5, rho_l: f_seed6, wet: f_seed7, void_: f_seed8,
        mu: f_seed9, lp: f_seed10, lh: f_seed11, lm: f_seed12,
    };
    st.solve_carry.memo = store::StoreState {
        kp: memo_kp, kh: memo_kh, km: memo_km, p0: memo_p0, cc: memo_c,
    };
    st.solve_carry.warr = warr0;
    st.solve_carry.fix_v = fixv0;
    st.solve_carry.choke = choke0;
    st.solve_carry.pc_of = pc_of;
    st.solve_carry.pc_npc = pc_npc;
    st.solve_carry.pc_live = pc_live;
    st.solve_carry.div_sig = Some(div_sig0);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} S0-carried o={}", c.o);
    }
    Preset { meta, st, core_ids }
}

// One dumped tick: inputs, tails, and expected post-states. Parsed in wire
// order; the step probe replays + compares from this, live-probe audits
// constancy and verifies live derivation against it.
pub struct Tick {
    pub dt: f64,
    pub sample: ctl::Sample,
    pub want_out: Vec<f64>,
    pub want_f: Vec<f64>,
    pub ctl_keys: CtlMeta,
    pub solve_tail: SolveTail,
    pub sec_tail: SecTail,
    pub trans_tail: TransTail,
    pub core_tail: HashMap<String, CoreTail>,
    pub bore: HashMap<String, f64>,
    pub events_tail: EventsTail,
    pub trip_near_mid: bool,
    pub inject_node: Option<String>,
    pub h2_post_vessel: f64,
    pub tube: HashMap<String, TubeTail>,
    pub want_sec: sec::SecState,
    pub want_room: room::RoomState,
    pub want_cg: u32,
    pub want_liq: u32,
    pub want_pgen: u32,
    pub want_events: events::EventsState,
    pub want_ann_sec_p: HashMap<String, f64>,
    pub want_ann_boiler_lvl: HashMap<String, f64>,
    pub want_core: HashMap<String, core::CoreState>,
    pub want_bags: HashMap<String, (Vec<f64>, Vec<u8>)>,
    pub want_blk_out: Vec<f64>,
    pub want_blk_f: Vec<f64>,
    pub want_tavg: f64,
    pub want_dtavg: f64,
    pub want_tavg_by: HashMap<String, f64>,
    pub want_dtavg_by: HashMap<String, f64>,
    pub wf: Vec<f64>,
    pub wf1: Vec<f64>,
    pub wf2: Vec<f64>,
    pub wf3: Vec<f64>,
    pub wf4: Vec<f64>,
    pub wf5: Vec<f64>,
    pub wf6: Vec<f64>,
    pub wf7: Vec<u8>,
    pub wf8: Vec<u8>,
    pub wf9: Vec<f64>,
    pub wf10: Vec<f64>,
    pub wf11: Vec<f64>,
    pub wf12: Vec<f64>,
    pub wm0: Vec<f64>,
    pub wm1: Vec<f64>,
    pub wm2: Vec<f64>,
    pub wm3: Vec<f64>,
    pub wm4: Vec<f64>,
    pub wwarr: Vec<f64>,
    pub want_log: Vec<(u8, u32)>,
    pub want_warns: u32,
    pub want_div: Vec<u32>,
}

pub fn read_tick(c: &mut Cur, meta: &StepMeta, ncore: usize, pi: usize, ti: usize) -> Tick {
    let n = meta.solve.n;
    let ne = meta.solve.ne;
    let _tag = c.u32();
    let dt = c.f64();
    let (sample, want_out, want_f) = read_ctl_sample(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} tick {ti} post-ctl o={}", c.o);
    }
    let ctl_keys = CtlMeta {
        freg_keys: c.strsn(),
        flow_keys: c.strsn(),
        valve_keys: c.strsn(),
        tank_keys: c.strsn(),
        relief_keys: c.strsn(),
        core_ids: c.strsn(),
    };
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("preset {pi} tick {ti} post-ctlkeys o={}", c.o);
    }
    if std::env::var("PROBE_DEBUG").is_ok() && pi == 0 && ti == 0 {
        for (i, b) in sample.blocks.iter().enumerate() {
            if b.sink_kind == 1 {
                eprintln!("fregsink blk{i} on={} dead={} arg={} inputs={:?} exist={:?}", b.on, b.dead, b.sink_arg, b.inputs, sample.act.freg_exist);
            }
        }
        eprintln!("fregact {:?}", sample.act.freg);
        if sample.blocks.len() > 21 {
            let b = &sample.blocks[21];
            eprintln!("blk21 mode={} on={} dead={} inputs={:?} knob={:?} nullmask={} outpre={} fpre={}", b.mode, b.on, b.dead, b.inputs, b.knob, b.nullmask, sample.out_pre[21], sample.f_pre[21]);
        }
    }
    let solve_tail = read_solve_tail(c, n, ne, meta.solve.n_loops, meta.solve.tank_order.len(), meta.solve.cond_v.len());
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} solve-tail o={}", c.o);
    }
    let sec_tail = read_sec_tail(c, &meta.sec);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} sec-tail o={}", c.o);
    }
    let trans_tail = read_trans_tail(c, n, ne, meta.trans.tavg_circs.len(), meta.trans.rise_lo.len());
    let mut core_tail = HashMap::new();
    for _ in 0..ncore {
        let id = c.str();
        core_tail.insert(id, read_core_tail(c));
    }
    let bore_n = c.u32() as usize;
    let mut bore = HashMap::new();
    for _ in 0..bore_n {
        bore.insert(c.str(), c.f64());
    }
    let events_tail = read_events_tail(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} events-tail o={}", c.o);
    }
    let trip_near_mid = c.u8() != 0;
    let inj_node_raw = c.str();
    let inject_node = if inj_node_raw.is_empty() { None } else { Some(inj_node_raw) };
    let h2_post_vessel = c.f64();
    let ntube = c.u32() as usize;
    let mut tube = HashMap::new();
    for _ in 0..ntube {
        let id = c.str();
        tube.insert(id, read_tube_tail(c));
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} pre-postsec o={}", c.o);
    }
    let want_sec = read_sec_state(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} post-sec o={}", c.o);
    }
    let want_room = read_room_state(c);
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} post-room o={}", c.o);
    }
    let want_cg = c.u32();
    let want_liq = c.u32();
    let want_pgen = c.u32();
    let want_events = read_events_state(c);
    let want_ann_sec_p = c.strmap();
    let want_ann_boiler_lvl = c.strmap();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} post-events o={}", c.o);
    }
    let mut want_core = HashMap::new();
    let ncore_post = c.u32() as usize;
    for _ in 0..ncore_post {
        let id = c.str();
        want_core.insert(id.clone(), read_core_state(c));
    }
    let mut want_bags = HashMap::new();
    for name in ["mBy", "hBy", "pBy", "bBy", "h2By", "metalT"] {
        want_bags.insert(name.to_string(), (c.f64an(), c.u8an()));
    }
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} post-bags o={}", c.o);
    }
    let want_blk_out = c.f64an();
    let want_blk_f = c.f64an();
    if std::env::var("PROBE_DEBUG").is_ok() {
        eprintln!("tick {ti} post-blk o={}", c.o);
    }
    let want_tavg = c.f64();
    let want_dtavg = c.f64();
    let mut want_tavg_by = HashMap::new();
    for _ in 0..c.u32() {
        want_tavg_by.insert(c.str(), c.f64());
    }
    let mut want_dtavg_by = HashMap::new();
    for _ in 0..c.u32() {
        want_dtavg_by.insert(c.str(), c.f64());
    }
    let wf = c.f64a(n);
    let wf1 = c.f64a(n);
    let wf2 = c.f64a(n);
    let wf3 = c.f64a(n);
    let wf4 = c.f64a(n);
    let wf5 = c.f64a(n);
    let wf6 = c.f64a(n);
    let wf7 = c.u8a(n);
    let wf8 = c.u8a(n);
    let wf9 = c.f64a(n);
    let wf10 = c.f64a(n);
    let wf11 = c.f64a(n);
    let wf12 = c.f64a(n);
    let wm0 = c.f64a(n);
    let wm1 = c.f64a(n);
    let wm2 = c.f64a(n);
    let wm3 = c.f64a(n);
    let wm4 = c.f64a(n);
    let wwarr = c.f64a(ne);
    let want_log = read_log_list(c);
    let want_warns = c.u32();
    let want_div = {
        let m = c.u32() as usize;
        c.u32a(m)
    };
    Tick {
        dt, sample, want_out, want_f, ctl_keys, solve_tail, sec_tail,
        trans_tail, core_tail, bore, events_tail, trip_near_mid,
        inject_node, h2_post_vessel, tube, want_sec, want_room, want_cg,
        want_liq, want_pgen, want_events, want_ann_sec_p,
        want_ann_boiler_lvl, want_core, want_bags, want_blk_out,
        want_blk_f, want_tavg, want_dtavg, want_tavg_by, want_dtavg_by,
        wf, wf1, wf2, wf3, wf4, wf5, wf6, wf7, wf8, wf9, wf10, wf11,
        wf12, wm0, wm1, wm2, wm3, wm4, wwarr, want_log, want_warns,
        want_div,
    }
}
