"use client";

/** Sliced toolpaths for the layer preview, decoded from /api/jobs/[id]/toolpath (layout in toolpath.ts). */

export type ToolpathFeature = {
  type: string;
  /** Extruded length in mm, to compare features. */
  mm: number;
  positions: Float32Array;
  /** Line segment pairs, in layer order. */
  indices: Uint32Array;
  /** For each layer, how many indices draw it and every layer below. */
  layerEnd: Uint32Array;
};

export type Toolpath = { layers: number[]; bbox: number[]; features: ToolpathFeature[] };

const cache = new Map<string, Promise<Toolpath>>();

export function loadToolpath(jobId: string, plate: number): Promise<Toolpath> {
  const key = `${jobId}:${plate}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(`/api/jobs/${jobId}/toolpath?plate=${plate}`).then(async (res) => {
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Layer preview failed (${res.status}).`);
      return decode(await res.arrayBuffer());
    });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

function decode(buf: ArrayBuffer): Toolpath {
  const view = new DataView(buf);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLength))) as {
    layers: number[];
    bbox: number[];
    features: { type: string; points: number; runs: number; mm: number }[];
  };
  const align = (n: number) => n + ((4 - (n % 4)) % 4);
  let offset = align(4 + headerLength);
  const layerCount = header.layers.length;

  const features = header.features.map((f) => {
    const points = new Uint16Array(buf, offset, f.points * 3);
    offset = align(offset + points.byteLength);
    const runs = new Uint32Array(buf, offset, f.runs);
    offset += runs.byteLength;

    const positions = new Float32Array(f.points * 3);
    for (let p = 0; p < f.points; p++) {
      positions[p * 3] = points[p * 3] / 100;
      positions[p * 3 + 1] = points[p * 3 + 1] / 100;
      positions[p * 3 + 2] = header.layers[points[p * 3 + 2]] ?? 0;
    }
    const indices = new Uint32Array((f.points - f.runs) * 2);
    const layerEnd = new Uint32Array(layerCount);
    let n = 0;
    for (let r = 0; r < f.runs; r++) {
      const end = r + 1 < f.runs ? runs[r + 1] : f.points;
      for (let k = runs[r]; k < end - 1; k++) {
        indices[n++] = k;
        indices[n++] = k + 1;
        layerEnd[points[(k + 1) * 3 + 2]] = n;
      }
    }
    // Layers without this feature draw as much as the layer below them.
    for (let l = 1; l < layerCount; l++) if (layerEnd[l] < layerEnd[l - 1]) layerEnd[l] = layerEnd[l - 1];
    return { type: f.type, mm: f.mm, positions, indices: indices.subarray(0, n), layerEnd };
  });
  return { layers: header.layers, bbox: header.bbox, features };
}
