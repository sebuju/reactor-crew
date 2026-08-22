"use strict";
/* canvas handle, palette, shared constants */

/* ═══════════════════════════════════════════════════════════════════
   reactor-crew — design bench, plant mimic, gauges, annunciators, ledger,
   controls and reference, all rendered into one 2D canvas.
   ═══════════════════════════════════════════════════════════════════ */
const W = 760;
const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
const scroller = document.getElementById("scroller");
const MONO = `ui-monospace,"SF Mono","Roboto Mono","DejaVu Sans Mono",Menlo,monospace`;

const C = {
  bg:"#080c0e", panel:"#0e1518", panelHi:"#142126", well:"#060a0b",
  edge:"#1d2f35", edge2:"#2c464e", rail:"#33525b",
  ink:"#9fb4b9", ink2:"#5d7378", bright:"#dff0f3",
  amber:"#f0a830", cyan:"#5fd2e2", red:"#ff5a45", green:"#57d38c",
  blue:"#5aa9d6", metal:"#6d8f98"
};
