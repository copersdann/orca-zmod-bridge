#!/usr/bin/env node
/** E2E: start the standalone bridge on :8766, run the plugin against it with a stub `orca` module. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hub = spawn(process.execPath, [path.join(ROOT, "src/standalone-http.js")], {
  cwd: ROOT,
  env: { ...process.env, MCP_HUB_HTTP_PORT: "8766" },
  stdio: ["ignore", "ignore", "pipe"],
});
hub.stderr.on("data", (d) => process.stderr.write("[bridge] " + d));
await new Promise((r) => setTimeout(r, 2000));
const test = spawn("python", [path.join(ROOT, "scripts", "test-plugin.py")], {
  cwd: ROOT,
  env: { ...process.env, MCP_HUB_TEST_HOST: "http://127.0.0.1:8766" },
  stdio: "inherit",
});
const code = await new Promise((r) => test.on("exit", r));
hub.kill("SIGTERM");
console.log("python exit:", code);
process.exit(code ?? 1);
