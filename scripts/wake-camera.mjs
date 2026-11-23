// Sends the U1's camera wake call (camera.start_monitor) over Moonraker's websocket and prints the answer.
// It only starts the LAN camera stream; it sends no G-code and does not affect a running print.
// Run: node scripts/wake-camera.mjs <printer-ip>
const host = process.argv[2];
if (!host) throw new Error("usage: node scripts/wake-camera.mjs <printer-ip>");
const ws = new WebSocket(`ws://${host}/websocket`);
const id = Date.now() % 100000;
const timer = setTimeout(() => {
  console.log("no answer after 12 s");
  process.exit(1);
}, 12000);
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", method: "camera.start_monitor", params: { domain: "lan", interval: 0, req_id: id }, id }));
ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id !== id) return;
  console.log(JSON.stringify(msg));
  clearTimeout(timer);
  ws.close();
};
ws.onerror = (e) => {
  console.log("websocket error", e.message ?? "");
  process.exit(1);
};
