//! Digest oracle for the WASM engine path: ingests the first preset S0 of a
//! step-gate dump and prints `sim_digest` + bytes consumed. Node compares
//! this against the wasm `sim_ingest`/`sim_digest` exports bit-for-bit.
use sim_rs::ingest::*;
use sim_rs::step::*;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let mut c = Cur { b: &bytes, o: 0, trace: false };
    let np = c.u32() as usize;
    assert_eq!(np, 1, "oracle takes single-preset dumps (use --preset 0)");
    let ver = c.u32();
    assert!(ver == 1 || ver == 2, "format v1|v2");
    let p = read_preset(&mut c, 0, ver);
    println!("consumed={} digest={:016x}", c.o, sim_digest(&p.st));
}
