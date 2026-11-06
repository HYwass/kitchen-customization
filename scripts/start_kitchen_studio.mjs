import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ENTRY = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
const children = [
  spawn(process.execPath, ["server/kitchen-studio-server.mjs"], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, [VITE_ENTRY], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
