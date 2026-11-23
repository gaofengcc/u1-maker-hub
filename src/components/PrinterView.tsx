"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PrinterStatus, ToolState } from "@/lib/printer.ts";
import type { Job } from "@/lib/jobs.ts";
import { api, duration, inkFor } from "@/lib/format";
import { PauseIcon, PlayIcon, PowerIcon, StopIcon } from "./Icons";
import { CameraView } from "./CameraView";

type StatusResponse =
  | (PrinterStatus & { configured: true; history?: HistoryItem[] })
  | { online: false; configured: boolean; error?: string };
type HistoryItem = { filename: string; status: string; print_duration: number; end_time: number };
/** The printer's smart plug in Home Assistant (see /api/printer/power). */
type PowerResponse = { configured: false } | { configured: true; state: string; name?: string; error?: string };

export function PrinterView() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [power, setPower] = useState<PowerResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<StatusResponse>("/api/printer/status?history=1"));
    } catch (e) {
      setStatus({ online: false, configured: true, error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    api<Job[]>("/api/jobs").then(setJobs).catch(() => {});
    const t = setInterval(load, 2000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const loadPower = useCallback(async () => {
    try {
      setPower(await api<PowerResponse>("/api/printer/power"));
    } catch {
      /* keep the last state */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadPower(), 0);
    const t = setInterval(loadPower, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadPower]);

  const act = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(String(body.action));
    setActionError(null);
    try {
      await api("/api/printer/action", { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  const switchPower = async (on: boolean) => {
    if (!on && !window.confirm("Turn the printer off? This cuts its power.")) return;
    setPending("power");
    setActionError(null);
    try {
      setPower(await api<PowerResponse>("/api/printer/power", { method: "POST", body: JSON.stringify({ on }) }));
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(null);
    }
  };

  if (!status) return <main className="container muted">Connecting to the printer…</main>;

  if (!status.configured) {
    return (
      <main className="container">
        <section className="panel" style={{ maxWidth: 560 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>No printer yet</h1>
          <p className="muted">Add your Snapmaker U1&apos;s network address to see its state and control it from here.</p>
          <Link className="btn btn-primary" href="/settings" style={{ alignSelf: "flex-start" }}>
            Open Settings
          </Link>
        </section>
      </main>
    );
  }

  const online = status.online === true;
  const s = online ? (status as PrinterStatus & { history?: HistoryItem[] }) : null;
  const printing = s?.state === "printing" || s?.state === "paused";

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Snapmaker U1</h1>
          <span className={`badge ${!online ? "red" : s?.state === "error" ? "red" : printing ? "green" : ""}`} style={{ fontSize: 13, padding: "6px 12px" }}>
            {!online ? "Offline" : stateLabel(s!.state, s!.klippy)}
          </span>
          {s?.message && <span className="small muted">{s.message}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {printing && (
            <>
              {s?.state === "paused" ? (
                <button className="btn" disabled={!!pending} onClick={() => act({ action: "resume" })}>
                  <PlayIcon size={18} /> Resume
                </button>
              ) : (
                <button className="btn" disabled={!!pending} onClick={() => act({ action: "pause" })}>
                  <PauseIcon size={18} /> Pause
                </button>
              )}
              <button className="btn btn-danger" disabled={!!pending} onClick={() => act({ action: "cancel" }, "Cancel this print? It cannot be resumed.")}>
                <StopIcon size={18} /> Cancel
              </button>
            </>
          )}
          {power?.configured && <PowerButton power={power} printing={printing} pending={pending} onSwitch={switchPower} />}
        </div>
      </section>

      {!online && <div className="notice error">{(status as { error?: string }).error ?? "The printer does not answer."}</div>}
      {actionError && <div className="notice error">{actionError}</div>}

      {/* On phones the two columns merge into one; `order` keeps the controls above the job history. */}
      <div className="two-col">
        <section className="col-main">
          <div style={{ order: 1 }}>
            <CameraView online={online} />
          </div>

          {s && (
            <section className="panel" style={{ order: 2 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 700 }}>{s.filename || "No active print"}</span>
                  <span className="small muted">
                    {s.layer != null && s.totalLayers ? `Layer ${s.layer} of ${s.totalLayers}` : printing ? "Starting…" : "Idle"}
                    {printing ? ` · ${duration(s.printSeconds)} elapsed` : ""}
                  </span>
                </div>
                {printing && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span style={{ fontSize: 28, fontWeight: 700 }}>{Math.round(s.progress * 100)}%</span>
                    <span className="small muted">{s.etaSeconds ? `${duration(s.etaSeconds)} left` : ""}</span>
                  </div>
                )}
              </div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(s.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Print progress">
                <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
            </section>
          )}

          <section className="panel" style={{ order: 6 }}>
            <h2>Recent jobs from this app</h2>
            {jobs.length === 0 ? (
              <p className="small muted">
                Nothing yet. Pick a model in <Link href="/">Explore</Link>.
              </p>
            ) : (
              <div className="table-wrap">
                <table style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">U1 time</th>
                      <th scope="col">Result</th>
                      <th scope="col">
                        <span className="sr-only">Files</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td>
                          <Link href={j.upload ? `/upload?id=${j.upload.id}` : `/model/${j.designId}`}>{j.title}</Link>
                        </td>
                        <td className="muted">{duration(j.stats.seconds)}</td>
                        <td>
                          <span className={`badge ${j.status === "error" ? "red" : j.status === "done" ? "green" : ""}`}>
                            {j.status === "error" ? "Failed" : j.status === "running" ? "Working" : j.send ? "Sent" : "Sliced"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {j.files.gcode.length > 0 && (
                            <a className="btn btn-sm" href={`/api/jobs/${j.id}/file?kind=gcode`}>
                              G-code
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s?.history && s.history.length > 0 && (
              <>
                <h2 style={{ marginTop: 8 }}>Printer history</h2>
                <div className="table-wrap">
                  <table style={{ minWidth: 420 }}>
                    <tbody>
                      {s.history.map((h, i) => (
                        <tr key={i}>
                          <td>{h.filename}</td>
                          <td className="muted">{duration(h.print_duration)}</td>
                          <td>
                            <span className={`badge ${h.status === "completed" ? "green" : h.status === "cancelled" || h.status === "error" ? "red" : ""}`}>{h.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </section>

        <aside className="col-side">
          {s && (
            <section className="panel" style={{ order: 3 }}>
              <h2>Toolheads</h2>
              {s.tools.map((t) => (
                <ToolRow key={t.index} tool={t} disabled={!!pending} onSet={(value) => act({ action: "nozzle", tool: t.index, value })} />
              ))}
              <div className="tool">
                <span className="tool-chip" style={{ background: "#F1F2F4" }}>
                  Bed
                </span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>Heated bed</span>
                <span className="temp">
                  {Math.round(s.bed.temp)} / {Math.round(s.bed.target)} °C
                </span>
              </div>
            </section>
          )}

          {s && (
            <section className="panel" style={{ order: 4 }}>
              <h2>Live adjustments</h2>
              <Slider label="Print speed" unit="%" min={50} max={200} step={10} value={Math.round(s.speedFactor * 100)} onCommit={(v) => act({ action: "speed", value: v })} />
              <Slider label="Part cooling fan" unit="%" min={0} max={100} step={10} value={Math.round(s.fanSpeed * 100)} onCommit={(v) => act({ action: "fan", value: v })} />
              <label className="switch" style={{ justifyContent: "space-between", fontWeight: 500 }}>
                Chamber light
                <input type="checkbox" role="switch" checked={s.light} onChange={(e) => act({ action: "light", on: e.target.checked })} />
              </label>
            </section>
          )}

          {s && (
            <section className="panel" style={{ order: 5 }}>
              <h2>Machine</h2>
              <p className="small muted">{printing ? "Disabled while a print is running." : "Quick actions while the printer is idle."}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <button className="btn" disabled={printing || !!pending} onClick={() => act({ action: "home" })}>
                  Home all axes
                </button>
                <button className="btn" disabled={printing || !!pending} onClick={() => act({ action: "bed", value: 60 })}>
                  Preheat bed 60°
                </button>
                <button className="btn" disabled={printing || !!pending} onClick={() => act({ action: "nozzle", tool: 0, value: 220 })}>
                  Preheat T1 220°
                </button>
                <button className="btn" disabled={printing || !!pending} onClick={() => act({ action: "cooldown" })}>
                  Cool down
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function stateLabel(state: string, klippy: string) {
  if (klippy && klippy !== "ready") return `Firmware ${klippy}`;
  return { printing: "Printing", paused: "Paused", complete: "Finished", cancelled: "Cancelled", error: "Error", standby: "Ready" }[state] ?? state;
}

/** On/off for the printer's plug. Off is blocked while printing; the server refuses it too. */
function PowerButton({
  power,
  printing,
  pending,
  onSwitch,
}: {
  power: Extract<PowerResponse, { configured: true }>;
  printing: boolean;
  pending: string | null;
  onSwitch: (on: boolean) => void;
}) {
  if (power.state === "on") {
    return (
      <button
        type="button"
        className="btn"
        disabled={printing || !!pending}
        onClick={() => onSwitch(false)}
        title={printing ? "Not while a print is running" : `Turn off ${power.name ?? "the plug"} in Home Assistant`}
      >
        <PowerIcon size={18} /> {pending === "power" ? "Turning off…" : "Turn off"}
      </button>
    );
  }
  if (power.state === "off") {
    return (
      <button type="button" className="btn btn-primary" disabled={!!pending} onClick={() => onSwitch(true)} title={`Turn on ${power.name ?? "the plug"} in Home Assistant`}>
        <PowerIcon size={18} /> {pending === "power" ? "Turning on…" : "Turn on"}
      </button>
    );
  }
  return (
    <button type="button" className="btn" disabled title={power.error ?? `The plug is ${power.state} in Home Assistant`}>
      <PowerIcon size={18} /> Plug {power.error ? "unreachable" : power.state}
    </button>
  );
}

function ToolRow({ tool, onSet, disabled }: { tool: ToolState; onSet: (v: number) => void; disabled: boolean }) {
  const color = tool.filament.loaded ? tool.filament.color : "#E5E7EB";
  return (
    <div className={`tool ${tool.active ? "active" : ""}`}>
      <span className="tool-chip" style={{ background: color, color: inkFor(color) }}>
        T{tool.index + 1}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tool.filament.loaded ? `${tool.filament.vendor} ${tool.filament.type}`.trim() || "Filament" : "Empty"}</span>
        <span className="small muted">{tool.active ? "Printing" : tool.state ? tool.state.toLowerCase() : "parked"}</span>
      </div>
      <span className="temp">
        {Math.round(tool.temp)}
        {tool.target ? ` / ${Math.round(tool.target)}` : ""} °C
      </span>
      {tool.target > 0 && (
        <button className="btn btn-sm" disabled={disabled} onClick={() => onSet(0)} aria-label={`Turn off heater T${tool.index + 1}`}>
          Off
        </button>
      )}
    </div>
  );
}

function Slider({ label, unit, min, max, step, value, onCommit }: { label: string; unit: string; min: number; max: number; step: number; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <label className="field" htmlFor={id}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <strong>
          {shown}
          {unit}
        </strong>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => {
          if (draft != null) onCommit(draft);
          setDraft(null);
        }}
        onKeyUp={() => {
          if (draft != null) onCommit(draft);
          setDraft(null);
        }}
      />
    </label>
  );
}
