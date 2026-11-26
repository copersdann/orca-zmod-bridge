/** Repair AD5X Nopoop .4 process preset: point `inherits` at a real PROCESS preset. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const root = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");
const conf = path.join(root, "OrcaSlicer.conf");
const preset = path.join(root, "user", "default", "process", "AD5X Nopoop .4.json");
const stash = path.join("C:", "tools", "orca-zmod-mcp", "backups",
  "nopoop-fix-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(stash, { recursive: true });
fs.copyFileSync(preset, path.join(stash, "AD5X Nopoop .4.json"));
fs.copyFileSync(conf, path.join(stash, "OrcaSlicer.conf"));

// --- 1. repair inherits ---
const j = JSON.parse(fs.readFileSync(preset, "utf8"));
console.log("inherits before:", j.inherits);
j.inherits = "0.16mm Standard @FF AD5X";
console.log("inherits after :", j.inherits);
fs.writeFileSync(preset, JSON.stringify(j, null, 2) + "\n", "utf8");

// --- 2. re-select the process for Z-Mod ---
const c = JSON.parse(fs.readFileSync(conf, "utf8")
  .split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n").replace(/^\uFEFF/, ""));
let n = 0;
for (const p of c.orca_presets || []) {
  if (p.machine === "Z-Mod Flashforge AD5X 0.4 nozzle") {
    p.process = "AD5X Nopoop .4";
    n++;
  }
}
if (!n) throw new Error("Z-Mod preset entry not found");
const out = JSON.stringify(c, null, 2);
fs.writeFileSync(conf, out + "\n# MD5 checksum " +
  crypto.createHash("md5").update(out).digest("hex").toUpperCase() + "\n", "utf8");

console.log("backup:", stash);
console.log("OK");
