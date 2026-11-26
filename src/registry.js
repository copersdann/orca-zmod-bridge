import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_FILE = path.join(ROOT, "flashforge.settings.json");

export function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { return fallback; }
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const DEFAULTS = {
  slicer: {
    command: "",
    defaultMachine: "Z-Mod Flashforge AD5X 0.4 nozzle",
    defaultProcess: "AD5X Nopoop .4",
    defaultFilament: "Flashforge PLA Basic @FF AD5X",
  },
  spoolman: { baseUrl: "http://127.0.0.1:7912" },
  notifications: { webhookUrl: "" },
  printer: {
    baseUrl: "http://192.168.1.183:7125",
    protocol: "moonraker",
    timeoutMs: 8000,
    authHeader: "",
    endpoints: {
      status: "/printer/info",
      gcode: "/printer/gcode/script",
      upload: "/server/files/upload",
      print: "/printer/print/start",
      pause: "/printer/print/pause",
      resume: "/printer/print/resume",
      cancel: "/printer/print/cancel",
      files: "/server/files/list",
      camera: "/webcam/?action=snapshot",
    },
  },
};

export function getFlashforgeSettings() {
  const stored = readJson(SETTINGS_FILE, {}) || {};
  return {
    ...DEFAULTS,
    ...stored,
    slicer: { ...DEFAULTS.slicer, ...(stored.slicer ?? {}) },
    spoolman: { ...DEFAULTS.spoolman, ...(stored.spoolman ?? {}) },
    notifications: { ...DEFAULTS.notifications, ...(stored.notifications ?? {}) },
    printer: {
      ...DEFAULTS.printer,
      ...(stored.printer ?? {}),
      endpoints: { ...DEFAULTS.printer.endpoints, ...(stored.printer?.endpoints ?? {}) },
    },
  };
}

export function saveFlashforgeSettings(settings) {
  writeJson(SETTINGS_FILE, settings);
  return settings;
}
