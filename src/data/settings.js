"use strict";
/* No top-level side effects: this file loads in the sim worker too, where fetch/document/localStorage may not exist. */

const SETTINGS = {tempUnit:"K"};

/* TEMP_CH converts number and label; DELTA_CH keeps the number (a degree is a degree) and follows the label */
const TEMP_CH = {tf:1, tavg:1, th:1, tc:1, radt:1, tprog:1};
/* a degree is a degree: deltas read the same number in either unit, only the label follows */
const DELTA_CH = {sub:1, scc:1, dtavg:1};
const tempIsC = () => SETTINGS.tempUnit === "C";
const tempUnitLabel = () => tempIsC() ? "°C" : "K";
const deltaUnitLabel = () => tempIsC() ? "°C" : "K";
const rateUnitLabel = () => tempIsC() ? "°C/s" : "K/s";
const tempC = k => tempIsC() ? k - 273.15 : k;
function fmtT(k, dp){
  dp = dp == null ? 0 : dp;
  if(typeof k !== "number" || !isFinite(k)) return "--";
  return (tempIsC() ? k - 273.15 : k).toFixed(dp) + " " + tempUnitLabel();
}
function fmtD(d, dp){
  dp = dp == null ? 1 : dp;
  if(typeof d !== "number" || !isFinite(d)) return "--";
  return d.toFixed(dp) + " " + deltaUnitLabel();
}
function fmtDR(d, dp){
  dp = dp == null ? 2 : dp;
  if(typeof d !== "number" || !isFinite(d)) return "--";
  return d.toFixed(dp) + " " + rateUnitLabel();
}

const settingsValid = o => !!o && (o.tempUnit === "K" || o.tempUnit === "C");
function settingsApply(o){
  if(settingsValid(o)) SETTINGS.tempUnit = o.tempUnit;
  return SETTINGS.tempUnit;
}
function settingsURL(){
  const b = (typeof STORE !== "undefined" && STORE.base) || "api/";
  return b + "settings";
}
function settingsReadLocal(){
  try{
    if(typeof localStorage === "undefined") return null;
    const o = JSON.parse(localStorage.getItem("reactor-crew.settings"));
    return settingsValid(o) ? o : null;
  }catch(e){ return null; }
}
function settingsWriteLocal(){
  try{
    if(typeof localStorage !== "undefined")
      localStorage.setItem("reactor-crew.settings", JSON.stringify(SETTINGS));
  }catch(e){}
}
/* server file first, browser cache as fallback; resolves, never rejects */
async function settingsLoad(){
  let srv = null;
  if(typeof fetch === "function"){
    try{
      const r = await fetch(settingsURL(), {cache:"no-store"});
      if(r.ok){ const j = await r.json(); if(settingsValid(j)) srv = j; }
    }catch(e){ srv = null; }
  }
  settingsApply(srv || settingsReadLocal() || {tempUnit:"K"});
  if(srv) settingsWriteLocal();
  if(typeof uiDirty === "function") uiDirty();
  return SETTINGS.tempUnit;
}
async function settingsSave(){
  settingsWriteLocal();
  if(typeof fetch !== "function") return false;
  try{
    const r = await fetch(settingsURL(), {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(SETTINGS),
    });
    if(!r.ok) return false;
    const j = await r.json();
    return !!(j && j.ok);
  }catch(e){ return false; }
}
function settingsSetUnit(u){
  if(u !== "K" && u !== "C") return SETTINGS.tempUnit;
  if(SETTINGS.tempUnit === u) return u;
  SETTINGS.tempUnit = u;
  settingsSave();
  if(typeof refreshSettingsModal === "function") refreshSettingsModal();
  if(typeof uiDirty === "function") uiDirty();
  return u;
}
/* trend-chart doors: values and ranges convert, deltas never reach here */
function sigU(k){
  const b = String(k).split(":")[0];
  if(TEMP_CH[b]) return tempUnitLabel();
  if(b === "dtavg") return rateUnitLabel();
  if(DELTA_CH[b]) return deltaUnitLabel();
  try{ const r = CH[k] || CHB[k]; if(r && r.u) return r.u; }catch(e){}
  return "";
}
function sigAt(k, i){
  const v = chAt(k, i);
  return TEMP_CH[String(k).split(":")[0]] ? tempC(v) : v;
}
function sigRange(k, arr){
  if(!arr) return arr;
  return TEMP_CH[String(k).split(":")[0]] ? arr.map(tempC) : arr;
}
