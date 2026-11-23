"use client";

/** Geometry for the 3D preview, fetched once per profile and plate (see /api/preview) or per upload. */

import { isNoOrient, orientedBox, type Orient } from "./orient";

export type MeshData = {
  /** [minX, minY, minZ, maxX, maxY, maxZ] in mm. */
  bbox: number[];
  positions: Float32Array;
  indices: Uint32Array;
  groups: { filament: number; start: number; count: number }[];
};

const cache = new Map<string, Promise<MeshData>>();
const boxes = new WeakMap<MeshData, Map<string, number[]>>();

/** The mesh's bounding box after an orientation; cached, since big models have hundreds of thousands of points. */
export function meshBox(mesh: MeshData, orient?: Orient): number[] {
  if (isNoOrient(orient)) return mesh.bbox;
  let byOrient = boxes.get(mesh);
  if (!byOrient) boxes.set(mesh, (byOrient = new Map()));
  const key = orient!.join(",");
  let box = byOrient.get(key);
  if (!box) byOrient.set(key, (box = orientedBox(mesh.positions, orient, mesh.bbox)));
  return box;
}

export function loadPreviewMesh(instanceId: number, plate: number): Promise<MeshData> {
  return loadMesh(`/api/preview/${instanceId}?plate=${plate}`);
}

export function loadUploadMesh(uploadId: string, plate = 1): Promise<MeshData> {
  return loadMesh(`/api/uploads/${uploadId}/mesh?plate=${plate}`);
}

function loadMesh(url: string): Promise<MeshData> {
  const key = url;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Preview failed (${res.status}).`);
      return decode(await res.arrayBuffer());
    });
    // A failed download can be retried later.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

function decode(buf: ArrayBuffer): MeshData {
  const view = new DataView(buf);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLength)));
  let offset = 4 + headerLength;
  offset += (4 - (offset % 4)) % 4;
  const positions = new Float32Array(buf, offset, header.vertexCount * 3);
  const indices = new Uint32Array(buf, offset + positions.byteLength, header.indexCount);
  return { bbox: header.bbox, positions, indices, groups: header.groups };
}
