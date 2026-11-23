"use client";

import { useEffect, useRef, useState } from "react";
import { createBedScene, type BedScene } from "@/lib/bedScene";
import { loadToolpath, type Toolpath } from "@/lib/toolpathView";

/** Feature colours, close to OrcaSlicer's preview so the two look alike. Supports stand out in green. */
const FEATURE_COLORS: Record<string, string> = {
  "Outer wall": "#F59E0B",
  "Inner wall": "#FCD34D",
  "Overhang wall": "#2563EB",
  "Top surface": "#E11D48",
  "Bottom surface": "#9333EA",
  "Internal solid infill": "#C084FC",
  "Sparse infill": "#B45309",
  Bridge: "#0EA5E9",
  "Internal Bridge": "#7DD3FC",
  "Gap infill": "#64748B",
  Support: "#16A34A",
  "Support interface": "#86EFAC",
  "Support transition": "#4ADE80",
  Brim: "#0F766E",
  Skirt: "#0F766E",
  "Prime tower": "#6B7280",
  Ironing: "#F472B6",
};
const colorOf = (type: string) => FEATURE_COLORS[type] ?? "#9CA3AF";
const isSupport = (type: string) => type.startsWith("Support");

type Line = import("three").LineSegments<import("three").BufferGeometry, import("three").LineBasicMaterial>;

/** The sliced G-code in 3D, layer by layer, with each feature in its own colour. */
export function ToolpathViewer({ jobId, plates }: { jobId: string; plates: number }) {
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<BedScene | null>(null);
  const lines = useRef<Map<string, Line>>(new Map());
  const [ready, setReady] = useState(false);
  const [plate, setPlate] = useState(1);
  const [loaded, setLoaded] = useState<{ key: string; toolpath: Toolpath } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const key = `${jobId}:${plate}`;
  const toolpath = loaded?.key === key ? loaded.toolpath : null;
  const top = toolpath ? Math.min(layer ?? toolpath.layers.length - 1, toolpath.layers.length - 1) : 0;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    void createBedScene(el).then((s) => {
      if (disposed) return s.dispose();
      scene.current = s;
      setReady(true);
      cleanup = () => {
        lines.current.forEach((l) => {
          l.geometry.dispose();
          l.material.dispose();
        });
        lines.current.clear();
        s.dispose();
        scene.current = null;
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadToolpath(jobId, plate)
      .then((t) => alive && setLoaded({ key: `${jobId}:${plate}`, toolpath: t }))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [jobId, plate]);

  // One set of lines per feature, rebuilt when the plate changes.
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s || !toolpath) return;
    const { THREE } = s;
    lines.current.forEach((l) => {
      s.root.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    });
    lines.current.clear();
    for (const f of toolpath.features) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(f.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(f.indices, 1));
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: colorOf(f.type) }));
      line.frustumCulled = false;
      lines.current.set(f.type, line);
      s.root.add(line);
    }
    const [x0, y0, z0, x1, y1, z1] = toolpath.bbox;
    s.frame(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  }, [ready, toolpath]);

  // Draw every layer up to the slider, and only the features that are switched on.
  useEffect(() => {
    const s = scene.current;
    if (!ready || !s || !toolpath) return;
    for (const f of toolpath.features) {
      const line = lines.current.get(f.type);
      if (!line) continue;
      line.visible = !hidden.has(f.type);
      line.geometry.setDrawRange(0, f.layerEnd[top] ?? 0);
    }
    s.render();
  }, [ready, toolpath, top, hidden]);

  const total = toolpath?.features.reduce((n, f) => n + f.mm, 0) ?? 0;
  const supportShare = toolpath && total ? toolpath.features.filter((f) => isSupport(f.type)).reduce((n, f) => n + f.mm, 0) / total : 0;
  const toggle = (type: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div className="toolpath">
      <div>
        <div ref={box} className="preview-box">
          {!toolpath && !error && <span className="muted small">Reading the G-code…</span>}
        </div>
        {error && <div className="notice error">{error}</div>}
      </div>
      <div className="toolpath-controls">
        {plates > 1 && (
          <label className="field" htmlFor={`tp-plate-${jobId}`}>
            <span className="label">U1 plate</span>
            <select
              id={`tp-plate-${jobId}`}
              className="select"
              value={plate}
              onChange={(e) => {
                setPlate(Number(e.target.value));
                setLayer(null);
              }}
            >
              {Array.from({ length: plates }, (_, i) => (
                <option key={i} value={i + 1}>
                  Plate {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        {toolpath && (
          <>
            <label className="field" htmlFor={`tp-layer-${jobId}`}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ fontWeight: 500 }}>Layer</span>
                <strong>
                  {top + 1} of {toolpath.layers.length} · {toolpath.layers[top]?.toFixed(2)} mm
                </strong>
              </span>
              <input
                id={`tp-layer-${jobId}`}
                type="range"
                min={0}
                max={toolpath.layers.length - 1}
                value={top}
                onChange={(e) => setLayer(Number(e.target.value))}
              />
            </label>
            <div className={`notice small${supportShare > 0 ? " ok" : ""}`}>
              {supportShare > 0
                ? `Supports are in this slice: ${(supportShare * 100).toFixed(1)}% of the extruded length, shown in green.`
                : "No supports in this slice. Check that overhangs (blue) are gentle enough to print in the air."}
            </div>
            <ul className="toolpath-legend" aria-label="Features">
              {toolpath.features.map((f) => (
                <li key={f.type}>
                  <label>
                    <input type="checkbox" checked={!hidden.has(f.type)} onChange={() => toggle(f.type)} />
                    <span className="swatch" style={{ width: 14, height: 14, background: colorOf(f.type) }} />
                    <span style={{ flex: 1 }}>{f.type}</span>
                    <span className="muted">{total ? `${((f.mm / total) * 100).toFixed(1)}%` : ""}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              Drag to turn, pinch or scroll to zoom. Move the layer slider down to look inside. Untick a feature to hide it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
