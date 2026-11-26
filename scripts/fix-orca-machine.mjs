/**
 * Repair OrcaSlicer config after the failed ORCA_FF experiment.
 * - Remove the leftover "Flashforge AD5X 0.4 nozzle - Копировать" preset (host_type=flashforge)
 * - Select the real Z-Mod preset
 * - Fix use_3mf JSON type (must be a string, not a number)
 * - Keep local agent = moonraker
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const root = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");
const confPath = path.join(root, "OrcaSlicer.conf");
const machineDir = path.join(root, "user", "default", "machine");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(root, "backup-orca-repair-" + stamp);
fs.mkdirSync(backup, { recursive: true });

const ZMOD = "Z-Mod Flashforge AD5X 0.4 nozzle";
const JUNK = "Flashforge AD5X 0.4 nozzle - Копировать";

// --- backup ---
for (const f of fs.readdirSync(machineDir)) {
  fs.copyFileSync(path.join(machineDir, f), path.join(backup, f));
}
fs.copyFileSync(confPath, path.join(backup, "OrcaSlicer.conf"));
console.log("backup:", backup);

// --- 1. fix use_3mf type in Z-Mod machine preset ---
const zmPath = path.join(machineDir, ZMOD + ".json");
const zm = JSON.parse(fs.readFileSync(zmPath, "utf8"));
console.log("use_3mf before:", JSON.stringify(zm.use_3mf), typeof zm.use_3mf);
zm.use_3mf = "0";
fs.writeFileSync(zmPath, JSON.stringify(zm, null, 2) + "\n");
console.log("use_3mf after :", JSON.stringify(zm.use_3mf), typeof zm.use_3mf);

// --- 2. remove leftover flashforge preset files ---
let removed = [];
for (const f of fs.readdirSync(machineDir)) {
  if (f.startsWith(ZMOD)) continue;
  const full = path.join(machineDir, f);
  let isJunk = false;
  if (f.endsWith(".json")) {
    try {
      const j = JSON.parse(fs.readFileSync(full, "utf8"));
      isJunk = j.host_type === "flashforge" || (j.flashforge_serial_number || "").length > 0;
    } catch { isJunk = true; }
  } else if (f.endsWith(".info")) {
    isJunk = true;
  }
  if (isJunk) {
    fs.renameSync(full, path.join(backup, "REMOVED_" + f));
    removed.push(f);
  }
}
console.log("removed leftover presets:", removed);

// --- 3. repair config ---
const raw = fs.readFileSync(confPath, "utf8")
  .split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
const c = JSON.parse(raw.replace(/^\uFEFF/, ""));

console.log("machine before:", c.presets && c.presets.machine);
c.presets = c.presets || {};
c.presets.machine = ZMOD;

if (Array.isArray(c.orca_presets)) {
  const before = c.orca_presets.length;
  c.orca_presets = c.orca_presets.filter((p) => p.machine !== JUNK);
  console.log("orca_presets:", before, "->", c.orca_presets.length);
}

c.app = c.app || {};
c.app.use_printer_agents = true;
c.app.installed_networking = true;
c.app.hide_plugin_permission_tip = "1";
c.app.network_plugin_version = "02.08.04";
if (!c.app.cloud_providers) c.app.cloud_providers = "orca";

c.last_selected_machine = { moonraker: "192.168.1.183", orca: "192.168.1.183" };
if (c.local_machines && c.local_machines["192.168.1.183"]) {
  c.local_machines["192.168.1.183"].printer_agent_id = "moonraker";
}

const out = JSON.stringify(c, null, 2);
fs.writeFileSync(
  confPath,
  out + "\n# MD5 checksum " + crypto.createHash("md5").update(out).digest("hex").toUpperCase() + "\n",
  "utf8"
);
console.log("machine after :", c.presets.machine);
console.log("agent         :", c.local_machines["192.168.1.183"].printer_agent_id);
console.log("OK");
