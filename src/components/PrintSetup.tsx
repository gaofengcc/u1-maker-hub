"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Job } from "@/lib/jobs.ts";
import type { PrintOptions, ToolLoad } from "@/lib/slicer.ts";
import type { CheckLevel } from "@/lib/stl.ts";
import type { MeshData } from "@/lib/previewMesh";
import type { NewPlateEntry } from "@/lib/usePlate";
import type { Orient } from "@/lib/orient";
import { api, duration, euros, inkFor, matchColors, printPrice, slicedPrice } from "@/lib/format";
import { t } from "@/lib/i18n";
import { footprint, U1_BED } from "@/lib/packing";
import { usePlate } from "@/lib/usePlate";
import { useSupportsOption } from "@/lib/useCreatorSupports";
import { PrintOptionsPanel, type ModelPreset } from "./PrintOptions";
import { SizePanel } from "./SizePanel";
import { ToolpathViewer } from "./ToolpathViewer";
import { DownloadIcon, LayersIcon, PlateIcon, SendIcon } from "./Icons";

/**
 * The screen before printing, the same for a MakerWorld model and an uploaded STL or 3MF: what is
 * printed (header), which plate, U1 preset, colours → toolheads, size and 3D preview, print options,
 * and the buttons to slice, print or add to the plate.
 */

export type Mode = { key: string; label: string; description: string };

/** One colour of the model (1-based slot, as in the 3MF). Without a colour (an STL), it is not matched. */
export type ColorSlot = { slot: number; color?: string; type?: string; grams?: number };

export type Check = { level: CheckLevel; title: string; detail: string };

/** What a slice or an "add to plate" needs from the screen. */
export type Setup = {
  mode: string;
  options: PrintOptions;
  overrides?: Record<string, string>;
  plate: number;
  transform: { scale: number; rotation: number; orient?: Orient };
  filamentToTool: number[];
};

type Props = {
  settings: { printerConfigured: boolean; tools: ToolLoad[] };
  modes: Mode[];
  defaults: PrintOptions;
  /** A new key is another model: size, orientation, colours and the job start over. */
  sourceKey: string;

  /** Main column: pictures above everything, more below the options (description, upload box). */
  media?: ReactNode;
  footer?: ReactNode;
  /** Side column: title and facts, then an optional panel to pick a version (MakerWorld profiles). */
  header: ReactNode;
  checks?: Check[];
  source?: ReactNode;

  plates: { index: number; label: string }[];
  plate: number;
  onPlate: (plate: number) => void;

  /** The colours of the plate shown, and how many filaments the whole model has. */
  slots: ColorSlot[];
  filamentCount: number;
  /** The creator's own estimate, when known. */
  estimate?: { label: string; seconds?: number; grams?: number };

  mesh: { load: () => Promise<MeshData>; autoShow: boolean; available: boolean; unavailableHint?: string };
  /** Width, depth and height at 100 %, to tell before the preview loads whether it fits. */
  baseSize?: [number, number, number];
  creatorSupports: PrintOptions["supports"] | null;
  /** MakerWorld 实例上下文，用于加载当前盘的几何推荐。 */
  instanceId?: number;
  /** 所属设计 id：作者说明必须按设计 id 取，配置 id 会与设计 id 撞号。 */
  designId?: number;
  site?: string;
  modelPreset?: ModelPreset | null;

  /** False blocks slicing (for example without the Bambu login); `notice` says why. */
  canSlice: boolean;
  notice?: ReactNode;
  /** Buttons next to "Slice only" (the original file). */
  extraActions?: ReactNode;
  slice: (setup: Setup, options: { send: boolean; print: boolean }) => Promise<Job>;
  /** The plate entry for one plate of the model, at the current size and colours. */
  plateEntry: (setup: Setup) => NewPlateEntry;
};

const LEVEL_BADGE: Record<CheckLevel, [string, string]> = {
  ok: ["green", t("print.ok")],
  warn: ["orange", t("print.check")],
  error: ["red", t("print.problem")],
};

export function shortPreset(p: string) {
  return p.replace(/ @(Snapmaker )?U1.*$/, "").replace(/^Snapmaker /, "");
}

export function PrintSetup(props: Props) {
  const { settings, modes, defaults, sourceKey, plates, plate, onPlate, slots, filamentCount, estimate } = props;
  const [mode, setMode] = useState(modes[0]?.key ?? "fast");
  const [processOverrides, setProcessOverrides] = useState<Record<string, string>>({});
  const [baseOptions, setOptions] = useState<PrintOptions>(defaults);
  // The U1 settings replace the creator's, so supports start from what the creator used.
  const supportsOption = useSupportsOption(baseOptions, setOptions, props.creatorSupports, defaults);
  const options = supportsOption.value;
  const [size, setSize] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [orient, setOrient] = useState<Orient | undefined>(undefined);
  /** Printed size from the preview, which knows the orientation; null until the model is loaded. */
  const [dims, setDims] = useState<[number, number, number] | null>(null);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Off by default: the file goes to the U1 and waits there, so nobody starts a print by accident.
  const [autoPrint, setAutoPrint] = useState(false);
  const plateList = usePlate();
  const [plateState, setPlateState] = useState<"idle" | "adding" | "added">("idle");

  // Another model starts over; another plate of it holds other pieces, so they start as in the file.
  const [seen, setSeen] = useState({ sourceKey, plate });
  if (seen.sourceKey !== sourceKey || seen.plate !== plate) {
    setProcessOverrides({});
    if (seen.sourceKey !== sourceKey) {
      setOverrides({});
      setSize(100);
      setRotation(0);
      supportsOption.forget();
      setPlateState("idle");
    }
    setSeen({ sourceKey, plate });
    setOrient(undefined);
    setDims(null);
    setJob(null);
    setError(null);
  }

  // Each model colour starts on the loaded toolhead with the closest colour; an STL starts on T1.
  const autoMap = useMemo(() => {
    const colored = slots.filter((s) => s.color);
    const picks = matchColors(
      colored.map((s) => s.color!),
      settings.tools.map((tool) => tool.color),
    );
    return Object.fromEntries(colored.map((s, k) => [s.slot, picks[k]])) as Record<number, number>;
  }, [slots, settings.tools]);
  const toolFor = (slot: number) => overrides[slot] ?? autoMap[slot] ?? 0;
  const filamentToTool = Array.from({ length: Math.max(1, filamentCount) }, (_, i) => toolFor(i + 1));
  // Index 1 is filament 1: each shows the colour of the toolhead that prints it.
  const filamentColors = Array.from({ length: filamentToTool.length + 1 }, (_, f) => settings.tools[toolFor(Math.max(1, f))]?.color ?? "#9CA3AF");
  const toolsUsed = new Set(slots.map((s) => toolFor(s.slot)));

  // The creator's weight for each colour, priced with the toolhead it is mapped to. Without per-colour
  // weights, the whole weight is priced with the first colour's toolhead.
  const slotGrams = slots.reduce((n, s) => n + (s.grams || 0), 0);
  const estimatedPrice =
    estimate?.grams != null
      ? printPrice(
          slotGrams > 0 ? slots.map((s) => ({ tool: toolFor(s.slot), grams: s.grams || 0 })) : [{ tool: toolFor(slots[0]?.slot ?? 1), grams: estimate.grams }],
          settings.tools,
        )
      : null;

  // The preview's size knows the orientation; before it loads, the file's size is close enough.
  const printed = dims ?? (props.baseSize ? footprint([0, 0, 0, ...props.baseSize], size / 100, rotation) : null);
  const tooBig = Boolean(printed && (printed[0] > U1_BED.maxX - U1_BED.minX || printed[1] > U1_BED.maxY - U1_BED.minY || printed[2] > U1_BED.height));
  // At another size the "fits" check is answered by the size panel instead.
  const checks = props.checks?.filter((c) => size === 100 || !/^(Fits the U1|Too big for the U1)$/.test(c.title)) ?? [];

  // Poll the running job.
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

  const setup = (p: number, shown: boolean): Setup => ({
    mode,
    options,
    overrides: processOverrides,
    plate: p,
    transform: { scale: size / 100, rotation: shown ? rotation : 0, orient: shown ? orient : undefined },
    filamentToTool,
  });

  const start = async (send: boolean) => {
    setError(null);
    try {
      setJob(await props.slice(setup(plate, true), { send, print: send && autoPrint }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sendExisting = async () => {
    if (!job) return;
    try {
      setJob(await api<Job>(`/api/jobs/${job.id}/send`, { method: "POST", body: JSON.stringify({ print: autoPrint }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Start a job the printer already has, without uploading it again.
  const printExisting = async () => {
    if (!job) return;
    try {
      setJob(await api<Job>(`/api/jobs/${job.id}/print`, { method: "POST", body: JSON.stringify({}) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // With `all`, every plate is added at this size, each as its own model; only the plate shown here
  // keeps its rotation and orientation.
  const addToPlate = async (all: boolean) => {
    setPlateState("adding");
    setError(null);
    const ok = all
      ? await plateList.addMany(plates.map((p) => props.plateEntry(setup(p.index, p.index === plate))))
      : await plateList.add(props.plateEntry(setup(plate, true)));
    setPlateState(ok ? "added" : "idle");
    if (!ok) setError(t("print.addError"));
  };

  const busy = job?.status === "running";
  const blocked = busy || !props.canSlice || tooBig;

  return (
    <div className="two-col">
      {/* On phones the two columns merge into one; `order` puts the title, preset and print button right after the pictures. */}
      <section className="col-main">
        {props.media}
        <div style={{ order: 5 }}>
          <PrintOptionsPanel
            value={options}
            defaults={supportsOption.defaults}
            onChange={supportsOption.onChange}
            creatorSupports={props.creatorSupports}
            instanceId={props.instanceId == null ? undefined : String(props.instanceId)}
            designId={props.designId}
            plate={plate}
            site={props.site}
            modelPreset={props.modelPreset}
            onOverridesChange={setProcessOverrides}
            onPresetMode={setMode}
          />
        </div>
        {props.footer}
      </section>

      <aside className="col-side">
        <section className="panel" style={{ order: 2 }}>
          {props.header}
          {checks.length > 0 && (
            <>
              <h2 style={{ marginTop: 4 }}>{t("print.checks")}</h2>
              <ul className="check-list">
                {checks.map((c) => (
                  <li key={c.title}>
                    <span className={`badge ${LEVEL_BADGE[c.level][0]}`}>{LEVEL_BADGE[c.level][1]}</span>
                    <span>
                      <strong>{c.title}</strong>
                      <span className="small muted" style={{ display: "block" }}>
                        {c.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {props.source}

        <section className="panel" style={{ order: 4 }}>
          {plates.length > 1 && (
            <div className="field">
              <label className="label" htmlFor="print-plate">
                {t("print.plateToPrint")}
              </label>
              <select id="print-plate" className="select" value={plate} onChange={(e) => onPlate(Number(e.target.value))}>
                {plates.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <PresetPicker modes={modes} value={mode} onChange={setMode} />
          <div className="estimates">
            {estimate?.seconds != null && (
              <div>
                <span>{estimate.label}</span>
                <span>{duration(estimate.seconds)}</span>
              </div>
            )}
            {estimate?.grams != null && (
              <div>
                <span>{t("print.filament")}</span>
                <span>{Math.round(estimate.grams)} g</span>
              </div>
            )}
            <div>
                <span>{t("print.toolheads")}</span>
              <span>{toolsUsed.size} / {t("print.ofFour")}</span>
            </div>
            {estimatedPrice != null && (
              <div>
                <span>{t("print.price")}</span>
                <span>{euros(estimatedPrice)}</span>
              </div>
            )}
          </div>
          <p className="small muted">{t("print.estimateHint")}</p>

          <h2 style={{ marginTop: 4 }}>{slots.some((s) => s.color) ? t("print.colorsToToolheads") : t("print.toolhead")}</h2>
          <p className="small muted">
            {slots.some((s) => s.color)
              ? t("print.colorsDescription")
              : t("print.stlDescription")} {t("print.editSettings")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {slots.map((s) => (
              <ToolSelect
                key={s.slot}
                id={`slot-${s.slot}`}
                label={s.color ? `${t("print.colorSlot", { n: s.slot })}${s.type ? ` · ${s.type}` : ""}` : t("print.toolhead")}
                detail={s.grams ? `${Math.round(s.grams)} g` : undefined}
                swatch={s.color}
                value={toolFor(s.slot)}
                tools={settings.tools}
                onChange={(tool) => setOverrides({ ...overrides, [s.slot]: tool })}
              />
            ))}
          </div>
          {slots.length > 4 && <div className="notice">{t("print.tooManyColors", { n: slots.length })}</div>}
        </section>

        <SizePanel
          meshKey={`${sourceKey}:${plate}`}
          loadMesh={props.mesh.load}
          autoShow={props.mesh.autoShow}
          size={size}
          rotation={rotation}
          onSize={setSize}
          onRotation={setRotation}
          orient={orient}
          onOrient={setOrient}
          onDims={setDims}
          colors={filamentColors}
          canDownload={props.mesh.available}
          unavailableHint={props.mesh.unavailableHint}
        />

        <section className="panel mobile-sticky-actions" style={{ order: 7 }}>
          {props.notice}
          <button type="button" className="btn btn-primary btn-lg" disabled={blocked || !settings.printerConfigured} onClick={() => start(true)}>
            <SendIcon size={20} /> {t("print.sliceAndSend")}
          </button>
          <AutoPrintToggle value={autoPrint} onChange={setAutoPrint} />
          {props.canSlice && !settings.printerConfigured && (
            <p className="small muted">
              {t("print.printerHint")}
              <Link href="/settings">{t("settings.title")}</Link>。
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: props.extraActions ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 8 }}>
            <button type="button" className="btn" disabled={blocked} onClick={() => start(false)}>
              {t("print.sliceOnly")}
            </button>
            {props.extraActions}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: plates.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 8 }}>
            <button type="button" className="btn" onClick={() => addToPlate(false)} disabled={plateState === "adding"}>
              <PlateIcon size={16} /> {plateState === "added" ? t("print.addedAnother") : plates.length > 1 ? t("print.addPlate", { n: plate }) : t("print.addToPlate")}
            </button>
            {plates.length > 1 && (
              <button type="button" className="btn" onClick={() => addToPlate(true)} disabled={plateState === "adding"}>
                <PlateIcon size={16} /> {t("print.addAllPlates", { n: plates.length })}
              </button>
            )}
          </div>
          {plateState === "added" && (
            <p className="small" style={{ margin: 0 }}>
              {t("print.addedHint")} <Link href="/plate">{t("print.openPlate", { n: plateList.entries.length })}</Link>
            </p>
          )}
          {tooBig && <div className="notice error">{t("print.tooBig", { n: size })}</div>}
          {error && <div className="notice error">{error}</div>}
          {job && <JobProgress job={job} onSend={sendExisting} onPrint={printExisting} printerConfigured={settings.printerConfigured} tools={settings.tools} />}
        </section>
      </aside>
    </div>
  );
}

/**
 * Starts the print right after the upload, or leaves the file waiting on the U1. Unticked by default:
 * the U1 then only gets the file and nothing moves until somebody presses start on it.
 */
export function AutoPrintToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        {t("print.autoPrint")}
      </label>
      <span className="small muted">{t("print.autoPrintHint")}</span>
    </div>
  );
}

/** The U1 preset buttons and what the chosen one does. */
export function PresetPicker({ modes, value, onChange }: { modes: Mode[]; value: string; onChange: (key: string) => void }) {
  return (
    <>
      <h2>{t("print.preset")}</h2>
      <div className="seg" role="radiogroup" aria-label={t("print.preset")}>
        {modes.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={value === m.key} onClick={() => onChange(m.key)}>
            {t(`print.mode.${m.key}`)}
          </button>
        ))}
      </div>
      <p className="small muted">{t(`print.modeDescription.${value}`)}</p>
    </>
  );
}

/** A toolhead picker; with a swatch, it maps one model colour (the label is then shown). */
function ToolSelect({
  id,
  label,
  detail,
  swatch,
  value,
  tools,
  onChange,
}: {
  id: string;
  label: string;
  detail?: string;
  swatch?: string;
  value: number;
  tools: ToolLoad[];
  onChange: (tool: number) => void;
}) {
  const color = tools[value]?.color ?? "#FFFFFF";
  return (
    <div className="map-row">
      {swatch && (
        <>
          <span className="swatch" style={{ background: swatch }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {label}
            {detail && <span className="muted small"> · {detail}</span>}
          </span>
        </>
      )}
      <label className="sr-only" htmlFor={id}>
        {swatch ? `${t("print.toolheadFor")} ${label}` : label}
      </label>
      <select id={id} className="select" style={{ flex: swatch ? undefined : 1, borderColor: color }} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {tools.map((tool, i) => (
          <option key={i} value={i}>
            T{i + 1} · {shortPreset(tool.preset)}
          </option>
        ))}
      </select>
      <span className="tool-chip" style={{ width: 28, height: 28, background: color, color: inkFor(color) }}>
        T{value + 1}
      </span>
    </div>
  );
}

export function JobProgress({ job, onSend, onPrint, printerConfigured, tools }: { job: Job; onSend?: () => void; onPrint?: () => void; printerConfigured: boolean; tools: ToolLoad[] }) {
  const needsLogin = job.source !== "sm-intl" && (job.errorCode === "login_required" || job.errorCode === "token_expired");
  const sliced = job.files.gcode.length > 0;
  const sent = job.steps.find((s) => s.key === "upload")?.state === "done";
  // Sent but not started: the file waits on the printer until somebody presses start there or here.
  const started = job.steps.find((s) => s.key === "print")?.state === "done";
  // A job on several U1 plates lists its downloads and print buttons per plate elsewhere.
  const perPlate = (job.plates?.length ?? 0) > 1;
  const [showLayers, setShowLayers] = useState(false);
  const layersDialog = useRef<HTMLDialogElement>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ol className="steps" aria-label="Progress">
        {job.steps.map((s, i) => (
          <li key={s.key}>
            <span className={`dot ${s.state}`}>{s.state === "done" ? "✓" : s.state === "error" ? "!" : i + 1}</span>
            <span style={{ flex: 1, color: s.state === "pending" || s.state === "skipped" ? "var(--faint)" : "var(--text)" }}>{s.label}</span>
            <span className="small muted" style={{ maxWidth: "45%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.detail}>
        {s.state === "skipped" ? t("print.skipped") : s.detail}
            </span>
          </li>
        ))}
      </ol>
      {job.status === "error" && (
        <div className="notice error" style={{ whiteSpace: "pre-wrap" }}>
          {job.error}
          {needsLogin && (
            <>
              {" "}
              <Link href="/settings">{t("print.goSettings")}</Link>。
            </>
          )}
        </div>
      )}
      {sliced && (
        <div className="estimates">
          <div>
            <span>{perPlate ? t("print.totalPlates", { n: job.plates!.length }) : t("print.printTime")}</span>
            <span>{duration(job.stats.seconds)}</span>
          </div>
          <div>
            <span>{t("print.filament")}</span>
            <span>{job.stats.grams != null ? `${job.stats.grams.toFixed(1)} g` : "—"}</span>
          </div>
          <div>
            <span>{t("print.toolChanges")}</span>
            <span>{job.stats.toolChanges ?? "—"}</span>
          </div>
          <div>
            <span>{t("print.price")}</span>
            <span>{euros(slicedPrice(job.stats, job.filamentToTool, tools))}</span>
          </div>
        </div>
      )}
      {sliced && !perPlate && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-sm" href={`/api/jobs/${job.id}/file?kind=gcode`}>
            <DownloadIcon size={14} /> {t("print.gcode")}
          </a>
          <a className="btn btn-sm" href={`/api/jobs/${job.id}/file?kind=3mf`}>
            <DownloadIcon size={14} /> {t("print.u1ThreeMf")}
          </a>
          {!sent && onSend && job.status !== "running" && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onSend} disabled={!printerConfigured}>
              <SendIcon size={14} /> {t("print.sendToPrinter")}
            </button>
          )}
          {sent && !started && onPrint && job.status !== "running" && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onPrint} disabled={!printerConfigured}>
              {t("print.startPrint")}
            </button>
          )}
          {sent && started && (
            <Link className="btn btn-sm" href="/printer">
              {t("print.watchPrinter")}
            </Link>
          )}
        </div>
      )}
      {perPlate && sent && (
        <Link className="btn btn-sm" href="/printer" style={{ alignSelf: "flex-start" }}>
          {t("print.watchPrinter")}
        </Link>
      )}
      {sliced && job.status !== "running" && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setShowLayers(true);
            layersDialog.current?.showModal();
          }}
        >
          <LayersIcon size={16} /> {t("print.layerPreview")}
        </button>
      )}
      <dialog ref={layersDialog} className="layer-dialog" aria-labelledby={`layers-${job.id}`} onClose={() => setShowLayers(false)}>
        <div className="layer-dialog-head">
          <h2 id={`layers-${job.id}`}>{t("print.layerPreviewTitle", { title: job.title })}</h2>
          <button type="button" className="btn btn-sm" onClick={() => layersDialog.current?.close()}>
            {t("print.close")}
          </button>
        </div>
        {/* Mounted only while open: the toolpaths of a big print take tens of megabytes. */}
        {showLayers && sliced && <ToolpathViewer jobId={job.id} plates={job.plates?.length ?? 1} />}
      </dialog>
    </div>
  );
}
