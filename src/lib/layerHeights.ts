import fs from "node:fs";
import JSZip from "jszip";
import { eachTriangle, itemsOnPlate, loadProjectZip, type Project } from "./geometry.ts";

/**
 * Layer heights that follow the shape of the model: thin layers where the surface is nearly flat, so
 * the steps of a dome or a slope get small, and the preset's height (or more) on steep walls.
 *
 * OrcaSlicer's command line has no switch for this: the "adaptive_layer_height" key is ignored. Its 3MF
 * reader does take a height profile per object from Metadata/layer_heights_profile.txt, the file its
 * "Variable layer height" tool saves. This module computes that profile the way the tool's Adaptive
 * button does (libslic3r, SlicingAdaptive.cpp and Slicing.cpp) and writes it into the project.
 */

export type LayerLimits = {
  /** Height of the first layer, which never changes. */
  first: number;
  /** The preset's layer height: also how much surface error a layer may leave. */
  base: number;
  min: number;
  max: number;
};

export type LayerPlan = {
  /** Thinnest and thickest layer above the first one. */
  min: number;
  max: number;
  /** Top of each layer the slicer will make from the profile, first layer included. */
  layers: number[];
  /** How many layers the same height takes at the preset's layer height. */
  fixedCount: number;
};

const PROFILE_FILE = "Metadata/layer_heights_profile.txt";
/** The most a layer may differ from the one below it, as in OrcaSlicer. */
const MAX_STEP = 0.04;
const EPSILON = 1e-4;

/**
 * The thickest layer that keeps the stair steps of a face within the allowed error: the error triangle
 * of a step has a constant area. `sin` and `cos` are those of the angle between the face and the bed.
 */
function heightForSlope(sin: number, cos: number, base: number) {
  return Math.min(base / 0.184, cos > 1e-5 ? 1.44 * base * Math.sqrt(sin / cos) : Infinity);
}

/** Faces as [lowest z, highest z, thickest layer] triples, sorted by lowest then highest z. */
function sortFaces(raw: number[]): Float64Array {
  const count = raw.length / 3;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => raw[a * 3] - raw[b * 3] || raw[a * 3 + 1] - raw[b * 3 + 1]);
  const out = new Float64Array(raw.length);
  for (let i = 0; i < count; i++) out.set([raw[order[i] * 3], raw[order[i] * 3 + 1], raw[order[i] * 3 + 2]], i * 3);
  return out;
}

/**
 * The height profile as OrcaSlicer stores it: z, height, z, height… from the bed to `top`, one point
 * per layer. Each layer is as thick as the faces it crosses allow, within the limits.
 */
export function adaptiveProfile(faces: Float64Array, top: number, l: LayerLimits): number[] {
  const count = faces.length / 3;
  const profile = [0, l.first, l.first, l.first];
  let z = l.first;
  let previous: number | null = null;
  // First face that still reaches above z; faces before it are below the current layer.
  let current = 0;
  while (z + EPSILON < top) {
    let height = l.max;
    let i = current;
    let hit = false;
    // Faces the bottom of this layer cuts through.
    for (; i < count; i++) {
      if (faces[i * 3] >= z) break;
      if (faces[i * 3 + 1] <= z) continue;
      if (!hit) {
        hit = true;
        current = i;
      }
      // A face that only touches the layer would ask for a needlessly thin one.
      if (faces[i * 3 + 1] < z + EPSILON) continue;
      height = Math.min(height, faces[i * 3 + 2]);
    }
    height = Math.max(height, l.min);
    // Faces that start inside the layer: follow their slope, or stop the layer right under them.
    if (height > l.min) {
      for (; i < count; i++) {
        const gap = faces[i * 3] - z;
        if (gap >= height) break;
        if (faces[i * 3 + 1] < z + EPSILON) continue;
        const limit = faces[i * 3 + 2];
        if (limit < gap) height = gap;
        else if (limit < height) height = limit;
      }
      height = Math.max(height, l.min);
    }
    // No sudden change between neighbours; the layer above the first one is free, as with equal layers.
    if (previous !== null) height = Math.max(previous - MAX_STEP, Math.min(previous + MAX_STEP, height));
    profile.push(z, height);
    previous = height;
    z += height;
  }
  const gap = top - profile[profile.length - 2];
  if (gap > 0) profile.push(top, Math.max(l.min, Math.min(l.max, gap)));
  return profile;
}

/** The profile's height at z: straight lines between its points. */
function heightAt(profile: number[], z: number) {
  let i = 0;
  while (i + 2 < profile.length && z >= profile[i + 2]) i += 2;
  if (i + 2 >= profile.length) return profile[i + 1];
  const [z1, h1, z2, h2] = [profile[i], profile[i + 1], profile[i + 2], profile[i + 3]];
  return h1 + (h2 - h1) * ((z - z1) / (z2 - z1));
}

/** The top of each layer OrcaSlicer makes from a profile (generate_object_layers in Slicing.cpp). */
export function plannedLayers(profile: number[], top: number, l: LayerLimits): number[] {
  const out = [l.first];
  let z = l.first;
  for (;;) {
    if (z + 0.5 * l.min >= top) break;
    const height = heightAt(profile, z + 0.5 * l.min);
    if (z + 0.5 * height >= top) break;
    z += height;
    out.push(z);
  }
  return out;
}

/**
 * The shared profile cut for an object that ends at `top`. Objects on one plate must agree point by
 * point where they overlap, or OrcaSlicer refuses the prime tower; `breaks` are the tops of all the
 * shorter objects, so each of them ends on a point every taller one also has.
 */
function profileUpTo(profile: number[], breaks: number[], top: number): number[] {
  const out: number[] = [];
  const cuts = breaks.filter((b) => b <= top).sort((a, b) => a - b);
  let c = 0;
  for (let i = 0; i < profile.length; i += 2) {
    for (; c < cuts.length && cuts[c] < profile[i]; c++) out.push(cuts[c], heightAt(profile, cuts[c]));
    if (profile[i] > top) break;
    out.push(profile[i], profile[i + 1]);
  }
  for (; c < cuts.length; c++) out.push(cuts[c], heightAt(profile, cuts[c]));
  return out;
}

/**
 * Computes one adaptive profile for everything on the plate (0 = every object) of the project, and
 * stores it in the archive for each object there. Returns what the slicer will make of it, or null
 * when there is nothing to adapt.
 */
export function writeLayerHeights(zip: JSZip, p: Project, plate: number, limits: LayerLimits): LayerPlan | null {
  // OrcaSlicer numbers objects from 1 in the order build items first use them, and measures an
  // object's height on its first build item.
  const firstItem = new Map<string, number>();
  p.items.forEach((item, i) => {
    if (!firstItem.has(item.objectId)) firstItem.set(item.objectId, i);
  });
  const picked = itemsOnPlate(p, plate);
  const onPlate = new Set(picked.map((i) => p.items[i].objectId));
  const tops = new Map<string, number>();
  const raw: number[] = [];
  for (const i of new Set([...picked, ...[...onPlate].map((id) => firstItem.get(id)!)])) {
    const id = p.items[i].objectId;
    const measures = firstItem.get(id) === i;
    const shapes = picked.includes(i);
    eachTriangle(p, i, (t) => {
      const lo = Math.min(t[2], t[5], t[8]);
      const hi = Math.max(t[2], t[5], t[8]);
      if (measures && hi > (tops.get(id) ?? -Infinity)) tops.set(id, hi);
      if (!shapes) return;
      const [ux, uy, uz, vx, vy, vz] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
      const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(nx, ny, nz);
      if (length === 0) return;
      const limit = heightForSlope(Math.hypot(nx, ny) / length, Math.abs(nz) / length, limits.base);
      // A face that allows the thickest layer never changes the result.
      if (limit < limits.max) raw.push(lo, hi, limit);
    });
  }
  const top = Math.max(...tops.values());
  if (!Number.isFinite(top) || top <= limits.first + EPSILON) return null;

  const profile = adaptiveProfile(sortFaces(raw), top, limits);
  const breaks = [...new Set(tops.values())].filter((t) => t < top);
  const order = [...firstItem.keys()];
  const lines = order
    .filter((id) => onPlate.has(id) && tops.has(id))
    .map((id) => `object_id=${order.indexOf(id) + 1}|${profileUpTo(profile, breaks, tops.get(id)!).map((v) => v.toFixed(6)).join(";")}`);
  zip.file(PROFILE_FILE, `${lines.join("\n")}\n`);

  const layers = plannedLayers(profile, top, limits);
  const heights = layers.slice(1).map((z, i) => z - layers[i]);
  return {
    min: heights.length ? Math.min(...heights) : limits.base,
    max: heights.length ? Math.max(...heights) : limits.base,
    layers,
    fixedCount: 1 + Math.max(0, Math.ceil((top - limits.first) / limits.base - 0.5)),
  };
}

/** The same for a 3MF held in memory; returns the file with its profile. */
export async function addLayerHeights(threemf: Buffer, plate: number, limits: LayerLimits) {
  const zip = await JSZip.loadAsync(threemf);
  const plan = writeLayerHeights(zip, await loadProjectZip(zip), plate, limits);
  return { file: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), plan };
}

/**
 * Whether the sliced G-code has the planned layers. OrcaSlicer drops a profile without a word when it
 * does not end at the object's top, and then slices equal layers.
 */
export function layersApplied(gcodeFile: string, plan: LayerPlan): boolean {
  const sliced = [...fs.readFileSync(gcodeFile, "utf8").matchAll(/^;Z:([\d.]+)/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);
  let found = 0;
  let s = 0;
  for (const z of plan.layers) {
    while (s < sliced.length && sliced[s] < z - 0.002) s++;
    if (s < sliced.length && Math.abs(sliced[s] - z) <= 0.002) found++;
  }
  return found >= 0.9 * plan.layers.length;
}
