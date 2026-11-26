#!/usr/bin/env node
/** Read Z-Mod global parameters from the printer console via Moonraker WebSocket. */
const base = "http://192.168.1.183:7125";
const ws = new WebSocket("ws://192.168.1.183:7125/websocket");
const lines = [];
ws.onmessage = (e) => {
  try {
    const m = JSON.parse(e.data);
    if (m.method === "notify_gcode_response" && Array.isArray(m.params)) lines.push(...m.params);
  } catch {}
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
async function gcode(script) {
  await fetch(base + "/printer/gcode/script", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }),
  });
}
await gcode("GET_ZMOD_DATA");
await new Promise((r) => setTimeout(r, 2500));
console.log("=== GET_ZMOD_DATA ===");
console.log(lines.join("\n").slice(0, 8000) || "(нет ответа)");
lines.length = 0;
await gcode("STATUS");
await new Promise((r) => setTimeout(r, 1500));
console.log("\n=== STATUS ===");
console.log(lines.join("\n").slice(0, 3000) || "(нет ответа)");
ws.close();
