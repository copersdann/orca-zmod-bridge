import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const p = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer", "user", "default", "machine", "Z-Mod Flashforge AD5X 0.4 nozzle.json");
const j = JSON.parse(fs.readFileSync(p, "utf8"));
console.log("before use_3mf:", j.use_3mf);
j.use_3mf = 0;
fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8");
console.log("after use_3mf:", j.use_3mf);
