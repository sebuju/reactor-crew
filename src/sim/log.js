"use strict";
/* event log */

/* ═══════════════ EVENT LOG ═══════════════ */
let LOG=[];
function logE(sev,msg,why){ LOG.push({t:S?S.t:0,sev,msg,why}); if(LOG.length>240) LOG.shift(); }
