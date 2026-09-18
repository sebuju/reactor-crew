"use strict";

/* Loader for the Rust sim (`sim-rs`, `sim_rs.wasm`). Classic script, one global.
   `live()` hands it the commissioned plant and `step()` then marches S through it: S and its sidecars
   go in before every tick and come back after, so everything that reads S is unchanged.
   `?engine=wasm-parity` runs the step parity probe (`parityBoot`) against native digests. */

var WasmEngine = (function(){
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

  async function instantiate(wasmBytes, sink){
    var mod = await WebAssembly.compile(wasmBytes);
    checkImports(mod);
    var inst = null;
    var env = {
      log_event: function(sev, code, a, b){ sink.logEvents.push({sev:sev, code:code, a:a, b:b}); },
      console_warn: function(ptr, len){
        var mem = new Uint8Array(inst.exports.memory.buffer);
        sink.warnings.push(new TextDecoder().decode(mem.subarray(ptr, ptr + len)));
      },
    };
    inst = await WebAssembly.instantiate(mod, {env: env});
    return inst.exports;
  }

  /* bytes go through the engine's own buffer (`sim_in`), so they can never overlap its heap; the view is
     taken after the call because the call may grow memory */
  function put(ex, bytes){
    var at = ex.sim_in(bytes.length);
    new Uint8Array(ex.memory.buffer).set(bytes, at);
    return at;
  }

  // opts: {wasmURL, dumpURL, freezeURL, steps, dt}. Returns {consumed,
  // frozen, digest, ticks, warnings, logEvents}: `digest` is S0's, `ticks`
  // one digest per step.
  async function load(opts){
    var wasmBytes = await fetchBytes(opts.wasmURL);
    var dump = await fetchBytes(opts.dumpURL);
    var frz = await fetchBytes(opts.freezeURL);
    var sink = {warnings: [], logEvents: []};
    var ex = await instantiate(wasmBytes, sink);
    var consumed = ex.sim_ingest(put(ex, dump), dump.length);
    if(!consumed) throw new Error("wasm engine: sim_ingest rejected the dump (want np==1, a known format)");
    var digest = u64hex(ex.sim_digest());
    var frozen = ex.sim_freeze(put(ex, frz), frz.length);
    if(!frozen) throw new Error("wasm engine: sim_freeze rejected the tables (magic/version)");
    var ticks = [];
    for(var t = 0; t < opts.steps; t++){
      ex.sim_step(opts.dt);
      ticks.push(u64hex(ex.sim_digest()));
    }
    return {consumed: consumed, frozen: frozen, digest: digest, ticks: ticks,
            warnings: sink.warnings, logEvents: sink.logEvents};
  }

  // `?engine=wasm-parity` probe: step the served preset-0 dump in-browser and
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

  var eng = null;
  var TIME = {restore: 0, step: 0, snapshot: 0, apply: 0};
  var now = function(){ return typeof performance !== "undefined" ? performance.now() : Date.now(); };

  /* the plant as it stands: metas and state in, commission tables frozen */
  function ingest(){
    var ex = eng.ex;
    var w = FREEZE.writer();
    eng.meta = SIMSTATE.ingest(w);
    var b = w.bytes();
    if(!ex.sim_ingest(put(ex, b), b.length)) throw new Error("wasm engine: sim_ingest refused the plant");
    var f = FREEZE.build();
    if(!ex.sim_freeze(put(ex, f), f.length)) throw new Error("wasm engine: sim_freeze refused the tables");
    eng.net = P.net;
  }

  async function live(wasmBytes){
    var sink = {warnings: [], logEvents: []};
    eng = {ex: await instantiate(wasmBytes, sink), sink: sink, meta: null, net: null};
    try { ingest(); } catch(e){ eng = null; throw e; }
  }

  /* one tick: S (whatever act() did to it) in, the engine's tick, the result back into S and its sidecars */
  function step(dt){
    var ex = eng.ex;
    if(P.net !== eng.net) throw new Error("wasm engine: the plant was recommissioned under a live engine");
    S.t += dt;
    var t0 = now();
    var w = FREEZE.writer();
    SIMSTATE.state(w, eng.meta);
    var b = w.bytes();
    if(ex.sim_restore(put(ex, b), b.length) !== b.length) throw new Error("wasm engine: sim_restore refused the state");
    var t1 = now();
    ex.sim_step(dt);
    var t2 = now();
    var n = ex.sim_snapshot(), at = ex.sim_snapshot_ptr();
    var out = new Uint8Array(ex.memory.buffer, at, n).slice();
    var t3 = now();
    SIMSTATE.apply(out);
    var t4 = now();
    TIME.restore += t1 - t0; TIME.step += t2 - t1; TIME.snapshot += t3 - t2; TIME.apply += t4 - t3;
  }

  return {load: load, u64hex: u64hex, parityBoot: parityBoot, fetchBytes: fetchBytes,
          live: live, step: step, isLive: function(){ return eng !== null; },
          stop: function(){ eng = null; }, TIME: TIME,
          ASSETS: "tests/out/wasm-parity/", PKG: "sim-rs/pkg/sim_rs.wasm"};
})();
