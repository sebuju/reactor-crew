"use strict";
// chunks: plant swing
const {check, watch, watchNote, transit, commissionPreset} = require("./lib.js");
const mode = process.argv[2];
const SRC = "watch(): a run ends still only when its drift, carried to the horizon, and its window's spread both fit the tolerance";

if(mode === "swing"){
  const T = 10, A = 0.8, tol = 1;
  let t = 0;
  const run = o => { t = 0; return watch(null, Object.assign({step:() => { t += 0.02; }, cap:30, horizon:30, window:T,
    sig:[{name:"x", read:() => A*Math.sin(2*Math.PI*t/T), ref:0, tol}]}, o)); };
  const w = run({}), f = run({spread:false});
  check("a sinusoid of swing " + 2*A + " against tolerance " + tol + " is never read as still", w.end === "still" ? 0 : 1, 1, 0, SRC,
    {abs:true, note:watchNote(w)});
  check("fault injected, the window spread ignored: the same sinusoid is read as still mid-swing", f.end === "still" ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:watchNote(f) + ", x " + (A*Math.sin(2*Math.PI*f.t/T)).toFixed(3)});
}

if(mode === "plant"){
  const G = commissionPreset(0), ST = G.ST, sc = ST.sc, h0 = sc[G.SC_HEAT], win = transit(G), tol = 0.05*h0;
  sc[G.SC_DICEOFF] = 1;
  const heat = [{name:"heat", read:() => sc[G.SC_HEAT], ref:h0, tol}];
  const base = () => ({cap:3*win, horizon:120, window:win, sig:heat, fail:() => sc[G.SC_SCRAMMED] ? "scram" : ""});
  const reset = () => { G.resetPlant(); sc[G.SC_DICEOFF] = 1; };
  const rest = watch(G, base());
  check("a plant at rest ends still before its cap", rest.end === "still" ? 1 : 0, 1, 0, SRC,
    {abs:true, note:watchNote(rest) + ", window " + win.toFixed(2) + " s, cap " + (3*win).toFixed(2) + " s"});

  reset();
  const at = Math.round(win/2/0.02);
  const scr = watch(G, Object.assign(base(), {each:k => { if(k === at) G.act("scram"); }}));
  check("a scram ordered at tick " + at + " ends the run as a fail at that tick", scr.end === "fail" && scr.k <= at + 1 ? 1 : 0, 1, 0, SRC,
    {abs:true, note:watchNote(scr) + ", tick " + scr.k});

  const ramp = o => { reset();
    for(const s of ["scram", "rodStep", "boronDem"]) G.uiBlkSinkOff(s);
    const c = 0, z0 = ST.csRodPos[c], rate = 0.001;
    const w = watch(G, Object.assign(base(), {each:(k, t) => G.act("rodCommon", z0 - rate*t)}, o));
    w.heat = sc[G.SC_HEAT]/h0; return w; };
  const r = ramp({}), rf = ramp({slope:false});
  check("rods driven out at 0.1 %/s are never read as still", r.end === "still" ? 0 : 1, 1, 0, SRC,
    {abs:true, note:watchNote(r) + ", heat " + r.heat.toFixed(4) + " of rated"});
  check("fault injected, the slope term ignored: the same ramp is read as still", rf.end === "still" ? 1 : 0, 1, 0,
    "the check above must be able to fail", {abs:true, note:watchNote(rf) + ", heat " + rf.heat.toFixed(4) + " of rated"});
}
