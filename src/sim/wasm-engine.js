"use strict";

/* Loader for the Rust sim (`sim-rs`, `sim_rs.wasm`). Classic script, one
   global. Staged: ingest + digest are live; stepping waits on `sim_freeze`
   and the tail readers, so `step()` throws until the engine is whole.
   `?engine=wasm` runs the ingest-digest parity probe (`wasmParityBoot`). */

var WasmEngine = (function(){
  // ingest allocates maps/vecs for the whole S0; the input dump sits HIGH
  // so it never overlaps static data or the allocator's heap (which grow up
  // from `__heap_base`). Found the hard way: a dump at [0,len) eats dlmalloc
  // metadata and `sim_ingest` traps in `read_sec_meta`.
  var HEAP_RESERVE = 64 * 1024 * 1024;
  var PAGE = 65536;

  function u64hex(v){
    var b = typeof v === "bigint" ? v : BigInt(v);
    if(b < 0n) b += 1n << 64n;
    return b.toString(16).padStart(16, "0");
  }

  function checkImports(mod){
    // subset, not equality: release GCs imports no live path calls (today:
    // ingest+digest call neither), so an empty list is conforming.
    var want = ["env.console_warn", "env.log_event"];
    var bad = WebAssembly.Module.imports(mod).map(function(i){ return i.module + "." + i.name; })
      .filter(function(g){ return want.indexOf(g) < 0; });
    if(bad.length) throw new Error("wasm engine: foreign imports " + bad.join(","));
  }

  async function fetchBytes(url){
    var r = await fetch(url, {cache: "no-store"});
    if(!r.ok) throw new Error("wasm engine: GET " + url + " -> " + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  // opts: {wasmURL, dumpURL}. Returns {consumed, digest, warnings, logEvents, step}.
  async function load(opts){
    var wasmBytes = await fetchBytes(opts.wasmURL);
    var dump = await fetchBytes(opts.dumpURL);
    var mod = await WebAssembly.compile(wasmBytes);
    checkImports(mod);
    var warnings = [], logEvents = [], inst = null;
    var env = {
      log_event: function(sev, code, a, b){ logEvents.push({sev:sev, code:code, a:a, b:b}); },
      console_warn: function(ptr, len){
        var mem = new Uint8Array(inst.exports.memory.buffer);
        warnings.push(new TextDecoder().decode(mem.subarray(ptr, ptr + len)));
      },
    };
    inst = await WebAssembly.instantiate(mod, {env: env});
    var ex = inst.exports, mem = ex.memory;
    var need = HEAP_RESERVE + dump.length;
    if(mem.buffer.byteLength < need)
      mem.grow(Math.ceil((need - mem.buffer.byteLength) / PAGE));
    var at = mem.buffer.byteLength - dump.length;
    new Uint8Array(mem.buffer).set(dump, at);
    var consumed = ex.sim_ingest(at, dump.length);
    if(!consumed) throw new Error("wasm engine: sim_ingest rejected the dump (want np==1 ver<=2)");
    return {
      consumed: consumed,
      digest: u64hex(ex.sim_digest()),
      warnings: warnings,
      logEvents: logEvents,
      step: function(dt){
        try{ ex.sim_step(dt); }
        catch(e){ throw new Error("wasm engine: sim_step not yet runnable (" + e.message + ")", {cause: e}); }
      },
    };
  }

  // `?engine=wasm` probe: ingest the served preset-0 dump in-browser and
  // compare against the native digest in expected.json. Reports via
  // `window.__wasmParity` and the document title; never touches the JS sim.
  async function parityBoot(base){
    var rep = {ok: false, stage: "start"};
    window.__wasmParity = rep;
    try{
      var exp = await (await fetch(base + "expected.json", {cache: "no-store"})).json();
      rep.stage = "loaded";
      var h = await load({wasmURL: base + exp.wasm, dumpURL: base + exp.dump});
      rep.consumed = h.consumed;
      rep.digest = h.digest;
      rep.expected = exp.digest;
      rep.warnings = h.warnings;
      rep.ok = h.consumed === exp.consumed && h.digest === exp.digest;
      rep.stage = rep.ok ? "match" : "mismatch";
    }catch(e){ rep.stage = "error"; rep.error = String(e && e.message || e); }
    document.title = rep.ok ? "WASM-DIGEST-MATCH " + rep.digest
                            : "WASM-DIGEST-" + rep.stage.toUpperCase();
    return rep;
  }

  return {load: load, u64hex: u64hex, parityBoot: parityBoot,
          ASSETS: "tests/out/wasm-parity/"};
})();
