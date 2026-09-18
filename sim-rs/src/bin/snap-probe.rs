//! `sim_snapshot`/`sim_restore` checks, native. Per preset:
//!   1. the S0 state half read and written back is byte-identical;
//!   2. N ticks straight vs a snapshot at tick K restored into the same
//!      engine, then N-K more: every tick's `sim_digest` equal;
//!   3. the same restore into a fresh engine (nothing hidden in it).
//! Usage: snap-probe <dump.bin> <freeze.bin> [--ticks N] [--at K]
#[path = "shared/probe_common.rs"]
mod common;
use common::read_freezes;
use sim_rs::engine::Engine;
use sim_rs::ingest::*;
use sim_rs::snap::{write_state, Wr};
use sim_rs::step::*;

fn arg(a: &[String], k: &str, d: usize) -> usize {
    a.iter().position(|x| x == k).and_then(|i| a.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(d)
}

fn engine(meta: &StepMeta, st: &StepState, carry: &Carry, f: sim_rs::freeze::FreezeIn) -> Engine {
    let (fr, lv) = f.ctl();
    Engine::new(meta, st, carry, f.edge, f.tail, fr, f.ctl_meta, lv)
}

fn snapshot(meta: &StepMeta, st: &StepState, eng: &Engine) -> Vec<u8> {
    let mut w = Wr::default();
    write_state(&mut w, meta, st, &eng.carry());
    w.b
}

fn restore(meta: &StepMeta, b: &[u8]) -> (StepState, Carry) {
    let mut c = Cur { b, o: 0, trace: false };
    let r = read_state(meta, &mut c, FORMAT);
    assert_eq!(c.o, b.len(), "restore consumed {} of {}", c.o, b.len());
    r
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let (n, k) = (arg(&a, "--ticks", 30), arg(&a, "--at", 15));
    let mut fa = read_freezes(&a[2]).into_iter();
    let mut fb = read_freezes(&a[2]).into_iter();
    let mut fc = read_freezes(&a[2]).into_iter();
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    let ver = c.u32();
    assert!(ver == FORMAT, "dump format {ver}, want {FORMAT}");
    let mut fails = 0u32;
    for pi in 0..np {
        let meta = read_metas(&mut c);
        let o1 = c.o;
        let (st0, carry0) = read_state(&meta, &mut c, ver);
        let s0 = &bytes[o1..c.o];
        let nt = c.u32() as usize;
        for ti in 0..nt {
            read_tick(&mut c, &meta, meta.core_ids.len(), pi, ti);
        }
        let (f_a, f_b, f_c) = (fa.next().unwrap(), fb.next().unwrap(), fc.next().unwrap());

        let eng0 = engine(&meta, &st0, &carry0, f_a);
        let rt = snapshot(&meta, &st0, &eng0);
        match rt.iter().zip(s0.iter()).position(|(x, y)| x != y) {
            None if rt.len() == s0.len() => println!("p{pi} roundtrip ok ({} bytes)", rt.len()),
            at => {
                fails += 1;
                println!("p{pi} roundtrip FAIL len {} vs {} first diff at {:?}", rt.len(), s0.len(), at);
            }
        }

        let (mut st_a, _) = restore(&meta, s0);
        let mut eng_a = eng0;
        let mut want = Vec::with_capacity(n);
        for _ in 0..n {
            eng_a.step(&meta, &mut st_a, 0.02);
            want.push(step_digest(&st_a));
        }

        let (mut st_b, carry_b) = restore(&meta, s0);
        let mut eng_b = engine(&meta, &st_b, &carry_b, f_b);
        let mut got_same = Vec::with_capacity(n);
        for _ in 0..k {
            eng_b.step(&meta, &mut st_b, 0.02);
            got_same.push(step_digest(&st_b));
        }
        let snap_k = snapshot(&meta, &st_b, &eng_b);
        let (st_r, carry_r) = restore(&meta, &snap_k);
        eng_b.load(&meta, &st_r, &carry_r);
        let mut st_same = st_r;
        let (st_f, carry_f) = restore(&meta, &snap_k);
        let mut eng_f = engine(&meta, &st_f, &carry_f, f_c);
        let mut st_fresh = st_f;
        let mut got_fresh = got_same.clone();
        for _ in k..n {
            eng_b.step(&meta, &mut st_same, 0.02);
            got_same.push(step_digest(&st_same));
            eng_f.step(&meta, &mut st_fresh, 0.02);
            got_fresh.push(step_digest(&st_fresh));
        }
        for (name, got) in [("same-engine", &got_same), ("fresh-engine", &got_fresh)] {
            match got.iter().zip(want.iter()).position(|(x, y)| x != y) {
                None => println!("p{pi} {name} restore at {k}: {n} ticks ok"),
                Some(t) => {
                    fails += 1;
                    println!("p{pi} {name} restore at {k}: FAIL first at tick {}", t + 1);
                }
            }
        }
    }
    println!("snap-probe FAILURES={fails}");
}

fn step_digest(st: &StepState) -> u64 {
    sim_rs::step::sim_digest(st)
}
