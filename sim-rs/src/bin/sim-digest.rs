//! Digest oracle for the WASM engine path: ingests the first preset S0 of a
//! step-gate dump and prints `sim_digest` + bytes consumed. With
//! `--freeze <freeze.bin> --steps N` it steps through the exported ABI
//! (`sim_ingest`/`sim_freeze`/`sim_step`/`sim_digest`) and prints one digest
//! per tick: the list the browser is judged against.
use sim_rs::{sim_digest, sim_freeze, sim_ingest, sim_step};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arg = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
    let dump = std::fs::read(&a[1]).unwrap();
    let consumed = sim_ingest(dump.as_ptr() as usize, dump.len());
    assert!(consumed != 0, "oracle takes single-preset dumps (use --preset 0)");
    println!("consumed={} digest={:016x}", consumed, sim_digest());
    let Some(fpath) = arg("--freeze") else { return };
    let fz = std::fs::read(fpath).unwrap();
    let used = sim_freeze(fz.as_ptr() as usize, fz.len());
    assert!(used != 0, "freeze.bin: bad magic/version");
    println!("frozen={used}");
    let steps: usize = arg("--steps").map(|s| s.parse().unwrap()).unwrap_or(0);
    for t in 0..steps {
        sim_step(0.02);
        println!("tick={t} digest={:016x}", sim_digest());
    }
}
