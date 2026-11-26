/** Minimal tool dispatcher for the standalone Orca/Z-Mod sidecar. No MCP hub, no 3rd-party servers. */
import fs from "node:fs";
import path from "node:path";
import * as flashforge from "./flashforge.js";
import * as orca from "./orca.js";
import { ROOT, getFlashforgeSettings } from "./registry.js";

function parseName(name) {
  if (typeof name !== "string") return { server: "", tool: "" };
  if (name.includes(".")) {
    const i = name.indexOf(".");
    return { server: name.slice(0, i), tool: name.slice(i + 1) };
  }
  return { server: "", tool: name };
}

export class MiniBridge {
  constructor() {
    this.tools = [
      ...flashforge.tools.map((t) => ({ ...t, owner: "flashforge", fullName: `flashforge__${t.name}` })),
      ...orca.tools.map((t) => ({ ...t, owner: "orca", fullName: `orca__${t.name}` })),
    ];
  }

  async callTool(name, args = {}) {
    const { server, tool } = parseName(name);
    const found = this.tools.find((t) => t.name === tool && (!server || t.owner === server));
    if (!found) return { content: [{ type: "text", text: `Неизвестный инструмент: ${name}` }], isError: true };
    return await found.handler(args);
  }

  async allTools() {
    return this.tools.map((t) => ({ name: t.fullName, server: t.owner, description: t.description, inputSchema: t.inputSchema }));
  }

  async status() {
    return {
      ok: true,
      service: "orca-zmod-bridge",
      totals: { servers: 1, enabled: 1, connected: 2, errors: 0, tools: this.tools.length },
    };
  }

  async doctor() {
    const s = getFlashforgeSettings();
    const checks = [];
    const exe = s.slicer?.command;
    checks.push({ name: "orca_cli", ok: !!exe && fs.existsSync(exe), detail: exe || "не задан" });
    const base = String(s.printer?.baseUrl || "");
    let printerOk = false;
    try {
      const r = await fetch(base + "/printer/info", { signal: AbortSignal.timeout(5000) });
      printerOk = r.ok;
    } catch {}
    checks.push({ name: "moonraker", ok: printerOk, detail: base });
    const events = path.join(ROOT, "reports", "plugin-events.jsonl");
    checks.push({ name: "event_log", ok: fs.existsSync(events), detail: events });
    return { ok: checks.every((c) => c.ok), checks };
  }
}
