// Measures how often the U1 camera image changes. Read-only: it only downloads the image.
// Run: node scripts/camera-fps.mjs <printer-ip> [seconds]
import crypto from "node:crypto";

const host = process.argv[2];
const seconds = Number(process.argv[3] ?? 10);
// Pass a full URL (e.g. http://localhost:3000/api/printer/camera) to measure through the app instead.
const url = host.startsWith("http") ? host : `http://${host}/server/files/camera/monitor.jpg`;
let prev = "";
let distinct = 0;
let requests = 0;
let fetchMs = 0;
let errors = 0;
let torn = 0;
const start = Date.now();
while (Date.now() - start < seconds * 1000) {
  const t = Date.now();
  let buf;
  try {
    const res = await fetch(url, { cache: "no-store" });
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    errors++;
    continue;
  }
  fetchMs += Date.now() - t;
  requests++;
  // A complete JPEG ends with FF D9; anything else was read while the camera was rewriting it.
  if (buf.at(-2) !== 0xff || buf.at(-1) !== 0xd9) torn++;
  const hash = crypto.createHash("md5").update(buf).digest("hex");
  if (hash !== prev) distinct++;
  prev = hash;
  await new Promise((r) => setTimeout(r, Number(process.env.GAP_MS ?? 100)));
}
const elapsed = (Date.now() - start) / 1000;
console.log(`${distinct} distinct frames in ${elapsed.toFixed(1)} s = ${(distinct / elapsed).toFixed(2)} fps`);
console.log(`${requests} requests, average download ${Math.round(fetchMs / requests)} ms, ${errors} dropped connections, ${torn} incomplete images`);
