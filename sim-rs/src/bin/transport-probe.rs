//! Transport replayer for the §6.3 gate (`node tools/transport-gate.js`).
//! Replays `advectStep` per sample from dumped plant reads (dump-kit: src,
//! anchors, booked quantities, fallbacks, Tavg/boron context, rise areas)
//! and demands exact mask/count agreement plus sdig-semantics float
//! agreement. Also replays the synthetic `injectFluid` cases. Dev-only.
use sim_rs::eos::Curve;
use sim_rs::transport::*;

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
    fn f64a(&mut self, n: usize) -> Vec<f64> {
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            v.push(f64::from_le_bytes([
                self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3],
                self.b[self.o + 4], self.b[self.o + 5], self.b[self.o + 6], self.b[self.o + 7],
            ]));
            self.o += 8;
        }
        v
    }
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n).map(|_| self.i32()).collect()
    }
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
}

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits()
}

struct Cmp {
    fails: u32,
    worst: f64,
    worst_at: String,
    shown: u32,
}

impl Cmp {
    fn floats(&mut self, si: usize, nm: &str, got: &[f64], want: &[f64]) {
        for (i, (&a, &b)) in got.iter().zip(want.iter()).enumerate() {
            if bits(a, b) || (a.is_nan() && b.is_nan()) {
                continue;
            }
            let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
            if r > self.worst {
                self.worst = r;
                self.worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
            }
            if r > 1e-6 {
                self.fails += 1;
                if self.shown < 8 {
                    println!("sample {si}: {nm}[{i}] {a:e} vs {b:e} (rel {r:e})");
                    self.shown += 1;
                }
                break;
            }
        }
    }
    fn float1(&mut self, si: usize, nm: &str, a: f64, b: f64) {
        if bits(a, b) || (a.is_nan() && b.is_nan()) {
            return;
        }
        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
        if r > self.worst {
            self.worst = r;
            self.worst_at = format!("sample {si}: {nm} {a} vs {b}");
        }
        if r > 1e-6 {
            self.fails += 1;
            if self.shown < 8 {
                println!("sample {si}: {nm} {a:e} vs {b:e} (rel {r:e})");
                self.shown += 1;
            }
        }
    }
    fn ints(&mut self, si: usize, nm: &str, got: &[u8], want: &[u8]) {
        if got != want {
            self.fails += 1;
            let bad: Vec<usize> =
                got.iter().zip(want.iter()).enumerate().filter(|(_, (&a, &b))| a != b).map(|(i, _)| i).take(5).collect();
            println!("sample {si}: {nm} mask mismatch at {bad:?}");
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut cmp = Cmp { fails: 0, worst: 0.0, worst_at: String::new(), shown: 0 };
    let mut n_samples = 0u32;
    let mut n_inj = 0u32;
    let debug = std::env::var("PROBE_DEBUG").is_ok();
    for pi in 0..np {
        let n = c.u32() as usize;
        let ne = c.u32() as usize;
        assert_eq!(c.u32(), 1, "format v1");
        let eu = c.u32a(ne);
        let ev = c.u32a(ne);
        let vol = c.f64a(n);
        let z = c.f64a(n);
        let booked = c.u8a(n);
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
            let v = c.f64a(17);
            curves.push(Curve::new(
                v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12],
                v[13], v[14], v[15], v[16],
            ));
        }
        let curve_of = c.u32a(n);
        let nf = c.u32() as usize;
        let feed_idx = c.u32a(nf);
        let ncf = c.u32() as usize;
        let core_idx = c.u32a(ncf);
        let ntc = c.u32() as usize;
        let mut tavg_circs = Vec::with_capacity(ntc);
        for _ in 0..ntc {
            let ci = c.i32();
            let curve = c.u32();
            let tmin = c.f64a(1)[0];
            let tmax = c.f64a(1)[0];
            tavg_circs.push(TavgCirc { ci, curve, tmin, tmax });
        }
        let core_node = c.i32();
        let has_boron = c.u32() != 0;
        let core_circ = c.i32();
        let consts = c.f64a(6);
        let (cond_p0, cp_steel, h2_rise, dry_min_kg, core_dt_qmin, tavg_rate_tau) =
            (consts[0], consts[1], consts[2], consts[3], consts[4], consts[5]);
        let nr = c.u32() as usize;
        let rise_lo = c.u32a(nr);
        let rise_hi = c.u32a(nr);

        let st = TransportNodes {
            vol, z, booked, book_id, tank_has, curve_of,
            metal_kg, metal_tau, metal_ua, in_core, circ_of, ref_thru, anch_skip,
        };
        let ed = TransportEdges {
            u: eu, v: ev, gas_at, liq_at, is_break, is_hole, steam, sec, opos, n_out,
        };
        let ns = c.u32() as usize;
        for si in 0..ns {
            let dt = c.f64a(1)[0];
            let fp = c.f64a(n);
            let fx = c.f64a(n);
            let frho = c.f64a(n);
            let frhog = c.f64a(n);
            let frhol = c.f64a(n);
            let fmu = c.f64a(n);
            let _ = fmu;
            let fwet = c.u8a(n);
            let fvoid = c.u8a(n);
            let hv = c.f64a(n);
            let mv = c.f64a(n);
            let pbv = c.f64a(n);
            let fbp = c.f64a(n);
            let fbh = c.f64a(n);
            let hh = c.u8a(n);
            let mh = c.u8a(n);
            let pbh = c.u8a(n);
            let bv = c.f64a(n);
            let cv = c.f64a(n);
            let metalv = c.f64a(n);
            let src = c.f64a(n);
            let metalqv = c.f64a(n);
            let bh = c.u8a(n);
            let ch = c.u8a(n);
            let metalh = c.u8a(n);
            let metalqm = c.u8a(n);
            let booked_kg = c.f64a(n);
            let edge_kg_in = c.f64a(ne);
            let boron_prev = c.f64a(1)[0];
            let boron_dem_prev = c.f64a(1)[0];
            let h2_prev = c.f64a(1)[0];
            let tavg_prev = c.f64a(1)[0];
            let dtavg_prev = c.f64a(1)[0];
            let tavg_prev_t = c.f64a(ntc);
            let tavg_prev_dt = c.f64a(ntc);
            let tavg_in_loop = c.u8a(ntc * n);
            let tavg_core_member = c.u8a(ntc * n);
            let boron_pin = c.f64a(n);
            let _madv_pre = c.f64a(1)[0];
            // expected
            let e_hv = c.f64a(n);
            let e_mv = c.f64a(n);
            let e_bv = c.f64a(n);
            let e_cv = c.f64a(n);
            let e_metalv = c.f64a(n);
            let e_edgekg = c.f64a(ne);
            let e_landed = c.f64a(n);
            let e_hh = c.u8a(n);
            let e_mh = c.u8a(n);
            let e_bh = c.u8a(n);
            let e_ch = c.u8a(n);
            let scal = c.f64a(8);
            let (e_pri, e_sec, e_booked, e_boron, e_boron_dem, e_h2, e_tavg, e_dtavg) =
                (scal[0], scal[1], scal[2], scal[3], scal[4], scal[5], scal[6], scal[7]);
            let e_okv = c.f64a(n_out);
            let e_ohv = c.f64a(n_out);
            let e_fhv = c.f64a(n);
            let e_fmv = c.f64a(n);
            let e_chv = c.f64a(n);
            let e_takev = c.f64a(n);
            let e_okm = c.u8a(n_out);
            let e_ohm = c.u8a(n_out);
            let e_fhm = c.u8a(n);
            let e_fmm = c.u8a(n);
            let e_chm = c.u8a(n);
            let e_takem = c.u8a(n);
            let e_tt = c.f64a(ntc);
            let e_tdt = c.f64a(ntc);
            let e_clamped = c.u32();
            let e_madv = c.f64a(1)[0];
            let rise_a = c.f64a(nr);

            let samp = TransportSample {
                dt,
                f: TransportField {
                    p: &fp, x: &fx, rho: &frho, rho_g: &frhog, rho_l: &frhol,
                    wet: &fwet, void_: &fvoid,
                },
                h_v: &hv, h_has: &hh, m_v: &mv, m_has: &mh,
                pb_v: &pbv, pb_has: &pbh, fb_p: &fbp, fb_h: &fbh,
                b_v: &bv, b_has: &bh, c_v: &cv, c_has: &ch,
                metal_v: &metalv, metal_has: &metalh,
                src: &src, metal_qv: &metalqv, metal_qm: &metalqm,
                booked_kg: &booked_kg, boron_pin: &boron_pin, edge_kg_in: &edge_kg_in,
                tavg_circs: &tavg_circs, tavg_prev_t: &tavg_prev_t,
                tavg_prev_dt: &tavg_prev_dt, tavg_in_loop: &tavg_in_loop,
                tavg_core_member: &tavg_core_member,
                tavg_top: TavgTop { tavg_prev, dtavg_prev },
                has_boron, core_node, boron_prev, boron_dem_prev, h2_prev, core_circ,
                rise_lo: &rise_lo, rise_hi: &rise_hi, rise_a: &rise_a,
                cond_p0, cp_steel, h2_rise, dry_min_kg, core_dt_qmin, tavg_rate_tau,
            };
            let got = advect_step(&curves, &st, &ed, &feed_idx, &core_idx, &samp);
            if debug {
                for (nm, g, w) in [
                    ("h", &got.h_v, &e_hv), ("m", &got.m_v, &e_mv),
                    ("b", &got.b_v, &e_bv), ("h2", &got.c_v, &e_cv),
                    ("edgeKg", &got.edge_kg, &e_edgekg),
                ] as [(&str, &Vec<f64>, &Vec<f64>); 5] {
                    let mut wr = 0.0;
                    let mut wi = 0;
                    for (i, (&a, &b)) in g.iter().zip(w.iter()).enumerate() {
                        if a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()) {
                            continue;
                        }
                        let r = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                        if r > wr {
                            wr = r;
                            wi = i;
                        }
                    }
                    println!("dbg preset {pi} sample {si}: worst-{nm}={wr:e} @ {wi}");
                }
            }
            cmp.floats(si, "h", &got.h_v, &e_hv);
            cmp.floats(si, "m", &got.m_v, &e_mv);
            cmp.floats(si, "b", &got.b_v, &e_bv);
            cmp.floats(si, "h2", &got.c_v, &e_cv);
            cmp.floats(si, "metalT", &got.metal_v, &e_metalv);
            cmp.floats(si, "edgeKg", &got.edge_kg, &e_edgekg);
            cmp.floats(si, "landed", &got.landed, &e_landed);
            cmp.floats(si, "outKg", &got.out_kg_v, &e_okv);
            cmp.floats(si, "outH2", &got.out_h2_v, &e_ohv);
            cmp.floats(si, "feedH", &got.feed_hv, &e_fhv);
            cmp.floats(si, "feedM", &got.feed_mv, &e_fmv);
            cmp.floats(si, "coreH", &got.core_hv, &e_chv);
            cmp.floats(si, "h2Take", &got.h2_take_v, &e_takev);
            cmp.floats(si, "tavgT", &got.tavg_t, &e_tt);
            cmp.floats(si, "tavgDT", &got.tavg_dt, &e_tdt);
            cmp.float1(si, "outPri", got.out_pri, e_pri);
            cmp.float1(si, "outSec", got.out_sec, e_sec);
            cmp.float1(si, "advBooked", got.advect_booked, e_booked);
            cmp.float1(si, "boron", got.boron, e_boron);
            cmp.float1(si, "boronDem", got.boron_dem, e_boron_dem);
            cmp.float1(si, "h2tot", got.h2, e_h2);
            cmp.float1(si, "Tavg", got.tavg, e_tavg);
            cmp.float1(si, "dTavg", got.dtavg, e_dtavg);
            cmp.float1(si, "massOutAdv", _madv_pre + got.advect_booked, e_madv);
            cmp.ints(si, "hHas", &got.h_has, &e_hh);
            cmp.ints(si, "mHas", &got.m_has, &e_mh);
            cmp.ints(si, "bHas", &got.b_has, &e_bh);
            cmp.ints(si, "cHas", &got.c_has, &e_ch);
            cmp.ints(si, "outKgM", &got.out_kg_m, &e_okm);
            cmp.ints(si, "outH2M", &got.out_h2_m, &e_ohm);
            cmp.ints(si, "feedHM", &got.feed_hm, &e_fhm);
            cmp.ints(si, "feedMM", &got.feed_mm, &e_fmm);
            cmp.ints(si, "coreHM", &got.core_hm, &e_chm);
            cmp.ints(si, "h2TakeM", &got.h2_take_m, &e_takem);
            if got.clamped != e_clamped {
                cmp.fails += 1;
                println!("sample {si}: CLAMPED {} vs {e_clamped}", got.clamped);
            }
            n_samples += 1;
        }
        let ninj = c.u32() as usize;
        for ii in 0..ninj {
            let node = c.i32();
            let have_none = c.u32() != 0;
            let have = c.f64a(1)[0];
            let rate = c.f64a(1)[0];
            let dt = c.f64a(1)[0];
            let exp_acted = c.u32() != 0;
            let exp_have = c.f64a(1)[0];
            let exp_booked = c.f64a(1)[0];
            let _ = node;
            let got = inject_fluid(if have_none { None } else { Some(have) }, rate, dt);
            if got.acted != exp_acted {
                cmp.fails += 1;
                println!("inject {ii}: ACTED {} vs {exp_acted}", got.acted);
            }
            cmp.float1(ii as usize, "injHave", got.have, exp_have);
            cmp.float1(ii as usize, "injBooked", got.booked, exp_booked);
            n_inj += 1;
        }
    }
    println!(
        "presets={np} samples={n_samples} injects={n_inj} worst-rel={:e} @ {} FAILURES={}",
        cmp.worst, cmp.worst_at, cmp.fails
    );
}
