// assembled by hand because every toLocale*() reads the machine it happens to run on
const pad2 = n => String(n).padStart(2, "0");

const dmy = d => pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" +
                 pad2(d.getFullYear() % 100);
const hm  = d => pad2(d.getHours()) + ":" + pad2(d.getMinutes());
const hms = d => hm(d) + ":" + pad2(d.getSeconds());

const stamp    = d => dmy(d) + " " + hm(d);
const stampSec = d => dmy(d) + " " + hms(d);
const stampFile = d => dmy(d).replace(/\//g, "-") + "_" + hms(d).replace(/:/g, "-");

// the page loads this with a <script> tag, where `module` does not exist
if(typeof module !== "undefined") module.exports = { pad2, stamp, stampSec, stampFile };
