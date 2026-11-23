"use client";

import { useEffect, useRef, useState } from "react";
import { meshBox, type MeshData } from "@/lib/previewMesh";
import { createBedScene, type BedScene } from "@/lib/bedScene";
import type { Orient } from "@/lib/orient";

/** One model on the bed: where its footprint centre goes, how it lies, its size and rotation, and filament colours. */
export type BedPart = {
  key: string;
  mesh: MeshData;
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise seen from above. */
  rotation: number;
  /** Turned onto another side before the size and rotation (see orient.ts). */
  orient?: Orient;
  /** Display colour of each filament (index 1 = filament 1). */
  colors: string[];
};

/** Face picking: a click on a part's surface reports its key and the face normal in the model's own coordinates. */
export type FacePick = { accepts: (key: string) => boolean; onPick: (key: string, normal: [number, number, number]) => void };

type Ctx = BedScene & { geometries: Map<MeshData, import("three").BufferGeometry> };

/**
 * A three.js view of models on the U1 bed. three is loaded only when a viewer is shown.
 * With `fit`, the camera zooms onto the models when their geometry or orientation changes, for small parts on the big bed.
 */
export function BedViewer({ parts, fit = false, pick = null }: { parts: BedPart[]; fit?: boolean; pick?: FacePick | null }) {
  const box = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef("");
  // The pointer handlers are set up once; they read the current picking mode from here.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const scene = await createBedScene(el);
      if (disposed) return scene.dispose();
      const geometries = new Map<MeshData, import("three").BufferGeometry>();
      ctx.current = { ...scene, geometries };
      setReady(true);

      // A click (not a drag to turn the view) on a model face, while picking.
      const { THREE } = scene;
      const raycaster = new THREE.Raycaster();
      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        const p = pickRef.current;
        if (!p || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
        const rect = el.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), scene.camera);
        const hit = raycaster.intersectObjects(scene.root.children, true).find((h) => h.face && p.accepts(String(h.object.userData.key)));
        if (hit?.face) p.onPick(String(hit.object.userData.key), [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]);
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerup", onUp);

      cleanup = () => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerup", onUp);
        clearRoot(scene.root);
        geometries.forEach((g) => g.dispose());
        scene.dispose();
        ctx.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!ready || !c) return;
    const { THREE, root, geometries } = c;
    clearRoot(root);
    for (const part of parts) {
      let geometry = geometries.get(part.mesh);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(part.mesh.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
        part.mesh.groups.forEach((g, i) => geometry!.addGroup(g.start, g.count, i));
        geometries.set(part.mesh, geometry);
      }
      const materials = part.mesh.groups.map(
        (g) => new THREE.MeshStandardMaterial({ color: part.colors[g.filament] ?? "#9CA3AF", flatShading: true, roughness: 0.7, metalness: 0 }),
      );
      const model = new THREE.Mesh(geometry, materials);
      model.userData.key = part.key;
      // Orient in the file's coordinates, then rest the oriented box on the bed at the pivot.
      const oriented = new THREE.Group();
      if (part.orient) {
        const r = part.orient;
        oriented.matrixAutoUpdate = false;
        oriented.matrix.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      }
      oriented.add(model);
      const [minX, minY, minZ, maxX, maxY] = meshBox(part.mesh, part.orient);
      const holder = new THREE.Group();
      holder.position.set(-(minX + maxX) / 2, -(minY + maxY) / 2, -minZ);
      holder.add(oriented);
      const pivot = new THREE.Group();
      pivot.position.set(part.x, part.y, 0);
      pivot.scale.setScalar(part.scale);
      pivot.rotation.z = (-part.rotation * Math.PI) / 180;
      pivot.add(holder);
      root.add(pivot);
    }
    // Zoom onto new geometry or a new orientation once; size or rotation changes keep the view the person chose.
    const fitKey = parts.map((p) => `${p.key}:${p.orient?.join(",") ?? ""}`).join("|");
    if (fit && parts.length && fitted.current !== fitKey) {
      fitted.current = fitKey;
      c.frame(new THREE.Box3().setFromObject(root));
    }
    c.render();
  }, [ready, parts, fit]);

  return <div ref={box} className={`preview-box${pick ? " picking" : ""}`} />;
}

function clearRoot(root: import("three").Group) {
  for (const pivot of [...root.children]) {
    pivot.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh) (mesh.material as import("three").Material[]).forEach((m) => m.dispose());
    });
    root.remove(pivot);
  }
}
