import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.ts";
import { MAX_BEDS } from "./packing.ts";
import { cleanOrient, type Orient } from "./orient.ts";
import { isUploadId } from "./uploads.ts";

/** The models waiting to be printed together on one plate, kept in ./data/plate.json. */

export type PlateEntry = {
  id: string;
  /** MakerWorld design and print profile; both 0 for an uploaded model. */
  designId: number;
  instanceId: number;
  /** An uploaded STL or 3MF (see uploads.ts) instead of a MakerWorld profile. */
  uploadId?: string;
  title: string;
  /** The MakerWorld print profile's name. */
  profile: string;
  cover: string;
  /** Plate of the profile to take the models from (1-based). */
  plate: number;
  /** Percent, 100 = as published. */
  size: number;
  /** Degrees, clockwise seen from above. */
  rotation: number;
  /** How the model lies on the bed (see orient.ts); missing = as published. */
  orient?: Orient;
  copies: number;
  /** U1 plate to print on (1-based) when several plates are needed; missing or 0 = placed automatically. */
  bed?: number;
  /** For each filament of the model (0-based), the U1 toolhead index (0..3). */
  filamentToTool: number[];
  addedAt: string;
};

/** `orient: null` (or an invalid rotation) puts the model back as published; JSON cannot carry undefined. */
export type PlateChange = Partial<Pick<PlateEntry, "size" | "rotation" | "copies" | "bed" | "filamentToTool">> & { orient?: Orient | null };

const FILE = path.join(DATA_DIR, "plate.json");

export function listPlate(): PlateEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, "utf8")) as PlateEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: PlateEntry[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
  return list;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const cleanTools = (list: unknown) => (Array.isArray(list) ? list : []).map((t) => clampInt(t, 0, 3, 0)).slice(0, 32);

function clean(change: PlateChange) {
  const out: Partial<Pick<PlateEntry, "size" | "rotation" | "orient" | "copies" | "bed" | "filamentToTool">> = {};
  if (change.size !== undefined) out.size = clampInt(change.size, 10, 500, 100);
  if (change.rotation !== undefined) out.rotation = ((clampInt(change.rotation, -3600, 3600, 0) % 360) + 360) % 360;
  if ("orient" in change) out.orient = cleanOrient(change.orient);
  if (change.copies !== undefined) out.copies = clampInt(change.copies, 1, 20, 1);
  if (change.bed !== undefined) out.bed = clampInt(change.bed, 0, MAX_BEDS, 0);
  if (change.filamentToTool !== undefined) out.filamentToTool = cleanTools(change.filamentToTool);
  return out;
}

export function addToPlate(input: Omit<PlateEntry, "id" | "addedAt">): PlateEntry[] {
  return write([...listPlate(), newEntry(input)]);
}

/** Adds several models at once, for example every plate of one print profile. */
export function addManyToPlate(inputs: Omit<PlateEntry, "id" | "addedAt">[]): PlateEntry[] {
  return write([...listPlate(), ...inputs.map(newEntry)]);
}

function newEntry(input: Omit<PlateEntry, "id" | "addedAt">): PlateEntry {
  return {
    id: crypto.randomUUID(),
    designId: input.uploadId ? 0 : Number(input.designId),
    instanceId: input.uploadId ? 0 : Number(input.instanceId),
    ...(input.uploadId && isUploadId(input.uploadId) ? { uploadId: input.uploadId } : {}),
    title: String(input.title ?? "").slice(0, 300),
    profile: String(input.profile ?? "").slice(0, 300),
    cover: String(input.cover ?? ""),
    plate: clampInt(input.plate, 1, 100, 1),
    size: 100,
    rotation: 0,
    copies: 1,
    ...clean(input),
    filamentToTool: cleanTools(input.filamentToTool),
    addedAt: new Date().toISOString(),
  };
}

export function updatePlateEntry(id: string, change: PlateChange): PlateEntry[] {
  return write(listPlate().map((e) => (e.id === id ? { ...e, ...clean(change) } : e)));
}

export function removePlateEntry(id: string): PlateEntry[] {
  return write(listPlate().filter((e) => e.id !== id));
}

export function clearPlate(): PlateEntry[] {
  return write([]);
}
