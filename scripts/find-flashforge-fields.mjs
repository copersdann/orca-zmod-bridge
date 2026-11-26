import fs from "node:fs";
const t = fs.readFileSync("C:\\Program Files\\OrcaSlicer\\OrcaSlicer.dll").toString("latin1");
for (const n of ["flashforge_serial_number", "access_code", "printhost_apikey", "Flashforge local API requires"]) {
  const i = t.indexOf(n);
  console.log("\n###", n, i);
  if (i >= 0) console.log(t.slice(Math.max(0, i - 220), i + 260).replace(/[^\x20-\x7e]/g, "."));
}
