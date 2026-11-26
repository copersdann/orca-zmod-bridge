/**
 * Clean OrcaSlicer user data from experimental debris.
 * Backups are moved OUT of %APPDATA%\OrcaSlicer into C:\tools\orca-zmod-mcp\backups
 * so nothing is lost, but Orca's own folder stays clean.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.join(os.homedir(), "AppData", "Roaming", "OrcaSlicer");
const stash = path.join("C:", "tools", "orca-zmod-mcp", "backups", "orca-cleanup-" +
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(stash, { recursive: true });

function moveOut(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  const dst = path.join(stash, rel.replace(/[\\/]/g, "_"));
  fs.renameSync(src, dst);
  console.log("moved out:", rel);
}
function clearDir(rel, keepCount = 0) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return;
  let items = fs.readdirSync(dir).map((n) => ({
    n, p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs,
  }));
  if (keepCount > 0) items.sort((a, b) => b.t - a.t).slice(keepCount).forEach((i) => {
    if (fs.statSync(i.p).isFile()) fs.unlinkSync(i.p);
    else fs.rmSync(i.p, { recursive: true, force: true });
  });
  else items.forEach((i) => {
    if (fs.statSync(i.p).isFile()) fs.unlinkSync(i.p);
    else fs.rmSync(i.p, { recursive: true, force: true });
  });
  console.log("cleaned dir:", rel, "(" + items.length + " items, kept", keepCount + ")");
}

// --- experiment / install backups (moved out, not deleted) ---
for (const d of fs.readdirSync(root)) {
  if (/^backup-orca-repair-|^user_backup-v/.test(d)) moveOut(d);
}
for (const f of ["OrcaSlicer.conf.bak", "OrcaSlicer.conf.zmod-backup"]) moveOut(f);

// --- stale locks (Orca must be closed) ---
for (const f of ["OrcaSlicer.conf.lock", "user.lock"]) moveOut(f);

// --- logs: keep 3 most recent ---
clearDir("log", 3);

// --- caches ---
clearDir("cache");
clearDir("ota");

console.log("stash:", stash);
console.log("OK");
