//! Nodal field-update replayer for the §6.2c gate (`node tools/field-gate.js`).
//! Replays `field_update` per sample in order (F carried) and demands exact
//! u8 agreement plus sdig-semantics (rel <= 1e-6) float agreement. Dev-only.
use sim_rs::eos::Curve;
use sim_rs::field::*;

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
    fn u32a(&mut self, n: usize) -> Vec<u32> {
        (0..n).map(|_| self.u32()).collect()
    }
    fn u8a(&mut self, n: usize) -> Vec<u8> {
        let v = self.b[self.o..self.o + n].to_vec();
        self.o += n;
        v
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut fails = 0;
    let mut worst = 0.0;
    let mut worst_at = String::new();
    for _ in 0..np {
        let (n, ne) = (c.u32() as usize, c.u32() as usize);
        assert_eq!(c.u32(), 1, "format v1");
        let vol = c.f64a(n);
        let run_mask = c.u8a(n);
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
        let ng = c.u32() as usize;
        let gas_nodes = c.u32a(ng);
        let nl = c.u32() as usize;
        let liq_nodes = c.u32a(nl);
        let nv = c.u32() as usize;
        let cond_v = c.u32a(nv);
        let cont_mask = c.u8a(n);
        let (eu, ev) = (c.u32a(ne), c.u32a(ne));
        let st = FieldStruct { vol, run_mask, curve_of, gas_nodes, liq_nodes, cond_v, cont_mask };
        let f_seed = FieldState::seed(
            c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n),
            c.u8a(n), c.u8a(n), c.f64a(n), c.f64a(n), c.f64a(n), c.f64a(n),
        );
        let mut fs = f_seed;
        let ns = c.u32() as usize;
        for si in 0..ns {
            let pb_v = c.f64a(n);
            let pb_has = c.u8a(n);
            let hb_v = c.f64a(n);
            let hb_has = c.u8a(n);
            let mb_v = c.f64a(n);
            let mb_has = c.u8a(n);
            let w_arr = c.f64a(ne);
            let fallback_p = c.f64a(n);
            let fallback_h = c.f64a(n);
            let samp = FieldSample {
                pb_v: &pb_v,
                pb_has: &pb_has,
                hb_v: &hb_v,
                hb_has: &hb_has,
                mb_v: &mb_v,
                mb_has: &mb_has,
                w_arr: &w_arr,
                edge_u: &eu,
                edge_v: &ev,
                fallback_p: &fallback_p,
                fallback_h: &fallback_h,
                pool_lvl: &vec![None; 0],
            };
            // pool levels: f64 stream, NaN reads as undefined
            let pl_raw = c.f64a(st.cond_v.len());
            let pl: Vec<Option<f64>> = pl_raw.into_iter().map(|v| if v.is_nan() { None } else { Some(v) }).collect();
            let samp = FieldSample { pool_lvl: &pl, ..samp };
            // expected post-update F
            let exp_f = c.f64a(n);
            let exp_rho = c.f64a(n);
            let exp_x = c.f64a(n);
            let exp_b = c.f64a(n);
            let exp_rhod = c.f64a(n);
            let exp_rhog = c.f64a(n);
            let exp_rhol = c.f64a(n);
            let exp_wet = c.u8a(n);
            let exp_void = c.u8a(n);
            let exp_mu = c.f64a(n);
            let exp_lp = c.f64a(n);
            let exp_lh = c.f64a(n);
            let exp_lm = c.f64a(n);
            let mut s3 = [0.0; 3];
            field_update(&st, &curves, &mut fs, &samp, &mut s3);
            let mut bad_u8 = 0;
            for i in 0..n {
                if fs.wet[i] != exp_wet[i] || fs.void_[i] != exp_void[i] {
                    bad_u8 += 1;
                }
            }
            if bad_u8 > 0 {
                fails += 1;
                println!("sample {si}: {bad_u8} u8 mismatches");
            }
            let fl = [
                (&fs.p, &exp_f, "p"), (&fs.rho, &exp_rho, "rho"), (&fs.x, &exp_x, "x"),
                (&fs.b, &exp_b, "b"), (&fs.rho_d, &exp_rhod, "rhoD"),
                (&fs.rho_g, &exp_rhog, "rhoG"), (&fs.rho_l, &exp_rhol, "rhoL"),
                (&fs.mu, &exp_mu, "mu"), (&fs.lp, &exp_lp, "lp"),
                (&fs.lh, &exp_lh, "lh"), (&fs.lm, &exp_lm, "lm"),
            ];
            for (got, want, nm) in fl {
                for i in 0..n {
                    let (a, b) = (got[i], want[i]);
                    if a.to_bits() == b.to_bits() {
                        continue;
                    }
                    if a.is_nan() || b.is_nan() {
                        fails += 1;
                        println!("sample {si}: {nm}[{i}] NaN {a} vs {b}");
                        break;
                    }
                    let rel = (a - b).abs() / (a.abs() + b.abs() + 1e-30);
                    if rel > worst {
                        worst = rel;
                        worst_at = format!("sample {si}: {nm}[{i}] {a} vs {b}");
                    }
                    if rel > 1e-6 {
                        fails += 1;
                        println!("sample {si}: {nm}[{i}] {a:e} vs {b:e}");
                        break;
                    }
                }
            }
        }
    }
    println!("presets={np} worst-rel={worst:e} @ {worst_at} FAILURES={fails}");
}
