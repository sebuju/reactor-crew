"use strict";
// Builds the served artifacts for the wasm step parity probe:
//   tests/out/wasm-parity/{sim_rs.wasm,step-preset0.bin,freeze-preset0.bin,expected.json}
// `*.wasm` and gate dumps are gitignored, so the parity spec rebuilds them
// on demand instead of committing binaries. Usage:
//   node tools/wasm-parity-assets.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { build } = require("./wasm-build");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests", "out", "wasm-parity");
const TOOLCHAIN = "1.89.0-x86_64-pc-windows-gnu";
const STEPS = 30;

function run(cmd, args, env, cwd) {
  return execFileSync(cmd, args, {
    cwd: cwd || ROOT,
    env: Object.assign({}, process.env, env),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600000,
  }).toString();
}

const SIMRS = path.join(ROOT, "sim-rs");

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Release wasm, the same build the live worker fetches.
  fs.copyFileSync(build(), path.join(OUT, "sim_rs.wasm"));

  // 2. Single-preset gate dump (sim_ingest takes the np==1 S0 section only)
  //    and its freeze (sim_freeze), both off the same commission.
  const gateOut = run("node", [path.join("tools", "step-gate.js"),
    "--ticks", "1", "--preset", "0"], { KEEP_TMP: "1" });
  const m = gateOut.match(/^freeze (.+)$/m);
  if (!m) throw new Error("step-gate printed no freeze path:\n" + gateOut);
  const freezeSrc = m[1].trim();
  fs.copyFileSync(path.join(path.dirname(freezeSrc), "step.bin"), path.join(OUT, "step-preset0.bin"));
  fs.copyFileSync(freezeSrc, path.join(OUT, "freeze-preset0.bin"));

  // 3. Native digests through the exported ABI: S0, then one per tick. The
  //    browser must reproduce every one exactly.
  const digestOut = run("cargo", ["+" + TOOLCHAIN, "run", "--quiet", "--release",
    "--bin", "sim-digest", "--", path.join(OUT, "step-preset0.bin"),
    "--freeze", path.join(OUT, "freeze-preset0.bin"), "--steps", String(STEPS)],
    { RUSTUP_TOOLCHAIN: TOOLCHAIN }, SIMRS);
  const dm = digestOut.match(/consumed=(\d+)\s+digest=([0-9a-f]+)/);
  if (!dm) throw new Error("sim-digest printed no digest:\n" + digestOut);
  const fm = digestOut.match(/frozen=(\d+)/);
  const ticks = [...digestOut.matchAll(/^tick=\d+ digest=([0-9a-f]+)$/gm)].map(t => t[1].toLowerCase());
  if (!fm || ticks.length !== STEPS) throw new Error("sim-digest printed " + ticks.length + " of " + STEPS + " ticks:\n" + digestOut);

  const expected = {
    wasm: "sim_rs.wasm",
    dump: "step-preset0.bin",
    freeze: "freeze-preset0.bin",
    consumed: Number(dm[1]),
    frozen: Number(fm[1]),
    digest: dm[2].toLowerCase(),
    dt: 0.02,
    ticks,
  };
  fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 1) + "\n");
  console.log("wasm-parity assets: " + JSON.stringify(expected));
}

main();
