import fs from "node:fs";
import JSZip from "jszip";
import { footprint, U1_BED } from "./packing.ts";
import { isNoOrient, orientedBox, orientMat, type Orient } from "./orient.ts";

/**
 * Reads and transforms the geometry of a Bambu Studio / OrcaSlicer 3MF project.
 *
 * Bambu projects keep meshes in 3D/Objects/*.model, reference them from 3D/3dmodel.model as
 * components, place them with build items, and assign build items to plates and parts to
 * filaments in Metadata/model_settings.config. Colour painting is stored per triangle.
 */

/** 3MF affine transform, row-vector convention: [m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32]. */
export type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function formatMat(m: Mat) {
  return m.map((v) => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(10))).join(" ");
}

function parseMat(text: string | undefined): Mat {
  const m = (text ?? "").trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

/** a then b: applying the result equals applying a, then b. */
export function mul(a: Mat, b: Mat): Mat {
  const r: Mat = new Array(12);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let v = row === 3 ? b[9 + col] : 0;
      for (let k = 0; k < 3; k++) v += a[row * 3 + k] * b[k * 3 + col];
      r[row * 3 + col] = v;
    }
  }
  return r;
}

function apply(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
}

export const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

type RawMesh = { vertices: Float64Array; triangles: Uint32Array; paint: (number | 0)[] };
type Component = { path: string | null; objectId: string; transform: Mat };
type ObjectDef = { mesh: RawMesh | null; components: Component[] };
type BuildItem = { objectId: string; transform: Mat; attrs: string };

function parseMesh(xml: string): RawMesh {
  const verts: number[] = [];
  for (const m of xml.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)) verts.push(+m[1], +m[2], +m[3]);
  const tris: number[] = [];
  const paint: number[] = [];
  for (const m of xml.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"([^>]*)>/g)) {
    tris.push(+m[1], +m[2], +m[3]);
    const code = /paint_color="([0-9A-Fa-f]+)"/.exec(m[4])?.[1];
    paint.push(code ? paintState(code) : 0);
  }
  return { vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris), paint };
}

/**
 * The filament a painted triangle uses (1-based), or 0 for "the part's own filament".
 * The string is a TriangleSelector tree, read from its last hex digit backwards: two low bits give the
 * split count, the two high bits the state, and the value 3 means the next digit holds state - 3.
 * Subdivided triangles are approximated by their first unsplit child.
 */
export function paintState(code: string): number {
  for (let i = code.length - 1; i >= 0; i--) {
    const nibble = parseInt(code[i], 16);
    if ((nibble & 3) !== 0) continue; // split node: its children follow
    const state = nibble >> 2;
    if (state < 3) return state;
    return i > 0 ? parseInt(code[i - 1], 16) + 3 : 3;
  }
  return 0;
}

/**
 * Rewrites the filament of every painted leaf in a paint_color string. Split nodes are copied as they
 * are; a leaf takes one digit for states 0-2, or the marker 0xC followed by state - 3.
 */
export function remapPaint(code: string, map: (state: number) => number): string {
  const out: number[] = []; // in reading order, i.e. from the end of the string
  for (let i = code.length - 1; i >= 0; i--) {
    const nibble = parseInt(code[i], 16);
    if ((nibble & 3) !== 0) {
      out.push(nibble);
      continue;
    }
    let state = nibble >> 2;
    if (state === 3 && i > 0) state = parseInt(code[--i], 16) + 3;
    const next = map(state);
    if (next < 3) out.push(next << 2);
    else out.push(0xc, next - 3);
  }
  return out
    .reverse()
    .map((n) => n.toString(16).toUpperCase())
    .join("");
}

function parseObjects(xml: string, path: string | null, into: Map<string, ObjectDef>) {
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], "id");
    if (!id) continue;
    const body = m[2];
    const components: Component[] = [];
    for (const c of body.matchAll(/<component\b([^>]*?)\/?>/g)) {
      components.push({ path: attr(c[1], "p:path") ?? null, objectId: attr(c[1], "objectid") ?? "", transform: parseMat(attr(c[1], "transform")) });
    }
    into.set(`${path ?? ""}#${id}`, { mesh: body.includes("<mesh") ? parseMesh(body) : null, components });
  }
}

/**
 * Which filament each object and each part uses, from model_settings.config (1-based, 0 when unknown),
 * and whether a part is printed: negative parts, modifiers and support blockers/enforcers are not.
 */
function parseExtruders(config: string) {
  const objects = new Map<string, { extruder: number; parts: Map<string, { extruder: number; solid: boolean }> }>();
  for (const m of config.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)) {
    const head = m[2].split("<part")[0];
    const extruder = Number(/key="extruder" value="(\d+)"/.exec(head)?.[1] ?? 0);
    const parts = new Map<string, { extruder: number; solid: boolean }>();
    for (const p of m[2].matchAll(/<part id="(\d+)"([^>]*)>([\s\S]*?)<\/part>/g)) {
      const subtype = attr(p[2], "subtype") ?? "normal_part";
      parts.set(p[1], { extruder: Number(/key="extruder" value="(\d+)"/.exec(p[3])?.[1] ?? 0), solid: subtype === "normal_part" });
    }
    objects.set(m[1], { extruder, parts });
  }
  return objects;
}

/** For each plate, the build item numbers (0-based, in <build> order) placed on it. */
function parsePlates(config: string, items: BuildItem[]) {
  const plates = new Map<number, number[]>();
  for (const block of config.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const index = Number(/key="plater_id" value="(\d+)"/.exec(block)?.[1] ?? plates.size + 1);
    const picked: number[] = [];
    for (const inst of block.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
      const objectId = /key="object_id" value="(\d+)"/.exec(inst[1])?.[1];
      const instance = Number(/key="instance_id" value="(\d+)"/.exec(inst[1])?.[1] ?? 0);
      // The nth build item of that object is its nth instance.
      const matches = items.map((it, i) => (it.objectId === objectId ? i : -1)).filter((i) => i >= 0);
      if (matches[instance] !== undefined) picked.push(matches[instance]);
    }
    plates.set(index, picked);
  }
  return plates;
}

export type Project = {
  zip: JSZip;
  modelXml: string;
  objects: Map<string, ObjectDef>;
  items: BuildItem[];
  /** Metadata/model_settings.config as text. */
  config: string;
  extruders: ReturnType<typeof parseExtruders>;
  plates: Map<number, number[]>;
};

export async function loadProject(file: string): Promise<Project> {
  return loadProjectZip(await JSZip.loadAsync(fs.readFileSync(file)));
}

/** The same from an open archive, to read back changes that are not written to disk yet. */
export async function loadProjectZip(zip: JSZip): Promise<Project> {
  const modelXml = (await zip.file("3D/3dmodel.model")?.async("string")) ?? "";
  const objects = new Map<string, ObjectDef>();
  parseObjects(modelXml, null, objects);
  // Load every mesh file the components point to.
  const paths = new Set<string>();
  for (const o of objects.values()) for (const c of o.components) if (c.path) paths.add(c.path);
  for (const p of paths) {
    const xml = await zip.file(p.replace(/^\//, ""))?.async("string");
    if (xml) parseObjects(xml, p, objects);
  }
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(modelXml)?.[1] ?? "";
  const items: BuildItem[] = [...build.matchAll(/<item\b([^>]*?)\/?>/g)].map((m) => ({
    objectId: attr(m[1], "objectid") ?? "",
    transform: parseMat(attr(m[1], "transform")),
    attrs: m[1],
  }));
  const config = (await zip.file("Metadata/model_settings.config")?.async("string")) ?? "";
  return { zip, modelXml, objects, items, config, extruders: parseExtruders(config), plates: parsePlates(config, items) };
}

/** Build item numbers on a plate; every item when the plate is 0 or the file has no plate list. */
export function itemsOnPlate(p: Project, plate: number) {
  const listed = plate > 0 ? p.plates.get(plate) : undefined;
  return listed?.length ? listed : p.items.map((_, i) => i);
}

/** Calls back with each printed mesh of a build item, in world space, and the filament its unpainted triangles use. */
function walkItem(p: Project, item: BuildItem, visit: (mesh: RawMesh, m: Mat, filament: number) => void) {
  const top = p.objects.get(`#${item.objectId}`);
  if (!top) return;
  const ext = p.extruders.get(item.objectId);
  const base = ext?.extruder || 1;
  if (top.mesh) visit(top.mesh, item.transform, base);
  for (const c of top.components) {
    const sub = p.objects.get(`${c.path ?? ""}#${c.objectId}`);
    // Bambu numbers parts like the sub-objects they come from.
    const part = ext?.parts.get(c.objectId);
    if (!sub?.mesh || part?.solid === false) continue;
    visit(sub.mesh, mul(c.transform, item.transform), part?.extruder || base);
  }
}

/** Calls back with each printed triangle of a build item (0-based, in <build> order) in world space: three points, nine numbers. */
export function eachTriangle(p: Project, item: number, visit: (t: number[]) => void) {
  const t = new Array<number>(9);
  walkItem(p, p.items[item], (mesh, m) => {
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.triangles[i + k] * 3;
        const w = apply(m, mesh.vertices[v], mesh.vertices[v + 1], mesh.vertices[v + 2]);
        t[k * 3] = w[0];
        t[k * 3 + 1] = w[1];
        t[k * 3 + 2] = w[2];
      }
      visit(t);
    }
  });
}

export type PlateMesh = {
  /** World-space bounding box: [minX, minY, minZ, maxX, maxY, maxZ] in mm. */
  bbox: number[];
  positions: Float32Array;
  /** Triangles sorted by filament, so each group can use one material. */
  indices: Uint32Array;
  groups: { filament: number; start: number; count: number }[];
};

export async function readPlateMesh(file: string, plate: number): Promise<PlateMesh> {
  return plateMesh(await loadProject(file), plate);
}

export function plateMesh(p: Project, plate: number): PlateMesh {
  const positions: number[] = [];
  const byFilament = new Map<number, number[]>();
  const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const i of itemsOnPlate(p, plate)) {
    walkItem(p, p.items[i], (mesh, m, filament) => {
      const offset = positions.length / 3;
      for (let v = 0; v < mesh.vertices.length; v += 3) {
        const w = apply(m, mesh.vertices[v], mesh.vertices[v + 1], mesh.vertices[v + 2]);
        positions.push(w[0], w[1], w[2]);
        for (let k = 0; k < 3; k++) {
          bbox[k] = Math.min(bbox[k], w[k]);
          bbox[k + 3] = Math.max(bbox[k + 3], w[k]);
        }
      }
      for (let t = 0; t < mesh.paint.length; t++) {
        const f = mesh.paint[t] || filament;
        let list = byFilament.get(f);
        if (!list) byFilament.set(f, (list = []));
        list.push(offset + mesh.triangles[t * 3], offset + mesh.triangles[t * 3 + 1], offset + mesh.triangles[t * 3 + 2]);
      }
    });
  }
  const indices: number[] = [];
  const groups: PlateMesh["groups"] = [];
  for (const [filament, list] of [...byFilament.entries()].sort((a, b) => a[0] - b[0])) {
    groups.push({ filament, start: indices.length, count: list.length });
    for (const i of list) indices.push(i);
  }
  return { bbox: bbox.map((v) => (Number.isFinite(v) ? v : 0)), positions: Float32Array.from(positions), indices: Uint32Array.from(indices), groups };
}

export type PlateTransform = {
  /** Uniform size factor, 1 = unchanged. */
  scale: number;
  /** Rotation around the vertical axis in degrees, clockwise seen from above. */
  rotation: number;
  /** How the piece lies on the bed, applied before the size and rotation; missing = as in the file. */
  orient?: Orient;
};

export const NO_TRANSFORM: PlateTransform = { scale: 1, rotation: 0 };

export function isIdentity(t: PlateTransform) {
  return Math.abs(t.scale - 1) < 1e-6 && Math.abs(t.rotation % 360) < 1e-6 && isNoOrient(t.orient);
}

/**
 * How far to move a plate's objects so they sit on that plate of the U1. OrcaSlicer lays plates out
 * in a grid of ceil(√count) columns, 1.2 bed sizes apart. A project made for a smaller printer keeps
 * its own grid, so its plate 2 and later land between the U1 plates and the slicer refuses them.
 * Objects already on the U1 plate do not move.
 */
function shiftOntoU1Plate(p: Project, plate: number, cx: number, cy: number, w: number, d: number): [number, number] {
  const count = Math.max(p.plates.size, plate, 1);
  const root = Math.sqrt(count);
  const cols = root > Math.round(root) ? Math.round(root) + 1 : Math.round(root);
  const bedW = U1_BED.maxX - U1_BED.minX;
  const bedD = U1_BED.maxY - U1_BED.minY;
  const i = plate - 1;
  const x0 = (i % cols) * bedW * 1.2 + U1_BED.minX;
  const y0 = -Math.floor(i / cols) * bedD * 1.2 + U1_BED.minY;
  const inside = cx - w / 2 >= x0 && cx + w / 2 <= x0 + bedW && cy - d / 2 >= y0 && cy + d / 2 <= y0 + bedD;
  return inside ? [0, 0] : [x0 + bedW / 2 - cx, y0 + bedD / 2 - cy];
}

/**
 * Turns the pieces on a plate to the chosen orientation, then scales and rotates them as one piece
 * around the centre of their footprint, resting on the bed, and moves them onto the matching U1
 * plate when they are not there already. Only build item transforms change, so plates, colours and
 * per-part settings survive. Plate 0 means every item, which is never moved. Returns the project
 * with its build items where they now are.
 */
export async function transformPlate(zip: JSZip, file: string, plate: number, t: PlateTransform): Promise<Project> {
  const p = await loadProject(file);
  const picked = itemsOnPlate(p, plate);
  const mesh = plateMesh(p, plate);
  // The footprint stays where the creator put it; the box after the orientation sets what moves there.
  const [minX, minY, minZ, maxX, maxY] = mesh.bbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const box = orientedBox(mesh.positions, t.orient, mesh.bbox);
  const [w, d] = footprint(box, t.scale, t.rotation);
  const [dx, dy] = plate > 0 ? shiftOntoU1Plate(p, plate, cx, cy, w, d) : [0, 0];
  if (isIdentity(t) && !dx && !dy) return p;
  const a = (-t.rotation * Math.PI) / 180;
  const s = t.scale;
  const [cos, sin] = [Math.cos(a) * s, Math.sin(a) * s];
  // Orient, move the footprint centre (and the bed contact point) to the origin, rotate and scale, move back.
  const toOrigin: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, -(box[0] + box[3]) / 2, -(box[1] + box[4]) / 2, -box[2]];
  const scaleRotate: Mat = [cos, sin, 0, -sin, cos, 0, 0, 0, s, 0, 0, 0];
  const back: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, cx + dx, cy + dy, minZ];
  const g = mul(mul(mul(orientMat(t.orient), toOrigin), scaleRotate), back);

  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(p.modelXml);
  if (!build) return p;
  let n = 0;
  const newBuild = build[1].replace(/<item\b([^>]*?)(\/?)>/g, (whole, attrs: string, close: string) => {
    const i = n++;
    if (!picked.includes(i)) return whole;
    p.items[i].transform = mul(p.items[i].transform, g);
    const m = formatMat(p.items[i].transform);
    const next = /\stransform="[^"]*"/.test(attrs) ? attrs.replace(/\stransform="[^"]*"/, ` transform="${m}"`) : `${attrs} transform="${m}"`;
    return `<item${next}${close}>`;
  });
  zip.file("3D/3dmodel.model", p.modelXml.replace(build[1], () => newBuild));
  return p;
}
