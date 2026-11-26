/** Switch the active process preset for the Z-Mod machine to AD5X Nopoop .4. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const root = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");
const conf = path.join(root, "OrcaSlicer.conf");
const stash = path.join("C:", "tools", "orca-zmod-mcp", "backups",
  "orca-process-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(stash, { recursive: true });
fs.copyFileSync(conf, path.join(stash, "OrcaSlicer.conf"));

const raw = fs.readFileSync(conf, "utf8")
  .split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
const c = JSON.parse(raw.replace(/^\uFEFF/, ""));

let hit = 0;
for (const p of c.orca_presets || []) {
  if (p.machine === "Z-Mod Flashforge AD5X 0.4 nozzle") {
    console.log("process before:", p.process);
    p.process = "AD5X Nopoop .4";
    console.log("process after :", p.process);
    hit++;
  }
}
if (!hit) throw new Error("Z-Mod preset entry not found in orca_presets");

const out = JSON.stringify(c, null, 2);
fs.writeFileSync(conf, out + "\n# MD5 checksum " +
  crypto.createHash("md5").update(out).digest("hex").toUpperCase() + "\n", "utf8");
console.log("backup:", stash);
