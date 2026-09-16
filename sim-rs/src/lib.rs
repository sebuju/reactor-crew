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

/// One `stepMarch(dt)`.
#[no_mangle]
pub extern "C" fn sim_step(_dt: f64) {
    todo!()
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
    todo!()
}
