import fs from "node:fs";

/**
 * Reads the extrusion moves of an OrcaSlicer G-code, for the layer preview. Each feature
 * (";TYPE:Support", ";TYPE:Outer wall", ...) becomes a list of continuous runs of points.
 *
 * File layout, decoded by toolpathView.ts in the browser: uint32 header length, JSON header
 * ({ layers, bbox, features: [{ type, points, runs, mm }] }), padding to 4 bytes, then for each
 * feature in order: uint16 [x, y, layer] per point (x and y in 0.01 mm), padded to 4 bytes,
 * and uint32 start point of each run.
 */

type Feature = { type: string; points: number[]; runs: number[]; mm: number };

/** Longest straight piece used to draw an arc, in mm. */
const ARC_STEP = 0.6;

export function parseToolpath(text: string) {
  const layers: number[] = [];
  const features = new Map<string, Feature>();
  let type = "Other";
  let layer = -1;
  let x = 0, y = 0;
  // The run being extended: its feature and the point it ends at.
  let open: Feature | null = null;
  let endX = NaN, endY = NaN;

  const featureFor = (name: string) => {
    let f = features.get(name);
    if (!f) features.set(name, (f = { type: name, points: [], runs: [], mm: 0 }));
    return f;
  };
  const q = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 100)));
  const addPoint = (f: Feature, px: number, py: number) => f.points.push(q(px), q(py), layer);
  const extrude = (toX: number, toY: number) => {
    const f = featureFor(type);
    if (open !== f || Math.abs(endX - x) > 1e-4 || Math.abs(endY - y) > 1e-4) {
      f.runs.push(f.points.length / 3);
      addPoint(f, x, y);
      open = f;
    }
    addPoint(f, toX, toY);
    f.mm += Math.hypot(toX - x, toY - y);
    endX = toX;
    endY = toY;
  };

  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;

    if (line.charCodeAt(0) === 59 /* ; */) {
      if (line.startsWith(";TYPE:")) {
        type = line.slice(6).trim();
        open = null;
      } else if (line.startsWith(";LAYER_CHANGE")) {
        layer++;
        open = null;
      } else if (line.startsWith(";Z:") && layer >= 0) {
        layers[layer] = Number(line.slice(3));
      }
      continue;
    }
    const code = line.slice(0, 3);
    if (code !== "G1 " && code !== "G0 " && code !== "G2 " && code !== "G3 ") continue;

    let nx = x, ny = y, e = 0, i = 0, j = 0;
    const body = line.indexOf(";") >= 0 ? line.slice(0, line.indexOf(";")) : line;
    for (const word of body.split(" ")) {
      const v = Number(word.slice(1));
      switch (word[0]) {
        case "X": nx = v; break;
        case "Y": ny = v; break;
        case "E": e = v; break;
        case "I": i = v; break;
        case "J": j = v; break;
      }
    }
    // Only real extrusion inside the print: not travel, retraction, wipes or the start-up purge.
    const moved = nx !== x || ny !== y;
    if (layer >= 0 && e > 0 && moved && type !== "Custom") {
      if (code === "G2 " || code === "G3 ") {
        const cx = x + i, cy = y + j;
        const r = Math.hypot(i, j);
        const a0 = Math.atan2(y - cy, x - cx);
        let sweep = Math.atan2(ny - cy, nx - cx) - a0;
        if (code === "G2 " && sweep >= 0) sweep -= 2 * Math.PI; // clockwise
        if (code === "G3 " && sweep <= 0) sweep += 2 * Math.PI;
        const steps = Math.max(1, Math.ceil((Math.abs(sweep) * r) / ARC_STEP));
        for (let s = 1; s <= steps; s++) {
          const a = a0 + (sweep * s) / steps;
          const [px, py] = s === steps ? [nx, ny] : [cx + r * Math.cos(a), cy + r * Math.sin(a)];
          extrude(px, py);
          x = px;
          y = py;
        }
      } else {
        extrude(nx, ny);
      }
    } else if (moved) {
      open = null;
    }
    x = nx;
    y = ny;
  }

  const list = [...features.values()].filter((f) => f.points.length);
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const f of list) {
    for (let p = 0; p < f.points.length; p += 3) {
      const px = f.points[p] / 100, py = f.points[p + 1] / 100, pz = layers[f.points[p + 2]] ?? 0;
      if (px < bbox[0]) bbox[0] = px;
      if (py < bbox[1]) bbox[1] = py;
      if (pz < bbox[2]) bbox[2] = pz;
      if (px > bbox[3]) bbox[3] = px;
      if (py > bbox[4]) bbox[4] = py;
      if (pz > bbox[5]) bbox[5] = pz;
    }
  }
  return { layers: layers.map((v) => (Number.isFinite(v) ? v : 0)), bbox, features: list };
}

export function encodeToolpath(parsed: ReturnType<typeof parseToolpath>): Buffer {
  const header = Buffer.from(
    JSON.stringify({
      layers: parsed.layers,
      bbox: parsed.bbox,
      features: parsed.features.map((f) => ({ type: f.type, points: f.points.length / 3, runs: f.runs.length, mm: Math.round(f.mm) })),
    }),
  );
  const pad = (n: number) => Buffer.alloc((4 - (n % 4)) % 4);
  const parts: Buffer[] = [Buffer.alloc(4), header];
  parts[0].writeUInt32LE(header.length);
  let length = 4 + header.length;
  parts.push(pad(length));
  length += pad(length).length;
  for (const f of parsed.features) {
    const points = Buffer.from(Uint16Array.from(f.points).buffer);
    const runs = Buffer.from(Uint32Array.from(f.runs).buffer);
    parts.push(points, pad(points.length), runs);
    length += points.length + pad(points.length).length + runs.length;
  }
  return Buffer.concat(parts);
}

/** The encoded toolpath of a G-code file, cached next to it. */
export function toolpathFor(gcode: string) {
  // Bump the version when the parser or the layout changes.
  const cache = `${gcode}.toolpath.v1`;
  const fresh = fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(gcode).mtimeMs;
  if (!fresh) fs.writeFileSync(cache, encodeToolpath(parseToolpath(fs.readFileSync(gcode, "utf8"))));
  return fs.readFileSync(cache);
}
