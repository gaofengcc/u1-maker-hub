import JSZip from "jszip";
import type { PlateMesh } from "./geometry.ts";
import { U1_BED } from "./packing.ts";
import { apply, NO_ORIENT, orientedBox, type Orient } from "./orient.ts";

/** Reads STL files (binary or ASCII) and checks that they will print. */

export type StlMesh = PlateMesh & { triangleCount: number };

export type CheckLevel = "ok" | "warn" | "error";
export type Check = { level: CheckLevel; title: string; detail: string };

export type StlReport = {
  triangles: number;
  vertices: number;
  /** Width, depth and height in mm, as stored in the file. */
  size: [number, number, number];
  /** cm³, from the closed surface; null when the mesh is open. */
  volume: number | null;
  checks: Check[];
};

/** Binary when the size matches the triangle count in the header; ASCII otherwise. */
export function parseStl(buf: Buffer): StlMesh {
  const binary = buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length;
  const raw = binary ? readBinary(buf) : readAscii(buf.toString("latin1"));
  if (raw.length === 0) throw new Error("This file has no triangles. Is it really an STL?");
  return weld(raw);
}

function readBinary(buf: Buffer): Float32Array {
  const count = buf.readUInt32LE(80);
  const out = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12; // skip the stored normal
    for (let k = 0; k < 9; k++) out[t * 9 + k] = buf.readFloatLE(base + k * 4);
  }
  return out;
}

function readAscii(text: string): Float32Array {
  if (!/^\s*solid/i.test(text)) throw new Error("This is not an STL file.");
  const values: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) values.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (values.length % 9 !== 0 || values.some((v) => !Number.isFinite(v))) throw new Error("This STL is damaged: some vertices cannot be read.");
  return Float32Array.from(values);
}

/** Merges vertices that share a position, so edges can be compared between triangles. */
function weld(raw: Float32Array): StlMesh {
  const index = new Map<string, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(raw.length / 3);
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < raw.length / 3; v++) {
    const x = raw[v * 3], y = raw[v * 3 + 1], z = raw[v * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error("This STL is damaged: it has invalid coordinates.");
    const key = `${x},${y},${z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = positions.length / 3;
      index.set(key, i);
      positions.push(x, y, z);
      bbox[0] = Math.min(bbox[0], x);
      bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.min(bbox[2], z);
      bbox[3] = Math.max(bbox[3], x);
      bbox[4] = Math.max(bbox[4], y);
      bbox[5] = Math.max(bbox[5], z);
    }
    indices[v] = i;
  }
  const triangleCount = indices.length / 3;
  return {
    bbox,
    positions: Float32Array.from(positions),
    indices,
    groups: [{ filament: 1, start: 0, count: indices.length }],
    triangleCount,
  };
}

export function checkStl(mesh: StlMesh): StlReport {
  const { positions: p, indices, bbox } = mesh;
  const size: [number, number, number] = [bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]];
  const checks: Check[] = [];

  // Each edge of a closed surface is used once in each direction by exactly two triangles.
  const edges = new Map<string, number>();
  let degenerate = 0;
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (a === b || b === c || a === c) {
      degenerate++;
      continue;
    }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${u}:${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    // Signed volume of the tetrahedron from the origin; the sum is the enclosed volume.
    const [ax, ay, az] = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]];
    const [bx, by, bz] = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]];
    const [cx, cy, cz] = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let open = 0;
  let shared = 0;
  let flipped = 0;
  for (const [key, n] of edges) {
    const [u, v] = key.split(":").map(Number);
    const back = edges.get(`${v}:${u}`) ?? 0;
    if (back > 0 && u > v) continue; // the pair is counted from its other direction
    const total = n + back;
    if (total === 1) open++;
    else if (total > 2) shared++;
    // Two triangles using an edge in the same direction face opposite ways.
    else if (back === 0) flipped++;
  }

  const closed = open === 0 && shared === 0;
  checks.push(
    closed
      ? { level: "ok", title: "Closed surface", detail: "Every edge joins exactly two triangles, so the slicer knows what is inside." }
      : {
          level: "warn",
          title: "Holes or loose edges",
          detail: `${open} open edge${open === 1 ? "" : "s"} and ${shared} edge${shared === 1 ? "" : "s"} shared by more than two triangles. OrcaSlicer usually repairs this, but check the layer preview for gaps.`,
        },
  );
  if (flipped > 0 || (closed && volume < 0)) {
    checks.push({
      level: "warn",
      title: "Inside-out triangles",
      detail: volume < 0 ? "The whole surface faces inwards. OrcaSlicer flips it back when it repairs the model." : `${flipped} edges join triangles that face opposite ways.`,
    });
  }
  if (degenerate > 0) {
    checks.push({ level: "warn", title: "Empty triangles", detail: `${degenerate} triangle${degenerate === 1 ? " has" : "s have"} no area. They are ignored when slicing.` });
  }

  const max = Math.max(...size);
  const bedW = U1_BED.maxX - U1_BED.minX;
  const bedD = U1_BED.maxY - U1_BED.minY;
  if (max < 5) {
    checks.push({
      level: "warn",
      title: "Very small",
      detail: `The largest side is ${max.toFixed(2)} mm. If the file was made in inches or metres, set the size to ${max < 0.5 ? "100000%" : "2540%"} or rescale it in your modelling tool.`,
    });
  }
  const fits = size[0] <= bedW && size[1] <= bedD && size[2] <= U1_BED.height;
  const fitsTurned = size[1] <= bedW && size[0] <= bedD && size[2] <= U1_BED.height;
  checks.push(
    fits || fitsTurned
      ? { level: "ok", title: "Fits the U1", detail: `${fmt(size)} mm on a ${bedW.toFixed(0)} × ${bedD.toFixed(0)} × ${U1_BED.height} mm bed.` }
      : { level: "error", title: "Too big for the U1", detail: `${fmt(size)} mm. Make it smaller below, or split it in your modelling tool.` },
  );
  if (mesh.triangleCount > 2_000_000) {
    checks.push({ level: "warn", title: "Very detailed", detail: `${mesh.triangleCount.toLocaleString("en")} triangles. Slicing will be slow and use a lot of memory.` });
  }

  return {
    triangles: mesh.triangleCount,
    vertices: p.length / 3,
    size,
    volume: closed ? Math.abs(volume) / 1000 : null,
    checks,
  };
}

/**
 * Writes a binary STL scaled and turned around the vertical axis (degrees clockwise seen from above),
 * centred on the U1 bed and resting on it. OrcaSlicer's --scale and --rotate exit with an error or
 * crash on meshes, and its arrange step turns them, so the slicer gets this file with arrange off.
 */
export function writeTransformedStl(mesh: StlMesh, scale: number, rotation: number, orient?: Orient): Buffer {
  const a = (-rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a) * scale, Math.sin(a) * scale];
  const { positions: p, indices } = mesh;
  const r = orient ?? NO_ORIENT;
  // Orient first; then turn around the footprint centre, move that centre to the bed centre and the bottom to Z 0.
  const bbox = orientedBox(p, orient, mesh.bbox);
  const [cx, cy] = [(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2];
  const [bx, by] = [(U1_BED.minX + U1_BED.maxX) / 2, (U1_BED.minY + U1_BED.maxY) / 2];
  const count = indices.length / 3;
  const out = Buffer.alloc(84 + count * 50);
  out.write("U1 Maker Hub", 0, "latin1");
  out.writeUInt32LE(count, 80);
  const v = new Float64Array(9);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const i = indices[t * 3 + k] * 3;
      const o = apply(r, p[i], p[i + 1], p[i + 2]);
      const [x, y] = [o[0] - cx, o[1] - cy];
      v[k * 3] = bx + x * cos - y * sin;
      v[k * 3 + 1] = by + x * sin + y * cos;
      v[k * 3 + 2] = (o[2] - bbox[2]) * scale;
    }
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const base = 84 + t * 50;
    for (let k = 0; k < 3; k++) out.writeFloatLE(n[k] / len, base + k * 4);
    for (let k = 0; k < 9; k++) out.writeFloatLE(v[k], base + 12 + k * 4);
  }
  return out;
}

/**
 * A minimal 3MF (core spec, one object, no slicer settings) holding the mesh, so an STL can go
 * where the plate code expects a project. The slicer step adds the U1 settings later.
 */
export async function stlTo3mf(mesh: StlMesh, name: string): Promise<Buffer> {
  const { positions: p, indices } = mesh;
  const vertices: string[] = [];
  for (let i = 0; i < p.length; i += 3) vertices.push(`<vertex x="${p[i]}" y="${p[i + 1]}" z="${p[i + 2]}"/>`);
  const triangles: string[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    if (indices[t] === indices[t + 1] || indices[t + 1] === indices[t + 2] || indices[t] === indices[t + 2]) continue;
    triangles.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`);
  }
  const title = name.replace(/[<>&"]/g, "");
  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ` <metadata name="Title">${title}</metadata>`,
    ' <resources>',
    `  <object id="1" type="model" name="${title}"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`,
    " </resources>",
    ' <build><item objectid="1"/></build>',
    "</model>",
  ].join("\n");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  );
  zip.file("3D/3dmodel.model", model);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function fmt(size: number[]) {
  return size.map((v) => v.toFixed(1)).join(" × ");
}
