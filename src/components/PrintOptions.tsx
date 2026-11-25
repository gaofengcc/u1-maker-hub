"use client";

import { useEffect, useMemo, useState } from "react";
import type { PrintOptions as Options } from "@/lib/slicer.ts";
import { PRINT_MODE_LAYER_HEIGHTS } from "@/lib/printModeMetadata.ts";
import { t } from "@/lib/i18n";
import { api, duration } from "@/lib/format";
import type { ModelHints } from "@/lib/modelHints.ts";

export type EstimateValue = { seconds?: number; grams?: number; cached?: boolean };
export type RecommendationPreset = {
  mode?: string;
  options?: Partial<Options>;
  overrides?: Record<string, string>;
  reasons?: string[];
  estimate?: EstimateValue;
};
export type ModelPreset = {
  options?: Partial<Options>;
  layerHeight?: number;
  material?: string;
  color?: string;
  machine?: string;
  plateCount?: number;
  supportAngle?: number;
  infillPattern?: string;
};
export type PrintOptionsPanelProps = {
  value: Options;
  defaults: Options;
  onChange: (v: Options) => void;
  creatorSupports?: Options["supports"] | null;
  /** Optional model context. When omitted the panel still shows all four tabs with local defaults. */
  instanceId?: string;
  /** 所属设计 id。配置 id 与设计 id 会撞号，说明必须按设计 id 取，否则会读到别的模型。 */
  designId?: number;
  plate?: number;
  site?: string;
  modelPreset?: ModelPreset | null;
  recommendations?: { recommend?: RecommendationPreset; speed?: RecommendationPreset } | null;
  hints?: ModelHints | null;
  hintConflicts?: string[];
  onOverridesChange?: (overrides: Record<string, string>) => void;
  onPresetMode?: (mode: string) => void;
};

type MetricsLike = {
  volumeMm3?: number;
  volume?: number;
  surfaceAreaMm2?: number;
  surfaceArea?: number;
  heightMm?: number;
  height?: number;
  bedAreaMm2?: number;
  baseAreaMm2?: number;
};

function roughEstimate(metrics: MetricsLike | null | undefined, options: Options, layerHeight = 0.2): EstimateValue | null {
  const volume = Number(metrics?.volumeMm3 ?? metrics?.volume);
  const surface = Number(metrics?.surfaceAreaMm2 ?? metrics?.surfaceArea);
  const height = Number(metrics?.heightMm ?? metrics?.height);
  if (!(volume > 0) || !(surface > 0) || !(height > 0)) return null;
  // 粗估公式：耗材体积 ≈ 表面积×墙圈数×挤出宽度(0.42)×0.7 + 体积×填充密度。
  // VM200 / U1 / PLA / 20mm 立方体实测的端到端等效流量，包含空驶与加减速。
  const materialVolume = surface * options.wallLoops * 0.42 * 0.7 + volume * Math.max(0, options.infillDensity) / 100;
  const grams = (materialVolume / 1000) * 1.24;
  const h = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : 0.2;
  const flowAt = h <= 0.12 ? 2.75 : h >= 0.28 ? 4.1 : h <= 0.2 ? 2.75 + (3.46 - 2.75) * (h - 0.12) / 0.08 : 3.46 + (4.1 - 3.46) * (h - 0.2) / 0.08;
  let seconds = materialVolume / flowAt + (options.supports === "off" ? 0 : 45);
  if (options.ironing) seconds *= 1.25;
  return { seconds, grams };
}

function presetOptions(base: Options, preset?: RecommendationPreset | null) {
  return { ...base, ...(preset?.options ?? {}) };
}

function overhangSummary(preset: RecommendationPreset | null | undefined, options: Options, material: string | undefined) {
  const overrides = preset?.overrides ?? {};
  const angle = overrides.support_threshold_angle ?? "45";
  const speeds = [
    overrides.overhang_2_4_speed ?? "40",
    overrides.overhang_3_4_speed ?? "25",
    overrides.overhang_4_4_speed ?? "10",
  ].join("/");
  if (options.supports === "off") return t("print.overhangSummaryOff", { speeds });
  const gap = overrides.support_top_z_distance ?? "0.2";
  return t("print.overhangSummary", { angle, speeds, gap, material: material || "PLA" });
}

function Estimate({ value, exact }: { value?: EstimateValue | null; exact?: boolean }) {
  return (
    <span className="muted small">
      {value ? <>{t("print.estimateTime")} {duration(value.seconds)} · {t("print.estimateFilament")} {value.grams == null ? "—" : `${value.grams.toFixed(1)}g`}{exact ? ` · ${t("print.estimateExact")}` : ""}</> : t("print.exactPrompt")}
    </span>
  );
}

/** The most commonly changed slicer settings, each explained for someone new to 3D printing. */

const PATTERN_HINTS: Record<Options["infillPattern"], string> = {
  gyroid: t("print.patternHints.gyroid"),
  grid: t("print.patternHints.grid"),
  crosshatch: t("print.patternHints.crosshatch"),
  cubic: t("print.patternHints.cubic"),
  lightning: t("print.patternHints.lightning"),
  honeycomb: t("print.patternHints.honeycomb"),
};
const SUPPORT_HINTS: Record<Options["supports"], string> = {
  off: t("print.supportHints.off"),
  auto: t("print.supportHints.auto"),
  plate: t("print.supportHints.plate"),
};
const SEAM_HINTS: Record<Options["seam"], string> = {
  aligned: t("print.seamHints.aligned"),
  back: t("print.seamHints.back"),
  nearest: t("print.seamHints.nearest"),
  random: t("print.seamHints.random"),
};
const LAYER_HINTS: Record<Options["layers"], string> = {
  fixed: t("print.layerHints.fixed"),
  adaptive: t("print.layerHints.adaptive"),
  balanced: t("print.layerHints.balanced"),
};

function Tag({ kind }: { kind: "strength" | "success" | "looks" }) {
  const map = { strength: ["blue", t("print.strength")], success: ["orange", t("print.printSuccess")], looks: ["purple", t("print.looks")] } as const;
  return <span className={`badge ${map[kind][0]}`}>{map[kind][1]}</span>;
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** `creatorSupports`: what the MakerWorld creator used, when known; shown next to the Supports choice. */
function FineTunePanel({ value, defaults, onChange, creatorSupports = null }: Pick<PrintOptionsPanelProps, "value" | "defaults" | "onChange" | "creatorSupports">) {
  const set = <K extends keyof Options>(key: K, v: Options[K]) => onChange({ ...value, [key]: v });
  const changed = (Object.keys(defaults) as (keyof Options)[]).filter((k) => value[k] !== defaults[k]).length;

  return (
    <section className="panel" style={{ gap: 0 }} aria-labelledby="finetune">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="finetune">{t("print.fineTune")}</h2>
          <p className="muted small" style={{ lineHeight: 1.5 }}>
            {t("print.fineTuneDescription")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted small">{changed === 0 ? t("print.presetDefaults") : t(changed === 1 ? "print.changedOne" : "print.changed", { n: changed })}</span>
          <button type="button" className="btn btn-sm" onClick={() => onChange(defaults)} disabled={changed === 0}>
            {t("print.reset")}
          </button>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.infillDensity")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.infillDensityDesc")}</span>
          <span className="opt-hint">{t("print.infillDensityHint")}</span>
        </div>
        <label className="opt-control field" htmlFor="infill">
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span className="muted">{t("print.hollow")}</span>
            <strong style={{ fontSize: 16 }}>{value.infillDensity}%</strong>
            <span className="muted">{t("print.solid")}</span>
          </span>
          <input id="infill" type="range" min={0} max={100} step={5} value={value.infillDensity} onChange={(e) => set("infillDensity", Number(e.target.value))} />
        </label>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.infillPattern")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.infillPatternDesc")}</span>
          <span className="opt-hint live">{PATTERN_HINTS[value.infillPattern]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="pattern">
            {t("print.pattern")}
          </label>
          <select id="pattern" className="select" value={value.infillPattern} onChange={(e) => set("infillPattern", e.target.value as Options["infillPattern"])}>
            <option value="gyroid">{t("print.gyroid")}（{t("print.recommended")}）</option>
            <option value="crosshatch">{t("print.crosshatch")}</option>
            <option value="grid">{t("print.grid")}</option>
            <option value="cubic">{t("print.cubic")}</option>
            <option value="lightning">{t("print.lightning")}</option>
            <option value="honeycomb">{t("print.honeycomb")}</option>
          </select>
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.wallLoops")} <Tag kind="strength" />
          </span>
          <span className="opt-desc">{t("print.wallLoopsDesc")}</span>
          <span className="opt-hint">{t("print.wallLoopsHint")}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.wallLoops")} value={value.wallLoops} options={[[2, t("print.walls", { n: 2 })], [3, t("print.walls", { n: 3 })], [4, t("print.walls", { n: 4 })]]} onChange={(v) => set("wallLoops", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.supports")} <Tag kind="success" />
          </span>
          <span className="opt-desc">{t("print.supportsDesc")}</span>
          <span className="opt-hint live">{SUPPORT_HINTS[value.supports]}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.supports")} value={value.supports} options={[["off", t("print.supportOff")], ["auto", t("print.supportAuto")], ["plate", t("print.supportPlate")]]} onChange={(v) => set("supports", v)} />
          {creatorSupports && creatorSupports !== "off" && (
            <div className={`notice small${value.supports === "off" ? " error" : " ok"}`} role="status">
              {value.supports === "off"
                ? t("print.supportCreatorOff")
                : t("print.supportCreatorOn", { where: creatorSupports === "plate" ? t("print.onPlateOnly") : "" })}
            </div>
          )}
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">{t("print.supportAngle")}</span>
          <span className="opt-desc">{t("print.supportAngleDesc")}</span>
        </div>
        <div className="opt-control">
          <Seg
            label={t("print.supportAngle")}
            value={value.supportAngle ?? "auto"}
            options={[["auto", t("print.supportAngleAuto")], [35, "35°"], [40, "40°"], [45, "45°"]]}
            onChange={(v) => {
              const next = { ...value };
              if (v === "auto") delete next.supportAngle;
              else next.supportAngle = v as 35 | 40 | 45;
              onChange(next);
            }}
          />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">{t("print.overhangSpeed")}</span>
          <span className="opt-desc">{t("print.overhangSpeedDesc")}</span>
        </div>
        <div className="opt-control">
          <Seg
            label={t("print.overhangSpeed")}
            value={value.overhangSpeed ?? "auto"}
            options={[["auto", t("print.overhangSpeedAuto")], ["standard", t("print.overhangSpeedStandard")], ["slow", t("print.overhangSpeedSlow")], ["off", t("print.overhangSpeedOff")]]}
            onChange={(v) => {
              const next = { ...value };
              if (v === "auto") delete next.overhangSpeed;
              else next.overhangSpeed = v as "standard" | "slow" | "off";
              onChange(next);
            }}
          />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.brim")} <Tag kind="success" />
          </span>
          <span className="opt-desc">{t("print.brimDesc")}</span>
          <span className="opt-hint">{t("print.brimHint")}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.brim")} value={value.brim} options={[["none", t("print.none")], ["auto", t("print.supportAuto")], ["always", t("print.always")]]} onChange={(v) => set("brim", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.layerHeight")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.layerHeightDesc")}</span>
          <span className="opt-hint live">{LAYER_HINTS[value.layers]}</span>
        </div>
        <div className="opt-control">
          <Seg label={t("print.layerHeight")} value={value.layers} options={[["fixed", t("print.fixed")], ["adaptive", t("print.adaptive")], ["balanced", t("print.balanced")]]} onChange={(v) => set("layers", v)} />
        </div>
      </div>

      <div className="opt-row">
        <div className="opt-text">
          <span className="opt-title">
            {t("print.ironing")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.ironingDesc")}</span>
          <span className="opt-hint">{t("print.ironingHint")}</span>
        </div>
        <label className="opt-control switch">
          <input type="checkbox" role="switch" checked={value.ironing} onChange={(e) => set("ironing", e.target.checked)} />
          {value.ironing ? t("print.ironingOn") : t("print.supportOff")}
        </label>
      </div>

      <div className="opt-row" style={{ paddingBottom: 0 }}>
        <div className="opt-text">
          <span className="opt-title">
            {t("print.seamPosition")} <Tag kind="looks" />
          </span>
          <span className="opt-desc">{t("print.seamDesc")}</span>
          <span className="opt-hint live">{SEAM_HINTS[value.seam]}</span>
        </div>
        <div className="opt-control field">
          <label className="label" htmlFor="seam">
            {t("print.seam")}
          </label>
          <select id="seam" className="select" value={value.seam} onChange={(e) => set("seam", e.target.value as Options["seam"])}>
            <option value="aligned">{t("print.aligned")}（{t("print.recommended")}）</option>
            <option value="back">{t("print.back")}</option>
            <option value="nearest">{t("print.nearest")}</option>
            <option value="random">{t("print.random")}</option>
          </select>
        </div>
      </div>
    </section>
  );
}

type TabKey = "model" | "recommend" | "speed" | "custom";

/** 四档打印参数面板。旧调用方不传模型信息时，推荐档使用当前默认值并保持可用。 */
export function PrintOptionsPanel(props: PrintOptionsPanelProps) {
  const { value, defaults, onChange, creatorSupports = null, instanceId, designId, plate = 1, site, modelPreset, onOverridesChange, onPresetMode } = props;
  const [active, setActive] = useState<TabKey>("recommend");
  const [loaded, setLoaded] = useState<PrintOptionsPanelProps["recommendations"]>(props.recommendations ?? null);
  const [creatorPreset, setCreatorPreset] = useState<ModelPreset | null>(props.modelPreset ?? null);
  const [metrics, setMetrics] = useState<MetricsLike | null>(null);
  const [exact, setExact] = useState<Record<string, EstimateValue | null>>({});
  const [exactState, setExactState] = useState<Record<string, "idle" | "running" | "done" | "error">>({});
  const [exactErrors, setExactErrors] = useState<Record<string, string>>({});
  const [showRough, setShowRough] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<ModelHints | null>(props.hints ?? null);
  const [hintConflicts, setHintConflicts] = useState<string[]>(props.hintConflicts ?? []);

  useEffect(() => {
    setLoaded(props.recommendations ?? null);
    setCreatorPreset(props.modelPreset ?? null);
    setHints(props.hints ?? null);
    setHintConflicts(props.hintConflicts ?? []);
    if (!instanceId) {
      setMetrics(null);
      return;
    }
    let alive = true;
    api<{ metrics?: MetricsLike; presets?: PrintOptionsPanelProps["recommendations"]; hints?: ModelHints; hintConflicts?: string[]; creator?: { options?: Partial<Options>; layerHeight?: number | null; infillPattern?: string | null; supportAngle?: number | null; materialTypes?: string[]; materialColors?: string[]; printer?: string; plateCount?: number } | null }>(`/api/recommend/${encodeURIComponent(instanceId)}?plate=${plate}${site ? `&site=${encodeURIComponent(site)}` : ""}${designId ? `&design=${designId}` : ""}`)
      .then((result) => {
        if (!alive) return;
        setMetrics(result.metrics ?? null);
        setHints(result.hints ?? null);
        setHintConflicts(result.hintConflicts ?? []);
        if (result.presets) setLoaded(result.presets);
        if (result.creator) setCreatorPreset({
          options: result.creator.options,
          layerHeight: result.creator.layerHeight ?? undefined,
          material: result.creator.materialTypes?.[0],
          color: result.creator.materialColors?.[0],
          machine: result.creator.printer,
          plateCount: result.creator.plateCount,
          infillPattern: result.creator.infillPattern ?? undefined,
          supportAngle: result.creator.supportAngle ?? undefined,
        });
      })
      .catch(() => {
        /* recommendation is optional and the current defaults remain usable */
      });
    return () => {
      alive = false;
    };
  }, [instanceId, designId, plate, site, props.recommendations]);

  const recommend = loaded?.recommend;
  const speed = loaded?.speed;
  const material = creatorPreset?.material ?? modelPreset?.material ?? "PLA";
  const recOptions = useMemo(() => presetOptions(defaults, recommend), [defaults, recommend]);
  const speedOptions = useMemo(() => presetOptions(defaults, speed), [defaults, speed]);
  const rough: Record<string, EstimateValue | null> = {
    recommend: recommend?.estimate ?? roughEstimate(metrics, recOptions, PRINT_MODE_LAYER_HEIGHTS.fine),
    speed: speed?.estimate ?? roughEstimate(metrics, speedOptions, PRINT_MODE_LAYER_HEIGHTS.fast),
    model: roughEstimate(metrics, { ...defaults, ...(creatorPreset?.options ?? modelPreset?.options ?? {}) }, creatorPreset?.layerHeight ?? modelPreset?.layerHeight ?? PRINT_MODE_LAYER_HEIGHTS.standard),
    custom: roughEstimate(metrics, value, PRINT_MODE_LAYER_HEIGHTS.standard),
  };

  const apply = (next: Options) => onChange(next);
  const changedCount = (Object.keys(defaults) as (keyof Options)[]).filter((key) => value[key] !== defaults[key]).length;
  const exactCompare = async () => {
    if (!instanceId) {
      setError(t("print.estimateUnavailable"));
      return;
    }
    const plans: Array<[string, string, Options]> = [
      ["recommend", t("print.tabRecommend"), recOptions],
      ["speed", t("print.tabSpeed"), speedOptions],
      ["custom", t("print.tabCustom"), value],
    ];
    setError(null);
    setExactErrors({});
    setExactState(Object.fromEntries(plans.map(([key]) => [key, "running"])));
    await Promise.all(
      plans.map(async ([key, , options]) => {
        try {
          const preset = key === "speed" ? speed : key === "recommend" ? recommend : undefined;
          const task = await api<{ id: string }>("/api/slice", { method: "POST", body: JSON.stringify({ instanceId, plate, site, mode: key === "speed" ? "fast" : key === "recommend" ? "fine" : "standard", options, overrides: preset?.overrides ?? {} }) });
          let result: { result?: { minutes: number; grams: number }; status: string; progress?: number; error?: string } = { status: "pending" };
          for (let attempt = 0; attempt < 120 && result.status !== "done" && result.status !== "error"; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            result = await api<typeof result>(`/api/slice/${task.id}`);
          }
          if (result.status === "error" || !result.result) throw new Error(result.error ?? t("print.estimateUnavailable"));
          setExact((prev) => ({ ...prev, [key]: { seconds: result.result!.minutes * 60, grams: result.result!.grams, cached: Boolean((result as { cached?: boolean }).cached) } }));
          setExactState((prev) => ({ ...prev, [key]: "done" }));
        } catch (e) {
          setExactErrors((prev) => ({ ...prev, [key]: (e as Error).message }));
          setExactState((prev) => ({ ...prev, [key]: "error" }));
          setError((prev) => prev ?? (e as Error).message);
        }
      }),
    );
  };

  const tabs: Array<[TabKey, string]> = [
    ["model", t("print.tabModel")],
    ["recommend", t("print.tabRecommend")],
    ["speed", t("print.tabSpeed")],
    ["custom", t("print.tabCustom")],
  ];
  const displayEstimate = exact[active] ?? (showRough ? rough[active] : null);

  return (
    <section className="panel" style={{ gap: 0 }} aria-labelledby="finetune">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="finetune">{t("print.fineTune")}</h2>
          <p className="muted small" style={{ lineHeight: 1.5 }}>{t("print.fineTuneDescription")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Estimate value={displayEstimate} exact={Boolean(exact[active])} />
          <button type="button" className="btn btn-sm" onClick={exactCompare}>{t("print.exactCompare")}</button>
          {!showRough && <button type="button" className="btn btn-sm" onClick={() => setShowRough(true)}>{t("print.roughEstimate")}</button>}
        </div>
      </div>

      {hints?.quotes?.length ? (
        <section aria-labelledby="author-hints" style={{ marginBottom: 10 }}>
          <h3 id="author-hints" style={{ margin: "4px 0 8px", fontSize: 15 }}>{t("print.authorHintsTitle")}</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {hints.quotes.map((quote, index) => (
              <details key={`${quote.label}-${index}`} open={index < 3} style={{ borderLeft: "3px solid var(--border, #cbd5e1)", background: "var(--surface-muted, #f3f4f6)", padding: "6px 10px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>{quote.label}</summary>
                <div className="small muted" style={{ marginTop: 4 }}>{quote.sentence}</div>
              </details>
            ))}
          </div>
          {hintConflicts.map((conflict, index) => <div key={`${conflict}-${index}`} className="notice small" role="status" style={{ marginTop: 6, background: "#fff7d6", borderColor: "#eab308" }}>{conflict}</div>)}
        </section>
      ) : hintConflicts.length > 0 ? (
        <section aria-label={t("print.authorHintsTitle")} style={{ marginBottom: 10 }}>
          {hintConflicts.map((conflict, index) => <div key={`${conflict}-${index}`} className="notice small" role="status" style={{ background: "#fff7d6", borderColor: "#eab308" }}>{conflict}</div>)}
        </section>
      ) : null}

      <div role="tablist" aria-label={t("print.parameterTabs")} style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8 }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={active === key} className={`btn btn-sm${active === key ? " active" : ""}`} onClick={() => setActive(key)} style={{ flex: "0 0 auto" }}>
            {label}{key === "custom" && changedCount > 0 ? `（${t("print.changed", { n: changedCount })}）` : ""}
          </button>
        ))}
      </div>

      {error && <div className="notice error small" role="alert">{error}</div>}
      {active === "model" && (
        <div className="opt-row" style={{ display: "block" }}>
          <div className="opt-text">
            <span className="opt-title">{t("print.modelPresetReadOnly")}</span>
            {creatorPreset ? <>
              <span className="opt-desc">{t("print.modelPresetSummary", { layer: creatorPreset.layerHeight ?? "—", material: creatorPreset.material ?? "—", machine: creatorPreset.machine ?? "—", plates: creatorPreset.plateCount ?? "—" })}</span>
              <span className="opt-hint">{t("print.modelPresetInfill", { pattern: creatorPreset.infillPattern ?? "—", angle: creatorPreset.supportAngle ?? "—" })}</span>
            </> : <span className="opt-desc">{t("print.modelPresetFallback")}</span>}
          </div>
          {creatorPreset && <button type="button" className="btn btn-sm" onClick={() => apply({ ...defaults, ...(creatorPreset.options ?? {}) })}>{t("print.applyCreatorPreset")}</button>}
        </div>
      )}
      {active === "recommend" && (
        <div>
          <div className="opt-row" style={{ display: "block" }}>
            <div className="opt-text"><span className="opt-title">{t("print.recommendTitle")}</span><span className="opt-desc">{(recommend?.reasons ?? [t("print.recommendFallback")]).join("；")}</span><span className="opt-hint">{overhangSummary(recommend, recOptions, material)}</span></div>
            <button type="button" className="btn btn-sm" onClick={() => { apply(recOptions); onOverridesChange?.(recommend?.overrides ?? {}); if (recommend?.mode) onPresetMode?.(recommend.mode); }}>{t("print.usePreset")}</button>
          </div>
          <Estimate value={exact.recommend ?? (showRough ? rough.recommend : null)} exact={Boolean(exact.recommend)} />
        </div>
      )}
      {active === "speed" && (
        <div>
          <div className="opt-row" style={{ display: "block" }}>
            <div className="opt-text"><span className="opt-title">{t("print.speedTitle")}</span><span className="opt-desc">{(speed?.reasons ?? [t("print.speedFallback")]).join("；")}</span><span className="opt-hint">{overhangSummary(speed, speedOptions, material)}</span></div>
            <button type="button" className="btn btn-sm" onClick={() => { apply(speedOptions); onOverridesChange?.(speed?.overrides ?? {}); if (speed?.mode) onPresetMode?.(speed.mode); }}>{t("print.usePreset")}</button>
          </div>
          <Estimate value={exact.speed ?? (showRough ? rough.speed : null)} exact={Boolean(exact.speed)} />
        </div>
      )}
      {showRough && <p className="small muted">{t("print.roughEstimateWarning")}</p>}
      {active === "custom" && (
        <>
          {changedCount > 0 && <div className="notice small">{t("print.changed", { n: changedCount })}</div>}
          <FineTunePanel value={value} defaults={defaults} onChange={(next) => { setActive("custom"); onChange(next); }} creatorSupports={creatorSupports} />
        </>
      )}

      {Object.keys(exactState).length > 0 && (
        <div className="opt-row" style={{ display: "block" }}>
          <strong>{t("print.exactCompare")}</strong>
          {(["recommend", "speed", "custom"] as const).map((key) => <div key={key} className="small">{key === "recommend" ? t("print.tabRecommend") : key === "speed" ? t("print.tabSpeed") : t("print.tabCustom")}：{exactState[key] === "running" ? t("print.exactSlicing") : exactState[key] === "done" ? <Estimate value={exact[key]} exact /> : `${t("print.exactFailed")}（${exactErrors[key] ?? t("print.estimateUnavailable")}）`}</div>)}
        </div>
      )}
    </section>
  );
}
