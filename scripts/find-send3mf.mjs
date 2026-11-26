import fs from "node:fs";
const text = fs.readFileSync("C:\\Program Files\\OrcaSlicer\\OrcaSlicer.dll").toString("latin1");
for (const n of ["sends the sliced file as", "instead of a plain", "use_3mf", "send_3mf"]) {
  let i = text.indexOf(n);
  console.log("\n###", n, i);
  if (i >= 0) console.log(text.slice(Math.max(0, i - 350), i + 350).replace(/[^\x20-\x7e]/g, "."));
}
