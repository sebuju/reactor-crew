"use strict";
// node tests/physics/run.js <name ...>   every script runs in its own process under a 10 s timeout
const fs = require("fs"), path = require("path"), cp = require("child_process");
const DIR = __dirname;
const pick = process.argv.slice(2);
// no run-everything switch by design: the 10 s timeout caps one process, never the suite
if(!pick.length){
  console.error("run.js answers a named question. Name the scripts:\n" +
    "  node tests/physics/run.js decay xenon    two scripts\n" +
    "  node tests/physics/presets.js 3          one chunk, one process\n" +
    "There is no flag for all of them.");
  process.exit(2);
}
const files = fs.readdirSync(DIR).sort().filter(f => f.endsWith(".js") && f !== "run.js" && f !== "lib.js");
// a name that matches nothing would otherwise print a clean "0 pass, 0 fail" and exit 0
const bogus = pick.filter(n => !files.includes(n + ".js"));
if(bogus.length){
  console.error("run.js: no such check: " + bogus.join(" ") + "\nthe checks are:\n  " +
    files.map(f => f.slice(0, -3)).join(" "));
  process.exit(2);
}

const jobs = [];
for(const f of files){
  if(!pick.includes(f.slice(0, -3))) continue;
  const mod = fs.readFileSync(path.join(DIR, f), "utf8");
  const m = /^\/\/ chunks: (.*)$/m.exec(mod);
  if(m) for(const a of m[1].split(" ")) jobs.push([f, a.split(",")]);
  else jobs.push([f, []]);
}

const rows = [];
let bad = 0;
const fmt = v => typeof v !== "number" ? String(v) : (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) ? v.toExponential(3) : +v.toPrecision(5) + "";
for(const [f, args] of jobs){
  let more = true, round = 0;
  while(more){
    const r = cp.spawnSync(process.execPath, [path.join(DIR, f)].concat(args, round ? ["--resume"] : []),
      {encoding:"utf8", timeout:10000, maxBuffer:64*1024*1024});
    more = false;
    if(r.error || r.status !== 0){
      bad++;
      rows.push({name:f + " " + args.join(" ") + (r.error && r.error.code === "ETIMEDOUT" ? " KILLED at 10 s" : " crashed"),
        pass:false, measured:"", truth:"", tol:"", source:(r.stderr || "").split("\n").slice(0, 3).join(" | ")});
      break; }
    for(const line of r.stdout.split("\n")){
      if(line === "@@MORE"){ more = true; round++; continue; }
      if(!line.startsWith("@@CHECK ")) continue;
      const c = JSON.parse(line.slice(8));
      rows.push(c);
      if(!c.pass && !c.gap) bad++;
    }
  }
}
for(const c of rows){
  const st = c.pass ? "PASS" : c.gap ? "GAP " : "FAIL";
  const tol = c.tol === "" ? "" : c.abs ? "±" + fmt(c.tol) + " " + c.unit : "±" + fmt(c.tol*100) + " %";
  console.log(st + " | " + c.name + " | " + fmt(c.measured) + " " + (c.unit || "") + " | " + fmt(c.truth) + " | " + tol + " | " + c.source + (c.gap ? " | fidelity: " + c.gap : "") + (c.note ? " | " + c.note : ""));
}
console.log("\n" + rows.filter(c => c.pass).length + " pass, " + rows.filter(c => !c.pass && c.gap).length + " stated gaps, " + bad + " fail");
process.exitCode = bad ? 1 : 0;
