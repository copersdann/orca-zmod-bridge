/** Send G-code and print console responses (Moonraker WebSocket). */
const cmds = process.argv.slice(2);
const ws = new WebSocket("ws://192.168.1.183:7125/websocket");
const lines = [];
ws.onmessage = (e) => {
  try { const m = JSON.parse(e.data); if (m.method === "notify_gcode_response" && Array.isArray(m.params)) lines.push(...m.params); } catch {}
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
for (const cmd of cmds) {
  lines.length = 0;
  await fetch("http://192.168.1.183:7125/printer/gcode/script", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: cmd }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log("\n>>>", cmd);
  console.log(lines.join("\n").slice(0, 2500) || "(no response)");
}
ws.close();
