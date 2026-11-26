#!/usr/bin/env node
/** Usage: node scripts/clean-3mf.mjs "C:\path\model.3mf" [output.3mf] */
import { execFileSync } from "node:child_process";
const PY = `import zipfile, json, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    names = z.namelist()
    keep = [n for n in names if n.startswith("3D/") or n in ("[Content_Types].xml", "_rels/.rels") or n.startswith("Metadata/thumbnail")]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as o:
        for n in keep: o.writestr(n, z.read(n))
print(json.dumps({"kept": len(keep), "dropped": [n for n in names if n not in keep]}))`;
const [src, dst] = process.argv.slice(2);
if (!src) { console.error("usage: node clean-3mf.mjs <input.3mf> [output.3mf]"); process.exit(1); }
const out = dst || src.replace(/\.3mf$/i, ".clean.3mf");
const res = execFileSync("python", ["-c", PY, src, out], { encoding: "utf8" });
console.log("output:", out);
console.log(res.trim());
