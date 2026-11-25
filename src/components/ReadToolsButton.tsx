"use client";

import { useState } from "react";
import type { ToolLoad } from "@/lib/slicer.ts";
import { api } from "@/lib/format";

/**
 * Reads what is loaded in the four toolheads from the printer and saves it, so a filament change on the
 * printer does not need a trip to Settings.
 */
export function ReadToolsButton({ disabled, onTools }: { disabled?: boolean; onTools: (tools: ToolLoad[]) => void }) {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; error: boolean }>({ busy: false, msg: null, error: false });
  const read = async () => {
    setState({ busy: true, msg: null, error: false });
    try {
      const r = await api<{ tools: ToolLoad[]; changed: number }>("/api/printer/tools", { method: "POST", body: JSON.stringify({ save: true }) });
      onTools(r.tools);
      setState({ busy: false, msg: r.changed ? `Updated ${r.changed} toolhead${r.changed > 1 ? "s" : ""} and saved.` : "Already up to date.", error: false });
    } catch (e) {
      setState({ busy: false, msg: (e as Error).message, error: true });
    }
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-sm" onClick={read} disabled={disabled || state.busy}>
        {state.busy ? "Reading…" : "Read toolheads from printer"}
      </button>
      {state.msg && (
        <span className="small" style={{ color: state.error ? "var(--danger)" : "var(--muted)" }} role="status">
          {state.msg}
        </span>
      )}
    </div>
  );
}
