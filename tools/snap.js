"use strict";
// node tools/snap.js build <boot|n>   a startup snapshot of the booted bundle, or of preset n commissioned, keyed on the engine's inputs
// tests/physics/run.js builds and uses these; a chunk runs as: node --snapshot-blob <blob> <script> <args>
const v8 = require("v8"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
// undici's classes want WebAssembly, which a snapshot cannot hold
const WEB = ["fetch", "Request", "Response", "Headers", "FormData", "WebSocket", "EventSource", "MessageEvent", "CloseEvent", "File", "Blob"];
const TICKS = 200, REFUSED = 86;
// ms, measured 26/09/26: the cost a preset blob saves per chunk
const COMMISSION_MS = [2764, 3550, 8913, 3848, 5988, 4440, 4009, 6285, 6286];

const sha1 = b => crypto.createHash("sha1").update(b).digest("hex");
const ticksHash = ev => {
  const S = ev("snapS")(), step = ev("engStep");
  ev("ST").sc[ev("SC_DICEOFF")] = 1;
  for(let k = 0; k < TICKS; k++) step(0.02);
  const h = sha1(new Uint8Array(ev("engSnap")(ev("engSnapNew")())));
  ev("restoreS")(S);
  return h;
};
const stHash = ev => sha1(new Uint8Array(ev("engSnap")(ev("engSnapNew")())));

function build(){
  for(const k of WEB) try { delete globalThis[k]; } catch(e){}
  const ROOT = process.env.RC_SNAP_ROOT, which = process.env.RC_SNAP_WHICH, file = path.join(ROOT, "tools", "bundle.js"), mod = {exports:{}};
  new Function("require", "module", "exports", "__dirname", "__filename", fs.readFileSync(file, "utf8"))(require, mod, mod.exports, path.dirname(file), file);
  const ev = mod.exports.headless("(n => eval(n))");
  globalThis.__EV = ev;
  globalThis.__BASE = JSON.stringify(ev("D"));
  const S = globalThis.__SNAP = {which, pre:-1};
  if(which !== "boot"){
    S.pre = +which;
    ev("plantPreset")(S.pre); ev("buildLayout")(); ev("commission")();
    S.hash = ticksHash(ev); S.P = ev("P"); S.D = JSON.stringify(ev("D")); S.st = stHash(ev); }
  v8.startupSnapshot.setDeserializeMainFunction(main);
}

// the blob's bytes are the build's, and a preset's 200 ticks hash as they did at build, or the chunk runs the plain way
function main(){
  const fs = require("fs"), path = require("path"), S = globalThis.__SNAP, blob = process.env.RC_SNAP_BLOB;
  const refuse = why => { process.stderr.write("@@SNAP refused " + S.which + ": " + why + "\n"); process.exit(REFUSED); };
  if(!blob) refuse("no RC_SNAP_BLOB");
  const sha = sha1(fs.readFileSync(blob)), read = f => { try { return fs.readFileSync(f, "utf8"); } catch(e){ return ""; } };
  if(sha !== read(blob + ".sha")) refuse("its bytes are not the build's");
  if(S.pre >= 0 && read(blob + ".ok") !== sha){
    if(ticksHash(globalThis.__EV) !== S.hash) refuse(TICKS + " ticks after restore differ from " + TICKS + " at build");
    fs.writeFileSync(blob + ".ok", sha); }
  const script = path.resolve(process.argv[1]);
  globalThis.__MAIN = script;
  process.stdout.write("@@SNAP " + S.which + "\n");
  require("module").createRequire(script)(script);
}

// the one lib.js asks: preset i's first commission, served off the blob when nothing has touched the plant since
function snapTake(ev, i){
  const S = globalThis.__SNAP;
  if(!S || S.pre < 0 || ev !== globalThis.__EV) return false;
  const hit = S.pre === i && ev("P") === S.P && JSON.stringify(ev("D")) === S.D && stHash(ev) === S.st;
  S.pre = -1;
  return hit;
}

const ROOT = typeof __dirname === "string" ? path.resolve(__dirname, "..") : process.env.RC_SNAP_ROOT, HOME = path.join(os.tmpdir(), "rc-snap");
function snapKey(){
  const files = ["index.html", "tools/bundle.js", "tools/snap.js"];
  const walk = d => { for(const e of fs.readdirSync(path.join(ROOT, d), {withFileTypes:true})){
    if(e.isDirectory()) walk(d + "/" + e.name); else files.push(d + "/" + e.name); } };
  walk("src");
  const h = crypto.createHash("sha1").update(process.version + "\0");
  for(const f of files.sort()) h.update(f + "\0").update(fs.readFileSync(path.join(ROOT, f))).update("\0");
  return h.digest("hex").slice(0, 12);
}
const blobDir = () => path.join(HOME, snapKey());
const blobFile = (dir, which) => path.join(dir, which + ".blob");
const haveBlob = (dir, which) => fs.existsSync(blobFile(dir, which)) && fs.existsSync(blobFile(dir, which) + ".sha");

const BUILDS = path.join(HOME, "builds.json");
const buildsRead = () => { try { return JSON.parse(fs.readFileSync(BUILDS, "utf8")); } catch(e){ return {}; } };
// the last build's wall time, else the interpreter's: a 24 s boot and a commission ~8x its compiled time
function buildMs(which){
  const b = buildsRead()[which];
  return b || (which === "boot" ? 24000 : 24000 + 8*COMMISSION_MS[+which.slice(1)]);
}
// which blobs pay for themselves: a preset blob when its chunks' commissions cost more than its build, the boot blob for 4 or more chunks
function snapChoose(need, force){
  const dir = blobDir(), use = {}, build = [];
  for(const w in need){
    const worth = force || (w === "boot" ? need[w] >= 4 : need[w]*COMMISSION_MS[+w.slice(1)] > buildMs(w));
    if(haveBlob(dir, w)) use[w] = blobFile(dir, w);
    else if(worth){ use[w] = blobFile(dir, w); build.push(w); } }
  return {dir, use, build};
}

// resolves {ok, ms, err}; a torn blob is never seen, the sha lands first and the blob is renamed in whole
function snapBuild(dir, which){
  return new Promise(done => {
    fs.mkdirSync(dir, {recursive:true});
    for(const d of fs.existsSync(HOME) ? fs.readdirSync(HOME) : []){ const p = path.join(HOME, d);
      if(p !== dir && fs.statSync(p).isDirectory()) try { fs.rmSync(p, {recursive:true, force:true}); } catch(e){} }
    const out = blobFile(dir, which), tmp = out + "." + process.pid + ".tmp", t = Date.now();
    const env = Object.assign({}, process.env, {RC_SNAP_ROOT:ROOT, RC_SNAP_WHICH:which === "boot" ? "boot" : which.slice(1)});
    const ch = require("child_process").spawn(process.execPath, ["--snapshot-blob", tmp, "--build-snapshot", __filename], {env});
    let err = "";
    ch.stderr.on("data", d => { err += d; });
    ch.stdout.on("data", () => {});
    ch.on("close", code => {
      const ms = Date.now() - t;
      if(code !== 0 || !fs.existsSync(tmp)){ try { fs.unlinkSync(tmp); } catch(e){}
        return done({ok:false, ms, err:err.trim().split("\n").slice(0, 3).join(" | ") || "exit " + code}); }
      fs.writeFileSync(out + ".sha", sha1(fs.readFileSync(tmp)));
      try { fs.unlinkSync(out + ".ok"); } catch(e){}
      fs.renameSync(tmp, out);
      const b = buildsRead(); b[which] = ms;
      try { fs.writeFileSync(BUILDS, JSON.stringify(b)); } catch(e){}
      done({ok:true, ms});
    });
  });
}

function cli(){
  const [cmd, w] = process.argv.slice(2);
  if(cmd !== "build" || !(w === "boot" || /^\d+$/.test(w || ""))){ console.error("node tools/snap.js build <boot|n>"); process.exit(2); }
  const which = w === "boot" ? "boot" : "p" + w, dir = blobDir();
  snapBuild(dir, which).then(r => { console.log(which + " " + (r.ok ? "built" : "FAILED: " + r.err) + " in " + (r.ms/1000).toFixed(1) + " s -> " + blobFile(dir, which));
    process.exitCode = r.ok ? 0 : 1; });
}

if(v8.startupSnapshot.isBuildingSnapshot()) build();
else {
  module.exports = {REFUSED, COMMISSION_MS, snapKey, snapChoose, snapBuild, snapTake};
  if(require.main === module) cli(); }
