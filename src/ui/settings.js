"use strict";

let settingsModalEls = null;

function settingsInit(){
  if(typeof document === "undefined" || !document.body || settingsModalEls) return;
  const back = KIT.el("div", "settings-backdrop kit-hide");
  const box = KIT.el("div", "settings-modal");
  const title = KIT.el("div", "settings-title");
  title.textContent = "SETTINGS";
  box.appendChild(title);
  const row = KIT.el("div", "settings-row");
  const lab = KIT.el("span", "settings-label");
  lab.textContent = "TEMPERATURE";
  row.appendChild(lab);
  const seg = KIT.segSel(["KELVIN", "CELSIUS"], {onSelect:i => settingsSetUnit(i ? "C" : "K")});
  KIT.tip(seg.el, "TEMPERATURE", "Absolute temperatures read in the chosen unit. Rises, margins, subcooling and rates stay kelvin.");
  row.appendChild(seg.el);
  box.appendChild(row);
  const note = KIT.el("div", "settings-note");
  note.textContent = "Stored in saves/settings.json when the server is up, else in this browser.";
  box.appendChild(note);
  const close = KIT.button("CLOSE", {onClick:() => settingsClose()});
  box.appendChild(close.el);
  back.appendChild(box);
  document.body.appendChild(back);
  back.addEventListener("pointerdown", e => { if(e.target === back) settingsClose(); });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && settingsIsOpen()) settingsClose();
  });
  settingsModalEls = {back, seg};
  refreshSettingsModal();
}
const settingsIsOpen = () =>
  !!settingsModalEls && !settingsModalEls.back.classList.contains("kit-hide");
function refreshSettingsModal(){
  if(settingsModalEls) settingsModalEls.seg.set(SETTINGS.tempUnit === "C" ? 1 : 0);
}
function settingsOpen(){
  settingsInit();
  if(!settingsModalEls) return;
  if(typeof ctxClose === "function") ctxClose();
  refreshSettingsModal();
  KIT.show(settingsModalEls.back, true);
}
function settingsClose(){
  if(settingsModalEls) KIT.show(settingsModalEls.back, false);
}
