"use strict";
// The one wasm build: release `wasm32-unknown-unknown` on the pinned toolchain, copied to
// sim-rs/pkg/sim_rs.wasm (gitignored), where the live worker fetches it. Usage:
//   node tools/wasm-build.js
// Runs past the 10 s node budget on a cold build: background it.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SIMRS = path.join(ROOT, "sim-rs");
const TOOLCHAIN = "1.89.0-x86_64-pc-windows-gnu";
const PKG = path.join(SIMRS, "pkg", "sim_rs.wasm");

function build() {
  execFileSync("cargo", ["+" + TOOLCHAIN, "build", "--release", "--target", "wasm32-unknown-unknown", "--lib"], {
    cwd: SIMRS, env: Object.assign({}, process.env, { RUSTUP_TOOLCHAIN: TOOLCHAIN }),
    stdio: ["ignore", "pipe", "pipe"], timeout: 600000,
  });
  fs.mkdirSync(path.dirname(PKG), { recursive: true });
  fs.copyFileSync(path.join(SIMRS, "target", "wasm32-unknown-unknown", "release", "sim_rs.wasm"), PKG);
  return PKG;
}

module.exports = { build, PKG };
if (require.main === module) console.log("wasm-build: " + build());
