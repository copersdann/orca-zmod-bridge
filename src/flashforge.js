/**
 * 3D-домен FlashForge для orca-zmod-bridge.
 * No child process: works directly with local files, installed Flash Studio presets,
 * G-code/STL analysis and a configurable HTTP adapter for AD5X/AD5M printers.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { getFlashforgeSettings, saveFlashforgeSettings, ROOT } from "./registry.js";

const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const FF_DIR = "C:\\Program Files\\Flashforge\\Flash Studio Desktop";
const FF_RESOURCES = path.join(FF_DIR, "resources");
const FF_CONF = path.join(APPDATA, "Orca-Flashforge", "Orca-Flashforge.conf");
const SETTINGS_FILE = path.join(ROOT, "flashforge.settings.json");

function out(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
function err(message) {
  return { content: [{ type: "text", text: `Ошибка: ${message}` }], isError: true };
}
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function mask(value) {
  if (!value) return "";
  const s = String(value);
  return s.length <= 8 ? "***" : `${s.slice(0, 4)}…${s.slice(-3)}`;
}

function readConf() {
  if (!exists(FF_CONF)) return null;
  try {
    const text = fs.readFileSync(FF_CONF, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch { return null; }
}

function readProfiles() {
  const file = path.join(FF_RESOURCES, "profiles", "Flashforge.json");
  if (!exists(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Resolve a profile by exact/fuzzy name or absolute path to a real Orca preset JSON. */
function resolveProfile(kind, value) {
  if (!value) return null;
  if (typeof value === "string" && path.isAbsolute(value) && fs.existsSync(value)) return value;
  const dirs = [
    path.join(FF_RESOURCES, "profiles", "Flashforge", kind),
    path.join(FF_RESOURCES, "profiles", "Custom", kind),
  ];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.toLowerCase().endsWith(".json")) files.push(path.join(dir, f));
  }
  const needle = String(value).toLowerCase();
  const hit = files.find((f) => path.basename(f, ".json").toLowerCase() === needle)
    ?? files.find((f) => path.basename(f, ".json").toLowerCase().includes(needle));
  if (hit) return hit;
  if (fs.existsSync(value)) return path.resolve(value);
  throw new Error(`Профиль «${value}» не найден в категории ${kind}`);
}

// ---------- STL / OBJ geometry ----------
function meshStats(vertices, faces) {
  let vx = [Infinity, -Infinity], vy = [Infinity, -Infinity], vz = [Infinity, -Infinity];
  for (const [x, y, z] of vertices) {
    vx = [Math.min(vx[0], x), Math.max(vx[1], x)];
    vy = [Math.min(vy[0], y), Math.max(vy[1], y)];
    vz = [Math.min(vz[0], z), Math.max(vz[1], z)];
  }
  let volume = 0;
  const edges = new Map();
  const key = (i) => {
    const [x, y, z] = vertices[i];
    return `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  };
  for (const [a, b, c] of faces) {
    if (a == null || b == null || c == null) continue;
    const p = vertices[a], q = vertices[b], r = vertices[c];
    if (!p || !q || !r) continue;
    const cross = [
      q[1] * r[2] - q[2] * r[1],
      q[2] * r[0] - q[0] * r[2],
      q[0] * r[1] - q[1] * r[0],
    ];
    volume += (p[0] * cross[0] + p[1] * cross[1] + p[2] * cross[2]) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ku = key(u), kv = key(v);
      const k = ku < kv ? `${ku}|${kv}` : `${kv}|${ku}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    triangles: faces.length,
    vertices: vertices.length,
    boundingBoxMm: { x: round(vx[1] - vx[0]), y: round(vy[1] - vy[0]), z: round(vz[1] - vz[0]) },
    min: [round(vx[0]), round(vy[0]), round(vz[0])],
    max: [round(vx[1]), round(vy[1]), round(vz[1])],
    volumeCm3: round(Math.abs(volume) / 1000),
    watertightEstimate: boundary === 0 && nonManifold === 0,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
  };
}

function parseStl(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 84) throw new Error("STL слишком маленький");
  const n = buf.readUInt32LE(80);
  if (buf.length >= 84 + n * 50) {
    const vertices = [], faces = [];
    let off = 84;
    for (let i = 0; i < n; i++) {
      const base = off + 12;
      const tri = [];
      for (let v = 0; v < 3; v++) {
        vertices.push([buf.readFloatLE(base + v * 12), buf.readFloatLE(base + v * 12 + 4), buf.readFloatLE(base + v * 12 + 8)]);
        tri.push(vertices.length - 1);
      }
      faces.push(tri);
      off += 50;
    }
    return meshStats(vertices, faces);
  }
  const text = buf.toString("utf8", 0, Math.min(buf.length, 200 * 1024 * 1024));
  const vertices = [], faces = [];
  const re = /vertex\s+([-+]?[\d.eE]+)\s+([-+]?[\d.eE]+)\s+([-+]?[\d.eE]+)/gi;
  let m;
  while ((m = re.exec(text))) vertices.push([+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < vertices.length; i += 3) faces.push([i, i + 1, i + 2]);
  if (!faces.length) throw new Error("Не удалось разобрать STL (ни binary, ни ASCII)");
  return meshStats(vertices, faces);
}

function parseObj(file) {
  const text = fs.readFileSync(file, "utf8");
  const vertices = [], faces = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const p = line.trim().split(/\s+/);
      if (p.length >= 4) vertices.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith("f ")) {
      const ids = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s.split("/")[0], 10) - 1);
      for (let i = 1; i + 1 < ids.length; i++) faces.push([ids[0], ids[i], ids[i + 1]]);
    }
  }
  if (!faces.length) throw new Error("OBJ не содержит граней");
  return meshStats(vertices, faces);
}

function parse3mf(file) {
  const py = process.env.PYTHON || "python";
  const code = `import trimesh,json,sys
m=trimesh.load(sys.argv[1])
v=m.vertices; f=m.faces
mn=v.min(axis=0); mx=v.max(axis=0)
print(json.dumps({"triangles":len(f),"vertices":len(v),"boundingBoxMm":[round(float(mx[i]-mn[i]),3) for i in range(3)],"volumeCm3":round(float(abs(m.volume)/1000),3),"watertightEstimate":bool(m.is_watertight)}))`;
  try {
    const stdout = execFileSync(py, ["-c", code, file], { encoding: "utf8", timeout: 60000, windowsHide: true });
    return JSON.parse(stdout.trim().split(/\r?\n/).pop());
  } catch (e) {
    throw new Error(`3MF требует python + trimesh (pip install trimesh): ${String(e.message).slice(0, 300)}`);
  }
}

// ---------- G-code ----------
function analyzeGcode(file, maxLines = 4000000) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const meta = {};
  const warnings = [];
  let layers = 0, extrusionMm = 0, lastE = null, travelMm = 0;
  let lastPos = null, minZ = Infinity, maxZ = -Infinity;
  let nozzle = null, bed = null, maxFeed = 0, m73 = null;
  const seen = new Set();
  const header = [];
  const headerKeys = /^(estimated printing time|filament used|layer height|nozzle diameter|filament_type|printer_model|printer_settings_id|total layers|date|generated by)/i;

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(";")) {
      const c = line.slice(1).trim();
      if (headerKeys.test(c) && header.length < 40) header.push(c);
      const idx = c.indexOf("=");
      if (idx > 0) meta[c.slice(0, idx).trim().toLowerCase()] = c.slice(idx + 1).trim();
      if (/layer_change|^layer \d+/i.test(c)) layers++;
      continue;
    }
    if (/^M109|^M104/.test(line)) { const t = line.match(/\bS(\d+(?:\.\d+)?)/); if (t) nozzle = +t[1]; }
    if (/^M190|^M140/.test(line)) { const t = line.match(/\bS(\d+(?:\.\d+)?)/); if (t) bed = +t[1]; }
    if (/^M73/.test(line)) { const t = line.match(/P(\d+)/); if (t) m73 = +t[1]; }
    if (/^G[01]\b/.test(line)) {
      const f = line.match(/\bF(\d+(?:\.\d+)?)/); if (f) maxFeed = Math.max(maxFeed, +f[1]);
      let pos = { ...(lastPos ?? {}) };
      for (const axis of ["X", "Y", "Z", "E"]) {
        const m = line.match(new RegExp(`\\b${axis}(-?\\d+(?:\\.\\d+)?)`));
        if (m) pos[axis] = +m[1];
      }
      if (pos.E != null && lastE != null && pos.E > lastE && pos.X != null && lastPos?.X != null) {
        extrusionMm += pos.E - lastE;
      }
      if (pos.Z != null) { minZ = Math.min(minZ, pos.Z); maxZ = Math.max(maxZ, pos.Z); }
      lastPos = pos;
      lastE = pos.E ?? lastE;
    }
    if (/^M104/.test(line)) seen.add("M104");
    if (/^M109/.test(line)) seen.add("M109");
    if (/^G28/.test(line)) seen.add("G28");
    if (/^M73/.test(line)) seen.add("M73");
  }
  if (!seen.has("G28")) warnings.push("В G-code нет команды G28 (homing) — проверь стартовый блок.");
  if (nozzle == null) warnings.push("Не найдена температура сопла (M104/M109).");
  if (nozzle != null && nozzle > 300) warnings.push(`Температура сопла ${nozzle}°C выше 300°C — проверь материал.`);
  if (bed != null && bed > 130) warnings.push(`Температура стола ${bed}°C выше 130°C.`);
  if (!m73 && !meta["estimated printing time"]) warnings.push("Нет оценки времени печати (M73 / комментарий слайсера).");

  return {
    file,
    lines: lines.length,
    layers,
    estimatedTimeComment: header.find((h) => /estimated printing time/i.test(h)) ?? null,
    filamentComment: header.find((h) => /filament used/i.test(h)) ?? null,
    progressCommandsM73: m73 != null,
    nozzleTempC: nozzle,
    bedTempC: bed,
    maxFeedMmMin: maxFeed,
    extrusionFilamentMm: Math.round(extrusionMm * 10) / 10,
    zRangeMm: [minZ === Infinity ? null : minZ, maxZ === -Infinity ? null : maxZ],
    header,
    warnings,
  };
}

// ---------- printer HTTP adapter ----------
async function printerRequest(settings, endpoint, body, method = "POST") {
  const base = String(settings.printer.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Не задан printer.baseUrl в flashforge.settings.json");
  const pathPart = settings.printer.endpoints?.[endpoint] ?? endpoint;
  const url = base + (String(pathPart).startsWith("/") ? pathPart : "/" + pathPart);
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.printer.authHeader) headers.Authorization = settings.printer.authHeader;
  const res = await fetch(url, {
    method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(settings.printer.timeoutMs || 5000),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 4000); }
  return { url, status: res.status, ok: res.ok, data: parsed };
}

/** Moonraker REST (Klipper/Z-Mod) — basic endpoints used by this adapter. */
async function moonrakerRequest(settings, method, endpoint, payload, multipart = false) {
  const base = String(settings.printer.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Не задан printer.baseUrl");
  const url = base + endpoint;
  const headers = {};
  if (settings.printer.authHeader) headers.Authorization = settings.printer.authHeader;
  let body;
  if (multipart) body = payload;
  else if (payload !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(payload); }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(settings.printer.timeoutMs || 5000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 4000); }
  return { url, status: res.status, ok: res.ok, data };
}

async function localIp() {
  for (const info of Object.values(os.networkInterfaces())) {
    for (const i of info || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

async function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (reachable) => { if (!done) { done = true; socket.destroy(); resolve(reachable); } };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

// ---------- tool definitions ----------
export const tools = [
  {
    name: "environment",
    description: "DIAGNOSTIC: installed Flash Studio/Orca-Flashforge paths, presets counts, slicer CLI candidates, current settings (secrets masked).",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      const conf = readConf();
      const profiles = readProfiles();
      const settings = getFlashforgeSettings();
      const candidates = [
        path.join(FF_DIR, "flash studio.exe"),
        "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe",
        "C:\\Program Files\\PrusaSlicer\\prusa-slicer.exe",
        "C:\\Program Files\\Ultimaker Cura\\Cura.exe",
      ].map((p) => ({ path: p, exists: exists(p) }));
      return out({
        flashStudioDir: FF_DIR,
        flashStudioPresent: exists(FF_DIR),
        config: FF_CONF,
        configPresent: !!conf,
        recentProjects: conf?.recent_projects ? Object.keys(conf.recent_projects).length : 0,
        presets: {
          machineModels: profiles?.machine_model_list?.length ?? 0,
          processes: profiles?.process_list?.length ?? 0,
          filaments: profiles?.filament_list?.length ?? 0,
          ad5Entries: (profiles?.machine_model_list ?? []).filter((m) => /AD5/i.test(m.name)).map((m) => m.name),
        },
        slicerCandidates: candidates,
        configuredSlicer: settings.slicer?.command || null,
        printerBaseUrl: settings.printer?.baseUrl || null,
        authHeader: mask(settings.printer?.authHeader),
        settingsFile: SETTINGS_FILE,
      });
    },
  },
  {
    name: "profiles",
    description: "List Flash Studio machine/process/filament profiles with fuzzy search (Russian/English).",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["machine", "process", "filament", "all"], default: "all" },
        query: { type: "string", description: "Substring, e.g. AD5X, 0.25, PETG" },
        limit: { type: "integer", default: 60, minimum: 1, maximum: 500 },
      },
    },
    async handler({ kind = "all", query = "", limit = 60 } = {}) {
      const profiles = readProfiles();
      if (!profiles) return err("Не найден Flashforge.json в " + FF_RESOURCES);
      const q = String(query).toLowerCase();
      const pick = (list, type) => (list ?? [])
        .filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q))
        .slice(0, limit)
        .map((p) => ({ type, name: p.name, ...(p.sub_path ? { subPath: p.sub_path } : {}) }));
      const result = [];
      if (kind === "all" || kind === "machine") result.push(...pick(profiles.machine_model_list, "machine"));
      if (kind === "all" || kind === "process") result.push(...pick(profiles.process_list, "process"));
      if (kind === "all" || kind === "filament") result.push(...pick(profiles.filament_list, "filament"));
      return out({ query, returned: result.length, profiles: result });
    },
  },
  {
    name: "inspect_model",
    description: "Analyze STL/OBJ/3MF: bounding box, volume, triangle count, watertight estimate, fit against build volume. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to .stl/.obj/.3mf" },
        buildVolume: { type: "string", description: "Optional 'XxYxZ' mm, e.g. 300x300x600" },
      },
      required: ["path"],
    },
    async handler({ path: file, buildVolume } = {}) {
      if (!file || !exists(file)) return err(`Файл не найден: ${file}`);
      const ext = path.extname(file).toLowerCase();
      try {
        let stats;
        if (ext === ".stl") stats = parseStl(file);
        else if (ext === ".obj") stats = parseObj(file);
        else if (ext === ".3mf") stats = parse3mf(file);
        else return err(`Неподдерживаемый формат ${ext} (нужен .stl/.obj/.3mf)`);
        let fit = null;
        if (buildVolume) {
          const [x, y, z] = String(buildVolume).toLowerCase().split("x").map(Number);
          const b = stats.boundingBoxMm;
          fit = { x: b.x <= x, y: b.y <= y, z: b.z <= z, ok: b.x <= x && b.y <= y && b.z <= z };
        }
        return out({ file, ...stats, buildVolumeFit: fit });
      } catch (e) { return err(String(e.message ?? e)); }
    },
  },
  {
    name: "analyze_gcode",
    description: "Parse G-code: layers, time estimate, filament, temperatures, Z range, safety warnings. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxLines: { type: "integer", default: 4000000 },
      },
      required: ["path"],
    },
    async handler({ path: file, maxLines } = {}) {
      if (!file || !exists(file)) return err(`Файл не найден: ${file}`);
      try { return out(analyzeGcode(file, maxLines)); }
      catch (e) { return err(String(e.message ?? e)); }
    },
  },
  {
    name: "slice",
    description: "Slice via OrcaSlicer CLI using Flashforge presets. DRY-RUN by default; needs dryRun:false + confirm:true to execute.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "STL/3MF/OBJ path" },
        outputDir: { type: "string", description: "Directory for .gcode/.3mf (default: next to input)" },
        machineProfile: { type: "string", description: "Machine preset name/path, e.g. 'Flashforge AD5X 0.4 nozzle'" },
        processProfile: { type: "string", description: "Process preset name/path, e.g. '0.20mm Standard @FF AD5X'" },
        filamentProfile: { type: "string", description: "Filament preset name/path, e.g. 'Flashforge PLA Basic @FF AD5X'" },
        layerHeight: { type: "number", description: "Override layer height (mm)" },
        nozzleDiameter: { type: "number", description: "Override nozzle diameter (mm)" },
        plate: { type: "integer", description: "Plate index; 0 = all plates (default 0)" },
        arrange: { type: "boolean", default: false, description: "Auto-arrange objects before slicing" },
        allowRotations: { type: "boolean", default: false, description: "Allow rotation while arranging" },
        exportStatistics: { type: "boolean", default: false, description: "Write plate_N.statistics.json" },
        extraArgs: { type: "array", items: { type: "string" }, description: "Extra Orca CLI flags, e.g. ['--allow-rotations']" },
        dryRun: { type: "boolean", default: true },
        confirm: { type: "boolean", default: false, description: "Must be true with dryRun:false to actually slice" },
      },
      required: ["input"],
    },
    async handler(args = {}) {
      const {
        input, outputDir, machineProfile, processProfile, filamentProfile,
        layerHeight, nozzleDiameter, extraArgs, dryRun = true, confirm = false,
        output, profile,
        plate = 0, arrange = false, allowRotations = false, exportStatistics = false,
      } = args;
      if (!input || !exists(input)) return err(`Файл не найден: ${input}`);
      const s = getFlashforgeSettings();
      const command = s.slicer?.command;
      if (!command) {
        return out({ status: "slicer_not_configured", hint: "Запиши slicer.command через flashforge.configure (например C:\\Program Files\\OrcaSlicer\\orca-slicer.exe)." });
      }
      try {
        const dir = outputDir || (output ? path.dirname(output) : path.dirname(input));
        const base = path.basename(input, path.extname(input));
        const machine = resolveProfile("machine", machineProfile || s.slicer?.defaultMachine);
        const processPreset = resolveProfile("process", processProfile || profile || s.slicer?.defaultProcess);
        const filament = resolveProfile("filament", filamentProfile || s.slicer?.defaultFilament);
        const settings = [machine, processPreset].filter(Boolean).join(";");
        const argv = [input];
        if (settings) argv.push("--load-settings", settings);
        if (filament) argv.push("--load-filaments", filament);
        argv.push("--slice", String(plate), "--outputdir", dir, "--export-3mf", base + ".3mf");
        if (arrange) argv.push("--arrange", "1");
        if (allowRotations) argv.push("--allow-rotations");
        if (exportStatistics) argv.push("--export-statistics");
        if (layerHeight) argv.push("--layer-height", String(layerHeight));
        if (nozzleDiameter) argv.push("--nozzle-diameter", String(nozzleDiameter));
        argv.push(...(extraArgs ?? []));
        const display = [command, ...argv].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
        if (dryRun || !confirm) {
          return out({
            status: "dry_run", command, argv, display, outputDir: dir,
            profiles: { machine, process: processPreset, filament },
            note: "Ничего не выполнено. Вызови с dryRun:false + confirm:true для реального слайсинга.",
          });
        }
        fs.mkdirSync(dir, { recursive: true });
        const r = spawnSync(command, argv, {
          encoding: "utf8", timeout: 600000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        });
        if (r.status !== 0) {
          return err(`Слайсер завершился с кодом ${r.status}: ${String(r.stderr || r.stdout || r.error || "").slice(0, 2000)}`);
        }
        const allFiles = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        const stats = allFiles.filter((f) => f.endsWith(".statistics.json")).map((f) => {
          try { return { file: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }; }
          catch { return { file: f, error: "не удалось разобрать JSON" }; }
        });
        return out({
          status: "ok", outputDir: dir,
          files: allFiles.filter((f) => /\.gcode$|\.3mf$/.test(f)),
          statistics: stats,
          stdoutTail: String(r.stdout ?? "").slice(-2000),
          stderrTail: String(r.stderr ?? "").slice(-2000),
        });
      } catch (e) { return err(String(e.message ?? e)); }
    },
  },
  {
    name: "printer",
    description: "Generic HTTP adapter for FlashForge AD5X/AD5M LAN API: status/gcode/upload/print/pause/resume/cancel/files/camera. Mutating actions require confirm:true.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "gcode", "upload", "print", "pause", "resume", "cancel", "files", "camera"] },
        host: { type: "string", description: "Optional base URL override, e.g. http://192.168.1.50" },
        command: { type: "string", description: "Raw G-code for action=gcode" },
        file: { type: "string", description: "Local file path for upload/print" },
        params: { type: "object", description: "Extra JSON fields" },
        confirm: { type: "boolean", default: false },
      },
      required: ["action"],
    },
    async handler({ action, host, command, file, params, confirm = false } = {}) {
      const s = getFlashforgeSettings();
      if (host) s.printer.baseUrl = host;
      if (!s.printer.baseUrl) {
        return out({ status: "not_configured", hint: "Укажи printer.baseUrl в flashforge.settings.json или передай host. Сначала найди принтер через flashforge.printer_probe." });
      }
      const mutating = ["gcode", "upload", "print", "pause", "resume", "cancel"].includes(action);
      const isMoonraker = s.printer.protocol === "moonraker" || String(s.printer.baseUrl).includes(":7125");

      if (isMoonraker) {
        const preview = { status: "dry_run", protocol: "moonraker", action, note: "Действие не выполнено. Укажи confirm:true." };
        if (action === "gcode") {
          if (!command) return err("Для action=gcode нужен параметр command");
          if (!confirm) return out({ ...preview, script: command });
          try {
            const res = await moonrakerRequest(s, "POST", "/printer/gcode/script", { script: command });
            return out({ status: res.ok ? "ok" : "error", ...res });
          } catch (e) { return err(String(e.message ?? e)); }
        }
        if (action === "upload" || action === "print") {
          if (!file || !exists(file)) return err(`Для ${action} нужен существующий файл: ${file}`);
          const filename = path.basename(file);
          if (!confirm) return out({ ...preview, filename, bytes: fs.statSync(file).size });
          try {
            const form = new FormData();
            form.append("file", new Blob([fs.readFileSync(file)]), filename);
            form.append("root", "gcodes");
            const uploaded = await moonrakerRequest(s, "POST", "/server/files/upload", form, true);
            if (!uploaded.ok) return out({ status: "error", stage: "upload", ...uploaded });
            if (action === "upload") return out({ status: "ok", stage: "upload", ...uploaded });
            const started = await moonrakerRequest(s, "POST", "/printer/print/start", { filename });
            return out({ status: started.ok ? "ok" : "error", stage: "print", uploaded, started });
          } catch (e) { return err(String(e.message ?? e)); }
        }
        if (mutating && !confirm) return out(preview);
        try {
          if (action === "status") {
            const info = await moonrakerRequest(s, "GET", "/printer/info");
            const query = await moonrakerRequest(s, "GET", "/printer/objects/query?print_stats&toolhead&extruder&heater_bed&gcode_move");
            if (!info.ok || !query.ok) return out({ status: "error", info, query });
            const st = query.data?.result?.status ?? {};
            return out({
              status: "ok", protocol: "moonraker",
              printer: { state: info.data?.result?.state, message: info.data?.result?.state_message, hostname: info.data?.result?.hostname },
              print: st.print_stats ?? null,
              toolhead: st.toolhead ? { position: st.toolhead.position, homed_axes: st.toolhead.homed_axes, max_velocity: st.toolhead.max_velocity } : null,
              temperatures: {
                nozzle: st.extruder ? { actual: st.extruder.temperature, target: st.extruder.target } : null,
                bed: st.heater_bed ? { actual: st.heater_bed.temperature, target: st.heater_bed.target } : null,
              },
            });
          }
          if (action === "files") {
            const res = await moonrakerRequest(s, "GET", "/server/files/list?dir=gcodes");
            return out({ status: res.ok ? "ok" : "error", ...res });
          }
          if (action === "pause" || action === "resume" || action === "cancel") {
            const res = await moonrakerRequest(s, "POST", `/printer/print/${action}`);
            return out({ status: res.ok ? "ok" : "error", ...res });
          }
          if (action === "camera") {
            const res = await fetch(String(s.printer.baseUrl).replace(/:7125$/, "") + "/webcam/?action=snapshot", {
              signal: AbortSignal.timeout(s.printer.timeoutMs || 5000),
            });
            if (!res.ok) return out({ status: "error", hint: "Камера не отдаёт снимок. Проверь CAMERA_ON VIDEO=video3 и разрешение.", httpStatus: res.status });
            const dir = path.join(ROOT, "camera");
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(dir, `camera-${Date.now()}.jpg`);
            fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
            return out({ status: "ok", savedTo: target });
          }
          return err(`Неизвестное действие ${action}`);
        } catch (e) { return err(String(e.message ?? e)); }
      }

      // Generic FlashForge HTTP adapter (legacy)
      let body = params ? { ...params } : {};
      const endpoint = action;
      if (action === "gcode") {
        if (!command) return err("Для action=gcode нужен параметр command");
        body.command = command;
      }
      if (action === "upload" || action === "print") {
        if (!file || !exists(file)) return err(`Для ${action} нужен существующий файл: ${file}`);
        body.filename = path.basename(file);
        body.content = fs.readFileSync(file).toString("utf8").slice(0, 8 * 1024 * 1024);
      }
      if (mutating && !confirm) {
        return out({ status: "dry_run", action, endpoint, bodyKeys: Object.keys(body), note: "Действие не выполнено. Укажи confirm:true." });
      }
      try {
        if (action === "camera" && !confirm) {
          return out({ status: "dry_run", action, note: "Для получения снимка камеры укажи confirm:true." });
        }
        const res = await printerRequest(s, endpoint, Object.keys(body).length ? body : undefined, action === "status" || action === "files" || action === "camera" ? "GET" : "POST");
        if (action === "camera" && res.ok && typeof res.data === "string") {
          const dir = path.join(ROOT, "camera");
          fs.mkdirSync(dir, { recursive: true });
          const target = path.join(dir, `camera-${Date.now()}.jpg`);
          fs.writeFileSync(target, Buffer.from(res.data, "base64"));
          return out({ ...res, savedTo: target });
        }
        return out({ status: "ok", ...res });
      } catch (e) { return err(String(e.message ?? e)); }
    },
  },
  {
    name: "printer_probe",
    description: "Scan local /24 subnet for a FlashForge printer on common HTTP ports. Read-only network probe.",
    inputSchema: {
      type: "object",
      properties: {
        subnet: { type: "string", description: "First 3 octets, e.g. 192.168.1 (auto by default)" },
        ports: { type: "array", items: { type: "integer" }, default: [80, 8080, 8899, 8000] },
        timeoutMs: { type: "integer", default: 500 },
        limit: { type: "integer", default: 254 },
      },
    },
    async handler({ subnet, ports = [80, 8080, 8899, 8000], timeoutMs = 500, limit = 254 } = {}) {
      const ip = await localIp();
      const base = subnet || (ip ? ip.split(".").slice(0, 3).join(".") : null);
      if (!base) return err("Не удалось определить локальную подсеть — укажи subnet.");
      const hosts = Array.from({ length: Math.min(limit, 254) }, (_, i) => `${base}.${i + 1}`);
      const queue = [];
      for (const h of hosts) for (const p of ports) queue.push([h, p]);
      const found = [];
      let cursor = 0;
      const workers = Array.from({ length: 24 }, async () => {
        while (cursor < queue.length) {
          const [host, port] = queue[cursor++];
          if (await probePort(host, port, timeoutMs)) found.push({ host, port });
        }
      });
      await Promise.all(workers);
      return out({ localIp: ip, subnet: base, scanned: queue.length, found });
    },
  },
  {
    name: "configure",
    description: "Set slicer/printer adapter settings (persisted in flashforge.settings.json). Never stores secrets unless passed explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        patch: { type: "object", description: "Partial settings object, e.g. {\"printer\":{\"baseUrl\":\"http://192.168.1.50\"}}" },
      },
      required: ["patch"],
    },
    async handler({ patch } = {}) {
      if (!patch || typeof patch !== "object") return err("Нужен объект patch");
      const s = getFlashforgeSettings();
      const merged = {
        ...s,
        slicer: { ...(s.slicer ?? {}), ...(patch.slicer ?? {}) },
        printer: {
          ...(s.printer ?? {}), ...(patch.printer ?? {}),
          endpoints: { ...(s.printer?.endpoints ?? {}), ...(patch.printer?.endpoints ?? {}) },
        },
      };
      saveFlashforgeSettings(merged);
      return out({ status: "saved", file: SETTINGS_FILE, slicerCommand: merged.slicer?.command || null, printerBaseUrl: merged.printer?.baseUrl || null });
    },
  },
];
