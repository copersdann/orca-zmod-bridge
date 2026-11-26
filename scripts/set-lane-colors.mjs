const BASE = "http://192.168.1.183:7125";
const lanes = [
  { key: "lane1", lane: "0", material: "PETG", color: "#FEC600", name: "PETG Yellow" },
  { key: "lane2", lane: "1", material: "PETG", color: "#000000", name: "PETG Black" },
  { key: "lane3", lane: "2", material: "PETG", color: "#2E86DE", name: "PETG Blue" },
  { key: "lane4", lane: "3", material: "PETG", color: "#E74C3C", name: "PETG Red" },
];
for (const { key, ...value } of lanes) {
  const r = await fetch(BASE + "/server/database/item", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ namespace: "lane_data", key, value: { ...value, spool_id: null } }),
  });
  console.log(key, r.status, (await r.text()).slice(0, 180));
}
