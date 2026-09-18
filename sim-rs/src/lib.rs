//! Hot sim tick in Rust: one source, `.wasm` for the WebPlayer and a
//! staticlib for future Unity (`plan-rust-wasm-sim.md`).
//!
//! Tick policy (enforced, not conventional): no allocation, no per-tick
//! import, `libm` only for transcendentals. State layout mirrors the JS
//! heaps 1:1 — see `docs/abi-rust-wasm-sim.md`.

pub mod ctl;
pub mod edge;
pub mod events;
pub mod fdlibm;
pub mod engine;
pub mod freeze;
pub mod frozen;
pub mod ingest;
pub mod live;
pub mod netlive;
pub mod solvelive;
pub mod room;
pub mod sec;
pub mod step;
pub mod tick;
pub mod eos;
pub mod field;
pub mod hydro;
pub mod net;
pub mod pieces;
pub mod read;
pub mod store;
pub mod core;
pub mod transport;

// Cold-path JS imports. Exactly these two — CI diffs the WASM import
// section against this allow-list (`tools/wasm-imports.js`).
#[allow(dead_code)]
extern "C" {
    fn log_event(sev: u32, code: u32, a: f64, b: f64);
    fn console_warn(ptr: u32, len: u32);
}

/// Commission snapshot already ingested; sizes the `static mut` pools.
#[no_mangle]
pub extern "C" fn sim_init() {
    todo!()
}

// Live engine state. Set once by `sim_ingest`, stepped by `sim_step`.
static mut META: Option<step::StepMeta> = None;
static mut ST: Option<step::StepState> = None;
// Commission-frozen tables plus the carried live state, both owned by the
// engine; the tick reads the frozen half and never writes it.
static mut ENG: Option<engine::Engine> = None;

/// Ingest one commissioned preset from a gate-format dump at
/// `[ptr, ptr+len)`. Parses the header + first preset S0 only; returns
/// bytes consumed (the S0 boundary), 0 on format mismatch.
#[no_mangle]
pub extern "C" fn sim_ingest(ptr: usize, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
    let mut c = ingest::Cur { b: bytes, o: 0, trace: false };
    if c.u32() as usize != 1 {
        return 0;
    }
    let ver = c.u32();
    if ver != 1 && ver != 2 {
        return 0;
    }
    let p = ingest::read_preset(&mut c, 0, ver);
    unsafe {
        META = Some(p.meta);
        ST = Some(p.st);
    }
    c.o as u32
}

/// Load commission-frozen tables: the native door `sim_freeze` walks through.
pub fn ingest_frozen(
    edge: solvelive::EdgeFrozen,
    tail: frozen::TailFrozen,
    ctl_fr: live::CtlFrozen,
    ctl_meta: step::CtlMeta,
    ctl_live: live::CtlLive,
) {
    unsafe {
        let meta = META.as_ref().expect("sim_freeze before sim_ingest");
        let st = ST.as_ref().expect("sim_freeze before sim_ingest");
        ENG = Some(engine::Engine::new(meta, st, edge, tail, ctl_fr, ctl_meta, ctl_live));
    }
}

/// Load the commission-frozen tables (`FREEZE.build()`) from
/// `[ptr, ptr+len)`. Runs after `sim_ingest`; returns bytes consumed, 0 on
/// a bad magic or version.
#[no_mangle]
pub extern "C" fn sim_freeze(ptr: usize, len: usize) -> u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
    let mut c = ingest::Cur { b: bytes, o: 0, trace: false };
    let Some(f) = freeze::read_freeze(&mut c) else { return 0 };
    let (ctl_fr, ctl_live) = f.ctl();
    ingest_frozen(f.edge, f.tail, ctl_fr, f.ctl_meta, ctl_live);
    c.o as u32
}

/// One `stepMarch(dt)`, live: the engine fills every tail off state and
/// the march is the same one the replay walks.
#[no_mangle]
pub extern "C" fn sim_step(dt: f64) {
    unsafe {
        let meta = META.as_ref().expect("sim_step before sim_ingest");
        let st = ST.as_mut().expect("sim_step before sim_ingest");
        let eng = ENG.as_mut().expect("sim_step before sim_freeze");
        eng.step(meta, st, dt);
    }
}

/// Copy state+sidecar segments out to a JS-provided pointer.
#[no_mangle]
pub extern "C" fn sim_snapshot(_dst_ptr: u32) {
    todo!()
}

/// Load state+sidecar segments from a JS-provided pointer.
#[no_mangle]
pub extern "C" fn sim_restore(_src_ptr: u32) {
    todo!()
}

/// FNV over the S-leaf set, same coverage as `tools/sdig.js`.
#[no_mangle]
pub extern "C" fn sim_digest() -> u64 {
    unsafe { step::sim_digest(ST.as_ref().expect("sim_digest before sim_ingest")) }
}
