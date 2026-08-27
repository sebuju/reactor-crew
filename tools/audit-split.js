#!/usr/bin/env node
/* SPLITS audit-physics.js INTO ITS TOP-LEVEL STATEMENTS.
   Shared by audit-par.js (which runs them across every core) and by anything
   else that needs to talk about the auditor a statement at a time. Depth is
   counted on a copy with strings, comments and template literals blanked out,
   so a brace inside a message cannot shift it.

   A statement is one of two things and the difference is the whole point:
     - a BLOCK ({ ... } at column 0): a check. Independent of every other one,
       because it opens with set(), which rewrites D from BASE and
       re-commissions. This is what gets shared out.
     - anything else (a const, a let, a function, a console.log): shared
       scaffolding every shard needs, so every shard runs it.
   A statement that is neither - a bare top-level `for` doing real work - would
   run once per shard and cost N times what it does today, so this file reports
   them rather than guessing, and audit-par.js refuses to run if one appears. */
"use strict";

/* strings, template literals and comments out, line structure kept */
function blank(t){
  let o = "", i = 0;
  while(i < t.length){
    const c = t[i];
    if(c === "/" && t[i+1] === "/"){ while(i < t.length && t[i] !== "\n"){ o += " "; i++; } continue; }
    if(c === "/" && t[i+1] === "*"){
      while(i < t.length && !(t[i] === "*" && t[i+1] === "/")){ o += t[i] === "\n" ? "\n" : " "; i++; }
      o += "  "; i += 2; continue; }
    if(c === "'" || c === '"'){
      const q = c; o += " "; i++;
      while(i < t.length && t[i] !== q){
        if(t.charCodeAt(i) === 92){ o += "  "; i += 2; continue; }
        o += t[i] === "\n" ? "\n" : " "; i++; }
      o += " "; i++; continue; }
    if(c === "`"){
      o += " "; i++; let d = 0;
      while(i < t.length){
        if(t.charCodeAt(i) === 92){ o += "  "; i += 2; continue; }
        if(t[i] === "$" && t[i+1] === "{"){ o += "  "; i += 2; d++; continue; }
        if(t[i] === "}" && d > 0){ o += " "; i++; d--; continue; }
        if(t[i] === "`" && d === 0){ o += " "; i++; break; }
        o += t[i] === "\n" ? "\n" : (d > 0 ? t[i] : " "); i++; }
      continue; }
    o += c; i++; }
  return o;
}

/* A bare `{...}` is not the only shape a check comes in: two of them are a
   top-level `for` sweeping every architecture. Those do real work, so they are
   units like any other - left out, each would run once per shard and cost N
   times what it costs today. A unit is any top-level statement whose body is
   braced and whose closing brace is at column 0. */
const UNIT = /^(\{|for\s*\(|while\s*\(|if\s*\(|switch\s*\(|try\s*\{|do\s*\{)/;

/* → { lines, bare, units:[{i, from, to}], odd }, line numbers 0-based inclusive */
function split(src){
  const lines = src.split("\n"), bare = blank(src).split("\n");
  const out = [], odd = [];
  let depth = 0, from = -1, cont = false;
  for(let i = 0; i < lines.length; i++){
    if(depth === 0 && from < 0){
      const t = bare[i].trim();
      if(cont){ /* a continuation line of a multi-line declaration, not a statement */ }
      else if(UNIT.test(bare[i])) from = i;
      else if(t && !/^(const|let|var|function|class|console\.log|#!|\/)/.test(t))
        odd.push({ line: i + 1, text: lines[i].trim().slice(0, 90) });
      /* a declaration spanning several lines keeps its continuation lines out
         of the classification above; anything ending in ; or { closes it */
      if(from < 0 && t) cont = !/[;{]\s*$/.test(t);
    }
    for(const ch of bare[i]){ if(ch === "{") depth++; else if(ch === "}") depth--; }
    if(from >= 0 && depth === 0){
      if(/^\}/.test(bare[i])) out.push({ i: out.length, from, to: i });
      from = -1; cont = false; }
  }
  return { lines, bare, units: expand(bare, out), odd };
}

/* A CONTAINER IS NOT A CHECK. Three of these blocks are not one check at all -
   they are a dozen or more, each already braced, sharing a helper or two at the
   top. Left whole, one of them is a single thread's whole afternoon while the
   others idle: audit-par.js can only hand out a unit, so the longest unit is
   the floor the run cannot go under.
   So a block holding CONTAIN_MIN or more second-level blocks is opened up and
   its children become the units. What is left at the container's own level -
   the helpers - is scaffolding every shard runs, which is why the two checks in
   SECONDARY INVENTORY that used to sit bare at that level were braced: a bare
   check there would run once per shard and cost N times what it costs today. */
const CONTAIN_MIN = 3;
function expand(bare, units){
  const out = [];
  for(const u of units){
    const kids = [];
    let depth = 1, from = -1;
    for(let i = u.from + 1; i < u.to; i++){
      if(depth === 1 && from < 0 && /^\s{1,3}\{/.test(bare[i])) from = i;
      for(const ch of bare[i]){ if(ch === "{") depth++; else if(ch === "}") depth--; }
      if(from >= 0 && depth === 1){ kids.push({ from, to: i }); from = -1; }
    }
    if(kids.length >= CONTAIN_MIN) for(const k of kids) out.push({ from: k.from, to: k.to });
    else out.push({ from: u.from, to: u.to });
  }
  return out.sort((a, b) => a.from - b.from).map((u, i) => ({ i, from: u.from, to: u.to }));
}

/* WHICH UNITS HAVE TO STAY TOGETHER.
   "Every check is independent" is true of the physics and false of the tape:
   RPID is a top-level `let` that one unit assigns (the recording it just made)
   and a later unit reads, so splitting those two across threads gave the second
   one an undefined take. That is a real dependency and it is findable - a unit
   can only carry state to another unit through a top-level MUTABLE name, since
   everything else it declares is its own block scope.
   So: for every top-level `let`/`var` that any unit assigns, every unit that so
   much as mentions it joins one group. Conservative on purpose - a group that
   is too big costs parallelism, a group that is too small costs a wrong
   answer. `fails` is untouched by this because nothing assigns it inside a
   unit; bad() does, and bad() is a top-level function every shard runs. */
function groups(src){
  const r = split(src);
  /* A `let` INSIDE a unit is that unit's own business - half the checks keep a
     `let peak=0`, and tying every unit that happens to use the name would put
     the whole auditor back on one thread. Only a declaration OUTSIDE every
     unit can carry state between two of them: at column 0, or at a container's
     own level now that a unit can be a container's child. */
  const inUnit = new Uint8Array(r.lines.length);
  for(const u of r.units) for(let i = u.from; i <= u.to; i++) inUnit[i] = 1;
  const names = [];
  for(let i = 0; i < r.bare.length; i++){
    if(inUnit[i]) continue;
    const m = /^\s{0,3}(?:let|var)\s+(.*)$/.exec(r.bare[i]);
    if(!m) continue;
    for(const p of m[1].split(",")){
      const n = (p.split("=")[0] || "").trim();
      if(/^[A-Za-z_$][\w$]*$/.test(n)) names.push(n);
    }
  }
  const text = r.units.map(u => r.bare.slice(u.from, u.to + 1).join("\n"));
  const parent = r.units.map((_, i) => i);
  const find = a => { while(parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const join = (a, b) => { a = find(a); b = find(b); if(a !== b) parent[b] = a; };

  for(const n of names){
    const word = new RegExp("\\b" + n + "\\b");
    const write = new RegExp("\\b" + n + "\\s*(=[^=]|\\+\\+|--|[-+*/]=)");
    const mentions = [], writes = [];
    for(let i = 0; i < text.length; i++){
      if(!word.test(text[i])) continue;
      mentions.push(i);
      if(write.test(text[i])) writes.push(i);
    }
    if(!writes.length) continue;          // read-only: every shard sees the same value
    for(let i = 1; i < mentions.length; i++) join(mentions[0], mentions[i]);
  }

  /* A MUTABLE BINDING IS NOT THE ONLY WAY STATE CROSSES. A headless() bundle is
     a live plant behind a const: the recorder sections make a take on R in one
     unit and seek it in the next, and no rebinding happens anywhere. So every
     unit that touches the same bundle joins that bundle's group.
     M IS THE EXCEPTION, and it is the only one that has earned it: every check
     opens with set(), which rewrites D wholesale from BASE and re-commissions,
     which is exactly the reset the other bundles do not have. Tie M in and the
     whole auditor becomes one group again. */
  const bundles = [];
  for(let i = 0; i < r.bare.length; i++){
    const m = /^const\s+([A-Za-z_$][\w$]*)\s*=.*\.headless\(/.exec(r.bare[i]);
    if(m && m[1] !== "M") bundles.push(m[1]);
  }
  for(const n of bundles){
    const word = new RegExp("\\b" + n + "\\s*\\.");
    const mentions = [];
    for(let i = 0; i < text.length; i++) if(word.test(text[i])) mentions.push(i);
    for(let i = 1; i < mentions.length; i++) join(mentions[0], mentions[i]);
  }
  const by = new Map();
  for(let i = 0; i < r.units.length; i++){
    const k = find(i);
    if(!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  }
  return { units: r.units, odd: r.odd, groups: [...by.values()].sort((a, b) => a[0] - b[0]) };
}

module.exports = { blank, split, groups };

if(require.main === module){
  const fs = require("fs"), path = require("path");
  const f = process.argv[2] || path.join(__dirname, "audit-physics.js");
  const r = split(fs.readFileSync(f, "utf8").replace(/\r/g, ""));
  console.log(`${r.units.length} shareable units in ${r.lines.length} lines`);
  console.log(`${r.odd.length} top-level statement(s) that are neither a block nor a declaration`);
  for(const o of r.odd) console.log(`  line ${o.line}: ${o.text}`);
  /* A container's own level is scaffolding, so anything that STEPS there is
     paid for once per shard. Braces round it make it a unit again. */
  const inUnit = new Uint8Array(r.lines.length);
  for(const u of r.units) for(let i = u.from; i <= u.to; i++) inUnit[i] = 1;
  const leak = [];
  let d = 0, declAt = -1;
  for(let i = 0; i < r.lines.length; i++){
    if(!inUnit[i]){
      /* a helper's BODY steps the sim too, and costs nothing until somebody
         calls it - only a statement that runs at load is a leak */
      if(declAt < 0 && /^\s*(const|let|var|function|class)\b/.test(r.bare[i])) declAt = d;
      else if(declAt < 0 && /\brun\(\s*[\w$]+\s*,|M\.step\(/.test(r.bare[i]))
        leak.push(`  line ${i + 1}: ${r.lines[i].trim().slice(0, 88)}`);
      for(const ch of r.bare[i]){ if(ch === "{") d++; else if(ch === "}") d--; }
      if(d < 0) d = 0;
      if(declAt >= 0 && d <= declAt && /;\s*$/.test(r.bare[i])) declAt = -1;
    }
  }
  console.log(`${leak.length} statement(s) outside every unit that step the sim - each costs one run per shard`);
  for(const l of leak) console.log(l);
}
