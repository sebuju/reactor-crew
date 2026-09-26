"use strict";
// one report per question and tree: every process of a batch appends to results/batches/<id>.jsonl and re-renders tests/reports/physics_*_<id>.txt
const path = require("path"), fs = require("fs"), crypto = require("crypto");
const {stampSec, stampFile} = require(path.join(__dirname, "..", "..", "tools", "stamp.js"));
const {dur, pad, rpad} = require(path.join(__dirname, "..", "report.js"));
const {RESULTS, treeId, treeNote, list, fmt, stOf, tolOf} = require("./lib.js");
const ROOT = path.join(__dirname, "..", ".."), LEDGERS = path.join(RESULTS, "batches"), REPORTS = path.join(__dirname, "..", "reports");
const rel = f => path.relative(ROOT, f).replace(/\\/g, "/");
const sha6 = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 6);
const askId = (plan, why) => sha6(plan + "\0" + why);
const batchKey = (plan, why, common) => askId(plan, why) + "-" + treeId(common).slice(0, 6);
const instOf = (id, key) => id === key ? 1 : id.startsWith(key + "-") && /^\d+$/.test(id.slice(key.length + 1)) ? +id.slice(key.length + 1) : 0;

/* the newest instance of key that holds no other blob of script, else the next instance */
function batchPick(ledgers, key, script, blob){
  const inst = ledgers.map(l => [instOf(l.id, key), l]).filter(([n]) => n).sort((a, b) => b[0] - a[0]);
  for(const [, l] of inst){ const s = l.lines.find(x => x.script === script); if(!s || s.blob === blob) return l.id; }
  return inst.length ? key + "-" + (inst[0][0] + 1) : key;
}

const ledgerFile = id => path.join(LEDGERS, id + ".jsonl");
function readLedger(file){
  const out = [];
  for(const l of fs.readFileSync(file, "utf8").split("\n")) if(l) try { out.push(JSON.parse(l)); } catch(e){}
  return out;
}
function ledgers(){
  if(!fs.existsSync(LEDGERS)) return [];
  return fs.readdirSync(LEDGERS).filter(f => f.endsWith(".jsonl")).map(f => { const file = path.join(LEDGERS, f);
    return {id:f.slice(0, -6), file, lines:readLedger(file), mtime:fs.statSync(file).mtimeMs}; });
}
const append = (file, o) => fs.appendFileSync(file, JSON.stringify(o) + "\n");

/* o: {plan, why, script, key, resume, asked, at, pid, commit, inputs}; a resume round joins the batch holding its chunk's open attempt */
function batchJoin(o){
  fs.mkdirSync(LEDGERS, {recursive:true});
  const sf = "tests/physics/" + o.script + ".js", blob = o.inputs[sf], common = Object.assign({}, o.inputs), all = ledgers();
  delete common[sf];
  let id = null, attempt = o.pid + "." + o.at, round = 1;
  if(o.resume) for(const l of all.filter(l => l.id.startsWith(askId(o.plan, o.why) + "-")).sort((a, b) => b.mtime - a.mtime)){
    const last = l.lines.filter(x => x.key === o.key).pop();
    if(last && last.end === "more"){ id = l.id; attempt = last.attempt; round = last.round + 1; break; } }
  const orphan = o.resume && !id;
  if(!id) id = batchPick(all, batchKey(o.plan, o.why, common), o.script, blob);
  const file = ledgerFile(id), name = "physics_" + stampFile(new Date(o.at)) + "_" + (o.plan || "noplan").replace(/[^\w.-]/g, "_") + "_" + id + ".txt";
  try { fs.writeFileSync(file, JSON.stringify({batch:id, plan:o.plan, why:o.why, commit:o.commit, common, at:o.at, report:rel(path.join(REPORTS, name))}) + "\n", {flag:"wx"}); }
  catch(e){ if(e.code !== "EEXIST") throw e; }
  const lines = readLedger(file), head = lines[0];
  if(!lines.some(x => x.script === o.script)) append(file, {script:o.script, blob});
  const moved = Object.keys(Object.assign({}, head.common, common)).filter(f => head.common[f] !== common[f]).sort();
  append(file, {key:o.key, attempt, round, pid:o.pid, at:o.at, asked:o.asked, treeMoved:moved.length ? moved : undefined, orphan:orphan || undefined});
  batchRender(file);
  return {id, attempt, report:head.report};
}

/* books the end of process pid's round once; o: {end, err, ms, checks} */
function batchEnd(id, pid, o){
  const file = ledgerFile(id), lines = readLedger(file), s = lines.filter(x => x.pid === pid && x.end === undefined && x.key !== undefined).pop();
  if(!s || lines.some(x => x.pid === pid && x.attempt === s.attempt && x.round === s.round && x.end !== undefined)) return;
  append(file, {key:s.key, attempt:s.attempt, round:s.round, pid, at:Date.now(), ms:o.ms, end:o.end, err:o.err || undefined, checks:o.checks});
  batchRender(file);
}

const batchReport = id => { const f = ledgerFile(id); return fs.existsSync(f) ? (readLedger(f)[0] || {}).report : undefined; };

function attemptsOf(lines){
  const A = new Map();
  for(const x of lines){ if(x.key === undefined) continue;
    let a = A.get(x.attempt); if(!a) A.set(x.attempt, a = {key:x.key, rounds:new Map()});
    let r = a.rounds.get(x.round); if(!r) a.rounds.set(x.round, r = {});
    r[x.end === undefined ? "start" : "end"] = x; }
  return [...A.values()].map(a => {
    const rs = [...a.rounds.entries()].sort((p, q) => p[0] - q[0]).map(e => e[1]), n = rs.length, last = rs[n - 1];
    const e = last.end && last.end.end;
    const end = !last.end ? "no end line: killed, or still running" : e === "done" ? "done" : e === "more" ? "stopped between rounds" : e + " in round " + n;
    return {key:a.key, at:(rs[0].start || rs[0].end).at, ms:rs.reduce((s, r) => s + (r.end ? r.end.ms : 0), 0), rounds:n, end, err:last.end && last.end.err,
      checks:rs.flatMap(r => r.end ? r.end.checks || [] : []), orphan:!!(rs[0].start && rs[0].start.orphan),
      moved:[...new Set(rs.flatMap(r => r.start && r.start.treeMoved || []))].sort()};
  }).sort((p, q) => p.at - q.at);
}

function checkBlock(c){
  const u = c.unit ? " " + c.unit : "", L = ["  " + stOf(c) + "  " + c.name];
  if(c.measured !== "") L.push("        measured " + fmt(c.measured) + u + "   physics " + fmt(c.truth) + u + (tolOf(c) ? "   tolerance " + tolOf(c) : ""));
  L.push("        source   " + c.source);
  if(c.gap) L.push("        fidelity " + c.gap);
  if(c.note) L.push("        note     " + c.note);
  return L;
}

const P = c => c.pass, G = c => !c.pass && c.gap, F = c => !c.pass && !c.gap;
function summaryOf(lines){
  const head = lines[0], at = lines.filter(x => x.at !== undefined && x.key !== undefined).map(x => x.at), att = attemptsOf(lines), all = att.flatMap(a => a.checks);
  return {head, att, first:at.length ? Math.min(...at) : head.at, last:at.length ? Math.max(...at) : head.at, busy:att.reduce((s, a) => s + a.ms, 0),
    open:att.filter(a => a.end !== "done").length, pass:all.filter(P).length, gap:all.filter(G).length, fail:all.filter(F).length};
}

/* rewrites the batch's report in full off its ledger; returns the summary */
function batchRender(file){
  const s = summaryOf(readLedger(file)), h = s.head, day = d => stampSec(new Date(d)).split(" ");
  const when = t => { const [d, c] = day(t); return d === day(s.first)[0] ? c : d + " " + c; };
  const w = Math.max(17, ...s.att.map(a => a.key.length + 2));
  const L = ["REACTOR-CREW  PHYSICS CHECKS", "",
    "plan      " + (h.plan || "not stated"), "why       " + (h.why || "not stated"), "tree      " + treeNote(h.common, h.commit),
    "batch     " + h.batch, "first     " + stampSec(new Date(s.first)), "last      " + stampSec(new Date(s.last)),
    "span      " + dur(s.last - s.first) + "        wall clock, first start to last event",
    "busy      " + dur(s.busy) + "        time processes actually ran", "",
    pad("CHUNK", w) + pad("STARTED", 11) + pad("TIME", 9) + rpad("ROUNDS", 6) + rpad("PASS", 6) + rpad("GAP", 6) + rpad("FAIL", 6) + "  END"];
  for(const a of s.att) L.push(pad(a.key, w) + pad(when(a.at), 11) + pad(dur(a.ms), 9) + rpad(a.rounds, 6) + rpad(a.checks.filter(P).length, 6) +
    rpad(a.checks.filter(G).length, 6) + rpad(a.checks.filter(F).length, 6) + "  " + a.end);
  const notes = s.att.flatMap(a => [...(a.moved.length ? [a.key + " started " + when(a.at) + ": files changed between rounds: " + list(a.moved, 4)] : []),
    ...(a.orphan ? [a.key + " started " + when(a.at) + ": resume with no open round"] : [])]);
  if(notes.length) L.push("", ...notes);
  L.push("", s.pass + " pass, " + s.gap + " stated gaps, " + s.fail + " fail | " + (s.att.length - s.open) + " attempts done, " + s.open + " unfinished", "");
  const title = a => a.key + "  started " + when(a.at);
  const bad = s.att.filter(a => a.end !== "done" || a.checks.some(c => !c.pass));
  if(bad.length){ L.push("FAILS, GAPS AND UNFINISHED ATTEMPTS", "");
    for(const a of bad){ L.push(title(a) + (a.end !== "done" ? "  (" + a.end + ")" : ""));
      if(a.err) L.push("  error    " + a.err);
      if(a.moved.length) L.push("  files changed between rounds: " + list(a.moved, 4));
      for(const c of a.checks) if(!c.pass) L.push(...checkBlock(c));
      L.push(""); } }
  L.push("EVERY CHECK", "");
  for(const a of s.att){ L.push(title(a)); for(const c of a.checks) L.push(...checkBlock(c)); L.push(""); }
  L.push("The machine-readable results are in tests/physics/results/.", "Read them back with: node tests/physics/last.js", "List the batches with: node tests/physics/last.js --batches");
  fs.mkdirSync(REPORTS, {recursive:true});
  const out = path.join(ROOT, h.report), tmp = out + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, L.join("\n") + "\n");
  try { fs.renameSync(tmp, out); } catch(e){ fs.copyFileSync(tmp, out); fs.unlinkSync(tmp); }
  return s;
}

/* the newest n batches by last event, each report re-rendered first */
function batchList(n){
  return ledgers().map(l => ({file:l.file, last:summaryOf(l.lines).last})).sort((a, b) => b.last - a.last).slice(0, n).map(l => batchRender(l.file));
}

module.exports = {batchKey, batchPick, batchJoin, batchEnd, batchReport, batchRender, batchList};
