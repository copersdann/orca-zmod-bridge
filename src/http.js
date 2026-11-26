/**
 * Optional localhost HTTP sidecar for external integrations (OrcaSlicer plugins).
 * Stdio MCP remains the primary interface; this is a thin bridge, bound to 127.0.0.1 only.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, getFlashforgeSettings, saveFlashforgeSettings } from "./registry.js";

const REPORTS_DIR = path.join(ROOT, "reports");
const EVENTS_FILE = path.join(REPORTS_DIR, "plugin-events.jsonl");
const MAX_BODY = 1024 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-MCP-Hub-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error("body too large");
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

function textOf(result) {
  return (result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

function parseTextMaybeJson(text) {
  try { return JSON.parse(text); } catch { return { text: text.slice(0, 4000) }; }
}

export function createHttpServer(bridge, { port = 8765 } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});

      const settings = getFlashforgeSettings();
      const token = settings?.http?.token;
      if (token && req.headers["x-mcp-hub-token"] !== token) {
        return send(res, 401, { error: "invalid token" });
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const p = url.pathname;

      if (req.method === "GET" && p === "/health") {
        const status = await bridge.status();
        return send(res, 200, {
          ok: true,
          service: "orca-zmod-bridge",
          version: "1.0.0",
          httpPort: port,
          totals: status.totals,
        });
      }

      if (req.method === "GET" && p === "/settings") {
        const s = getFlashforgeSettings();
        return send(res, 200, {
          status: "ok",
          spoolman: s.spoolman ?? { baseUrl: "" },
          notifications: { webhookUrl: s.notifications?.webhookUrl ? "***" : "" },
          hasWebhook: !!s.notifications?.webhookUrl,
        });
      }

      if (req.method === "POST" && p === "/settings") {
        const body = await readJsonBody(req);
        const s = getFlashforgeSettings();
        if (body.spoolman?.baseUrl) s.spoolman = { ...(s.spoolman ?? {}), baseUrl: String(body.spoolman.baseUrl) };
        if (body.notifications?.webhookUrl) {
          s.notifications = { ...(s.notifications ?? {}), webhookUrl: String(body.notifications.webhookUrl) };
        }
        saveFlashforgeSettings(s);
        return send(res, 200, { status: "ok", spoolman: s.spoolman, hasWebhook: !!s.notifications?.webhookUrl });
      }

      if (req.method === "GET" && p === "/printer/afc") {
        const objects = "zmod_color&AFC_lane%20lane1&AFC_lane%20lane2&AFC_lane%20lane3&AFC_lane%20lane4";
        const base = String(settings.printer.baseUrl || "").replace(/\/+$/, "");
        const upstream = await fetch(`${base}/printer/objects/query?${objects}`, {
          signal: AbortSignal.timeout(settings.printer.timeoutMs || 5000),
        });
        const json = await upstream.json();
        const status = json?.result?.status ?? {};
        const zmod = status.zmod_color ?? {};
        const lanes = [1, 2, 3, 4].map((i) => {
          const lane = status[`AFC_lane lane${i}`] ?? {};
          return {
            lane: i,
            tool: lane.map?.[0] ?? `T${i - 1}`,
            material: lane.material ?? zmod.slots?.[i - 1]?.Material ?? "?",
            color: lane.color ?? zmod.slots?.[i - 1]?.HEX ?? "",
            status: lane.status ?? "None",
            filamentStatus: lane.filament_status ?? "",
            loaded: !!lane.load,
            spoolId: lane.spool_id ?? null,
            weight: lane.weight ?? null,
          };
        });
        return send(res, upstream.status >= 400 ? 502 : 200, {
          status: "ok", protocol: "moonraker", ifsActive: !!zmod.ifs, activeTool: zmod.active_tool_id,
          lanes,
        });
      }

      if (req.method === "GET" && p === "/spoolman/spools") {
        const base = String(settings.spoolman?.baseUrl || "").replace(/\/+$/, "");
        if (!base) return send(res, 200, { status: "not_configured", hint: "Задай spoolman.baseUrl в flashforge.settings.json" });
        try {
          const r = await fetch(base + "/api/v1/spool", { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return send(res, 502, { status: "error", httpStatus: r.status });
          const spools = await r.json();
          return send(res, 200, {
            status: "ok",
            spools: (Array.isArray(spools) ? spools : []).map((s) => ({
              id: s.id, name: s.name, material: s.filament?.material, color: s.filament?.color_hex,
              remaining: s.remaining_weight ?? s.initial_weight, vendor: s.filament?.vendor?.name,
            })),
          });
        } catch (e) { return send(res, 502, { status: "error", error: String(e.message) }); }
      }

      if (req.method === "POST" && p === "/notify/send") {
        const body = await readJsonBody(req);
        const url = String(settings.notifications?.webhookUrl || "");
        const text = String(body.text || "").slice(0, 2000);
        if (!text) return send(res, 400, { error: "text required" });
        if (!url) return send(res, 200, {
          status: "not_configured",
          hint: "Задай notifications.webhookUrl (например Telegram bot API URL) в flashforge.settings.json",
          text,
        });
        try {
          const r = await fetch(url, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, event: body.event || "mcp-hub" }),
            signal: AbortSignal.timeout(8000),
          });
          return send(res, r.ok ? 200 : 502, { status: r.ok ? "ok" : "error", httpStatus: r.status, text });
        } catch (e) { return send(res, 502, { status: "error", error: String(e.message) }); }
      }

      if (req.method === "GET" && p === "/reports/export") {
        const name = url.searchParams.get("name") || "";
        if (!name || !/^[\w.\-+ ]+\.report\.json$/.test(name)) return send(res, 400, { error: "invalid report name" });
        const source = path.join(REPORTS_DIR, name);
        if (!fs.existsSync(source)) return send(res, 404, { error: "report not found" });
        const dir = path.join(ROOT, "exports");
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, name);
        fs.copyFileSync(source, target);
        return send(res, 200, { status: "ok", exportedTo: target });
      }

      if (req.method === "POST" && p === "/workflow/slice_print") {
        const body = await readJsonBody(req);
        if (!body.input || !fs.existsSync(body.input)) return send(res, 400, { error: `input not found: ${body.input}` });
        const confirm = body.confirm === true;
        const sliceArgs = {
          input: body.input,
          outputDir: body.outputDir || path.dirname(body.input),
          machineProfile: body.machineProfile,
          processProfile: body.processProfile,
          filamentProfile: body.filamentProfile,
          layerHeight: body.layerHeight,
          nozzleDiameter: body.nozzleDiameter,
          dryRun: !confirm,
          confirm: false,
          exportStatistics: true,
        };
        const slicedResult = await bridge.callTool("flashforge.slice", sliceArgs);
        const slicedText = textOf(slicedResult);
        const sliced = parseTextMaybeJson(slicedText);
        if (sliced.status === "slicer_not_configured" || sliced.status === "dry_run") {
          return send(res, 200, { status: "dry_run", steps: { slice: sliced }, note: "Укажи confirm:true для полного цикла." });
        }
        if (sliced.status !== "ok") return send(res, 400, { status: "error", step: "slice", detail: sliced });
        const gcode = (sliced.files || []).find((f) => f.endsWith(".gcode"));
        if (!gcode) return send(res, 400, { status: "error", step: "find_gcode", detail: sliced });
        const gcodePath = path.join(sliced.outputDir || sliceArgs.outputDir, gcode);
        const analysisResult = await bridge.callTool("flashforge.printer", { action: "status" });
        const uploadResult = await bridge.callTool("flashforge.printer", {
          action: "print", file: gcodePath, confirm: true,
        });
        return send(res, 200, {
          status: uploadResult.isError ? "error" : "ok",
          steps: { slice: sliced, analysis: { gcodePath }, print: parseTextMaybeJson(textOf(uploadResult)) },
          printerBefore: parseTextMaybeJson(textOf(analysisResult)),
        });
      }

      if (req.method === "GET" && p === "/orca/info") {
        const result = await bridge.callTool("orca.info", {});
        return send(res, 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/orca/presets") {
        const result = await bridge.callTool("orca.presets", {
          kind: url.searchParams.get("kind") || undefined,
          query: url.searchParams.get("query") || "",
          source: url.searchParams.get("source") || "all",
          limit: Number(url.searchParams.get("limit") || 50),
        });
        return send(res, 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "POST" && p === "/orca/project") {
        const body = await readJsonBody(req);
        const result = await bridge.callTool("orca.project", { path: body.path });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/orca/statistics") {
        const result = await bridge.callTool("orca.slice_stats", {
          directory: url.searchParams.get("directory"),
          limit: Number(url.searchParams.get("limit") || 10),
        });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/orca/events") {
        const result = await bridge.callTool("orca.plugin_events", {
          limit: Number(url.searchParams.get("limit") || 30),
          event: url.searchParams.get("event") || undefined,
        });
        return send(res, 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/status/full") {
        return send(res, 200, await bridge.status({ full: true }));
      }

      if (req.method === "GET" && p === "/hub/tools") {
        const server = url.searchParams.get("server");
        const query = (url.searchParams.get("query") || "").toLowerCase();
        const limit = Number(url.searchParams.get("limit") || 80);
        const withSchemas = url.searchParams.get("schemas") === "1";
        const all = await bridge.allTools();
        const tools = all.filter((t) =>
          (!server || t.owner === server) &&
          (!query || `${t.fullName} ${t.description ?? ""}`.toLowerCase().includes(query)) &&
          !t.error,
        ).slice(0, limit).map((t) => ({
          name: t.fullName, server: t.owner, description: t.description,
          ...(withSchemas ? { inputSchema: t.inputSchema } : {}),
        }));
        return send(res, 200, { returned: tools.length, tools });
      }

      if (req.method === "GET" && p === "/diagnostics") {
        return send(res, 200, await bridge.doctor());
      }

      if (req.method === "POST" && p === "/model/inspect") {
        const body = await readJsonBody(req);
        if (!body.path || !fs.existsSync(body.path)) {
          return send(res, 400, { error: `model not found: ${body.path}` });
        }
        const result = await bridge.callTool("flashforge.inspect_model", {
          path: body.path, buildVolume: body.buildVolume,
        });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "POST" && p === "/gcode/analyze") {
        const body = await readJsonBody(req);
        if (!body.path || !fs.existsSync(body.path)) {
          return send(res, 400, { error: `gcode not found: ${body.path}` });
        }
        const result = await bridge.callTool("flashforge.analyze_gcode", { path: body.path });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "POST" && p === "/printer/action") {
        const body = await readJsonBody(req);
        const action = body.action || "status";
        const result = await bridge.callTool("flashforge.printer", {
          action,
          host: body.host,
          command: body.command,
          file: body.file,
          params: body.params,
          confirm: body.confirm === true,
        });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/printer/probe") {
        const result = await bridge.callTool("flashforge.printer_probe", {
          subnet: url.searchParams.get("subnet") || undefined,
          limit: Number(url.searchParams.get("limit") || 60),
          timeoutMs: Number(url.searchParams.get("timeoutMs") || 400),
        });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "POST" && p === "/plugin/event") {
        const body = await readJsonBody(req);
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
        const record = { at: new Date().toISOString(), ...body };
        fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + "\n", "utf8");
        try {
          const lines = fs.readFileSync(EVENTS_FILE, "utf8").split(/\r?\n/).filter(Boolean);
          if (lines.length > 2000) {
            fs.writeFileSync(EVENTS_FILE, lines.slice(-1000).join("\n") + "\n", "utf8");
          }
        } catch {}
        return send(res, 200, { ok: true });
      }

      if (req.method === "GET" && p === "/reports/get") {
        const name = url.searchParams.get("name") || "";
        if (!name || !/^[\w.\-+ ]+\.report\.json$/.test(name)) {
          return send(res, 400, { error: "invalid report name" });
        }
        const file = path.join(REPORTS_DIR, name);
        if (!fs.existsSync(file)) return send(res, 404, { error: "report not found" });
        try { return send(res, 200, JSON.parse(fs.readFileSync(file, "utf8"))); }
        catch (e) { return send(res, 500, { error: String(e.message) }); }
      }

      if (req.method === "GET" && p === "/plugin/events") {
        if (!fs.existsSync(EVENTS_FILE)) return send(res, 200, { events: [] });
        const limit = Number(url.searchParams.get("limit") || 30);
        const events = fs.readFileSync(EVENTS_FILE, "utf8").split(/\r?\n/).filter(Boolean)
          .slice(-limit).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
        return send(res, 200, { events });
      }

      if (req.method === "GET" && p === "/profiles") {
        const result = await bridge.callTool("flashforge.profiles", {
          kind: url.searchParams.get("kind") || "all",
          query: url.searchParams.get("query") || "",
          limit: Number(url.searchParams.get("limit") || 60),
        });
        return send(res, 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "GET" && p === "/printer/status") {
        const result = await bridge.callTool("flashforge.printer", { action: "status" });
        const text = textOf(result);
        return send(res, result.isError ? 502 : 200, parseTextMaybeJson(text));
      }

      if (req.method === "POST" && p === "/printer/command") {
        const body = await readJsonBody(req);
        if (!body.command) return send(res, 400, { error: "command required" });
        const result = await bridge.callTool("flashforge.printer", {
          action: "gcode",
          command: body.command,
          confirm: body.confirm === true,
          host: body.host,
        });
        return send(res, result.isError ? 400 : 200, parseTextMaybeJson(textOf(result)));
      }

      if (req.method === "POST" && p === "/slice/done") {
        const body = await readJsonBody(req);
        if (!body.gcodePath || !fs.existsSync(body.gcodePath)) {
          return send(res, 400, { error: `gcodePath not found: ${body.gcodePath}` });
        }
        const result = await bridge.callTool("flashforge.analyze_gcode", { path: body.gcodePath });
        const analysis = parseTextMaybeJson(textOf(result));
        let savedTo = null;
        if (!result.isError) {
          fs.mkdirSync(REPORTS_DIR, { recursive: true });
          const name = path.basename(body.gcodePath, path.extname(body.gcodePath)) + ".report.json";
          savedTo = path.join(REPORTS_DIR, name);
          fs.writeFileSync(savedTo, JSON.stringify({
            receivedAt: new Date().toISOString(),
            gcodePath: body.gcodePath,
            outputName: body.outputName || null,
            orcaVersion: body.orcaVersion || null,
            analysis,
          }, null, 2), "utf8");
        }
        return send(res, result.isError ? 400 : 200, {
          ok: !result.isError,
          savedTo,
          summary: {
            layers: analysis.layers,
            estimatedTime: analysis.estimatedTimeComment,
            filament: analysis.filamentComment,
            nozzleTempC: analysis.nozzleTempC,
            warnings: analysis.warnings,
          },
          error: result.isError ? analysis.text : undefined,
        });
      }

      if (req.method === "GET" && p === "/reports") {
        if (!fs.existsSync(REPORTS_DIR)) return send(res, 200, { reports: [] });
        const limit = Number(url.searchParams.get("limit") || 20);
        const reports = fs.readdirSync(REPORTS_DIR)
          .filter((f) => f.endsWith(".report.json"))
          .sort()
          .slice(-limit)
          .map((f) => ({ name: f, path: path.join(REPORTS_DIR, f) }));
        return send(res, 200, { reports });
      }

      return send(res, 404, { error: `unknown endpoint ${p}` });
    } catch (e) {
      return send(res, 500, { error: String(e?.message ?? e) });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    process.stderr.write(`[mcp-hub] HTTP sidecar on http://127.0.0.1:${port}\n`);
  });
  server.on("error", (err) => {
    process.stderr.write(`[mcp-hub] HTTP sidecar error: ${err.message}\n`);
  });
  return server;
}
