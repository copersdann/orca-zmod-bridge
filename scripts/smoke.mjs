#!/usr/bin/env node
/** Smoke test: starts the sidecar and checks every endpoint the Orca plugin uses. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8769;
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(ROOT, "src/standalone-http.js")], {
  cwd: ROOT, env: { ...process.env, MCP_HUB_HTTP_PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1800));
const paths = [
  "/health", "/settings", "/printer/status", "/printer/afc", "/printer/probe?limit=8&timeoutMs=200",
  "/reports", "/plugin/events?limit=5", "/orca/info", "/orca/presets?source=orca&kind=process&query=AD5X",
  "/hub/tools?query=analyze", "/diagnostics",
];
let failed = 0;
for (const p of paths) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(20000) });
    const ok = r.ok;
    console.log(ok ? "OK  " : "FAIL", p, r.status);
    if (!ok) failed++;
  } catch (e) { console.log("FAIL", p, String(e.message)); failed++; }
}
child.kill("SIGTERM");
console.log(failed ? `${failed} failed` : "all endpoints OK");
process.exit(failed ? 1 : 0);
