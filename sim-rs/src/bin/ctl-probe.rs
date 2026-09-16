//! Control-cabinet replayer for the §6.5 gate (`node tools/ctl-gate.js`).
//! Replays `ctlPass` per sample from dumped block graphs (dump-kit: source
//! values at evaluation point, sink dead bits, scram blame strings, actuator
//! pre-state) and demands exact order agreement plus bit-exact outputs and
//! actuator state. No transcendentals flow through control, so the bar is
//! bit-exact like the pieces gate. Dev-only.
use sim_rs::ctl::*;

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
    fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes([self.b[self.o], self.b[self.o + 1]]);
        self.o += 2;
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
    fn str(&mut self) -> String {
        let n = self.u32() as usize;
        let v = String::from_utf8(self.b[self.o..self.o + n].to_vec()).unwrap();
        self.o += n;
        v
    }
}

fn same_bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

struct Cmp {
    fails: u32,
    worst: f64,
    worst_at: String,
    shown: u32,
}

impl Cmp {
    fn exact(&mut self, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if same_bits(a, b) {
                continue;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
            }
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                self.shown += 1;
            } else {
                break;
            }
        }
    }
    fn exact1(&mut self, si: usize, nm: &str, a: f64, b: f64) {
        if same_bits(a, b) {
            return;
        }
        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if r > self.worst {
            self.worst = r;
            self.worst_at = format!("sample {si}: {nm} {a} vs {b}");
        }
        self.fails += 1;
        if self.shown < 10 {
            println!("sample {si}: {nm} {a:e} vs {b:e} (rel {r:e})");
            self.shown += 1;
        }
    }
    fn bit(&mut self, si: usize, nm: &str, a: u8, b: u8) {
        if a != b {
            self.fails += 1;
            if self.shown < 10 {
                println!("sample {si}: {nm} {a} vs {b}");
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

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let ns = c.u32() as usize;
    assert_eq!(c.u32(), 1, "format v1");
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    let mut n_blocks = 0usize;
    let mut tags = [0u32; 3];
    for si in 0..ns {
        let tag = c.u32();
        tags[(tag as usize).min(2)] += 1;
        let dt = c.f64();
        let live = c.u8() != 0;
        let n = c.u32() as usize;
        n_blocks += n;
        let ids: Vec<String> = (0..n).map(|_| c.str()).collect();
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
        let (w_load, w_load_dem, w_boron) = (c.f64(), c.f64(), c.f64());
        let w_rb = c.u8() != 0;
        let w_freg = c.f64a(nf);
        let w_flow = c.f64a(nw);
        let w_valve = c.f64a(nv);
        let w_tank = c.u8a(nt);
        let mut w_relief = Vec::with_capacity(nr);
        for _ in 0..nr {
            let cell = c.u8a(4);
            w_relief.push(cell);
        }
        let mut w_cores = Vec::with_capacity(nc);
        for _ in 0..nc {
            let rod_dem = c.f64();
            let nb = cores[w_cores.len()].rod_zdem.len();
            let rod_zdem = c.f64a(nb);
            let fl = c.u8a(4);
            let rps_hot = c.f64();
            let trip = c.str();
            w_cores.push((rod_dem, rod_zdem, fl, rps_hot, trip));
        }

        let sample = Sample {
            dt,
            live,
            blocks,
            order: order.clone(),
            out_pre: out_pre.clone(),
            f_pre: f_pre.clone(),
            act: Act {
                ar_lo,
                ar_hi,
                load_max,
                rps_lag,
                p_rated,
                load,
                load_dem,
                boron_dem,
                rb_hot,
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
        let fails_before = cmp.fails;
        let got_order = ctl_order(&sample.blocks);
        if got_order != order {
            cmp.fails += 1;
            if cmp.shown < 10 {
                let bad = got_order
                    .iter()
                    .zip(order.iter())
                    .enumerate()
                    .filter(|(_, (&a, &b))| a != b)
                    .map(|(i, _)| i)
                    .take(5)
                    .collect::<Vec<_>>();
                println!("sample {si}: order mismatch at {bad:?}");
                cmp.shown += 1;
            }
        }
        let r = ctl_replay(&sample);
        cmp.exact(si, "out", &r.out, &want_out);
        cmp.exact(si, "fv", &r.f, &want_f);
        cmp.exact1(si, "load", r.act.load, w_load);
        cmp.exact1(si, "loadDem", r.act.load_dem, w_load_dem);
        cmp.exact1(si, "boronDem", r.act.boron_dem, w_boron);
        cmp.bit(si, "rbHot", r.act.rb_hot as u8, w_rb as u8);
        cmp.exact(si, "freg", &r.act.freg, &w_freg);
        cmp.exact(si, "flowDem", &r.act.flow, &w_flow);
        cmp.exact(si, "valveDem", &r.act.valve, &w_valve);
        let got_tank: Vec<u8> = r.act.tank.iter().map(|&v| v as u8).collect();
        if got_tank != w_tank {
            cmp.fails += 1;
            if cmp.shown < 10 {
                println!("sample {si}: tank mismatch");
                cmp.shown += 1;
            }
        }
        for (i, (g, w)) in r.act.relief.iter().zip(w_relief.iter()).enumerate() {
            let gg = [g.open as u8, g.auto as u8, g.stuck as u8, g.arm as u8];
            if gg != w.as_slice() {
                cmp.fails += 1;
                if cmp.shown < 10 {
                    println!("sample {si}: relief[{i}] {gg:?} vs {w:?}");
                    cmp.shown += 1;
                }
            }
        }
        for (i, (g, w)) in r.act.cores.iter().zip(w_cores.iter()).enumerate() {
            cmp.exact1(si, &format!("core[{i}].rodDem"), g.rod_dem, w.0);
            cmp.exact(si, &format!("core[{i}].rodZDem"), &g.rod_zdem, &w.1);
            cmp.bit(si, &format!("core[{i}].rodBand"), g.rod_band as u8, w.2[0]);
            cmp.bit(si, &format!("core[{i}].scrammed"), g.scrammed as u8, w.2[1]);
            cmp.exact1(si, &format!("core[{i}].rpsHot"), g.rps_hot, w.3);
            cmp.bit(si, &format!("core[{i}].rpsNear"), g.rps_near as u8, w.2[2]);
            cmp.bit(si, &format!("core[{i}].rodJam"), g.rod_jam as u8, w.2[3]);
            cmp.text(si, &format!("core[{i}].trip"), &g.trip, &w.4);
        }
        let _ = &ids;
        if cmp.fails > fails_before && std::env::var("PROBE_DEBUG").is_ok() {
            println!("sample {si}: tag={tag} n={n} live={live}");
        }
    }
    assert_eq!(c.o, bytes.len(), "trailing bytes");
    println!(
        "samples={ns} blocks={n_blocks} tags=[{} {} {}] worst-rel={:.2e} @ {} FAILURES={}",
        tags[0], tags[1], tags[2], cmp.worst, cmp.worst_at, cmp.fails
    );
}
