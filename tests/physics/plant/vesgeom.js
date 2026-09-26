"use strict";
/* plan-reactor-ui 6.1: the stock vessel off the drawing, against the published four-loop vessel */
const {check} = require("../lib.js");
module.exports = (G, pre) => {
  if(pre !== 0) return;
  const cd = G.coreD(G.IX.coreId[0]), M = G.latM(cd);
  const id = G.vesselDiaM(cd), h = G.vesselHgtM(cd);
  const ID_SRC = "vessel ID 4.39 m on a ~3.38 m core, assembled vessel+head 13.36 m on 3.66 m active fuel (MIT OCW 22.06, NRC HRTD 3.1)";
  check("stock PWR vessel ID over core diameter, against the published four-loop 4.39/3.38", id/M.dia, 4.39/3.38, 0.05, ID_SRC,
    {note:"ID " + id.toFixed(2) + " m on a " + M.dia.toFixed(2) + " m core (reflector " + cd.lat.reflR.toFixed(1) + " cm drawn)"});
  check("stock PWR vessel height over active height, against the published four-loop 13.36/3.66", h/M.hgt, 13.36/3.66, 0.08, ID_SRC,
    {note:"height " + h.toFixed(2) + " m on " + M.hgt.toFixed(2) + " m active (lower " + G.vesLowerM(cd).toFixed(2) + ", upper " + G.vesUpperM(cd).toFixed(2) + ")"});
};
