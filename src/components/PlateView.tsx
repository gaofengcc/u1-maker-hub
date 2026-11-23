"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Job } from "@/lib/jobs.ts";
import type { PlateChange, PlateEntry } from "@/lib/plate.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import { api, duration, euros, inkFor, mwImage, slicedPrice } from "@/lib/format";
import { footprint, MAX_BEDS, packBeds } from "@/lib/packing";
import { loadPreviewMesh, loadUploadMesh, meshBox, type MeshData } from "@/lib/previewMesh";
import { usePlate } from "@/lib/usePlate";
import { BedViewer, type BedPart, type FacePick } from "./BedViewer";
import { layFaceFlat, OrientControls } from "./OrientControls";
import { JobProgress, PresetPicker, shortPreset, type Mode } from "./PrintSetup";
import { PrintOptionsPanel } from "./PrintOptions";
import { useCreatorSupports, useSupportsOption } from "@/lib/useCreatorSupports";
import { DownloadIcon, SendIcon } from "./Icons";

type Props = {
  settings: { loggedIn: boolean; printerConfigured: boolean; tools: ToolLoad[] };
  modes: Mode[];
  defaults: PrintOptions;
};

/** Several models printed together: the list, the packed layout on the U1 bed, and the print buttons. */
export function PlateView({ settings, modes, defaults }: Props) {
  const { entries, ready, update, remove, clear } = usePlate();
  const [meshes, setMeshes] = useState<Record<string, MeshData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState(modes[0]?.key ?? "fast");
  const [baseOptions, setOptions] = useState<PrintOptions>(defaults);
  // Supports are on when any model's creator used them, until the person picks a value.
  const creatorSupports = useCreatorSupports(
    // Uploads have no MakerWorld profile to read the creator's supports from.
    entries.filter((e) => !e.uploadId).map((e) => e.instanceId),
    settings.loggedIn,
  );
  const supportsOption = useSupportsOption(baseOptions, setOptions, creatorSupports, defaults);
  const options = supportsOption.value;
  const [job, setJob] = useState<Job | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** The U1 plate shown in the layout preview (1-based). */
  const [viewBed, setViewBed] = useState(1);
  /** The model whose next clicked face is laid on the bed. */
  const [pickingId, setPickingId] = useState<string | null>(null);

  const meshKey = (e: PlateEntry) => (e.uploadId ? `upload:${e.uploadId}:${e.plate}` : `${e.instanceId}:${e.plate}`);

  // The geometry of every model, for the preview and to know how much room each one takes.
  // MakerWorld models need the Bambu login to download; uploads are already here.
  useEffect(() => {
    let alive = true;
    for (const e of entries) {
      if (!e.uploadId && !settings.loggedIn) continue;
      const key = meshKey(e);
      (e.uploadId ? loadUploadMesh(e.uploadId, e.plate) : loadPreviewMesh(e.instanceId, e.plate))
        .then((m) => alive && setMeshes((prev) => (prev[key] ? prev : { ...prev, [key]: m })))
        .catch((err) => alive && setErrors((prev) => ({ ...prev, [key]: (err as Error).message })));
    }
    return () => {
      alive = false;
    };
  }, [entries, settings.loggedIn]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        setJob(await api<Job>(`/api/jobs/${job.id}`));
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job]);

  // Same packing as the server, in the same order: each entry, then each of its copies.
  const layout = useMemo(() => {
    const copies = entries.flatMap((e) => Array.from({ length: Math.max(1, e.copies) }, (_, c) => ({ e, c })));
    if (!copies.length || copies.some(({ e }) => !meshes[meshKey(e)])) return null;
    const places = packBeds(
      copies.map(({ e }) => {
        const [w, d] = footprint(meshBox(meshes[meshKey(e)], e.orient), e.size / 100, e.rotation);
        return { w, d, bed: e.bed };
      }),
    );
    const beds: BedPart[][] = Array.from({ length: Math.max(0, ...places.map((p) => p?.bed ?? 0)) }, () => []);
    const bedsOf: Record<string, number[]> = {};
    copies.forEach(({ e, c }, i) => {
      const place = places[i];
      if (!place) return;
      beds[place.bed - 1].push({
        key: `${e.id}:${c}`,
        mesh: meshes[meshKey(e)],
        x: place.x,
        y: place.y,
        scale: e.size / 100,
        rotation: e.rotation,
        orient: e.orient,
        colors: filamentColors(e, meshes[meshKey(e)], settings.tools),
      });
      bedsOf[e.id] = [...new Set([...(bedsOf[e.id] ?? []), place.bed])].sort((a, b) => a - b);
    });
    const missing = [...new Set(copies.filter((_, i) => !places[i]).map(({ e }) => e.title))];
    return { beds, bedsOf, missing, objects: copies.length };
  }, [entries, meshes, settings.tools]);

  const bedCount = layout?.beds.length ?? 0;
  const shownBed = Math.min(viewBed, Math.max(1, bedCount));

  // Copies are keyed "<entry id>:<copy>"; a click on any copy of the model being oriented lays that face down.
  const pick: FacePick | null = useMemo(() => {
    const entry = entries.find((e) => e.id === pickingId);
    if (!entry) return null;
    return {
      accepts: (key) => key.startsWith(`${entry.id}:`),
      onPick: (_key, normal) => {
        update(entry.id, { orient: layFaceFlat(entry.orient, normal) ?? null });
        setPickingId(null);
      },
    };
  }, [entries, pickingId, update]);

  const start = async (send: boolean) => {
    setSubmitError(null);
    try {
      setJob(await api<Job>("/api/plate/print", { method: "POST", body: JSON.stringify({ mode, options, send }) }));
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  const sendExisting = async (plate = 1) => {
    if (!job) return;
    setSubmitError(null);
    try {
      setJob(await api<Job>(`/api/jobs/${job.id}/send`, { method: "POST", body: JSON.stringify({ plate }) }));
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  if (!ready) return <main className="container muted">Loading the plate…</main>;

  if (!entries.length) {
    return (
      <main className="container">
        <section className="panel" style={{ maxWidth: 560 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>The plate is empty</h1>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            Print several models at once: open a model, pick its profile, size and colours, then press <strong>Add to plate</strong>. Everything you add here is placed
            together on the U1 bed. When it does not fit on one plate, the rest goes on a second plate, printed after the first.
          </p>
          <Link className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
            Find models
          </Link>
        </section>
        {job && (
          <section className="panel" style={{ maxWidth: 560, marginTop: 16 }}>
            <JobProgress job={job} onSend={sendExisting} printerConfigured={settings.printerConfigured} tools={settings.tools} />
          </section>
        )}
      </main>
    );
  }

  const busy = job?.status === "running";
  const loading = entries.some((e) => !meshes[meshKey(e)] && !errors[meshKey(e)]);
  const fits = layout !== null && layout.missing.length === 0;

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Plate</h1>
          <span className="muted small">
            {entries.length} model{entries.length > 1 ? "s" : ""} · {entries.reduce((n, e) => n + e.copies, 0)} object
            {entries.reduce((n, e) => n + e.copies, 0) > 1 ? "s" : ""}
          </span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => window.confirm("Remove every model from the plate?") && clear()}>
          Clear plate
        </button>
      </section>

      <div className="two-col">
        <section className="col-main">
          <section className="panel" style={{ order: 2 }} aria-labelledby="layout-title">
            <h2 id="layout-title">{bedCount > 1 ? `Layout on ${bedCount} U1 plates` : "Layout on the U1 bed"}</h2>
            {bedCount > 1 && (
              <div className="bed-tabs" role="tablist" aria-label="U1 plates">
                {layout!.beds.map((parts, i) => (
                  <button key={i} type="button" role="tab" aria-selected={shownBed === i + 1} onClick={() => setViewBed(i + 1)}>
                    Plate {i + 1}
                    <small>
                      {parts.length} object{parts.length > 1 ? "s" : ""}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {!settings.loggedIn && entries.some((e) => !e.uploadId) ? (
              <div className="notice">
                Placing models needs their 3MF files. <Link href="/settings">Log in with your Bambu account</Link>.
              </div>
            ) : loading || !layout ? (
              <div className="preview-box muted small">Loading the models…</div>
            ) : (
              <BedViewer parts={layout.beds[shownBed - 1] ?? []} pick={pick} />
            )}
            {pick && (
              <div className="notice">
                Click the face of <strong>{entries.find((e) => e.id === pickingId)?.title}</strong> that should touch the bed.{" "}
                {bedCount > 1 && "If it is on another U1 plate, open that plate's tab first. "}
                <button type="button" className="btn btn-sm" onClick={() => setPickingId(null)}>
                  Cancel
                </button>
              </div>
            )}
            {Object.keys(errors).length > 0 && <div className="notice error">Some models could not be loaded: {Object.values(errors)[0]}</div>}
            {layout && layout.missing.length > 0 && (
              <div className="notice error">Too big for the U1 bed: {layout.missing.join(", ")}. Make these models smaller or rotate them.</div>
            )}
            {fits && (
              <p className="small muted" style={{ margin: 0 }}>
                {layout.objects} object{layout.objects > 1 ? "s" : ""} placed automatically, front to back, keeping the back-left corner free for the prime tower.
                {bedCount > 1 && " What does not fit goes on the next plate; each plate is a separate print. Choose a plate on a model to keep it there."}{" "}
                Colours show the toolhead each model colour prints with; change them on each model.
              </p>
            )}
          </section>

          <div style={{ order: 4 }}>
            <PrintOptionsPanel value={options} defaults={supportsOption.defaults} onChange={supportsOption.onChange} creatorSupports={creatorSupports} />
          </div>
        </section>

        <aside className="col-side">
          <section className="panel" style={{ order: 1 }} aria-label="Models on the plate">
            {entries.map((e) => (
              <PlateRow
                key={e.id}
                entry={e}
                mesh={meshes[meshKey(e)]}
                tools={settings.tools}
                beds={bedCount}
                placedOn={layout?.bedsOf[e.id] ?? []}
                onChange={(c) => update(e.id, c)}
                onRemove={() => remove(e.id)}
                picking={pickingId === e.id}
                onPicking={(on) => setPickingId(on ? e.id : null)}
              />
            ))}
            <Link className="small" href="/">
              + Add another model
            </Link>
          </section>

          <section className="panel" style={{ order: 3 }}>
            <PresetPicker modes={modes} value={mode} onChange={setMode} />
          </section>

          <section className="panel" style={{ order: 5 }}>
            <button type="button" className="btn btn-primary btn-lg" disabled={busy || !fits || !settings.printerConfigured} onClick={() => start(true)}>
              <SendIcon size={20} /> {bedCount > 1 ? `Slice ${bedCount} plates & print plate 1` : <>Slice plate &amp; print</>}
            </button>
            {bedCount > 1 && <p className="small muted">The U1 prints one plate at a time. Send the next plate from here once the bed is cleared.</p>}
            {!settings.printerConfigured && (
              <p className="small muted">
                To print directly, add your printer address in <Link href="/settings">Settings</Link>. You can still slice and download.
              </p>
            )}
            <button type="button" className="btn" disabled={busy || !fits} onClick={() => start(false)}>
              {bedCount > 1 ? `Slice ${bedCount} plates only` : "Slice only"}
            </button>
            {submitError && <div className="notice error">{submitError}</div>}
            {job && <JobProgress job={job} onSend={() => sendExisting(1)} printerConfigured={settings.printerConfigured} tools={settings.tools} />}
            {job && job.plates && job.plates.length > 1 && (
              <JobPlates job={job} busy={busy} printerConfigured={settings.printerConfigured} tools={settings.tools} onSend={sendExisting} />
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

/** The U1 plates of a sliced multi-plate job: estimates, downloads and a print button for each. */
function JobPlates({
  job,
  busy,
  printerConfigured,
  tools,
  onSend,
}: {
  job: Job;
  busy: boolean;
  printerConfigured: boolean;
  tools: ToolLoad[];
  onSend: (plate: number) => void;
}) {
  return (
    <ol className="job-plates" aria-label="U1 plates">
      {job.plates!.map((p, i) => (
        <li key={i}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <strong>Plate {i + 1}</strong>
            <span className="small muted">
              {duration(p.stats.seconds)} · {p.stats.grams != null ? `${p.stats.grams.toFixed(1)} g` : "—"} · {euros(slicedPrice(p.stats, job.filamentToTool, tools))}
              {p.remoteName ? " · sent" : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a className="btn btn-sm" href={`/api/jobs/${job.id}/file?kind=gcode&plate=${i + 1}`} aria-label={`Download plate ${i + 1} G-code`}>
              <DownloadIcon size={14} /> G-code
            </a>
            <button type="button" className={`btn btn-sm${p.remoteName ? "" : " btn-primary"}`} disabled={busy || !printerConfigured} onClick={() => onSend(i + 1)}>
              <SendIcon size={14} /> {p.remoteName ? "Print again" : `Print plate ${i + 1}`}
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PlateRow({
  entry,
  mesh,
  tools,
  beds,
  placedOn,
  onChange,
  onRemove,
  picking,
  onPicking,
}: {
  entry: PlateEntry;
  mesh?: MeshData;
  tools: ToolLoad[];
  /** Number of U1 plates the layout uses. */
  beds: number;
  /** The U1 plates this model's copies landed on. */
  placedOn: number[];
  onChange: (c: PlateChange) => void;
  onRemove: () => void;
  /** Whether a click in the layout lays a face of this model on the bed. */
  picking: boolean;
  onPicking: (on: boolean) => void;
}) {
  // Offer every plate in use, one more for starting a new plate, and the pinned one if it was renumbered away.
  const bedChoices = Math.min(MAX_BEDS, Math.max(beds + 1, entry.bed ?? 0, 2));
  const [draft, setDraft] = useState<string | null>(null);
  const dims = mesh ? footprint(meshBox(mesh, entry.orient), entry.size / 100, entry.rotation) : null;
  const filaments = usedFilaments(entry, mesh);
  const setTool = (filament: number, tool: number) => {
    const next = Array.from({ length: Math.max(entry.filamentToTool.length, filament) }, (_, i) => entry.filamentToTool[i] ?? 0);
    next[filament - 1] = tool;
    onChange({ filamentToTool: next });
  };
  const commitSize = () => {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 10 && n <= 300 && n !== entry.size) onChange({ size: n });
    setDraft(null);
  };
  return (
    <div className="plate-row">
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {entry.cover ? <img src={mwImage(entry.cover, 120)} width={56} height={56} alt="" className="plate-thumb" referrerPolicy="no-referrer" /> : <span className="plate-thumb" />}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <Link
            href={entry.uploadId ? `/upload?id=${entry.uploadId}` : `/model/${entry.designId}`}
            style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}
            className="ellipsis"
          >
            {entry.title}
          </Link>
          <span className="small muted ellipsis">
            {entry.profile}
            {entry.plate > 1 ? ` · plate ${entry.plate}` : ""}
          </span>
          {dims && (
            <span className="small muted">
              {dims[0].toFixed(0)} × {dims[1].toFixed(0)} × {dims[2].toFixed(0)} mm
            </span>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={onRemove} aria-label={`Remove ${entry.title}`}>
          Remove
        </button>
      </div>
      <div className="plate-colors" role="group" aria-label={`Colours of ${entry.title}`}>
        {filaments.map((f) => {
          const tool = entry.filamentToTool[f - 1] ?? 0;
          const color = tools[tool]?.color ?? "#9CA3AF";
          const label = filaments.length > 1 || f > 1 ? `Colour ${f}` : "Colour";
          return (
            <label key={f} className="plate-color">
              <span className="tool-chip" style={{ width: 28, height: 28, fontSize: 11, background: color, color: inkFor(color) }} aria-hidden>
                T{tool + 1}
              </span>
              <span className="small muted">{label}</span>
              <select className="select select-sm" style={{ borderColor: color }} value={tool} onChange={(e) => setTool(f, Number(e.target.value))} aria-label={`Toolhead for ${label.toLowerCase()} of ${entry.title}`}>
                {tools.map((t, i) => (
                  <option key={i} value={i}>
                    T{i + 1} · {shortPreset(t.preset)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="plate-controls">
        <div className="stepper" role="group" aria-label="Copies">
          <button type="button" onClick={() => onChange({ copies: entry.copies - 1 })} disabled={entry.copies <= 1} aria-label="One copy less">
            −
          </button>
          <span>
            {entry.copies} cop{entry.copies > 1 ? "ies" : "y"}
          </span>
          <button type="button" onClick={() => onChange({ copies: entry.copies + 1 })} disabled={entry.copies >= 20} aria-label="One copy more">
            +
          </button>
        </div>
        <label className="size-input">
          <input
            type="number"
            inputMode="numeric"
            min={10}
            max={300}
            value={draft ?? entry.size}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => e.key === "Enter" && commitSize()}
            aria-label="Size in percent"
          />
          %
        </label>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ rotation: (entry.rotation + 90) % 360 })} aria-label="Rotate 90 degrees clockwise">
          ↻ {entry.rotation}°
        </button>
        <select
          className="select select-sm"
          value={entry.bed ?? 0}
          onChange={(e) => onChange({ bed: Number(e.target.value) })}
          aria-label="U1 plate"
          title="Which U1 plate prints this model"
        >
          <option value={0}>{placedOn.length && beds > 1 ? `Auto · plate ${placedOn.join(", ")}` : "Plate: auto"}</option>
          {Array.from({ length: bedChoices }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Plate {i + 1}
              {i + 1 > beds ? " (new)" : ""}
            </option>
          ))}
        </select>
      </div>
      <OrientControls compact orient={entry.orient} onOrient={(orient) => onChange({ orient: orient ?? null })} picking={picking} onPicking={onPicking} />
    </div>
  );
}

/** Display colour of each filament of a model (index 1 = filament 1): the toolhead it is mapped to. */
function filamentColors(e: PlateEntry, mesh: MeshData, tools: ToolLoad[]) {
  const count = Math.max(e.filamentToTool.length, ...mesh.groups.map((g) => g.filament)) + 1;
  return Array.from({ length: count }, (_, f) => tools[e.filamentToTool[Math.max(1, f) - 1] ?? 0]?.color ?? "#9CA3AF");
}

/**
 * The filaments (1-based) this plate of the model prints with, as the preview colours them. Before the
 * mesh loads, every filament the entry maps.
 */
function usedFilaments(e: PlateEntry, mesh?: MeshData) {
  const list = mesh ? mesh.groups.map((g) => Math.max(1, g.filament)) : e.filamentToTool.map((_, i) => i + 1);
  return [...new Set(list.length ? list : [1])].sort((a, b) => a - b);
}
