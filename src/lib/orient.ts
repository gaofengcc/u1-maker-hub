/**
 * How a piece lies on the bed: a rotation applied before anything else, after which the piece is
 * dropped onto the bed, resized and turned. Shared by the browser preview and the server, so the
 * preview, the plate layout and the sliced file agree.
 */

/** 3×3 rotation, row-major, for column vectors (v' = R·v). Missing means "as in the file". */
export type Orient = number[];

export const NO_ORIENT: Orient = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function isNoOrient(r: Orient | undefined) {
  return !r || r.every((v, i) => Math.abs(v - NO_ORIENT[i]) < 1e-9);
}

/** a·b: applying the result equals applying b, then a. */
export function multiply(a: Orient, b: Orient): Orient {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

export function apply(r: Orient, x: number, y: number, z: number): [number, number, number] {
  return [r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z];
}

/** A quarter or half turn about the bed's X (front-back tip) or Y (side tip) axis. */
export function tilt(axis: "x" | "y", degrees: number): Orient {
  const a = (degrees * Math.PI) / 180;
  const [c, s] = [Math.round(Math.cos(a) * 1e12) / 1e12, Math.round(Math.sin(a) * 1e12) / 1e12];
  return axis === "x" ? [1, 0, 0, 0, c, -s, 0, s, c] : [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** The rotation that turns direction n to point straight down, so the face with that normal lies on the bed. */
export function faceDown(n: [number, number, number]): Orient {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const [x, y, z] = [n[0] / len, n[1] / len, n[2] / len];
  // Rodrigues: R = I + [v]× + [v]×² / (1 + c), with v = n × down and c = n · down. Down is (0, 0, -1),
  // so v = (-y, x, 0) and c = -z.
  const c = -z;
  if (c > 1 - 1e-9) return [...NO_ORIENT];
  if (c < -1 + 1e-9) return tilt("x", 180); // facing straight up: flip over
  const [vx, vy] = [-y, x];
  const k = 1 / (1 + c);
  return [1 - k * vy * vy, k * vx * vy, vy, k * vx * vy, 1 - k * vx * vx, -vx, -vy, vx, c];
}

/** Bounding box [minX, minY, minZ, maxX, maxY, maxZ] of the points after the rotation. */
export function orientedBox(positions: ArrayLike<number>, r: Orient | undefined, bbox: number[]): number[] {
  if (isNoOrient(r)) return bbox;
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const p = apply(r!, positions[i], positions[i + 1], positions[i + 2]);
    for (let k = 0; k < 3; k++) {
      if (p[k] < out[k]) out[k] = p[k];
      if (p[k] > out[k + 3]) out[k + 3] = p[k];
    }
  }
  return out.every(Number.isFinite) ? out : bbox;
}

/** The rotation as a 3MF transform (row-vector convention, no translation), to chain with geometry.ts's mul. */
export function orientMat(r: Orient | undefined): number[] {
  const m = r ?? NO_ORIENT;
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8], 0, 0, 0];
}

/** A rotation sent by a browser: nine numbers forming a proper rotation, or undefined for none. */
export function cleanOrient(value: unknown): Orient | undefined {
  if (!Array.isArray(value) || value.length !== 9) return undefined;
  const r = value.map(Number);
  if (!r.every(Number.isFinite)) return undefined;
  // Rows must be unit length and at right angles, with determinant +1 (no mirroring).
  const row = (i: number) => r.slice(i * 3, i * 3 + 3);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(dot(row(i), row(j)) - (i === j ? 1 : 0)) > 1e-4) return undefined;
  const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
  if (Math.abs(det - 1) > 1e-4) return undefined;
  const rounded = r.map((v) => Math.round(v * 1e6) / 1e6);
  return isNoOrient(rounded) ? undefined : rounded;
}
