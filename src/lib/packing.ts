/**
 * Places several models on one U1 plate. Shared by the browser preview and the server, so the
 * layout people see is the layout that gets sliced.
 */

/** The U1 printable area in bed coordinates, and its height, in mm. */
export const U1_BED = { minX: 0.5, minY: 1, maxX: 270.5, maxY: 271, height: 270 };

/** Kept free for the prime tower: wipe_tower_x/y 15/220, 35 mm wide plus a 5 mm brim, with margin. */
export const TOWER_ZONE = { minX: 0, minY: 205, maxX: 65, maxY: 271 };

const MARGIN = 5;
const GAP = 6;

/** Width (X), depth (Y) and height after a uniform scale and a rotation around the vertical axis. */
export function footprint(bbox: number[], scale: number, rotation: number): [number, number, number] {
  const w = (bbox[3] - bbox[0]) * scale;
  const d = (bbox[4] - bbox[1]) * scale;
  const a = (rotation * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
  return [w * c + d * s, w * s + d * c, (bbox[5] - bbox[2]) * scale];
}

export type Placement = { x: number; y: number } | null;

/**
 * Shelf packing, front to back: rows of models from the front-left corner, deepest first, skipping
 * the prime tower corner. Footprints marked `first` are placed before the others. Returns each
 * footprint's centre on the bed, or null when it does not fit.
 */
export function packPlate(sizes: { w: number; d: number; first?: boolean }[]): Placement[] {
  const left = U1_BED.minX + MARGIN;
  const right = U1_BED.maxX - MARGIN;
  const back = U1_BED.maxY - MARGIN;
  const order = sizes
    .map((_, i) => i)
    .sort((a, b) => Number(Boolean(sizes[b].first)) - Number(Boolean(sizes[a].first)) || sizes[b].d - sizes[a].d || sizes[b].w - sizes[a].w || a - b);
  const result: Placement[] = sizes.map(() => null);
  let rowY = U1_BED.minY + MARGIN;
  let rowDepth = 0;
  let cursor = left;

  const clearOfTower = (x: number, y: number, w: number, d: number) =>
    x + w <= TOWER_ZONE.minX || x >= TOWER_ZONE.maxX || y + d <= TOWER_ZONE.minY || y >= TOWER_ZONE.maxY ? x : Math.max(x, TOWER_ZONE.maxX + GAP);

  for (const i of order) {
    const { w, d } = sizes[i];
    if (w > right - left || d > back - (U1_BED.minY + MARGIN)) continue;
    let x = clearOfTower(cursor, rowY, w, d);
    if (x + w > right) {
      rowY += rowDepth + GAP;
      rowDepth = 0;
      x = clearOfTower(left, rowY, w, d);
    }
    if (rowY + d > back || x + w > right) continue;
    result[i] = { x: x + w / 2, y: rowY + d / 2 };
    cursor = x + w + GAP;
    rowDepth = Math.max(rowDepth, d);
  }
  return result;
}

export type BedPlacement = { bed: number; x: number; y: number } | null;

/** More plates than this means something is wrong; stop rather than loop. */
export const MAX_BEDS = 20;

/**
 * Spreads footprints over as many U1 plates as needed, numbered from 1. A footprint with `bed` set is
 * pinned to that plate, placed before the others there, and moves on to the next plate if it does
 * not fit. The others fill plate 1, then overflow onto plate 2, and so on. Plates left empty are
 * dropped, so the result is always numbered 1..n. Null means the footprint is bigger than the bed.
 */
export function packBeds(sizes: { w: number; d: number; bed?: number }[]): BedPlacement[] {
  const result: BedPlacement[] = sizes.map(() => null);
  const pin = sizes.map((s) => (s.bed && s.bed > 0 ? Math.min(MAX_BEDS, Math.round(s.bed)) : 0));
  let remaining = sizes.map((_, i) => i).filter((i) => packPlate([sizes[i]])[0] !== null);
  for (let bed = 1; remaining.length && bed <= MAX_BEDS; bed++) {
    const candidates = remaining.filter((i) => pin[i] === 0 || pin[i] <= bed);
    if (!candidates.length) continue;
    const places = packPlate(candidates.map((i) => ({ ...sizes[i], first: pin[i] > 0 })));
    candidates.forEach((i, k) => {
      const place = places[k];
      if (place) result[i] = { bed, ...place };
    });
    remaining = remaining.filter((i) => !result[i]);
  }
  // Renumber the plates actually used, in order.
  const used = [...new Set(result.filter((p) => p).map((p) => p!.bed))].sort((a, b) => a - b);
  return result.map((p) => (p ? { ...p, bed: used.indexOf(p.bed) + 1 } : null));
}
