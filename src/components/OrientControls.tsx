"use client";

import { faceDown, isNoOrient, multiply, NO_ORIENT, tilt, type Orient } from "@/lib/orient";

/** The new orientation once the clicked face (normal in the model's own coordinates) lies on the bed. */
export function layFaceFlat(orient: Orient | undefined, normal: [number, number, number]): Orient | undefined {
  const r = orient ?? NO_ORIENT;
  const n: [number, number, number] = [
    r[0] * normal[0] + r[1] * normal[1] + r[2] * normal[2],
    r[3] * normal[0] + r[4] * normal[1] + r[5] * normal[2],
    r[6] * normal[0] + r[7] * normal[1] + r[8] * normal[2],
  ];
  const next = multiply(faceDown(n), r);
  return isNoOrient(next) ? undefined : next;
}

type Props = {
  orient: Orient | undefined;
  onOrient: (orient: Orient | undefined) => void;
  /** Whether the next click on the model lays that face on the bed. */
  picking: boolean;
  onPicking: (on: boolean) => void;
  compact?: boolean;
};

/**
 * Turns a piece onto another side: quarter turns about the bed's axes, or a click on the face that
 * should lie on the bed. This changes how the piece prints (overhangs, supports, strength).
 */
export function OrientControls({ orient, onOrient, picking, onPicking, compact = false }: Props) {
  const turn = (axis: "x" | "y", degrees: number) => {
    const next = multiply(tilt(axis, degrees), orient ?? NO_ORIENT);
    onOrient(isNoOrient(next) ? undefined : next);
  };
  return (
    <div className="orient-controls" role="group" aria-label="Lay on another side">
      {!compact && <span className="orient-title">Lay on another side</span>}
      <button type="button" className="btn btn-sm" onClick={() => turn("x", -90)} aria-label="Tip backwards a quarter turn" title="Tip backwards">
        ⤒ Tip back
      </button>
      <button type="button" className="btn btn-sm" onClick={() => turn("x", 90)} aria-label="Tip forwards a quarter turn" title="Tip forwards">
        ⤓ Tip forward
      </button>
      <button type="button" className="btn btn-sm" onClick={() => turn("y", 90)} aria-label="Tip onto its side a quarter turn" title="Tip onto its side">
        ⇥ On its side
      </button>
      <button type="button" className="btn btn-sm" aria-pressed={picking} onClick={() => onPicking(!picking)} title="Then click the face that should touch the bed">
        {picking ? "Click a face… (cancel)" : "▣ Lay a face flat"}
      </button>
      {!isNoOrient(orient) && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            onOrient(undefined);
            onPicking(false);
          }}
        >
          Back as in the file
        </button>
      )}
    </div>
  );
}
