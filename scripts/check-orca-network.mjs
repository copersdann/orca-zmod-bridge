import fs from "node:fs";
import path from "node:path";
const raw = fs.readFileSync(path.join(process.env.APPDATA, "OrcaSlicer", "OrcaSlicer.conf"), "utf8")
  .split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
const c = JSON.parse(raw.replace(/^\uFEFF/, ""));
for (const k of Object.keys(c.app)) {
  if (/cloud|network|plugin|install|agent|iot/i.test(k)) console.log(k, "=", JSON.stringify(c.app[k]));
}
