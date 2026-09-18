"use strict";

/* Loader for the Rust sim (`sim-rs`, `sim_rs.wasm`). Classic script, one
   global. `?engine=wasm` runs the step parity probe (`parityBoot`): ingest a
   preset, freeze its tables, step it, and match the native digest per tick. */

var WasmEngine = (function(){
  // ingest allocates maps/vecs for the whole S0; the inputs sit HIGH so
  // they never overlap static data or the allocator's heap (which grow up
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
    // none), so an empty list is conforming.
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

  // opts: {wasmURL, dumpURL, freezeURL, steps, dt}. Returns {consumed,
  // frozen, digest, ticks, warnings, logEvents}: `digest` is S0's, `ticks`
  // one digest per step.
  async function load(opts){
    var wasmBytes = await fetchBytes(opts.wasmURL);
    var dump = await fetchBytes(opts.dumpURL);
    var frz = await fetchBytes(opts.freezeURL);
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
    var need = HEAP_RESERVE + dump.length + frz.length;
    if(mem.buffer.byteLength < need)
      mem.grow(Math.ceil((need - mem.buffer.byteLength) / PAGE));
    var atDump = mem.buffer.byteLength - dump.length;
    var atFrz = atDump - frz.length;
    new Uint8Array(mem.buffer).set(dump, atDump);
    new Uint8Array(mem.buffer).set(frz, atFrz);
    var consumed = ex.sim_ingest(atDump, dump.length);
    if(!consumed) throw new Error("wasm engine: sim_ingest rejected the dump (want np==1 ver<=2)");
    var digest = u64hex(ex.sim_digest());
    var frozen = ex.sim_freeze(atFrz, frz.length);
    if(!frozen) throw new Error("wasm engine: sim_freeze rejected the tables (magic/version)");
    var ticks = [];
    for(var t = 0; t < opts.steps; t++){
      ex.sim_step(opts.dt);
      ticks.push(u64hex(ex.sim_digest()));
    }
    return {consumed: consumed, frozen: frozen, digest: digest, ticks: ticks,
            warnings: warnings, logEvents: logEvents};
  }

  // `?engine=wasm` probe: step the served preset-0 dump in-browser and
  // compare every digest against expected.json. Reports via
  // `window.__wasmParity` and the document title; never touches the JS sim.
  async function parityBoot(base){
    var rep = {ok: false, stage: "start"};
    window.__wasmParity = rep;
    try{
      var exp = await (await fetch(base + "expected.json", {cache: "no-store"})).json();
      rep.stage = "loaded";
      var h = await load({wasmURL: base + exp.wasm, dumpURL: base + exp.dump,
                          freezeURL: base + exp.freeze, steps: exp.ticks.length, dt: exp.dt});
      rep.consumed = h.consumed;
      rep.frozen = h.frozen;
      rep.digest = h.digest;
      rep.expected = exp.digest;
      rep.ticks = h.ticks;
      rep.firstBad = h.ticks.findIndex(function(d, i){ return d !== exp.ticks[i]; });
      rep.warnings = h.warnings;
      rep.ok = h.consumed === exp.consumed && h.frozen === exp.frozen &&
               h.digest === exp.digest && rep.firstBad < 0;
      rep.stage = rep.ok ? "match" : "mismatch";
    }catch(e){ rep.stage = "error"; rep.error = String(e && e.message || e); }
    document.title = rep.ok ? "WASM-STEP-MATCH " + rep.ticks[rep.ticks.length - 1]
                            : "WASM-STEP-" + rep.stage.toUpperCase();
    return rep;
  }

  return {load: load, u64hex: u64hex, parityBoot: parityBoot,
          ASSETS: "tests/out/wasm-parity/"};
})();
