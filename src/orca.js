/**
 * OrcaSlicer-specific built-in MCP domain: installation info, presets, 3MF projects,
 * slicing statistics and plugin event logs. Read-only unless explicitly configured.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { ROOT, getFlashforgeSettings } from "./registry.js";

const ORCA_DIR = "C:\\Program Files\\OrcaSlicer";
const FF_DIR = "C:\\Program Files\\Flashforge\\Flash Studio Desktop";
const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const PLUGIN_DIR = path.join(APPDATA, "OrcaSlicer", "orca_plugins");
const EVENTS_FILE = path.join(ROOT, "reports", "plugin-events.jsonl");

function out(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(message) {
  return { content: [{ type: "text", text: `Ошибка: ${message}` }], isError: true };
}
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function profileFiles(source) {
  const roots = [];
  if (source === "orca" || source === "all") roots.push(path.join(ORCA_DIR, "resources", "profiles"));
  if (source === "flashforge" || source === "all") roots.push(path.join(FF_DIR, "resources", "profiles", "Flashforge"));
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let dirs;
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().endsWith(".json")) files.push({ source: root.includes("Flashforge") ? "flashforge" : "orca", kind: d.name, name: path.basename(f, ".json"), path: path.join(dir, f) });
      }
    }
  }
  return files;
}

const PY_3MF = `import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
result = {"entries": len(names), "files": names[:60], "plates": [n for n in names if n.startswith("Metadata/plate_") and n.endswith(".json")], "hasGcode": any(n.endswith(".gcode") or n.endswith(".gco") for n in names)}
for key in ["Metadata/project_settings.config", "Metadata/model_settings.config", "Metadata/slice_info.config", "Metadata/filament_sequence.json"]:
    if key in names:
        raw = z.read(key).decode("utf-8", "replace")
        try:
            result[key] = json.loads(raw)
        except Exception:
            result[key] = raw[:4000]
print(json.dumps(result))
`;

const PY_CLEAN_3MF = `import zipfile, json, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    names = z.namelist()
    keep = [n for n in names if n.startswith("3D/") or n in ("[Content_Types].xml", "_rels/.rels") or n.startswith("Metadata/thumbnail")]
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as o:
        for n in keep:
            o.writestr(n, z.read(n))
    dropped = [n for n in names if n not in keep]
print(json.dumps({"kept": keep, "dropped": dropped[:40], "droppedCount": len(dropped)}))
`;

export const tools = [
  {
    name: "clean_project",
    description: "Strip embedded printer/process/filament settings from a 3MF, keeping geometry and thumbnails. Output is safe to open with the current Z-Mod presets.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Source .3mf with foreign presets" },
        output: { type: "string", description: "Cleaned .3mf path (default: <name>.clean.3mf)" },
      },
      required: ["path"],
    },
    async handler({ path: file, output } = {}) {
      if (!file || !exists(file)) return err(`Файл не найден: ${file}`);
      const target = output || path.join(path.dirname(file), path.basename(file, ".3mf") + ".clean.3mf");
      try {
        const py = process.env.PYTHON || "python";
        const stdout = execFileSync(py, ["-c", PY_CLEAN_3MF, file, target], {
          encoding: "utf8", timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
        });
        return out({ status: "ok", source: file, output: target, ...JSON.parse(stdout.trim().split(/\r?\n/).pop()) });
      } catch (e) { return err(String(e.message ?? e).slice(0, 1000)); }
    },
  },
  {
    name: "info",
    description: "Installed OrcaSlicer/Flash Studio details, versions, preset counts, installed plugins and sidecar status. Read-only.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const settings = getFlashforgeSettings();
      const plugins = [];
      if (fs.existsSync(PLUGIN_DIR)) {
        for (const d of fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
          if (!d.isDirectory() || d.name.startsWith(".")) continue;
          const dir = path.join(PLUGIN_DIR, d.name);
          const files = fs.readdirSync(dir).filter((f) => f.endsWith(".py") || f.endsWith(".whl"));
          let version = null;
          for (const f of files.filter((x) => x.endsWith(".py"))) {
            const text = fs.readFileSync(path.join(dir, f), "utf8");
            const m = text.match(/version\s*=\s*"([^"]+)"/);
            if (m) version = m[1];
          }
          plugins.push({ name: d.name, files, version });
        }
      }
      const versionFile = path.join(ORCA_DIR, "resources", "version.txt");
      return out({
        orcaDir: ORCA_DIR,
        orcaPresent: exists(ORCA_DIR),
        orcaExe: exists(path.join(ORCA_DIR, "orca-slicer.exe")),
        version: exists(versionFile) ? fs.readFileSync(versionFile, "utf8").trim().slice(0, 120) : null,
        flashStudioDir: FF_DIR,
        flashStudioPresent: exists(FF_DIR),
        presets: {
          orca: profileFiles("orca").length,
          flashforge: profileFiles("flashforge").length,
        },
        pluginsDir: PLUGIN_DIR,
        plugins,
        slicerCommand: settings.slicer?.command || null,
        sidecar: `http://127.0.0.1:${process.env.MCP_HUB_HTTP_PORT || 8765}`,
        eventsFile: EVENTS_FILE,
        eventsPresent: exists(EVENTS_FILE),
      });
    },
  },
  {
    name: "presets",
    description: "Search OrcaSlicer and Flashforge preset JSON files by kind/name. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "machine/process/filament or a directory name" },
        query: { type: "string", description: "Substring in preset name" },
        source: { type: "string", enum: ["all", "orca", "flashforge"], default: "all" },
        limit: { type: "integer", default: 50, minimum: 1, maximum: 300 },
      },
    },
    async handler({ kind, query = "", source = "all", limit = 50 } = {}) {
      const q = String(query).toLowerCase();
      const items = profileFiles(source).filter((f) =>
        (!kind || f.kind.toLowerCase() === String(kind).toLowerCase()) &&
        (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)),
      ).slice(0, limit);
      return out({ returned: items.length, presets: items });
    },
  },
  {
    name: "project",
    description: "Inspect an OrcaSlicer 3MF project: plates, embedded settings, models, thumbnails. Read-only.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute path to .3mf" } },
      required: ["path"],
    },
    async handler({ path: file } = {}) {
      if (!file || !exists(file)) return err(`Файл не найден: ${file}`);
      try {
        const py = process.env.PYTHON || "python";
        const stdout = execFileSync(py, ["-c", PY_3MF, file], {
          encoding: "utf8", timeout: 60000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        });
        return out(JSON.parse(stdout.trim().split(/\r?\n/).pop()));
      } catch (e) { return err(String(e.message ?? e).slice(0, 1000)); }
    },
  },
  {
    name: "slice_stats",
    description: "Read plate_N.statistics.json produced by --export-statistics and summarize print time/material. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Output directory from slicing" },
        limit: { type: "integer", default: 10 },
      },
      required: ["directory"],
    },
    async handler({ directory, limit = 10 } = {}) {
      if (!directory || !fs.existsSync(directory)) return err(`Папка не найдена: ${directory}`);
      const files = fs.readdirSync(directory).filter((f) => f.endsWith(".statistics.json")).slice(0, limit);
      const stats = files.map((f) => {
        try { return { file: f, data: JSON.parse(fs.readFileSync(path.join(directory, f), "utf8")) }; }
        catch (e) { return { file: f, error: String(e.message) }; }
      });
      return out({ directory, files: files.length, stats });
    },
  },
  {
    name: "plugin_events",
    description: "Read lifecycle events logged by the OrcaSlicer MCP Hub Bridge plugin. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 30, minimum: 1, maximum: 500 },
        event: { type: "string", description: "Filter by event name, e.g. GCodeExportFinished" },
      },
    },
    async handler({ limit = 30, event } = {}) {
      if (!exists(EVENTS_FILE)) return out({ events: [], note: "Журнал событий пока пуст." });
      let events = fs.readFileSync(EVENTS_FILE, "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
      if (event) events = events.filter((e) => String(e.event ?? "").toLowerCase().includes(String(event).toLowerCase()));
      events = events.slice(-limit);
      return out({ returned: events.length, events });
    },
  },
];
