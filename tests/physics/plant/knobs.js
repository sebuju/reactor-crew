"use strict";
/* batch M bought knobs against published figures, never against a number the simulation printed before */
const {check, watch} = require("../lib.js");
module.exports = (G, pre) => {
  const PT = G.PT, ST = G.ST;
  if(pre === 2)
    check("BWR bypass at 0.25 of rated steam", G.condDumpSuggest()/G.turbKgsSuggest(), 0.25, 1e-9,
      "GE BWR/4 design description: turbine bypass passes about 25 % of rated steam flow", {});
  if(pre !== 0) return;

  let t = -1;
  for(let k=0;k<PT.n.tank;k++) if(PT.tankHold[k]){ t = k; break; }
  check("pressurizer heaters at 35.3 kW/m3", PT.tankHoldKW[t]/G.tankVolOf(G.IX.tankId[t]), 35.3, 0.05,
    "NRC PWR Systems training manual, reactor coolant system: 1800 kW of immersion heaters in an 1800 ft3 (51.0 m3) pressurizer", {unit:"kW/m3"});

  check("PWR bypass at 0.40 of rated steam", G.condDumpSuggest()/G.turbKgsSuggest(), 0.40, 1e-9,
    "Westinghouse PWR condenser steam dump, ~40 % of rated steam, sized to ride out a full load rejection without a trip", {});

  check("rod drive strokes end to end in 190 s", 1/G.rodSpdOf(G.priD()), 190, 10,
    "Westinghouse CRDM: at most 72 steps/min over a 228-step stroke, 228/72 min", {abs:true, unit:"s"});
  { const c = G.priD(), at = c.nbank*G.ROD_BANK_T*(G.rodSpdOf(c)/G.ROD_SPD0 - 1);
    const fast = Object.assign({}, c, {rodSpd:G.ROD_SPD0*2});
    const above = c.nbank*G.ROD_BANK_T*(G.rodSpdOf(fast)/G.ROD_SPD0 - 1);
    check("rod drive mass prices nothing at the reference and buys above it", above > 0 && at === 0, true, 0,
      "identity: the mass term is 0 t at the reference and positive above it", {abs:true}); }

  /* water induction is the turbine being fed WATER: saturated liquid at its own inlet pressure, a shade
     subcooled so x is 0. Held at 100 kJ/kg it was 24 C water at 6.8 MPa instead - a 96 % enthalpy sink on
     the plant, which bursts the steam lines and floods a cell rather than testing the blading law. */
  const b = 0, a = PT.turbPart[b], S = G.E_TURB_WET_S, wrecked = () => ST.dmgBy[a] !== 0 ? "turbine wrecked" : "";
  const feed = () => { const e = PT.turbEdge[b], w = ST.edW[e], i = w >= 0 ? PT.edU[e] : PT.edV[e];
    if(i >= 0) ST.hBy[i] = G.satH(G.eNodeSat(i), G.eNodeP(i))*0.995; };
  ST.sc[G.SC_DICEOFF] = 1; feed();
  watch(G, {cap:S + 1, each:feed, event:wrecked});
  check("a turbine fed liquid is wrecked inside E_TURB_WET_S + 1 s", ST.dmgBy[a] !== 0, true, 0,
    "ASME TDP-1 on water induction; EPRI water induction event reports: liquid wrecks the blading in seconds", {abs:true});
  check("the wreck is booked as water", ST.dmgWhy[a], G.E_WHY_WATER, 0,
    "the water reason rides E_TXT_WHY", {abs:true});
  let logged = false, text = "";
  for(let k=0;k<G.EV_N;k++) if(ST.evCode[k] === G.EV_TURB_WATER){ logged = true; text = G.eEventText(k)[1]; break; }
  check("the wreck logs TURB_WATER naming the machine", logged && text.length > 0, true, 0,
    "the event line is built at drain time, never in the tick", {abs:true});

  G.resetPlant(); G.eNetInvalidate(); ST.sc[G.SC_DICEOFF] = 1;
  watch(G, {cap:S + 1, fail:wrecked});
  check("the same turbine passing dry steam over the same march is NOT wrecked", ST.dmgBy[PT.turbPart[0]] === 0, true, 0,
    "dry steam is the machine's rated duty: nothing in it breaks blading", {abs:true});
};
