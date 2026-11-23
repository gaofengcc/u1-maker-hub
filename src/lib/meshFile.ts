import type { PlateMesh } from "./geometry.ts";

/**
 * Mesh bytes for the 3D preview, decoded by previewMesh.ts in the browser.
 * Layout: uint32 header length, JSON header ({ bbox, vertexCount, indexCount, groups }), padding to
 * 4 bytes, float32 positions (x, y, z in mm), then uint32 triangle indices grouped by filament.
 */
export function encodeMesh(mesh: PlateMesh): Buffer {
  const header = Buffer.from(
    JSON.stringify({ bbox: mesh.bbox, vertexCount: mesh.positions.length / 3, indexCount: mesh.indices.length, groups: mesh.groups }),
  );
  const headerEnd = 4 + header.length;
  const pad = (4 - (headerEnd % 4)) % 4;
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([
    length,
    header,
    Buffer.alloc(pad),
    Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength),
    Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength),
  ]);
}

export function meshResponseHeaders(length: number) {
  return { "Content-Type": "application/octet-stream", "Content-Length": String(length), "Cache-Control": "private, max-age=86400" };
}
