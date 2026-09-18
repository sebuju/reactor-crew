"use strict";
// Builds the served artifacts for the wasm ingest-digest parity probe:
//   tests/out/wasm-parity/{sim_rs.wasm,step-preset0.bin,expected.json}
// `*.wasm` and gate dumps are gitignored, so the parity spec rebuilds them
// on demand instead of committing binaries. Usage:
//   node tools/wasm-parity-assets.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests", "out", "wasm-parity");
const TOOLCHAIN = "1.89.0-x86_64-pc-windows-gnu";

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

  // 1. Release wasm (same profile the smoke test verified).
  run("cargo", ["+" + TOOLCHAIN, "build", "--release",
    "--target", "wasm32-unknown-unknown", "--lib"], { RUSTUP_TOOLCHAIN: TOOLCHAIN }, SIMRS);
  const wasmSrc = path.join(ROOT, "sim-rs", "target", "wasm32-unknown-unknown",
    "release", "sim_rs.wasm");
  const wasmDst = path.join(OUT, "sim_rs.wasm");
  fs.copyFileSync(wasmSrc, wasmDst);

  // 2. Single-preset gate dump (sim_ingest takes the np==1 S0 section only).
  const gateOut = run("node", [path.join("tools", "step-gate.js"),
    "--ticks", "1", "--preset", "0"], { KEEP_TMP: "1" });
  const m = gateOut.match(/edge-table (.+)edge-frozen\.json/);
  if (!m) throw new Error("step-gate printed no edge-table dir:\n" + gateOut);
  const dir = m[1].trim();
  fs.copyFileSync(path.join(dir, "step.bin"), path.join(OUT, "step-preset0.bin"));

  // 3. Native digest of that dump: the browser must reproduce it exactly.
  const digestOut = run("cargo", ["+" + TOOLCHAIN, "run", "--quiet", "--release",
    "--bin", "sim-digest", "--", path.join(OUT, "step-preset0.bin")],
    { RUSTUP_TOOLCHAIN: TOOLCHAIN }, SIMRS);
  const dm = digestOut.match(/consumed=(\d+)\s+digest=([0-9a-f]+)/);
  if (!dm) throw new Error("sim-digest printed no digest:\n" + digestOut);

  const expected = {
    wasm: "sim_rs.wasm",
    dump: "step-preset0.bin",
    consumed: Number(dm[1]),
    digest: dm[2].toLowerCase(),
  };
  fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 1) + "\n");
  console.log("wasm-parity assets: " + JSON.stringify(expected));
}

main();
