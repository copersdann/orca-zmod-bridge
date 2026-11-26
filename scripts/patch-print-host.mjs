import fs from "node:fs";
const p = "C:\\Users\\Admin\\AppData\\Roaming\\OrcaSlicer\\user\\default\\machine\\Z-Mod Flashforge AD5X 0.4 nozzle.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.print_host = "192.168.1.183";
j.print_host_webui = "http://192.168.1.183";
fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8");
console.log("print_host:", j.print_host, "webui:", j.print_host_webui);
