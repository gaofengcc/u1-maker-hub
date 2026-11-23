"use client";

import { useEffect, useMemo, useState } from "react";
import { CubeIcon } from "./Icons";
import { BedViewer, type FacePick } from "./BedViewer";
import { layFaceFlat, OrientControls } from "./OrientControls";
import { meshBox, type MeshData } from "@/lib/previewMesh";
import { footprint, U1_BED } from "@/lib/packing";
import { isNoOrient, type Orient } from "@/lib/orient";

const SIZES = [50, 75, 100, 150, 200];

type Props = {
  /** Identifies the geometry: a new key loads it again. */
  meshKey: string;
  loadMesh: () => Promise<MeshData>;
  /** Show the preview straight away, zoomed onto the model, instead of behind a button. */
  autoShow?: boolean;
  /** Position in the page's flex layout. */
  order?: number;
  /** Percent, 100 = as published. */
  size: number;
  rotation: number;
  /** How the piece lies on the bed; missing = as in the file. */
  orient: Orient | undefined;
  onSize: (percent: number) => void;
  onRotation: (degrees: number) => void;
  onOrient: (orient: Orient | undefined) => void;
  /** Printed width, depth and height, once the model is loaded; null before. */
  onDims?: (dims: [number, number, number] | null) => void;
  /** Display colour of each filament slot (index 1 = filament 1). */
  colors: string[];
  canDownload: boolean;
  /** Why the preview cannot be shown when `canDownload` is false. */
  unavailableHint?: string;
};

/** Resize, rotate and lay the plate on another side, with a 3D preview on the U1 bed. Sits just above the print buttons. */
export function SizePanel({
  meshKey: key,
  loadMesh,
  autoShow = false,
  order = 6,
  size,
  rotation,
  orient,
  onSize,
  onRotation,
  onOrient,
  onDims,
  colors,
  canDownload,
  unavailableHint = "The preview needs the 3MF, so log in with your Bambu account in Settings.",
}: Props) {
  const [show, setShow] = useState(autoShow);
  const [loaded, setLoaded] = useState<{ key: string; mesh: MeshData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const mesh = loaded?.key === key ? loaded.mesh : null;

  useEffect(() => {
    if (!show || mesh) return;
    let alive = true;
    loadMesh()
      .then((m) => alive && setLoaded({ key, mesh: m }))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // loadMesh changes on every render of the page; the key says when the geometry does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, mesh, key]);

  // The page rebuilds the colour list on every render; only a real change should redraw the model.
  const colorKey = colors.join(",");
  const parts = useMemo(
    () =>
      mesh
        ? [
            {
              key: "model",
              mesh,
              x: (U1_BED.minX + U1_BED.maxX) / 2,
              y: (U1_BED.minY + U1_BED.maxY) / 2,
              scale: size / 100,
              rotation,
              orient,
              colors: colorKey.split(","),
            },
          ]
        : [],
    [mesh, size, rotation, orient, colorKey],
  );
  const pick: FacePick | null = useMemo(
    () =>
      picking
        ? {
            accepts: () => true,
            onPick: (_key, normal) => {
              onOrient(layFaceFlat(orient, normal));
              setPicking(false);
            },
          }
        : null,
    [picking, orient, onOrient],
  );

  const dims = mesh ? footprint(meshBox(mesh, orient), size / 100, rotation) : null;
  const dimsKey = dims?.map((v) => v.toFixed(2)).join(",") ?? "";
  // Tell the page the printed size, so it can block printing what does not fit.
  useEffect(() => {
    onDims?.(dimsKey ? (dimsKey.split(",").map(Number) as [number, number, number]) : null);
    // onDims is a new function on every render of the page; the size is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimsKey]);
  const bedW = U1_BED.maxX - U1_BED.minX;
  const bedD = U1_BED.maxY - U1_BED.minY;
  const tooBig = dims && (dims[0] > bedW || dims[1] > bedD || dims[2] > U1_BED.height);
  const changed = size !== 100 || rotation !== 0 || !isNoOrient(orient);

  return (
    <section className="panel" style={{ order }} aria-labelledby="size-title">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 id="size-title">Size &amp; preview</h2>
        {changed && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              onSize(100);
              onRotation(0);
              onOrient(undefined);
              setPicking(false);
            }}
          >
            Reset
          </button>
        )}
      </div>

      <label className="field" htmlFor="size">
        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
          <span style={{ fontWeight: 500 }}>Size</span>
          <strong style={{ fontSize: 16 }}>{size}%</strong>
        </span>
        <input id="size" type="range" min={10} max={300} step={5} value={size} onChange={(e) => onSize(Number(e.target.value))} />
      </label>
      <div className="chips" role="group" aria-label="Quick sizes">
        {SIZES.map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={size === s} onClick={() => onSize(s)}>
            {s}%
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>Rotation on the bed · {rotation}°</span>
        <button type="button" className="btn btn-sm" onClick={() => onRotation((rotation + 270) % 360)} aria-label="Rotate 90 degrees counterclockwise">
          ↺ 90°
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onRotation((rotation + 90) % 360)} aria-label="Rotate 90 degrees clockwise">
          ↻ 90°
        </button>
      </div>

      {dims && (
        <p className="small" style={{ margin: 0 }}>
          <span className="muted">Printed size: </span>
          <strong>
            {dims[0].toFixed(0)} × {dims[1].toFixed(0)} × {dims[2].toFixed(0)} mm
          </strong>
        </p>
      )}
      {tooBig && (
        <div className="notice error">
          At this size the model does not fit the U1 ({bedW.toFixed(0)} × {bedD.toFixed(0)} × {U1_BED.height} mm).
        </div>
      )}

      {!show ? (
        <button type="button" className="btn" onClick={() => setShow(true)} disabled={!canDownload}>
          <CubeIcon size={18} /> Show 3D preview
        </button>
      ) : (
        <>
          {!mesh && !error && <div className="preview-box muted small">Loading the model…</div>}
          {error && <div className="notice error">{error}</div>}
          {mesh && <OrientControls orient={orient} onOrient={onOrient} picking={picking} onPicking={setPicking} />}
          {mesh && <BedViewer parts={parts} fit pick={pick} />}
          {mesh && (
            <p className="small muted" style={{ margin: 0 }}>
              {picking
                ? "Click the face of the model that should touch the bed. Drag still turns the view."
                : "Drag to turn, pinch or scroll to zoom. The grid is the U1 bed, 1 cm squares. Laying the model on another side changes where it needs supports."}
            </p>
          )}
        </>
      )}
      {!show && !isNoOrient(orient) && <p className="small muted" style={{ margin: 0 }}>Laid on another side. Show the 3D preview to check it.</p>}
      {!canDownload && !show && <p className="small muted" style={{ margin: 0 }}>{unavailableHint}</p>}
    </section>
  );
}
