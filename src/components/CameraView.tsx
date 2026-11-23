"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "./Icons";

/**
 * Live view of the U1 camera. The stock firmware only offers a JPEG that it rewrites about 3.5 times
 * a second, so this polls our proxy and swaps frames once each one has fully loaded (no flicker).
 */
export function CameraView({ online }: { online: boolean }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [paused, setPaused] = useState(false);
  const lastUrl = useRef<string | null>(null);
  const failedRef = useRef(false);

  useEffect(() => {
    if (!online || paused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = async () => {
      try {
        const res = await fetch(`/api/printer/camera?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const url = URL.createObjectURL(await res.blob());
        if (!alive) return URL.revokeObjectURL(url);
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setFrame(url);
        setFailures(0);
        failedRef.current = false;
      } catch {
        failedRef.current = true;
        if (alive) setFailures((f) => f + 1);
      }
      // The stock camera refreshes about 3.5 times a second; poll a little faster, slower after errors.
      if (alive) timer = setTimeout(next, failedRef.current ? 2000 : 200);
    };
    timer = setTimeout(next, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [online, paused]);

  useEffect(() => () => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
  }, []);

  const stale = failures >= 3;
  return (
    <div className="camera">
      {online && frame && !paused ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frame} alt="Live camera view of the print bed" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <CameraIcon size={44} />
          <span className="small">{!online ? "Camera offline" : paused ? "Camera paused" : stale ? "Camera unavailable" : "Waking the camera…"}</span>
        </div>
      )}
      {online && (
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            className="badge"
            style={{ background: stale ? "#6B7280" : paused ? "#374151" : "#C62D2D", color: "#fff", fontSize: 12 }}
          >
            {stale ? "NO SIGNAL" : paused ? "PAUSED" : "LIVE"}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setPaused(!paused)} style={{ background: "rgba(255,255,255,.9)" }}>
            {paused ? "Resume camera" : "Pause camera"}
          </button>
        </div>
      )}
    </div>
  );
}
