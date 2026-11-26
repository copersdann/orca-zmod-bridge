import fs from "node:fs";
const t = fs.readFileSync("C:\\Program Files\\OrcaSlicer\\OrcaSlicer.dll").toString("latin1");
for (const n of ["network_plugin_version", "m_networking_compatible", "02.08.04", "01.10.01.01"]) {
  const i = t.indexOf(n);
  console.log("\n###", n, i);
  if (i >= 0) console.log(t.slice(Math.max(0, i - 350), i + 450).replace(/[^\x20-\x7e]/g, "."));
}
