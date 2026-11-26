import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
const app = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");

// printer preset -> FlashForge host (ORCA_FF emulator on the printer)
const mp = path.join(app, "user", "default", "machine", "Z-Mod Flashforge AD5X 0.4 nozzle.json");
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
m.host_type = "flashforge";
m.print_host = "192.168.1.183";
m.print_host_webui = "http://192.168.1.183";
m.flashforge_serial_number = "zmod";
m.printer_agent = "";
m.use_3mf = 0;
fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");

// app config -> classic host, local machine registered with zmod credentials
const cp = path.join(app, "OrcaSlicer.conf");
const raw = fs.readFileSync(cp, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
const c = JSON.parse(raw.replace(/^\uFEFF/, ""));
c.app.use_printer_agents = false;
c.app.installed_networking = true;
c.app.hide_plugin_permission_tip = "1";
const ip = "192.168.1.183";
c.local_machines[ip] = {
  access_code: "zmod",
  dev_ip: ip,
  dev_name: ip,
  printer_agent_id: "orca",
  printer_type: "Flashforge AD5X",
  nozzle_diameter_str: "0.4",
  nozzle_diameter: 0.4,
};
c.last_selected_machine = { ...(c.last_selected_machine ?? {}), orca: ip };
const out = JSON.stringify(c, null, 2);
fs.writeFileSync(cp, out + "\n# MD5 checksum " + crypto.createHash("md5").update(out).digest("hex").toUpperCase() + "\n", "utf8");
console.log("host_type:", m.host_type, "serial:", m.flashforge_serial_number, "agent:", c.app.use_printer_agents);
