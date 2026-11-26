import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
const app = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");

// 1) machine preset: select Moonraker agent explicitly
const mp = path.join(app, "user", "default", "machine", "Z-Mod Flashforge AD5X 0.4 nozzle.json");
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
m.printer_agent = "moonraker";
m.host_type = "octoprint";
m.print_host = "192.168.1.183";
m.print_host_webui = "http://192.168.1.183";
fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");

// 2) app config: agents on, local machine registered under moonraker
const cp = path.join(app, "OrcaSlicer.conf");
const raw = fs.readFileSync(cp, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
const c = JSON.parse(raw.replace(/^\uFEFF/, ""));
c.app.use_printer_agents = true;
c.app.installed_networking = true;
c.app.hide_plugin_permission_tip = "1";
c.local_machines = c.local_machines ?? {};
const ip = "192.168.1.183";
c.local_machines[ip] = {
  access_code: "88888888",
  dev_ip: ip,
  dev_name: ip,
  printer_agent_id: "moonraker",
  printer_type: "Flashforge AD5X",
};
c.last_selected_machine = { ...(c.last_selected_machine ?? {}), orca: ip };
const out = JSON.stringify(c, null, 2);
fs.writeFileSync(cp, out + "\n# MD5 checksum " + crypto.createHash("md5").update(out).digest("hex").toUpperCase() + "\n", "utf8");
console.log("printer_agent:", m.printer_agent, "use_printer_agents:", c.app.use_printer_agents, "agent:", c.local_machines[ip].printer_agent_id);
