"use strict";
/* the optional save server */

/* ═══════════════ THE SERVER IS OPTIONAL ═══════════════

   `index.html` still opens straight off the filesystem and the whole game
   plays there. This process buys exactly one thing the `file://` page cannot
   have: a directory it may write to. Run it and scenarios and recordings
   persist to `saves/`; do not run it and every panel that saves says so
   (`storeWhy()` in src/data/store.js) and everything else behaves as before.

   Zero dependencies, on purpose. `http`, `fs` and `path` are all it may use,
   because a design study that needs `npm install` before it will open is a
   build step, and the whole point of the plain <script> tags is that there
   isn't one. */

const http = require("http"), fs = require("fs"), path = require("path");

const ROOT  = path.resolve(__dirname, "..");
const SAVES = path.join(ROOT, "saves");
const SNAPS = path.join(ROOT, "snapshots");

/* The two kinds, and the only two. A kind is half a filename, so this list is
   a whitelist and not a hint: anything not in it never reaches the disk. */
const KINDS = ["scenarios", "recordings"];

/* A recording is the big one - a keyframe is a whole plant state and there are
   many - so the cap is generous. It is still a cap: without one an aborted
   upload is an unbounded string in memory. */
const MAXBODY = 32 * 1024 * 1024;
/* A timeline dump is every keyframe the recorder still holds, each a whole
   plant state written out flat, so it outgrows a recording's own cap. */
const MAXSNAP = 192 * 1024 * 1024;

/* THE ONE PLACE UNTRUSTED INPUT BECOMES A FILENAME.
   Not a blacklist of `..` and `/`, because that game is lost the moment
   somebody sends `%2e%2e` or a NUL or a Windows stream name (`a:b`). One
   pattern, and everything it does not match is a 400 - so the id that reaches
   path.join() cannot contain a separator, a dot or an escape by construction. */
const IDPAT = /^[A-Za-z0-9_-]{1,64}$/;
/* A dump carries its own extension, so its names allow a dot - and for that
   reason the pattern has to refuse a leading one, or `..` is back. */
const SNAPPAT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\.(csv|json|png)$/;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js"  : "text/javascript; charset=utf-8",
  ".css" : "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const { stamp } = require("./stamp");

/* ═══════════════ REPLIES ═══════════════ */

function sendJSON(res, code, obj){
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {"Content-Type": MIME[".json"],
                       "Content-Length": body.length,
                       "Cache-Control": "no-store"});
  res.end(body);
}
const fail = (res, code, err) => sendJSON(res, code, {ok:false, err});

/* ═══════════════ THE SAVES DIRECTORY ═══════════════ */

/* Made on demand rather than at boot, so a server started only to serve the
   page never leaves an empty directory behind. */
const dirFor  = kind => path.join(SAVES, kind);
const fileFor = (kind, id) => path.join(dirFor(kind), id + ".json");
const ensure  = kind => fs.mkdirSync(dirFor(kind), {recursive:true});

/* WHAT THE SERVER KNOWS ABOUT A SCENARIO: four fields and two array lengths.
   It deliberately does not know the schema - that lives on the browser side,
   and a server that parsed it properly would be a second definition of it,
   free to drift. Anything absent reads 0 or the id, so a file this server has
   never seen the shape of still lists. */
function summary(kind, id){
  let obj = null, saved = "";
  try{
    const f = fileFor(kind, id);
    saved = stamp(fs.statSync(f).mtime);
    obj = JSON.parse(fs.readFileSync(f, "utf8"));
  }catch(e){ obj = null; }                 // unreadable or half-written: list it anyway
  const n = v => Array.isArray(v) ? v.length : 0;
  return {
    id,
    name : (obj && typeof obj.name === "string" && obj.name) || id,
    secs : (obj && Number(obj.secs)) || 0,
    nGest: obj ? n(obj.gest) : 0,
    nLim : obj ? n(obj.limits) : 0,
    saved,
  };
}

function listKind(kind){
  let names = [];
  try{ names = fs.readdirSync(dirFor(kind)); }catch(e){ return []; }   // never made yet
  return names.filter(f => f.endsWith(".json"))
              .map(f => f.slice(0, -5))
              .filter(id => IDPAT.test(id))    // a file dropped in by hand, badly named
              .sort()
              .map(id => summary(kind, id));
}

/* ═══════════════ THE API ═══════════════ */

function readBody(req, res, done, cap){
  let len = 0; const chunks = [];
  const max = cap || MAXBODY;
  req.on("data", c => {
    len += c.length;
    /* Refuse as soon as the cap is passed, not after the whole thing has
       arrived - the point of a cap is not to hold the oversized body. */
    if(len > max){ fail(res, 413, "body over " + (max >> 20) + " MB"); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => { if(!res.writableEnded) done(Buffer.concat(chunks).toString("utf8")); });
  req.on("error", () => { if(!res.writableEnded) fail(res, 400, "read failed"); });
}

function api(req, res, parts){
  if(parts.length === 1 && parts[0] === "ping" && req.method === "GET")
    return sendJSON(res, 200, {ok:true});
  if(parts[0] === "snap") return snapApi(req, res, parts);

  const kind = parts[0];
  if(!KINDS.includes(kind)) return fail(res, 404, "no such collection");

  if(parts.length === 1){
    if(req.method !== "GET") return fail(res, 405, req.method + " not allowed on a collection");
    return sendJSON(res, 200, listKind(kind));
  }
  if(parts.length !== 2) return fail(res, 404, "no such route");

  const id = parts[1];
  if(!IDPAT.test(id)) return fail(res, 400, "an id is 1-64 of A-Z a-z 0-9 _ -");
  const file = fileFor(kind, id);

  if(req.method === "GET"){
    let src;
    try{ src = fs.readFileSync(file, "utf8"); }
    catch(e){ return fail(res, 404, "no " + kind.slice(0, -1) + " called " + id); }
    res.writeHead(200, {"Content-Type": MIME[".json"], "Cache-Control":"no-store"});
    return res.end(src);      // straight through: it was JSON when it was written
  }

  if(req.method === "PUT"){
    return readBody(req, res, body => {
      /* Parsed before it is written, so a truncated upload fails here instead
         of becoming a file that every later list has to survive reading. */
      try{ JSON.parse(body); }catch(e){ return fail(res, 400, "body is not JSON"); }
      try{ ensure(kind); fs.writeFileSync(file, body); }
      catch(e){ return fail(res, 500, "write failed: " + e.message); }
      sendJSON(res, 200, {ok:true});
    });
  }

  if(req.method === "DELETE"){
    try{ fs.unlinkSync(file); }
    catch(e){ return fail(res, 404, "no " + kind.slice(0, -1) + " called " + id); }
    return sendJSON(res, 200, {ok:true});
  }

  return fail(res, 405, req.method + " not allowed");
}

/* ═══════════════ THE DEBUG DUMPS ═══════════════

   `snapshots/` is a flat gitignored scratch directory, not a collection: the
   browser names the file, the name carries the timestamp, and nothing here
   parses the body. PUT writes it, DELETE on the collection empties the whole
   directory, and there is no GET - a dump is read with a spreadsheet, not with
   the page that wrote it.

   `?b64=1` is how a PNG crosses: the body of a fetch is text. */

function snapApi(req, res, parts){
  if(parts.length === 1){
    if(req.method !== "DELETE") return fail(res, 405, req.method + " not allowed on snapshots");
    let n = 0;
    try{
      for(const f of fs.readdirSync(SNAPS))
        if(SNAPPAT.test(f)){ fs.unlinkSync(path.join(SNAPS, f)); n++; }
    }catch(e){ if(e.code !== "ENOENT") return fail(res, 500, "purge failed: " + e.message); }
    return sendJSON(res, 200, {ok:true, n});
  }
  if(parts.length !== 2) return fail(res, 404, "no such route");
  if(req.method !== "PUT") return fail(res, 405, req.method + " not allowed on a snapshot");

  const name = parts[1];
  if(!SNAPPAT.test(name)) return fail(res, 400, "a snapshot name is A-Z a-z 0-9 _ - . and ends .csv .json or .png");
  const b64 = /(^|[?&])b64=1(&|$)/.test(req.url.split("?")[1] || "");
  return readBody(req, res, body => {
    try{
      fs.mkdirSync(SNAPS, {recursive:true});
      fs.writeFileSync(path.join(SNAPS, name), b64 ? Buffer.from(body, "base64") : Buffer.from(body, "utf8"));
    }catch(e){ return fail(res, 500, "write failed: " + e.message); }
    sendJSON(res, 200, {ok:true});
  }, MAXSNAP);
}

/* ═══════════════ LIVE RELOAD ═══════════════ */

/* Only with --live, and only in the copy of the page this process hands out:
   nothing is written to the repo and the `file://` page never sees any of it. */
const LIVE = process.argv.includes("--live");
const LIVE_TAG = "<script>new EventSource('/api/live').onmessage=function(){location.reload();};</script>\n";
const liveClients = new Set();
const LIVE_SKIP = /(^|[\\/])(\.git|node_modules|saves|snapshots|test-results|screenshots)([\\/]|$)/;

function liveWatch(){
  let t = null;
  fs.watch(ROOT, {recursive:true}, (ev, name) => {
    if(!name || LIVE_SKIP.test(name) || !/\.(js|css|html)$/i.test(name)) return;
    clearTimeout(t);      // an editor's save is several events on one file
    t = setTimeout(() => { for(const res of liveClients) res.write("data: reload\n\n"); }, 120);
  });
}

function liveStream(req, res){
  res.writeHead(200, {"Content-Type":"text/event-stream",
                      "Cache-Control":"no-store", "Connection":"keep-alive"});
  res.write("retry: 500\n\n");
  liveClients.add(res);
  req.on("close", () => liveClients.delete(res));
}

/* ═══════════════ STATIC FILES ═══════════════ */

/* The traversal guard. `path.resolve` has already flattened every `..`, so the
   test is on the ANSWER and not on the request: whatever the client wrote, the
   file it named either sits inside ROOT or it does not exist as far as this
   server is concerned. The `+ path.sep` matters - without it a sibling
   directory called `reactor-crew-secrets` passes a bare startsWith(ROOT). */
function resolveStatic(pathname){
  let rel;
  try{ rel = decodeURIComponent(pathname); }catch(e){ return null; }   // bad %-escape
  if(rel.indexOf("\0") >= 0) return null;
  rel = rel.replace(/^\/+/, "");
  if(rel === "" || rel.endsWith("/")) rel += "index.html";
  const abs = path.resolve(ROOT, rel);
  if(abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function statics(req, res, pathname){
  if(req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, req.method + " not allowed");
  const abs = resolveStatic(pathname);
  if(!abs) return fail(res, 400, "bad path");
  let st;
  try{ st = fs.statSync(abs); }catch(e){ return fail(res, 404, "not found"); }
  if(st.isDirectory()) return statics(req, res, pathname.replace(/\/*$/, "/"));
  const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
  if(LIVE && type === MIME[".html"]){
    let src;
    try{ src = fs.readFileSync(abs, "utf8"); }catch(e){ return fail(res, 404, "not found"); }
    const body = Buffer.from(src.replace(/<\/body>/i, LIVE_TAG + "</body>"), "utf8");
    res.writeHead(200, {"Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store"});
    return req.method === "HEAD" ? res.end() : res.end(body);
  }
  res.writeHead(200, {"Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-store"});
  if(req.method === "HEAD") return res.end();
  fs.createReadStream(abs).pipe(res);
}

/* ═══════════════ BOOT ═══════════════ */

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0].split("#")[0];
  try{
    if(LIVE && pathname === "/api/live") return liveStream(req, res);
    if(pathname === "/api" || pathname.startsWith("/api/"))
      return api(req, res, pathname.slice(5).split("/").filter(Boolean));
    statics(req, res, pathname);
  }catch(e){
    /* One process serves one player; a thrown handler must not take the page
       down with it, so it becomes a 500 the panel can print. */
    if(!res.writableEnded) fail(res, 500, e.message);
  }
});

const PORT = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.PORT || 8017);
server.listen(PORT, () => {
  if(LIVE) liveWatch();
  console.log("REACTOR-CREW  http://localhost:" + PORT + "/");
  if(LIVE) console.log("live reload   watching *.js *.css *.html under " + ROOT);
  console.log("saves         " + SAVES);
});
