"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Job } from "@/lib/jobs.ts";
import type { PlateChange, PlateEntry } from "@/lib/plate.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import { api, duration, euros, inkFor, mwImage, slicedPrice } from "@/lib/format";
import { t } from "@/lib/i18n";
import { footprint, MAX_BEDS, packBeds } from "@/lib/packing";
import { loadPreviewMesh, loadUploadMesh, meshBox, type MeshData } from "@/lib/previewMesh";
import { usePlate } from "@/lib/usePlate";
import { BedViewer, type BedPart, type FacePick } from "./BedViewer";
import { layFaceFlat, OrientControls } from "./OrientControls";
import { AutoPrintToggle, JobProgress, PresetPicker, shortPreset, type Mode } from "./PrintSetup";
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
  // Off by default: the plate goes to the U1 and waits there, so nobody starts a print by accident.
  const [autoPrint, setAutoPrint] = useState(false);
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
      setJob(await api<Job>("/api/plate/print", { method: "POST", body: JSON.stringify({ mode, options, send, print: send && autoPrint }) }));
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  const sendExisting = async (plate = 1) => {
    if (!job) return;
    setSubmitError(null);
    try {
      setJob(await api<Job>(`/api/jobs/${job.id}/send`, { method: "POST", body: JSON.stringify({ plate, print: autoPrint }) }));
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  // Start a plate the printer already has, without uploading it again.
  const startExisting = async (plate = 1) => {
    if (!job) return;
    setSubmitError(null);
    try {
      setJob(await api<Job>(`/api/jobs/${job.id}/print`, { method: "POST", body: JSON.stringify({ plate }) }));
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  if (!ready) return <main className="container muted">{t("plate.loading")}</main>;

  if (!entries.length) {
    return (
      <main className="container">
        <section className="panel" style={{ maxWidth: 560 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{t("plate.emptyTitle")}</h1>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            {t("plate.emptyDescription")} <strong>{t("plate.addToPlate")}</strong>{t("plate.emptyDescriptionAfter")}
          </p>
          <Link className="btn btn-primary" href="/" style={{ alignSelf: "flex-start" }}>
            {t("plate.findModels")}
          </Link>
        </section>
        {job && (
          <section className="panel" style={{ maxWidth: 560, marginTop: 16 }}>
            <JobProgress job={job} onSend={sendExisting} onPrint={() => startExisting(1)} printerConfigured={settings.printerConfigured} tools={settings.tools} />
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
          <h1 style={{ margin: 0, fontSize: 24 }}>{t("plate.title")}</h1>
          <span className="muted small">
            {t("plate.modelCount", { models: entries.length, objects: entries.reduce((n, e) => n + e.copies, 0) })}
          </span>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => window.confirm(t("plate.clearConfirm")) && clear()}>
          {t("plate.clear")}
        </button>
      </section>

      <div className="two-col">
        <section className="col-main">
          <section className="panel" style={{ order: 2 }} aria-labelledby="layout-title">
            <h2 id="layout-title">{bedCount > 1 ? t("plate.layoutMultiple", { count: bedCount }) : t("plate.layoutSingle")}</h2>
            {bedCount > 1 && (
              <div className="bed-tabs" role="tablist" aria-label={t("plate.plates")}>
                {layout!.beds.map((parts, i) => (
                  <button key={i} type="button" role="tab" aria-selected={shownBed === i + 1} onClick={() => setViewBed(i + 1)}>
                    {t("plate.plate", { number: i + 1 })}
                    <small>
                      {t("plate.objects", { count: parts.length })}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {!settings.loggedIn && entries.some((e) => !e.uploadId) ? (
              <div className="notice">
                {t("plate.loginToPlaceBefore")} <Link href="/settings">{t("plate.loginBambu")}</Link>{t("plate.loginToPlaceAfter")}
              </div>
            ) : loading || !layout ? (
              <div className="preview-box muted small">{t("plate.loadingModels")}</div>
            ) : (
              <BedViewer parts={layout.beds[shownBed - 1] ?? []} pick={pick} />
            )}
            {pick && (
              <div className="notice">
                {t("plate.clickFaceBefore")} <strong>{entries.find((e) => e.id === pickingId)?.title}</strong>{t("plate.clickFaceAfter")}{" "}
                {bedCount > 1 && `${t("plate.otherPlateHint")} `}
                <button type="button" className="btn btn-sm" onClick={() => setPickingId(null)}>
                  {t("plate.cancel")}
                </button>
              </div>
            )}
            {Object.keys(errors).length > 0 && <div className="notice error">{t("plate.loadError", { error: Object.values(errors)[0] })}</div>}
            {layout && layout.missing.length > 0 && (
              <div className="notice error">{t("plate.tooBig", { models: layout.missing.join(", ") })}</div>
            )}
            {fits && (
              <p className="small muted" style={{ margin: 0 }}>
                {t("plate.placedAutomatically", { count: layout.objects })}{" "}
                {bedCount > 1 && `${t("plate.overflowHint")} `}
                {t("plate.colorsHint")}
              </p>
            )}
          </section>

          <div style={{ order: 4 }}>
            <PrintOptionsPanel value={options} defaults={supportsOption.defaults} onChange={supportsOption.onChange} creatorSupports={creatorSupports} />
          </div>
        </section>

        <aside className="col-side">
          <section className="panel" style={{ order: 1 }} aria-label={t("plate.modelsOnPlate")}>
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
              {t("plate.addAnother")}
            </Link>
          </section>

          <section className="panel" style={{ order: 3 }}>
            <PresetPicker modes={modes} value={mode} onChange={setMode} />
          </section>

          <section className="panel" style={{ order: 5 }}>
            <button type="button" className="btn btn-primary btn-lg" disabled={busy || !fits || !settings.printerConfigured} onClick={() => start(true)}>
              <SendIcon size={20} /> {bedCount > 1 ? t("plate.slicePlatesAndPrint", { count: bedCount }) : t("plate.sliceAndPrint")}
            </button>
            <AutoPrintToggle value={autoPrint} onChange={setAutoPrint} />
            {bedCount > 1 && <p className="small muted">{t("plate.oneAtTime")}</p>}
            {!settings.printerConfigured && (
              <p className="small muted">
                {t("plate.directPrintHintBefore")}<Link href="/settings">{t("printer.openSettings")}</Link>{t("plate.directPrintHintAfter")}
              </p>
            )}
            <button type="button" className="btn" disabled={busy || !fits} onClick={() => start(false)}>
              {bedCount > 1 ? t("plate.slicePlatesOnly", { count: bedCount }) : t("plate.sliceOnly")}
            </button>
            {submitError && <div className="notice error">{submitError}</div>}
            {job && <JobProgress job={job} onSend={() => sendExisting(1)} onPrint={() => startExisting(1)} printerConfigured={settings.printerConfigured} tools={settings.tools} />}
            {job && job.plates && job.plates.length > 1 && (
              <JobPlates job={job} busy={busy} printerConfigured={settings.printerConfigured} tools={settings.tools} onSend={sendExisting} onStart={startExisting} />
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
  onStart,
}: {
  job: Job;
  busy: boolean;
  printerConfigured: boolean;
  tools: ToolLoad[];
  onSend: (plate: number) => void;
  onStart: (plate: number) => void;
}) {
  return (
    <ol className="job-plates" aria-label={t("plate.plates")}>
      {job.plates!.map((p, i) => (
        <li key={i}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <strong>{t("plate.plate", { number: i + 1 })}</strong>
            <span className="small muted">
              {duration(p.stats.seconds)} · {p.stats.grams != null ? `${p.stats.grams.toFixed(1)} g` : "—"} · {euros(slicedPrice(p.stats, job.filamentToTool, tools))}
              {p.remoteName ? ` · ${p.started ? t("plate.sent") : t("plate.waiting")}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a className="btn btn-sm" href={`/api/jobs/${job.id}/file?kind=gcode&plate=${i + 1}`} aria-label={t("plate.downloadPlate", { number: i + 1 })}>
              <DownloadIcon size={14} /> G-code
            </a>
            <button
              type="button"
              className={`btn btn-sm${p.remoteName ? "" : " btn-primary"}`}
              disabled={busy || !printerConfigured}
              onClick={() => (p.remoteName && !p.started ? onStart(i + 1) : onSend(i + 1))}
            >
              <SendIcon size={14} /> {p.remoteName ? (p.started ? t("plate.printAgain") : t("plate.startPrint")) : t("plate.printPlate", { number: i + 1 })}
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
            {entry.plate > 1 ? t("plate.plateSuffix", { number: entry.plate }) : ""}
          </span>
          {dims && (
            <span className="small muted">
              {dims[0].toFixed(0)} × {dims[1].toFixed(0)} × {dims[2].toFixed(0)} mm
            </span>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={onRemove} aria-label={t("plate.removeAria", { title: entry.title })}>
          {t("plate.remove")}
        </button>
      </div>
      <div className="plate-colors" role="group" aria-label={t("plate.colorsOf", { title: entry.title })}>
        {filaments.map((f) => {
          const tool = entry.filamentToTool[f - 1] ?? 0;
          const color = tools[tool]?.color ?? "#9CA3AF";
          const label = filaments.length > 1 || f > 1 ? t("plate.colorN", { number: f }) : t("plate.color");
          return (
            <label key={f} className="plate-color">
              <span className="tool-chip" style={{ width: 28, height: 28, fontSize: 11, background: color, color: inkFor(color) }} aria-hidden>
                T{tool + 1}
              </span>
              <span className="small muted">{label}</span>
              <select className="select select-sm" style={{ borderColor: color }} value={tool} onChange={(e) => setTool(f, Number(e.target.value))} aria-label={t("plate.toolheadFor", { color: label, title: entry.title })}>
                {tools.map((tool, i) => (
                  <option key={i} value={i}>
                    T{i + 1} · {shortPreset(tool.preset)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="plate-controls">
        <div className="stepper" role="group" aria-label={t("plate.copies")}>
          <button type="button" onClick={() => onChange({ copies: entry.copies - 1 })} disabled={entry.copies <= 1} aria-label={t("plate.oneCopyLess")}>
            −
          </button>
          <span>
            {t("plate.copy", { count: entry.copies })}
          </span>
          <button type="button" onClick={() => onChange({ copies: entry.copies + 1 })} disabled={entry.copies >= 20} aria-label={t("plate.oneCopyMore")}>
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
            aria-label={t("plate.sizePercent")}
          />
          %
        </label>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ rotation: (entry.rotation + 90) % 360 })} aria-label={t("plate.rotate")}>
          ↻ {entry.rotation}°
        </button>
        <select
          className="select select-sm"
          value={entry.bed ?? 0}
          onChange={(e) => onChange({ bed: Number(e.target.value) })}
          aria-label={t("plate.u1Plate")}
          title={t("plate.whichPlate")}
        >
          <option value={0}>{placedOn.length && beds > 1 ? t("plate.autoPlate", { plates: placedOn.join(", ") }) : t("plate.plateAuto")}</option>
          {Array.from({ length: bedChoices }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {t("plate.plate", { number: i + 1 })}
              {i + 1 > beds ? ` ${t("plate.newPlate")}` : ""}
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
