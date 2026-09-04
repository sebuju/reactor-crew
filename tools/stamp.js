/* ══ THE ONE TIMESTAMP FORMAT ══
   24-hour, `dd/mm/yy HH:MM`, assembled from the parts by hand. Every
   toLocale*() function reads the machine it happens to be running on, so the
   same save file would be stamped `8/24/26, 3:05 PM` here and `24.08.26,
   15:05` on the next box - and the panel that lists saves would be reading a
   different format depending on who built the plant. */
const pad2 = n => String(n).padStart(2, "0");

const dmy = d => pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" +
                 pad2(d.getFullYear() % 100);
const hm  = d => pad2(d.getHours()) + ":" + pad2(d.getMinutes());
const hms = d => hm(d) + ":" + pad2(d.getSeconds());

const stamp    = d => dmy(d) + " " + hm(d);
const stampSec = d => dmy(d) + " " + hms(d);
// the same instant with nothing a filesystem objects to
const stampFile = d => dmy(d).replace(/\//g, "-") + "_" + hms(d).replace(/:/g, "-");

module.exports = { pad2, stamp, stampSec, stampFile };
