const ws = new WebSocket("ws://192.168.1.183:7125/websocket");
ws.onmessage = (e) => { try { console.log("RESP", e.data.slice(0, 800)); } catch {} };
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const msgs = [
  { jsonrpc: "2.0", method: "server.database.list", params: {}, id: 1 },
  { jsonrpc: "2.0", method: "server.database.set", params: { namespace: "lane_data", key: "lane1", value: { material: "PETG", color: "#FEC600", spool_id: null, weight: 1000 } }, id: 2 },
  { jsonrpc: "2.0", method: "server.database.get", params: { namespace: "lane_data", key: "lane1" }, id: 3 },
];
for (const m of msgs) ws.send(JSON.stringify(m));
await new Promise((r) => setTimeout(r, 2500));
ws.close();
