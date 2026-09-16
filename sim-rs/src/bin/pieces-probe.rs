//! Pieces/fixed-set replayer for the §6.2d gate (`node tools/pieces-gate.js`).
//! Replays net_pieces/core_pieces/ref_frame/fixed_fill/bounds_fill/
//! hold_live per sample and demands bit-exact agreement. Dev-only.
use sim_rs::pieces::*;

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
    fn i32a(&mut self, n: usize) -> Vec<i32> {
        (0..n)
            .map(|_| {
                let v = i32::from_le_bytes([self.b[self.o], self.b[self.o + 1], self.b[self.o + 2], self.b[self.o + 3]]);
                self.o += 4;
                v
            })
            .collect()
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
    fn pins(&mut self) -> Vec<(u32, f64)> {
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

fn bits(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits()
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0 };
    let np = c.u32() as usize;
    let mut fails = 0;
    for _ in 0..np {
        let (n, ne) = (c.u32() as usize, c.u32() as usize);
        assert_eq!(c.u32(), 2, "format v2");
        let (eu, ev) = (c.u32a(ne), c.u32a(ne));
        let ncl = c.u32() as usize;
        let core_nodes = c.u32a(ncl);
        let core_node = c.u32();
        let ns = c.u32() as usize;
        for si in 0..ns {
            // live[] drives the replay through a 1/0 proxy: the `!(g>0)`
            // mapping itself is unit-tested (NaN/-0 edges included).
            let live_in = c.u8a(ne);
            let g: Vec<f64> = live_in.iter().map(|&l| if l != 0 { 1.0 } else { 0.0 }).collect();
            let exp_of = c.i32a(n);
            let exp_n = c.u32() as usize;
            let (of, npc, live) = net_pieces(n, &eu, &ev, &g);
            if of != exp_of || npc != exp_n || live != live_in {
                fails += 1;
                println!("sample {si}: PIECES mismatch (n {npc} vs {exp_n})");
            }
            let ncs = c.u32() as usize;
            let exp_cset = c.i32a(ncs);
            let cset = core_pieces(&of, &core_nodes, core_node);
            if cset != exp_cset {
                fails += 1;
                println!("sample {si}: CORESET mismatch");
            }
            // ref frame
            let sp = c.f64a(1)[0];
            let p0js = c.f64a(1)[0];
            let level = if sp.is_nan() { p0js } else { sp };
            let exp_anchor = c.i32a(exp_n);
            let exp_p0 = c.f64a(exp_n);
            let (p0, anchor) = ref_frame(exp_n, level);
            if anchor != exp_anchor || p0 != exp_p0 {
                fails += 1;
                println!("sample {si}: REF mismatch");
            }
            // fixV is never cleared: the replay seeds from the pre-call holder.
            let pre_v = c.f64a(n);
            // fixed fill
            let cont = c.pins();
            let held = c.u32() != 0;
            let hold_pins = c.pins();
            let drum_pins = c.pins();
            let tank_pins = c.pins();
            let sec_pins = c.pins();
            let cond_pins = c.pins();
            let exp_fv = c.f64a(n);
            let exp_fh = c.u8a(n);
            let (fv, fh) = fixed_fill(
                n, &pre_v, &anchor, &p0, &cont, held, &hold_pins, &drum_pins, &tank_pins,
                &sec_pins, &cond_pins,
            );
            let fv_ok = fv.iter().zip(exp_fv.iter()).all(|(a, b)| bits(*a, *b));
            if !fv_ok || fh != exp_fh {
                fails += 1;
                println!("sample {si}: FIXED mismatch");
            }
            // bounds
            let nst = c.u32() as usize;
            let storing = c.u32a(nst);
            let exp_bv = c.f64a(n);
            let exp_bh = c.u8a(n);
            let mut bv = fv.clone();
            let mut bh = fh.clone();
            bounds_fill(&mut bv, &mut bh, &storing);
            let bv_ok = bv.iter().zip(exp_bv.iter()).all(|(a, b)| bits(*a, *b));
            if !bv_ok || bh != exp_bh {
                fails += 1;
                println!("sample {si}: BOUNDS mismatch");
            }
            // holdLive cases
            let nh = c.u32() as usize;
            // adjacency from replayed live set, like pc.adj
            let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
            for e in 0..ne {
                if live[e] == 0 {
                    continue;
                }
                adj[eu[e] as usize].push(ev[e]);
                adj[ev[e] as usize].push(eu[e]);
            }
            for _ in 0..nh {
                let seed = c.u32();
                let exp = c.u32() != 0;
                let got = hold_live(n, &adj, &live, &eu, &ev, seed, &bh);
                if got != exp {
                    fails += 1;
                    println!("sample {si}: HOLDLIVE seed {seed} {got} vs {exp}");
                }
            }
        }
    }
    println!("presets={np} FAILURES={fails}");
}
